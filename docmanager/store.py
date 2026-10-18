"""SQLite 기반 저장소: 프로젝트, 문서, 개정 이력, 첨부 파일."""

import base64
import csv
import io
import os
import re
import sqlite3
import threading
import uuid
from datetime import datetime

PROJECT_STATUSES = ["계획", "진행", "보류", "완료"]
DOC_STATUSES = ["작성중", "검토중", "승인", "폐기"]
CATEGORIES = {
    "기획": "PLN",
    "요구사항": "REQ",
    "설계": "DES",
    "개발": "DEV",
    "테스트": "TST",
    "회의록": "MOM",
    "보고서": "RPT",
    "계약": "CTR",
    "기타": "ETC",
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '계획',
    manager TEXT NOT NULL DEFAULT '',
    start_date TEXT NOT NULL DEFAULT '',
    end_date TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    doc_no TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT '기타',
    status TEXT NOT NULL DEFAULT '작성중',
    author TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '',
    current_version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    file_name TEXT NOT NULL DEFAULT '',
    file_key TEXT NOT NULL DEFAULT '',
    file_size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE(document_id, version)
);
CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER,
    document_id INTEGER,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_revisions_document ON revisions(document_id);
"""


class NotFound(Exception):
    pass


class ValidationError(Exception):
    pass


def _now():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def _clean(value, default=""):
    if value is None:
        return default
    return str(value).strip()


class Store:
    def __init__(self, data_dir):
        self.data_dir = data_dir
        self.files_dir = os.path.join(data_dir, "files")
        os.makedirs(self.files_dir, exist_ok=True)
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(
            os.path.join(data_dir, "docmanager.db"), check_same_thread=False
        )
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self):
        self.conn.close()

    # ------------------------------------------------------------------ util
    def _query(self, sql, params=()):
        with self._lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def _log(self, action, detail, project_id=None, document_id=None):
        self.conn.execute(
            "INSERT INTO activity (project_id, document_id, action, detail, created_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (project_id, document_id, action, detail, _now()),
        )

    # -------------------------------------------------------------- projects
    def list_projects(self):
        return self._query(
            """SELECT p.*, COUNT(d.id) AS document_count
               FROM projects p LEFT JOIN documents d ON d.project_id = p.id
               GROUP BY p.id ORDER BY p.updated_at DESC, p.id DESC"""
        )

    def get_project(self, project_id):
        rows = self._query(
            """SELECT p.*, COUNT(d.id) AS document_count
               FROM projects p LEFT JOIN documents d ON d.project_id = p.id
               WHERE p.id = ? GROUP BY p.id""",
            (project_id,),
        )
        if not rows:
            raise NotFound("프로젝트를 찾을 수 없습니다.")
        return rows[0]

    def _validate_project(self, data, partial=False):
        out = {}
        for key in ("code", "name", "description", "status", "manager",
                    "start_date", "end_date"):
            if key in data or not partial:
                out[key] = _clean(data.get(key))
        if "code" in out:
            out["code"] = out["code"].upper()
            if not re.fullmatch(r"[A-Z0-9_-]{2,20}", out["code"]):
                raise ValidationError("프로젝트 코드는 영문/숫자/-/_ 2~20자여야 합니다.")
        if "name" in out and not out["name"]:
            raise ValidationError("프로젝트명은 필수입니다.")
        if "status" in out:
            out["status"] = out["status"] or PROJECT_STATUSES[0]
            if out["status"] not in PROJECT_STATUSES:
                raise ValidationError("잘못된 프로젝트 상태입니다.")
        for key in ("start_date", "end_date"):
            if out.get(key) and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", out[key]):
                raise ValidationError("날짜는 YYYY-MM-DD 형식이어야 합니다.")
        if (not partial and out["start_date"] and out["end_date"]
                and out["start_date"] > out["end_date"]):
            raise ValidationError("종료일은 시작일 이후여야 합니다.")
        return out

    def create_project(self, data):
        p = self._validate_project(data)
        now = _now()
        with self._lock:
            try:
                cur = self.conn.execute(
                    """INSERT INTO projects (code, name, description, status, manager,
                       start_date, end_date, created_at, updated_at)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (p["code"], p["name"], p["description"], p["status"], p["manager"],
                     p["start_date"], p["end_date"], now, now),
                )
            except sqlite3.IntegrityError:
                raise ValidationError("이미 존재하는 프로젝트 코드입니다.")
            self._log("프로젝트 생성", f"[{p['code']}] {p['name']}", cur.lastrowid)
            self.conn.commit()
        return self.get_project(cur.lastrowid)

    def update_project(self, project_id, data):
        self.get_project(project_id)
        p = self._validate_project(data, partial=True)
        p.pop("code", None)  # 코드는 문서 번호의 기준이므로 변경 불가
        if p:
            sets = ", ".join(f"{k} = ?" for k in p)
            with self._lock:
                self.conn.execute(
                    f"UPDATE projects SET {sets}, updated_at = ? WHERE id = ?",
                    (*p.values(), _now(), project_id),
                )
                self._log("프로젝트 수정", ", ".join(p), project_id)
                self.conn.commit()
        return self.get_project(project_id)

    def delete_project(self, project_id):
        project = self.get_project(project_id)
        keys = self._query(
            """SELECT r.file_key FROM revisions r JOIN documents d ON d.id = r.document_id
               WHERE d.project_id = ? AND r.file_key != ''""",
            (project_id,),
        )
        with self._lock:
            self.conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
            self.conn.execute("DELETE FROM activity WHERE project_id = ?", (project_id,))
            self._log("프로젝트 삭제", f"[{project['code']}] {project['name']}")
            self.conn.commit()
        self._remove_files(k["file_key"] for k in keys)

    # ------------------------------------------------------------- documents
    def list_documents(self, project_id=None, q="", status="", category=""):
        sql = """SELECT d.*, p.code AS project_code, p.name AS project_name
                 FROM documents d JOIN projects p ON p.id = d.project_id WHERE 1=1"""
        params = []
        if project_id:
            sql += " AND d.project_id = ?"
            params.append(int(project_id))
        if status:
            sql += " AND d.status = ?"
            params.append(status)
        if category:
            sql += " AND d.category = ?"
            params.append(category)
        if q:
            like = f"%{q}%"
            sql += """ AND (d.title LIKE ? OR d.doc_no LIKE ? OR d.tags LIKE ?
                       OR d.author LIKE ? OR EXISTS (SELECT 1 FROM revisions r
                       WHERE r.document_id = d.id AND r.version = d.current_version
                       AND (r.content LIKE ? OR r.file_name LIKE ?)))"""
            params += [like] * 6
        sql += " ORDER BY d.updated_at DESC, d.id DESC"
        return self._query(sql, params)

    def get_document(self, document_id):
        rows = self._query(
            """SELECT d.*, p.code AS project_code, p.name AS project_name
               FROM documents d JOIN projects p ON p.id = d.project_id WHERE d.id = ?""",
            (document_id,),
        )
        if not rows:
            raise NotFound("문서를 찾을 수 없습니다.")
        doc = rows[0]
        doc["revisions"] = self._query(
            """SELECT id, version, content, note, author, file_name, file_size, created_at
               FROM revisions WHERE document_id = ? ORDER BY version DESC""",
            (document_id,),
        )
        return doc

    def _validate_document(self, data, partial=False):
        out = {}
        for key in ("title", "category", "status", "author", "tags"):
            if key in data or not partial:
                out[key] = _clean(data.get(key))
        if "title" in out and not out["title"]:
            raise ValidationError("문서 제목은 필수입니다.")
        if "category" in out:
            out["category"] = out["category"] or "기타"
            if out["category"] not in CATEGORIES:
                raise ValidationError("잘못된 문서 분류입니다.")
        if "status" in out:
            out["status"] = out["status"] or DOC_STATUSES[0]
            if out["status"] not in DOC_STATUSES:
                raise ValidationError("잘못된 문서 상태입니다.")
        if "tags" in out:
            tags = [t.strip() for t in re.split(r"[,\s]+", out["tags"]) if t.strip()]
            out["tags"] = ",".join(dict.fromkeys(tags))
        return out

    def _next_doc_no(self, project_code, category):
        prefix = f"{project_code}-{CATEGORIES[category]}-"
        row = self.conn.execute(
            "SELECT MAX(CAST(SUBSTR(doc_no, ?) AS INTEGER)) AS seq FROM documents"
            " WHERE SUBSTR(doc_no, 1, ?) = ?",
            (len(prefix) + 1, len(prefix), prefix),
        ).fetchone()
        seq = (row["seq"] or 0) + 1
        return f"{prefix}{seq:03d}"

    def create_document(self, data):
        try:
            project = self.get_project(int(data.get("project_id") or 0))
        except (TypeError, ValueError):
            raise ValidationError("프로젝트를 선택하세요.")
        d = self._validate_document(data)
        now = _now()
        with self._lock:
            doc_no = self._next_doc_no(project["code"], d["category"])
            cur = self.conn.execute(
                """INSERT INTO documents (project_id, doc_no, title, category, status,
                   author, tags, current_version, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                (project["id"], doc_no, d["title"], d["category"], d["status"],
                 d["author"], d["tags"], now, now),
            )
            doc_id = cur.lastrowid
            self._log("문서 등록", f"{doc_no} {d['title']}", project["id"], doc_id)
            self._touch_project(project["id"], now)
            self.conn.commit()
        # 최초 등록 시 v1 개정을 함께 생성한다.
        return self.add_revision(doc_id, {
            "content": data.get("content", ""),
            "note": data.get("note") or "최초 작성",
            "author": d["author"],
            "file_name": data.get("file_name", ""),
            "file_data": data.get("file_data"),
        })

    def update_document(self, document_id, data):
        doc = self.get_document(document_id)
        d = self._validate_document(data, partial=True)
        d.pop("category", None)  # 분류는 문서 번호에 포함되므로 변경 불가
        if d:
            now = _now()
            sets = ", ".join(f"{k} = ?" for k in d)
            with self._lock:
                self.conn.execute(
                    f"UPDATE documents SET {sets}, updated_at = ? WHERE id = ?",
                    (*d.values(), now, document_id),
                )
                detail = (f"상태 {doc['status']} → {d['status']}"
                          if d.get("status") and d["status"] != doc["status"]
                          else ", ".join(d))
                self._log("문서 수정", f"{doc['doc_no']} {detail}",
                          doc["project_id"], document_id)
                self._touch_project(doc["project_id"], now)
                self.conn.commit()
        return self.get_document(document_id)

    def delete_document(self, document_id):
        doc = self.get_document(document_id)
        keys = self._query(
            "SELECT file_key FROM revisions WHERE document_id = ? AND file_key != ''",
            (document_id,),
        )
        with self._lock:
            self.conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
            self._log("문서 삭제", f"{doc['doc_no']} {doc['title']}", doc["project_id"])
            self.conn.commit()
        self._remove_files(k["file_key"] for k in keys)

    def _touch_project(self, project_id, now):
        self.conn.execute("UPDATE projects SET updated_at = ? WHERE id = ?",
                          (now, project_id))

    # ------------------------------------------------------------- revisions
    def add_revision(self, document_id, data):
        doc = self.get_document(document_id)
        file_name = os.path.basename(_clean(data.get("file_name")))
        file_bytes = data.get("file_bytes")
        if file_bytes is None and data.get("file_data"):
            try:
                file_bytes = base64.b64decode(data["file_data"], validate=True)
            except (ValueError, TypeError):
                raise ValidationError("첨부 파일 데이터가 올바르지 않습니다.")
        file_key = ""
        if file_bytes is not None:
            if not file_name:
                raise ValidationError("첨부 파일명이 필요합니다.")
            file_key = uuid.uuid4().hex
            with open(os.path.join(self.files_dir, file_key), "wb") as f:
                f.write(file_bytes)
        else:
            file_name = ""
        version = doc["current_version"] + 1
        now = _now()
        with self._lock:
            self.conn.execute(
                """INSERT INTO revisions (document_id, version, content, note, author,
                   file_name, file_key, file_size, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (document_id, version, _clean(data.get("content")),
                 _clean(data.get("note")), _clean(data.get("author")) or doc["author"],
                 file_name, file_key, len(file_bytes) if file_bytes else 0, now),
            )
            self.conn.execute(
                "UPDATE documents SET current_version = ?, updated_at = ? WHERE id = ?",
                (version, now, document_id),
            )
            if version > 1:
                self._log("개정 등록", f"{doc['doc_no']} v{version}",
                          doc["project_id"], document_id)
            self._touch_project(doc["project_id"], now)
            self.conn.commit()
        return self.get_document(document_id)

    def get_revision_file(self, revision_id):
        rows = self._query(
            "SELECT file_name, file_key FROM revisions WHERE id = ? AND file_key != ''",
            (revision_id,),
        )
        if not rows:
            raise NotFound("첨부 파일이 없습니다.")
        path = os.path.join(self.files_dir, rows[0]["file_key"])
        if not os.path.exists(path):
            raise NotFound("첨부 파일이 저장소에 없습니다.")
        return rows[0]["file_name"], path

    def _remove_files(self, keys):
        for key in keys:
            try:
                os.remove(os.path.join(self.files_dir, key))
            except FileNotFoundError:
                pass

    # ------------------------------------------------------------ dashboard
    def stats(self):
        def counts(sql):
            return {r["k"]: r["n"] for r in self._query(sql)}

        return {
            "project_count": self._query("SELECT COUNT(*) AS n FROM projects")[0]["n"],
            "document_count": self._query("SELECT COUNT(*) AS n FROM documents")[0]["n"],
            "revision_count": self._query("SELECT COUNT(*) AS n FROM revisions")[0]["n"],
            "projects_by_status": counts(
                "SELECT status AS k, COUNT(*) AS n FROM projects GROUP BY status"),
            "documents_by_status": counts(
                "SELECT status AS k, COUNT(*) AS n FROM documents GROUP BY status"),
            "documents_by_category": counts(
                "SELECT category AS k, COUNT(*) AS n FROM documents GROUP BY category"),
            "recent_activity": self._query(
                "SELECT * FROM activity ORDER BY id DESC LIMIT 15"),
        }

    def export_csv(self, project_id=None):
        docs = self.list_documents(project_id=project_id)
        buf = io.StringIO()
        buf.write("﻿")  # 엑셀에서 한글이 깨지지 않도록 BOM 추가
        w = csv.writer(buf)
        w.writerow(["문서번호", "프로젝트", "제목", "분류", "상태", "작성자",
                    "태그", "현재버전", "등록일", "수정일"])
        for d in docs:
            w.writerow([d["doc_no"], f"[{d['project_code']}] {d['project_name']}",
                        d["title"], d["category"], d["status"], d["author"],
                        d["tags"], f"v{d['current_version']}",
                        d["created_at"], d["updated_at"]])
        return buf.getvalue()

    def meta(self):
        return {
            "project_statuses": PROJECT_STATUSES,
            "doc_statuses": DOC_STATUSES,
            "categories": list(CATEGORIES),
        }
