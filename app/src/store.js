// ---------------------------------------------------------------------------
// 데이터 저장소: 브라우저 IndexedDB 에 프로젝트 데이터(JSON)와 첨부 파일(Blob)을 보관한다.
// ---------------------------------------------------------------------------
const Store = (() => {
  const DB_NAME = "project-docs";
  let idb;
  let state;
  let saveTimer, savePromise;
  // 여러 창(탭)에서 열었을 때 덮어쓰기 방지: 이 창에서 바꾼 것이 있을 때만 저장(dirty),
  // 저장할 때마다 번호(rev)를 올리고, 저장소의 번호가 이 창이 읽은 번호보다 크면 덮어쓰지 않고 새로 읽음
  let dirty = false, baseRev = 0;
  const listeners = new Set(), conflictListeners = new Set();
  let channel = null;
  try { channel = new BroadcastChannel("project-docs-sync"); } catch {}

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
    baseRev = state.rev || 0;
    navigator.storage?.persist?.().catch(() => {}); // 브라우저가 임의로 데이터를 지우지 않도록 요청
  }

  // 변경 후 호출: 잠시 모아서 한 번에 저장한다.
  function changed() {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 250);
    listeners.forEach((fn) => fn());
  }
  // force: 복원처럼 저장소 내용을 일부러 통째로 바꿀 때
  function flush(force = false) {
    clearTimeout(saveTimer);
    if (!dirty && !force) return savePromise || Promise.resolve();
    savePromise = new Promise((ok, no) => {
      const tx = idb.transaction("state", "readwrite"), s = tx.objectStore("state");
      let result = "saved";
      const g = s.get("main");
      g.onsuccess = () => {
        const cur = g.result;
        if (!force && cur && (cur.rev || 0) > baseRev) {
          // 다른 창이 더 새 내용을 저장함 → 이 창의 오래된 내용으로 덮어쓰지 않고 새 내용을 받음
          state = cur; state.settings ||= { user: "", lastBackup: "" }; state.files ||= {};
          baseRev = cur.rev || 0; dirty = false; result = "conflict";
          return;
        }
        state.rev = Math.max(baseRev, cur?.rev || 0) + 1;
        s.put(state, "main");
        baseRev = state.rev; dirty = false;
      };
      tx.oncomplete = () => {
        if (result === "saved") channel?.postMessage({ type: "saved", rev: baseRev });
        else conflictListeners.forEach((fn) => fn());
        ok(result);
      };
      tx.onerror = () => no(tx.error);
    });
    return savePromise;
  }
  // 다른 창이 저장하면: 이 창에서 고치던 것이 없을 때 새 내용을 다시 읽음
  async function reloadIfNewer() {
    if (dirty) return false;
    const cur = await req(store("state").get("main"));
    if (!cur || (cur.rev || 0) <= baseRev) return false;
    state = cur; state.settings ||= { user: "", lastBackup: "" }; state.files ||= {};
    baseRev = cur.rev || 0;
    return true;
  }
  if (channel) channel.onmessage = async (e) => { if (e.data?.type === "saved" && (await reloadIfNewer())) listeners.forEach((fn) => fn("reload")); };

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
    // 다른 창이 더 새 내용을 저장했으면 이 창 기준으로 파일을 지우지 않음
    const cur = await req(store("state").get("main"));
    if (cur && (cur.rev || 0) > baseRev) return;
    walk(state.projects);
    const dead = Object.keys(state.files).filter((id) => !used.has(id));
    if (!dead.length) return;
    dirty = true;
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
        receiveDate: "", receivePlace: "", scope: "", warranty: "", note: "", status: "진행", manager: state.settings.user || "",
        orderDate: "", orderAmount: "", estimateCost: "", targetCost: "", actualCost: "", md: {}, mdRate: "", laborCost: "", overheadRate: "", warrantyRate: "", costV2: true, vat: "별도", payments: [], extra: [],
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
  // Revision 기록: 자료 이력·회의록이 추가될 때만 사용. ref = 그 자료/회의록 id (제목을 고치면 따라 바뀜)
  function addRevision(p, content, note = "", ref = "") {
    p.revisions.push({ id: uid(), date: today(), author: state.settings.user || "", content, note, ref });
    touch(p);
  }
  // 자료/회의록 제목·날짜를 고치면 연결된 Revision 도 고침 (예전 기록은 이전 제목으로 찾아 연결)
  function syncRevision(p, ref, oldTitle, content, note) {
    for (const r of p.revisions) {
      if (r.ref === ref || (!r.ref && oldTitle && r.content === oldTitle)) {
        r.ref = ref;
        r.content = content;
        if (note != null) r.note = note;
      }
    }
    touch(p);
  }

  // 데이터와 별도로 보관하는 값 (백업 폴더 핸들 등, 백업 파일에는 넣지 않음)
  const getKV = (key) => req(store("state").get(key));
  const putKV = (key, v) => req(store("state", "readwrite").put(v, key));

  // ------------------------------------------------------------ backup
  async function exportBackup() {
    await flush();
    const files = [{ name: "data.json", data: JSON.stringify({ app: "project-docs", version: 1, state }) }];
    for (const id of Object.keys(state.files)) {
      const blob = await getBlob(id);
      if (blob) files.push({ name: `files/${id}`, data: blob, compress: !/^(image|video)\//.test(blob.type) });
    }
    state.settings.lastBackup = today();
    dirty = true;
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
    dirty = true;
    await flush(true);
    listeners.forEach((fn) => fn());
  }

  return {
    open, flush, changed, touch, getKV, putKV, addRevision, syncRevision, uid, addFile, fileMeta, getBlob, gc, newProject, exportBackup, importBackup,
    get state() { return state; },
    get projects() { return state.projects; },
    project: (id) => state.projects.find((p) => p.id === id),
    onChange: (fn) => listeners.add(fn),
    onConflict: (fn) => conflictListeners.add(fn),
    get dirty() { return dirty; },
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
