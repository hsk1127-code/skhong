// ---------------------------------------------------------------------------
// 데이터 저장소: 브라우저 IndexedDB 에 프로젝트 데이터(JSON)와 첨부 파일(Blob)을 보관한다.
// ---------------------------------------------------------------------------
const Store = (() => {
  const DB_NAME = "project-docs";
  let idb;
  let state;
  let saveTimer, savePromise;
  const listeners = new Set();

  const emptyState = () => ({ version: 1, projects: [], files: {}, settings: { user: "", lastBackup: "" } });

  const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });
  const store = (name, mode = "readonly") => idb.transaction(name, mode).objectStore(name);

  async function open() {
    const o = indexedDB.open(DB_NAME, 1);
    o.onupgradeneeded = () => {
      o.result.createObjectStore("state");
      o.result.createObjectStore("blobs");
    };
    idb = await req(o);
    state = (await req(store("state").get("main"))) || emptyState();
    state.settings ||= { user: "", lastBackup: "" };
    state.files ||= {};
    navigator.storage?.persist?.().catch(() => {}); // 브라우저가 임의로 데이터를 지우지 않도록 요청
  }

  // 변경 후 호출: 잠시 모아서 한 번에 저장한다.
  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
    listeners.forEach((fn) => fn());
  }
  function flush() {
    clearTimeout(saveTimer);
    savePromise = req(store("state", "readwrite").put(state, "main"));
    return savePromise;
  }

  // ------------------------------------------------------------ files
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  async function addFile(blob, name) {
    const id = uid();
    await req(store("blobs", "readwrite").put(blob, id));
    state.files[id] = { name: name || blob.name || "파일", type: blob.type || "", size: blob.size, added: today() };
    return id;
  }
  const fileMeta = (id) => state.files[id];
  const getBlob = (id) => req(store("blobs").get(id));

  // 어디에서도 참조하지 않는 첨부 파일 정리
  async function gc() {
    const used = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
      else if (typeof v === "string" && state.files[v]) used.add(v);
    };
    walk(state.projects);
    const dead = Object.keys(state.files).filter((id) => !used.has(id));
    if (!dead.length) return;
    const s = store("blobs", "readwrite");
    dead.forEach((id) => { s.delete(id); delete state.files[id]; });
    await flush();
  }

  // ------------------------------------------------------------ projects
  function newProject(name) {
    const t = today();
    return {
      id: uid(), created: t, updated: t,
      overview: { name: name || "새 프로젝트", project: "", projectNo: "", partNo: "", customer: "",
        receiveDate: "", receivePlace: "", scope: "", warranty: "", status: "진행", manager: state.settings.user || "",
        orderDate: "", orderAmount: "", estimateCost: "", targetCost: "", actualCost: "", costV2: true, vat: "별도", payments: [], extra: [],
        kickoffDate: "", setupDate: "", warrantyStart: "", warrantyYears: "", paidDate: "" },
      report: { summary: "", issues: "", warrantyNote: "", completedDate: "" },
      schedule: [],
      records: [],
      meetings: [],
      lists: { sw: [], hw: [], supplied: [], consumables: [], bom: [], submissions: [], changes: [] },
      hwImages: [], hwNote: "",
      revisions: [{ id: uid(), date: t, author: state.settings.user || "", content: "신규 작성", note: "" }],
    };
  }

  // 변경 저장 (Revision 은 남기지 않음)
  function touch(p) {
    p.updated = today();
    changed();
  }
  // Revision 기록: 자료 이력·회의록이 추가될 때만 사용
  function addRevision(p, content, note = "") {
    p.revisions.push({ id: uid(), date: today(), author: state.settings.user || "", content, note });
    touch(p);
  }

  // ------------------------------------------------------------ backup
  async function exportBackup() {
    await flush();
    const files = [{ name: "data.json", data: JSON.stringify({ app: "project-docs", version: 1, state }) }];
    for (const id of Object.keys(state.files)) {
      const blob = await getBlob(id);
      if (blob) files.push({ name: `files/${id}`, data: blob, compress: !/^(image|video)\//.test(blob.type) });
    }
    state.settings.lastBackup = today();
    await flush();
    listeners.forEach((fn) => fn());
    return Zip.write(files);
  }

  async function importBackup(file) {
    const zip = await Zip.read(file);
    if (!zip["data.json"]) throw new Error("올바른 백업 파일이 아닙니다.");
    const data = JSON.parse(await zip["data.json"].text());
    if (data.app !== "project-docs" || !data.state?.projects) throw new Error("올바른 백업 파일이 아닙니다.");
    await req(store("blobs", "readwrite").clear());
    for (const [id, meta] of Object.entries(data.state.files || {})) {
      const entry = zip[`files/${id}`];
      if (!entry) continue;
      // 압축 해제를 먼저 끝낸 뒤 저장 (await 중에는 IndexedDB 트랜잭션이 닫힘)
      const blob = new Blob([await entry.bytes()], { type: meta.type });
      await req(store("blobs", "readwrite").put(blob, id));
    }
    state = data.state;
    await flush();
    listeners.forEach((fn) => fn());
  }

  return {
    open, flush, changed, touch, addRevision, uid, addFile, fileMeta, getBlob, gc, newProject, exportBackup, importBackup,
    get state() { return state; },
    get projects() { return state.projects; },
    project: (id) => state.projects.find((p) => p.id === id),
    onChange: (fn) => listeners.add(fn),
  };
})();

// ------------------------------------------------------------- 날짜 유틸
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const dayNo = (s) => Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const fmtDot = (s) => (isDate(s) ? s.replace(/-/g, ".") : s || "");
