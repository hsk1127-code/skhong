// ---------------------------------------------------------------------------
// 브라우저 내장 저장소(IndexedDB) 기반 백엔드: Python 서버의 store.py 와 같은 규칙
// ---------------------------------------------------------------------------
const PROJECT_STATUSES = ["계획", "진행", "보류", "완료"];
const DOC_STATUSES = ["작성중", "검토중", "승인", "폐기"];
const CATEGORIES = { 기획: "PLN", 요구사항: "REQ", 설계: "DES", 개발: "DEV", 테스트: "TST",
  회의록: "MOM", 보고서: "RPT", 계약: "CTR", 기타: "ETC" };

const EMPTY_STATE = () => ({ projects: [], documents: [], revisions: [], activity: [],
  seq: { project: 0, document: 0, revision: 0, activity: 0 } });
let DB = EMPTY_STATE();
let idb;

class ApiError extends Error {}
const fail = (msg) => { throw new ApiError(msg); };
const clean = (v) => (v == null ? "" : String(v).trim());
const pad = (n) => String(n).padStart(2, "0");
function now() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
const byRecent = (a, b) => b.updated_at.localeCompare(a.updated_at) || b.id - a.id;

// ------------------------------------------------------------ IndexedDB
const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
async function openDb() {
  const open = indexedDB.open("project-docmanager", 1);
  open.onupgradeneeded = () => {
    open.result.createObjectStore("state");
    open.result.createObjectStore("files");
  };
  idb = await req(open);
  DB = (await req(idb.transaction("state").objectStore("state").get("main"))) || EMPTY_STATE();
  navigator.storage?.persist?.(); // 브라우저가 임의로 데이터를 지우지 않도록 요청
}
const tx = (store, mode = "readonly") => idb.transaction(store, mode).objectStore(store);
const save = () => req(tx("state", "readwrite").put(DB, "main"));
const putFile = (key, blob) => req(tx("files", "readwrite").put(blob, key));
const getFile = (key) => req(tx("files").get(key));
const removeFiles = (keys) => Promise.all(keys.filter(Boolean).map((k) => req(tx("files", "readwrite").delete(k))));

function log(action, detail, project_id = null, document_id = null) {
  DB.activity.push({ id: ++DB.seq.activity, project_id, document_id, action, detail, created_at: now() });
  if (DB.activity.length > 500) DB.activity.splice(0, DB.activity.length - 500);
}

// ------------------------------------------------------------- projects
const withCount = (p) => ({ ...p, document_count: DB.documents.filter((d) => d.project_id === p.id).length });
const listProjects = () => DB.projects.map(withCount).sort(byRecent);
function findProject(id) {
  return DB.projects.find((p) => p.id === Number(id)) || fail("프로젝트를 찾을 수 없습니다.");
}
function validateProject(data, partial) {
  const out = {};
  for (const k of ["code", "name", "description", "status", "manager", "start_date", "end_date"])
    if (k in data || !partial) out[k] = clean(data[k]);
  if ("code" in out) {
    out.code = out.code.toUpperCase();
    if (!/^[A-Z0-9_-]{2,20}$/.test(out.code)) fail("프로젝트 코드는 영문/숫자/-/_ 2~20자여야 합니다.");
  }
  if ("name" in out && !out.name) fail("프로젝트명은 필수입니다.");
  if ("status" in out) {
    out.status ||= PROJECT_STATUSES[0];
    if (!PROJECT_STATUSES.includes(out.status)) fail("잘못된 프로젝트 상태입니다.");
  }
  for (const k of ["start_date", "end_date"])
    if (out[k] && !/^\d{4}-\d{2}-\d{2}$/.test(out[k])) fail("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  if (out.start_date && out.end_date && out.start_date > out.end_date) fail("종료일은 시작일 이후여야 합니다.");
  return out;
}
async function createProject(data) {
  const p = validateProject(data, false);
  if (DB.projects.some((x) => x.code === p.code)) fail("이미 존재하는 프로젝트 코드입니다.");
  const t = now();
  const project = { id: ++DB.seq.project, ...p, created_at: t, updated_at: t };
  DB.projects.push(project);
  log("프로젝트 생성", `[${p.code}] ${p.name}`, project.id);
  await save();
  return withCount(project);
}
async function updateProject(id, data) {
  const project = findProject(id);
  const p = validateProject(data, true);
  delete p.code; // 코드는 문서 번호의 기준이므로 변경 불가
  Object.assign(project, p, { updated_at: now() });
  log("프로젝트 수정", Object.keys(p).join(", "), project.id);
  await save();
  return withCount(project);
}
async function deleteProject(id) {
  const project = findProject(id);
  const docIds = new Set(DB.documents.filter((d) => d.project_id === project.id).map((d) => d.id));
  const keys = DB.revisions.filter((r) => docIds.has(r.document_id)).map((r) => r.file_key);
  DB.projects = DB.projects.filter((p) => p !== project);
  DB.documents = DB.documents.filter((d) => !docIds.has(d.id));
  DB.revisions = DB.revisions.filter((r) => !docIds.has(r.document_id));
  DB.activity = DB.activity.filter((a) => a.project_id !== project.id);
  log("프로젝트 삭제", `[${project.code}] ${project.name}`);
  await save();
  await removeFiles(keys);
}

// ------------------------------------------------------------ documents
function docView(d) {
  const p = DB.projects.find((x) => x.id === d.project_id);
  return { ...d, project_code: p.code, project_name: p.name };
}
const findDoc = (id) => DB.documents.find((d) => d.id === Number(id)) || fail("문서를 찾을 수 없습니다.");
const revisionsOf = (docId) => DB.revisions.filter((r) => r.document_id === docId);

function listDocuments({ project_id = "", q = "", status = "", category = "" }) {
  q = q.toLowerCase();
  return DB.documents.filter((d) => {
    if (project_id && d.project_id !== Number(project_id)) return false;
    if (status && d.status !== status) return false;
    if (category && d.category !== category) return false;
    if (!q) return true;
    const latest = revisionsOf(d.id).find((r) => r.version === d.current_version) || {};
    return [d.title, d.doc_no, d.tags, d.author, latest.content, latest.file_name]
      .some((v) => (v || "").toLowerCase().includes(q));
  }).sort(byRecent).map(docView);
}
function getDocument(id) {
  const d = findDoc(id);
  return { ...docView(d), revisions: revisionsOf(d.id).sort((a, b) => b.version - a.version) };
}
function validateDoc(data, partial) {
  const out = {};
  for (const k of ["title", "category", "status", "author", "tags"])
    if (k in data || !partial) out[k] = clean(data[k]);
  if ("title" in out && !out.title) fail("문서 제목은 필수입니다.");
  if ("category" in out) {
    out.category ||= "기타";
    if (!(out.category in CATEGORIES)) fail("잘못된 문서 분류입니다.");
  }
  if ("status" in out) {
    out.status ||= DOC_STATUSES[0];
    if (!DOC_STATUSES.includes(out.status)) fail("잘못된 문서 상태입니다.");
  }
  if ("tags" in out) out.tags = [...new Set(out.tags.split(/[,\s]+/).filter(Boolean))].join(",");
  return out;
}
function nextDocNo(code, category) {
  const prefix = `${code}-${CATEGORIES[category]}-`;
  const max = Math.max(0, ...DB.documents.filter((d) => d.doc_no.startsWith(prefix))
    .map((d) => parseInt(d.doc_no.slice(prefix.length), 10) || 0));
  return prefix + String(max + 1).padStart(3, "0");
}
function touch(projectId, t) {
  const p = DB.projects.find((x) => x.id === projectId);
  if (p) p.updated_at = t;
}
async function createDocument(data) {
  if (!data.project_id) fail("프로젝트를 선택하세요.");
  const project = findProject(data.project_id);
  const d = validateDoc(data, false);
  const t = now();
  const doc = { id: ++DB.seq.document, project_id: project.id, doc_no: nextDocNo(project.code, d.category),
    ...d, current_version: 0, created_at: t, updated_at: t };
  DB.documents.push(doc);
  log("문서 등록", `${doc.doc_no} ${doc.title}`, project.id, doc.id);
  touch(project.id, t);
  // 최초 등록 시 v1 개정을 함께 생성한다.
  return addRevision(doc.id, { content: data.content, note: data.note || "최초 작성",
    author: d.author, file_name: data.file_name, file: data.file });
}
async function updateDocument(id, data) {
  const doc = findDoc(id);
  const d = validateDoc(data, true);
  delete d.category; // 분류는 문서 번호에 포함되므로 변경 불가
  const detail = d.status && d.status !== doc.status ? `상태 ${doc.status} → ${d.status}` : Object.keys(d).join(", ");
  const t = now();
  Object.assign(doc, d, { updated_at: t });
  log("문서 수정", `${doc.doc_no} ${detail}`, doc.project_id, doc.id);
  touch(doc.project_id, t);
  await save();
  return getDocument(id);
}
async function deleteDocument(id) {
  const doc = findDoc(id);
  const keys = revisionsOf(doc.id).map((r) => r.file_key);
  DB.documents = DB.documents.filter((d) => d !== doc);
  DB.revisions = DB.revisions.filter((r) => r.document_id !== doc.id);
  log("문서 삭제", `${doc.doc_no} ${doc.title}`, doc.project_id);
  await save();
  await removeFiles(keys);
}

// ------------------------------------------------------------ revisions
async function addRevision(id, data) {
  const doc = findDoc(id);
  let file_name = "", file_key = "", file_size = 0;
  if (data.file) {
    file_name = clean(data.file_name) || data.file.name;
    file_key = crypto.randomUUID();
    file_size = data.file.size;
    await putFile(file_key, data.file);
  }
  const t = now();
  const version = doc.current_version + 1;
  DB.revisions.push({ id: ++DB.seq.revision, document_id: doc.id, version, content: clean(data.content),
    note: clean(data.note), author: clean(data.author) || doc.author, file_name, file_key, file_size, created_at: t });
  doc.current_version = version;
  doc.updated_at = t;
  if (version > 1) log("개정 등록", `${doc.doc_no} v${version}`, doc.project_id, doc.id);
  touch(doc.project_id, t);
  await save();
  return getDocument(doc.id);
}
async function downloadRevisionFile(revId) {
  const r = DB.revisions.find((x) => x.id === Number(revId) && x.file_key) || fail("첨부 파일이 없습니다.");
  const blob = await getFile(r.file_key);
  if (!blob) fail("첨부 파일이 저장소에 없습니다.");
  downloadBlob(blob, r.file_name);
}

// ------------------------------------------------------- dashboard, csv
function countBy(list, key) {
  return list.reduce((acc, x) => ((acc[x[key]] = (acc[x[key]] || 0) + 1), acc), {});
}
function stats() {
  return {
    project_count: DB.projects.length, document_count: DB.documents.length, revision_count: DB.revisions.length,
    projects_by_status: countBy(DB.projects, "status"),
    documents_by_status: countBy(DB.documents, "status"),
    documents_by_category: countBy(DB.documents, "category"),
    recent_activity: DB.activity.slice(-15).reverse(),
  };
}
function exportCsv(project_id) {
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["문서번호", "프로젝트", "제목", "분류", "상태", "작성자", "태그", "현재버전", "등록일", "수정일"]];
  for (const d of listDocuments({ project_id }))
    rows.push([d.doc_no, `[${d.project_code}] ${d.project_name}`, d.title, d.category, d.status, d.author,
      d.tags, `v${d.current_version}`, d.created_at, d.updated_at]);
  // 엑셀에서 한글이 깨지지 않도록 BOM 추가
  downloadBlob(new Blob(["﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" }), "문서대장.csv");
}

// ------------------------------------------------------- backup/restore
const toBase64 = (blob) => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(r.result.split(",")[1] || "");
  r.onerror = () => no(r.error);
  r.readAsDataURL(blob);
});
async function exportBackup() {
  const files = {};
  for (const r of DB.revisions.filter((x) => x.file_key)) {
    const blob = await getFile(r.file_key);
    if (blob) files[r.file_key] = { type: blob.type, data: await toBase64(blob) };
  }
  const stamp = now().slice(0, 10);
  downloadBlob(new Blob([JSON.stringify({ app: "project-docmanager", version: 1, state: DB, files })],
    { type: "application/json" }), `문서관리_백업_${stamp}.json`);
}
async function importBackup(file) {
  let backup;
  try { backup = JSON.parse(await file.text()); } catch { fail("백업 파일을 읽을 수 없습니다."); }
  if (backup?.app !== "project-docmanager" || !backup.state?.projects) fail("올바른 백업 파일이 아닙니다.");
  await req(tx("files", "readwrite").clear());
  for (const [key, f] of Object.entries(backup.files || {})) {
    const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    await putFile(key, new Blob([bytes], { type: f.type }));
  }
  DB = { ...EMPTY_STATE(), ...backup.state };
  await save();
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// ------------------------------------------------------ API 라우터
const ROUTES = [
  ["GET", /^\/api\/meta$/, () => ({ project_statuses: PROJECT_STATUSES, doc_statuses: DOC_STATUSES,
    categories: Object.keys(CATEGORIES) })],
  ["GET", /^\/api\/stats$/, () => stats()],
  ["GET", /^\/api\/projects$/, () => listProjects()],
  ["POST", /^\/api\/projects$/, (b) => createProject(b)],
  ["PUT", /^\/api\/projects\/(\d+)$/, (b, q, id) => updateProject(id, b)],
  ["DELETE", /^\/api\/projects\/(\d+)$/, (b, q, id) => deleteProject(id)],
  ["GET", /^\/api\/documents$/, (b, q) => listDocuments(q)],
  ["POST", /^\/api\/documents$/, (b) => createDocument(b)],
  ["GET", /^\/api\/documents\/(\d+)$/, (b, q, id) => getDocument(id)],
  ["PUT", /^\/api\/documents\/(\d+)$/, (b, q, id) => updateDocument(id, b)],
  ["DELETE", /^\/api\/documents\/(\d+)$/, (b, q, id) => deleteDocument(id)],
  ["POST", /^\/api\/documents\/(\d+)\/revisions$/, (b, q, id) => addRevision(id, b)],
];
let ready;
async function api(path, options = {}) {
  await (ready ||= openDb());
  const [pathname, search = ""] = path.split("?");
  const method = options.method || "GET";
  for (const [m, re, fn] of ROUTES) {
    const match = pathname.match(re);
    if (match && m === method) {
      const result = await fn(options.body || {}, Object.fromEntries(new URLSearchParams(search)), ...match.slice(1));
      return result ?? { ok: true };
    }
  }
  fail("API를 찾을 수 없습니다.");
}
