export const workspaceStaticSource = String.raw`
import http.server
import mimetypes
import os
import stat
import urllib.parse

ROOT = os.path.realpath(os.environ.get('SPARKLES_WORKSPACE_DIR', '/workspace/repo'))
MAX_SIZE = 16 * 1024 * 1024

class Handler(http.server.BaseHTTPRequestHandler):
    def do_HEAD(self):
        self.serve(False)

    def do_GET(self):
        self.serve(True)

    def serve(self, body):
        descriptors = []
        try:
            path = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path, errors='strict')
            if not path.startswith('/') or '\\' in path or '\x00' in path:
                raise ValueError('Invalid path')
            parts = path.split('/')[1:]
            if not parts[-1]:
                parts[-1] = 'index.html'
            if any(not part or part.startswith('.') or part == 'node_modules' or part.lower().endswith(('.pem', '.key')) for part in parts):
                raise ValueError('Private path')
            descriptor = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            descriptors.append(descriptor)
            for index, part in enumerate(parts):
                flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
                if index < len(parts) - 1:
                    flags |= os.O_DIRECTORY
                descriptor = os.open(part, flags, dir_fd=descriptor)
                descriptors.append(descriptor)
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SIZE:
                raise ValueError('Not a public file')
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(parts[-1])[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(info.st_size))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            if body:
                remaining = info.st_size
                while remaining:
                    chunk = os.read(descriptor, min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (OSError, ValueError, UnicodeError):
            self.send_error(404, 'File not available')
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)

http.server.ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('PORT', '3000'))), Handler).serve_forever()
`;
