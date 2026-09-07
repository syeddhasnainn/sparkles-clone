import { browserProfileDirectory } from "./contracts.ts";

export const computerMcpSource = String.raw`
import base64
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import struct
import subprocess
import sys
import time
import urllib.request
import uuid

DISPLAY = ':99'
WORKSPACE = Path(os.environ.get('SPARKLES_WORKSPACE_DIR', '/workspace/repo'))
STATE = Path(os.environ.get('SPARKLES_STATE_DIR', '/workspace/.sparkles'))
CONTROL_URL = 'http://127.0.0.1:' + os.environ.get('SPARKLES_VIEWS_CONTROL_PORT', '4098')
BROWSER_PROFILE = ${JSON.stringify(browserProfileDirectory)}
BROWSER_OPERATION = Path('/tmp/sparkles-browser-operation')
BROWSER_READERS = Path('/tmp/sparkles-browser-readers')
ENV = {key: os.environ[key] for key in ('PATH', 'HOME', 'LANG') if key in os.environ}
ENV.update(DISPLAY=DISPLAY, TERM='xterm-256color')


def tool(name, description, properties=None, required=None, read_only=False):
    return {
        'name': name,
        'description': description,
        'inputSchema': {'type': 'object', 'properties': properties or {}, 'required': required or [], 'additionalProperties': False},
        'annotations': {'readOnlyHint': read_only, 'destructiveHint': not read_only, 'openWorldHint': True},
    }


coordinate = {'type': 'integer', 'minimum': 0}
TOOLS = [
    tool('computer_screenshot', 'Capture the same desktop visible in the user Desktop tab. Returns a PNG image and its saved path. Coordinates use the returned image dimensions.', read_only=True),
    tool('computer_click', 'Click a point observed in a recent screenshot.', {'x': coordinate, 'y': coordinate, 'button': {'type': 'string', 'enum': ['left', 'middle', 'right']}, 'clicks': {'type': 'integer', 'minimum': 1, 'maximum': 2}}, ['x', 'y']),
    tool('computer_type', 'Type literal text into the focused field. Click the field first.', {'text': {'type': 'string', 'maxLength': 20000}}, ['text']),
    tool('computer_key', 'Press an X11 key or combination, for example Return, Tab, Escape, ctrl+l, ctrl+a, alt+F4, or shift+Tab.', {'key': {'type': 'string', 'maxLength': 100}}, ['key']),
    tool('computer_scroll', 'Scroll at the current pointer or at an observed point.', {'direction': {'type': 'string', 'enum': ['up', 'down', 'left', 'right']}, 'amount': {'type': 'integer', 'minimum': 1, 'maximum': 30}, 'x': coordinate, 'y': coordinate}, ['direction']),
    tool('computer_open', 'Open an application on the shared desktop. Browser URLs must use HTTP or HTTPS.', {'app': {'type': 'string', 'enum': ['browser', 'terminal', 'files']}, 'url': {'type': 'string', 'maxLength': 8000}}, ['app']),
]


@contextmanager
def browser_access():
    BROWSER_READERS.mkdir(mode=0o700, parents=True, exist_ok=True)
    for _ in range(200):
        if BROWSER_OPERATION.exists():
            time.sleep(0.05)
            continue
        start = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()[19]
        marker = BROWSER_READERS / (str(os.getpid()) + '-' + start + '-' + str(uuid.uuid4()))
        marker.touch(mode=0o600, exist_ok=False)
        if not BROWSER_OPERATION.exists():
            try:
                yield
            finally:
                marker.unlink(missing_ok=True)
            return
        marker.unlink(missing_ok=True)
        time.sleep(0.05)
    raise ValueError('The cloud browser is being updated. Retry shortly.')


def run(args, input=None):
    result = subprocess.run(args, input=input, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=ENV, cwd=WORKSPACE, timeout=20)
    if result.returncode:
        raise ValueError('Desktop command failed: ' + result.stderr.decode(errors='replace')[-1500:])
    return result.stdout


def services(kind):
    request = urllib.request.Request(CONTROL_URL, data=json.dumps({'kind': kind}).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=5) as response:
        result = json.load(response)
    if result.get('error'):
        raise ValueError(result['error'])
    return result


def ensure_desktop():
    services('desktop-start')
    for _ in range(100):
        desktop = services('services').get('desktop', {})
        if desktop.get('status') == 'ready':
            return
        if desktop.get('status') == 'failed':
            raise ValueError('Desktop failed to start. Inspect the Desktop tab diagnostics.')
        time.sleep(0.2)
    raise ValueError('Desktop is still starting. Retry the screenshot shortly.')


def validate(name, args):
    schema = next((item['inputSchema'] for item in TOOLS if item['name'] == name), None)
    if schema is None:
        raise ValueError('Unknown computer tool')
    if not isinstance(args, dict) or set(args) - set(schema['properties']) or set(schema['required']) - set(args):
        raise ValueError('Invalid or missing tool arguments')
    for key, value in args.items():
        spec = schema['properties'][key]
        if spec['type'] == 'integer':
            if type(value) is not int or value < spec.get('minimum', 0) or value > spec.get('maximum', 100000):
                raise ValueError('Invalid ' + key)
        elif not isinstance(value, str) or len(value) > spec.get('maxLength', 100) or '\x00' in value:
            raise ValueError('Invalid ' + key)
        if 'enum' in spec and value not in spec['enum']:
            raise ValueError('Invalid ' + key)
    if ('x' in args) != ('y' in args):
        raise ValueError('Provide both x and y coordinates')
    if name == 'computer_key' and not re.fullmatch(r'(?:[A-Za-z0-9_]+\+)*[A-Za-z0-9_]+', args['key']):
        raise ValueError('Use an X11 key name or combination such as ctrl+l')
    if name == 'computer_open' and 'url' in args:
        if args['app'] != 'browser' or not re.match(r'^https?://[^\s]+$', args['url']):
            raise ValueError('Only browser HTTP or HTTPS URLs are supported')


def move(args):
    if 'x' not in args:
        return
    output = run(['xdpyinfo', '-display', DISPLAY]).decode()
    dimensions = re.search(r'dimensions:\s+(\d+)x(\d+)', output)
    if not dimensions or args['x'] >= int(dimensions[1]) or args['y'] >= int(dimensions[2]):
        raise ValueError('Coordinates are outside the desktop. Take a fresh screenshot.')
    run(['xdotool', 'mousemove', '--sync', str(args['x']), str(args['y'])])


def screenshot():
    data = run(['import', '-display', DISPLAY, '-window', 'root', 'png:-'])
    if not data.startswith(b'\x89PNG\r\n\x1a\n') or len(data) > 8 * 1024 * 1024:
        raise ValueError('Could not capture a supported desktop image')
    width, height = struct.unpack('>II', data[16:24])
    directory = STATE / 'screenshots'
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / (str(uuid.uuid4()) + '.png')
    path.write_bytes(data)
    for old in sorted(directory.glob('*.png'), key=lambda item: item.stat().st_mtime, reverse=True)[20:]:
        old.unlink(missing_ok=True)
    return {'content': [
        {'type': 'text', 'text': json.dumps({'width': width, 'height': height, 'path': str(path), 'display': DISPLAY})},
        {'type': 'image', 'mimeType': 'image/png', 'data': base64.b64encode(data).decode()},
    ]}


def call(name, args):
    validate(name, args)
    if name != 'computer_screenshot':
        try:
            allowed = json.loads((STATE / 'computer-policy.json').read_text()).get('controlAllowed') is True
        except (OSError, ValueError):
            allowed = False
        if not allowed:
            raise ValueError('Computer control is disabled in read-only mode. Screenshots remain available.')
    with browser_access():
        ensure_desktop()
        if name == 'computer_screenshot':
            return screenshot()
        move(args)
        if name == 'computer_click':
            button = {'left': '1', 'middle': '2', 'right': '3'}[args.get('button', 'left')]
            run(['xdotool', 'click', '--repeat', str(args.get('clicks', 1)), '--delay', '100', button])
        elif name == 'computer_type':
            run(['xdotool', 'type', '--clearmodifiers', '--delay', '0', '--file', '-'], args['text'].encode())
        elif name == 'computer_key':
            run(['xdotool', 'key', '--clearmodifiers', args['key']])
        elif name == 'computer_scroll':
            button = {'up': '4', 'down': '5', 'left': '6', 'right': '7'}[args['direction']]
            run(['xdotool', 'click', '--repeat', str(args.get('amount', 3)), '--delay', '60', button])
        elif name == 'computer_open':
            commands = {
                'browser': ['chromium', '--no-sandbox', '--disable-dev-shm-usage', '--no-first-run', '--password-store=basic', '--restore-last-session', '--user-data-dir=' + BROWSER_PROFILE, args.get('url', 'about:blank')],
                'terminal': ['xfce4-terminal', '--disable-server', '--working-directory=' + str(WORKSPACE)],
                'files': ['thunar', str(WORKSPACE)],
            }
            subprocess.Popen(commands[args['app']], cwd=WORKSPACE, env=ENV, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    return {'content': [{'type': 'text', 'text': 'Action sent to the shared desktop. Take a screenshot to verify the result.'}]}


def handle(message):
    method = message.get('method')
    params = message.get('params') or {}
    if method == 'initialize':
        requested = params.get('protocolVersion')
        version = requested if requested in ('2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25') else '2025-06-18'
        return {'protocolVersion': version, 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'sparkles-computer', 'version': '1.0.0'}}
    if method == 'ping':
        return {}
    if method == 'tools/list':
        return {'tools': TOOLS}
    if method == 'tools/call':
        try:
            return call(params.get('name'), params.get('arguments', {}))
        except Exception as error:
            return {'isError': True, 'content': [{'type': 'text', 'text': str(error)}]}
    raise ValueError('Method not found')


for line in sys.stdin:
    message = None
    try:
        if len(line) > 100000:
            raise ValueError('Request too large')
        message = json.loads(line)
        if not isinstance(message, dict):
            raise ValueError('Invalid request')
        if 'id' not in message:
            continue
        response = {'jsonrpc': '2.0', 'id': message['id'], 'result': handle(message)}
    except Exception as error:
        response = {'jsonrpc': '2.0', 'id': message.get('id') if isinstance(message, dict) else None, 'error': {'code': -32600, 'message': str(error)}}
    print(json.dumps(response), flush=True)
`;
