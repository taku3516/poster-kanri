#!/usr/bin/env python3
"""手元で動かすための簡易サーバ。

python3 -m http.server と違い、キャッシュを持たせない。
本番（Firebase Hosting）は firebase.json で no-cache を返すため、
手元だけキャッシュが効くと「直したのに反映されない」という
本番では起きない現象に時間を取られる。

使い方:
    python3 tools/serve.py [ポート番号]
"""
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    """キャッシュを持たせない。文字コードは UTF-8 を明示する。"""

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def guess_type(self, path):
        base = super().guess_type(path)
        if base in ('text/html', 'text/css', 'application/javascript', 'text/javascript'):
            return base + '; charset=utf-8'
        return base

    def log_message(self, fmt, *args):
        # 404 だけ出す。毎回の200で埋もれさせない
        if args and str(args[1]).startswith('4'):
            super().log_message(fmt, *args)


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public')

    handler = functools.partial(NoCacheHandler, directory=os.path.normpath(root))
    with http.server.ThreadingHTTPServer(('127.0.0.1', port), handler) as server:
        print(f'http://localhost:{port} で配信中（キャッシュなし）')
        server.serve_forever()


if __name__ == '__main__':
    main()
