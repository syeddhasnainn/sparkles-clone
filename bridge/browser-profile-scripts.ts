import {
  browserProfileDirectory,
  maximumBrowserProfileBytes,
  maximumExpandedBrowserProfileBytes,
} from "./contracts.ts";

export const captureBrowserProfileScript = String.raw`
import gzip
import hashlib
import json
import os
import pathlib
import shutil
import sys
import tarfile
import time

request = json.loads(sys.stdin.read())
profile = pathlib.Path(${JSON.stringify(browserProfileDirectory)})
archive = pathlib.Path('/tmp/sparkles-browser-profile-' + request['id'] + '.tar.gz')
excluded_names = {
    'cache', 'code cache', 'gpucache', 'shadercache', 'grshadercache',
    'dawncache', 'crashpad', 'browsermetrics', 'optimizationguidepredictionmodels'
}

def included(path):
    relative = path.relative_to(profile)
    root = relative.parts[0] if relative.parts else ''
    if root != 'Local State' and root != 'Default' and not root.startswith('Profile '): return False
    if any(part.lower() in excluded_names for part in relative.parts): return False
    if path.name.startswith('Singleton') or path.name in {'LOCK', 'lockfile'}: return False
    return True

if not profile.exists():
    print(json.dumps({'present': False}))
    raise SystemExit(0)
if profile.is_symlink() or not profile.is_dir():
    raise RuntimeError('Browser profile path is unsafe')

expanded = 0
entries = []
for root, directories, files in os.walk(profile, followlinks=False):
    root_path = pathlib.Path(root)
    directories[:] = [name for name in directories if included(root_path / name)]
    for name in directories + files:
        path = root_path / name
        if not included(path): continue
        stat = path.lstat()
        if path.is_symlink() or not (path.is_dir() or path.is_file()):
            continue
        if len(entries) >= 100000:
            raise RuntimeError('Browser profile contains too many entries')
        if path.is_file():
            expanded += stat.st_size
            if expanded > ${maximumExpandedBrowserProfileBytes}:
                raise RuntimeError('Browser profile exceeds the expanded size limit')
        entries.append(path)

if not entries:
    print(json.dumps({'present': False}))
    raise SystemExit(0)

try:
    with tarfile.open(archive, 'w:gz', compresslevel=6) as output:
        for path in entries:
            output.add(path, arcname='profile/' + path.relative_to(profile).as_posix(), recursive=False)
    size = archive.stat().st_size
    if size <= 0 or size > ${maximumBrowserProfileBytes}:
        raise RuntimeError('Browser profile exceeds the archive size limit')
    checksum = hashlib.sha256()
    with archive.open('rb') as source:
        while chunk := source.read(1024 * 1024): checksum.update(chunk)
    print(json.dumps({
        'present': True,
        'metadata': {
            'id': request['id'],
            'createdAt': int(time.time() * 1000),
            'size': size,
            'sha256': checksum.hexdigest(),
        },
    }))
except BaseException:
    archive.unlink(missing_ok=True)
    raise
`;

export const restoreBrowserProfileScript = String.raw`
import hashlib
import json
import pathlib
import shutil
import sys
import tarfile

request = json.loads(sys.argv[1])
metadata = request['profile']
profile = pathlib.Path(${JSON.stringify(browserProfileDirectory)})
archive = pathlib.Path('/tmp/sparkles-browser-profile-restore-' + metadata['id'] + '.tar.gz')
staging = profile.with_name(profile.name + '-restore-' + metadata['id'])
backup = profile.with_name(profile.name + '-previous-' + metadata['id'])

try:
    received = 0
    digest = hashlib.sha256()
    with archive.open('wb') as output:
        while True:
            chunk = sys.stdin.buffer.read(1024 * 1024)
            if not chunk: break
            received += len(chunk)
            if received > metadata['size'] or received > ${maximumBrowserProfileBytes}:
                raise RuntimeError('Browser profile transfer exceeds its expected size')
            digest.update(chunk)
            output.write(chunk)
    if received != metadata['size'] or digest.hexdigest() != metadata['sha256']:
        raise RuntimeError('Browser profile transfer is incomplete')

    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir(mode=0o700)
    expanded = 0
    count = 0
    with tarfile.open(archive, 'r:gz') as source:
        for member in source:
            count += 1
            if count > 100000: raise RuntimeError('Browser profile contains too many entries')
            path = pathlib.PurePosixPath(member.name)
            if path.is_absolute() or not path.parts or path.parts[0] != 'profile' or '..' in path.parts:
                raise RuntimeError('Browser profile contains an unsafe path')
            if not (member.isdir() or member.isreg()):
                raise RuntimeError('Browser profile contains an unsupported entry')
            if member.isreg():
                expanded += member.size
                if expanded > ${maximumExpandedBrowserProfileBytes}:
                    raise RuntimeError('Browser profile exceeds the expanded size limit')
            target = staging.joinpath(*path.parts[1:])
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
            else:
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                extracted = source.extractfile(member)
                if extracted is None: raise RuntimeError('Browser profile entry is unreadable')
                with target.open('wb') as output:
                    shutil.copyfileobj(extracted, output, 1024 * 1024)
                target.chmod(member.mode & 0o700 or 0o600)

    shutil.rmtree(backup, ignore_errors=True)
    if profile.is_symlink(): raise RuntimeError('Browser profile path is unsafe')
    if profile.exists(): profile.rename(backup)
    try:
        staging.rename(profile)
    except BaseException:
        if backup.exists() and not profile.exists(): backup.rename(profile)
        raise
    shutil.rmtree(backup, ignore_errors=True)
    print(json.dumps({'restored': True}))
finally:
    archive.unlink(missing_ok=True)
    shutil.rmtree(staging, ignore_errors=True)
`;

export const resetLegacyBrowserProfileScript = String.raw`
import os
import pathlib
import shutil
import signal
import time

profiles = {${JSON.stringify(browserProfileDirectory)}, '/tmp/sparkles-chromium'}
processes = []
for entry in pathlib.Path('/proc').iterdir():
    if not entry.name.isdigit(): continue
    try:
        argv = (entry / 'cmdline').read_bytes().split(b'\0')
        stat = (entry / 'stat').read_text()
        parent = int(stat[stat.rfind(')') + 2:].split()[1])
        processes.append((int(entry.name), parent, argv))
    except (OSError, ValueError):
        pass

selected = {
    pid for pid, _, argv in processes
    if argv and b'chromium' in argv[0] and any(
        value == ('--user-data-dir=' + profile).encode() for value in argv for profile in profiles
    )
}
changed = True
while changed:
    changed = False
    for pid, parent, _ in processes:
        if parent in selected and pid not in selected:
            selected.add(pid)
            changed = True

for kind in (signal.SIGTERM, signal.SIGKILL):
    for pid in selected:
        try: os.kill(pid, kind)
        except ProcessLookupError: pass
    time.sleep(0.5)
for profile in profiles: shutil.rmtree(profile, ignore_errors=True)
print('{"operation":"browser-reset","version":1}')
`;
