// Checkpoints contain workspace files and consistent SQLite backups, never provider credentials.
export const createCheckpointScript = String.raw`
import os, sys, json, sqlite3, pathlib, tempfile, shutil, tarfile, hashlib, time, subprocess
request = json.load(sys.stdin)
root = pathlib.Path(os.environ.get('SPARKLES_WORKSPACE_ROOT', '/workspace'))
state_root = root / '.sparkles'
runner = json.loads((state_root / 'runner-state.json').read_text())
if runner.get('status') != 'checkpointing' or runner.get('sessionId') != request['sessionId']:
    raise RuntimeError('Agent checkpoint lease is not held')
staging = pathlib.Path(tempfile.mkdtemp(prefix='sparkles-checkpoint-'))
archive = pathlib.Path('/tmp/sparkles-checkpoint-' + request['id'] + '.tar.gz')
try:
    source = state_root / 'data' / 'opencode'
    target = staging / 'agent'
    target.mkdir()
    copied_bytes = 0
    copied_files = 0
    if source.exists():
        for directory, dirs, files in os.walk(source, followlinks=False):
            dirs[:] = [d for d in dirs if d not in ('log', 'logs', 'cache') and not pathlib.Path(directory, d).is_symlink()]
            for name in files:
                origin = pathlib.Path(directory, name)
                if origin.is_symlink() or name == 'auth.json' or name.endswith(('-wal', '-shm', '.lock')):
                    continue
                copied_bytes += origin.stat().st_size
                copied_files += 1
                if copied_bytes > 2 * 1024 * 1024 * 1024 or copied_files > 200000:
                    raise RuntimeError('Agent data exceeds checkpoint limits')
                destination = target / origin.relative_to(source)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if name.endswith(('.db', '.sqlite', '.sqlite3')):
                    with sqlite3.connect('file:' + str(origin) + '?mode=ro', uri=True) as database:
                        with sqlite3.connect(destination) as backup:
                            database.backup(backup)
                else:
                    shutil.copy2(origin, destination)
    # Preserve tracked dependency files as well; only untracked dependency directories are omitted.
    tracked = subprocess.run(['git', '-C', str(root / 'repo'), 'ls-files', '-z'], capture_output=True, check=True).stdout.decode('utf8').split('\0')
    tracked_paths = set()
    for name in tracked:
        path = pathlib.PurePosixPath('repo') / name
        tracked_paths.add(str(path))
        tracked_paths.update(str(parent) for parent in path.parents)
    # All other repository content, including .git and uncommitted/untracked files, is retained.
    archive_bytes = sum(item.stat().st_size for item in target.rglob('*') if item.is_file())
    archive_entries = copied_files
    def repo_filter(info):
        global archive_bytes, archive_entries
        if 'node_modules' in pathlib.PurePosixPath(info.name).parts and info.name not in tracked_paths:
            return None
        if info.issym():
            origin = root / info.name
            try:
                if pathlib.Path(info.linkname).is_absolute(): raise ValueError()
                origin.resolve().relative_to((root / 'repo').resolve())
            except (ValueError, RuntimeError):
                raise RuntimeError('Unsafe checkpoint link')
        if info.islnk():
            info.type = tarfile.REGTYPE
            info.linkname = ''
            info.size = (root / info.name).stat().st_size
        if not (info.isfile() or info.isdir() or info.issym()):
            return None
        archive_bytes += info.size
        archive_entries += 1
        if archive_bytes > 2 * 1024 * 1024 * 1024 or archive_entries > 200000:
            raise RuntimeError('Repository exceeds checkpoint limits')
        return info
    saved = dict(runner)
    saved['status'] = 'failed' if request['interrupted'] else 'idle'
    (staging / 'runner-state.json').write_text(json.dumps(saved))
    manifest = {'id': request['id'], 'sessionId': request['sessionId'], 'cursor': request['cursor'], 'createdAt': int(time.time() * 1000), 'interrupted': request['interrupted']}
    (staging / 'manifest.json').write_text(json.dumps(manifest))
    for metadata_file in (staging / 'runner-state.json', staging / 'manifest.json', root / 'checkout.json'):
        if metadata_file.is_symlink() or not metadata_file.is_file() or metadata_file.stat().st_size > 16 * 1024 * 1024:
            raise RuntimeError('Unsafe checkpoint metadata')
        archive_bytes += metadata_file.stat().st_size
    if archive_bytes > 2 * 1024 * 1024 * 1024:
        raise RuntimeError('Agent data exceeds checkpoint limits')
    with tarfile.open(archive, 'w:gz', compresslevel=3, dereference=False) as tar:
        tar.add(root / 'repo', arcname='repo', filter=repo_filter)
        tar.add(target, arcname='agent')
        tar.add(staging / 'runner-state.json', arcname='runner-state.json')
        tar.add(staging / 'manifest.json', arcname='manifest.json')
        tar.add(root / 'checkout.json', arcname='checkout.json')
    size = archive.stat().st_size
    if size > 512 * 1024 * 1024:
        raise RuntimeError('Checkpoint exceeds the 512 MiB archive limit')
    digest = hashlib.sha256()
    with archive.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    print(json.dumps(dict(manifest, size=size, sha256=digest.hexdigest())))
except:
    archive.unlink(missing_ok=True)
    raise
finally:
    shutil.rmtree(staging)
`;

export const restoreCheckpointScript = String.raw`
import os, sys, json, pathlib, tempfile, tarfile, hashlib, shutil
request = json.loads(sys.argv[1])
checkpoint = request['checkpoint']
root = pathlib.Path(os.environ.get('SPARKLES_WORKSPACE_ROOT', '/workspace'))
root.mkdir(exist_ok=True)
marker = root / 'restored-checkpoint.json'
archive = pathlib.Path('/tmp/sparkles-restore-' + checkpoint['id'] + '.tar.gz')
staging = pathlib.Path(tempfile.mkdtemp(prefix='.restore-', dir=root))
try:
    size = 0
    digest = hashlib.sha256()
    with archive.open('wb') as stream:
        while True:
            chunk = sys.stdin.buffer.read(1024 * 1024)
            if not chunk: break
            size += len(chunk)
            if size > checkpoint['size'] or size > 512 * 1024 * 1024:
                raise RuntimeError('Checkpoint size mismatch')
            digest.update(chunk)
            stream.write(chunk)
    if size != checkpoint['size'] or digest.hexdigest() != checkpoint['sha256']:
        raise RuntimeError('Checkpoint integrity check failed')
    if marker.exists():
        restored = json.loads(marker.read_text())
        if restored['id'] != checkpoint['id'] or restored['sha256'] != checkpoint['sha256']:
            raise RuntimeError('A different checkpoint is already restored')
        print(json.dumps({'restored': True}))
        sys.exit(0)
    if (root / 'repo').exists() or (root / '.sparkles').exists():
        raise RuntimeError('Refusing to overwrite an existing workspace')
    # Stream entries so declared sizes and entry counts are rejected before
    # decompression/extraction, rather than materializing an unbounded member list.
    links = []
    with tarfile.open(archive, 'r|gz') as tar:
        total = 0
        count = 0
        for item in tar:
            count += 1
            if count > 200000: raise RuntimeError('Too many checkpoint entries')
            path = pathlib.PurePosixPath(item.name)
            if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] not in ('repo', 'agent', 'runner-state.json', 'manifest.json', 'checkout.json'):
                raise RuntimeError('Unsafe checkpoint path')
            if len(item.name) > 4096 or len(item.linkname) > 4096:
                raise RuntimeError('Checkpoint path is too long')
            if not (item.isfile() or item.isdir() or item.issym()):
                raise RuntimeError('Unsafe checkpoint entry')
            if path.parts[0] in ('runner-state.json', 'manifest.json', 'checkout.json'):
                if len(path.parts) != 1 or not item.isfile() or item.size > 16 * 1024 * 1024:
                    raise RuntimeError('Unsafe checkpoint metadata')
            total += item.size
            if total > 2 * 1024 * 1024 * 1024: raise RuntimeError('Expanded checkpoint exceeds 2 GiB')
            destination = staging / item.name
            if item.issym():
                link = pathlib.Path(item.linkname)
                if link.is_absolute(): raise RuntimeError('Unsafe checkpoint link')
                try: (destination.parent / link).resolve().relative_to(staging.resolve())
                except (ValueError, RuntimeError): raise RuntimeError('Unsafe checkpoint link')
                links.append((destination, item.linkname))
                continue
            destination.parent.mkdir(parents=True, exist_ok=True)
            if item.isdir():
                destination.mkdir(exist_ok=True)
            else:
                with tar.extractfile(item) as source, destination.open('xb') as output:
                    shutil.copyfileobj(source, output)
                destination.chmod(item.mode & 0o777)
    # Install links last: no archive link can redirect a regular file write.
    for destination, linkname in links:
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            destination.parent.resolve().relative_to(staging.resolve())
            (destination.parent / linkname).resolve().relative_to(staging.resolve())
        except (ValueError, RuntimeError): raise RuntimeError('Unsafe checkpoint link')
        destination.symlink_to(linkname)
    manifest = json.loads((staging / 'manifest.json').read_text())
    if manifest['id'] != checkpoint['id'] or manifest['sessionId'] != checkpoint['sessionId'] or manifest['cursor'] != checkpoint['cursor']:
        raise RuntimeError('Checkpoint manifest mismatch')
    state = json.loads((staging / 'runner-state.json').read_text())
    if state['sessionId'] != checkpoint['sessionId']: raise RuntimeError('Session mismatch')
    state['sequence'] = max(state.get('sequence', 0), request['cursor'])
    state['acknowledged'] = request['cursor']
    state_root = root / '.sparkles'
    (state_root / 'data').mkdir(parents=True, mode=0o700)
    os.rename(staging / 'agent', state_root / 'data' / 'opencode')
    (state_root / 'runner-state.json').write_text(json.dumps(state))
    os.chmod(state_root / 'runner-state.json', 0o600)
    os.rename(staging / 'repo', root / 'repo')
    os.rename(staging / 'checkout.json', root / 'checkout.json')
    marker.write_text(json.dumps({'id': checkpoint['id'], 'sha256': checkpoint['sha256']}))
    print(json.dumps({'restored': True}))
finally:
    archive.unlink(missing_ok=True)
    shutil.rmtree(staging)
`;
