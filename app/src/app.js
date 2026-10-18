// ---------------------------------------------------------------------------
// 화면
// ---------------------------------------------------------------------------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const dday = (d) => {
  if (!isDate(d)) return "";
  const n = dayNo(d) - dayNo(today());
  return n === 0 ? "D-Day" : n > 0 ? `D-${n}` : `D+${-n}`;
};
const badge = (s, cls = "") => `<span class="badge s-${esc(s)} ${cls}">${esc(s)}</span>`;
const opts = (list, sel) => list.map((v) => `<option ${v === sel ? "selected" : ""}>${esc(v)}</option>`).join("");

function toast(msg, ms = 2400) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), ms);
}
function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function busy(msg, fn) {
  const el = $("#busy");
  $("#busyMsg").textContent = msg;
  el.hidden = false;
  try { return await fn((m) => ($("#busyMsg").textContent = m)); }
  catch (e) { console.error(e); toast("오류: " + e.message, 5000); }
  finally { el.hidden = true; }
}

// ------------------------------------------------------------- 라우팅
const TABS = [
  ["overview", "개요"], ["schedule", "일정"], ["records", "자료 이력"], ["meetings", "회의록"], ["spec", "사양"],
  ["parts", "자재 (BOM)"], ["submissions", "제출 자료"], ["changes", "변경사항"], ["revisions", "Revision"],
];
let route = { view: "home" };
try { route = JSON.parse(localStorage.getItem("pd.route")) || route; } catch {}
function go(r) {
  route = r;
  try { localStorage.setItem("pd.route", JSON.stringify(route)); } catch {}
  render();
  $("#main").scrollTop = 0;
}
function render() {
  renderSidebar();
  const p = route.view === "project" && Store.project(route.id);
  if (route.view === "project" && !p) route = { view: "home" };
  if (route.view === "search") renderSearch();
  else if (p) renderProject(p);
  else renderHome();
}

// ------------------------------------------------------------- 사이드바
function renderSidebar() {
  const s = Store.state.settings;
  const projects = [...Store.projects].sort((a, b) =>
    PROJECT_STATUSES.indexOf(a.overview.status) - PROJECT_STATUSES.indexOf(b.overview.status) || b.updated.localeCompare(a.updated));
  const days = s.lastBackup ? dayNo(today()) - dayNo(s.lastBackup) : null;
  const warn = Store.projects.length && (days === null || days >= 7);
  $("#side").innerHTML = `
    <div class="brand">📁 프로젝트 자료 관리</div>
    <input id="globalSearch" type="search" placeholder="전체 검색 (자료, 회의록, BOM…)" value="${esc(route.view === "search" ? route.q : "")}">
    <button class="nav ${route.view === "home" ? "active" : ""}" data-go="home">📊 통합 대시보드</button>
    <div class="side-head"><span>프로젝트 (${projects.length})</span>
      <span><button class="icon" id="importXlsx" title="기존 엑셀 파일로 프로젝트 만들기">📥</button><button class="icon" id="newProject" title="새 프로젝트">＋</button></span></div>
    <div class="plist">${projects.map((p) => `
      <button class="nav proj ${route.id === p.id && route.view === "project" ? "active" : ""}" data-project="${p.id}">
        <span class="dot s-${esc(p.overview.status)}"></span><span class="pname">${esc(p.overview.name)}</span>
        <small>${esc(p.overview.customer)}</small></button>`).join("") || `<div class="muted small pad">아직 프로젝트가 없습니다.</div>`}</div>
    <div class="side-foot">
      <label class="small muted">작성자 이름 <input id="userName" value="${esc(s.user)}" placeholder="예: 홍길동"></label>
      <div class="row2"><button class="btn sm" id="backupBtn">💾 백업</button><button class="btn sm" id="restoreBtn">📂 복원</button></div>
      <div class="small ${warn ? "warn" : "muted"}">${s.lastBackup ? `마지막 백업: ${esc(s.lastBackup)} (${days}일 전)` : "아직 백업하지 않았습니다"}</div>
    </div>`;
  $$("[data-go=home]").forEach((b) => (b.onclick = () => go({ view: "home" })));
  $$("[data-project]").forEach((b) => (b.onclick = () => go({ view: "project", id: b.dataset.project, tab: route.id === b.dataset.project ? route.tab : "overview" })));
  $("#newProject").onclick = newProjectDialog;
  $("#importXlsx").onclick = () => pickFiles(".xlsx", false, (f) => importXlsx(f[0]));
  $("#userName").onchange = (e) => { s.user = e.target.value.trim(); Store.changed(); };
  let h;
  $("#globalSearch").oninput = (e) => {
    clearTimeout(h);
    const q = e.target.value.trim();
    h = setTimeout(() => {
      if (q) { route = { view: "search", q }; renderSearch(); } else go({ view: "home" });
    }, 250);
  };
  $("#backupBtn").onclick = () => busy("백업 파일을 만드는 중…", async () => {
    download(await Store.exportBackup(), `프로젝트자료_백업_${today()}.zip`);
    toast("백업 파일을 저장했습니다. 안전한 곳(공유 폴더 등)에 보관하세요.", 4000);
  });
  $("#restoreBtn").onclick = () => pickFiles(".zip", false, (f) => {
    if (!confirm("현재 저장된 모든 데이터를 지우고 백업 파일 내용으로 바꿀까요?")) return;
    busy("복원하는 중…", async () => { await Store.importBackup(f[0]); go({ view: "home" }); toast("복원했습니다."); });
  });
}

function pickFiles(accept, multiple, cb) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.onchange = () => input.files.length && cb(Array.from(input.files));
  input.click();
}

function newProjectDialog() {
  openDialog(`<h3>새 프로젝트</h3>
    <div class="form"><label>설비/품목명 *<input name="name" required placeholder="예: 톱텍_마힌드라"></label>
    <label>고객사<input name="customer"></label>
    <label>Project<input name="project" placeholder="예: 고객사 커스텀 AMR 도입"></label></div>
    <p class="muted small">기존에 쓰던 엑셀 파일이 있다면 왼쪽 📥 버튼으로 불러오면 시트 내용이 자동으로 정리됩니다.</p>`,
  (form) => {
    const p = Store.newProject(form.name.value.trim());
    p.overview.customer = form.customer.value.trim();
    p.overview.project = form.project.value.trim();
    Store.projects.push(p);
    Store.changed();
    go({ view: "project", id: p.id, tab: "overview" });
  });
}

async function importXlsx(file) {
  await busy("엑셀 파일을 불러오는 중…", async (progress) => {
    const p = await importWorkbook(file, progress);
    Store.projects.push(p);
    Store.changed();
    await Store.flush();
    go({ view: "project", id: p.id, tab: "overview" });
    toast(`가져오기 완료: 자료 ${p.records.length}건, 회의록 ${p.meetings.length}건, 일정 ${p.schedule.length}건`, 5000);
  });
}

// ------------------------------------------------------------- 공통 대화상자
function openDialog(html, onSubmit, { wide = false, okLabel = "저장", onOpen } = {}) {
  const dlg = document.createElement("dialog");
  dlg.className = wide ? "wide" : "";
  dlg.innerHTML = `<form method="dialog">${html}<div class="actions"><button type="button" class="btn" data-cancel>취소</button>
    <button class="btn primary">${okLabel}</button></div></form>`;
  document.body.appendChild(dlg);
  const form = $("form", dlg);
  $("[data-cancel]", dlg).onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { if ((await onSubmit(form, dlg)) !== false) dlg.close(); }
    catch (err) { toast(err.message, 4000); }
  };
  dlg.addEventListener("close", () => { dlg.remove(); Store.gc(); });
  onOpen?.(dlg, form);
  dlg.showModal();
  return dlg;
}

// ------------------------------------------------------------- 첨부 파일 표시/선택
function fileChips(ids, { removable = false } = {}) {
  return (ids || []).map((id) => {
    const m = Store.fileMeta(id);
    if (!m) return "";
    return `<span class="chip" data-file="${id}" title="${esc(m.name)} (${fmtSize(m.size)})">${fileIcon(m)} ${esc(m.name)}
      ${removable ? `<button type="button" class="x" data-remove="${id}">✕</button>` : ""}</span>`;
  }).join("");
}
const fileIcon = (m) => (m.type.startsWith("image/") ? "🖼" : /sheet|excel/.test(m.type) || /\.xlsx?$/i.test(m.name) ? "📊"
  : /presentation|powerpoint/.test(m.type) || /\.pptx?$/i.test(m.name) ? "📽" : /pdf/.test(m.type) ? "📕" : "📎");
const urlCache = new Map();
async function blobUrl(id) {
  if (!urlCache.has(id)) {
    const blob = await Store.getBlob(id);
    if (!blob) return "";
    urlCache.set(id, URL.createObjectURL(blob));
  }
  return urlCache.get(id);
}
function thumbs(ids, { removable = false } = {}) {
  return (ids || []).filter((id) => Store.fileMeta(id)?.type.startsWith("image/")).map((id) =>
    `<span class="thumb" data-view="${id}"><img data-src="${id}" alt="${esc(Store.fileMeta(id).name)}">
      ${removable ? `<button type="button" class="x" data-remove="${id}">✕</button>` : ""}</span>`).join("");
}
async function loadImages(root = document) {
  for (const img of $$("img[data-src]", root)) {
    if (!img.src) img.src = await blobUrl(img.dataset.src);
  }
}
async function openFile(id) {
  const m = Store.fileMeta(id);
  const blob = await Store.getBlob(id);
  if (!blob) return toast("파일을 찾을 수 없습니다.");
  if (m.type.startsWith("image/")) return lightbox([id], 0);
  if (m.type === "application/pdf") return window.open(await blobUrl(id), "_blank");
  download(blob, m.name);
}
function lightbox(ids, index) {
  const box = document.createElement("div");
  box.className = "lightbox";
  const show = async () => {
    const id = ids[index], m = Store.fileMeta(id);
    box.innerHTML = `<div class="lb-bar"><span>${esc(m.name)} · ${index + 1}/${ids.length}</span>
      <span><button class="btn sm" data-dl>⬇ 저장</button> <button class="btn sm" data-close>닫기 ✕</button></span></div>
      ${ids.length > 1 ? `<button class="lb-nav prev">‹</button><button class="lb-nav next">›</button>` : ""}
      <div class="lb-img"><img src="${await blobUrl(id)}"></div>`;
  };
  box.onclick = async (e) => {
    if (e.target.matches("[data-close]") || e.target === box || e.target.classList.contains("lb-img")) close();
    else if (e.target.matches(".prev")) { index = (index - 1 + ids.length) % ids.length; show(); }
    else if (e.target.matches(".next")) { index = (index + 1) % ids.length; show(); }
    else if (e.target.matches("[data-dl]")) download(await Store.getBlob(ids[index]), Store.fileMeta(ids[index]).name);
    else if (e.target.tagName === "IMG") e.target.classList.toggle("zoom");
  };
  const key = (e) => {
    if (e.key === "Escape") close();
    if (e.key === "ArrowLeft" && ids.length > 1) { index = (index - 1 + ids.length) % ids.length; show(); }
    if (e.key === "ArrowRight" && ids.length > 1) { index = (index + 1) % ids.length; show(); }
  };
  const close = () => { box.remove(); document.removeEventListener("keydown", key); };
  document.addEventListener("keydown", key);
  document.body.appendChild(box);
  show();
}
document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-file]");
  if (chip && !e.target.matches("[data-remove]")) return openFile(chip.dataset.file);
  const th = e.target.closest("[data-view]");
  if (th && !e.target.matches("[data-remove]")) {
    const ids = $$("[data-view]", th.parentNode).map((x) => x.dataset.view);
    lightbox(ids, ids.indexOf(th.dataset.view));
  }
});

// 파일 받기 영역: 붙여넣기(Ctrl+V), 끌어다 놓기, 선택 버튼. onFiles(파일 목록) 호출
function attachDropzone(zone, onFiles, root = zone) {
  const handle = async (files) => {
    files = files.filter(Boolean);
    if (files.length) await onFiles(files);
  };
  root.addEventListener("paste", (e) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (!files.length) return;
    e.preventDefault();
    handle(files.map((f, i) => (f.name === "image.png" || !f.name ? new File([f], `캡처_${today()}_${i + 1}.png`, { type: f.type }) : f)));
  });
  zone.addEventListener("dragover", (e) => { e.preventDefault(); zone.classList.add("over"); });
  zone.addEventListener("dragleave", () => zone.classList.remove("over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("over");
    handle(Array.from(e.dataTransfer.files));
  });
  $("[data-pick]", zone)?.addEventListener("click", () => pickFiles("*/*", true, handle));
}
const DROPZONE = (label = "캡처 이미지를 <b>Ctrl+V</b>로 붙여넣거나, 파일을 끌어다 놓으세요") =>
  `<div class="dropzone" tabindex="0" title="이곳을 클릭한 뒤 Ctrl+V 로 붙여넣을 수 있습니다">${label} <button type="button" class="btn sm" data-pick>파일 선택</button></div>`;

// ------------------------------------------------------------- 대시보드
function renderHome() {
  const base = today();
  const all = Store.projects.map((p) => ({ p, s: projectSummary(p, base) }));
  const active = all.filter((x) => x.p.overview.status !== "완료");
  const soon = [], delayed = [], actions = [], subs = [];
  for (const { p, s } of active) {
    for (const t of p.schedule) {
      const i = taskInfo(t, base);
      if (i.status === "지연") delayed.push({ p, t });
      else if (!t.done && isDate(t.start) && isDate(t.end)) {
        // 2주 안에 시작하거나 끝나는 일정
        const ds = dayNo(t.start) - dayNo(base), de = dayNo(t.end) - dayNo(base);
        if (ds >= 0 && ds <= 14) soon.push({ p, t, i, when: t.start, what: "시작" });
        else if (de >= 0 && de <= 14) soon.push({ p, t, i, when: t.end, what: "종료" });
      }
    }
    s.openActions.forEach((a) => actions.push({ p, a }));
    s.pendingSubmissions.forEach((r) => subs.push({ p, r }));
  }
  soon.sort((a, b) => a.when.localeCompare(b.when));
  const recent = Store.projects.flatMap((p) => p.records.map((r) => ({ p, r }))).sort((a, b) => b.r.date.localeCompare(a.r.date)).slice(0, 8);
  const goto = (p, tab) => `data-goto="${p.id}" data-tab="${tab}"`;

  $("#main").innerHTML = `
    <div class="page-head"><h1>통합 대시보드</h1><span class="muted">기준일 ${esc(base)}</span></div>
    ${!Store.projects.length ? `<div class="card empty-big">
      <h2>시작하기</h2><p>왼쪽의 <b>📥</b> 버튼으로 지금 쓰고 있는 프로젝트 엑셀 파일을 불러오거나, <b>＋</b> 버튼으로 새 프로젝트를 만드세요.</p>
      <p class="muted small">엑셀을 불러오면 개요·일정·BOM·회의록·날짜별 문의/자료 시트(캡처 이미지와 첨부 원본 포함)가 자동으로 정리됩니다.</p>
      <div class="row2 center"><button class="btn primary" id="homeImport">📥 엑셀 불러오기</button><button class="btn" id="homeNew">＋ 새 프로젝트</button></div></div>` : `
    <div class="kpis">
      <div class="card kpi"><span>진행 중 프로젝트</span><b>${active.length}</b></div>
      <div class="card kpi ${delayed.length ? "bad" : ""}"><span>지연된 일정</span><b>${delayed.length}</b></div>
      <div class="card kpi"><span>2주 내 일정</span><b>${soon.length}</b></div>
      <div class="card kpi ${actions.length ? "warn" : ""}"><span>미완료 실천 의제</span><b>${actions.length}</b></div>
      <div class="card kpi"><span>미제출 자료</span><b>${subs.length}</b></div>
    </div>
    <div class="pcards">${all.map(({ p, s }) => `
      <div class="card pcard" ${goto(p, "overview")}>
        <div class="between"><b class="ellipsis">${esc(p.overview.name)}</b>${badge(p.overview.status)}</div>
        <div class="muted small ellipsis">${esc(p.overview.customer || "-")} · ${esc(p.overview.project || "")}</div>
        ${s.progress !== null ? `<div class="progress"><span style="width:${s.progress}%"></span></div>
        <div class="between small"><span>${esc(fmtDot(s.start))} ~ ${esc(fmtDot(s.end))}</span><b>${dday(s.end)}</b></div>` : `<div class="muted small pad">일정 미등록</div>`}
        <div class="small chips-line">
          ${s.delayed.length ? `<span class="tag bad">지연 ${s.delayed.length}</span>` : ""}
          ${s.active.length ? `<span class="tag">진행 ${s.active.length}</span>` : ""}
          ${s.openActions.length ? `<span class="tag warn">의제 ${s.openActions.length}</span>` : ""}
          <span class="tag">자료 ${p.records.length}</span><span class="tag">회의록 ${p.meetings.length}</span>
        </div>
        ${s.next ? `<div class="small">다음: <b>${esc(s.next.name)}</b> <span class="muted">${esc(fmtDot(s.next.start))} (${dday(s.next.start)})</span></div>` : ""}
      </div>`).join("")}</div>
    <div class="grid2">
      <div class="card"><h3>⚠ 지연된 일정</h3>${delayed.length ? `<table class="list"><tbody>${delayed.map(({ p, t }) => `
        <tr ${goto(p, "schedule")}><td class="muted pcol">${esc(p.overview.name)}</td><td>${esc(t.phase)} · <b>${esc(t.name)}</b></td>
        <td>${esc(t.owner)}</td><td class="nowrap">${esc(fmtDot(t.end))} 종료</td><td class="bad nowrap">${dday(t.end)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">지연된 일정이 없습니다.</p>`}</div>
      <div class="card"><h3>📅 다가오는 일정 (2주 내 시작·종료)</h3>${soon.length ? `<table class="list"><tbody>${soon.map(({ p, t, when, what }) => `
        <tr ${goto(p, "schedule")}><td class="muted pcol">${esc(p.overview.name)}</td><td>${esc(t.phase)} · <b>${esc(t.name)}</b></td>
        <td>${esc(t.owner)}</td><td class="nowrap">${esc(fmtDot(when))} ${what}</td><td class="nowrap">${dday(when)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">2주 안에 시작하거나 끝나는 일정이 없습니다.</p>`}</div>
      <div class="card"><h3>✅ 미완료 실천 의제</h3>${actions.length ? `<table class="list"><tbody>${actions.map(({ p, a }) => `
        <tr><td><input type="checkbox" data-action="${p.id}|${a.meeting.id}|${a.id}" title="완료 처리"></td>
        <td ${goto(p, "meetings")} data-meeting="${a.meeting.id}"><b>${esc(a.text)}</b><div class="muted small">${esc(p.overview.name)} · ${esc(a.meeting.title)}</div></td>
        <td>${esc(a.owner)}</td><td class="nowrap">${esc(isDate(a.due) ? fmtDot(a.due) : a.due)}</td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">남은 실천 의제가 없습니다.</p>`}</div>
      <div class="card"><h3>📨 최근 자료</h3>${recent.length ? `<table class="list"><tbody>${recent.map(({ p, r }) => `
        <tr ${goto(p, "records")} data-record="${r.id}"><td class="nowrap muted">${esc(fmtDot(r.date))}</td><td>${badge(r.kind)}</td>
        <td><b>${esc(r.title)}</b><div class="muted small">${esc(p.overview.name)}</div></td></tr>`).join("")}</tbody></table>`
        : `<p class="muted">등록된 자료가 없습니다.</p>`}</div>
    </div>`}`;
  $("#homeImport")?.addEventListener("click", () => pickFiles(".xlsx", false, (f) => importXlsx(f[0])));
  $("#homeNew")?.addEventListener("click", newProjectDialog);
  bindGoto($("#main"));
  $$("[data-action]").forEach((cb) => (cb.onchange = () => {
    const [pid, mid, aid] = cb.dataset.action.split("|");
    const p = Store.project(pid);
    const a = p.meetings.find((m) => m.id === mid).actions.find((x) => x.id === aid);
    a.done = true;
    Store.touch(p);
    toast("완료 처리했습니다.");
    renderHome();
  }));
}
function bindGoto(root) {
  $$("[data-goto]", root).forEach((el) => (el.onclick = () =>
    go({ view: "project", id: el.dataset.goto, tab: el.dataset.tab, meeting: el.dataset.meeting, record: el.dataset.record })));
}

// ------------------------------------------------------------- 전체 검색
function renderSearch() {
  const q = route.q.toLowerCase();
  const hit = (...vals) => vals.some((v) => String(v ?? "").toLowerCase().includes(q));
  const results = [];
  for (const p of Store.projects) {
    const add = (tab, type, title, sub, extra = {}) => results.push({ p, tab, type, title, sub, extra });
    if (hit(...Object.values(p.overview).filter((v) => typeof v === "string"), ...p.overview.extra.map((x) => x.value)))
      add("overview", "개요", p.overview.name, p.overview.project);
    for (const r of p.records) if (hit(r.title, r.memo, r.from, r.to, r.kind, ...[...r.files, ...r.images].map((id) => Store.fileMeta(id)?.name)))
      add("records", "자료", r.title, `${fmtDot(r.date)} · ${r.kind}`, { record: r.id });
    for (const m of p.meetings) if (hit(m.title, m.content, m.attendees, m.notes, ...m.actions.map((a) => a.text + " " + a.owner)))
      add("meetings", "회의록", m.title, fmtDot(m.date), { meeting: m.id });
    for (const t of p.schedule) if (hit(t.phase, t.name, t.owner, t.note)) add("schedule", "일정", `${t.phase} · ${t.name}`, `${fmtDot(t.start)} ~ ${fmtDot(t.end)}`);
    for (const [key, def] of Object.entries(LISTS)) {
      const tab = { sw: "spec", hw: "spec", supplied: "parts", consumables: "parts", bom: "parts" }[key] || key;
      for (const r of listRows(p, key)) if (hit(...def.cols.map((c) => r[c.key])))
        add(tab, def.title, def.cols.map((c) => r[c.key]).filter(Boolean).slice(0, 3).join(" · "), "", { sub: key });
    }
  }
  $("#main").innerHTML = `<div class="page-head"><h1>검색: “${esc(route.q)}”</h1><span class="muted">${results.length}건</span></div>
    <div class="card">${results.length ? `<table class="list"><tbody>${results.map((r) => `
      <tr data-goto="${r.p.id}" data-tab="${r.tab}" ${r.extra.record ? `data-record="${r.extra.record}"` : ""} ${r.extra.meeting ? `data-meeting="${r.extra.meeting}"` : ""}>
      <td><span class="tag">${esc(r.type)}</span></td><td><b>${esc(r.title)}</b> <span class="muted small">${esc(r.sub)}</span></td>
      <td class="muted pcol">${esc(r.p.overview.name)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">검색 결과가 없습니다.</p>`}</div>`;
  bindGoto($("#main"));
}

// ------------------------------------------------------------- 프로젝트 화면
function renderProject(p) {
  const tab = TABS.some(([k]) => k === route.tab) ? route.tab : "overview";
  const s = projectSummary(p);
  const counts = { records: p.records.length, meetings: p.meetings.length, schedule: s.delayed.length ? `⚠${s.delayed.length}` : "",
    parts: p.lists.bom.length + p.lists.consumables.length + p.lists.supplied.length || "", submissions: s.pendingSubmissions.length || "",
    changes: p.lists.changes.length || "" };
  $("#main").innerHTML = `
    <div class="page-head">
      <div><h1>${esc(p.overview.name)} ${badge(p.overview.status)}</h1>
        <div class="muted">${esc(p.overview.customer)}${p.overview.project ? " · " + esc(p.overview.project) : ""}</div></div>
      <div class="row2">
        <button class="btn" id="exportXlsx" title="이 프로젝트를 기존 양식의 엑셀 파일로 저장">📊 엑셀로 내보내기</button>
        <button class="btn" id="exportZip" title="엑셀 + 첨부 원본 파일을 폴더 구조로 저장">🗂 전체 자료 ZIP</button>
      </div>
    </div>
    <nav class="tabs">${TABS.map(([k, label]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${label}${counts[k] ? ` <small>${counts[k]}</small>` : ""}</button>`).join("")}</nav>
    <section id="tab"></section>`;
  $$(".tabs button").forEach((b) => (b.onclick = () => go({ view: "project", id: p.id, tab: b.dataset.tab })));
  $("#exportXlsx").onclick = () => busy("엑셀 파일을 만드는 중…", async () => download(await buildWorkbook(p), `${p.overview.name}_${today()}.xlsx`));
  $("#exportZip").onclick = () => busy("ZIP 파일을 만드는 중…", async () => download(await buildProjectZip(p), `${p.overview.name}_${today()}.zip`));
  ({ overview: tabOverview, schedule: tabSchedule, records: tabRecords, meetings: tabMeetings, spec: tabSpec, parts: tabParts,
    submissions: (p, el) => el.innerHTML = gridCard(p, "submissions"), changes: (p, el) => el.innerHTML = gridCard(p, "changes"),
    revisions: (p, el) => el.innerHTML = gridCard(p, "revisions", "작업 내역이 자동으로 기록되며, 직접 추가할 수도 있습니다.") })[tab](p, $("#tab"));
  bindGrids(p, $("#tab"));
  loadImages($("#tab"));
}
// 같은 화면을 다시 그릴 때는 스크롤 위치 유지
function rerender() {
  const main = $("#main"), y = main.scrollTop;
  const scrollers = $$(".table-scroll", main).map((x) => x.scrollLeft);
  render();
  main.scrollTop = y;
  $$(".table-scroll", main).forEach((x, i) => (x.scrollLeft = scrollers[i] || 0));
}

// ------------------------------------------------------------- 개요
function tabOverview(p, el) {
  const o = p.overview;
  const s = projectSummary(p);
  el.innerHTML = `<div class="grid2 wide-left">
    <div class="card"><h3>프로젝트 개요</h3><div class="form ov" id="ovForm">
      <label class="full">설비/품목명<input data-k="name" value="${esc(o.name)}"></label>
      ${OVERVIEW_FIELDS.map(([k, label]) => k === "scope"
        ? `<label class="full">${label}<textarea data-k="${k}" rows="3">${esc(o[k])}</textarea></label>`
        : `<label>${label}<input data-k="${k}" ${k === "receiveDate" ? 'type="date"' : ""} value="${esc(o[k])}"></label>`).join("")}
      <label>상태<select data-k="status">${opts(PROJECT_STATUSES, o.status)}</select></label>
      <label>담당자<input data-k="manager" value="${esc(o.manager)}"></label>
    </div>
    <h3 style="margin-top:18px">추가 항목</h3>
    <div id="extra">${o.extra.map((x, i) => `<div class="extra-row"><input data-ex="${i}" data-f="label" value="${esc(x.label)}" placeholder="항목명">
      <input data-ex="${i}" data-f="value" value="${esc(x.value)}" placeholder="내용"><button class="icon" data-exdel="${i}">✕</button></div>`).join("")}</div>
    <button class="btn sm" id="addExtra">＋ 항목 추가</button>
    <div class="danger-zone"><button class="btn danger sm" id="delProject">프로젝트 삭제</button></div></div>
    <div class="card"><h3>현황</h3>
      ${s.progress !== null ? `<div class="between small"><span>${esc(fmtDot(s.start))}</span><span>${esc(fmtDot(s.end))}</span></div>
      <div class="progress big"><span style="width:${s.progress}%"></span></div><p>전체 기간 경과 <b>${s.progress}%</b> · 종료 ${dday(s.end)}</p>` : `<p class="muted">일정 탭에서 일정을 등록하면 진행률이 표시됩니다.</p>`}
      <ul class="stats">
        <li><span>지연 일정</span><b class="${s.delayed.length ? "bad" : ""}">${s.delayed.length}</b></li>
        <li><span>진행 중 일정</span><b>${s.active.length}</b></li>
        <li><span>다음 일정</span><b>${s.next ? `${esc(s.next.name)} (${esc(fmtDot(s.next.start))})` : "-"}</b></li>
        <li><span>자료 이력</span><b>${p.records.length}건</b></li>
        <li><span>회의록 / 미완료 의제</span><b>${p.meetings.length}건 / ${s.openActions.length}건</b></li>
        <li><span>BOM / 소모품 / 지정품</span><b>${p.lists.bom.length} / ${p.lists.consumables.length} / ${p.lists.supplied.length}</b></li>
        <li><span>미제출 자료</span><b>${s.pendingSubmissions.length}건</b></li>
        <li><span>변경사항</span><b>${p.lists.changes.length}건</b></li>
      </ul></div></div>`;
  $$("[data-k]", el).forEach((inp) => (inp.oninput = () => {
    o[inp.dataset.k] = inp.value;
    Store.touch(p);
    if (["name", "status", "customer"].includes(inp.dataset.k)) {
      renderSidebar();
      $(".page-head h1").innerHTML = `${esc(o.name)} ${badge(o.status)}`;
    }
  }));
  $$("[data-ex]", el).forEach((inp) => (inp.oninput = () => { o.extra[inp.dataset.ex][inp.dataset.f] = inp.value; Store.touch(p); }));
  $$("[data-exdel]", el).forEach((b) => (b.onclick = () => { o.extra.splice(b.dataset.exdel, 1); Store.touch(p); rerender(); }));
  $("#addExtra").onclick = () => { o.extra.push({ label: "", value: "" }); Store.touch(p); rerender(); };
  $("#delProject").onclick = async () => {
    if (!confirm(`'${o.name}' 프로젝트와 모든 자료·첨부 파일을 삭제할까요?\n(삭제 전 백업을 권장합니다)`)) return;
    Store.state.projects = Store.projects.filter((x) => x !== p);
    Store.changed();
    await Store.gc();
    go({ view: "home" });
  };
}

// ------------------------------------------------------------- 일정 (간트)
function tabSchedule(p, el) {
  const base = today();
  const dated = p.schedule.filter((t) => isDate(t.start) && isDate(t.end));
  let min = dated.length ? dayNo(dated.map((t) => t.start).sort()[0]) : dayNo(base) - 7;
  let max = dated.length ? dayNo(dated.map((t) => t.end).sort().pop()) : dayNo(base) + 60;
  min = Math.min(min, dayNo(base));
  max = Math.max(max, dayNo(base)) + 1;
  const span = max - min;
  const pct = (d) => ((d - min) / span) * 100;
  const months = [];
  for (let d = new Date(min * 86400000); d.getTime() / 86400000 < max; d.setUTCMonth(d.getUTCMonth() + 1, 1)) {
    const n = Math.round(d.getTime() / 86400000);
    months.push(`<span style="left:${Math.max(0, pct(n))}%">${d.getUTCFullYear() % 100}.${d.getUTCMonth() + 1}</span>`);
  }
  const todayLine = `<i class="today" style="left:${pct(dayNo(base))}%"></i>`;
  const s = projectSummary(p, base);
  const bar = (t, info) => isDate(t.start) && isDate(t.end)
    ? `<div class="bar st-${info.status}" style="left:${pct(dayNo(t.start))}%;width:${Math.max(0.6, ((dayNo(t.end) - dayNo(t.start) + 1) / span) * 100)}%" title="${esc(t.start)} ~ ${esc(t.end)}"></div>` : "";
  const row = (t, i) => {
    const info = taskInfo(t, base);
    return `<tr data-id="${t.id}" class="${t.phase !== p.schedule[i - 1]?.phase ? "phase-start" : ""}">
      <td><input type="checkbox" data-f="done" ${t.done ? "checked" : ""} title="완료"></td>
      <td><input data-f="phase" value="${esc(t.phase)}" class="w-phase"></td>
      <td><input data-f="name" value="${esc(t.name)}" class="w-name"></td>
      <td><input data-f="owner" value="${esc(t.owner)}" class="w-owner"></td>
      <td><input type="date" data-f="start" value="${esc(t.start)}"></td>
      <td><input type="date" data-f="end" value="${esc(t.end)}"></td>
      <td class="num" data-c="dur">${info.dur}</td><td class="num" data-c="elapsed">${info.elapsed}</td><td class="num" data-c="remain">${info.remain}</td>
      <td data-c="status">${badge(info.status)}</td>
      <td class="gantt">${todayLine}${bar(t, info)}</td>
      <td><input data-f="note" value="${esc(t.note)}" class="w-note"></td>
      <td class="nowrap"><button class="icon" data-move="-1" title="위로">↑</button><button class="icon" data-move="1" title="아래로">↓</button><button class="icon" data-ins title="아래에 행 추가">＋</button><button class="icon" data-del title="삭제">✕</button></td></tr>`;
  };
  el.innerHTML = `<div class="card">
    <div class="between wrap"><div class="row2">
      <span>기준일 <b>${esc(base)}</b></span>
      ${s.progress !== null ? `<span>전체 <b>${esc(fmtDot(s.start))} ~ ${esc(fmtDot(s.end))}</b> (${s.progress}% 경과, ${dday(s.end)})</span>` : ""}
      ${s.delayed.length ? `<span class="bad">지연 ${s.delayed.length}건</span>` : ""}</div>
      <div class="row2"><span class="legend"><i class="st-완료"></i>완료 <i class="st-진행"></i>진행 <i class="st-예정"></i>예정 <i class="st-지연"></i>지연</span>
      <button class="btn primary sm" id="addTask">＋ 일정 추가</button></div></div>
    <p class="muted small">종료일이 지났는데 완료 체크가 없으면 <b class="bad">지연</b>으로 표시됩니다. 엑셀에서 여러 행을 복사해 붙여넣을 수도 있습니다.</p>
    <div class="table-scroll"><table class="sched grid-table" data-schedule>
      <thead><tr><th>✓</th><th>단계</th><th>세부사항</th><th>담당자</th><th>시작일</th><th>종료일</th><th>기간</th><th>경과</th><th>잔여</th><th>상태</th>
      <th class="gantt-head">${months.join("")}</th><th>비고</th><th></th></tr></thead>
      <tbody>${p.schedule.map(row).join("") || `<tr><td colspan="13" class="muted center pad">등록된 일정이 없습니다.</td></tr>`}</tbody></table></div></div>`;

  const tbody = $("tbody", el);
  const find = (tr) => p.schedule.find((t) => t.id === tr.dataset.id);
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const t = find(tr), f = e.target.dataset.f;
    t[f] = f === "done" ? e.target.checked : e.target.value;
    if (f === "start" && isDate(t.start) && (!isDate(t.end) || t.end < t.start)) { t.end = t.start; $("[data-f=end]", tr).value = t.end; }
    Store.touch(p);
    if (["done", "start", "end"].includes(f)) {
      const info = taskInfo(t, base);
      for (const k of ["dur", "elapsed", "remain"]) $(`[data-c=${k}]`, tr).textContent = info[k];
      $("[data-c=status]", tr).innerHTML = badge(info.status);
      $(".gantt", tr).innerHTML = todayLine + bar(t, info);
    }
  });
  tbody.addEventListener("change", (e) => { if (["start", "end"].includes(e.target.dataset.f)) rerender(); });
  tbody.addEventListener("click", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const i = p.schedule.findIndex((t) => t.id === tr.dataset.id);
    if (e.target.dataset.move) {
      const j = i + Number(e.target.dataset.move);
      if (j < 0 || j >= p.schedule.length) return;
      [p.schedule[i], p.schedule[j]] = [p.schedule[j], p.schedule[i]];
    } else if ("ins" in e.target.dataset) {
      const t = p.schedule[i];
      p.schedule.splice(i + 1, 0, { id: Store.uid(), phase: t.phase, name: "", owner: t.owner, note: "", start: t.end, end: t.end, done: false });
    } else if ("del" in e.target.dataset) {
      if (!confirm(`'${p.schedule[i].name}' 일정을 삭제할까요?`)) return;
      p.schedule.splice(i, 1);
    } else return;
    Store.touch(p);
    rerender();
  });
  $("#addTask").onclick = () => {
    const last = p.schedule[p.schedule.length - 1];
    p.schedule.push({ id: Store.uid(), phase: last?.phase || "", name: "", owner: "", note: "", start: base, end: base, done: false });
    Store.touch(p);
    rerender();
    const inputs = $$("[data-f=name]", $("#tab"));
    inputs[inputs.length - 1]?.focus();
  };
  bindTablePaste(tbody, ["phase", "name", "owner", "start", "end", "note"], p.schedule,
    () => ({ id: Store.uid(), phase: "", name: "", owner: "", note: "", start: "", end: "", done: false }),
    (k, v) => (k === "start" || k === "end" ? (isDate(v) ? v : dateFromText(v)) : v), () => { Store.touch(p); rerender(); });
}

// 엑셀에서 복사한 여러 행/열을 표에 붙여넣기
function bindTablePaste(tbody, keys, arr, makeRow, convert, done) {
  tbody.addEventListener("paste", (e) => {
    const text = e.clipboardData?.getData("text/plain") || "";
    const input = e.target.closest("[data-f]");
    if (!input || (!text.includes("\t") && !text.trim().includes("\n"))) return;
    const startCol = keys.indexOf(input.dataset.f);
    if (startCol < 0) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    let idx = arr.findIndex((r) => r.id === input.closest("tr").dataset.id);
    for (const cells of lines) {
      if (idx >= arr.length) arr.push(makeRow());
      cells.forEach((v, c) => { const k = keys[startCol + c]; if (k) arr[idx][k] = convert(k, v.trim()); });
      idx++;
    }
    done();
    toast(`${lines.length}행을 붙여넣었습니다.`);
  });
}

// ------------------------------------------------------------- 공통 표(그리드)
function gridCard(p, key, help = "") {
  const def = LISTS[key];
  const rows = listRows(p, key);
  return `<div class="card" data-grid="${key}">
    <div class="between"><h3>${def.title} <span class="muted small">${rows.length}건</span></h3>
      <button class="btn primary sm" data-addrow>＋ 행 추가</button></div>
    ${help ? `<p class="muted small">${help}</p>` : `<p class="muted small">칸을 눌러 바로 수정합니다. 엑셀에서 여러 행을 복사해 칸에 붙여넣으면 한 번에 입력됩니다.</p>`}
    <div class="table-scroll"><table class="grid-table">
      <thead><tr><th class="num">NO</th>${def.cols.map((c) => `<th>${c.label}</th>`).join("")}${def.files ? "<th>첨부</th>" : ""}<th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-id="${r.id}"><td class="num muted">${i + 1}</td>${def.cols.map((c) => `<td>${gridInput(c, r[c.key])}</td>`).join("")}
        ${def.files ? `<td class="files-cell">${fileChips(r.files)}<button class="icon" data-attach title="파일 첨부">📎</button></td>` : ""}
        <td class="nowrap"><button class="icon" data-ins title="아래에 행 추가">＋</button><button class="icon" data-delrow title="삭제">✕</button></td></tr>`).join("")
        || `<tr><td colspan="${def.cols.length + 3}" class="muted center pad">내용이 없습니다. ＋ 행 추가를 누르거나 엑셀에서 붙여넣으세요.</td></tr>`}</tbody></table></div></div>`;
}
function gridInput(c, v) {
  v = v ?? "";
  if (c.type === "textarea") return `<textarea data-f="${c.key}" rows="1" style="min-width:${c.w * 7}px">${esc(v)}</textarea>`;
  if (c.type === "select") return `<select data-f="${c.key}">${opts(["", ...c.options], v)}</select>`;
  // 날짜 칸은 달력 아이콘까지 다 보이도록 고정 너비
  return `<input data-f="${c.key}" ${c.type === "date" ? 'type="date"' : c.type === "number" ? 'inputmode="decimal"' : ""} value="${esc(v)}" style="width:${c.type === "date" ? 150 : c.w * 8}px">`;
}
function bindGrids(p, root) {
  for (const card of $$("[data-grid]", root)) {
    const key = card.dataset.grid, def = LISTS[key];
    const rows = listRows(p, key);
    const blank = () => {
      const r = { id: Store.uid() };
      def.cols.forEach((c) => (r[c.key] = ""));
      if (def.files) r.files = [];
      if (key === "changes" || key === "revisions") { r.date = today(); r.author = Store.state.settings.user; }
      if (key === "submissions") r.status = "미제출";
      return r;
    };
    const tbody = $("tbody", card);
    tbody.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || !e.target.dataset.f) return;
      rows.find((r) => r.id === tr.dataset.id)[e.target.dataset.f] = e.target.value;
      Store.touch(p);
    });
    tbody.addEventListener("click", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const i = rows.findIndex((r) => r.id === tr.dataset.id);
      if ("delrow" in e.target.dataset) {
        if (!confirm(`${i + 1}번 행을 삭제할까요?`)) return;
        rows.splice(i, 1);
        Store.touch(p);
        Store.gc();
        rerender();
      } else if ("ins" in e.target.dataset) {
        rows.splice(i + 1, 0, blank());
        Store.touch(p);
        rerender();
      } else if ("attach" in e.target.dataset) {
        pickFiles("*/*", true, async (files) => {
          const r = rows[i];
          for (const f of files) r.files.push(await Store.addFile(f, f.name));
          Store.touch(p, `${def.title} 첨부: ${files.map((f) => f.name).join(", ")}`);
          rerender();
        });
      }
    });
    $("[data-addrow]", card).onclick = () => {
      rows.push(blank());
      Store.touch(p, key === "changes" ? "변경사항 추가" : "");
      rerender();
      const last = $$("tbody tr", $(`[data-grid=${key}]`)).pop();
      $("input, textarea", last)?.focus();
    };
    bindTablePaste(tbody, def.cols.map((c) => c.key), rows, blank,
      (k, v) => (def.cols.find((c) => c.key === k).type === "date" ? (isDate(v) ? v : dateFromText(v) || v) : v),
      () => { Store.touch(p); rerender(); });
  }
}

// ------------------------------------------------------------- 자료 이력
function tabRecords(p, el) {
  const f = route.recFilter || { kind: "", q: "" };
  const q = f.q.toLowerCase();
  const list = [...p.records].reverse().sort((a, b) => b.date.localeCompare(a.date))
    .filter((r) => (!f.kind || r.kind === f.kind) && (!q || [r.title, r.memo, r.from, r.to].some((v) => (v || "").toLowerCase().includes(q))));
  let lastDate = "";
  el.innerHTML = `<div class="between wrap toolbar">
      <div class="row2"><select id="recKind"><option value="">전체 구분</option>${opts(RECORD_KINDS, f.kind)}</select>
      <input id="recQ" type="search" placeholder="제목·내용 검색" value="${esc(f.q)}"></div>
      <button class="btn primary" id="addRecord">＋ 자료 등록</button></div>
    <p class="muted small">메일 캡처, 받은/보낸 자료, 문의·답변을 날짜별로 기록합니다. 엑셀에서 날짜를 붙인 시트로 관리하던 내용입니다.</p>
    ${list.length ? `<div class="timeline">${list.map((r) => {
      const dateHead = r.date !== lastDate ? `<div class="tl-date">${esc(fmtDot(r.date))}</div>` : "";
      lastDate = r.date;
      return `${dateHead}<div class="card rec ${route.record === r.id ? "focus" : ""}" id="rec-${r.id}">
        <div class="between"><div>${badge(r.kind)} <b class="rec-title">${esc(r.title)}</b>
          ${r.from || r.to ? `<span class="muted small"> ${esc(r.from)}${r.from && r.to ? " → " : ""}${esc(r.to)}</span>` : ""}</div>
          <span class="nowrap"><button class="btn sm" data-edit="${r.id}">수정</button> <button class="icon" data-delrec="${r.id}" title="삭제">✕</button></span></div>
        ${r.memo ? `<div class="memo">${nl2br(r.memo)}</div>` : ""}
        ${r.images.length ? `<div class="thumbs">${thumbs(r.images)}</div>` : ""}
        ${r.files.length ? `<div class="chips">${fileChips(r.files)}</div>` : ""}
      </div>`;
    }).join("")}</div>` : `<div class="card muted center pad">${p.records.length ? "조건에 맞는 자료가 없습니다." : "등록된 자료가 없습니다. ＋ 자료 등록을 눌러 메일 캡처나 받은 파일을 기록하세요."}</div>`}`;
  const setFilter = () => { route.recFilter = { kind: $("#recKind").value, q: $("#recQ").value }; tabRecords(p, el); loadImages(el); };
  $("#recKind").onchange = setFilter;
  let h;
  $("#recQ").oninput = () => { clearTimeout(h); h = setTimeout(() => { setFilter(); $("#recQ").focus(); const v = $("#recQ").value; $("#recQ").setSelectionRange(v.length, v.length); }, 250); };
  $("#addRecord").onclick = () => recordDialog(p);
  $$("[data-edit]", el).forEach((b) => (b.onclick = () => recordDialog(p, p.records.find((r) => r.id === b.dataset.edit))));
  $$("[data-delrec]", el).forEach((b) => (b.onclick = async () => {
    const r = p.records.find((x) => x.id === b.dataset.delrec);
    if (!confirm(`'${r.title}' 자료와 첨부 파일을 삭제할까요?`)) return;
    p.records = p.records.filter((x) => x !== r);
    Store.touch(p, `자료 삭제: ${r.title}`);
    await Store.gc();
    rerender();
  }));
  if (route.record) {
    $(`#rec-${route.record}`)?.scrollIntoView({ block: "center" });
    route.record = null;
  }
}

function recordDialog(p, rec) {
  const d = rec ? structuredClone(rec) : { id: Store.uid(), date: today(), kind: "자료", title: "", from: "", to: "", memo: "", images: [], files: [] };
  const refresh = (dlg) => {
    $(".att", dlg).innerHTML = `<div class="thumbs">${thumbs(d.images, { removable: true })}</div><div class="chips">${fileChips(d.files, { removable: true })}</div>`;
    loadImages(dlg);
  };
  openDialog(`<h3>${rec ? "자료 수정" : "자료 등록"}</h3>
    <div class="form">
      <label>날짜<input type="date" name="date" value="${esc(d.date)}" required></label>
      <label>구분<select name="kind">${opts(RECORD_KINDS, d.kind)}</select></label>
      <label class="full">제목 *<input name="title" value="${esc(d.title)}" required placeholder="예: 전장품 문의 답변"></label>
      <label>보낸 곳/사람<input name="from" value="${esc(d.from)}"></label>
      <label>받는 곳/사람<input name="to" value="${esc(d.to)}"></label>
      <label class="full">메모<textarea name="memo" rows="4" placeholder="요약, 회신 필요 사항 등">${esc(d.memo)}</textarea></label>
    </div>
    ${DROPZONE()}
    <p class="muted small">이미지는 화면에 바로 보이고, 그 밖의 파일(엑셀·PPT·PDF 등)은 첨부 파일로 보관됩니다.</p>
    <div class="att"></div>`,
  (form) => {
    Object.assign(d, { date: form.date.value, kind: form.kind.value, title: form.title.value.trim(), from: form.from.value.trim(),
      to: form.to.value.trim(), memo: form.memo.value });
    if (rec) Object.assign(rec, d);
    else p.records.push(d);
    Store.touch(p, rec ? `자료 수정: ${d.title}` : d.title, `자료 이력 · ${d.kind} (${fmtDot(d.date)})`);
    rerender();
  }, { wide: true, onOpen: (dlg) => {
    refresh(dlg);
    attachDropzone($(".dropzone", dlg), async (files) => {
      for (const f of files) (f.type.startsWith("image/") ? d.images : d.files).push(await Store.addFile(f, f.name));
      if (!dlg.querySelector("[name=title]").value && files[0]) dlg.querySelector("[name=title]").value = files[0].name.replace(/\.[^.]+$/, "");
      refresh(dlg);
    }, dlg);
    $(".att", dlg).addEventListener("click", (e) => {
      const id = e.target.dataset.remove;
      if (!id) return;
      e.stopPropagation();
      d.images = d.images.filter((x) => x !== id);
      d.files = d.files.filter((x) => x !== id);
      refresh(dlg);
    });
  } });
}

// ------------------------------------------------------------- 회의록
const MEETING_TEMPLATE = "1. 개요\n  ⅰ. 회의 목적 : \n  ⅱ. 회의 개요 : \n\n2. 논의 사항\n  ▶ \n\n3. 업무 진행 사항\n  ▶ ";
function tabMeetings(p, el) {
  const list = [...p.meetings].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const cur = p.meetings.find((m) => m.id === route.meeting) || list[0];
  el.innerHTML = `<div class="split">
    <div class="card mlist"><button class="btn primary full" id="addMeeting">＋ 새 회의록</button>
      ${list.map((m) => `<button class="mitem ${m === cur ? "active" : ""}" data-m="${m.id}"><b>${esc(m.title || "(제목 없음)")}</b>
        <span class="muted small">${esc(fmtDot(m.date))}${m.actions.some((a) => !a.done && a.text) ? ` · <span class="warn">의제 ${m.actions.filter((a) => !a.done && a.text).length}</span>` : ""}</span></button>`).join("")
        || `<p class="muted small pad">회의록이 없습니다.</p>`}</div>
    <div class="card" id="mEditor">${cur ? meetingForm(cur) : `<p class="muted">왼쪽에서 회의록을 선택하거나 새로 작성하세요.</p>`}</div></div>`;
  $$("[data-m]", el).forEach((b) => (b.onclick = () => { route.meeting = b.dataset.m; tabMeetings(p, el); loadImages(el); }));
  $("#addMeeting").onclick = () => {
    const m = { id: Store.uid(), title: "", dept: "", writer: Store.state.settings.user, date: today(), time: "", place: "", kind: "비정례",
      attendees: "", content: MEETING_TEMPLATE, actions: [{ id: Store.uid(), text: "", owner: "", due: "", done: false, note: "" }], notes: "", files: [] };
    p.meetings.push(m);
    route.meeting = m.id;
    Store.touch(p, "회의록 작성");
    tabMeetings(p, el);
    $("[data-mf=title]", el)?.focus();
  };
  if (!cur) return;
  const ed = $("#mEditor");
  ed.addEventListener("input", (e) => {
    const t = e.target;
    if (t.dataset.mf) cur[t.dataset.mf] = t.value;
    else if (t.dataset.af) {
      const a = cur.actions.find((x) => x.id === t.closest("tr").dataset.id);
      a[t.dataset.af] = t.type === "checkbox" ? t.checked : t.value;
    } else return;
    Store.touch(p);
    if (t.dataset.mf === "title" || t.dataset.mf === "date") $(`[data-m="${cur.id}"] b`, el).textContent = cur.title || "(제목 없음)";
  });
  ed.addEventListener("click", async (e) => {
    const t = e.target;
    if ("addAction" in t.dataset) { cur.actions.push({ id: Store.uid(), text: "", owner: "", due: "", done: false, note: "" }); }
    else if (t.dataset.delAction) { cur.actions = cur.actions.filter((a) => a.id !== t.dataset.delAction); }
    else if (t.dataset.remove) { e.stopPropagation(); cur.files = cur.files.filter((x) => x !== t.dataset.remove); await Store.gc(); }
    else if ("print" in t.dataset) return printMeeting(p, cur);
    else if ("delMeeting" in t.dataset) {
      if (!confirm(`'${cur.title}' 회의록을 삭제할까요?`)) return;
      p.meetings = p.meetings.filter((m) => m !== cur);
      route.meeting = null;
      Store.touch(p, `회의록 삭제: ${cur.title}`);
      await Store.gc();
    } else return;
    Store.touch(p);
    tabMeetings(p, el);
    loadImages(el);
  });
  attachDropzone($(".dropzone", ed), async (files) => {
    for (const f of files) cur.files.push(await Store.addFile(f, f.name));
    Store.touch(p, `회의록 첨부: ${files.map((f) => f.name).join(", ")}`);
    tabMeetings(p, el);
    loadImages(el);
  }, ed);
}
function meetingForm(m) {
  const f = (k, label, attrs = "") => `<label>${label}<input data-mf="${k}" value="${esc(m[k])}" ${attrs}></label>`;
  return `<div class="between"><h3>회의록</h3><span class="row2"><button class="btn sm" data-print>🖨 인쇄 / PDF</button>
      <button class="btn danger sm" data-del-meeting>삭제</button></span></div>
    <div class="form">
      <label class="full">제목<input data-mf="title" value="${esc(m.title)}" placeholder="예: 고객사 Kick-off"></label>
      ${f("dept", "부서명")}${f("writer", "작성자")}${f("date", "회의일자", 'type="date"')}${f("time", "회의시간", 'placeholder="15:00 ~ 18:00"')}
      ${f("place", "회의장소")}<label>구분<select data-mf="kind">${opts(["정례", "비정례"], m.kind)}</select></label>
      <label class="full">참석자<textarea data-mf="attendees" rows="2">${esc(m.attendees)}</textarea></label>
      <label class="full">회의 내용<textarea data-mf="content" rows="16" class="mono-ish">${esc(m.content)}</textarea></label>
    </div>
    <h3>실천 의제</h3>
    <table class="grid-table actions-table"><thead><tr><th>완료</th><th>지시 내용</th><th>담당자</th><th>기한</th><th>비고</th><th></th></tr></thead>
    <tbody>${m.actions.map((a) => `<tr data-id="${a.id}"><td class="center"><input type="checkbox" data-af="done" ${a.done ? "checked" : ""}></td>
      <td><input data-af="text" value="${esc(a.text)}" style="width:100%;min-width:220px"></td><td><input data-af="owner" value="${esc(a.owner)}" style="width:110px"></td>
      <td><input data-af="due" value="${esc(a.due)}" placeholder="YYYY-MM-DD" style="width:120px"></td><td><input data-af="note" value="${esc(a.note)}" style="width:140px"></td>
      <td><button class="icon" data-del-action="${a.id}">✕</button></td></tr>`).join("")}</tbody></table>
    <button class="btn sm" data-add-action>＋ 의제 추가</button>
    <div class="form" style="margin-top:12px"><label class="full">특이사항<textarea data-mf="notes" rows="2">${esc(m.notes)}</textarea></label></div>
    <h3>첨부</h3>${DROPZONE("회의 자료·사진을 <b>Ctrl+V</b>로 붙여넣거나 끌어다 놓으세요")}
    <div class="thumbs">${thumbs(m.files, { removable: true })}</div><div class="chips">${fileChips(m.files.filter((id) => !Store.fileMeta(id)?.type.startsWith("image/")), { removable: true })}</div>`;
}
function printMeeting(p, m) {
  const pr = $("#print");
  const row = (a, b, c, d) => `<tr><th>${a}</th><td>${b}</td><th>${c}</th><td>${d}</td></tr>`;
  pr.innerHTML = `<h1>회 의 록</h1><table class="pt">
    ${row("부 서 명", esc(m.dept), "작 성 자", esc(m.writer))}
    ${row("회의일자", esc(fmtDot(m.date)), "회의장소", esc(m.place))}
    ${row("회의시간", esc(m.time), "구 분", ["정례", "비정례"].map((k) => `${m.kind === k ? "■" : "□"} ${k}`).join("  "))}
    <tr><th>제 목</th><td colspan="3">${esc(m.title)}</td></tr><tr><th>참 석 자</th><td colspan="3">${nl2br(m.attendees)}</td></tr>
    <tr><th colspan="4" class="sec">회 의 내 용</th></tr><tr><td colspan="4" class="content">${nl2br(m.content)}</td></tr>
    <tr><th colspan="4" class="sec">실 천 의 제</th></tr><tr><th colspan="2">지 시 내 용</th><th>담 당 자</th><th>기 한</th></tr>
    ${m.actions.filter((a) => a.text).map((a) => `<tr><td colspan="2">${esc(a.text)}</td><td>${esc(a.owner)}</td><td>${esc(a.due)}</td></tr>`).join("")}
    <tr><th>특이사항</th><td colspan="3">${nl2br(m.notes)}</td></tr></table>
    <p class="pfoot">${esc(p.overview.name)}</p>`;
  window.print();
}

// ------------------------------------------------------------- 사양, 자재
function tabSpec(p, el) {
  el.innerHTML = gridCard(p, "sw") + gridCard(p, "hw") + `<div class="card"><h3>HW 주요 Spec 자료 (도면·캡처·사양서)</h3>
    ${DROPZONE()}<div class="thumbs">${thumbs(p.hwImages, { removable: true })}</div>
    <div class="chips">${fileChips(p.hwImages.filter((id) => !Store.fileMeta(id)?.type.startsWith("image/")), { removable: true })}</div>
    <label class="form-1">메모<textarea id="hwNote" rows="3">${esc(p.hwNote)}</textarea></label></div>`;
  const card = el.lastElementChild;
  attachDropzone($(".dropzone", card), async (files) => {
    for (const f of files) p.hwImages.push(await Store.addFile(f, f.name));
    Store.touch(p, `HW 주요 Spec 자료 추가: ${files.map((f) => f.name).join(", ")}`);
    rerender();
  }, card);
  card.addEventListener("click", async (e) => {
    if (!e.target.dataset.remove) return;
    e.stopPropagation();
    if (!confirm("이 파일을 삭제할까요?")) return;
    p.hwImages = p.hwImages.filter((x) => x !== e.target.dataset.remove);
    Store.touch(p);
    await Store.gc();
    rerender();
  });
  $("#hwNote").oninput = (e) => { p.hwNote = e.target.value; Store.touch(p); };
}
function tabParts(p, el) {
  const sub = ["bom", "consumables", "supplied"].includes(route.sub) ? route.sub : "bom";
  el.innerHTML = `<nav class="subtabs">${["bom", "consumables", "supplied"].map((k) =>
    `<button data-sub="${k}" class="${k === sub ? "active" : ""}">${LISTS[k].title} <small>${p.lists[k].length}</small></button>`).join("")}</nav>${gridCard(p, sub)}`;
  $$("[data-sub]", el).forEach((b) => (b.onclick = () => { route.sub = b.dataset.sub; rerender(); }));
}

// ------------------------------------------------------------- 시작
async function start() {
  try { await Store.open(); }
  catch (e) {
    $("#main").innerHTML = `<div class="card pad"><h2>저장소를 열 수 없습니다</h2><p>${esc(e.message)}</p>
      <p>크롬 또는 엣지 브라우저에서 열어 주세요. (사생활 보호/시크릿 모드에서는 저장되지 않을 수 있습니다)</p></div>`;
    return;
  }
  // 같은 파일을 여러 창에서 동시에 열면 서로 덮어쓸 수 있으므로 경고
  try {
    const ch = new BroadcastChannel("project-docs");
    ch.onmessage = (e) => {
      if (e.data === "hello") ch.postMessage("here");
      if (e.data === "here") toast("⚠ 이 프로그램이 다른 창에서도 열려 있습니다. 한 창에서만 사용하세요.", 8000);
    };
    ch.postMessage("hello");
  } catch {}
  window.addEventListener("beforeunload", () => Store.flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && Store.flush());
  render();
}
start();
