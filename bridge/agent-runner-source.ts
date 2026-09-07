import { previewInstructions } from "./preview-instructions.ts";

export const agentRunnerSource = String.raw`
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { createServer } from 'node:http';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { client, ndJsonStream } from '@agentclientprotocol/sdk';

const workspaceDirectory = process.env.SPARKLES_WORKSPACE_DIR || '/workspace/repo';
const stateDirectory = process.env.SPARKLES_STATE_DIR || '/workspace/.sparkles';
const agentKind = process.env.SPARKLES_AGENT || 'opencode';
const agentLabel = agentKind === 'codex' ? 'Codex' : 'OpenCode';
const port = Number(process.env.SPARKLES_AGENT_PORT || 4097);
mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
const statePath = join(stateDirectory, 'runner-state.json');
const journalPath = join(stateDirectory, 'events.jsonl');
const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : {};
const events = existsSync(journalPath) ? readFileSync(journalPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
let sequence = Math.max(previous.sequence || 0, events.at(-1)?.id || 0);
let acknowledged = previous.acknowledged || 0;
const requests = new Map(previous.requests || []);
const permissions = new Map();
let status = 'starting';
let sessionId = previous.sessionId;
let activeRequest;
let loadingSession = false;
let checkpointStatus;
let checkpointTimer;
let checkpointId;
let protocolTurn;
let permissionModes;
let changingMode = false;
let previewFingerprint = previous.previewFingerprint;
let checkingPreview = false;
const previewContext = ${JSON.stringify(previewInstructions)};
const mcpServers = [{ name: 'computer', command: '/usr/bin/python3', args: ['/opt/sparkles/computer-mcp.py'], env: [{ name: 'SPARKLES_STATE_DIR', value: stateDirectory }, { name: 'SPARKLES_WORKSPACE_DIR', value: workspaceDirectory }] }];
const permissionModeIds = ['read-only', 'agent', 'agent-full-access'];
const persist = () => {
  const value = { version: 1, agent: agentKind, sessionId, sequence, acknowledged, requests: [...requests], activeRequest, status, previewFingerprint, permissionMode: permissionModes?.currentModeId ?? previous.permissionMode };
  writeFileSync(statePath + '.tmp', JSON.stringify(value), { mode: 0o600, flush: true });
  renameSync(statePath + '.tmp', statePath);
  const controlAllowed = agentKind !== 'codex' || ['agent', 'agent-full-access'].includes(permissionModes?.currentModeId);
  const policyPath = join(stateDirectory, 'computer-policy.json');
  writeFileSync(policyPath + '.tmp', JSON.stringify({ controlAllowed }), { mode: 0o600 });
  renameSync(policyPath + '.tmp', policyPath);
};
const emit = (type, data) => {
  const event = { id: ++sequence, type, data, timestamp: Date.now() };
  appendFileSync(journalPath, JSON.stringify(event) + '\n', { mode: 0o600, flush: true });
  events.push(event);
  persist();
};
const publishPreview = async () => {
  if (checkingPreview || status === 'checkpointing' || loadingSession) return;
  checkingPreview = true;
  try {
    const response = await fetch('http://127.0.0.1:' + (process.env.SPARKLES_VIEWS_CONTROL_PORT || 4098), {
      method: 'POST',
      body: JSON.stringify({kind:'services'}),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (status === 'checkpointing' || loadingSession || result.kind !== 'services') return;
    const preview = result.preview;
    if (preview?.status !== 'ready') { previewFingerprint = undefined; return; }
    if (!Number.isInteger(preview.port) || preview.port < 1024 || preview.port > 65535) return;
    const title = typeof preview.title === 'string' && preview.title.trim() ? preview.title.slice(0,100) : 'App preview';
    const fingerprint = JSON.stringify([preview.port, preview.command, title]);
    if (previewFingerprint === fingerprint) return;
    previewFingerprint = fingerprint;
    emit('preview', { title, port: preview.port });
  } catch {
  } finally {
    checkingPreview = false;
  }
};
setInterval(() => void publishPreview(), 4000).unref();
const publishPermissionModes = () => {
  if (permissionModes) emit('permission_modes', permissionModes);
};
const restorePermissionModes = async (modes) => {
  if (agentKind !== 'codex' || !modes) return;
  const availableModes = modes.availableModes.filter((mode) => permissionModeIds.includes(mode.id)).map(({ id }) => ({ id }));
  if (!availableModes.some((mode) => mode.id === modes.currentModeId)) throw new Error('Unsupported permission mode');
  const savedMode = previous.permissionMode;
  if (savedMode && savedMode !== modes.currentModeId) {
    if (!availableModes.some((mode) => mode.id === savedMode)) throw new Error('Saved permission mode is unavailable');
    await agent.request('session/set_mode', { sessionId, modeId: savedMode });
  }
  permissionModes = { availableModes, currentModeId: savedMode ?? modes.currentModeId };
  publishPermissionModes();
};
const resolvePermissions = () => {
  for (const [id, permission] of permissions) {
    permission.resolve({ outcome: { outcome: 'cancelled' } });
    emit('permission_resolved', { id });
  }
  permissions.clear();
};
if (agentKind === 'codex') mkdirSync(join(stateDirectory, 'codex'), { recursive: true, mode: 0o700 });
if (previous.agent && previous.agent !== agentKind) throw new Error('Saved agent does not match this task');
const child = spawn(agentKind === 'codex' ? 'codex-acp' : 'opencode', agentKind === 'codex' ? [] : ['acp'], {
  cwd: workspaceDirectory,
  env: { ...process.env, CODEX_HOME: join(stateDirectory, 'codex'), XDG_DATA_HOME: join(stateDirectory, 'data'), XDG_STATE_HOME: join(stateDirectory, 'state') },
  stdio: ['pipe', 'pipe', 'inherit'],
});
const connection = client({ name: 'sparkles' })
  .onNotification('session/update', ({ params }) => {
    if (loadingSession) return;
    const update = params.update;
    if (update.sessionUpdate === 'current_mode_update' && permissionModes?.availableModes.some((mode) => mode.id === update.currentModeId)) {
      permissionModes = { ...permissionModes, currentModeId: update.currentModeId };
      publishPermissionModes();
    }
    emit('update', update);
  })
  .onRequest('session/request_permission', ({ params }) => {
    if (loadingSession) return { outcome: { outcome: 'cancelled' } };
    return new Promise((resolve) => {
      const id = crypto.randomUUID();
      permissions.set(id, { params, resolve });
      emit('permission', { id, ...params });
    });
  })
  .connect(ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
const agent = connection.agent;
child.on('error', () => { status = 'failed'; emit('error', { message: agentLabel + ' could not start.' }); });
child.on('exit', () => { status = 'failed'; resolvePermissions(); emit('error', { message: 'The agent process stopped. Its saved conversation remains available.' }); });

const ready = (async () => {
  const initialized = await agent.request('initialize', { protocolVersion: 1, clientCapabilities: agentKind === 'codex' ? { auth: { _meta: { gateway: true } } } : {}, clientInfo: { name: 'sparkles', version: '1.0.0' } });
  if (initialized.protocolVersion !== 1) throw new Error('Unsupported ACP version');
  if (agentKind === 'codex') {
    if (!initialized.authMethods.some(method => method.id === 'gateway')) throw new Error('Codex gateway authentication is unavailable');
    await agent.request('authenticate', { methodId: 'gateway', _meta: { gateway: { baseUrl: process.env.SPARKLES_MODEL_GATEWAY_URL, headers: { Authorization: 'Bearer ' + process.env.SPARKLES_MODEL_GATEWAY_TOKEN }, providerName: 'Sparkles ChatGPT connection' } } });
  }
  if (sessionId) {
    if (!initialized.agentCapabilities.loadSession) throw new Error('Agent cannot load saved sessions');
    loadingSession = true;
    try {
      const session = await agent.request('session/load', { sessionId, cwd: workspaceDirectory, mcpServers });
      await restorePermissionModes(session.modes);
    }
    finally { loadingSession = false; }
    status = 'idle';
    emit('restored', { sessionId, message: 'Workspace and agent context restored. Unfinished operations were not automatically replayed.' });
    if (previous.activeRequest || previous.status === 'running' || previous.status === 'failed') {
      emit('interrupted', { message: 'The previous turn was interrupted. Inspect the restored files before repeating a tool operation.', requestId: previous.activeRequest });
    }
  } else {
    const session = await agent.request('session/new', { cwd: workspaceDirectory, mcpServers });
    sessionId = session.sessionId;
    await restorePermissionModes(session.modes);
    status = 'idle';
  }
  emit('ready', { sessionId });
})().catch(() => { status = 'failed'; emit('error', { message: agentLabel + ' could not initialize or restore the saved session.' }); });

const releaseCheckpoint = () => {
  clearTimeout(checkpointTimer);
  if (status === 'checkpointing') status = checkpointStatus || 'idle';
  checkpointId = undefined;
  persist();
};
const snapshot = (cursor) => {
  const batch = [];
  let bytes = 0;
  for (const event of events) {
    if (event.id <= cursor) continue;
    const size = Buffer.byteLength(JSON.stringify(event));
    if (batch.length && (bytes + size > 256 * 1024 || batch.length >= 50)) break;
    batch.push(event); bytes += size;
  }
  return { status, permissionModes, sessionId: sessionId || null, events: batch, cursor: batch.at(-1)?.id ?? Math.min(cursor, sequence), head: sequence };
};
createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method !== 'POST') { res.writeHead(405).end('{}'); return; }
    let body = '';
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 100_000) throw new Error('Request too large');
    }
    const command = JSON.parse(body);
    if (command.kind === 'prepare_checkpoint') {
      await ready;
      if (!sessionId || protocolTurn || changingMode || !['idle', 'failed'].includes(status)) throw new Error('Agent is busy');
      checkpointStatus = status;
      checkpointId = command.id;
      status = 'checkpointing';
      persist();
      checkpointTimer = setTimeout(releaseCheckpoint, 180000);
      res.end(JSON.stringify({ sessionId, cursor: sequence, interrupted: checkpointStatus === 'failed', id: checkpointId }));
      return;
    }
    if (command.kind === 'release_checkpoint') {
      if (command.id !== checkpointId) throw new Error('Stale checkpoint release');
      releaseCheckpoint();
    } else if (command.kind === 'set_permission_mode') {
      await ready;
      if (!sessionId || !['idle', 'running'].includes(status) || changingMode || !permissionModes?.availableModes.some((mode) => mode.id === command.modeId)) throw new Error('Permission mode unavailable');
      changingMode = true;
      try {
        await agent.request('session/set_mode', { sessionId, modeId: command.modeId });
        permissionModes = { ...permissionModes, currentModeId: command.modeId };
        publishPermissionModes();
      } finally { changingMode = false; }
    } else if (command.kind === 'prompt') {
      await ready;
      const prior = requests.get(command.requestId);
      if (prior && prior !== command.prompt) throw new Error('Conflicting prompt retry');
      if (!prior) {
        if (status !== 'idle' || protocolTurn || changingMode) throw new Error('Agent is not ready');
        if (typeof command.requestId !== 'string' || typeof command.prompt !== 'string' || !command.prompt.trim() || command.prompt.length > 20000) throw new Error('Invalid prompt');
        requests.set(command.requestId, command.prompt);
        activeRequest = command.requestId;
        status = 'running';
        emit('user', { text: command.prompt, requestId: activeRequest });
        protocolTurn = agent.request('session/prompt', { sessionId, prompt: [{ type: 'text', text: previewContext }, { type: 'text', text: command.prompt }] })
          .then(async (result) => { await publishPreview(); status = 'idle'; emit('complete', { ...result, requestId: activeRequest }); })
          .catch(() => { status = 'failed'; emit('error', { message: 'The agent request failed. Review the last tool result before continuing.', requestId: activeRequest }); })
          .finally(() => { resolvePermissions(); activeRequest = undefined; protocolTurn = undefined; persist(); });
      }
    } else if (command.kind === 'cancel') {
      resolvePermissions();
      if (status === 'running') await agent.notify('session/cancel', { sessionId });
    } else if (command.kind === 'permission') {
      const permission = permissions.get(command.id);
      if (permission) {
        if (!permission.params.options.some((option) => option.optionId === command.optionId)) throw new Error('Invalid permission option');
        permission.resolve({ outcome: { outcome: 'selected', optionId: command.optionId } });
        permissions.delete(command.id);
        emit('permission_resolved', { id: command.id });
      }
    } else if (command.kind === 'sync') {
      if (command.acknowledge !== undefined) {
        if (!Number.isSafeInteger(command.acknowledge) || command.acknowledge < acknowledged || command.acknowledge > sequence) throw new Error('Invalid acknowledgement');
        acknowledged = command.acknowledge;
        persist();
      }
    } else if (command.kind !== 'events' && command.kind !== 'release_checkpoint') throw new Error('Invalid command');
    const cursor = Number.isSafeInteger(command.cursor) && command.cursor >= 0 ? command.cursor : 0;
    res.end(JSON.stringify(snapshot(cursor)));
  } catch {
    res.writeHead(409).end('{"error":"Agent command could not be accepted"}');
  }
}).listen(port, '127.0.0.1');
`;
