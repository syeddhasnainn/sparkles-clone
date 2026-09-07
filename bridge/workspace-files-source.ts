export const workspaceFilesSource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = fs.realpathSync(process.env.SPARKLES_WORKSPACE_DIR || '/workspace/repo');
const limit = 512 * 1024;
const blocked = name => name.split('/').some(part => ['.git', '.sparkles', 'node_modules'].includes(part) || /^\.env(?:\.|$)/.test(part) || /\.(?:pem|key)$/.test(part));
function safe(name) {
  if (!name || path.isAbsolute(name) || name.includes('\0') || name.split('/').some(part => part === '..' || part === '.') || blocked(name)) throw new Error('File is not available');
  const resolved = path.resolve(root, name);
  if (!resolved.startsWith(root + path.sep)) throw new Error('File is outside the repository');
  let existing = resolved;
  while (!fs.existsSync(existing) && existing !== root) existing = path.dirname(existing);
  const real = fs.realpathSync(existing);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error('File is outside the repository');
  if (blocked(path.relative(root, real))) throw new Error('File is not available');
  return resolved;
}
function git(args, maxBuffer = 8 * 1024 * 1024) {
  return execFileSync('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.quotePath=false', ...args], {
    cwd: root, maxBuffer, timeout: 15000, env: {...process.env, GIT_OPTIONAL_LOCKS: '0'}, stdio: ['ignore', 'pipe', 'pipe'],
  });
}
function readRepositoryFile({ name, full }, base) {
  let before = null;
  let after = null;
  let tooLarge = false;
  try {
    const size = Number(git(['cat-file', '-s', base + ':' + name]).toString());
    if (size > limit) tooLarge = true;
    else before = git(['show', base + ':' + name], limit + 1024);
  } catch (error) { if (error.code === 'ENOBUFS') tooLarge = true; }
  if (fs.existsSync(full)) {
    const stat = fs.lstatSync(full);
    if (!stat.isFile()) throw new Error('Only regular files can be viewed');
    if (stat.size > limit) tooLarge = true;
    else after = fs.readFileSync(full);
  }
  const binary = [before, after].some(value => value && value.includes(0));
  const imageTypes = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.avif':'image/avif'};
  const mime = imageTypes[path.extname(name).toLowerCase()];
  return {kind:'file',path:name,before:binary ? null : before?.toString('utf8') ?? null,after:binary ? null : after?.toString('utf8') ?? null,binary,image:mime && after ? 'data:' + mime + ';base64,' + after.toString('base64') : null,tooLarge};
}
function listFiles(command, base) {
  const changes = new Map();
  const names = git(['diff','--no-ext-diff','--no-textconv','--no-renames','--name-status','-z',base,'--']).toString().split('\0');
  for (let i = 0; i + 1 < names.length; i += 2) changes.set(names[i + 1], {status:names[i] === 'A' ? 'added' : names[i] === 'D' ? 'deleted' : 'modified',additions:0,deletions:0});
  const stats = git(['diff','--no-ext-diff','--no-textconv','--no-renames','--numstat','-z',base,'--']).toString().split('\0');
  for (const entry of stats) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]+)$/.exec(entry);
    if (match && changes.has(match[3])) Object.assign(changes.get(match[3]), {additions:match[1] === '-' ? null : Number(match[1]),deletions:match[2] === '-' ? null : Number(match[2])});
  }
  const untracked = git(['ls-files','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean);
  for (const name of untracked) changes.set(name, {status:'added',additions:null,deletions:0});
  const namesToShow = command.scope === 'all' ? new Set([...git(['ls-files','-z']).toString().split('\0'),...untracked]) : changes.keys();
  const files = [];
  let truncated = false;
  for (const name of [...namesToShow].filter(Boolean).sort()) {
    try { safe(name); } catch { continue; }
    if (files.length >= 2000) { truncated = true; break; }
    files.push({path:name,...(changes.get(name) || {status:'unchanged',additions:0,deletions:0})});
  }
  return {kind:'files',files,truncated};
}
let input = '';
process.stdin.on('data', chunk => { input += chunk; if (input.length > 10000) process.exit(1); });
process.stdin.on('end', () => {
  try {
    const request = JSON.parse(input);
    const base = request.command.base === 'head' ? 'HEAD' : request.commit;
    if (base !== 'HEAD' && !/^[a-f0-9]{40,64}$/.test(base || '')) throw new Error('Task base is unavailable');
    git(['rev-parse','--verify',base + '^{commit}']);
    const command = request.command;
    const file = command.kind === 'file' ? { name: command.path, full: safe(command.path) } : null;
    const result = file ? readRepositoryFile(file, base) : listFiles(command, base);
    process.stdout.write(JSON.stringify(result));
  } catch { process.stderr.write('Could not read repository files.'); process.exitCode = 1; }
});
`;
