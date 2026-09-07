import { workspaceStaticSource } from "./workspace-static-source.ts";
import { browserProfileDirectory } from "./contracts.ts";

export const workspaceServicesSource = String.raw`
import { createServer, request as httpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, readdirSync, rmSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

const directory = process.env.SPARKLES_WORKSPACE_DIR || '/workspace/repo';
const stateDirectory = directory + '/.git/sparkles';
mkdirSync(stateDirectory, {recursive:true,mode:0o700});
const configFile = stateDirectory + '/preview.json';
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile,'utf8')) : {};
const staticServer = join(dirname(process.argv[1]), 'workspace-static.py');
writeFileSync(staticServer, ${JSON.stringify(workspaceStaticSource)}, {mode:0o600});
const staticCommand = 'python3 ' + "'" + staticServer.replaceAll("'", "'\"'\"'") + "'";
const previewRunner = join(dirname(process.argv[1]), 'workspace-preview.mjs');
const automaticCommand = 'node ' + "'" + previewRunner.replaceAll("'", "'\"'\"'") + "'";
if (config.command === automaticCommand || /^\(\[ -d node_modules \] \|\| (npm ci|(?:npm|pnpm|yarn) install)\) && (npm|pnpm|yarn) run (dev|start)$/.test(config.command || '')) config.command = '';
if (config.command === 'python3 -m http.server 3000 --bind 127.0.0.1') config.command = staticCommand;
const controlPort = Number(process.env.SPARKLES_VIEWS_CONTROL_PORT || 4098);
const previewGatewayPort = Number(process.env.SPARKLES_PREVIEW_GATEWAY_PORT || 8080);
const desktopGatewayPort = Number(process.env.SPARKLES_DESKTOP_GATEWAY_PORT || 6080);
const browserProfile = ${JSON.stringify(browserProfileDirectory)};
const browserOperation = '/tmp/sparkles-browser-operation';
const browserReaders = '/tmp/sparkles-browser-readers';
rmSync(browserOperation,{recursive:true,force:true});
mkdirSync(browserReaders,{recursive:true,mode:0o700});
const children = new Map();
const tickets = new Map();
const sessions = new Map();
const connections = new Map();
const preview = {status:'stopped',log:'',command:config.command || '',port:config.port || 3000,managed:false,title:config.title || 'App preview'};
const desktop = {status:'stopped',log:''};
let browserStarted = false;
const maximumLog = 12000;
const reserved = new Set([4097,4098,5900,6080,6081,8080,controlPort,previewGatewayPort,desktopGatewayPort]);
const digest = token => createHash('sha256').update(token).digest('hex');
const recordLog = (state, chunk) => { state.log = (state.log + chunk.toString()).slice(-maximumLog); };
const projectEnvironment = {};
for (const name of JSON.parse(process.env.SPARKLES_PROJECT_ENV_NAMES || '[]')) {
  if (typeof name === 'string' && Object.hasOwn(process.env, name)) projectEnvironment[name] = process.env[name];
}
const cleanEnvironment = () => ({...projectEnvironment,PATH:process.env.PATH,HOME:process.env.HOME || '/root',LANG:'C.UTF-8',DISPLAY:':99',TERM:'xterm-256color',PORT:String(preview.port),SPARKLES_WORKSPACE_DIR:directory});

function launch(name, command, args, state, options = {}) {
  const child = spawn(command,args,{cwd:directory,env:cleanEnvironment(),stdio:['ignore','pipe','pipe'],detached:true,...options});
  children.set(name,child);
  child.stdout.on('data', data => recordLog(state,data));
  child.stderr.on('data', data => recordLog(state,data));
  child.on('error', error => { recordLog(state,error.message); state.status = 'failed'; });
  child.on('exit', code => {
    if (children.get(name) !== child) return;
    children.delete(name);
    if (state.status !== 'stopped') { state.status = 'failed'; recordLog(state,'\nProcess exited (' + code + ').'); }
  });
  return child;
}
function revoke(service) {
  for (const store of [tickets,sessions]) for (const [key,grant] of store) if (!service || grant.service === service) store.delete(key);
  for (const [socket,kind] of connections) if (!service || kind === service) socket.destroy();
}
function stop(name) {
  const child = children.get(name);
  children.delete(name);
  if (child?.pid) {
    try { process.kill(-child.pid,'SIGTERM'); } catch {}
    setTimeout(() => { try { process.kill(-child.pid,'SIGKILL'); } catch {} },3000).unref();
  }
}
const browserArguments = ['--no-sandbox','--disable-dev-shm-usage','--no-first-run','--password-store=basic','--restore-last-session','--window-size=1100,740','--window-position=150,70','--user-data-dir=' + browserProfile,'about:blank'];
function browserPids() {
  const processes = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const argv = readFileSync('/proc/' + entry + '/cmdline','utf8').split('\0').filter(Boolean);
      const stat = readFileSync('/proc/' + entry + '/stat','utf8');
      const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      processes.push({pid:Number(entry),parent,argv});
    } catch {}
  }
  const roots = processes.filter(item => item.argv[0]?.includes('chromium') && item.argv.includes('--user-data-dir=' + browserProfile)).map(item => item.pid);
  const selected = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) if (selected.has(item.parent) && !selected.has(item.pid)) {
      selected.add(item.pid);
      changed = true;
    }
  }
  return [...selected];
}
function signalBrowser(signal) {
  const pids = browserPids();
  for (const pid of pids) try { process.kill(pid,signal); } catch {}
  return pids;
}
async function freezeBrowser() {
  const frozen = new Set();
  for (let pass = 0; pass < 3; pass++) {
    for (const pid of signalBrowser('SIGSTOP')) frozen.add(pid);
    await new Promise(resolve => setTimeout(resolve,50));
  }
  return [...frozen];
}
function processStart(pid) {
  try {
    const stat = readFileSync('/proc/' + pid + '/stat','utf8');
    return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
  } catch { return null; }
}
function pruneBrowserReaders() {
  for (const marker of readdirSync(browserReaders)) {
    const [pid,start] = marker.split('-');
    if (!pid || !start || processStart(pid) !== start) rmSync(browserReaders + '/' + marker,{force:true});
  }
}
async function beginBrowserOperation() {
  mkdirSync(browserOperation,{mode:0o700});
  for (let attempt = 0; attempt < 200; attempt++) {
    pruneBrowserReaders();
    if (!readdirSync(browserReaders).length) return;
    await new Promise(resolve => setTimeout(resolve,50));
  }
  endBrowserOperation();
  throw new Error('The browser is busy. Retry shortly.');
}
function endBrowserOperation() {
  rmSync(browserOperation,{recursive:true,force:true});
}
function launchBrowser() {
  browserStarted = true;
  const child = spawn('chromium',browserArguments,{cwd:directory,env:cleanEnvironment(),stdio:['ignore','pipe','pipe'],detached:true});
  child.stdout.on('data',data => recordLog(desktop,data));
  child.stderr.on('data',data => recordLog(desktop,data));
}
async function resetBrowser() {
  await beginBrowserOperation();
  try {
    signalBrowser('SIGTERM');
    await new Promise(resolve => setTimeout(resolve,1000));
    signalBrowser('SIGKILL');
    rmSync(browserProfile,{recursive:true,force:true});
    if (desktop.status === 'ready' || desktop.status === 'starting') launchBrowser();
  } finally {
    endBrowserOperation();
  }
}
async function probe(port) {
  try { const response = await fetch('http://127.0.0.1:' + port, {signal:AbortSignal.timeout(1500),redirect:'manual'}); await response.body?.cancel(); return response.status < 500; } catch { return false; }
}
async function status() {
  if (preview.status === 'starting' || preview.status === 'ready') {
    const generation = previewGeneration;
    const ready = await probe(preview.port);
    if (generation === previewGeneration && ['starting','ready'].includes(preview.status)) preview.status = ready ? 'ready' : 'starting';
  }
  if (desktop.status === 'starting' || desktop.status === 'ready') desktop.status = await probe(6081) ? 'ready' : 'starting';
  return {kind:'services',preview:{...preview},desktop:{...desktop}};
}
function defaultCommand() {
  return existsSync(directory + '/index.html') ? staticCommand : '';
}
if (!preview.command) preview.command = defaultCommand();
let previewGeneration = 0;
function savePreview() {
  writeFileSync(configFile + '.tmp',JSON.stringify({command:preview.command,port:preview.port,title:preview.title}),{mode:0o600});
  renameSync(configFile + '.tmp',configFile);
}

async function previewStart(command, port, title) {
  if (title !== undefined && (typeof title !== 'string' || !title.trim() || title.length > 100)) throw new Error('Choose a short preview title.');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || reserved.has(port)) throw new Error('Choose an application port, such as 3000 or 5173.');
  if (preview.status === 'starting' || preview.status === 'ready') {
    if (preview.command === command && preview.port === port) {
      if (title && title !== preview.title) { preview.title = title; savePreview(); }
      return;
    }
    throw new Error('Stop the preview before changing its command.');
  }
  if (typeof command !== 'string' || !command.trim()) throw new Error('No development command was detected. Ask the agent to start your app or configure Preview settings.');
  const generation = ++previewGeneration;
  preview.command = command;
  preview.port = port;
  preview.title = title || preview.title;
  if (preview.status === 'failed') recordLog(preview, '\n--- Retrying preview ---\n');
  else preview.log = '';
  preview.status = 'starting';
  savePreview();
  const running = await probe(port);
  if (generation !== previewGeneration) return;
  if (running) { preview.status = 'ready'; preview.managed = false; preview.log = 'Connected to the server already running on port ' + port + '.'; return; }
  preview.managed = true;
  launch('preview','sh',['-lc',command],preview);
}
function desktopStart() {
  if (desktop.status === 'ready' || desktop.status === 'starting') return;
  for (const name of ['desktop']) stop(name);
  desktop.status = 'starting';
  browserStarted = true;
  desktop.log = '';
  launch('desktop','dbus-run-session',['--','bash','-c',[
    'set -e',
    'command -v Xvfb >/dev/null || { echo "Desktop packages are missing. Stop and resume this workspace to update it."; exit 1; }',
    'export DISPLAY=:99',
    'Xvfb :99 -screen 0 1440x900x24 -ac -nolisten tcp &',
    'for i in $(seq 1 50); do xdpyinfo -display :99 >/dev/null 2>&1 && break; sleep 0.1; done',
    'xfce4-session &',
    'xsetroot -solid "#f5f5f7"',
    'x11vnc -display :99 -forever -shared -nopw -listen 127.0.0.1 -rfbport 5900 -xkb &',
    'chromium ' + browserArguments.map(value => "'" + value.replaceAll("'", "'\"'\"'") + "'").join(' ') + ' &',
    'exec websockify --web=/usr/share/novnc 127.0.0.1:6081 127.0.0.1:5900',
  ].join('\n')],desktop);
}
const bootstrap = '<!doctype html><meta charset="utf-8"><title>Opening workspace</title><style>body{font:14px system-ui;color:#777;display:grid;place-items:center;height:90vh}</style><p id="status">Connecting to your workspace…</p><script>const token=location.hash.slice(1);history.replaceState(null,"",location.pathname);fetch("/__sparkles_session",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})}).then(r=>{if(!r.ok)throw Error();return r.json()}).then(data=>location.replace(data.path)).catch(()=>{document.getElementById("status").textContent="This connection expired. Reconnect from the task."})</script>';
const desktopPage = '<!doctype html><meta charset="utf-8"><title>Workspace desktop</title><style>html,body,#screen{margin:0;width:100%;height:100%;overflow:hidden;background:#f5f5f7}#status{position:fixed;top:12px;left:12px;font:13px system-ui;color:#777;background:#fff;padding:8px;border-radius:6px}</style><div id="screen"></div><div id="status">Connecting…</div><script type="module">import RFB from "/core/rfb.js";const status=document.getElementById("status");const rfb=new RFB(document.getElementById("screen"),(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host+"/websockify");rfb.scaleViewport=true;rfb.resizeSession=true;rfb.addEventListener("connect",()=>status.hidden=true);rfb.addEventListener("disconnect",()=>{status.hidden=false;status.textContent="Desktop disconnected. Use Reconnect to continue."});window.addEventListener("beforeunload",()=>rfb.disconnect());</script>';
function html(response, body, code = 200) {
  response.writeHead(code,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'});
  response.end(body);
}
async function jsonBody(request) {
  let body = '';
  for await (const chunk of request) { body += chunk; if (body.length > 10000) throw new Error('Request too large'); }
  return JSON.parse(body);
}
function session(request, service) {
  const cookie = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('__Host-sparkles-view='));
  if (!cookie) return null;
  const grant = sessions.get(digest(cookie.slice('__Host-sparkles-view='.length)));
  return grant && grant.service === service && grant.expiresAt > Date.now() ? grant : null;
}
function allowedOrigin(request, grant) {
  return !request.headers.origin || request.headers.origin === 'https://' + request.headers.host || request.headers.origin === grant.parentOrigin;
}
function upstreamOptions(request, target) {
  const headers = {...request.headers,host:'127.0.0.1:' + target};
  delete headers.authorization;
  delete headers['x-verified-user-data'];
  delete headers['x-forwarded-host'];
  headers['x-forwarded-proto'] = 'https';
  headers.cookie = (headers.cookie || '').split(';').filter(value => !value.trim().startsWith('__Host-sparkles-view=')).join(';');
  return {hostname:'127.0.0.1',port:target,path:request.url,method:request.method,headers};
}
function serve(service, port) {
  const server = createServer(async (request,response) => {
    let pathname;
    try {
      if (!request.url.startsWith('/') || request.url.startsWith('//') || request.url.includes('\\')) throw new Error();
      pathname = new URL(request.url,'http://localhost').pathname;
    } catch { return html(response,'Invalid request URL.',400); }
    if (pathname === '/__sparkles_connect') return html(response,bootstrap);
    if (pathname === '/__sparkles_session' && request.method === 'POST') {
      try {
        const {token} = await jsonBody(request);
        if (typeof token !== 'string') throw new Error();
        const key = digest(token);
        const grant = tickets.get(key);
        tickets.delete(key);
        if (!grant || grant.service !== service || grant.expiresAt <= Date.now() || !allowedOrigin(request,grant)) throw new Error();
        const sessionToken = randomBytes(32).toString('hex');
        sessions.set(digest(sessionToken),grant);
        response.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store','Set-Cookie':'__Host-sparkles-view=' + sessionToken + '; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=' + Math.floor((grant.expiresAt-Date.now())/1000)});
        return response.end(JSON.stringify({path:grant.path}));
      } catch { return html(response,'Connection expired. Reconnect from your task.',403); }
    }
    const grant = session(request,service);
    if (!grant || !allowedOrigin(request,grant)) return html(response,'Connection expired. Reconnect from your task.',403);
    response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Cache-Control','no-store');
    if (service === 'desktop' && pathname === '/') return html(response,desktopPage);
    const target = service === 'preview' ? preview.port : 6081;
    const proxy = httpRequest(upstreamOptions(request,target), incoming => {
      const headers = {...incoming.headers};
      delete headers['x-frame-options'];
      if (headers.location) {
        try {
          const location = new URL(headers.location,'http://127.0.0.1:' + target);
          if (['localhost','127.0.0.1','0.0.0.0'].includes(location.hostname)) headers.location = location.pathname + location.search + location.hash;
        } catch { incoming.destroy(); return html(response,'Invalid development server redirect.',502); }
      }
      headers['cache-control'] = 'no-store';
      headers['referrer-policy'] = 'no-referrer';
      headers['content-security-policy'] = (headers['content-security-policy'] || '').split(';').filter(rule => rule.trim() && !rule.trim().startsWith('frame-ancestors')).concat('frame-ancestors ' + grant.parentOrigin).join('; ');
      response.writeHead(incoming.statusCode || 502,headers);
      incoming.pipe(response);
    });
    proxy.on('error',() => { if (!response.headersSent) html(response,'The development server is not ready. Check its logs in the Preview tab.',503); else response.destroy(); });
    response.on('close',() => proxy.destroy());
    request.pipe(proxy);
  });
  server.on('upgrade',(request,socket,head) => {
    const grant = session(request,service);
    if (!grant || !allowedOrigin(request,grant)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const proxy = httpRequest(upstreamOptions(request,service === 'preview' ? preview.port : 6081));
    proxy.on('upgrade',(response,upstream,upstreamHead) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' + response.rawHeaders.reduce((all,value,index,array) => index % 2 ? all : all + value + ': ' + array[index+1] + '\r\n','') + '\r\n');
      if (head.length) upstream.write(head);
      if (upstreamHead.length) socket.write(upstreamHead);
      socket.pipe(upstream).pipe(socket);
      connections.set(socket,service);
      const timer = setTimeout(() => socket.destroy(),Math.max(1,grant.expiresAt-Date.now()));
      const close = () => { clearTimeout(timer); connections.delete(socket); upstream.destroy(); socket.destroy(); };
      socket.on('error',close); socket.on('close',close); upstream.on('error',close); upstream.on('close',close);
    });
    proxy.on('response',() => socket.destroy());
    proxy.on('error',() => socket.destroy());
    proxy.end();
  });
  server.listen(port,'0.0.0.0');
}
serve('preview',previewGatewayPort);
serve('desktop',desktopGatewayPort);

createServer(async (request,response) => {
  try {
    const command = await jsonBody(request);
    if (command.kind === 'preview-start') await previewStart(command.command,command.port,command.title);
    else if (command.kind === 'preview-stop') { previewGeneration++; preview.status = 'stopped'; revoke('preview'); stop('preview'); }
    else if (command.kind === 'desktop-start') desktopStart();
    else if (command.kind === 'browser-quiesce') {
      await beginBrowserOperation();
      const pids = await freezeBrowser();
      if (pids.length) browserStarted = true;
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end(JSON.stringify({operation:'browser-quiesced',version:1,pids,started:browserStarted}));
      return;
    } else if (command.kind === 'browser-release') {
      signalBrowser('SIGCONT');
      endBrowserOperation();
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end(JSON.stringify({operation:'browser-released',version:1}));
      return;
    } else if (command.kind === 'browser-replace-release') {
      signalBrowser('SIGKILL');
      await new Promise(resolve => setTimeout(resolve,250));
      if (desktop.status === 'ready' || desktop.status === 'starting') launchBrowser();
      endBrowserOperation();
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end(JSON.stringify({operation:'browser-replaced',version:1}));
      return;
    } else if (command.kind === 'browser-reset') {
      await resetBrowser();
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end(JSON.stringify({operation:'browser-reset',version:1}));
      return;
    }
    else if (command.kind === 'revoke') {
      revoke();
    } else if (command.kind === 'connect') {
      const ready = await status();
      if (!['preview','desktop'].includes(command.service) || ready[command.service].status !== 'ready') throw new Error('The service is not ready.');
      const token = randomBytes(32).toString('hex');
      const expiresAt = Math.min(command.expiresAt,Date.now()+15*60*1000);
      const parentOrigin = new URL(command.parentOrigin).origin;
      const path = command.service === 'preview' ? command.path || '/' : '/';
      if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || /[\r\n]/.test(path)) throw new Error('Enter a relative preview path.');
      tickets.set(digest(token),{service:command.service,expiresAt,parentOrigin,path});
      response.writeHead(200,{'Content-Type':'application/json'});
      response.end(JSON.stringify({token,expiresAt}));
      return;
    }
    response.writeHead(200,{'Content-Type':'application/json'});
    response.end(JSON.stringify(await status()));
  } catch (error) {
    response.writeHead(400,{'Content-Type':'application/json'});
    response.end(JSON.stringify({error:error.message}));
  }
}).listen(controlPort,'127.0.0.1');
setInterval(() => {
  for (const store of [tickets,sessions]) for (const [key,value] of store) if (value.expiresAt <= Date.now()) store.delete(key);
},60000).unref();
`;
