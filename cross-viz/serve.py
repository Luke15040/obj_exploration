"""
Static dev server with caching disabled, for running without Node/Vite.
Browsers otherwise keep stale ES modules and a half-updated import graph
fails silently (black page).

    python serve.py [port]
"""
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class NoCacheHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5179
    root = Path(__file__).parent
    handler = partial(NoCacheHandler, directory=str(root))
    print(f'serving {root} on http://localhost:{port}')
    ThreadingHTTPServer(('', port), handler).serve_forever()
