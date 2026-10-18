"""표준 라이브러리만 사용하는 JSON API + 정적 파일 서버."""

import argparse
import json
import mimetypes
import os
import re
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlparse

from .store import NotFound, Store, ValidationError

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
MAX_BODY = 50 * 1024 * 1024  # 첨부 파일 포함 요청 최대 50MB


def make_handler(store):
    routes = [
        ("GET", r"/api/meta", lambda h, q: store.meta()),
        ("GET", r"/api/stats", lambda h, q: store.stats()),
        ("GET", r"/api/projects", lambda h, q: store.list_projects()),
        ("POST", r"/api/projects", lambda h, q: store.create_project(h.json())),
        ("GET", r"/api/projects/(\d+)", lambda h, q, i: store.get_project(int(i))),
        ("PUT", r"/api/projects/(\d+)",
         lambda h, q, i: store.update_project(int(i), h.json())),
        ("DELETE", r"/api/projects/(\d+)",
         lambda h, q, i: store.delete_project(int(i))),
        ("GET", r"/api/documents", lambda h, q: store.list_documents(
            project_id=q.get("project_id"), q=q.get("q", ""),
            status=q.get("status", ""), category=q.get("category", ""))),
        ("POST", r"/api/documents", lambda h, q: store.create_document(h.json())),
        ("GET", r"/api/documents/(\d+)", lambda h, q, i: store.get_document(int(i))),
        ("PUT", r"/api/documents/(\d+)",
         lambda h, q, i: store.update_document(int(i), h.json())),
        ("DELETE", r"/api/documents/(\d+)",
         lambda h, q, i: store.delete_document(int(i))),
        ("POST", r"/api/documents/(\d+)/revisions",
         lambda h, q, i: store.add_revision(int(i), h.json())),
        ("GET", r"/api/revisions/(\d+)/file",
         lambda h, q, i: h.send_file(*store.get_revision_file(int(i)))),
        ("GET", r"/api/export\.csv",
         lambda h, q: h.send_csv(store.export_csv(q.get("project_id")))),
    ]
    compiled = [(m, re.compile(p + r"$"), fn) for m, p, fn in routes]

    class Handler(BaseHTTPRequestHandler):
        server_version = "DocManager/1.0"

        def log_message(self, fmt, *args):
            if os.environ.get("DOCMANAGER_QUIET") != "1":
                super().log_message(fmt, *args)

        # ---------------------------------------------------------- helpers
        def json(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_BODY:
                raise ValidationError("요청이 너무 큽니다 (최대 50MB).")
            try:
                data = json.loads(self.rfile.read(length) or b"{}")
            except ValueError:
                raise ValidationError("JSON 형식이 올바르지 않습니다.")
            if not isinstance(data, dict):
                raise ValidationError("JSON 객체가 필요합니다.")
            return data

        def send_json(self, status, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def send_file(self, name, path):
            ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(os.path.getsize(path)))
            self.send_header("Content-Disposition",
                             f"attachment; filename*=UTF-8''{quote(name)}")
            self.end_headers()
            with open(path, "rb") as f:
                while chunk := f.read(64 * 1024):
                    self.wfile.write(chunk)
            return ...

        def send_csv(self, text):
            body = text.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition",
                             "attachment; filename*=UTF-8''" + quote("문서대장.csv"))
            self.end_headers()
            self.wfile.write(body)
            return ...

        def serve_static(self, path):
            rel = "index.html" if path in ("", "/") else path.lstrip("/")
            full = os.path.realpath(os.path.join(STATIC_DIR, rel))
            if not full.startswith(STATIC_DIR + os.sep) or not os.path.isfile(full):
                full = os.path.join(STATIC_DIR, "index.html")
            with open(full, "rb") as f:
                body = f.read()
            ctype = mimetypes.guess_type(full)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype.endswith("javascript"):
                ctype += "; charset=utf-8"
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        # ---------------------------------------------------------- dispatch
        def dispatch(self, method):
            url = urlparse(self.path)
            if not url.path.startswith("/api/"):
                if method == "GET":
                    return self.serve_static(url.path)
                return self.send_json(HTTPStatus.METHOD_NOT_ALLOWED,
                                      {"error": "허용되지 않은 요청입니다."})
            query = {k: v[0] for k, v in parse_qs(url.query).items()}
            for m, pattern, fn in compiled:
                match = pattern.match(url.path)
                if match and m == method:
                    try:
                        result = fn(self, query, *match.groups())
                    except NotFound as e:
                        return self.send_json(HTTPStatus.NOT_FOUND, {"error": str(e)})
                    except ValidationError as e:
                        return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(e)})
                    if result is ...:  # 이미 응답을 보낸 경우
                        return None
                    status = HTTPStatus.CREATED if method == "POST" else HTTPStatus.OK
                    return self.send_json(status, result if result is not None
                                          else {"ok": True})
            return self.send_json(HTTPStatus.NOT_FOUND, {"error": "API를 찾을 수 없습니다."})

        def do_GET(self):
            self.dispatch("GET")

        def do_POST(self):
            self.dispatch("POST")

        def do_PUT(self):
            self.dispatch("PUT")

        def do_DELETE(self):
            self.dispatch("DELETE")

    return Handler


def create_server(data_dir, host="127.0.0.1", port=8000):
    store = Store(data_dir)
    httpd = ThreadingHTTPServer((host, port), make_handler(store))
    httpd.store = store
    return httpd


def main(argv=None):
    parser = argparse.ArgumentParser(description="프로젝트 통합 문서 관리 시스템")
    parser.add_argument("--host", default="127.0.0.1", help="바인딩 주소 (기본 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8000, help="포트 (기본 8000)")
    parser.add_argument("--data", default=os.path.join(os.getcwd(), "data"),
                        help="DB와 첨부 파일을 저장할 폴더 (기본 ./data)")
    args = parser.parse_args(argv)
    httpd = create_server(args.data, args.host, args.port)
    print(f"문서 관리 시스템 실행 중: http://{args.host}:{args.port}  (데이터: {args.data})")
    print("종료하려면 Ctrl+C 를 누르세요.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        httpd.store.close()


if __name__ == "__main__":
    main()
