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
// 프로젝트 이니셜 아바타 (프로젝트마다 고유 색)
function avatar(p, cls = "", withDot = false) {
  const name = (p.overview.customer || p.overview.name || "?").replace(/^[㈜(（\s]*(주\)|주식회사)?\s*/, "");
  let h = 0;
  for (const ch of p.id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `<span class="avatar ${cls}" style="--h:${h}">${esc(name.slice(0, 1) || "?")}${withDot ? (() => { const x = scheduleStatus(p); return `<span class="dot s-${esc(x.st)}" title="${esc(x.text)}"></span>`; })() : ""}</span>`;
}
// 일정표에 맞춘 프로젝트 상태 배지
const stBadge = (p) => { const x = scheduleStatus(p); return `<span class="badge s-${esc(x.st)}" title="${esc(x.tip)}">${esc(x.text)}</span>`; };
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
    <div class="brand"><span class="logo">PD</span><div><b>프로젝트 자료 관리</b><small>Project Docs</small></div></div>
    <div class="today-chip" title="오늘 날짜 (일정·D-day 계산 기준)">📅 ${todayText()}</div>
    <input id="globalSearch" type="search" placeholder="전체 검색" title="모든 프로젝트의 자료·회의록·일정·BOM 등을 검색합니다" value="${esc(route.view === "search" ? route.q : "")}">
    <button class="nav ${route.view === "home" ? "active" : ""}" data-go="home"><span class="nav-ico">📊</span> 통합 대시보드</button>
    <div class="side-head"><span>프로젝트 (${projects.length})</span>
      <span><button class="icon" id="importXlsx" title="기존 엑셀 파일로 프로젝트 만들기">📥</button><button class="icon" id="newProject" title="새 프로젝트">＋</button></span></div>
    <div class="plist">${projects.map((p) => `
      <button class="nav proj ${route.id === p.id && route.view === "project" ? "active" : ""}" data-project="${p.id}">
        ${avatar(p, "", true)}<span class="pinfo"><span class="pname">${esc(p.overview.name)}</span>
        <small>${esc(p.overview.customer || p.overview.status)}</small></span></button>`).join("") || `<div class="muted small pad">아직 프로젝트가 없습니다.</div>`}</div>
    <div class="side-foot">
      <label class="small muted">작성자 이름 <input id="userName" value="${esc(s.user)}" placeholder="예: 홍길동"></label>
      <div class="row2"><button class="btn sm" id="backupBtn">💾 백업</button><button class="btn sm" id="restoreBtn">📂 복원</button></div>
      <div class="small backup-note ${warn ? "warn" : "muted"}">${warn ? "⚠" : "✓"} ${s.lastBackup ? `마지막 백업 ${esc(s.lastBackup)} (${days}일 전)` : "아직 백업하지 않았습니다"}</div>
      ${window.showDirectoryPicker ? `<div class="small muted backup-dir">📁 ${s.backupDirName ? `<b>${esc(s.backupDirName)}</b>\\백업` : "백업 폴더 미지정"} <a href="#" id="backupDirBtn">${s.backupDirName ? "변경" : "지정"}</a></div>
        <div class="small auto-backup ${autoState.mode}">${autoState.mode === "on" ? `🔄 자동 백업 켜짐${autoState.last ? ` · ${esc(autoState.last)}` : ""}`
          : autoState.mode === "paused" ? `<a href="#" id="autoResume">⏸ 자동 백업 멈춤 — 눌러서 켜기</a>`
          : `<span class="warn">⚠ 자동 백업 꺼짐 (폴더 지정 필요)</span>`}</div>` : ""}
      <div class="small muted browser-note" style="opacity:.7">버전 __BUILD_STAMP__</div>
      <div class="small muted browser-note" title="데이터는 이 브라우저 안에 저장됩니다. 다른 브라우저로 열면 보이지 않습니다.">💻 ${esc(browserName())}에 저장됨</div>
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
  $("#backupBtn").onclick = backupNow;
  $("#backupDirBtn")?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (await backupDir(true)) { await autoDir(); renderSidebar(); toast("백업 폴더를 지정했습니다. 이제 💾 백업을 누르면 이 폴더의 '백업' 폴더에 저장됩니다.", 5000); }
  });
  $("#restoreBtn").onclick = restoreNow;
  $("#autoResume")?.addEventListener("click", async (e) => {
    e.preventDefault();
    const dir = await Store.getKV("backupDir").catch(() => null);
    if (dir && (await dir.requestPermission({ mode: "readwrite" })) === "granted") { await autoBackup(true); toast("자동 백업을 켰습니다."); }
  });
}

// 데이터는 브라우저마다 따로 저장되므로 어느 브라우저인지 보여 줌
function browserName() {
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand).join(" ");
  const ua = navigator.userAgent;
  if (/Edge|Edg\//.test(brands + ua)) return "Microsoft Edge";
  if (/Whale/.test(ua)) return "네이버 웨일";
  if (/Chrome/.test(brands + ua)) return "Chrome";
  if (/Firefox/.test(ua)) return "Firefox";
  return "이 브라우저";
}

// 자동 백업: 백업 폴더가 지정되어 있고 쓰기 권한이 있으면, 바꾼 뒤 2분 동안 조용하면 백업 폴더에
// '자동백업_날짜.zip'(하루 한 파일, 최근 14개 보관)으로 저장
let autoState = { mode: "off", last: "" }, autoTimer, autoRunning = false;
async function autoDir() {
  if (!window.showDirectoryPicker) return null;
  const dir = await Store.getKV("backupDir").catch(() => null);
  if (!dir) { autoState.mode = "off"; return null; }
  const perm = (await dir.queryPermission?.({ mode: "readwrite" })) ?? "granted";
  autoState.mode = perm === "granted" ? "on" : "paused";
  return perm === "granted" ? dir : null;
}
async function autoBackup(force = false) {
  if (autoRunning || !Store.projects.length) return;
  const dir = await autoDir();
  if (!dir) return renderSidebar();
  autoRunning = true;
  try {
    const sub = await dir.getDirectoryHandle("백업", { create: true });
    const w = await (await sub.getFileHandle(`자동백업_${today()}.zip`, { create: true })).createWritable();
    await w.write(await Store.exportBackup());
    await w.close();
    const old = [];
    for await (const [n] of sub.entries()) if (/^자동백업_\d{4}-\d{2}-\d{2}\.zip$/.test(n)) old.push(n);
    for (const n of old.sort().slice(0, -14)) await sub.removeEntry(n).catch(() => {});
    const d = new Date();
    autoState.last = `${today().slice(5).replace("-", ".")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  } catch (e) { console.error(e); if (force) toast("자동 백업 실패: " + e.message, 5000); }
  finally { autoRunning = false; renderSidebar(); }
}
function scheduleAutoBackup() {
  if (autoRunning) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(autoBackup, 2 * 60 * 1000);
}

// ------------------------------------------------------------- 백업: 실행 폴더(프로그램 파일이 있는 폴더)에 저장
// 브라우저는 HTML 파일이 있는 폴더를 직접 알 수 없으므로, 처음 한 번 그 폴더를 골라 두면 기억해서 계속 씀 (크롬·엣지)
async function backupDir(change = false) {
  if (!window.showDirectoryPicker) return null;
  let dir = change ? null : await Store.getKV("backupDir").catch(() => null);
  if (dir) {
    const opt = { mode: "readwrite" };
    let perm = (await dir.queryPermission?.(opt)) ?? "granted";
    if (perm !== "granted") perm = await dir.requestPermission(opt);
    if (perm !== "granted") dir = null;
  }
  if (!dir) {
    toast("프로그램 파일(프로젝트자료관리.html)이 있는 폴더를 골라 주세요. 그 안의 '백업' 폴더에 저장합니다.", 6000);
    try { dir = await window.showDirectoryPicker({ id: "pd-backup", mode: "readwrite", startIn: "documents" }); }
    catch (e) { if (e.name === "AbortError") return null; throw e; }
    await Store.putKV("backupDir", dir);
    Store.state.settings.backupDirName = dir.name;
    Store.changed();
  }
  return dir;
}
async function backupNow() {
  let dir;
  try { dir = await backupDir(); } catch (e) { console.error(e); }
  if (window.showDirectoryPicker && !dir) return toast("백업 폴더를 고르지 않아 취소했습니다.");
  await busy("백업 파일을 만드는 중…", async () => {
    const d = new Date(), hm = `${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
    const name = `프로젝트자료_백업_${today()}_${hm}.zip`;
    const blob = await Store.exportBackup();
    if (!dir) { download(blob, name); return toast("백업 파일을 내려받았습니다. 안전한 곳(공유 폴더 등)에 보관하세요.", 4000); }
    const sub = await dir.getDirectoryHandle("백업", { create: true });
    const w = await (await sub.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
    toast(`${dir.name}\\백업\\${name} 에 저장했습니다.`, 5000);
  });
  await autoDir();
  renderSidebar();
}
// 다른 PC로 옮길 때: 프로그램 폴더(HTML + 백업 폴더)를 통째로 복사한 뒤, 그 폴더를 고르면
// 백업 폴더에서 가장 최근 백업으로 복원하고 그 폴더를 계속 백업 폴더로 씀
async function loadFromFolder() {
  if (!window.showDirectoryPicker) return restoreNow();
  let dir;
  try { dir = await window.showDirectoryPicker({ id: "pd-backup", mode: "readwrite" }); }
  catch (e) { if (e.name !== "AbortError") toast("오류: " + e.message, 5000); return; }
  // 프로그램 폴더를 골랐으면 그 안의 '백업' 폴더, '백업' 폴더 자체를 골랐으면 그 폴더
  const sub = await dir.getDirectoryHandle("백업").catch(() => null);
  const from = sub || dir;
  const zips = [];
  for await (const [n, h] of from.entries())
    if (h.kind === "file" && /^(프로젝트자료_백업|자동백업)_.*\.zip$/.test(n)) zips.push({ n, f: await h.getFile() });
  if (!zips.length) return toast(`'${dir.name}'${sub ? "\\백업" : ""} 폴더에 백업 파일이 없습니다. 프로그램 폴더(백업 폴더가 들어 있는 폴더)를 골라 주세요.`, 7000);
  zips.sort((a, b) => b.f.lastModified - a.f.lastModified);
  const z = zips[0], when = new Date(z.f.lastModified);
  const stamp = `${when.getFullYear()}.${String(when.getMonth() + 1).padStart(2, "0")}.${String(when.getDate()).padStart(2, "0")} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
  if (!confirm(`가장 최근 백업으로 불러올까요?\n\n${z.n}\n(${stamp} 저장)${Store.projects.length ? "\n\n지금 이 PC에 있는 자료는 이 백업 내용으로 바뀝니다." : ""}`)) return;
  await busy("자료를 불러오는 중…", async () => {
    await Store.importBackup(z.f);
    if (sub) {
      await Store.putKV("backupDir", dir);
      Store.state.settings.backupDirName = dir.name;
      Store.changed();
    }
    await autoDir();
    go({ view: "home" });
    toast(`${Store.projects.length}개 프로젝트를 불러왔습니다.${sub ? " 이 폴더에 계속 자동 백업합니다." : ""}`, 5000);
  });
}
// 보고서: 프로젝트 이름으로 파일을 만들어, 한 번 지정한 보고서 폴더에 바로 저장 (지원 안 하면 내려받기)
const fileSafe = (s) => String(s || "프로젝트").replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 80);
async function reportDir(change = false) {
  if (!window.showDirectoryPicker) return null;
  let dir = change ? null : await Store.getKV("reportDir").catch(() => null);
  if (dir) {
    const opt = { mode: "readwrite" };
    let perm = (await dir.queryPermission?.(opt)) ?? "granted";
    if (perm !== "granted") perm = await dir.requestPermission(opt);
    if (perm !== "granted") dir = null;
  }
  if (!dir) {
    toast("보고서를 저장할 폴더를 골라 주세요. 다음부터는 이 폴더에 바로 저장합니다.", 6000);
    try { dir = await window.showDirectoryPicker({ id: "pd-report", mode: "readwrite", startIn: "documents" }); }
    catch (e) { if (e.name === "AbortError") return null; throw e; }
    await Store.putKV("reportDir", dir);
    Store.state.settings.reportDirName = dir.name;
    Store.changed();
  }
  return dir;
}
async function saveReport(make, name) {
  let dir = null;
  try { dir = await reportDir(); } catch (e) { console.error(e); }
  if (window.showDirectoryPicker && !dir) { toast("저장 폴더를 고르지 않아 취소했습니다."); return false; }
  await busy("보고서를 만드는 중…", async () => {
    const blob = await make();
    if (!dir) { download(blob, name); return toast(`${name} 을(를) 내려받았습니다.`, 4000); }
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(blob);
    await w.close();
    toast(`📁 ${dir.name}\\${name} 에 저장했습니다.`, 5000);
  });
  return true;
}
async function restoreNow() {
  const run = (file) => {
    if (!confirm("현재 저장된 모든 데이터를 지우고 백업 파일 내용으로 바꿀까요?")) return;
    busy("복원하는 중…", async () => { await Store.importBackup(file); go({ view: "home" }); toast("복원했습니다."); });
  };
  // 백업 폴더를 지정해 두었으면 그 폴더에서 바로 고르기
  const dir = window.showOpenFilePicker && Store.state.settings.backupDirName ? await Store.getKV("backupDir").catch(() => null) : null;
  if (dir) {
    try {
      const start = await dir.getDirectoryHandle("백업").catch(() => dir);
      const [h] = await window.showOpenFilePicker({ startIn: start, types: [{ description: "백업 파일", accept: { "application/zip": [".zip"] } }] });
      return run(await h.getFile());
    } catch (e) { if (e.name === "AbortError") return; console.error(e); }
  }
  pickFiles(".zip", false, (f) => run(f[0]));
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
    toast(`가져오기 완료: 자료 ${p.records.length}건, 사양 ${p.specs.length}개, 회의록 ${p.meetings.length}건, 일정 ${p.schedule.length}건`, 5000);
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
function fileChips(ids, { removable = false, extra } = {}) {
  return (ids || []).map((id) => {
    const m = Store.fileMeta(id);
    if (!m) return "";
    return `<span class="chip" data-file="${id}" title="${esc(m.name)} (${fmtSize(m.size)})">${fileIcon(m)} ${esc(m.name)}
      ${extra ? extra(id) : ""}${removable ? `<button type="button" class="x" data-remove="${id}">✕</button>` : ""}</span>`;
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
function thumbs(ids, { removable = false, extra } = {}) {
  return (ids || []).filter((id) => Store.fileMeta(id)?.type.startsWith("image/")).map((id) =>
    `<span class="thumb" data-view="${id}"><img data-src="${id}" alt="${esc(Store.fileMeta(id).name)}">
      ${extra ? extra(id) : ""}${removable ? `<button type="button" class="x" data-remove="${id}">✕</button>` : ""}</span>`).join("");
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
  const ctl = e.target.closest("[data-remove], [data-xfer]");
  if (chip && !ctl) return openFile(chip.dataset.file);
  const th = e.target.closest("[data-view]");
  if (th && !ctl) {
    const ids = $$("[data-view]", th.parentNode).map((x) => x.dataset.view);
    lightbox(ids, ids.indexOf(th.dataset.view));
  }
});

// 받는 곳 밖에 파일을 잘못 놓아도 브라우저가 파일을 열어 화면을 벗어나지 않도록
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => { e.preventDefault(); if (e.dataTransfer?.files?.length) toast("파일은 점선으로 표시된 첨부 영역에 놓아 주세요."); });

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
// 오늘 날짜: 2026년 10월 19일 (월)
const todayText = () => { const t = today(); return `${+t.slice(0, 4)}년 ${+t.slice(5, 7)}월 ${+t.slice(8, 10)}일 (${weekday(t)})`; };
// 자정이 지나면 날짜·D-day 를 다시 계산해 표시
(function watchDay() {
  let day = today();
  setInterval(() => { if (today() !== day) { day = today(); render(); } }, 60 * 1000);
})();

// 대시보드 일정 목록: 날짜별로 묶은 한 줄 목록
const SOON_MAX = 12, SIDE_MAX = 5;
const moreBtn = (n) => (n > SIDE_MAX ? `<button class="btn sm more" data-more>＋ ${n - SIDE_MAX}건 더 보기</button>` : "");
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (d) => WEEKDAY[new Date(d + "T00:00:00").getDay()];
function agendaRow(p, t, when, right) {
  return `<div class="ag-row" data-goto="${p.id}" data-tab="schedule">${avatar(p, "xs")}
    <span class="ag-proj ellipsis" title="${esc(p.overview.name)}">${esc(p.overview.name)}</span>
    <span class="ag-task ellipsis" title="${esc(t.phase)} · ${esc(t.name)}">${t.phase && t.phase !== t.name ? `<span class="muted">${esc(t.phase)} ·</span> ` : ""}<b>${esc(t.name)}</b></span>
    <span class="ag-when">${when}</span><span class="ag-right">${right}</span></div>`;
}
function soonGroups(soon, all = false) {
  const list = all ? soon : soon.slice(0, SOON_MAX);
  const days = [];
  for (const x of list) { const d = days.find((y) => y.date === x.when); if (d) d.items.push(x); else days.push({ date: x.when, items: [x] }); }
  return days.map((d) => `<div class="ag-day"><span class="ag-date"><b>${esc(fmtDot(d.date).slice(5))}</b> ${weekday(d.date)}</span><span class="ag-dday">${dday(d.date)}</span></div>
    ${d.items.map(({ p, t, what }) => agendaRow(p, t, `<span class="tag ${what === "시작" ? "" : "warn"}">${what}</span>`, t.owner ? `<span class="muted small">${esc(t.owner)}</span>` : "")).join("")}`).join("");
}
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
    <div class="page-head"><h1>통합 대시보드</h1><div class="row2"><span class="today-big">오늘 ${todayText()}</span>
      ${Store.projects.some((p) => p.overview.status === "완료") ? `<button class="btn" id="closingAll" title="완료 상태인 프로젝트를 열로 모은 마감 보고서">📊 완료 프로젝트 마감 보고서</button>` : ""}</div></div>
    ${!Store.projects.length ? `<div class="card empty-big">
      <div class="hero-emoji">📂</div><h2>시작하기</h2><p>왼쪽의 <b>📥</b> 버튼으로 지금 쓰고 있는 프로젝트 엑셀 파일을 불러오거나, <b>＋</b> 버튼으로 새 프로젝트를 만드세요.</p>
      <p class="muted small">엑셀을 불러오면 개요·일정·BOM·회의록·날짜별 문의/자료 시트(캡처 이미지와 첨부 원본 포함)가 자동으로 정리됩니다.</p>
      <div class="row2 center"><button class="btn primary" id="homeImport">📥 엑셀 불러오기</button><button class="btn" id="homeNew">＋ 새 프로젝트</button></div></div>
      <div class="card lost-help"><h3>🔎 전에 등록한 자료가 안 보이나요?</h3>
        <p>자료는 파일이 아니라 <b>브라우저 안</b>에 저장됩니다. 지금 이 화면은 <b>${esc(browserName())}</b>에서 열렸습니다.</p>
        <ol>
          <li><b>다른 브라우저로 열렸을 수 있습니다.</b> 윈도우 업데이트 뒤에는 기본 브라우저가 엣지로 바뀌는 일이 많습니다.
            전에 쓰던 브라우저(크롬 등)에서 열어 보세요: 파일 오른쪽 클릭 → <b>연결 프로그램</b> → Chrome</li>
          <li><b>다른 PC에서 옮겨 왔다면:</b> 프로그램 폴더(이 HTML 파일과 <b>백업</b> 폴더)를 통째로 복사한 뒤, 아래 버튼으로 그 폴더를 고르세요. 가장 최근 백업으로 불러오고 그 폴더에 계속 자동 백업합니다.
            <div style="margin-top:8px" class="row2">${window.showDirectoryPicker ? `<button class="btn primary sm" id="homeFolder">📁 실행 폴더에서 자료 불러오기</button>` : ""}
              <button class="btn sm" id="homeRestore">📂 백업 파일 직접 고르기</button></div></li>
          <li>백업이 없으면 프로젝트 엑셀을 <b>📥 엑셀 불러오기</b>로 다시 불러오면 됩니다.</li>
        </ol></div>` : `
    <div class="kpis">
      ${[["📁", "진행 중 프로젝트", active.length, ""], ["⏰", "지연된 일정", delayed.length, delayed.length ? "bad" : "ok"],
        ["📅", "2주 내 일정", soon.length, ""], ["📝", "미완료 실천 의제", actions.length, actions.length ? "warn" : "ok"],
        ["📤", "미제출 자료", subs.length, subs.length ? "warn" : "ok"]].map(([ico, label, n, cls]) =>
        `<div class="card kpi ${cls}"><span class="kpi-icon">${ico}</span><div class="kpi-body"><span>${label}</span><b>${n}</b></div></div>`).join("")}
    </div>
    <div class="pcards">${all.map(({ p, s }) => `
      <div class="card pcard" data-st="${esc(scheduleStatus(p).st)}" ${goto(p, "overview")}>
        <div class="pc-head">${avatar(p)}<div><b class="ellipsis" style="display:block">${esc(p.overview.name)}</b>
          <div class="muted small ellipsis">${esc(p.overview.customer || "-")}${p.overview.project ? " · " + esc(p.overview.project) : ""}</div></div>${stBadge(p)}</div>
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
    <div class="dash">
      <div class="dash-col">
        ${delayed.length ? `<div class="card dash-card card-bad"><div class="dash-head"><h3>⚠ 지연된 일정</h3><span class="tag bad">${delayed.length}건</span></div>
          <div class="agenda">${delayed.map(({ p, t }) => agendaRow(p, t, `${esc(fmtDot(t.end))} 종료`, `<b class="bad">${dday(t.end)}</b>`)).join("")}</div></div>` : ""}
        <div class="card dash-card"><div class="dash-head"><h3>📅 다가오는 일정</h3><span class="muted small">2주 안에 시작·종료 · ${soon.length}건</span></div>
          ${soon.length ? `<div class="agenda">${soonGroups(soon)}</div>${soon.length > SOON_MAX ? `<button class="btn sm more" id="soonMore">＋ ${soon.length - SOON_MAX}건 더 보기</button>` : ""}`
            : `<p class="muted">2주 안에 시작하거나 끝나는 일정이 없습니다.</p>`}</div>
      </div>
      <div class="dash-col">
        <div class="card dash-card"><div class="dash-head"><h3>✅ 미완료 실천 의제</h3>${actions.length ? `<span class="tag warn">${actions.length}건</span>` : ""}</div>
          ${actions.length ? `<div class="side-list">${actions.map(({ p, a }, k) => `<div class="side-row ${k >= SIDE_MAX ? "extra" : ""}">
            <input type="checkbox" data-action="${p.id}|${a.meeting.id}|${a.id}" title="완료 처리">
            <div class="side-main" ${goto(p, "meetings")} data-meeting="${a.meeting.id}"><b class="ellipsis">${esc(a.text)}</b>
              <span class="muted small ellipsis">${esc(p.overview.name)} · ${esc(a.meeting.title)}${a.owner ? ` · ${esc(a.owner)}` : ""}</span></div>
            <span class="small nowrap muted">${esc(isDate(a.due) ? fmtDot(a.due).slice(5) : a.due)}</span></div>`).join("")}</div>${moreBtn(actions.length)}`
            : `<p class="muted">남은 실천 의제가 없습니다.</p>`}</div>
        ${subs.length ? `<div class="card dash-card"><div class="dash-head"><h3>📤 미제출 자료</h3><span class="tag warn">${subs.length}건</span></div>
          <div class="side-list">${subs.map(({ p, r }, k) => `<div class="side-row ${k >= SIDE_MAX ? "extra" : ""}" ${goto(p, "submissions")}>${avatar(p, "xs")}
            <div class="side-main"><b class="ellipsis">${esc(r.item)}</b><span class="muted small ellipsis">${esc(p.overview.name)}${r.to ? ` → ${esc(r.to)}` : ""}</span></div></div>`).join("")}</div>${moreBtn(subs.length)}</div>` : ""}
        <div class="card dash-card"><div class="dash-head"><h3>📨 최근 자료</h3></div>
          ${recent.length ? `<div class="side-list">${recent.map(({ p, r }, k) => `<div class="side-row ${k >= SIDE_MAX ? "extra" : ""}" ${goto(p, "records")} data-record="${r.id}">
            <span class="side-date">${esc(fmtDot(r.date).slice(2))}</span>
            <div class="side-main"><b class="ellipsis">${esc(r.title)}</b><span class="muted small ellipsis">${esc(p.overview.name)}</span></div>${badge(r.kind)}</div>`).join("")}</div>${moreBtn(recent.length)}`
            : `<p class="muted">등록된 자료가 없습니다.</p>`}</div>
      </div>
    </div>`}`;
  $("#homeImport")?.addEventListener("click", () => pickFiles(".xlsx", false, (f) => importXlsx(f[0])));
  $("#homeNew")?.addEventListener("click", newProjectDialog);
  $("#homeRestore")?.addEventListener("click", restoreNow);
  $("#homeFolder")?.addEventListener("click", loadFromFolder);
  $("#closingAll")?.addEventListener("click", () => {
    const done = Store.projects.filter((p) => p.overview.status === "완료");
    openDialog(`<h3>완료 프로젝트 마감 보고서</h3><p class="muted small">고른 프로젝트가 한 시트에 열로 나란히 들어갑니다. (종합 시트 포함)</p>
      <div class="opts">${done.map((p) => `<label><input type="checkbox" name="pick" value="${p.id}" checked> ${esc(p.overview.customer || "")} · ${esc(p.overview.project || p.overview.name)}
        <span class="muted small">${esc(p.report?.completedDate ? fmtDot(p.report.completedDate) + " 완료" : "")}</span></label>`).join("")}</div>`,
    async (form) => {
      const ids = $$("[name=pick]:checked", form).map((x) => x.value);
      if (!ids.length) { toast("프로젝트를 하나 이상 고르세요."); return false; }
      const picked = done.filter((p) => ids.includes(p.id));
      await saveReport(() => buildClosingWorkbook(picked),
        picked.length === 1 ? `${fileSafe(picked[0].overview.name)}_완료보고서_${today()}.xlsx` : `완료프로젝트_마감보고서_${picked.length}건_${today()}.xlsx`);
    }, { okLabel: "📊 엑셀 다운로드" });
  });
  $$("[data-more]").forEach((b) => (b.onclick = () => { b.closest(".card").classList.add("open"); b.remove(); }));
  $("#soonMore")?.addEventListener("click", (e) => {
    $(".agenda", e.target.parentNode).innerHTML = soonGroups(soon, true);
    e.target.remove();
    bindGoto($("#main"));
  });
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
    go({ view: "project", id: el.dataset.goto, tab: el.dataset.tab, meeting: el.dataset.meeting, record: el.dataset.record, spec: el.dataset.spec })));
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
    for (const sp of ensureSpecs(p)) for (const r of sp.rows) if (hit(r.kind, r.item, r.content, r.review))
      add("spec", sp.name, [r.item, r.content].filter(Boolean).join(" · "), "", { spec: sp.id });
    for (const u of ensureUnits(p)) for (const r of u.bom) if (isItemRow(r) && hit(r.kind, r.item, r.model, r.maker, r.note))
      add("parts", `BOM · ${u.name}`, [r.item, r.model, r.maker].filter(Boolean).join(" · "), "", { sub: "bom" });
    for (const [key, def] of Object.entries(LISTS)) {
      if (["unitbom", "bom", "specsec", "sw", "hw"].includes(key)) continue;
      const tab = { sw: "spec", hw: "spec", supplied: "parts", consumables: "parts", bom: "parts" }[key] || key;
      for (const r of listRows(p, key)) if (hit(...def.cols.map((c) => r[c.key])))
        add(tab, def.title, def.cols.map((c) => r[c.key]).filter(Boolean).slice(0, 3).join(" · "), "", { sub: key });
    }
  }
  $("#main").innerHTML = `<div class="page-head"><h1>검색: “${esc(route.q)}”</h1><span class="muted">${results.length}건</span></div>
    <div class="card">${results.length ? `<table class="list"><tbody>${results.map((r) => `
      <tr data-goto="${r.p.id}" data-tab="${r.tab}" ${r.extra.record ? `data-record="${r.extra.record}"` : ""} ${r.extra.meeting ? `data-meeting="${r.extra.meeting}"` : ""} ${r.extra.spec ? `data-spec="${r.extra.spec}"` : ""}>
      <td><span class="tag">${esc(r.type)}</span></td><td><b>${esc(r.title)}</b> <span class="muted small">${esc(r.sub)}</span></td>
      <td class="muted pcol">${esc(r.p.overview.name)}</td></tr>`).join("")}</tbody></table>` : `<p class="muted">검색 결과가 없습니다.</p>`}</div>`;
  bindGoto($("#main"));
}

// ------------------------------------------------------------- 프로젝트 화면
function renderProject(p) {
  // 예전 버전에서 만든 프로젝트에 새 항목 채우기
  Object.assign(p.overview, { orderDate: p.overview.orderDate ?? "", orderAmount: p.overview.orderAmount ?? "",
    vat: p.overview.vat || "별도", payments: p.overview.payments || [] });
  p.report ||= { summary: "", issues: "", warrantyNote: "", completedDate: "" };
  ensureUnits(p);
  ensureSpecs(p);
  fillSubmitTo(p);
  if (syncPaidDate(p) === "today") { Store.touch(p); setTimeout(() => toast("모든 정산이 수금완료인데 정산일이 없어 오늘 날짜로 넣었습니다. 계약·정산에서 실제 입금일로 고쳐 주세요.", 8000), 300); }
  if (linkRevisions(p)) Store.touch(p);
  for (const k of ["kickoffDate", "deliveryDate", "setupDate", "warrantyStart", "warrantyYears", "paidDate"]) {
    if (!p.overview[k] && p.report[k]) p.overview[k] = p.report[k];
    delete p.report[k];
  }
  for (const k of ["targetCost", "actualCost"]) {
    if (!p.overview[k] && p.report[k]) p.overview[k] = p.report[k];
    delete p.report[k];
  }
  if (!p.overview.costV2) {
    if (p.overview.actualCost && !p.overview.estimateCost) { p.overview.estimateCost = p.overview.actualCost; p.overview.actualCost = ""; }
    p.overview.costV2 = true;
  }
  // 납품일자 = 입고일자
  if (isDate(p.overview.deliveryDate) && !isDate(p.overview.receiveDate)) p.overview.receiveDate = p.overview.deliveryDate;
  delete p.overview.deliveryDate;
  const tab = TABS.some(([k]) => k === route.tab) ? route.tab : "overview";
  const s = projectSummary(p);
  const counts = { records: p.records.length, meetings: p.meetings.length, schedule: s.delayed.length ? `⚠${s.delayed.length}` : "",
    spec: specItemCount(p) || "",
    parts: bomItemCount(p) + p.lists.consumables.length + p.lists.supplied.length || "", submissions: s.pendingSubmissions.length || "",
    changes: p.lists.changes.length || "" };
  $("#main").innerHTML = `
    <div class="page-head">
      <div class="title-wrap">${avatar(p, "lg")}<div style="min-width:0"><div class="crumb">프로젝트 · ${esc(p.overview.customer || "고객사 미입력")}</div>
        <h1>${esc(p.overview.name)} ${stBadge(p)}</h1>
        ${p.overview.project ? `<div class="muted small ellipsis">${esc(p.overview.project)}</div>` : ""}</div></div>
      <div class="row2">
        <button class="btn" id="exportXlsx" title="이 프로젝트를 기존 양식의 엑셀 파일로 저장">📊 엑셀로 내보내기</button>
        <button class="btn" id="exportZip" title="엑셀 + 첨부 원본 파일을 폴더 구조로 저장">🗂 전체 자료 ZIP</button>
        <button class="btn ${p.overview.status === "완료" ? "primary" : ""}" id="reportBtn" title="프로젝트 완료 보고서를 인쇄하거나 PDF로 저장">📄 완료 보고서</button>
      </div>
    </div>
    <nav class="tabs">${TABS.map(([k, label]) => `<button data-tab="${k}" class="${k === tab ? "active" : ""}">${label}${counts[k] ? ` <small>${counts[k]}</small>` : ""}</button>`).join("")}</nav>
    <section id="tab"></section>`;
  $$(".tabs button").forEach((b) => (b.onclick = () => go({ view: "project", id: p.id, tab: b.dataset.tab })));
  $("#exportXlsx").onclick = () => busy("엑셀 파일을 만드는 중…", async () => download(await buildWorkbook(p), `${p.overview.name}_${today()}.xlsx`));
  $("#reportBtn").onclick = () => reportDialog(p);
  $("#exportZip").onclick = () => busy("ZIP 파일을 만드는 중…", async () => download(await buildProjectZip(p), `${p.overview.name}_${today()}.zip`));
  ({ overview: tabOverview, schedule: tabSchedule, records: tabRecords, meetings: tabMeetings, spec: tabSpec, parts: tabParts,
    submissions: (p, el) => el.innerHTML = gridCard(p, "submissions"), changes: (p, el) => el.innerHTML = gridCard(p, "changes"),
    revisions: (p, el) => el.innerHTML = gridCard(p, "revisions", "자료 이력·회의록이 추가되면 자동으로 기록되며, 직접 추가할 수도 있습니다.") })[tab](p, $("#tab"));
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
function tabOverviewEdit(p, el) {
  const o = p.overview;
  const s = projectSummary(p);
  el.innerHTML = `<div class="grid2 wide-left">
    <div class="card"><h3>프로젝트 개요</h3><div class="form ov" id="ovForm">
      <label class="full">설비/품목명<input data-k="name" value="${esc(o.name)}"></label>
      ${OVERVIEW_FIELDS.filter(([k]) => k !== "warranty").map(([k, label]) => k === "scope" || k === "note"
        ? `<label class="full">${label}<textarea data-k="${k}" rows="3"${k === "note" ? ' placeholder="특이사항, 고객 요청, 참고 내용 등"' : ""}>${esc(o[k])}</textarea></label>`
        : k === "receiveDate" ? "" // 입고일자(납품일자)는 아래 주요 일자에서 입력
        : `<label>${label}<input data-k="${k}" value="${esc(o[k])}"></label>`).join("")}
      <label>상태<select data-k="status">${opts(PROJECT_STATUSES, o.status)}</select></label>
      <label>담당자<input data-k="manager" value="${esc(o.manager)}"></label>
    </div>
    <h3 style="margin-top:20px">주요 일자 · Warranty <span class="muted small" style="font-weight:400">비워 두면 다른 자료에서 자동으로 채웁니다</span></h3>
    <div class="form three" id="kdForm">${(() => {
      const kd = keyDates(p);
      const hint = (x) => (x.autoValue ? `자동: ${fmtDot(x.autoValue)}` : "");
      return `${KEY_DATES.filter(([k]) => k !== "paidDate").map(([k, label]) => `<label>${label}<input type="date" data-k="${k}" value="${esc(o[k] || "")}" title="${esc(hint(kd[k]))}">
          <span class="muted small">${kd[k].auto ? `자동: ${esc(fmtDot(kd[k].autoValue))}${k === "receiveDate" ? " ('납품' 일정)" : ""}` : k === "setupDate" ? "Setup 완료되면 입력" : k === "receiveDate" ? "위 개요의 입고일자와 같은 값" : ""}</span></label>`).join("")}
        <label>Warranty 시작일<input type="date" data-k="warrantyStart" value="${esc(o.warrantyStart || "")}">
          <span class="muted small">${kd.warranty.end ? `종료 ${esc(fmtDot(kd.warranty.end))}` : isDate(o.warrantyStart) ? "기간(년)을 넣으면 종료일 계산" : "시작일부터 설정한 기간(년)"}</span></label>
        <label>Warranty 기간 (년)<input data-k="warrantyYears" inputmode="decimal" value="${esc(o.warrantyYears || "")}" placeholder="${kd.warranty.years ? `${kd.warranty.years} (하자보증기간에서)` : "예: 2"}">
          <span class="muted small" id="wtyText">${esc(kd.warranty.text.replace(/(\d{4})-(\d{2})-(\d{2})/g, "$1.$2.$3"))}</span></label>
        <label>지급 완료일<input type="date" data-k="paidDate" value="${esc(o.paidDate || "")}" ${o.paidDateAuto ? 'readonly class="auto-field" title="정산이 모두 수금완료라 마지막 정산일로 자동 입력됩니다. 바꾸려면 계약·정산의 정산일을 고치세요."' : ""}>
          <span class="muted small ${kd.paidDate.missing ? "warn" : ""}">${o.paidDateAuto ? "마지막 정산일로 자동 · 정산일을 고치면 바뀜" : kd.paidDate.auto ? `자동: ${esc(fmtDot(kd.paidDate.autoValue))} (정산 완료)` : kd.paidDate.missing ? "모두 수금완료 · 정산일을 넣으면 자동" : "정산이 모두 끝나면 자동"}</span></label>`;
    })()}</div>
    <h3 style="margin-top:18px">추가 항목</h3>
    <div id="extra">${o.extra.map((x, i) => `<div class="extra-row"><input data-ex="${i}" data-f="label" value="${esc(x.label)}" placeholder="항목명">
      <input data-ex="${i}" data-f="value" value="${esc(x.value)}" placeholder="내용"><button class="icon" data-exdel="${i}">✕</button></div>`).join("")}</div>
    <button class="btn sm" id="addExtra">＋ 항목 추가</button>
    <div class="danger-zone"><button class="btn danger sm" id="delProject">프로젝트 삭제</button></div></div>
    <div class="card" id="contractCard">${contractEditHtml(p)}</div></div>`;
  bindContractEdit(p, $("#contractCard", el));
  $$("#ovForm [data-k]", el).forEach((inp) => (inp.oninput = () => {
    const before = o[inp.dataset.k];
    o[inp.dataset.k] = inp.value;
    // 고객사를 고치면 그 고객사로 되어 있던 제출처도 함께 바꿈
    if (inp.dataset.k === "customer") p.lists.submissions.forEach((r) => { if (r.to === before || (!r.to && r.item)) r.to = inp.value; });
    Store.touch(p);
    if (inp.dataset.k === "status" && inp.value === "완료" && before !== "완료")
      toast("프로젝트를 완료로 바꿨습니다. 위쪽 📄 완료 보고서 버튼으로 보고서를 출력할 수 있습니다.", 6000);
    if (["name", "status", "customer"].includes(inp.dataset.k)) {
      renderSidebar();
      $(".page-head h1").innerHTML = `${esc(o.name)} ${badge(o.status)}`;
    }
  }));
  $$("#kdForm [data-k]", el).forEach((inp) => (inp.onchange = () => {
    o[inp.dataset.k] = inp.value.trim();
    if (inp.dataset.k === "paidDate") { o.paidDateAuto = false; syncPaidDate(p); }
    Store.touch(p);
    rerender(); // 자동 값·Warranty 기간 다시 계산
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

// ------------------------------------------------------------- 계약·정산 (정보 수정 화면)
function contractEditHtml(p) {
  const o = p.overview, c = contractInfo(p);
  return `<h3>계약 · 정산</h3>
    <div class="form">
      <label>발주일<input type="date" data-ck="orderDate" value="${esc(o.orderDate || "")}"></label>
      <label>부가세<select data-ck="vat">${opts(["별도", "포함"], o.vat || "별도")}</select></label>
      <label class="full">발주금액 (원)<input data-ck="orderAmount" data-money inputmode="numeric" value="${c.amount ? c.amount.toLocaleString("ko-KR") : ""}" placeholder="예: 120,000,000">
        <span class="muted small" id="amountWords">${c.amount ? `금 ${koreanAmount(c.amount)}원정` : ""}</span></label>
      <label>실행 예가 (원)<input data-ck="estimateCost" data-money inputmode="numeric" value="${c.estimateCost ? c.estimateCost.toLocaleString("ko-KR") : ""}" placeholder="예상 실행 금액"></label>
      <label>실행목표가 (원)<input data-ck="targetCost" data-money inputmode="numeric" value="${c.targetCost ? c.targetCost.toLocaleString("ko-KR") : ""}" placeholder="예: 140,000,000"></label>
      <label>실행가 (원)<input data-ck="actualCost" data-money inputmode="numeric" value="${c.actualCost ? c.actualCost.toLocaleString("ko-KR") : ""}" placeholder="실제 투입 금액"></label>
    </div>
    <div class="form rate-grid" style="margin-top:10px">
      ${[["overheadRate", "재경비", "overhead"], ["warrantyRate", "워런티비", "warrantyCost"]].map(([k, l, a]) => `<label>${l} 비율 (%)
        <span class="rate-row"><input data-rate="${k}" inputmode="decimal" value="${esc(o[k] ?? "")}" placeholder="예: ${k === "overheadRate" ? "5" : "2"}">
        <b class="rate-amt" id="amt-${a}">${c[a] ? fmtWon(c[a]) : "0원"}</b></span><span class="muted small">실행가 × 비율</span></label>`).join("")}
    </div>
    <h4 style="margin:16px 0 8px">인건비 <span class="muted small" style="font-weight:400">분야별 M/D × M/D 단가</span></h4>
    <div class="form md-grid">${MD_FIELDS.map(([k, l]) => `<label>${l} (M/D)<input data-md="${k}" inputmode="decimal" value="${esc((o.md || {})[k] ?? "")}" placeholder="0"></label>`).join("")}</div>
    <div class="form" style="margin-top:10px">
      <label>M/D 단가 (원)<input data-ck="mdRate" data-money inputmode="numeric" value="${c.mdRate ? c.mdRate.toLocaleString("ko-KR") : ""}" placeholder="예: 500,000"></label>
      <label><span>인건비 (원) <span class="tag" id="laborMode">${c.laborManual ? "직접 입력" : "자동 계산"}</span></span>
        <input data-ck="laborCost" data-labor data-money inputmode="numeric" class="labor-input" value="${c.labor ? c.labor.toLocaleString("ko-KR") : ""}" placeholder="M/D × 단가">
        <span class="muted small">고쳐 쓰면 직접 입력 · 지우면 자동</span></label>
    </div>
    <div class="labor-view" id="laborView">${laborViewHtml(c)}</div>
    <div class="total-cost" id="totalView">${totalViewHtml(c)}</div>
    <div class="cost-view" id="costView">${costViewHtml(c)}</div>
    <h4 style="margin:18px 0 8px">정산 비율</h4>
    <div class="pay-quick"><input data-paytext value="${esc(c.payments.map((x) => `${x.name} ${x.ratio}`).join(" / "))}" placeholder="예: 30/60/10 또는 선금30 중도금60 잔금10">
      <button type="button" class="btn sm" data-payapply>적용</button></div>
    <div class="pay-presets"><span class="muted small">자주 쓰는 비율</span>
      ${payPresets().map((x, i) => {
        const on = c.payments.length && presetLabel(x.stages) === presetLabel(c.payments.map((y) => [y.name, Number(y.ratio)]));
        return `<span class="preset-chip ${on ? "on" : ""} ${x.builtin ? "" : "mine"}"><button type="button" data-preset="${i}" title="${esc(presetLabel(x.stages))}">${esc(x.label)}</button>${x.builtin ? "" : `<button type="button" class="pdx" data-presetdel="${i}" title="저장한 비율 삭제">✕</button>`}</span>`;
      }).join("")}</div>
    <div class="table-scroll"><table class="grid-table pay-table"><thead><tr><th>구분</th><th>비율(%)</th><th>금액</th><th>지급 조건</th><th>정산일</th><th>상태</th><th></th></tr></thead>
    <tbody>${c.payments.map((x) => `<tr data-id="${x.id}">
      <td><input data-pf="name" value="${esc(x.name)}" style="width:70px"></td>
      <td><input data-pf="ratio" inputmode="decimal" value="${esc(x.ratio)}" style="width:52px"></td>
      <td class="num" data-amt>${x.amount ? x.amount.toLocaleString("ko-KR") : "-"}</td>
      <td><input data-pf="cond" value="${esc(x.cond)}" style="width:96px"></td>
      <td><input type="date" data-pf="paidDate" value="${esc(x.paidDate)}" style="width:140px"></td>
      <td><select data-pf="status">${opts(PAYMENT_STATUSES, x.status || "미청구")}</select></td>
      <td class="nowrap"><button type="button" class="icon" data-pmove="-1" title="위로">↑</button><button type="button" class="icon" data-pmove="1" title="아래로">↓</button><button type="button" class="icon" data-pdel title="삭제">✕</button></td></tr>`).join("") || `<tr><td colspan="8" class="muted center pad">위의 비율 버튼을 누르거나 ＋ 단계 추가로 입력하세요.</td></tr>`}</tbody>
    <tfoot><tr><td><b>합계</b></td><td class="num ${c.payments.length && c.ratioSum !== 100 ? "bad" : ""}"><b>${c.ratioSum}%</b></td>
      <td class="num"><b>${fmtWon(c.payments.reduce((a, x) => a + x.amount, 0))}</b></td>
      <td colspan="5" class="small ${c.payments.length && c.ratioSum !== 100 ? "bad" : "muted"}">${c.payments.length && c.ratioSum !== 100
        ? `⚠ 비율 합계가 100%가 아닙니다 <button type="button" class="btn sm" data-pfix>마지막 단계로 100% 맞추기</button>` : `정산 완료 ${c.paidRatio}% · ${fmtWon(c.paidAmount)}`}</td></tr></tfoot></table></div>
    <div class="row2" style="margin-top:8px"><button type="button" class="btn sm" data-padd>＋ 단계 추가</button>
      <button type="button" class="btn sm" data-presetsave ${c.payments.length && c.ratioSum === 100 ? "" : "disabled"} title="지금 비율을 '자주 쓰는 비율'에 추가합니다 (모든 프로젝트에서 사용)">★ 자주 쓰는 비율로 저장</button></div>`;
}
// 실행가 합계 = 실행가 + 인건비 + 재경비 + 워런티비
function totalViewHtml(c) {
  if (!c.actualCost && !c.labor) return `<div class="tc-head"><span>실행가 합계</span><b>-</b><small>실행가를 입력하면 실행가 + 인건비 + 재경비 + 워런티비로 계산됩니다</small></div>`;
  const part = (l, v, sub = "") => `<div><span>${l}</span><b>${fmtWon(v)}</b>${sub ? `<small>${sub}</small>` : ""}</div>`;
  return `<div class="tc-head"><span>실행가 합계</span><b>${fmtWon(c.totalCost)}</b>
      <small>${c.totalProfit != null ? `합계 기준 이익 ${fmtWon(c.totalProfit)} (${pctText(c.totalRate)})` : "실행가 + 인건비 + 재경비 + 워런티비"}</small></div>
    <div class="tc-parts">${part("실행가", c.actualCost)}${part("＋ 인건비", c.labor, c.mdTotal ? `${c.mdTotal} M/D` : "")}
      ${part("＋ 재경비", c.overhead, c.overheadRate ? `${c.overheadRate}%` : "")}${part("＋ 워런티비", c.warrantyCost, c.warrantyRate ? `${c.warrantyRate}%` : "")}</div>`;
}
function laborViewHtml(c) {
  const parts = [];
  parts.push(c.mdTotal ? `총 <b>${c.mdTotal} M/D</b>${c.mdText ? ` <span class="muted">(${esc(c.mdText)})</span>` : ""}` : `<span class="muted">M/D 미입력</span>`);
  parts.push(`인건비 <b class="labor-amt">${fmtWon(c.labor)}</b>${c.laborManual ? ` <span class="muted">(직접 입력)</span>` : c.mdRate && c.mdTotal ? ` <span class="muted">= ${c.mdTotal} M/D × ${fmtWon(c.mdRate)}</span>` : ""}`);
  return parts.map((x) => `<div>${x}</div>`).join("");
}
// 발주금액 대비 실행 예가·실행목표가·실행가 → 이익
const pctText = (r) => (r == null ? "" : `${(r * 100).toFixed(1)}%`);
function costViewHtml(c) {
  if (!c.amount) return `<span class="muted small">발주금액을 넣으면 이익이 계산됩니다.</span>`;
  const cell = (label, v, sub, cls = "") => `<div class="cv ${cls}"><span>${label}</span><b>${v}</b><small>${sub || ""}</small></div>`;
  return (c.totalCost && c.totalCost !== c.actualCost ? cell("합계 기준 이익", c.totalProfit != null ? fmtWon(c.totalProfit) : "-", c.totalRate != null ? `이익률 ${pctText(c.totalRate)}` : "", c.totalProfit != null && c.totalProfit < 0 ? "bad" : "") : "")
    + cell("목표 대비", c.overBudget != null ? (c.overBudget > 0 ? `+${fmtWon(c.overBudget)}` : c.overBudget < 0 ? `-${fmtWon(-c.overBudget)}` : "목표와 같음") : "-",
      c.overBudget != null ? `${c.overBasis} ${fmtWon(c.actualCost || c.estimateCost)} − 실행목표가 ${fmtWon(c.targetCost)} · ${c.overBudget > 0 ? "목표 초과" : c.overBudget < 0 ? "목표보다 절감" : "목표와 같음"}`
        : "실행목표가와 실행가(없으면 실행 예가)를 비교", c.overBudget > 0 ? "bad" : c.overBudget < 0 ? "good" : "");
}
function bindContractEdit(p, card) {
  const o = p.overview;
  const redraw = () => { card.innerHTML = contractEditHtml(p); };
  // 인건비 칸에는 자동 계산 값도 숫자로 그대로 보여 줌 (직접 고치는 중이면 건드리지 않음)
  const refreshLabor = (typing) => {
    const c = contractInfo(p), inp = $("[data-ck=laborCost]", card);
    $("#laborView", card).innerHTML = laborViewHtml(c);
    $("#totalView", card).innerHTML = totalViewHtml(c);
    for (const a of ["overhead", "warrantyCost"]) $(`#amt-${a}`, card).textContent = c[a] ? fmtWon(c[a]) : "0원";
    $("#laborMode", card).textContent = c.laborManual ? "직접 입력" : "자동 계산";
    if (!typing && !c.laborManual) inp.value = c.labor ? c.labor.toLocaleString("ko-KR") : "";
  };
  card.addEventListener("input", (e) => {
    const t = e.target;
    if ("money" in t.dataset && t.dataset.ck) {
      // 금액 칸: 쉼표를 넣고 커서 위치 유지
      const n = toAmount(t.value);
      o[t.dataset.ck] = n ? String(n) : "";
      const pos = t.value.length - t.selectionStart;
      t.value = n ? n.toLocaleString("ko-KR") : "";
      t.setSelectionRange(Math.max(0, t.value.length - pos), Math.max(0, t.value.length - pos));
      if (t.dataset.ck === "orderAmount") {
        $("#amountWords", card).textContent = n ? `금 ${koreanAmount(n)}원정` : "";
        contractInfo(p).payments.forEach((x) => { const td = $(`tr[data-id="${x.id}"] [data-amt]`, card); if (td) td.textContent = x.amount ? x.amount.toLocaleString("ko-KR") : "-"; });
      }
      // 인건비 칸: 자동 값과 같으면 자동으로, 다르면 직접 입력으로
      if ("labor" in t.dataset && toAmount(o.laborCost) === contractInfo({ ...p, overview: { ...o, laborCost: "" } }).laborAuto) o.laborCost = "";
      $("#costView", card).innerHTML = costViewHtml(contractInfo(p));
      refreshLabor("labor" in t.dataset);
    } else if (t.dataset.rate) {
      o[t.dataset.rate] = t.value.replace(/[^\d.]/g, "");
      $("#costView", card).innerHTML = costViewHtml(contractInfo(p));
      refreshLabor(false);
    } else if (t.dataset.md) {
      o.md = { ...(o.md || {}), [t.dataset.md]: t.value.replace(/[^\d.]/g, "") };
      $("#costView", card).innerHTML = costViewHtml(contractInfo(p));
      refreshLabor();
    } else if (t.dataset.ck) o[t.dataset.ck] = t.value;
    else if (t.dataset.pf) {
      const x = o.payments.find((y) => y.id === t.closest("tr").dataset.id);
      x[t.dataset.pf] = t.value;
      if (t.dataset.pf === "paidDate" && t.value && x.status !== "수금완료") x.status = "수금완료";
      // 수금완료로 바꾸면 정산일이 비어 있을 때 오늘 날짜를 넣음 → 모두 수금완료면 지급 완료일 자동
      if (t.dataset.pf === "status" && t.value === "수금완료" && !isDate(x.paidDate)) x.paidDate = today();
      syncPaidDate(p);
    } else return;
    Store.touch(p);
  });
  // 상태·정산일이 바뀌면 지급 완료일(주요 일자)도 다시 계산되므로 화면 전체를 다시 그림
  card.addEventListener("change", (e) => { const f = e.target.dataset.pf; if (f === "ratio") redraw(); else if (f === "status" || f === "paidDate") rerender(); });
  card.addEventListener("change", (e) => { if ("labor" in e.target.dataset) refreshLabor(false); });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && "paytext" in e.target.dataset) { e.preventDefault(); $("[data-payapply]", card).click(); }
  });
  card.addEventListener("click", (e) => {
    const t = e.target;
    // 비율을 새로 정할 때 단계 수가 같으면 정산일·상태는 그대로 둔다
    const applyStages = (stages, label) => {
      const old = o.payments;
      if (old.some((x) => x.status === "수금완료") && old.length !== stages.length
        && !confirm("이미 수금완료된 단계가 있습니다. 단계 수가 달라 날짜·상태가 지워집니다. 계속할까요?")) return false;
      o.payments = stages.map(([name, ratio, cond], i) => {
        const keep = old.length === stages.length ? old[i] : null;
        return { id: keep?.id || Store.uid(), name, ratio, cond: cond || keep?.cond || "", due: keep?.due || "", paidDate: keep?.paidDate || "", status: keep?.status || "미청구" };
      });
      Store.touch(p);
      return true;
    };
    if (t.dataset.preset) {
      const x = payPresets()[t.dataset.preset];
      if (!applyStages(x.stages, x.label)) return;
    } else if ("payapply" in t.dataset) {
      const stages = parsePayText($("[data-paytext]", card).value);
      if (!stages.length) { toast("예: 30/60/10 처럼 비율을 적어 주세요."); return; }
      if (!applyStages(stages, presetLabel(stages))) return;
      const sum = stages.reduce((a, x) => a + x[1], 0);
      if (sum !== 100) toast(`합계가 ${sum}% 입니다. 100%가 되도록 확인하세요.`, 4000);
    } else if (t.dataset.presetdel) {
      const x = payPresets()[t.dataset.presetdel];
      if (!confirm(`저장한 비율 '${x.label}'을 목록에서 지울까요?`)) return;
      Store.state.settings.payPresets = (Store.state.settings.payPresets || []).filter((y) => y.label !== x.label);
      Store.changed();
    } else if ("presetsave" in t.dataset) {
      const stages = o.payments.map((x) => [x.name, Number(x.ratio) || 0, x.cond || ""]);
      const label = prompt("자주 쓰는 비율 이름", stages.map((x) => x[1]).join(" : ") + " (" + stages.map((x) => x[0]).join("/") + ")");
      if (!label) return;
      const list = (Store.state.settings.payPresets ||= []);
      const i = list.findIndex((y) => y.label === label.trim());
      if (i >= 0) list[i].stages = stages; else list.push({ label: label.trim(), stages });
      Store.changed();
      toast("자주 쓰는 비율에 저장했습니다. 다른 프로젝트에서도 쓸 수 있습니다.");
    } else if ("pfix" in t.dataset) {
      const last = o.payments[o.payments.length - 1];
      const others = o.payments.slice(0, -1).reduce((a, x) => a + (Number(x.ratio) || 0), 0);
      if (others > 100) { toast("앞 단계 비율 합계가 이미 100%를 넘습니다."); return; }
      last.ratio = 100 - others;
      Store.touch(p);
    } else if (t.dataset.pmove) {
      const i = o.payments.findIndex((y) => y.id === t.closest("tr").dataset.id), j = i + Number(t.dataset.pmove);
      if (j < 0 || j >= o.payments.length) return;
      [o.payments[i], o.payments[j]] = [o.payments[j], o.payments[i]];
      Store.touch(p);
    } else if ("padd" in t.dataset) {
      o.payments.push({ id: Store.uid(), name: "", ratio: Math.max(0, 100 - contractInfo(p).ratioSum), cond: "", due: "", paidDate: "", status: "미청구" });
      Store.touch(p);
    } else if ("pdel" in t.dataset) {
      o.payments = o.payments.filter((y) => y.id !== t.closest("tr").dataset.id);
      Store.touch(p);
    } else return;
    redraw();
  });
}

function payDialog(p) {
  openDialog(`<h3>⚙ 정산 비율 설정</h3><div id="payBox"></div>`, () => { rerender(); }, { wide: true, okLabel: "완료", onOpen: (dlg) => {
    const box = $("#payBox", dlg);
    box.innerHTML = contractEditHtml(p);
    bindContractEdit(p, box);
    $("[data-cancel]", dlg).textContent = "닫기";
    dlg.addEventListener("close", () => rerender());
  } });
}

// ------------------------------------------------------------- 개요 (요약 / 정보 수정)
function tabOverview(p, el) {
  const mode = route.ovMode === "edit" ? "edit" : "view";
  el.innerHTML = `<div class="between wrap toolbar"><nav class="seg">
      <button data-ovmode="view" class="${mode === "view" ? "active" : ""}">📋 요약</button>
      <button data-ovmode="edit" class="${mode === "edit" ? "active" : ""}">✏️ 정보 수정</button></nav></div><div id="ovBody"></div>`;
  $$("[data-ovmode]", el).forEach((b) => (b.onclick = () => { route.ovMode = b.dataset.ovmode; rerender(); }));
  (mode === "edit" ? tabOverviewEdit : tabOverviewView)(p, $("#ovBody", el));
}

function tabOverviewView(p, el) {
  const o = p.overview, base = today();
  const s = projectSummary(p, base);
  const infos = scheduleInfos(p.schedule, base);
  const tasks = p.schedule.map((t, k) => ({ t, i: infos[k] }));
  const done = tasks.filter((x) => x.i.status === "완료").length;
  const empty = `<span class="ov-empty">미입력</span>`;

  // 기간 경과 원형 그래프
  const pctv = s.progress ?? 0, R = 52, C = 2 * Math.PI * R;
  const ring = `<div class="ov-ring"><svg viewBox="0 0 120 120" aria-hidden="true">
      <circle cx="60" cy="60" r="${R}" class="ring-bg"/><circle cx="60" cy="60" r="${R}" class="ring-fg ${s.delayed.length ? "late" : ""}"
        stroke-dasharray="${(C * pctv) / 100} ${C}" transform="rotate(-90 60 60)"/></svg>
      <div class="ring-text"><b>${s.progress === null ? "–" : pctv + "%"}</b><span>기간 경과</span></div></div>`;

  // 사업 범위: "Conveyor AMR : 2EA" → 이름 + 수량
  const scope = (o.scope || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)\s*[:：]\s*(\d+\s*(?:EA|ea|대|개|set|SET|식)?)\s*$/.exec(l);
    return m ? `<div class="scope-item"><span>${esc(m[1])}</span><b>${esc(m[2])}</b></div>` : `<div class="scope-item"><span>${esc(l)}</span></div>`;
  }).join("");

  // 주요 일정 띠: 시작~종료 사이에 하루짜리 일정(DR, 검수, 납품 등)을 점으로
  let strip = "";
  if (s.start && s.end) {
    const a = dayNo(s.start), z = dayNo(s.end), span = Math.max(1, z - a);
    const at = (d) => Math.max(0, Math.min(100, ((dayNo(d) - a) / span) * 100));
    const suspect = suspectTasks(p.schedule);
    // 같은 날 일정은 하나로 합치고, 글자가 겹치지 않게 위/아래 자리를 고른다 (자리가 없으면 점만 표시)
    const byDate = new Map();
    tasks.filter((x) => x.t.start && x.t.start === x.t.end && !suspect.has(x.t.id))
      .sort((x, y) => x.t.start.localeCompare(y.t.start))
      .forEach((x) => { if (!byDate.has(x.t.start)) byDate.set(x.t.start, []); byDate.get(x.t.start).push(x); });
    // 글자 너비를 실제 화면 너비 기준 %로 계산 (휴대폰에서도 겹치지 않게)
    const stripW = Math.max(240, (el.clientWidth || 1000) - 60);
    const pw = (px) => (px / stripW) * 100;
    const lanes = { up: -100, down: at(base) + pw(30) };
    const ms = [...byDate.values()].slice(0, 10).map((list) => {
      const x = list[0], pos = at(x.t.start);
      const name = x.t.name.replace(/^[-\s]+/, "") + (list.length > 1 ? ` 외 ${list.length - 1}` : "");
      const w = pw(Math.min(130, name.length * 7 + 14));
      const lane = ["up", "down"].sort((l1, l2) => lanes[l1] - lanes[l2]).find((l) => pos - w / 2 > lanes[l] && !(l === "down" && Math.abs(pos - at(base)) < pw(30))) || "";
      if (lane) lanes[lane] = pos + w / 2;
      const status = list.some((y) => y.i.status === "지연") ? "지연" : list.every((y) => y.i.status === "완료") ? "완료" : x.i.status;
      return { x, list, pos, name, lane, status };
    });
    strip = `<div class="card ov-strip"><div class="between"><h3>주요 일정</h3><span class="muted small">${esc(fmtDot(s.start))} ~ ${esc(fmtDot(s.end))} · ${dday(s.end)}</span></div>
      <div class="strip"><div class="strip-line"><span style="width:${at(base)}%"></span></div>
        <span class="strip-now" style="left:${at(base)}%"><em>오늘</em></span>
        ${ms.map((m) => `<span class="strip-dot st-${m.status} ${m.lane} ${m.pos > 96 ? "edge-r" : m.pos < 4 ? "edge-l" : ""}" style="left:${m.pos}%" title="${esc(m.list.map((y) => y.t.name).join(", "))} · ${esc(m.x.t.start)}">
          ${m.lane ? `<em><b>${esc(m.name)}</b>${esc(fmtDot(m.x.t.start).slice(5))}</em>` : ""}</span>`).join("")}
      </div>
      <div class="between small muted"><span>시작 ${esc(fmtDot(s.start))}</span><span>종료 ${esc(fmtDot(s.end))}</span></div></div>`;
  }

  const fact = (icon, label, v) => `<div class="fact"><span class="fact-icon">${icon}</span><div><span>${label}</span><b>${v ? esc(v) : empty}</b></div></div>`;
  const tile = (tab, icon, label, value, cls = "", extra = "") =>
    `<button class="stat ${cls}" data-goto="${p.id}" data-tab="${tab}" ${extra}><span class="stat-icon">${icon}</span><b>${value}</b><span>${label}</span></button>`;
  const upcoming = tasks.filter((x) => x.i.status !== "완료" && isDate(x.t.end) && dayNo(x.t.end) >= dayNo(base))
    .sort((x, y) => (x.i.status === "진행" ? x.t.end : x.t.start).localeCompare(y.i.status === "진행" ? y.t.end : y.t.start)).slice(0, 5);
  const revs = [...p.revisions].reverse().slice(0, 6);
  const c = contractInfo(p);
  const kd = keyDates(p);
  const kdCard = (() => {
    const steps = [["🚀", "Kick Off", kd.kickoffDate], ["🚚", "납품 (입고)", kd.receiveDate], ["🔧", "Setup 완료", kd.setupDate],
      ["🛡", "Warranty", { value: kd.warranty.start, end: kd.warranty.end, pending: !kd.warranty.started }], ["💰", "지급 완료", kd.paidDate]];
    const nowIdx = steps.map((x) => x[2].value).filter((v) => isDate(v) && v <= base).length;
    return `<div class="card kd-card"><div class="between"><h3>주요 일자</h3>
        ${kd.warranty.started ? `<span class="pill ${kd.warranty.state === "만료" ? "bad" : ""}">🛡 Warranty ${kd.warranty.state}${kd.warranty.remain != null ? ` · ${kd.warranty.remain}일 남음` : ""}</span>` : ""}</div>
      <div class="kd-steps">${steps.map(([ico, label, x]) => {
        // Warranty 는 시작 전이면 날짜 대신 '시작 전'과 기간만
        if (label === "Warranty" && x.pending) return `<div class="kd-step ${isDate(x.value) ? "next" : "empty"}"><span class="kd-ico">${ico}</span><span class="kd-label">${label}</span>
          <b>시작 전</b><span class="kd-sub">${isDate(x.value) ? `${esc(fmtDot(x.value))}부터 ` : ""}${esc(kd.warranty.period || "")}</span></div>`;
        return `<div class="kd-step ${isDate(x.value) ? (x.value <= base ? "done" : "next") : "empty"}">
        <span class="kd-ico">${ico}</span><span class="kd-label">${label}</span>
        <b>${isDate(x.value) ? esc(fmtDot(x.value)) : x.missing ? "수금완료" : "미정"}</b>
        <span class="kd-sub ${x.missing ? "warn" : ""}">${x.missing ? "정산일 미입력" : x.end ? `~ ${esc(fmtDot(x.end))} (${kd.warranty.years}년)` : isDate(x.value) && x.value > base ? dday(x.value) : x.auto ? "자동" : ""}</span></div>`;
      }).join("")}</div>
    </div>`;
  })();
  const payColor = { 수금완료: "pay-done", 청구: "pay-billed", 미청구: "pay-todo" };
  const contractCard = c.amount || o.orderDate || c.estimateCost || c.targetCost || c.actualCost || c.payments.length ? `<div class="card ov-contract">
      <div class="contract-head">
        <div><span class="muted small">발주일</span><b>${isDate(o.orderDate) ? esc(fmtDot(o.orderDate)) : empty}</b></div>
        <div><span class="muted small">발주금액 (부가세 ${esc(o.vat || "별도")})</span><b class="amount">${c.amount ? fmtWon(c.amount) : empty}</b>
          ${c.amount ? `<span class="muted small">금 ${koreanAmount(c.amount)}원정</span>` : ""}</div>
        <div><span class="muted small">실행 예가</span><b>${c.estimateCost ? fmtWon(c.estimateCost) : empty}</b>
</div>
        <div><span class="muted small">실행목표가</span><b>${c.targetCost ? fmtWon(c.targetCost) : empty}</b>
</div>
        <div><span class="muted small">실행가</span><b class="${c.actualCost && c.overBudget > 0 ? "bad" : ""}">${c.actualCost ? fmtWon(c.actualCost) : empty}</b>
          <span class="muted small">${c.actualCost && c.overBudget > 0 ? `목표 초과 ${fmtWon(c.overBudget)}` : ""}</span></div>
        ${c.totalCost && c.totalCost !== c.actualCost ? `<div><span class="muted small">실행가 합계</span><b>${fmtWon(c.totalCost)}</b>
          <span class="muted small">${[c.labor && `인건비 ${fmtWon(c.labor)}`, c.overhead && `재경비 ${fmtWon(c.overhead)}`, c.warrantyCost && `워런티비 ${fmtWon(c.warrantyCost)}`].filter(Boolean).join(" · ")}${c.totalProfit != null ? ` · 이익 ${fmtWon(c.totalProfit)} (${pctText(c.totalRate)})` : ""}</span></div>` : ""}
        ${c.labor || c.mdTotal ? `<div><span class="muted small">인건비</span><b>${c.labor ? fmtWon(c.labor) : empty}</b>
          <span class="muted small">${c.mdTotal ? `${esc(c.mdText)} = ${c.mdTotal} M/D` : ""}</span></div>` : ""}
        <div><span class="muted small">정산 진행</span><b>${c.paidRatio}%</b><span class="muted small">${c.paidAmount ? `${fmtWon(c.paidAmount)} 수금` : "수금 전"}</span></div>
      </div>
      ${c.payments.length ? `<div class="paybar">${c.payments.map((x) => `<span class="${payColor[x.status] || "pay-todo"}" style="flex:${Number(x.ratio) || 0}" title="${esc(x.name)} ${esc(x.ratio)}% · ${x.status}"></span>`).join("")}</div>
      <div class="paylist">${c.payments.map((x) => `<div class="payitem"><span class="dot2 ${payColor[x.status] || "pay-todo"}"></span>
        <div><b>${esc(x.name)} ${esc(x.ratio)}%</b><span>${fmtWon(x.amount)}</span>
        <span class="muted small">${esc(x.cond || "")}${x.status === "수금완료" && x.paidDate ? ` · ${esc(fmtDot(x.paidDate))} 수금` : ""}</span></div>
        ${badge(x.status === "수금완료" ? "완료" : x.status === "청구" ? "진행" : "예정")}</div>`).join("")}</div>
      ${c.ratioSum !== 100 ? `<p class="bad small">⚠ 정산 비율 합계가 ${c.ratioSum}% 입니다.</p>` : ""}` : `<p class="muted small">정산 비율이 없습니다.</p>`}
      <div class="contract-foot"><button class="btn sm" data-paydlg>⚙ 정산 비율 설정</button></div>
    </div>` : `<div class="card ov-contract between"><span class="muted small">발주일·발주금액·실행 예가·정산 비율이 아직 없습니다.</span>
      <span class="row2"><button class="btn sm" data-paydlg>⚙ 정산 비율 설정</button><button class="btn sm" data-ovedit>✏️ 정보 수정</button></span></div>`;

  el.innerHTML = `
    <div class="card ov-hero">
      <div class="ov-hero-main">
        <div class="ov-eyebrow">${o.customer ? `🏢 ${esc(o.customer)}` : "고객사 미입력"}</div>
        <h2>${esc(o.project || o.name)}</h2>
        ${o.project ? `<div class="ov-sub">설비/품목명 · ${esc(o.name)}</div>` : ""}
        <div class="ov-pills"><span class="pill status-pill" title="일정표 기준 상태 · 완료·보류는 ✏️ 정보 수정에서 지정">상태 ${stBadge(p)}</span>
          ${o.manager ? `<span class="pill">👤 ${esc(o.manager)}</span>` : ""}
          ${o.status === "완료"
            ? `<span class="pill">🏁 ${isDate(p.report?.completedDate) ? `${esc(fmtDot(p.report.completedDate))} 완료` : "완료"}</span>`
            : s.end ? `<span class="pill">🏁 종료 예정 ${esc(fmtDot(s.end))} · <b>${dday(s.end)}</b></span>` : ""}
          ${s.delayed.length ? `<span class="pill bad">⚠ 지연 ${s.delayed.length}건</span>` : ""}</div>
      </div>
      ${ring}
    </div>

    <div class="ov-grid">
      <div class="card"><h3>기본 정보</h3><div class="facts">
        ${fact("🔖", "Project No", o.projectNo)}${fact("🧩", "Part No", o.partNo)}
        ${fact("📦", "입고일자 (납품)", kd.receiveDate.value ? fmtDot(kd.receiveDate.value) + (kd.receiveDate.auto ? " · 일정 기준" : "") : "")}${fact("📍", "입고 장소", o.receivePlace)}
        ${fact("👤", "담당자", o.manager)}${fact("🛡", "Warranty", kd.warranty.started
          ? (kd.warranty.end ? `${fmtDot(kd.warranty.start)} ~ ${fmtDot(kd.warranty.end)}` : `${fmtDot(kd.warranty.start)} 시작`)
          : kd.warranty.state === "시작 전" ? `시작 전${kd.warranty.period ? ` · ${isDate(kd.warranty.start) ? fmtDot(kd.warranty.start) + "부터 " : ""}${kd.warranty.period}` : ""}` : "")}
        ${o.extra.filter((x) => x.label).map((x) => fact("•", esc(x.label), x.value)).join("")}
      </div></div>
      <div class="card"><h3>사업 범위</h3>${scope ? `<div class="scope">${scope}</div>` : `<p class="muted">사업 범위가 비어 있습니다. <a href="#" data-ovedit>정보 수정</a>에서 입력하세요.</p>`}
        <h3 style="margin-top:18px">비고</h3>${o.note ? `<div class="ov-note">${nl2br(o.note)}</div>` : `<p class="muted">비고가 없습니다. <a href="#" data-ovedit>정보 수정</a>에서 입력하세요.</p>`}</div>
    </div>

    ${kdCard}
    ${contractCard}
    ${strip}

    <div class="stats-row">
      ${tile("schedule", "📅", "일정 완료", `${done}<small>/${tasks.length}</small>`)}
      ${tile("schedule", "⚠", "지연 일정", s.delayed.length, s.delayed.length ? "bad" : "")}
      ${tile("records", "📨", "자료 이력", p.records.length)}
      ${tile("meetings", "📝", "미완료 의제", s.openActions.length, s.openActions.length ? "warn" : "")}
      ${tile("parts", "🔩", "BOM 품목", bomItemCount(p))}
      ${tile("submissions", "📤", "미제출 자료", s.pendingSubmissions.length, s.pendingSubmissions.length ? "warn" : "")}
    </div>

    <div class="ov-grid three">
      <div class="card"><h3>다가오는 일정</h3>${upcoming.length ? `<ul class="mini">${upcoming.map((x) => `
        <li data-goto="${p.id}" data-tab="schedule"><span>${x.i.status === "진행" ? badge("진행") : ""} ${esc(x.t.name)}</span>
        <b>${x.i.status === "진행" ? `${x.i.remain}일 남음` : `${esc(fmtDot(x.t.start).slice(5))} <span class="muted">${dday(x.t.start)}</span>`}</b></li>`).join("")}</ul>`
        : `<p class="muted small">예정된 일정이 없습니다.</p>`}</div>
      <div class="card"><h3>미완료 실천 의제</h3>${s.openActions.length ? `<ul class="mini">${s.openActions.slice(0, 5).map((a) => `
        <li data-goto="${p.id}" data-tab="meetings" data-meeting="${a.meeting.id}"><span>${esc(a.text)}</span><b class="muted">${esc(a.owner)}</b></li>`).join("")}</ul>`
        : `<p class="muted small">남은 의제가 없습니다.</p>`}</div>
      <div class="card"><h3>최근 기록 <span class="muted small">Revision</span></h3>${revs.length ? `<ul class="mini">${revs.map((r) => `
        <li data-goto="${p.id}" data-tab="revisions"><span>${esc(r.content)}</span><b class="muted">${esc(fmtDot(r.date).slice(5))}</b></li>`).join("")}</ul>`
        : `<p class="muted small">기록이 없습니다.</p>`}</div>
    </div>`;
  bindGoto(el);
  $$("[data-ovedit]", el).forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); route.ovMode = "edit"; rerender(); }));
  $$("[data-paydlg]", el).forEach((b) => (b.onclick = () => payDialog(p)));
}

// ------------------------------------------------------------- 일정 (간트)
function tabScheduleEdit(p, el) {
  const base = today();
  const s = projectSummary(p, base);
  const infos = scheduleInfos(p.schedule, base);
  const row = (t, i) => {
    const info = infos[i];
    return `<tr data-id="${t.id}" class="${t.phase !== p.schedule[i - 1]?.phase ? "phase-start" : ""}">
      <td><input type="checkbox" data-f="done" ${t.done ? "checked" : ""} title="완료"></td>
      <td><input data-f="phase" value="${esc(t.phase)}" class="w-phase"></td>
      <td><input data-f="name" value="${esc(t.name)}" class="w-name"></td>
      <td><input data-f="owner" value="${esc(t.owner)}" class="w-owner"></td>
      <td><input type="date" data-f="start" value="${esc(t.start)}"></td>
      <td><input type="date" data-f="end" value="${esc(t.end)}"></td>
      <td class="num" data-c="dur">${info.dur}</td><td class="num" data-c="elapsed">${info.elapsed}</td><td class="num" data-c="remain">${info.remain}</td>
      <td data-c="status">${badge(info.status)}</td>
      <td><input data-f="note" value="${esc(t.note)}" class="w-note"></td>
      <td class="nowrap"><button class="icon" data-move="-1" title="위로">↑</button><button class="icon" data-move="1" title="아래로">↓</button><button class="icon" data-ins title="아래에 행 추가">＋</button><button class="icon" data-del title="삭제">✕</button></td></tr>`;
  };
  el.insertAdjacentHTML("beforeend", `<div class="card">
    <div class="between wrap"><div class="row2"><span>기준일 <b>${esc(base)}</b></span>
      ${s.delayed.length ? `<span class="bad">지연 ${s.delayed.length}건</span>` : ""}</div>
      <button class="btn primary sm" id="addTask">＋ 일정 추가</button></div>
    <p class="muted small">끝난 일정은 ✓ 체크하세요. 종료일이 지났는데 체크가 없으면 <b class="bad">지연</b>으로 표시됩니다. 엑셀에서 여러 행을 복사해 붙여넣을 수도 있습니다.</p>
    <div class="table-scroll"><table class="sched grid-table" data-schedule>
      <thead><tr><th>✓</th><th>단계</th><th>세부사항</th><th>담당자</th><th>시작일</th><th>종료일</th><th>기간</th><th>경과</th><th>잔여</th><th>상태</th>
      <th>비고</th><th></th></tr></thead>
      <tbody>${p.schedule.map(row).join("") || `<tr><td colspan="12" class="muted center pad">등록된 일정이 없습니다.</td></tr>`}</tbody></table></div></div>`);

  const tbody = $("tbody", el);
  if (route.task) {
    const tr = $(`tr[data-id="${route.task}"]`, tbody);
    if (tr) { tr.classList.add("focus"); setTimeout(() => tr.scrollIntoView({ block: "center" })); }
    route.task = null;
  }
  const find = (tr) => p.schedule.find((t) => t.id === tr.dataset.id);
  tbody.addEventListener("input", (e) => {
    const tr = e.target.closest("tr[data-id]");
    if (!tr) return;
    const t = find(tr), f = e.target.dataset.f;
    t[f] = f === "done" ? e.target.checked : e.target.value;
    if (f === "done") t.doneDate = t.done ? today() : "";
    if (f === "start" && isDate(t.start) && (!isDate(t.end) || t.end < t.start)) { t.end = t.start; $("[data-f=end]", tr).value = t.end; }
    Store.touch(p);
    if (["done", "start", "end"].includes(f)) {
      const info = taskInfo(t, base);
      for (const k of ["dur", "elapsed", "remain"]) $(`[data-c=${k}]`, tr).textContent = info[k];
      // 날짜 없는 세부 항목은 위 일정을 따르므로 전체 상태를 다시 표시
      scheduleInfos(p.schedule, base).forEach((x, k) => {
        const cell = $(`tr[data-id="${p.schedule[k].id}"] [data-c=status]`, tbody);
        if (cell) cell.innerHTML = badge(x.status);
      });
    }
  });
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

// ------------------------------------------------------------- 일정 (보기/편집 전환)
const collapsedPhases = new Set();
function tabSchedule(p, el) {
  const mode = route.schedMode === "edit" ? "edit" : "view";
  el.innerHTML = `<div class="between wrap toolbar"><nav class="seg">
      <button data-mode="view" class="${mode === "view" ? "active" : ""}">📊 한눈에 보기</button>
      <button data-mode="edit" class="${mode === "edit" ? "active" : ""}">✏️ 표로 편집</button></nav>
    ${mode === "view" ? `<nav class="seg small-seg">
      <button data-range="all" class="${route.schedRange !== "near" ? "active" : ""}">전체 기간</button>
      <button data-range="near" class="${route.schedRange === "near" ? "active" : ""}">오늘 전후 2달</button></nav>` : ""}</div>`;
  $$("[data-mode]", el).forEach((b) => (b.onclick = () => { route.schedMode = b.dataset.mode; rerender(); }));
  $$("[data-range]", el).forEach((b) => (b.onclick = () => { route.schedRange = b.dataset.range; rerender(); }));
  (mode === "edit" ? tabScheduleEdit : tabScheduleView)(p, el);
}

function tabScheduleView(p, el) {
  const base = today(), b = dayNo(base);
  const s = projectSummary(p, base);
  const infos = scheduleInfos(p.schedule, base);
  const tasks = p.schedule.map((t, k) => ({ t, i: infos[k] }));
  if (!tasks.length) {
    el.insertAdjacentHTML("beforeend", `<div class="card muted center pad">등록된 일정이 없습니다. <b>✏️ 표로 편집</b>에서 일정을 추가하세요.</div>`);
    return;
  }
  // 동떨어진 날짜는 표시만 하고 보기 범위 계산에서 뺀다
  const suspect = suspectTasks(p.schedule);
  const dated = tasks.filter((x) => isDate(x.t.start) && isDate(x.t.end) && !suspect.has(x.t.id));
  let min = dated.length ? Math.min(...dated.map((x) => dayNo(x.t.start))) : b - 14;
  let max = dated.length ? Math.max(...dated.map((x) => dayNo(x.t.end))) : b + 60;
  if (route.schedRange === "near") { min = b - 30; max = b + 31; }
  min = Math.min(min, b) - 2;
  max = Math.max(max, b) + 3;
  const span = max - min;
  const pct = (d) => Math.max(0, Math.min(100, ((d - min) / span) * 100));
  const dateStr = (d) => { const x = new Date(d * 86400000); return `${x.getUTCMonth() + 1}.${x.getUTCDate()}`; };

  // 눈금: 달 경계(굵게), 기간이 짧으면 주(월요일) 경계
  const ticks = [];
  for (let d = min; d <= max; d++) {
    const x = new Date(d * 86400000);
    if (x.getUTCDate() === 1) ticks.push({ d, cls: "month", label: `${x.getUTCFullYear() % 100}년 ${x.getUTCMonth() + 1}월` });
    else if (span <= 150 && x.getUTCDay() === 1) ticks.push({ d, cls: "week", label: span <= 75 ? dateStr(d) : "" });
  }
  const grid = ticks.map((k) => `<i class="tick ${k.cls}" style="left:${pct(k.d)}%"></i>`).join("") +
    `<i class="now" style="left:${pct(b)}%"></i>`;
  const placed = [{ at: pct(b), w: 9 }];
  const free = (at, w) => at + w < 100 && placed.every((x) => at + w <= x.at - x.w / 2 || at >= x.at + x.w / 2);
  const labels = [...ticks.filter((k) => k.cls === "month"), ...ticks.filter((k) => k.cls === "week")].filter((k) => k.label)
    .filter((k) => { const at = pct(k.d), w = k.cls === "month" ? 8 : 4; if (!free(at, w)) return false; placed.push({ at: at + w / 2, w }); return true; });
  const axis = labels.map((k) => `<span class="${k.cls}" style="left:${pct(k.d)}%">${k.label}</span>`).join("") +
    `<span class="now-label" style="left:${pct(b)}%">오늘 ${dateStr(b)}</span>`;

  const barHtml = (t, i, cls = "") => {
    if (!isDate(t.start) || !isDate(t.end))
      return i.inherit ? `<span class="gv-nodate">↳ ${esc(i.inherit)} 일정 · ${esc(i.status)}</span>` : `<span class="gv-nodate">날짜 미정</span>`;
    const s0 = dayNo(t.start), e0 = dayNo(t.end) + 1;
    if (e0 <= min || s0 >= max) return `<span class="gv-nodate">${s0 >= max ? "→" : "←"} ${esc(fmtDot(t.start))}</span>`;
    const left = pct(s0), right = pct(e0);
    const label = t.start === t.end ? dateStr(s0) : `${dateStr(s0)}~${dateStr(e0 - 1)}`;
    const tip = `${t.name} · ${t.start} ~ ${t.end} (${i.dur}일, ${i.status}${i.remain ? `, 잔여 ${i.remain}일` : ""})`;
    // 날짜 글자는 막대 오른쪽에, 자리가 없으면 왼쪽에, 양쪽 다 없으면 막대 안에
    const lbl = right <= 85 ? `<span class="gv-lbl" style="left:${right}%">${label}</span>`
      : left >= 12 ? `<span class="gv-lbl" style="right:${100 - left}%;text-align:right">${label}</span>`
      : `<span class="gv-lbl inside" style="left:${left}%">${label}</span>`;
    if (t.start === t.end) return `<span class="gv-ms st-${i.status} ${cls}" style="left:${left}%" title="${esc(tip)}"></span>${lbl}`;
    // 진행 중이면 오늘까지 진하게 채워 진행 정도를 보여준다
    const fill = i.status === "진행" ? `<span class="gv-fill" style="width:${(i.elapsed / i.dur) * 100}%"></span>` : "";
    return `<span class="gv-bar st-${i.status} ${cls}" style="left:${left}%;width:${Math.max(0.5, right - left)}%" title="${esc(tip)}">${fill}</span>${lbl}`;
  };

  // 같은 단계끼리 묶기 (나온 순서 유지)
  const groups = [];
  for (const x of tasks) {
    const g = groups.find((y) => y.phase === (x.t.phase || "기타"));
    if (g) g.items.push(x); else groups.push({ phase: x.t.phase || "기타", items: [x] });
  }
  const rows = groups.map((g) => {
    const done = g.items.filter((x) => x.i.status === "완료").length;
    const st = g.items.some((x) => x.i.status === "지연") ? "지연" : done === g.items.length ? "완료"
      : g.items.some((x) => ["진행", "완료"].includes(x.i.status)) ? "진행" : "예정";
    const gd = g.items.filter((x) => isDate(x.t.start) && isDate(x.t.end) && !suspect.has(x.t.id));
    const span = gd.length ? { start: gd.map((x) => x.t.start).sort()[0], end: gd.map((x) => x.t.end).sort().pop() } : { start: "", end: "" };
    const key = g.phase;
    const warn = (t) => (suspect.has(t.id) ? `<span class="gv-warn" title="다른 일정과 동떨어진 날짜(${esc(t.start)} ~ ${esc(t.end)})입니다. 입력 실수인지 확인하세요.">⚠ 날짜 확인</span>` : "");
    if (g.items.length === 1) {
      const { t, i } = g.items[0];
      return `<div class="gv-row gv-phase gv-single" data-task="${t.id}">
        <div class="gv-label"><span class="caret"></span><b>${esc(g.phase)}</b>${t.name !== g.phase ? `<span class="gv-name muted">${esc(t.name)}</span>` : ""}
          ${warn(t)}${t.owner ? `<span class="gv-owner">${esc(t.owner)}</span>` : ""}${badge(i.status)}</div>
        <div class="gv-time">${grid}${barHtml(t, i)}</div></div>`;
    }
    const closed = collapsedPhases.has(key) || (!collapsedPhases.has("!" + key) && st === "완료" && g.items.length > 1);
    const head = `<div class="gv-row gv-phase" data-phase="${esc(key)}">
      <div class="gv-label"><span class="caret">${closed ? "▸" : "▾"}</span><b>${esc(g.phase)}</b>
        <span class="gv-count ${st === "지연" ? "bad" : ""}">${done}/${g.items.length}</span>${badge(st)}</div>
      <div class="gv-time">${grid}${barHtml({ ...span, name: g.phase }, { ...taskInfo(span, base), status: st }, "phase")}</div></div>`;
    if (closed) return head;
    return head + g.items.map(({ t, i }) => `<div class="gv-row gv-task ${i.status === "지연" ? "late" : ""}" data-task="${t.id}">
      <div class="gv-label"><span class="gv-name">${esc(t.name)}</span>${warn(t)}${t.owner ? `<span class="gv-owner">${esc(t.owner)}</span>` : ""}</div>
      <div class="gv-time">${grid}${barHtml(t, i)}</div></div>`).join("");
  }).join("");

  // 지금 볼 것: 지연 / 진행 중 / 다가오는 일정
  const mini = (list, empty, fmt) => list.length ? `<ul class="mini">${list.map(fmt).join("")}</ul>` : `<p class="muted small">${empty}</p>`;
  // 세부 항목(위 일정을 따르는 것)은 목록에 겹쳐 나오지 않게 뺌
  const delayed = tasks.filter((x) => x.i.status === "지연" && !x.i.inherit);
  const active = tasks.filter((x) => x.i.status === "진행" && !x.i.inherit).sort((a, c) => a.t.end.localeCompare(c.t.end));
  const next = tasks.filter((x) => x.i.status === "예정" && isDate(x.t.start)).sort((a, c) => a.t.start.localeCompare(c.t.start)).slice(0, 4);
  const item = (x, right) => `<li data-task="${x.t.id}"><span>${x.t.phase && x.t.phase !== x.t.name ? `<span class="muted small">${esc(x.t.phase)}</span> ` : ""}${esc(x.t.name)}</span><b>${right}</b></li>`;

  el.insertAdjacentHTML("beforeend", `
    <div class="sched-summary">
      <div class="card"><div class="between"><h3>전체 진행</h3><b>${s.end ? dday(s.end) : ""}</b></div>
        ${s.progress !== null ? `<div class="progress big"><span style="width:${s.progress}%"></span></div>
        <div class="between small muted"><span>${esc(fmtDot(s.start))}</span><span>${s.progress}% 경과</span><span>${esc(fmtDot(s.end))}</span></div>` : ""}
        <div class="small" style="margin-top:6px">완료 <b>${tasks.filter((x) => x.i.status === "완료").length}</b> / 전체 ${tasks.length}</div></div>
      <div class="card ${delayed.length ? "card-bad" : ""}"><h3>⚠ 지연 ${delayed.length}</h3>${mini(delayed, "지연된 일정이 없습니다.", (x) => item(x, `<span class="bad">${dday(x.t.end)}</span>`))}</div>
      <div class="card"><h3>▶ 진행 중 ${active.length}</h3>${mini(active, "진행 중인 일정이 없습니다.", (x) => item(x, `${x.i.remain}일 남음`))}</div>
      <div class="card"><h3>📅 다음 일정</h3>${mini(next, "예정된 일정이 없습니다.", (x) => item(x, `${esc(fmtDot(x.t.start))} <span class="muted">${dday(x.t.start)}</span>`))}</div>
    </div>
    ${suspect.size ? `<div class="notice">⚠ 다른 일정과 동떨어진 날짜가 ${suspect.size}건 있어 보기 범위에서 뺐습니다:
      ${[...suspect].map((id) => p.schedule.find((t) => t.id === id)).map((t) => `<a href="#" data-task="${t.id}">${esc(t.phase)} · ${esc(t.name)} (${esc(fmtDot(t.start))})</a>`).join(", ")}
      — 입력 실수라면 눌러서 고치세요.</div>` : ""}
    <div class="card gv">
      <div class="gv-row gv-axis"><div class="gv-label muted small">단계 / 세부사항 · 담당</div><div class="gv-time">${axis}</div></div>
      ${rows}
      <div class="gv-foot muted small"><span class="legend"><i class="st-완료"></i>완료 <i class="st-진행"></i>진행 <i class="st-예정"></i>예정 <i class="st-지연"></i>지연 ◆ 하루 일정</span>
        <span>단계 이름을 누르면 접고 펼칩니다 · 일정을 누르면 편집 화면으로 이동합니다</span></div>
    </div>`);

  $$(".gv-phase:not(.gv-single)", el).forEach((r) => (r.onclick = () => {
    const k = r.dataset.phase;
    const isClosed = r.querySelector(".caret").textContent === "▸";
    collapsedPhases.delete(k); collapsedPhases.delete("!" + k);
    collapsedPhases.add(isClosed ? "!" + k : k);
    rerender();
  }));
  $$("[data-task]", el).forEach((r) => (r.onclick = () => { route.schedMode = "edit"; route.task = r.dataset.task; rerender(); }));
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
  const def = listDef(p, key);
  const rows = listRows(p, key);
  const others = def.unit ? def.units.filter((u) => u !== def.unit) : [];
  // 계산 열(예: 총 수량)은 after 로 지정한 입력 열 바로 뒤에
  const comps = (c) => (def.computed || []).map((x, k) => [x, k]).filter(([x]) => x.after === c.key);
  return `<div class="card" data-grid="${key}">
    <div class="between"><h3>${def.title} <span class="muted small">${rows.length}건</span></h3>
      <span class="row2">${rows.length ? `<button class="btn danger sm" data-delsel disabled>선택 삭제</button><button class="btn sm" data-delall>전체 삭제</button>` : ""}
      <button class="btn primary sm" data-addrow>＋ 행 추가</button></span></div>
    ${help ? `<p class="muted small">${help}</p>` : `<p class="muted small">칸을 눌러 바로 수정합니다. 엑셀에서 여러 행을 복사해 칸에 붙여넣으면 한 번에 입력됩니다.</p>`}
    <div class="table-scroll"><table class="grid-table">
      <thead><tr><th class="sel"><input type="checkbox" data-selall title="전체 선택"></th><th class="num">NO</th>${def.cols.map((c) => `<th>${c.label}</th>${comps(c).map(([x]) => `<th class="num">${x.label}</th>`).join("")}`).join("")}${def.files ? "<th>첨부</th>" : ""}<th></th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr data-id="${r.id}" class="${/^■/.test(r.item || "") ? "sec-row" : ""}"><td class="sel"><input type="checkbox" data-sel></td><td class="num muted">${i + 1}</td>${def.cols.map((c) => `<td>${gridInput(c, r[c.key])}</td>${comps(c).map(([x, k]) => `<td class="num computed" data-comp="${k}">${esc(x.fn(r, def.unit))}</td>`).join("")}`).join("")}
        ${def.files ? `<td class="files-cell">${fileChips(r.files, { removable: true })}<button class="icon" data-attach title="파일 첨부">📎</button></td>` : ""}
        <td class="nowrap">${others.length ? `<select class="move-unit" data-moveunit title="다른 설비로 이동"><option value="">⇄</option>${others.map((u) => `<option value="${u.id}">→ ${esc(u.name)}</option>`).join("")}</select>` : ""}<button class="icon" data-ins title="아래에 행 추가">＋</button><button class="icon" data-delrow title="삭제">✕</button></td></tr>`).join("")
        || `<tr><td colspan="${def.cols.length + (def.computed || []).length + 4}" class="muted center pad">내용이 없습니다. ＋ 행 추가를 누르거나 엑셀에서 붙여넣으세요.</td></tr>`}</tbody></table></div></div>`;
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
    const key = card.dataset.grid, def = listDef(p, key);
    const rows = listRows(p, key);
    const blank = () => {
      const r = { id: Store.uid() };
      def.cols.forEach((c) => (r[c.key] = ""));
      if (def.files) r.files = [];
      if (key === "changes" || key === "revisions") { r.date = today(); r.author = Store.state.settings.user; }
      if (key === "submissions") { r.status = "미제출"; r.to = p.overview.customer || ""; }
      return r;
    };
    const tbody = $("tbody", card);
    tbody.addEventListener("input", (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr || !e.target.dataset.f) return;
      const row = rows.find((r) => r.id === tr.dataset.id);
      row[e.target.dataset.f] = e.target.value;
      (def.computed || []).forEach((c, k) => { const td = $(`[data-comp="${k}"]`, tr); if (td) td.textContent = c.fn(row, def.unit); });
      Store.touch(p);
    });
    tbody.addEventListener("change", (e) => {
      if (!("moveunit" in e.target.dataset) || !e.target.value) return;
      const tr = e.target.closest("tr[data-id]"), to = def.units.find((u) => u.id === e.target.value);
      const i = rows.findIndex((r) => r.id === tr.dataset.id);
      const [row] = rows.splice(i, 1);
      to.bom.push(row);
      Store.touch(p);
      toast(`'${row.item || row.model || "행"}'을 ${to.name}(으)로 옮겼습니다.`);
      rerender();
    });
    // 행 선택 → 선택 삭제 / 전체 삭제
    const selBoxes = () => $$("[data-sel]", tbody);
    const syncSel = () => {
      const n = selBoxes().filter((c) => c.checked).length, btn = $("[data-delsel]", card), all = $("[data-selall]", card);
      if (btn) { btn.disabled = !n; btn.textContent = n ? `선택 삭제 (${n})` : "선택 삭제"; }
      if (all) { all.checked = n > 0 && n === selBoxes().length; all.indeterminate = n > 0 && n < selBoxes().length; }
      selBoxes().forEach((c) => c.closest("tr").classList.toggle("selected", c.checked));
    };
    const removeRows = async (ids, msg) => {
      if (!ids.length || !confirm(msg)) return;
      for (let i = rows.length - 1; i >= 0; i--) if (ids.includes(rows[i].id)) rows.splice(i, 1);
      Store.touch(p);
      await Store.gc();
      toast(`${ids.length}행을 삭제했습니다.`);
      rerender();
    };
    tbody.addEventListener("change", (e) => { if ("sel" in e.target.dataset) syncSel(); });
    const selAll = $("[data-selall]", card);
    if (selAll) selAll.onchange = () => { selBoxes().forEach((c) => (c.checked = selAll.checked)); syncSel(); };
    const delSel = $("[data-delsel]", card);
    if (delSel) delSel.onclick = () => {
      const ids = selBoxes().filter((c) => c.checked).map((c) => c.closest("tr").dataset.id);
      removeRows(ids, `선택한 ${ids.length}행을 삭제할까요?`);
    };
    const delAll = $("[data-delall]", card);
    if (delAll) delAll.onclick = () => removeRows(rows.map((r) => r.id), `${def.title}의 ${rows.length}행을 모두 삭제할까요?`);
    tbody.addEventListener("click", async (e) => {
      const tr = e.target.closest("tr[data-id]");
      if (!tr) return;
      const i = rows.findIndex((r) => r.id === tr.dataset.id);
      if (e.target.dataset.remove) {
        if (!confirm("이 첨부 파일을 삭제할까요?")) return;
        rows[i].files = rows[i].files.filter((x) => x !== e.target.dataset.remove);
        Store.touch(p);
        await Store.gc();
        rerender();
      } else if ("delrow" in e.target.dataset) {
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
          Store.touch(p);
          rerender();
        });
      }
    });
    $("[data-addrow]", card).onclick = () => {
      rows.push(blank());
      Store.touch(p);
      rerender();
      const last = $$("tbody tr", $(`[data-grid="${key}"]`)).pop();
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
    Store.touch(p);
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
    if (rec) linkRevisions(p);
    const oldTitle = rec?.title;
    Object.assign(d, { date: form.date.value, kind: form.kind.value, title: form.title.value.trim(), from: form.from.value.trim(),
      to: form.to.value.trim(), memo: form.memo.value });
    if (rec) Object.assign(rec, d);
    else p.records.push(d);
    const note = `자료 이력 · ${d.kind} (${fmtDot(d.date)})`;
    if (rec) Store.syncRevision(p, d.id, oldTitle, d.title, note);
    else Store.addRevision(p, d.title, note, d.id);
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
      <button class="btn full" id="importMeeting" title="회의록 엑셀 파일을 골라 등록합니다 (여러 개 가능, 끌어다 놓아도 됩니다)">📥 엑셀에서 가져오기</button>
      ${list.map((m) => `<button class="mitem ${m === cur ? "active" : ""}" data-m="${m.id}"><b>${esc(m.title || "(제목 없음)")}</b>
        <span class="muted small">${esc(fmtDot(m.date))}${m.actions.some((a) => !a.done && a.text) ? ` · <span class="warn">의제 ${m.actions.filter((a) => !a.done && a.text).length}</span>` : ""}</span></button>`).join("")
        || `<p class="muted small pad">회의록이 없습니다.</p>`}</div>
    <div class="card" id="mEditor">${cur ? meetingForm(cur) : `<p class="muted">왼쪽에서 회의록을 선택하거나 새로 작성하세요.</p>`}</div></div>`;
  $$("[data-m]", el).forEach((b) => (b.onclick = () => { route.meeting = b.dataset.m; tabMeetings(p, el); loadImages(el); }));
  $("#importMeeting").onclick = () => pickFiles(".xlsx", true, (files) => importMeetings(p, files));
  const ml = $(".mlist", el);
  ml.addEventListener("dragover", (e) => { e.preventDefault(); ml.classList.add("over"); });
  ml.addEventListener("dragleave", () => ml.classList.remove("over"));
  ml.addEventListener("drop", (e) => {
    e.preventDefault();
    ml.classList.remove("over");
    const files = Array.from(e.dataTransfer.files).filter((f) => /\.xlsx$/i.test(f.name));
    if (files.length) importMeetings(p, files); else toast("회의록은 엑셀(.xlsx) 파일만 가져올 수 있습니다.");
  });
  $("#addMeeting").onclick = () => {
    const m = { id: Store.uid(), title: "", dept: "", writer: Store.state.settings.user, date: today(), time: "", place: "", kind: "비정례",
      attendees: "", content: MEETING_TEMPLATE, actions: [{ id: Store.uid(), text: "", owner: "", due: "", done: false, note: "" }], notes: "", files: [] };
    p.meetings.push(m);
    route.meeting = m.id;
    Store.touch(p); // Revision 은 제목을 입력하면 기록
    tabMeetings(p, el);
    $("[data-mf=title]", el)?.focus();
  };
  if (!cur) return;
  const ed = $("#mEditor");
  let revTitle = cur.title.trim();
  ed.addEventListener("change", (e) => {
    const f = e.target.dataset.mf;
    if (!["title", "date"].includes(f) || !cur.title.trim()) return;
    const note = `회의록 · ${fmtDot(cur.date)}`;
    // 처음 제목을 넣으면 Revision 기록, 그 뒤 제목·날짜를 고치면 그 기록도 고침
    if (!cur.logged) { if (f === "title") { cur.logged = true; Store.addRevision(p, cur.title.trim(), note, cur.id); } }
    else Store.syncRevision(p, cur.id, revTitle, cur.title.trim(), note);
    revTitle = cur.title.trim();
  });
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
      Store.touch(p);
      await Store.gc();
    } else return;
    Store.touch(p);
    tabMeetings(p, el);
    loadImages(el);
  });
  attachDropzone($(".dropzone", ed), async (files) => {
    for (const f of files) cur.files.push(await Store.addFile(f, f.name));
    Store.touch(p);
    tabMeetings(p, el);
    loadImages(el);
  }, ed);
}
async function importMeetings(p, files) {
  await busy("회의록을 가져오는 중…", async (progress) => {
    let added = 0, dup = 0;
    const skipped = [];
    let lastId = null;
    for (const file of files) {
      progress(`읽는 중: ${file.name}`);
      const wb = await Xlsx.read(file);
      let sheets = wb.sheets.filter(isMeetingSheet);
      // 회의록 표시가 없어도 시트가 하나뿐이면 회의록으로 본다
      if (!sheets.length && wb.sheets.length === 1 && sheetLines(wb.sheets[0]).length) sheets = wb.sheets;
      if (!sheets.length) { skipped.push(file.name); continue; }
      const original = await Store.addFile(file, file.name);
      const baseName = file.name.replace(/\.xlsx$/i, "");
      for (const sheet of sheets) {
        const extra = [];
        for (const img of sheet.images) {
          if (img.type.startsWith("image/") && !/emf|wmf/.test(img.ext)) extra.push(await Store.addFile(new Blob([img.data], { type: img.type }), `${baseName}_${extra.length + 1}.${img.ext}`));
        }
        for (const em of sheet.embeds) extra.push(await Store.addFile(new Blob([em.data], { type: em.type }), `${baseName}_첨부.${em.ext}`));
        const m = parseMeeting(sheet, [original, ...extra]);
        // 시트 이름이 Sheet1 처럼 의미 없으면 파일 이름을 제목으로
        if (!m.title || /^(sheet|시트)\s*\d*$/i.test(m.title)) m.title = titleFromSheet(baseName);
        if (!m.date) m.date = dateFromText(file.name) || today();
        if (p.meetings.some((x) => norm(x.title) === norm(m.title) && x.date === m.date)) { dup++; continue; }
        m.logged = true;
        p.meetings.push(m);
        lastId = m.id;
        added++;
        Store.addRevision(p, m.title, `회의록 · ${fmtDot(m.date)} (엑셀 가져오기)`, m.id);
      }
    }
    await Store.gc();
    if (lastId) route.meeting = lastId;
    rerender();
    const msg = [`회의록 ${added}건을 등록했습니다.`, dup && `같은 제목·날짜 ${dup}건은 건너뜀`,
      skipped.length && `회의록을 찾지 못한 파일: ${skipped.join(", ")}`].filter(Boolean).join(" · ");
    toast(msg, 5000);
  });
}

function meetingForm(m) {
  const f = (k, label, attrs = "") => `<label>${label}<input data-mf="${k}" value="${esc(m[k])}" ${attrs}></label>`;
  return `<div class="between"><h3>회의록</h3><span class="row2"><button class="btn sm" data-print>🖨 인쇄 / PDF</button>
      <button class="btn danger sm" data-del-meeting>삭제</button></span></div>
    <div class="form">
      <label class="full">제목<input data-mf="title" value="${esc(m.title)}" placeholder="예: 고객사 Kick-off"></label>
      ${f("dept", "부서명")}${f("writer", "작성자")}${f("date", "회의일자", 'type="date"')}${f("time", "회의시간", 'placeholder="15:00 ~ 18:00"')}
      ${f("place", "회의장소")}<label>구분<select data-mf="kind">${opts(["", "정례", "비정례"], m.kind)}</select></label>
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

// ------------------------------------------------------------- 프로젝트 완료 보고서
function reportDialog(p) {
  const o = p.overview, r = p.report, sm = projectSummary(p);
  const lastDone = p.schedule.map((t) => t.doneDate).filter(isDate).sort().pop();
  const completed = r.completedDate || (o.status === "완료" ? lastDone || sm.end : "") || today();
  const warrantyDefault = o.warranty ? `하자보증기간: ${o.warranty}${o.receiveDate ? ` (입고일 ${fmtDot(o.receiveDate)} 기준)` : ""}` : "";
  const ci = closingInfo(p);
  // 모든 칸은 "이름 → 입력칸 → 안내 줄" 순서로 같은 높이를 쓴다 (줄 맞춤)
  const hint = (t) => `<span class="fhint">${t ? esc(t) : ""}</span>`;
  const money = (k, label, placeholder = "", note = "") => {
    const v = toAmount(k === "salesActual" ? r[k] : k === "orderAmount" ? o.orderAmount : o[k]);
    return `<label>${label}<input data-money name="${k}" inputmode="numeric" value="${v ? v.toLocaleString("ko-KR") : ""}" placeholder="${placeholder}">${hint(note)}</label>`;
  };
  openDialog(`<h3>📄 프로젝트 완료 보고서</h3>
    ${o.status !== "완료" ? `<div class="notice">이 프로젝트는 아직 <b>${esc(o.status)}</b> 상태입니다.
      <label class="row2" style="margin-top:6px"><input type="checkbox" name="markDone"> 보고서를 받으면서 프로젝트 상태를 '완료'로 바꾸기 <span class="muted small">(최종 완료일 때만 체크)</span></label></div>` : ""}
    <h4>마감 보고서 항목 <span class="muted small">비워 두면 프로그램에 있는 값으로 채웁니다 · 일자는 개요의 주요 일자와 같습니다</span></h4>
    <div class="form three aligned">
      <label>Kick off일자<input type="date" name="kickoffDate" value="${esc(o.kickoffDate || "")}">${hint(ci.auto.kickoffDate && `비우면 자동: ${fmtDot(ci.auto.kickoffDate)}`)}</label>
      <label>납품일자 (입고일자)<input type="date" name="deliveryDate" value="${esc(o.receiveDate || "")}">${hint(ci.auto.deliveryDate && !o.receiveDate && `비우면 자동: ${fmtDot(ci.auto.deliveryDate)}`)}</label>
      <label>SET UP 완료일<input type="date" name="setupDate" value="${esc(o.setupDate || "")}">${hint("Warranty 시작 기준")}</label>
      <label>Warranty 시작<input type="date" name="warrantyStart" value="${esc(o.warrantyStart || "")}">${hint("시작일부터 아래 기간(년)")}</label>
      <label>보증기간 (년)<input name="warrantyYears" inputmode="decimal" value="${esc(o.warrantyYears || ci.auto.warrantyYears || "")}" placeholder="예: 2">${hint("")}</label>
      <label>입금완료일<input type="date" name="paidDate" value="${esc(o.paidDate || "")}" ${o.paidDateAuto ? "readonly class=\"auto-field\"" : ""}>${hint(o.paidDateAuto && o.paidDate ? "마지막 정산일 (정산일을 고치면 바뀜)" : "정산이 모두 끝나면 자동")}</label>
      ${money("orderAmount", "발주가", "", "개요의 발주금액과 같은 값")}
      ${money("estimateCost", "실행 예가")}
      ${money("targetCost", "실행목표가")}
      ${money("actualCost", "실행가", "실제 투입 금액", "이익 계산 기준")}
      ${money("salesActual", "실적가", "", "종합 시트용 (선택)")}
      <label>지급조건<span class="row2" style="flex-wrap:nowrap"><input value="${esc(ci.payTerms || "정산 비율 미입력")}" disabled style="flex:1">
        <button type="button" class="btn sm" data-paydlg-report>⚙ 설정</button></span>${hint("")}</label>
      <div class="full rd-sub"><h4>실행가 구성 <span class="muted small">인건비(M/D × 단가) · 재경비 · 워런티비 → 실행가 합계</span></h4>
        <div class="form md-grid aligned">
          ${MD_FIELDS.map(([k, l]) => `<label>${l} (M/D)<input name="md_${k}" data-rcalc inputmode="decimal" value="${esc((o.md || {})[k] ?? "")}" placeholder="0">${hint("")}</label>`).join("")}
          <label>M/D 단가 (원)<input name="mdRate" data-money data-rcalc inputmode="numeric" value="${contractInfo(p).mdRate ? contractInfo(p).mdRate.toLocaleString("ko-KR") : ""}" placeholder="예: 500,000">${hint("")}</label>
          <label>인건비 (원)<input name="laborCost" data-money data-rcalc data-manual="${contractInfo(p).laborManual ? 1 : ""}" inputmode="numeric" class="labor-input" value="${contractInfo(p).labor ? contractInfo(p).labor.toLocaleString("ko-KR") : ""}" placeholder="M/D × 단가"><span class="fhint" id="rLaborHint"></span></label>
          <label>재경비 비율 (%)<input name="overheadRate" data-rcalc inputmode="decimal" value="${esc(o.overheadRate || "")}" placeholder="예: 5"><span class="fhint" id="rOverheadHint"></span></label>
          <label>워런티비 비율 (%)<input name="warrantyRate" data-rcalc inputmode="decimal" value="${esc(o.warrantyRate || "")}" placeholder="예: 2"><span class="fhint" id="rWarrantyHint"></span></label>
        </div>
        <div class="total-cost wide" id="rTotal"></div></div>
      <label class="full">이슈(특이)사항 · 문제점 및 개선사항<textarea name="issues" rows="2" placeholder="예: 추가 개선사항 유상건 / 없음">${esc(r.issues)}</textarea></label>
      <label class="full">미완료 내용<input name="unfinished" value="${esc(r.unfinished || "")}" placeholder="비우면 자동으로 채웁니다">${hint(`비우면 자동: ${closingInfo({ ...p, report: { ...r, unfinished: "" } }).unfinished}`)}</label>
    </div>
    <div class="between profit-line"><span>이익</span><b id="profitView"></b></div>
    <h4>PDF 보고서 추가 내용</h4>
    <div class="form">
      <label>완료일<input type="date" name="completedDate" value="${esc(completed)}"></label>
      <label>작성자<input name="writer" value="${esc(Store.state.settings.user || o.manager)}"></label>
      <label class="full">성과 요약<textarea name="summary" rows="2" placeholder="예: Conveyor AMR 2대 납품 및 고객사 검수 완료.">${esc(r.summary)}</textarea></label>
      <label class="full">하자보증 · 후속 조치<textarea name="warrantyNote" rows="2">${esc(r.warrantyNote || warrantyDefault)}</textarea></label>
    </div>
    ${window.showDirectoryPicker ? `<div class="small muted report-dir">📁 엑셀 보고서 저장 폴더: <b id="rdDirName">${esc(Store.state.settings.reportDirName || "미지정 (다운로드 시 고름)")}</b>
      <a href="#" id="rdDir">${Store.state.settings.reportDirName ? "변경" : "지정"}</a> · 파일 이름: <b>${esc(fileSafe(o.name))}_완료보고서_${today()}.xlsx</b></div>` : ""}
    <div class="opts row-opts">
      <label><input type="checkbox" name="incMeetings" checked> 회의 (${p.meetings.length})</label>
      <label><input type="checkbox" name="incChanges" checked> 변경사항 (${p.lists.changes.length})</label>
      <label><input type="checkbox" name="incRecords" checked> 자료 이력 (${p.records.length})</label>
      <label><input type="checkbox" name="incBom" ${bomItemCount(p) ? "" : "disabled"}> BOM (${bomItemCount(p)})</label>
    </div>`,
  async (form) => {
    save(form);
    await saveReport(() => buildClosingWorkbook([p]), `${fileSafe(o.name)}_완료보고서_${today()}.xlsx`);
    Store.touch(p);
    rerender();
  }, { wide: true, okLabel: "📊 엑셀 보고서 다운로드", onOpen: (dlg, form) => {
    const pdf = document.createElement("button");
    pdf.type = "button";
    pdf.className = "btn";
    pdf.textContent = "🖨 인쇄 / PDF";
    $(".actions", dlg).insertBefore(pdf, $(".actions .primary", dlg));
    pdf.onclick = () => {
      save(form);
      Store.touch(p);
      $("#print").innerHTML = reportHtml(p, { writer: form.writer.value.trim(), meetings: form.incMeetings.checked,
        changes: form.incChanges.checked, records: form.incRecords.checked, bom: form.incBom.checked });
      dlg.close();
      rerender();
      // PDF 로 저장할 때 기본 파일 이름이 프로젝트 이름이 되도록
      const title = document.title;
      document.title = `${fileSafe(o.name)}_완료보고서_${today()}`;
      window.addEventListener("afterprint", () => (document.title = title), { once: true });
      setTimeout(() => window.print(), 50);
    };
    $("[data-paydlg-report]", dlg).onclick = () => { dlg.close(); payDialog(p); };
    $("#rdDir", dlg)?.addEventListener("click", async (e) => {
      e.preventDefault();
      const dir = await reportDir(true);
      if (dir) { $("#rdDirName", dlg).textContent = dir.name; e.target.textContent = "변경"; }
    });
    // 금액 칸: 쉼표 표시, 실행가 구성·이익 미리 계산
    const showProfit = () => {
      const c = contractInfo({ ...p, overview: draftOverview(form) });
      const lab = form.laborCost;
      if (!lab.dataset.manual && document.activeElement !== lab) lab.value = c.laborAuto ? c.laborAuto.toLocaleString("ko-KR") : "";
      $("#rLaborHint", dlg).textContent = lab.dataset.manual ? "직접 입력 · 지우면 자동" : c.mdTotal ? `자동: ${c.mdTotal} M/D × 단가` : "M/D × 단가 자동";
      $("#rOverheadHint", dlg).textContent = c.overhead ? `= ${fmtWon(c.overhead)}` : "실행가 × 비율";
      $("#rWarrantyHint", dlg).textContent = c.warrantyCost ? `= ${fmtWon(c.warrantyCost)}` : "실행가 × 비율";
      $("#rTotal", dlg).innerHTML = totalViewHtml(c);
      const amt = c.amount, cost = c.actualCost;
      const line = (label, x) => `${label} ${fmtWon(amt - x)} <span class="muted small">(${(((amt - x) / amt) * 100).toFixed(1)}%)</span>`;
      $("#profitView", dlg).innerHTML = amt && cost
        ? [line("실제", cost), c.totalCost !== cost && line("합계 기준", c.totalCost), c.estimateCost && `<span class="muted">${line("예상", c.estimateCost)}</span>`,
            c.targetCost && `<span class="muted">${line("목표", c.targetCost)}</span>`].filter(Boolean).join(" &nbsp;·&nbsp; ")
        : `<span class="muted small">발주가와 실행가를 넣으면 계산됩니다</span>`;
    };
    $$("[data-money]", dlg).forEach((inp) => inp.addEventListener("input", () => {
      const n = toAmount(inp.value);
      inp.value = n ? n.toLocaleString("ko-KR") : "";
      // 인건비 칸: 자동 값과 다르게 고치면 직접 입력, 지우면 다시 자동
      if (inp === form.laborCost) inp.dataset.manual = n && n !== contractInfo({ ...p, overview: { ...draftOverview(form), laborCost: "" } }).laborAuto ? "1" : "";
      showProfit();
    }));
    $$("[data-rcalc]:not([data-money])", dlg).forEach((inp) => inp.addEventListener("input", showProfit));
    form.laborCost.addEventListener("change", showProfit);
    showProfit();
  } });

  // 보고서 창에 입력 중인 값으로 만든 개요 (미리 계산용)
  function draftOverview(form) {
    const f = (k) => form.elements[k].value.trim();
    return { ...o, orderAmount: String(toAmount(f("orderAmount")) || ""), estimateCost: String(toAmount(f("estimateCost")) || ""),
      targetCost: String(toAmount(f("targetCost")) || ""), actualCost: String(toAmount(f("actualCost")) || ""),
      md: Object.fromEntries(MD_FIELDS.map(([k]) => [k, f(`md_${k}`).replace(/[^\d.]/g, "")])),
      mdRate: String(toAmount(f("mdRate")) || ""), laborCost: form.laborCost.dataset.manual ? String(toAmount(f("laborCost")) || "") : "",
      overheadRate: f("overheadRate").replace(/[^\d.]/g, ""), warrantyRate: f("warrantyRate").replace(/[^\d.]/g, "") };
  }
  function save(form) {
    const f = (k) => form.elements[k].value.trim();
    const d = draftOverview(form);
    Object.assign(o, { md: d.md, mdRate: d.mdRate, laborCost: d.laborCost, overheadRate: d.overheadRate, warrantyRate: d.warrantyRate });
    // 주요 일자는 개요에 저장 (개요와 보고서가 같은 값을 씀). 입금완료일을 직접 고치면 자동 값이 아님
    if (f("paidDate") !== (o.paidDate || "")) o.paidDateAuto = false;
    Object.assign(o, { kickoffDate: f("kickoffDate"), receiveDate: f("deliveryDate"), setupDate: f("setupDate"), warrantyStart: f("warrantyStart"),
      warrantyYears: f("warrantyYears"), paidDate: f("paidDate") });
    o.orderAmount = String(toAmount(f("orderAmount")) || "");
    o.estimateCost = String(toAmount(f("estimateCost")) || "");
    o.targetCost = String(toAmount(f("targetCost")) || "");
    o.actualCost = String(toAmount(f("actualCost")) || "");
    Object.assign(r, { salesActual: String(toAmount(f("salesActual")) || ""),
      issues: form.elements.issues.value, unfinished: f("unfinished"), completedDate: f("completedDate"),
      summary: form.elements.summary.value, warrantyNote: form.elements.warrantyNote.value });
    if (form.elements.markDone?.checked) o.status = "완료";
  }
}

function reportHtml(p, inc) {
  const o = p.overview, r = p.report, base = r.completedDate || today();
  const sm = projectSummary(p, base), c = contractInfo(p), kd = keyDates(p);
  const v = (x) => (x ? esc(x) : `<span class="rp-dash">-</span>`);
  const d = (x) => (isDate(x) ? esc(fmtDot(x)) : v(x));
  const won = (n) => (n ? `${Math.round(n).toLocaleString("ko-KR")}<small>원</small>` : `<span class="rp-dash">-</span>`);
  const pct = (x) => (x == null ? "-" : `${(x * 100).toFixed(1)}%`);
  let n = 0;
  const sec = (title, sub = "") => `<h2><span class="rp-no">${String(++n).padStart(2, "0")}</span>${title}${sub ? `<small>${sub}</small>` : ""}</h2>`;
  // 모든 표는 칸 너비를 고정해 위아래 줄이 맞도록 한다
  const table = (cols, heads, rows, empty = "해당 없음") => rows.length
    ? `<table class="rp-t"><colgroup>${cols.map((w) => `<col style="width:${w}%">`).join("")}</colgroup>
        <thead><tr>${heads.map((h) => `<th class="${h.c || ""}">${h.t ?? h}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr class="${row.cls || ""}">${row.span ? `<td colspan="${heads.length}">${row[0]}</td>`
          : row.map((x, i) => `<td class="${heads[i].c || ""}">${x}</td>`).join("")}</tr>`).join("")}</tbody></table>`
    : `<p class="rp-none">${empty}</p>`;
  // 개요형 표: 항목 | 값 | 항목 | 값 (18 / 32 / 18 / 32)
  const kv = (rows) => `<table class="rp-kv"><colgroup><col style="width:17%"><col style="width:33%"><col style="width:17%"><col style="width:33%"></colgroup><tbody>${rows.map((row) =>
    row.length === 2 ? `<tr><th>${row[0]}</th><td colspan="3">${row[1]}</td></tr>` : `<tr><th>${row[0]}</th><td>${row[1]}</td><th>${row[2]}</th><td>${row[3]}</td></tr>`).join("")}</tbody></table>`;

  // 일정 실적: 단계별 계획 대비 완료 (일정 탭과 같은 완료 기준)
  const suspect = suspectTasks(p.schedule);
  const sd = scheduleDone(p);
  const groups = [];
  for (const t of p.schedule) {
    const g = groups.find((x) => x.phase === (t.phase || "기타"));
    if (g) g.items.push(t); else groups.push({ phase: t.phase || "기타", items: [t] });
  }
  const phaseRows = groups.map((g) => {
    const dated = g.items.filter((t) => isDate(t.start) && !suspect.has(t.id));
    const done = g.items.filter(sd.isDone).length, ratio = done / g.items.length;
    const actual = g.items.map(sd.doneDate).filter(isDate).sort().pop();
    return [`<b>${esc(g.phase)}</b>`, d(dated.map((t) => t.start).sort()[0]), d(dated.map((t) => t.end).filter(isDate).sort().pop()), d(actual),
      `<span class="rp-bar"><span style="width:${ratio * 100}%" class="${ratio === 1 ? "ok" : ""}"></span></span><span class="rp-frac">${done}/${g.items.length}</span>`,
      ratio === 1 ? `<span class="rp-pill ok">완료</span>` : `<span class="rp-pill bad">미완료</span>`];
  });
  const planDays = sm.start && sm.end ? dayNo(sm.end) - dayNo(sm.start) + 1 : 0;
  const diff = sm.end && isDate(r.completedDate) ? dayNo(r.completedDate) - dayNo(sm.end) : null;
  const doneCount = p.schedule.filter(sd.isDone).length;
  const diffText = diff === null ? "-" : diff === 0 ? "계획대로" : diff < 0 ? `${-diff}일 단축` : `${diff}일 지연`;

  // 미결 사항
  const unpaid = c.payments.filter((x) => x.status !== "수금완료");
  const pending = [
    ...groups.map((g) => [g.phase, g.items.filter((t) => !sd.isDone(t))]).filter(([, l]) => l.length)
      .map(([ph, l]) => `<b>일정 · ${esc(ph)}</b> ${l.length}건 — ${l.map((t) => esc(t.name.replace(/^[-\s└┗]+/, ""))).join(", ")}`),
    ...sm.openActions.map((a) => `<b>실천 의제</b> ${esc(a.text)} (${v(a.owner)}${isDate(a.due) ? `, ${d(a.due)}` : ""})`),
    ...sm.pendingSubmissions.map((x) => `<b>미제출 자료</b> ${esc(x.item)}${x.to ? ` → ${esc(x.to)}` : ""}`),
    ...unpaid.map((x) => `<b>미수금</b> ${esc(x.name)} ${esc(x.ratio)}% · ${fmtWon(x.amount)} (${esc(x.status)})`),
  ];
  const para = (t) => (t ? `<div class="rp-para">${nl2br(t)}</div>` : `<div class="rp-para rp-empty">-</div>`);

  // 핵심 숫자
  const kpi = (label, value, sub = "", cls = "") => `<div class="rp-kpi ${cls}"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
  const kpis = [
    kpi("발주금액", won(c.amount), c.amount ? `부가세 ${esc(o.vat || "별도")}` : ""),
    kpi("실행가 합계", won(c.totalCost), c.totalCost ? "실행가+인건비+재경비+워런티비" : "실행가 미입력", "accent"),
    kpi("이익", c.profit != null ? won(c.profit) : c.estProfit != null ? won(c.estProfit) : "-",
      c.profit != null ? `이익률 ${pct(c.profitRate)}${c.totalProfit != null && c.totalCost !== c.actualCost ? ` · 합계 기준 ${pct(c.totalRate)}` : ""}` : c.estRate != null ? `예상 이익률 ${pct(c.estRate)}` : "",
      c.profit < 0 ? "bad" : "ok"),
    kpi("정산", c.payments.length ? `${c.paidRatio}<small>%</small>` : "-", c.payments.length ? `수금 ${fmtWon(c.paidAmount)}` : "정산 비율 미입력", c.paidRatio === 100 ? "ok" : ""),
    kpi("프로젝트 기간", planDays ? `${planDays}<small>일</small>` : "-", sm.start ? `${fmtDot(sm.start)} ~ ${fmtDot(sm.end)}` : ""),
    kpi("계획 대비", diffText, isDate(r.completedDate) ? `완료 ${fmtDot(r.completedDate)}` : "", diff > 0 ? "bad" : diff !== null ? "ok" : ""),
    kpi("일정 완료", p.schedule.length ? `${Math.round((doneCount / p.schedule.length) * 100)}<small>%</small>` : "-", `${doneCount} / ${p.schedule.length}건`, doneCount === p.schedule.length && doneCount ? "ok" : ""),
    kpi("Warranty", kd.warranty.years ? `${kd.warranty.years}<small>년</small>` : "-", kd.warranty.end ? `~ ${fmtDot(kd.warranty.end)}` : kd.warranty.started ? "" : isDate(kd.warranty.start) ? `${fmtDot(kd.warranty.start)} 시작` : "시작일 미입력"),
  ].join("");

  // 주요 일자 흐름
  const steps = [["발주", o.orderDate], ["Kick Off", kd.kickoffDate.value], ["납품", kd.receiveDate.value], ["Setup 완료", kd.setupDate.value],
    ["지급 완료", kd.paidDate.value], ["Warranty 종료", kd.warranty.end]];
  const flow = `<div class="rp-flow">${steps.map(([label, dt]) => `<div class="rp-step ${isDate(dt) ? (dt <= base ? "done" : "plan") : "none"}">
      <i></i><span>${label}</span><b>${isDate(dt) ? esc(fmtDot(dt)) : "미정"}</b></div>`).join("")}</div>`;

  // 원가 구성: 실행가 + 인건비 + 재경비 + 워런티비 = 실행가 합계, 발주금액 대비 막대
  const costRows = [["실행가", c.actualCost, "자재 · 외주 등 실제 투입", "c1"],
    ["인건비", c.labor, c.mdTotal ? `${esc(c.mdText)} = ${c.mdTotal} M/D${c.mdRate ? ` × ${fmtWon(c.mdRate)}` : ""}${c.laborManual ? " (직접 입력)" : ""}` : c.labor ? "직접 입력" : "", "c2"],
    ["재경비", c.overhead, c.overheadRate ? `실행가 × ${c.overheadRate}%` : "", "c3"],
    ["워런티비", c.warrantyCost, c.warrantyRate ? `실행가 × ${c.warrantyRate}%` : "", "c4"]];
  const share = (x) => (c.totalCost ? (x / c.totalCost) * 100 : 0);
  // 이익 분석: 실행 예가(예상) · 실행목표가(목표) · 실행가(실제) · 실행가 합계 기준
  const profitRows = [["예상", "실행 예가", c.estimateCost, c.estProfit, c.estRate], ["목표", "실행목표가", c.targetCost, c.targetProfit, c.targetRate],
    ["실제", "실행가", c.actualCost, c.profit, c.profitRate], ["합계 기준", "실행가 합계", c.totalCost !== c.actualCost ? c.totalCost : 0, c.totalProfit, c.totalRate]]
    .filter(([, , cost]) => cost);
  const profitTable = c.amount && profitRows.length ? `<h3 class="rp-h3">이익 분석 <small>발주금액 ${fmtWon(c.amount)} 기준</small></h3>
    ${table([16, 22, 22, 22, 18], ["구분", "원가 기준", { t: "원가", c: "r" }, { t: "이익", c: "r" }, { t: "이익률", c: "r" }],
      profitRows.map(([l, base, cost, prof, rate]) => Object.assign([`<b>${l}</b>`, base, fmtWon(cost), `<b class="${prof < 0 ? "bad" : ""}">${fmtWon(prof)}</b>`,
        `<span class="rp-rate ${prof < 0 ? "bad" : ""}">${pct(rate)}</span>`], { cls: l === "실제" ? "rp-total" : "" })))}` : "";
  const costBlock = c.totalCost ? `<div class="rp-costblock"><h3 class="rp-h3">원가 구성</h3>
    ${table([18, 40, 20, 22], ["항목", "산출 근거", { t: "금액", c: "r" }, "비중"],
      [...costRows.map(([l, x, why, cls]) => [`<span class="rp-dot ${cls}"></span>${l}`, why ? `<span class="rp-sub">${why}</span>` : v(""), x ? fmtWon(x) : v(""),
        `<span class="rp-bar"><span class="${cls}" style="width:${share(x)}%"></span></span><span class="rp-frac">${Math.round(share(x))}%</span>`]),
       Object.assign([`<b>실행가 합계</b>`, `<span class="rp-sub">실행가 + 인건비 + 재경비 + 워런티비</span>`, `<b>${fmtWon(c.totalCost)}</b>`, ""], { cls: "rp-total" })])}
    ${c.amount ? `<div class="rp-costbar">${costRows.filter(([, x]) => x).map(([l, x, , cls]) => `<span class="${cls}" style="flex:${x}">${(x / c.amount) * 100 >= 12 ? `${l} ${Math.round((x / c.amount) * 100)}%` : ""}</span>`).join("")}
      ${c.totalProfit > 0 ? `<span class="margin" style="flex:${c.totalProfit}">${c.totalRate >= 0.12 ? `이익 ${pct(c.totalRate)}` : ""}</span>` : ""}</div>
      <div class="rp-costcap"><span>${costRows.filter(([, x]) => x).map(([l, x, , cls]) => `<i class="${cls}"></i>${l} ${fmtWon(x)}`).join(" &nbsp; ")}</span>
        <span>${c.totalProfit >= 0 ? `<i class="margin"></i>합계 기준 이익 <b class="ok">${fmtWon(c.totalProfit)} (${pct(c.totalRate)})</b>` : `<b class="bad">합계가 발주금액보다 ${fmtWon(-c.totalProfit)} 많음</b>`} · 발주금액 ${fmtWon(c.amount)}</span></div>` : ""}</div>` : "";

  const payBar = c.payments.length ? `<h3 class="rp-h3">정산</h3><div class="rp-paybar">${c.payments.map((x) => `<span class="${x.status === "수금완료" ? "ok" : x.status === "청구" ? "billed" : ""}" style="flex:${Number(x.ratio) || 0}">
      ${esc(x.name)} ${esc(x.ratio)}%</span>`).join("")}</div>` : "";

  return `<div class="rp">
    <header class="rp-head">
      <div class="rp-title">
        <div class="rp-kicker">PROJECT COMPLETION REPORT</div>
        <h1>프로젝트 완료 보고서</h1>
        <div class="rp-pname">${v(o.project || o.name)}</div>
      </div>
      <table class="rp-sign"><tr><th rowspan="2">결<br>재</th><th>작성</th><th>검토</th><th>승인</th></tr><tr><td></td><td></td><td></td></tr></table>
    </header>
    <div class="rp-meta">
      <div><span>고객사</span><b>${v(o.customer)}</b></div><div><span>설비/품목명</span><b>${v(o.name)}</b></div>
      <div><span>Project No</span><b>${v(o.projectNo)}</b></div><div><span>보고일 · 작성자</span><b>${d(today())} · ${v(inc.writer)}</b></div>
    </div>

    <div class="rp-kpis">${kpis}</div>
    ${flow}

    ${sec("프로젝트 개요")}
    ${kv([["Project", v(o.project)], ["Part No", v(o.partNo), "담당자", v(o.manager)],
      ["입고일자 (납품)", d(kd.receiveDate.value), "입고 장소", v(o.receivePlace)],
      ["Setup 완료일", d(kd.setupDate.value), "Warranty", kd.warranty.end ? `${d(kd.warranty.start)} ~ ${d(kd.warranty.end)}` : v(kd.warranty.text)],
      ["사업 범위", o.scope ? nl2br(o.scope) : v("")],
      ...(o.note ? [["비고", nl2br(o.note)]] : []),
      ...o.extra.filter((x) => x.label).map((x) => [esc(x.label), v(x.value)])])}

    ${sec("계약 및 정산")}
    ${kv([["발주일", d(o.orderDate), "부가세", v(o.vat)],
      ["발주금액", c.amount ? `<b>${fmtWon(c.amount)}</b> <span class="rp-sub">금 ${koreanAmount(c.amount)}원정</span>` : v("")],
      ["실행 예가", c.estimateCost ? fmtWon(c.estimateCost) : v(""), "실행목표가", c.targetCost ? `${fmtWon(c.targetCost)}${c.actualCost && c.overBudget ? ` <span class="rp-sub ${c.overBudget > 0 ? "bad" : "ok"}">실행가 ${c.overBudget > 0 ? "초과" : "절감"} ${fmtWon(Math.abs(c.overBudget))}</span>` : ""}` : v("")],
      ["정산 현황", c.payments.length ? `${c.paidRatio}% 정산 완료 · 수금 ${fmtWon(c.paidAmount)} / 미수금 ${fmtWon(c.amount - c.paidAmount)}` : v("")]])}
    ${costBlock}
    ${profitTable ? `<div class="rp-costblock">${profitTable}</div>` : ""}
    ${payBar}
    ${c.payments.length ? table([15, 10, 21, 26, 15, 13], ["구분", { t: "비율", c: "r" }, { t: "금액", c: "r" }, "지급 조건", { t: "정산일", c: "c" }, { t: "상태", c: "c" }],
      c.payments.map((x) => [esc(x.name), `${esc(x.ratio)}%`, fmtWon(x.amount), v(x.cond), d(x.paidDate),
        `<span class="rp-pill ${x.status === "수금완료" ? "ok" : x.status === "청구" ? "info" : ""}">${esc(x.status)}</span>`])) : ""}

    ${sec("일정 실적", `${sm.start ? `${fmtDot(sm.start)} ~ ${fmtDot(sm.end)} · ${planDays}일 · ` : ""}완료 ${doneCount}/${p.schedule.length}건 · ${diffText}`)}
    ${table([16, 14, 14, 14, 28, 14], ["단계", { t: "계획 시작", c: "c" }, { t: "계획 종료", c: "c" }, { t: "실제 완료", c: "c" }, "진행", { t: "상태", c: "c" }], phaseRows)}

    ${inc.meetings ? `${sec("회의 및 의사결정", `${p.meetings.length}건`)}${table([14, 30, 56], [{ t: "일자", c: "c" }, "회의", "실천 의제"],
      [...p.meetings].sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((m) => [d(m.date), `<b>${esc(m.title)}</b>`,
        m.actions.filter((a) => a.text).map((a) => `<span class="rp-check ${a.done ? "on" : ""}"></span>${esc(a.text)}${a.owner ? ` <span class="rp-sub">${esc(a.owner)}</span>` : ""}`).join("<br>") || v("")]))}` : ""}
    ${inc.changes ? `${sec("변경 사항", `${p.lists.changes.length}건`)}${table([14, 14, 52, 20], [{ t: "일자", c: "c" }, "요청자", "변경 내용", "비고"],
      p.lists.changes.map((x) => [d(x.date), v(x.requester), nl2br(x.content), v(x.note)]))}` : ""}
    ${inc.records ? `${sec("자료 이력", `${p.records.length}건`)}${table([14, 12, 62, 12], [{ t: "일자", c: "c" }, { t: "구분", c: "c" }, "제목", { t: "첨부", c: "c" }],
      [...p.records].sort((a, b) => a.date.localeCompare(b.date)).map((x) => [d(x.date), `<span class="rp-pill">${esc(x.kind)}</span>`, esc(x.title), `${x.images.length + x.files.length}건`]))}` : ""}

    <div class="rp-keep">${sec("자재")}
    <div class="rp-mini"><div><span>BOM (설비 ${ensureUnits(p).length}종)</span><b>${bomItemCount(p)}<small>품목</small></b></div>
      ${[["소모품", p.lists.consumables], ["지정품/지급품", p.lists.supplied]].map(([l, arr]) =>
      `<div><span>${l}</span><b>${arr.filter((x) => !/^■/.test(x.item || "")).length}<small>품목</small></b></div>`).join("")}
      <div><span>제출 자료</span><b>${p.lists.submissions.length}<small>건</small></b>${sm.pendingSubmissions.length ? `<small class="bad">미제출 ${sm.pendingSubmissions.length}</small>` : ""}</div></div></div>
    ${inc.bom ? table([12, 18, 20, 14, 8, 8, 20], ["구분", "품목", "모델명", "업체명", { t: "1대당", c: "r" }, { t: "총 수량", c: "r" }, "비고"],
      ensureUnits(p).flatMap((u) => [Object.assign([`<b>${esc(u.name)}</b> · ${u.qty}대 · ${u.bom.filter(isItemRow).length}품목`], { cls: "rp-secrow", span: true }),
        ...u.bom.map((x) => (/^■/.test(x.item || "") ? Object.assign([`<b>${esc(x.item.replace(/^■\s*/, ""))}</b>`], { cls: "rp-subrow", span: true })
          : [v(x.kind), v(x.item), v(x.model), v(x.maker), v(x.qty), v(String(unitTotalQty(x, u))), v(x.note)]))])) : ""}

    ${sec("미결 사항")}
    ${pending.length ? `<div class="rp-callout warn"><b>남은 항목 ${pending.length}건</b><ul>${pending.map((x) => `<li>${x}</li>`).join("")}</ul></div>`
      : `<div class="rp-callout ok"><b>✔ 미결 사항 없음</b> 남은 일정·의제·미제출 자료·미수금이 없습니다.</div>`}

    ${sec("종합 의견")}
    <div class="rp-opinion"><div><h3>성과 요약</h3>${para(r.summary)}</div><div><h3>문제점 및 개선사항</h3>${para(r.issues)}</div></div>
    <h3>하자보증 · 후속 조치</h3>${para(r.warrantyNote)}
    <footer class="rp-foot"><span>${esc(o.name)} · 프로젝트 완료 보고서</span><span>${d(today())}</span></footer>
  </div>`;
}

// ------------------------------------------------------------- 사양, 자재
// 사양: 구분(SW 사양, HW 주요 Spec, 기구 사양 …)을 자유롭게 추가하고 구분마다 표·첨부·메모
function tabSpec(p, el) {
  const specs = ensureSpecs(p);
  if (!specs.some((x) => x.id === route.spec)) route.spec = specs[0].id;
  const sp = specs.find((x) => x.id === route.spec), key = `spec:${sp.id}`;
  // 첨부를 잘못 넣었을 때 다른 사양으로 옮기거나 복사
  const others = specs.filter((x) => x !== sp);
  const xfer = (id) => others.length ? `<select class="move-unit xfer" data-xfer="${id}" title="다른 사양으로 이동 / 복사"><option value="">⇄</option>
    <optgroup label="이동">${others.map((x) => `<option value="move:${x.id}">→ ${esc(x.name)}</option>`).join("")}</optgroup>
    <optgroup label="복사">${others.map((x) => `<option value="copy:${x.id}">⧉ ${esc(x.name)}</option>`).join("")}</optgroup></select>` : "";
  el.innerHTML = `<div class="unit-bar">
      ${specs.map((x) => `<button class="unit-chip ${x === sp ? "active" : ""}" data-spec="${x.id}"><b>${esc(x.name)}</b><small>${x.rows.length}항목${x.files.length ? ` · 첨부 ${x.files.length}` : ""}</small></button>`).join("")}
      <span class="unit-actions"><button class="btn primary sm" id="addSpec">＋ 사양 추가</button></span>
    </div>
    <div class="card parts-tools"><div class="unit-edit">
      <label>사양 이름<input id="specName" value="${esc(sp.name)}"></label>
      <span class="muted small">항목은 표에서 바로 고치고, 엑셀에서 여러 행을 복사해 붙여넣을 수 있습니다.</span>
      <button class="btn sm" id="specImport">📥 엑셀에서 가져오기</button>
      <button class="btn danger sm" id="delSpec" ${specs.length > 1 ? "" : "disabled"}>사양 삭제</button></div></div>
    ${gridCard(p, key, " ")}
    <div class="card spec-files"><h3>${esc(sp.name)} 자료 <span class="muted small">도면·캡처·사양서</span></h3>
      ${DROPZONE()}<div class="thumbs">${thumbs(sp.files, { removable: true, extra: xfer })}</div>
      <div class="chips">${fileChips(sp.files.filter((id) => !Store.fileMeta(id)?.type.startsWith("image/")), { removable: true, extra: xfer })}</div>
      <label class="form-1">메모<textarea id="specNote" rows="3">${esc(sp.note)}</textarea></label></div>`;
  $$("[data-spec]", el).forEach((b) => (b.onclick = () => { route.spec = b.dataset.spec; rerender(); }));
  $("#addSpec").onclick = () => addSpecDialog(p);
  $("#specName").onchange = (e) => {
    const old = sp.name;
    sp.name = e.target.value.trim() || sp.name;
    linkRevisions(p);
    Store.syncRevision(p, sp.id, old, sp.name);
    rerender();
  };
  $("#delSpec").onclick = async () => {
    if (!confirm(`'${sp.name}' 사양을 삭제할까요?${sp.rows.length || sp.files.length ? `\n항목 ${sp.rows.length}개와 첨부 ${sp.files.length}개도 함께 삭제됩니다.` : ""}`)) return;
    p.specs = specs.filter((x) => x !== sp);
    route.spec = p.specs[0].id;
    Store.touch(p);
    await Store.gc();
    rerender();
  };
  $("#specImport").onclick = () => pickFiles(".xlsx", false, (f) => specImportDialog(p, sp, f[0]));
  const card = $(".spec-files", el);
  attachDropzone($(".dropzone", card), async (files) => {
    for (const f of files) sp.files.push(await Store.addFile(f, f.name));
    Store.touch(p);
    rerender();
  }, card);
  card.addEventListener("change", (e) => {
    const id = e.target.dataset.xfer;
    if (!id || !e.target.value) return;
    const [mode, to] = e.target.value.split(":"), target = specs.find((x) => x.id === to);
    if (!target.files.includes(id)) target.files.push(id);
    if (mode === "move") sp.files = sp.files.filter((x) => x !== id);
    Store.touch(p);
    toast(`'${Store.fileMeta(id)?.name}'을 ${target.name}(으)로 ${mode === "move" ? "옮겼" : "복사했"}습니다.`);
    rerender();
  });
  card.addEventListener("click", async (e) => {
    if (!e.target.dataset.remove) return;
    e.stopPropagation();
    if (!confirm("이 파일을 삭제할까요?")) return;
    sp.files = sp.files.filter((x) => x !== e.target.dataset.remove);
    Store.touch(p);
    await Store.gc();
    rerender();
  });
  $("#specNote").oninput = (e) => { sp.note = e.target.value; Store.touch(p); };
}

function addSpecDialog(p) {
  const specs = ensureSpecs(p);
  openDialog(`<h3>＋ 사양 추가</h3>
    <div class="form"><label class="full">사양 이름<input name="name" required placeholder="예: 기구 사양"></label></div>
    <div class="pay-presets"><span class="muted small">예시</span>${SPEC_TEMPLATES.map(([n], i) =>
      `<span class="preset-chip"><button type="button" data-tpl="${i}">${esc(n)}</button></span>`).join("")}</div>
    <label class="row2" style="margin-top:10px"><input type="checkbox" name="fill" checked> 예시를 고르면 기본 항목도 채우기 <span class="muted small" id="tplItems"></span></label>`,
  (form) => {
    const name = form.elements.name.value.trim();
    if (specs.some((x) => norm(x.name) === norm(name))) { toast("같은 이름의 사양이 이미 있습니다."); return false; }
    const tpl = SPEC_TEMPLATES.find(([n]) => n === name);
    const rows = tpl && form.elements.fill.checked ? tpl[1].map((item) => ({ id: Store.uid(), kind: "", item, content: "", review: "" })) : [];
    const sp = { id: Store.uid(), name, rows, files: [], note: "" };
    specs.push(sp);
    route.spec = sp.id;
    Store.touch(p);
    rerender();
  }, { okLabel: "추가", onOpen: (dlg, form) => {
    dlg.addEventListener("click", (e) => {
      const i = e.target.dataset.tpl;
      if (i == null) return;
      const [n, items] = SPEC_TEMPLATES[i];
      form.elements.name.value = n;
      $("#tplItems", dlg).textContent = `(${items.join(", ")})`;
      $$(".preset-chip", dlg).forEach((c) => c.classList.toggle("on", c.contains(e.target)));
    });
  } });
}

async function specImportDialog(p, sp, file) {
  let wb;
  await busy("엑셀 파일을 읽는 중…", async () => { wb = await Xlsx.read(file); });
  if (!wb) return;
  const sheets = wb.sheets.map((sh) => ({ sh, info: analyzeSpecSheet(sh) })).filter((x) => x.info);
  if (!sheets.length) return toast("항목·내용(요구사항) 같은 머리글이 있는 시트를 찾지 못했습니다.", 5000);
  let cur = sheets[0], mapping = { ...cur.info.mapping };
  const LABELS = { kind: "구분", item: "항목", content: "내용", review: "검토" };
  openDialog(`<h3>사양 엑셀 가져오기 <span class="muted small">${esc(file.name)}</span></h3>
    <div class="form">
      <label>시트<select name="sheet">${sheets.map((x, i) => `<option value="${i}">${esc(x.sh.name)} (${readSpecRows(x.info, x.info.mapping).length}행)</option>`).join("")}</select></label>
      <label>넣을 사양<select name="target">${ensureSpecs(p).map((x) => `<option value="${x.id}" ${x === sp ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <label class="full">가져오는 방법<select name="mode"><option value="append">기존 항목 뒤에 추가</option><option value="replace">기존 항목을 이 내용으로 바꾸기</option></select></label>
    </div>
    <h4>열 맞추기 <span class="muted small">자동으로 맞춘 결과입니다. 틀리면 바꿔 주세요.</span></h4>
    <div class="map-grid" id="mapGrid"></div>
    <label class="row2" style="margin-top:10px"><input type="checkbox" name="keep" checked> 원본 엑셀 파일을 사양 자료로 보관</label>
    <h4>미리보기 <span class="muted small" id="pvSum"></span></h4><div id="pv"></div>`,
  async (form) => {
    const rows = readSpecRows(cur.info, mapping);
    const target = ensureSpecs(p).find((x) => x.id === form.elements.target.value);
    target.rows = form.elements.mode.value === "replace" ? rows : [...target.rows, ...rows];
    if (form.elements.keep.checked) target.files.push(await Store.addFile(file, file.name));
    route.spec = target.id;
    Store.touch(p);
    rerender();
    toast(`${rows.length}개 항목을 '${target.name}'에 넣었습니다.`);
  }, { wide: true, okLabel: "가져오기", onOpen: (dlg, form) => {
    const drawMap = () => {
      $("#mapGrid", dlg).innerHTML = Object.entries(LABELS).map(([k, label]) => `<label>${label}<select data-map="${k}">
        <option value="">(없음)</option>${cur.info.columns.map((c) => `<option value="${c.c}" ${String(mapping[k]) === String(c.c) ? "selected" : ""}>${Xlsx.colName(c.c)}: ${esc(c.label.slice(0, 30))}</option>`).join("")}
        </select></label>`).join("");
    };
    const draw = () => {
      const rows = readSpecRows(cur.info, mapping);
      $("#pvSum", dlg).textContent = `${rows.length}개 항목`;
      $("#pv", dlg).innerHTML = `<div class="table-scroll preview"><table class="list"><thead><tr><th>NO</th>${Object.values(LABELS).map((l) => `<th>${l}</th>`).join("")}</tr></thead>
        <tbody>${rows.slice(0, 60).map((r, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(r.kind)}</td><td>${esc(r.item)}</td><td>${esc(r.content)}</td><td>${esc(r.review)}</td></tr>`).join("")}</tbody></table></div>`;
    };
    form.elements.sheet.onchange = () => { cur = sheets[form.elements.sheet.value]; mapping = { ...cur.info.mapping }; drawMap(); draw(); };
    dlg.addEventListener("change", (e) => { if (e.target.dataset.map != null) { mapping[e.target.dataset.map] = e.target.value; draw(); } });
    drawMap();
    draw();
  } });
}
const PART_LISTS = ["bom", "consumables", "supplied"];
let partsUndo = null; // { pid, key, rows, label } 마지막 가져오기/정리 직전 상태

// 자재 목록 키: "unit:<설비id>"(설비별 BOM), "consumables", "supplied"
const setPartRows = (p, key, rows) => { if (key.startsWith("unit:")) findUnit(p, key).bom = rows; else p.lists[key] = rows; };
const partTitle = (p, key) => listDef(p, key).title;
function partTargets(p) {
  return [...ensureUnits(p).map((u) => [`unit:${u.id}`, `BOM · ${u.name} (×${u.qty})`]), ["consumables", "소모품"], ["supplied", "지정품/지급품"]];
}

function tabParts(p, el) {
  const sub = PART_LISTS.includes(route.sub) ? route.sub : "bom";
  const units = ensureUnits(p);
  p.listFiles ||= {};
  // BOM 은 설비를 골라서 본다 (route.unit: 설비 id 또는 "sum")
  if (sub === "bom" && route.unit !== "sum" && !units.some((u) => u.id === route.unit)) route.unit = units[0].id;
  const key = sub === "bom" ? (route.unit === "sum" ? null : `unit:${route.unit}`) : sub;
  const counts = { bom: bomItemCount(p), consumables: p.lists.consumables.length, supplied: p.lists.supplied.length };
  const nav = `<nav class="subtabs">${PART_LISTS.map((k) =>
    `<button data-sub="${k}" class="${k === sub ? "active" : ""}">${LISTS[k].title} <small>${counts[k]}</small></button>`).join("")}</nav>`;
  const unitBar = sub !== "bom" ? "" : `<div class="unit-bar">
      ${units.map((u) => `<button class="unit-chip ${route.unit === u.id ? "active" : ""}" data-unit="${u.id}">
        <b>${esc(u.name)}</b><span class="uqty">×${esc(u.qty)}</span><small>${u.bom.filter(isItemRow).length}품목</small></button>`).join("")}
      <button class="unit-chip sum ${route.unit === "sum" ? "active" : ""}" data-unit="sum"><b>📊 전체 합계</b><small>구매 수량</small></button>
      <span class="unit-actions"><button class="btn sm" id="addUnit">＋ 설비 추가</button>
        <button class="btn sm" id="syncUnits" title="개요의 사업 범위(예: Conveyor AMR : 2EA)에서 설비와 대수를 가져옵니다">↻ 사업 범위에서 가져오기</button></span>
    </div>`;
  if (!key) {
    el.innerHTML = nav + unitBar + bomSummaryCard(p);
    bindParts();
    return;
  }
  const unit = key.startsWith("unit:") ? findUnit(p, key) : null;
  const files = p.listFiles[key] || [];
  const undo = partsUndo && partsUndo.pid === p.id && partsUndo.key === key ? partsUndo : null;
  el.innerHTML = nav + unitBar + `
    <div class="card parts-tools">
      ${unit ? `<div class="unit-edit"><label>설비명<input id="unitName" value="${esc(unit.name)}"></label>
        <label>대수<input id="unitQty" inputmode="numeric" value="${esc(unit.qty)}"></label>
        <span class="muted small">BOM 에는 <b>1대당 수량</b>을 적으면 총 수량(× 대수)은 자동 계산됩니다.</span>
        <button class="btn danger sm" id="delUnit" ${units.length > 1 ? "" : "disabled"}>설비 삭제</button></div>` : ""}
      <div class="between wrap">
        <div class="row2"><button class="btn primary" id="partsImport">📥 엑셀에서 가져오기</button>
          <button class="btn" id="partsOrganize" ${listRows(p, key).length ? "" : "disabled"}>🧹 자동 정리</button>
          ${undo ? `<button class="btn" id="partsUndo">↩ 되돌리기 (${esc(undo.label)})</button>` : ""}</div>
        <span class="muted small">업체 BOM·메이커리스트 엑셀을 넣으면 머리글을 알아보고 표에 맞춰 정리합니다.</span></div>
      ${files.length ? `<div class="chips"><span class="muted small">원본 파일:</span>${fileChips(files, { removable: true })}</div>` : ""}
    </div>${gridCard(p, key, unit ? `칸을 눌러 바로 수정합니다. 엑셀에서 여러 행을 붙여넣을 수 있고, 오른쪽 ⇄ 로 다른 설비로 옮길 수 있습니다.` : "")}`;
  bindParts();
  $("#partsImport").onclick = () => pickFiles(".xlsx", false, (f) => partsImportDialog(p, key, f[0]));
  $("#partsOrganize").onclick = () => partsOrganizeDialog(p, key);
  if (undo) $("#partsUndo").onclick = () => {
    setPartRows(p, key, undo.rows);
    partsUndo = null;
    Store.touch(p);
    rerender();
  };
  if (unit) {
    $("#unitName").onchange = (e) => {
      const old = unit.name;
      unit.name = e.target.value.trim() || old;
      Store.touch(p);
      rerender();
    };
    $("#unitQty").onchange = (e) => {
      unit.qty = Math.max(0, Number(String(e.target.value).replace(/[^\d.]/g, "")) || 0);
      Store.touch(p);
      rerender();
    };
    $("#delUnit").onclick = () => {
      const n = unit.bom.filter(isItemRow).length;
      if (!confirm(`'${unit.name}' 설비를 삭제할까요?${n ? `\nBOM ${n}개 품목도 함께 삭제됩니다.` : ""}`)) return;
      p.units = units.filter((u) => u !== unit);
      delete p.listFiles[key];
      route.unit = p.units[0].id;
      Store.touch(p);
      Store.gc();
      rerender();
    };
  }
  $(".parts-tools", el).addEventListener("click", async (e) => {
    const id = e.target.dataset.remove;
    if (!id) return;
    e.stopPropagation();
    if (!confirm("원본 파일을 목록에서 삭제할까요? (표 내용은 그대로 남습니다)")) return;
    p.listFiles[key] = files.filter((x) => x !== id);
    Store.touch(p);
    await Store.gc();
    rerender();
  });

  function bindParts() {
    $$("[data-sub]", el).forEach((b) => (b.onclick = () => { route.sub = b.dataset.sub; rerender(); }));
    $$("[data-unit]", el).forEach((b) => (b.onclick = () => { route.unit = b.dataset.unit; rerender(); }));
    $("#addUnit")?.addEventListener("click", () => {
      const name = prompt("설비 이름 (예: Manual Charger)");
      if (!name?.trim()) return;
      const qty = Number(prompt("대수", "1")) || 1;
      const u = { id: Store.uid(), name: name.trim(), qty, bom: [] };
      units.push(u);
      route.unit = u.id;
      Store.touch(p);
      rerender();
    });
    $("#syncUnits")?.addEventListener("click", () => {
      const parsed = parseScopeUnits(p.overview.scope);
      if (!parsed.length) return toast("개요의 사업 범위가 비어 있습니다. 예: Conveyor AMR : 2EA");
      let added = 0, changed = 0;
      for (const x of parsed) {
        const u = units.find((y) => norm(y.name) === norm(x.name));
        if (!u) { units.push({ id: Store.uid(), name: x.name, qty: x.qty, bom: [] }); added++; }
        else if (Number(u.qty) !== x.qty) { u.qty = x.qty; changed++; }
      }
      Store.touch(p);
      toast(added || changed ? `설비 ${added}개 추가, 대수 ${changed}개 변경했습니다.` : "사업 범위와 설비 목록이 이미 같습니다.");
      rerender();
    });
  }
}

// 전체 합계 (구매용): 설비별 총 수량과 합계
function bomSummaryCard(p) {
  const { units, rows } = bomSummary(p);
  if (!rows.length) return `<div class="card muted center pad">설비별 BOM 에 품목을 넣으면 같은 부품을 모아 구매 수량을 계산합니다.</div>`;
  const shared = rows.filter((r) => Object.keys(r.per).length > 1).length;
  return `<div class="card"><div class="between wrap"><h3>📊 전체 합계 <span class="muted small">${rows.length}개 부품${shared ? ` · 여러 설비 공통 ${shared}개` : ""}</span></h3>
      <span class="muted small">총 수량 = 설비별 (1대당 수량 × 대수)의 합 · 품목·모델명·업체명이 같으면 같은 부품으로 봅니다</span></div>
    <div class="table-scroll"><table class="grid-table sum-table"><thead><tr><th class="num">NO</th><th>구분</th><th>품목</th><th>모델명</th><th>업체명</th>
      ${units.map((u) => `<th class="num">${esc(u.name)}<br><small>×${esc(u.qty)}</small></th>`).join("")}<th class="num">총 수량</th><th>비고</th></tr></thead>
    <tbody>${rows.map((r, i) => `<tr class="${Object.keys(r.per).length > 1 ? "shared" : ""}"><td class="num muted">${i + 1}</td><td>${esc(r.kind)}</td><td><b>${esc(r.item)}</b></td>
      <td>${esc(r.model)}</td><td>${esc(r.maker)}</td>${units.map((u) => `<td class="num">${r.per[u.id] != null ? esc(r.per[u.id]) : `<span class="muted">-</span>`}</td>`).join("")}
      <td class="num"><b>${esc(r.total)}</b></td><td class="muted small">${esc(r.notes.join(" / "))}</td></tr>`).join("")}</tbody></table></div></div>`;
}

const PART_LABELS = { kind: "구분", item: "품목", model: "모델명", maker: "업체명", qty: "개수", note: "비고" };
function partsPreviewTable(rows, limit = 60) {
  return `<div class="table-scroll preview"><table class="list"><thead><tr><th>NO</th>${PART_COLS.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
    <tbody>${(() => { let n = 0; return rows.slice(0, limit).map((r) => /^■/.test(r.item)
      ? `<tr class="sec-row"><td></td><td colspan="${PART_COLS.length}"><b>${esc(r.item)}</b></td></tr>`
      : `<tr><td class="muted">${++n}</td>${PART_COLS.map((c) => `<td>${esc(r[c.key])}</td>`).join("")}</tr>`).join(""); })()}</tbody></table>
    ${rows.length > limit ? `<p class="muted small center">… 외 ${rows.length - limit}행</p>` : ""}</div>`;
}
const organizeSummary = (st) => `${st.before}행 → <b>${st.after}행</b>` +
  [st.merged && `중복 ${st.merged}건 합침`, st.filled && `구분 ${st.filled}건 채움`, st.removed && `빈 행 ${st.removed}건 제거`].filter(Boolean).map((x) => ` · ${x}`).join("");

async function partsImportDialog(p, key, file) {
  let wb;
  await busy("엑셀 파일을 읽는 중…", async () => { wb = await Xlsx.read(file); });
  if (!wb) return;
  const sheets = wb.sheets.map((sh) => ({ sh, info: analyzePartSheet(sh) })).filter((x) => x.info);
  if (!sheets.length) return toast("품목·모델명 같은 머리글이 있는 시트를 찾지 못했습니다.", 5000);
  // 보통 맨 앞 시트가 최신본이므로 기본 선택 (내용이 너무 적으면 가장 많은 시트)
  const count = (x) => readPartRows(x.info, x.info.mapping).filter((r) => !r.section).length;
  const most = sheets.reduce((a, b) => (count(b) > count(a) ? b : a));
  let cur = count(sheets[0]) * 2 >= count(most) ? sheets[0] : most;
  let mapping = { ...cur.info.mapping };
  openDialog(`<h3>BOM 엑셀 가져오기 <span class="muted small">${esc(file.name)}</span></h3>
    <div class="form">
      <label>시트<select name="sheet">${sheets.map((x, i) => `<option value="${i}" ${x === cur ? "selected" : ""}>${esc(x.sh.name)} (${count(x)}행)</option>`).join("")}</select></label>
      <label>넣을 목록<select name="target">${partTargets(p).map(([k, label]) => `<option value="${k}" ${k === key ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      <label class="full">가져오는 방법<select name="mode"><option value="append">기존 목록 뒤에 추가</option><option value="replace">기존 목록을 이 내용으로 바꾸기</option></select></label>
    </div>
    <h4>열 맞추기 <span class="muted small">자동으로 맞춘 결과입니다. 틀리면 바꿔 주세요.</span></h4>
    <div class="map-grid" id="mapGrid"></div>
    <div class="opts">
      <label><input type="checkbox" name="extra"> 표에 없는 열(원가, Origin 등)도 비고에 붙이기</label>
      <label><input type="checkbox" name="fill" checked> 구분이 비어 있으면 소제목(예: 전장, 본체부)으로 채우기</label>
      <label><input type="checkbox" name="merge" checked> 같은 구분·품목·모델·업체는 한 줄로 합치고 개수 더하기</label>
      <label><input type="checkbox" name="group" checked> 같은 구분끼리 모으기</label>
      <label><input type="checkbox" name="keep" checked> 원본 엑셀 파일 보관</label>
    </div>
    <h4>미리보기 <span class="muted small" id="pvSum"></span></h4><div id="pv"></div>`,
  async (form) => {
    const { rows, stats } = build(form);
    const target = form.target.value;
    const before = listRows(p, target);
    partsUndo = { pid: p.id, key: target, rows: structuredClone(before), label: "가져오기" };
    setPartRows(p, target, form.mode.value === "replace" ? rows : [...before, ...rows]);
    if (form.keep.checked) {
      p.listFiles ||= {};
      (p.listFiles[target] ||= []).push(await Store.addFile(file, file.name));
    }
    Store.touch(p);
    if (target.startsWith("unit:")) { route.sub = "bom"; route.unit = target.slice(5); } else route.sub = target;
    rerender();
    toast(`${stats.after}행을 가져왔습니다.`);
  }, { wide: true, okLabel: "가져오기", onOpen: (dlg, form) => {
    const drawMap = () => {
      $("#mapGrid", dlg).innerHTML = Object.entries(PART_LABELS).map(([k, label]) => `<label>${label}<select data-map="${k}">
        <option value="">(없음)</option>${cur.info.columns.map((c) => `<option value="${c.c}" ${String(mapping[k]) === String(c.c) ? "selected" : ""}>${Xlsx.colName(c.c)}: ${esc(c.label.slice(0, 30))}</option>`).join("")}
        </select></label>`).join("");
    };
    const draw = () => {
      const { rows, stats } = build(form);
      $("#pvSum", dlg).innerHTML = organizeSummary(stats);
      $("#pv", dlg).innerHTML = partsPreviewTable(rows);
    };
    form.sheet.onchange = () => { cur = sheets[form.sheet.value]; mapping = { ...cur.info.mapping }; drawMap(); draw(); };
    dlg.addEventListener("change", (e) => {
      if (e.target.dataset.map) mapping[e.target.dataset.map] = e.target.value;
      if (e.target.name !== "sheet") draw();
    });
    drawMap();
    draw();
  } });
  function build(form) {
    const raw = readPartRows(cur.info, mapping, { extraToNote: form.extra.checked });
    return organizeParts(raw, { fillKind: form.fill.checked, merge: form.merge.checked, group: form.group.checked });
  }
}

function partsOrganizeDialog(p, key) {
  const run = (form) => organizeParts(listRows(p, key), { fillKind: form.fill.checked, merge: form.merge.checked, group: form.group.checked });
  openDialog(`<h3>${esc(partTitle(p, key))} 자동 정리</h3>
    <div class="opts">
      <label><input type="checkbox" checked disabled> 앞뒤 공백·줄바꿈 정리, 빈 행 삭제</label>
      <label><input type="checkbox" name="fill" checked> 구분이 비어 있으면 위의 소제목(■ 행)으로 채우기</label>
      <label><input type="checkbox" name="merge" checked> 같은 구분·품목·모델·업체는 한 줄로 합치고 개수 더하기</label>
      <label><input type="checkbox" name="group" checked> 같은 구분끼리 모으기 (소제목 순서는 유지)</label>
    </div>
    <h4>정리 결과 미리보기 <span class="muted small" id="pvSum"></span></h4><div id="pv"></div>`,
  (form) => {
    const { rows, stats } = run(form);
    partsUndo = { pid: p.id, key, rows: structuredClone(listRows(p, key)), label: "자동 정리" };
    setPartRows(p, key, rows);
    Store.touch(p);
    rerender();
    toast("정리했습니다. 마음에 들지 않으면 ↩ 되돌리기를 누르세요.", 4000);
  }, { wide: true, okLabel: "정리하기", onOpen: (dlg, form) => {
    const draw = () => {
      const { rows, stats } = run(form);
      $("#pvSum", dlg).innerHTML = organizeSummary(stats);
      $("#pv", dlg).innerHTML = partsPreviewTable(rows);
    };
    dlg.addEventListener("change", draw);
    draw();
  } });
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
  Store.onChange(() => { if (!autoRunning) scheduleAutoBackup(); });
  // 시작할 때 오늘 자동 백업이 아직 없으면 한 번
  autoDir().then((dir) => { renderSidebar(); if (dir) autoBackup(); });
  window.addEventListener("beforeunload", () => Store.flush());
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && Store.flush());
  render();
}
start();
