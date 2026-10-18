import base64
import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

os.environ["DOCMANAGER_QUIET"] = "1"

from docmanager.server import create_server  # noqa: E402
from docmanager.store import Store, ValidationError  # noqa: E402


class StoreTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(self.tmp.name)
        self.project = self.store.create_project({"code": "erp", "name": "ERP 구축"})

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def test_project_code_is_uppercased_and_unique(self):
        self.assertEqual(self.project["code"], "ERP")
        with self.assertRaises(ValidationError):
            self.store.create_project({"code": "ERP", "name": "중복"})

    def test_doc_numbers_are_sequential_per_category(self):
        a = self.store.create_document({"project_id": self.project["id"], "title": "A", "category": "설계"})
        b = self.store.create_document({"project_id": self.project["id"], "title": "B", "category": "설계"})
        c = self.store.create_document({"project_id": self.project["id"], "title": "C", "category": "회의록"})
        self.assertEqual([a["doc_no"], b["doc_no"], c["doc_no"]],
                         ["ERP-DES-001", "ERP-DES-002", "ERP-MOM-001"])

    def test_revisions_increment_version_and_store_files(self):
        doc = self.store.create_document({
            "project_id": self.project["id"], "title": "요구사항 정의서", "content": "초안",
            "file_name": "req.txt", "file_data": base64.b64encode(b"v1").decode(),
        })
        self.assertEqual(doc["current_version"], 1)
        doc = self.store.add_revision(doc["id"], {"content": "수정본", "note": "피드백 반영"})
        self.assertEqual(doc["current_version"], 2)
        self.assertEqual([r["version"] for r in doc["revisions"]], [2, 1])
        name, path = self.store.get_revision_file(doc["revisions"][1]["id"])
        self.assertEqual(name, "req.txt")
        with open(path, "rb") as f:
            self.assertEqual(f.read(), b"v1")
        self.store.delete_project(self.project["id"])
        self.assertFalse(os.path.exists(path))

    def test_search_matches_latest_content_and_tags(self):
        doc = self.store.create_document({"project_id": self.project["id"], "title": "T",
                                          "tags": "고객사, 1차", "content": "예전 문구"})
        self.store.add_revision(doc["id"], {"content": "새로운 문구"})
        self.assertEqual(len(self.store.list_documents(q="고객사")), 1)
        self.assertEqual(len(self.store.list_documents(q="새로운")), 1)
        self.assertEqual(len(self.store.list_documents(q="예전")), 0)

    def test_status_validation(self):
        doc = self.store.create_document({"project_id": self.project["id"], "title": "T"})
        self.assertEqual(self.store.update_document(doc["id"], {"status": "승인"})["status"], "승인")
        with self.assertRaises(ValidationError):
            self.store.update_document(doc["id"], {"status": "없는상태"})


class ApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.httpd = create_server(cls.tmp.name, port=0)
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.httpd.store.close()
        cls.tmp.cleanup()

    def call(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, res.read(), res.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read(), e.headers

    def test_full_flow(self):
        status, body, _ = self.call("POST", "/api/projects", {"code": "API", "name": "API 프로젝트"})
        self.assertEqual(status, 201)
        pid = json.loads(body)["id"]

        status, body, _ = self.call("POST", "/api/documents", {
            "project_id": pid, "title": "설계서", "category": "설계",
            "file_name": "설계서.txt", "file_data": base64.b64encode("내용".encode()).decode()})
        self.assertEqual(status, 201)
        doc = json.loads(body)
        self.assertEqual(doc["doc_no"], "API-DES-001")

        status, body, headers = self.call("GET", f"/api/revisions/{doc['revisions'][0]['id']}/file")
        self.assertEqual((status, body.decode()), (200, "내용"))
        self.assertIn("attachment", headers["Content-Disposition"])

        status, body, _ = self.call("GET", f"/api/documents?project_id={pid}&q={urllib.parse.quote('설계')}")
        self.assertEqual(len(json.loads(body)), 1)

        status, body, _ = self.call("GET", f"/api/export.csv?project_id={pid}")
        self.assertIn("API-DES-001", body.decode("utf-8-sig"))

        status, body, _ = self.call("GET", "/api/stats")
        self.assertGreaterEqual(json.loads(body)["document_count"], 1)

        self.assertEqual(self.call("DELETE", f"/api/projects/{pid}")[0], 200)
        self.assertEqual(self.call("GET", f"/api/documents/{doc['id']}")[0], 404)

    def test_errors_and_static(self):
        status, body, _ = self.call("POST", "/api/projects", {"code": "x", "name": ""})
        self.assertEqual(status, 400)
        self.assertIn("error", json.loads(body))
        status, body, _ = self.call("GET", "/")
        self.assertEqual(status, 200)
        self.assertIn("프로젝트 문서 관리", body.decode())
        self.assertEqual(self.call("GET", "/../store.py")[1], self.call("GET", "/")[1])


if __name__ == "__main__":
    unittest.main()
