// ---------------------------------------------------------------------------
// 화면 구성 정의, 일정 계산, 엑셀 불러오기/내보내기
// ---------------------------------------------------------------------------
const PROJECT_STATUSES = ["계획", "진행", "보류", "완료"];
const RECORD_KINDS = ["문의", "답변", "자료", "공지", "기타"];
const PART_COLS = [
  { key: "kind", label: "구분", w: 12 }, { key: "item", label: "품목", w: 22 }, { key: "model", label: "모델명", w: 22 },
  { key: "maker", label: "업체명", w: 16 }, { key: "qty", label: "개수", w: 7, type: "number" }, { key: "note", label: "비고", w: 24 },
];
// 사양 항목은 문장이 길어서 항목·내용·검토 모두 줄바꿈되는 칸으로
const SPEC_COLS = [
  { key: "kind", label: "구분", w: 16, type: "textarea" }, { key: "item", label: "항목", w: 24, type: "textarea" },
  { key: "content", label: "내용", w: 44, type: "textarea" }, { key: "review", label: "검토", w: 22, type: "textarea" },
];
const LISTS = {
  sw: { title: "SW 사양", sheet: "SW 사양", cols: SPEC_COLS },
  hw: { title: "HW 주요 Spec", sheet: "HW 주요 Spec", cols: SPEC_COLS },
  supplied: { title: "지정품/지급품", sheet: "지정품_지급품", cols: PART_COLS },
  consumables: { title: "소모품", sheet: "소모품", cols: PART_COLS },
  bom: { title: "BOM", sheet: "BOM", cols: PART_COLS },
  submissions: { title: "제출 자료", sheet: "제출 자료", files: true, cols: [
    { key: "item", label: "자료명", w: 30 }, { key: "to", label: "제출처", w: 16 },
    { key: "submitted", label: "제출일", w: 12, type: "date" },
    { key: "status", label: "상태", w: 9, type: "select", options: ["미제출", "제출", "승인", "반려"] },
    { key: "note", label: "비고", w: 24 }] },
  changes: { title: "변경사항", sheet: "변경사항", files: true, cols: [
    { key: "date", label: "날짜", w: 12, type: "date" }, { key: "author", label: "작성자", w: 10 },
    { key: "requester", label: "요청자", w: 10 }, { key: "content", label: "변경 내용", w: 50, type: "textarea" },
    { key: "note", label: "비고", w: 20 }] },
  revisions: { title: "Revision", sheet: "Revision", cols: [
    { key: "date", label: "날짜", w: 12, type: "date" }, { key: "author", label: "작성자", w: 10 },
    { key: "content", label: "내용", w: 50, type: "textarea" }, { key: "note", label: "비고", w: 32 }] },
};
const OVERVIEW_FIELDS = [
  ["project", "Project"], ["projectNo", "Project No"], ["partNo", "Part No"], ["customer", "고객사"],
  ["receiveDate", "입고일자"], ["receivePlace", "입고 장소"], ["scope", "사업 범위"], ["warranty", "하자보증기간"], ["note", "비고"],
];

// "unit:<id>" 는 설비별 BOM, "bom" 은 (예전 코드 호환) 첫 번째 설비의 BOM
const listRows = (p, key) => (key === "revisions" ? p.revisions
  : key.startsWith("unit:") ? findUnit(p, key)?.bom || []
  : key.startsWith("spec:") ? findSpec(p, key)?.rows || []
  : key === "bom" ? ensureUnits(p)[0].bom : p.lists[key]);
const listDef = (p, key) => {
  if (key.startsWith("spec:")) return { ...LISTS.specsec, title: findSpec(p, key)?.name || "사양" };
  if (!key.startsWith("unit:")) return LISTS[key];
  const u = findUnit(p, key);
  return { ...LISTS.unitbom, title: `BOM · ${u?.name || ""}`, unit: u, units: ensureUnits(p) };
};

// ------------------------------------------------------------- 설비별 BOM
// 프로젝트의 설비(예: Conveyor AMR ×2, AUTO Charger ×1)마다 1대당 BOM 을 두고, 총 수량 = 1대당 수량 × 대수
LISTS.unitbom = { title: "BOM", sheet: "BOM", cols: PART_COLS.map((c) => (c.key === "qty" ? { ...c, label: "1대당 수량", w: 8 } : c)),
  computed: [{ label: "총 수량", after: "qty", fn: (r, u) => unitTotalQty(r, u) }] };
const isItemRow = (r) => !/^■/.test(r.item || "");
function unitTotalQty(r, u) {
  const q = Number(String(r.qty ?? "").replace(/,/g, ""));
  return isItemRow(r) && String(r.qty ?? "").trim() !== "" && !isNaN(q) ? q * (Number(u?.qty) || 0) : "";
}
// "Conveyor AMR : 2EA" → { name: "Conveyor AMR", qty: 2 }
// "모바일 로봇(PTR) 1대" → { name: "모바일 로봇(PTR)", qty: 1 }. 수량이 적힌 줄이 하나라도 있으면
// 수량 없는 줄("상위시스템 연동" 같은 업무 범위)은 설비로 만들지 않음
function parseScopeUnits(scope) {
  const list = String(scope || "").split("\n").map((l) => l.trim().replace(/^[-•·※▶■]\s*/, "")).filter(Boolean).map((l) => {
    const m = /^(.*?)\s*[:：x×]\s*(\d+)\s*(?:EA|ea|대|개|set|SET|식|기|units?)?\s*$/.exec(l)
      || /^(.*?\S)\s+(\d+)\s*(?:EA|ea|대|개|set|SET|식|기|units?)\s*$/i.exec(l);
    return m ? { name: m[1].trim(), qty: Number(m[2]), counted: true } : { name: l, qty: 1, counted: false };
  });
  const counted = list.filter((x) => x.counted);
  return (counted.length ? counted : list).map(({ name, qty }) => ({ name, qty }));
}
// 설비 목록이 없으면 사업 범위에서 만들고, 예전 BOM(한 장짜리)은 첫 번째 설비로 옮긴다
function ensureUnits(p) {
  if (Array.isArray(p.units) && p.units.length) return p.units;
  const parsed = parseScopeUnits(p.overview.scope);
  p.units = (parsed.length ? parsed : [{ name: p.overview.name || "설비", qty: 1 }]).map((u) => ({ id: Store.uid(), name: u.name, qty: u.qty, bom: [] }));
  if (p.lists.bom?.length) { p.units[0].bom = p.lists.bom; p.lists.bom = []; }
  if (p.listFiles?.bom?.length) { p.listFiles[`unit:${p.units[0].id}`] = p.listFiles.bom; delete p.listFiles.bom; }
  return p.units;
}
// BOM 시트 이름 ↔ 설비 이름 맞추기: "AMR", "BOM(AMR)", "충전기 BOM", "BOM_Auto Charger" …
const UNIT_SYNONYMS = [["충전기", "charger", "charging", "충전", "충전스테이션", "docking"], ["amr", "로봇", "robot", "agv", "mobile"],
  ["컨베이어", "conveyor"], ["리프트", "lift"], ["대차", "cart", "trolley"], ["매니퓰레이터", "manipulator"]];
const bomSheetUnitName = (name) => String(name || "").replace(/\(\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*\)/, "")
  .replace(/maker\s*list|bom\s*list|부품\s*리스트|부품표|메이커\s*리스트|\bbom\b|bom/gi, "").replace(/^[\s_\-·()[\]]+|[\s_\-·()[\]]+$/g, "").trim();
const isOldSheet = (name) => /이전|old|구버전|backup|백업|사본|copy/i.test(name) || /\(\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*\)/.test(name);
const synGroups = (n) => UNIT_SYNONYMS.map((g, i) => (g.some((w) => n.includes(norm(w))) ? i : -1)).filter((i) => i >= 0);
// 가장 잘 맞는 설비 (정확히 같음 > 한쪽이 다른 쪽을 포함 > 같은 뜻의 말), 없으면 null
function matchUnit(units, sheetName) {
  const n = norm(bomSheetUnitName(sheetName) || sheetName);
  if (!n) return null;
  const score = (u) => {
    const un = norm(u.name);
    if (un === n) return 3;
    if (un.length >= 2 && (n.includes(un) || un.includes(n))) return 2;
    const a = synGroups(n), b = synGroups(un);
    return a.length && a.some((i) => b.includes(i)) ? 1 : 0;
  };
  const best = units.map((u) => [u, score(u)]).filter(([, s]) => s).sort((a, b) => b[1] - a[1]);
  return best.length && (best.length === 1 || best[0][1] > best[1][1]) ? best[0][0] : null;
}
const looksLikeUnitSheet = (name) => synGroups(norm(name)).length > 0;
const findUnit = (p, key) => ensureUnits(p).find((u) => `unit:${u.id}` === key || u.id === key);
const bomItemCount = (p) => ensureUnits(p).reduce((a, u) => a + u.bom.filter(isItemRow).length, 0);
// 전체 합계: 같은 품목·모델·업체를 모아 설비별 수량과 총 수량
function bomSummary(p) {
  const units = ensureUnits(p), map = new Map();
  for (const u of units) for (const r of u.bom) {
    if (!isItemRow(r) || !(r.item || r.model)) continue;
    const key = [r.item, r.model, r.maker].map(norm).join("|");
    if (!map.has(key)) map.set(key, { kind: r.kind, item: r.item, model: r.model, maker: r.maker, per: {}, total: 0, notes: [] });
    const x = map.get(key), t = unitTotalQty(r, u);
    x.per[u.id] = (x.per[u.id] || 0) + (t === "" ? 0 : t);
    if (t !== "") x.total += t;
    if (r.note && !x.notes.includes(r.note)) x.notes.push(r.note);
    if (!x.kind && r.kind) x.kind = r.kind;
  }
  return { units, rows: [...map.values()] };
}


// ------------------------------------------------------------- 일정 계산
// 엑셀 일정 시트와 같은 방식: 기간 = 종료-시작+1, 잔여 = 기준일 이후 남은 날, 경과 = 기간-잔여
function taskInfo(t, base = today()) {
  if (!isDate(t.start) || !isDate(t.end)) return { dur: "", elapsed: "", remain: "", status: t.done ? "완료" : "미정" };
  const s = dayNo(t.start), e = dayNo(t.end), b = dayNo(base);
  const dur = e - s + 1;
  const remain = s >= b ? dur : b > e ? 0 : e - b;
  let status = "예정";
  if (t.done) status = "완료";
  else if (b > e) status = "지연";
  else if (b >= s) status = "진행";
  return { dur, elapsed: dur - remain, remain, status };
}
// 일정 전체의 상태: 날짜 없는 세부 항목(" - AMR 주행" 등)은 같은 단계에서 바로 위에 있는
// 날짜 있는 일정을 따른다 (직접 ✓ 한 것은 완료). inherit = 따르는 일정 이름
function scheduleInfos(schedule, base = today()) {
  let parent = null, phase;
  return schedule.map((t) => {
    if (t.phase !== phase) { phase = t.phase; parent = null; }
    const i = taskInfo(t, base);
    if (isDate(t.start) && isDate(t.end)) { parent = { t, i }; return i; }
    return !t.done && parent ? { ...i, status: parent.i.status, inherit: parent.t.name, parentDone: parent.t.doneDate || "" } : i;
  });
}
// Revision 줄을 그 줄을 만든 자료 이력·회의록과 연결 (ref). 제목이 띄어쓰기·괄호·덧붙인 말 정도만 달라도 찾는다
// 같은 제목이 정확히 맞는 것을 먼저, 없으면 한쪽이 다른 쪽을 포함하는 것 중 가장 비슷한 것 하나
function linkRevisions(p) {
  // 예전에 불러온 회의록: 제목이 있으면 이미 기록된 것으로 (제목을 고쳐도 새 줄이 생기지 않게)
  for (const m of p.meetings) if (m.logged === undefined && m.title?.trim()) m.logged = true;
  // 자료 이력·회의록(제목과 원래 시트 이름)·사양 구분
  const targets = [...p.records.map((r) => ({ id: r.id, t: norm(r.title) })),
    ...p.meetings.flatMap((m) => [{ id: m.id, t: norm(m.title) }, { id: m.id, t: norm(m.sheetTitle || "") }]),
    ...(p.specs || []).map((s) => ({ id: s.id, t: norm(s.name) }))].filter((x) => x.t.length >= 2);
  const used = new Set(p.revisions.map((r) => r.ref).filter(Boolean));
  let changed = false;
  for (const pass of ["exact", "contains"]) {
    for (const r of p.revisions) {
      const c = norm(r.content), core = c.replace(/(회의록|회의|자료)$/, "");
      if (r.ref || c.length < 2 || c === norm("신규 작성")) continue;
      const cand = targets.filter((x) => !used.has(x.id) && (pass === "exact" ? x.t === c
        : x.t.includes(c) || c.includes(x.t) || (core.length >= 2 && x.t.includes(core))))
        .sort((a, b) => Math.abs(a.t.length - c.length) - Math.abs(b.t.length - c.length))[0];
      if (cand) { r.ref = cand.id; used.add(cand.id); changed = true; }
    }
  }
  return changed;
}
// 보고서용 완료 판정: 일정 탭과 같은 기준 (날짜 없는 세부 항목은 위 일정을 따름)
function scheduleDone(p, base = today()) {
  const infos = scheduleInfos(p.schedule, base);
  const done = new Map(), date = new Map();
  p.schedule.forEach((t, k) => {
    done.set(t.id, infos[k].status === "완료");
    date.set(t.id, t.doneDate || (infos[k].inherit && infos[k].status === "완료" ? infos[k].parentDone : "") || "");
  });
  return { isDone: (t) => done.get(t.id), doneDate: (t) => date.get(t.id) };
}
// 일정표에 맞춘 프로젝트 상태 (직접 고른 완료·보류가 우선)
//   { st: 지연|진행|예정|완료|보류|계획, text: 배지 글자, tip: 설명 }
function scheduleStatus(p, base = today()) {
  const o = p.overview;
  if (o.status === "완료" || o.status === "보류") return { st: o.status, text: o.status, tip: "직접 지정한 상태" };
  const infos = scheduleInfos(p.schedule, base);
  const list = p.schedule.map((t, k) => ({ t, i: infos[k] })).filter((x) => x.i.status !== "미정");
  if (!list.length) return { st: o.status || "계획", text: o.status || "계획", tip: "일정이 없어 직접 지정한 상태" };
  const phases = (xs) => [...new Set(xs.map((x) => x.t.phase || x.t.name))];
  const names = (ph) => (ph.length <= 2 ? ph.join("·") : `${ph[0]} 외 ${ph.length - 1}`);
  const late = list.filter((x) => x.i.status === "지연" && !x.i.inherit);
  if (late.length) {
    const ph = phases(late);
    return { st: "지연", text: `${names(ph)} 지연`, tip: `지연: ${late.map((x) => `${x.t.phase} · ${x.t.name}`).join(", ")}` };
  }
  let active = list.filter((x) => x.i.status === "진행" && !x.i.inherit);
  if (active.length) {
    // 프로젝트 전체에 걸친 일정(PO 등)은 다른 진행 일정이 있으면 빼고, 최근에 시작한 단계부터
    const sm = projectSummary(p, base);
    const whole = (x) => x.t.start <= sm.start && x.t.end >= sm.end;
    if (active.some((x) => !whole(x))) active = active.filter((x) => !whole(x));
    const now = active.slice().sort((a, b) => b.t.start.localeCompare(a.t.start) || a.t.end.localeCompare(b.t.end));
    const ph = phases(now);
    return { st: "진행", text: `${names(ph)} 진행`, tip: `진행 중: ${now.map((x) => `${x.t.phase} · ${x.t.name}`).join(", ")}` };
  }
  if (list.every((x) => x.i.status === "완료")) return { st: "완료", text: "일정 완료", tip: "모든 일정이 완료되었습니다" };
  const next = list.filter((x) => x.i.status === "예정").sort((a, b) => a.t.start.localeCompare(b.t.start))[0];
  const started = list.some((x) => x.i.status === "완료");
  return next ? { st: "예정", text: started ? `${next.t.phase || next.t.name} 대기` : "시작 전", tip: `다음: ${next.t.phase} · ${next.t.name} (${next.t.start})` }
    : { st: "진행", text: "진행", tip: "" };
}
// 다른 일정과 60일 넘게 동떨어진 시작/종료일 (입력 실수일 가능성) → 기간 계산에서 제외
function suspectTasks(schedule) {
  const dated = schedule.filter((t) => isDate(t.start) && isDate(t.end));
  const out = new Set();
  if (dated.length < 4) return out;
  const starts = dated.map((t) => dayNo(t.start)).sort((a, b) => a - b);
  const ends = dated.map((t) => dayNo(t.end)).sort((a, b) => a - b);
  for (const t of dated) {
    if (dayNo(t.start) === starts[0] && starts[1] - starts[0] > 60) out.add(t.id);
    if (dayNo(t.end) === ends[ends.length - 1] && ends[ends.length - 1] - ends[ends.length - 2] > 60) out.add(t.id);
  }
  return out;
}
function projectSummary(p, base = today()) {
  const suspect = suspectTasks(p.schedule);
  const dated = p.schedule.filter((t) => isDate(t.start) && isDate(t.end) && !suspect.has(t.id));
  const infos = scheduleInfos(p.schedule, base);
  const info = p.schedule.map((t, k) => ({ t, ...infos[k] }));
  const start = dated.length ? dated.map((t) => t.start).sort()[0] : "";
  const end = dated.length ? dated.map((t) => t.end).sort().pop() : "";
  let progress = null;
  if (start && end) {
    const total = dayNo(end) - dayNo(start) + 1;
    progress = Math.max(0, Math.min(100, Math.round(((dayNo(base) - dayNo(start) + 1) / total) * 100)));
  }
  const upcoming = info.filter((x) => x.status !== "완료" && isDate(x.t.start) && dayNo(x.t.start) >= dayNo(base))
    .sort((a, b) => a.t.start.localeCompare(b.t.start));
  return {
    start, end, progress,
    delayed: info.filter((x) => x.status === "지연"),
    active: info.filter((x) => x.status === "진행"),
    next: upcoming[0]?.t,
    openActions: p.meetings.flatMap((m) => m.actions.filter((a) => !a.done && a.text).map((a) => ({ ...a, meeting: m }))),
    pendingSubmissions: p.lists.submissions.filter((s) => s.item && (!s.status || s.status === "미제출")),
  };
}

// ------------------------------------------------------------ 엑셀 불러오기
const norm = (s) => String(s ?? "").replace(/[\s_\-/()·.:]/g, "").toLowerCase();
const cellText = (v) => (v == null ? "" : String(v).trim());
const DATE_IN_NAME = /(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/;
const dateFromText = (s) => {
  const m = DATE_IN_NAME.exec(String(s || ""));
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : "";
};
const titleFromSheet = (name) => name.replace(/\(\s*\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}\s*\)/, "").trim();

// 병합된 셀 범위 전체에 왼쪽 위 값을 채운 행렬
function filledRows(sheet) {
  const rows = sheet.rows.map((r) => (r ? r.slice() : []));
  for (const m of sheet.merges) {
    const v = sheet.rows[m.r1]?.[m.c1];
    if (v == null) continue;
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) (rows[r] ||= [])[c] = v;
  }
  return rows;
}
// 머리글 행을 찾아 { row, cols: {key: 열번호} } 반환
function findHeader(rows, cols, need = 2) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] || [];
    const map = {};
    row.forEach((v, c) => {
      const n = norm(v);
      const col = cols.find((x) => norm(x.label) === n || (x.alias || []).some((a) => norm(a) === n));
      if (col && !(col.key in map)) map[col.key] = c;
    });
    if (Object.keys(map).length >= need) return { row: r, cols: map };
  }
  return null;
}
function readTable(sheet, cols, { carry = [] } = {}) {
  const rows = filledRows(sheet);
  const head = findHeader(rows, cols);
  if (!head) return [];
  const out = [];
  const last = {};
  for (let r = head.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const vals = Object.values(head.cols).map((c) => cellText(row[c])).filter(Boolean);
    // 머리글이 반복된 행은 건너뛰고, 한 줄 전체가 병합된 소제목(예: "지정품 List")은 구분 행으로 남긴다
    const mapped = Object.values(head.cols);
    if (vals.length > 1 && mapped.every((c) => !cellText(row[c]) || norm(row[c]) === norm(rows[head.row][c]))) continue;
    if (vals.length > 1 && new Set(vals).size === 1) {
      const rec = { id: Store.uid() };
      cols.forEach((col) => (rec[col.key] = ""));
      rec[cols.find((c) => c.key === "item") ? "item" : cols[0].key] = `■ ${vals[0]}`;
      out.push(rec);
      Object.keys(last).forEach((k) => delete last[k]);
      continue;
    }
    const rec = { id: Store.uid() };
    let has = false;
    for (const col of cols) {
      const c = head.cols[col.key];
      let v = c == null ? "" : row[c];
      v = col.type === "date" ? (isDate(v) ? v : dateFromText(v) || cellText(v)) : cellText(v);
      if (carry.includes(col.key)) { if (v) last[col.key] = v; else v = last[col.key] || ""; }
      rec[col.key] = v;
      if (v && !carry.includes(col.key)) has = true;
    }
    if (has) out.push(rec);
  }
  return out;
}
// 소제목("■ 지정품 List")만 있고 아래에 품목이 없는 구분 행은 버림 (빈 양식에서 들어오는 군더더기)
const dropEmptySections = (rows) => rows.filter((r, i) => isItemRow(r) || (rows[i + 1] && isItemRow(rows[i + 1])));
// 문서형 '제출 자료' 시트 → 제출할 자료 이름만 (번호 제목 · 설명 문장 · 아래에 A./B. 하위 항목이 있는 묶음 제목은 뺌)
function submissionsFromDoc(sheet) {
  const lines = sheetLines(sheet).map((v) => v.join(" ").replace(/\s+/g, " ").trim()).filter((l) => l && norm(l) !== "제출자료");
  const sub = /^([A-Za-z가-하]|[ivx]+)[.)]\s/i;
  return lines.filter((l, i) => !/^\d+(\.\d+)*\.?\s/.test(l) || /^\d+\)\s/.test(l)) // "1.1. 최종 산출물" 같은 제목
    .filter((l) => !(/(다|니다|할 것|바람|요)\.?$/.test(l) && l.length > 12)) // "…제출하여야 한다." 같은 설명
    .filter((l, i, arr) => !(/^(\(\d+\)|\d+\))\s/.test(l) && sub.test(arr[i + 1] || ""))) // 하위 항목이 있는 묶음 제목
    .map((l) => l.replace(/^(\(\d+\)|\d+\)|[A-Za-z가-하][.)]|[ivx]+[.)]|[-•·※▶])\s*/i, "").trim())
    .filter(Boolean)
    .map((item) => ({ id: Store.uid(), item, to: "", submitted: "", status: "미제출", note: "" }));
}
// 맨 왼쪽에 No 열이 있고 1, 2, 3 … 번호 행이 이어지는 큰 표(시험계획서 · 체크리스트 등) → 사양 항목
// 머리글이 여러 줄이면 합쳐 열 이름을 만들고, 열 이름으로 구분 · 항목 · 내용을 고르고 나머지는 검토에 '이름: 값'.
// 모든 행이 같은 값인 열(대상 · 목적 · 관련 근거 등)은 사양 메모로
function numberedTable(sheet) {
  const rows = filledRows(sheet);
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const row = rows[h] || [];
    const first = row.findIndex((v) => cellText(v));
    if (first < 0 || !/^(no\.?|번호|순번|#)$/i.test(cellText(row[first])) || row.filter((v) => cellText(v)).length < 4) continue;
    // 이 프로그램의 사양 표(구분·항목·내용·검토)처럼 이미 아는 양식이면 원래 방식으로 읽음
    if (SPEC_COLS.filter((c) => row.some((v) => norm(v) === norm(c.label))).length >= 3) return null;
    const isNo = (r) => /^\d+$/.test(cellText(rows[r]?.[first]));
    let d = h + 1;
    while (d < rows.length && d <= h + 4 && !isNo(d)) d++;
    if (!isNo(d)) continue;
    const data = [];
    for (let r = d; r < rows.length; r++) if (isNo(r)) data.push(rows[r] || []);
    if (data.length < 5) continue;
    const width = Math.max(...rows.slice(h, d).map((r) => (r || []).length), ...data.map((r) => r.length));
    const cols = [];
    for (let c = first + 1; c < width; c++) {
      const parts = [];
      for (let r = h; r < d; r++) { const t = cellText(rows[r]?.[c]); if (t && !parts.includes(t)) parts.push(t); }
      const vals = data.map((r) => cellText(r[c]));
      const filled = vals.filter((v) => v && v !== "-");
      if (!parts.length || !filled.length) continue;
      cols.push({ c, last: parts[parts.length - 1], vals, constant: data.length > 1 && filled.length >= data.length * 0.9 && new Set(filled).size === 1 });
    }
    const ITEM = /명칭|품목|항목|item|name|기능명|구성|시험\s*항목/i, KIND = /구분|분류|대상|category|파트|part/i, CONTENT = /spec|사양|내용|설명|상세|요구|기능|조건/i;
    const live = cols.filter((x) => !x.constant);
    const item = live.find((x) => ITEM.test(x.last)) || live.find((x) => !KIND.test(x.last));
    const content = live.find((x) => x !== item && ITEM.test(x.last)) || live.find((x) => x !== item && CONTENT.test(x.last))
      || live.find((x) => x !== item && !KIND.test(x.last));
    const kinds = live.filter((x) => x !== item && x !== content && KIND.test(x.last));
    const rest = live.filter((x) => x !== item && x !== content && !kinds.includes(x));
    const out = data.map((_, k) => ({ id: Store.uid(),
      kind: kinds.map((x) => x.vals[k]).filter((v) => v && v !== "-").join(" · "),
      item: item?.vals[k] || "", content: content?.vals[k] || "",
      review: rest.map((x) => x.vals[k] && x.vals[k] !== "-" ? `${x.last}: ${x.vals[k]}` : "").filter(Boolean).join("\n") }));
    const titleLine = rows.slice(0, h).map((r) => [...new Set((r || []).map(cellText).filter(Boolean))].join(" ")).filter(Boolean).join("\n"); // 합친 칸은 한 번만
    const note = [titleLine, ...cols.filter((x) => x.constant).map((x) => `${x.last}: ${x.vals.find(Boolean)}`)].filter(Boolean).join("\n");
    return { rows: out, note };
  }
  return null;
}
const sheetLines = (sheet) => filledRows(sheet).map((row) => {
  const vals = [];
  (row || []).forEach((v) => { const t = cellText(v); if (t && vals[vals.length - 1] !== t) vals.push(t); });
  return vals;
}).filter((x) => x.length);

function parseOverview(sheet, p) {
  const rows = filledRows(sheet);
  for (const row of rows) {
    const label = cellText(row?.[0]);
    const m = /^설비\s*\/?\s*품목명\s*[:：]\s*(.+)$/.exec(label);
    if (m) { p.overview.name = m[1].trim(); continue; }
    if (!label || ["분류"].includes(label)) continue;
    const value = cellText(row[1]), note = cellText(row[2]);
    const field = OVERVIEW_FIELDS.find(([, l]) => norm(l) === norm(label));
    if (field) {
      const k = field[0];
      if (value) p.overview[k] = p.overview[k] ? `${p.overview[k]}\n${value}` : value;
    } else if (value || note) {
      p.overview.extra.push({ label, value: [value, note].filter(Boolean).join(" / ") });
    }
  }
}

function parseSchedule(sheet) {
  const rows = filledRows(sheet);
  const head = findHeader(rows, [{ key: "name", label: "세부사항" }, { key: "start", label: "시작일" },
    { key: "end", label: "종료일" }, { key: "owner", label: "담당자" }, { key: "note", label: "비고" }, { key: "phase", label: "항목" }], 3);
  if (!head) return [];
  const phaseCol = head.cols.name > 0 ? head.cols.name - 1 : head.cols.phase;
  const out = [];
  let phase = "";
  const base = today();
  for (let r = head.row + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (/^■\s*일정표/.test(cellText(row[0]))) break; // 아래는 내보내기에서 붙인 일정표(간트) — 일정 항목이 아님
    const ph = cellText(row[phaseCol]);
    if (ph) phase = ph;
    const get = (k) => (head.cols[k] == null ? "" : row[head.cols[k]]);
    const name = cellText(get("name"));
    const start = isDate(get("start")) ? get("start") : "";
    const end = isDate(get("end")) ? get("end") : start;
    if (!name && !start) continue;
    out.push({ id: Store.uid(), phase, name: name || phase, owner: cellText(get("owner")), note: cellText(get("note")),
      start, end, done: !!end && end < base });
  }
  return out;
}

// 회의록 양식마다 다른 항목 이름 (공백 무시)
const MEETING_LABELS = {
  dept: ["부서명", "부서", "주관부서"], writer: ["작성자", "작성", "기록자", "작성인"],
  date: ["회의일자", "일자", "일시", "회의일시", "날짜", "회의일"], place: ["회의장소", "장소"], time: ["회의시간", "시간"],
  kind: ["구분"], title: ["제목", "회의명", "회의제목", "안건", "주제"], attendees: ["참석자", "참석인원", "참석"],
};
const MEETING_SECTIONS = {
  content: ["회의내용", "논의내용", "주요내용", "내용", "협의내용", "논의사항", "회의결과"],
  actions: ["실천의제", "조치사항", "후속조치", "향후일정", "actionitem", "actionitems", "todo", "결정사항"],
  notes: ["특이사항", "기타사항"],
};
const labelKey = (v) => Object.keys(MEETING_LABELS).find((k) => MEETING_LABELS[k].includes(norm(v)));
const sectionKey = (v) => Object.keys(MEETING_SECTIONS).find((k) => MEETING_SECTIONS[k].includes(norm(v)));

// 회의록 시트인지: 시트 이름이나 제목에 "회의록"이 있거나,
// 일자·장소·참석자·회의 내용 중 3가지 이상이 있고 그중 장소나 참석자가 있을 때 (날짜·내용 열만 있는 일반 표는 제외)
function isMeetingSheet(sheet) {
  const cells = sheetLines(sheet).slice(0, 20).flat();
  if (norm(sheet.name).includes("회의록") || cells.some((v) => norm(v) === "회의록")) return true;
  const hits = new Set(cells.map((v) => labelKey(String(v).split(/[:：]/)[0]) || (sectionKey(v) && "s:" + sectionKey(v))).filter(Boolean));
  return ["date", "place", "attendees", "s:content"].filter((k) => hits.has(k)).length >= 3 && (hits.has("place") || hits.has("attendees"));
}

function parseMeeting(sheet, fileIds) {
  const lines = sheetLines(sheet);
  const m = { id: Store.uid(), title: titleFromSheet(sheet.name), dept: "", writer: "", date: dateFromText(sheet.name), time: "",
    place: "", kind: "", attendees: "", content: "", actions: [], notes: "", files: fileIds };
  const set = (key, v) => {
    v = String(v || "").trim();
    if (key === "date") {
      m.date = dateFromText(v) || (isDate(v) ? v : "") || m.date;
      const t = /\d{1,2}:\d{2}\s*[~\-]\s*\d{1,2}:\d{2}/.exec(v);
      if (t && !m.time) m.time = t[0];
    } else if (key === "kind") m.kind = (/■\s*(비?정례)/.exec(v) || [])[1] || v.replace(/[□■]/g, "").trim();
    else if (v) m[key] = v;
  };
  let section = "head", lastLabel = "";
  const content = [], notes = [];
  for (const vals of lines) {
    const n0 = norm(vals[0]);
    if (n0 === "회의록") continue;
    const sec = sectionKey(vals[0]);
    if (sec) {
      section = sec;
      const rest = vals.slice(1);
      // 같은 줄 오른쪽에 내용이 있는 양식 (예: "회의 내용 | 1. 개요 …")
      if (rest.length && !(sec === "actions" && rest.some((v) => ["지시내용", "담당자", "담당"].includes(norm(v))))) {
        if (sec === "content") content.push(rest.join("  "));
        else if (sec === "notes") notes.push(rest.join(" "));
        else m.actions.push({ id: Store.uid(), text: rest[0], owner: rest[1] || "", due: dateFromText(rest[2]) || rest[2] || "", done: false, note: rest[3] || "" });
      }
      continue;
    }
    if (section === "head") {
      let matched = false;
      for (let i = 0; i < vals.length; i++) {
        let key = labelKey(vals[i]), v = vals[i + 1] && !labelKey(vals[i + 1]) ? vals[i + 1] : "";
        // "일시 : 2026.09.16" 처럼 한 칸에 항목과 값이 같이 있는 경우
        const kv = /^([^:：]{1,8})\s*[:：]\s*(.*)$/.exec(vals[i]);
        if (!key && kv && labelKey(kv[1])) { key = labelKey(kv[1]); v = kv[2]; }
        if (key) { matched = true; lastLabel = key; set(key, v); }
      }
      if (!matched && lastLabel === "attendees") m.attendees += "\n" + vals.join(" ");
    } else if (section === "content") {
      if (n0 === "no" && vals.some((v) => norm(v) === "주요내용")) continue;
      content.push(/^\d+$/.test(vals[0]) && vals.length > 1 ? `${vals[0]}. ${vals.slice(1).join("  ")}` : vals.join("  "));
    } else if (section === "actions") {
      if (vals.some((v) => ["지시내용", "조치내용", "내용"].includes(norm(v)))) continue;
      const v = /^\d+$/.test(vals[0]) && vals.length > 1 ? vals.slice(1) : vals;
      m.actions.push({ id: Store.uid(), text: v[0] || "", owner: v[1] || "", due: dateFromText(v[2]) || v[2] || "", done: false, note: v[3] || "" });
    } else notes.push(vals.join(" "));
  }
  m.content = content.join("\n");
  m.notes = notes.join("\n");
  m.attendees = m.attendees.trim();
  return m;
}

async function importWorkbook(file, onProgress = () => {}) {
  onProgress("엑셀 파일을 읽는 중…");
  const wb = await Xlsx.read(file);
  const p = Store.newProject(file.name.replace(/\.xlsx$/i, ""));
  p.revisions = [];
  const addBytes = (data, type, name) => Store.addFile(new Blob([data], { type }), name);
  let i = 0;
  const specSheets = [], hasSheet = { sw: false, hw: false }, unitBomSheets = [];
  for (const sheet of wb.sheets) {
    onProgress(`시트 가져오는 중 (${++i}/${wb.sheets.length}): ${sheet.name}`);
    const key = norm(sheet.name);
    const title = titleFromSheet(sheet.name);
    const date = dateFromText(sheet.name);
    const images = [], files = [];
    for (let k = 0; k < sheet.images.length; k++) {
      const img = sheet.images[k];
      if (/emf|wmf/.test(img.ext) && !sheet.embeds.length) { files.push(await addBytes(img.data, "application/x-msmetafile", `${title}_그림${k + 1}.${img.ext}`)); continue; }
      if (!img.type.startsWith("image/") || /emf|wmf/.test(img.ext)) continue;
      images.push(await addBytes(img.data, img.type, `${title}${sheet.images.length > 1 ? "_" + (k + 1) : ""}.${img.ext}`));
    }
    for (let k = 0; k < sheet.embeds.length; k++) {
      const e = sheet.embeds[k];
      files.push(await addBytes(e.data, e.type, `${title}${sheet.embeds.length > 1 ? "_" + (k + 1) : ""}.${e.ext}`));
    }
    const firstText = sheetLines(sheet).slice(0, 5).flat().map(norm);
    let numbered = null;
    if (key === "한눈에보기" || key === "bom합계") continue; // 엑셀 내보내기의 요약 시트 (다른 시트에서 다시 만들어짐)

    if (key === "revision") {
      p.revisions = readTable(sheet, LISTS.revisions.cols);
    } else if (key === "개요") {
      parseOverview(sheet, p);
    } else if (key === "일정") {
      p.schedule = parseSchedule(sheet);
    } else if (key === "sw사양") {
      p.lists.sw = readTable(sheet, SPEC_COLS, { carry: ["kind"] });
      if (!p.lists.sw.length) p.lists.sw = parseSpecDoc(sheet); // 문서형 SW 사양서
      p.swFiles = [...images, ...files];
      hasSheet.sw = true;
    } else if (key === "hw주요spec") {
      p.lists.hw = readTable(sheet, SPEC_COLS, { carry: ["kind"] });
      if (!p.lists.hw.length) p.lists.hw = parseSpecDoc(sheet);
      hasSheet.hw = true;
      p.hwImages.push(...images, ...files);
    } else if (/bom/i.test(sheet.name) && key !== "bom" && !/합계|summary|total/i.test(sheet.name) && !isOldSheet(sheet.name) && analyzePartSheet(sheet)) {
      // 설비별 BOM 시트 (BOM_AMR, 충전기 BOM …) → 설비로 나눠 넣음
      const info = analyzePartSheet(sheet);
      const qtyCell = (sheet.rows[0] || []).findIndex((v) => cellText(v) === "대수");
      unitBomSheets.push({ name: bomSheetUnitName(sheet.name) || sheet.name, qty: qtyCell >= 0 ? Number(sheet.rows[0][qtyCell + 1]) || 1 : 1,
        rows: organizeParts(readPartRows(info, info.mapping), { fillKind: false, merge: false, group: false }).rows });
    } else if (["지정품지급품", "소모품", "bom"].includes(key)) {
      const k = { 지정품지급품: "supplied", 소모품: "consumables", bom: "bom" }[key];
      p.lists[k] = dropEmptySections(readTable(sheet, PART_COLS, { carry: ["kind"] }));
    } else if (key === "제출자료") {
      p.lists.submissions = readTable(sheet, [{ key: "item", label: "자료명", alias: ["자료", "항목", "제출 자료"] }, ...LISTS.submissions.cols.slice(1)]);
      if (!p.lists.submissions.length) p.lists.submissions = submissionsFromDoc(sheet);
    } else if (key === "변경사항") {
      p.lists.changes = readTable(sheet, LISTS.changes.cols).map((r) => ({ ...r, files: [] }));
    } else if (firstText.includes("회의록")) {
      // 엑셀 Revision 시트에 이미 기록된 회의록이므로 logged, 시트 이름은 Revision 연결용으로 보관
      p.meetings.push({ ...parseMeeting(sheet, [...images, ...files]), sheetTitle: title, logged: true });
    } else if ((numbered = numberedTable(sheet))) {
      // 번호 붙은 큰 표(시험계획서 등)는 사양 표로. 날짜 시트면 자료 이력에도 남겨 Revision 과 이어지게 (메모는 짧게)
      specSheets.push({ name: title || sheet.name, rows: numbered.rows, files: [...images, ...files],
        note: [date && `${fmtDot(date)} 받은 자료`, numbered.note].filter(Boolean).join("\n") });
      if (date) p.records.push({ id: Store.uid(), date, kind: "자료", title, from: "", to: "",
        memo: `표 ${numbered.rows.length}행을 사양 '${title}' 에 등록했습니다.`, images: [], files: [] });
    } else if (isSpecSheet(sheet, date)) {
      // 날짜 시트(메일로 받은 사양서)는 캡처·원본을 첨부하고, 넣어 둔 엑셀 사양서에서 항목을 읽음
      const memo = sheetLines(sheet).map((v) => v.join("  ")).join("\n");
      const rows = date ? await embeddedSpecRows(sheet.embeds) : specRowsOf(sheet);
      const note = date ? [`${fmtDot(date)} 받은 자료`, memo].filter(Boolean).join("\n") : "";
      specSheets.push({ name: title || sheet.name, rows, files: [...images, ...files], note });
    } else {
      const memo = sheetLines(sheet).map((v) => v.join(" | ")).join("\n"); // 표 모양 행은 칸을 | 로 나눠 읽기 쉽게
      if (!images.length && !files.length && !memo) continue;
      const kind = /답변|회신/.test(title) ? "답변" : /문의|질의/.test(title) ? "문의" : "자료";
      p.records.push({ id: Store.uid(), date: date || today(), kind, title, from: "", to: "", memo, images, files });
    }
  }
  fillSubmitTo(p);
  // SW·HW 외 사양 시트는 사양 구분으로 (같은 이름이면 합침)
  const specs = ensureSpecs(p);
  if (p.swFiles) { specs[0].files.push(...p.swFiles); delete p.swFiles; }
  for (const x of specSheets) {
    const same = specs.find((sp) => norm(sp.name) === norm(x.name));
    if (same) { same.rows.push(...x.rows); same.files.push(...x.files); same.note = [same.note, x.note].filter(Boolean).join("\n"); }
    else specs.push({ id: Store.uid(), name: x.name, rows: x.rows, files: x.files, note: x.note });
  }
  // 엑셀에 없던 빈 기본 사양(SW 사양 / HW 주요 Spec)은 만들지 않음
  p.specs = specs.filter((sp, k) => k > 1 || hasSheet[k ? "hw" : "sw"] || sp.rows.length || sp.files.length || sp.note || specs.length <= 2);
  if (unitBomSheets.length) {
    const units = ensureUnits(p);
    for (const x of unitBomSheets) {
      let u = matchUnit(units, x.name);
      if (!u) { u = { id: Store.uid(), name: x.name, qty: x.qty, bom: [] }; units.push(u); }
      u.bom = u.bom.length ? [...u.bom, ...x.rows] : x.rows;
    }
    // 사업 범위에서 만든 설비 중 BOM 이 하나도 없는 빈 설비만 남았으면 그대로 둠 (대수 정보)
  }
  linkRevisions(p);
  if (!p.revisions.length) p.revisions.push({ id: Store.uid(), date: today(), author: Store.state.settings.user, content: "신규 작성", note: "" });
  p.records.sort((a, b) => a.date.localeCompare(b.date));
  p.meetings.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return p;
}

// 제출 자료의 제출처는 개요의 고객사로 채움 (비어 있는 행만)
function fillSubmitTo(p) {
  const c = p.overview.customer || "";
  if (c) p.lists.submissions.forEach((r) => { if (r.item && !r.to) r.to = c; });
}

// ------------------------------------------------------------ 엑셀 내보내기
const head = (labels) => labels.map((v) => ({ v, s: "head" }));
const cellOf = (col, v) => ({ v: col.type === "number" && v !== "" && !isNaN(v) ? Number(v) : v ?? "", s: col.type === "date" && isDate(v) ? "date" : "cell" });

async function imageEntries(ids, startRow) {
  const out = [];
  let row = startRow;
  for (const id of ids) {
    const meta = Store.fileMeta(id);
    if (!meta || !/^image\/(png|jpeg|gif)$/.test(meta.type)) continue;
    const blob = await Store.getBlob(id);
    if (!blob) continue;
    out.push({ blob, ext: meta.type.split("/")[1], row, col: 0, maxWidth: 1000 });
    try {
      const bmp = await createImageBitmap(blob);
      row += Math.ceil((bmp.height * Math.min(1, 1000 / bmp.width)) / 22) + 2;
      bmp.close();
    } catch { row += 30; }
  }
  return out;
}
const fileNames = (ids) => (ids || []).map((id) => Store.fileMeta(id)?.name).filter(Boolean).join(", ");

// 설비별 BOM 시트 + 전체 합계 시트
function unitBomSheets(p) {
  const H = (v) => ({ v, s: "th" }), T = (v) => ({ v: v ?? "", s: "cell" }), C = (v) => ({ v: v ?? "", s: "c" });
  const sheets = ensureUnits(p).map((u) => {
    const rows = [[{ v: `BOM · ${u.name}`, s: "big" }, null, null, null, null, { v: "대수", s: "label" }, { v: Number(u.qty) || 0, s: "c" }], [],
      [H("NO"), H("구분"), H("품목"), H("모델명"), H("업체명"), H("1대당 수량"), H("총 수량"), H("비고")]];
    let n = 0;
    u.bom.forEach((r) => {
      if (!isItemRow(r)) { rows.push([{ v: "", s: "sec" }, { v: r.item.replace(/^■\s*/, ""), s: "sec" }, ...Array(6).fill(0).map(() => ({ v: "", s: "sec" }))]); return; }
      const q = Number(r.qty), rowNo = rows.length + 1;
      rows.push(zebra([C(++n), T(r.kind), T(r.item), T(r.model), T(r.maker), { v: r.qty !== "" && !isNaN(q) ? q : r.qty, s: "c" },
        r.qty !== "" && !isNaN(q) ? { f: `F${rowNo}*$G$1`, v: unitTotalQty(r, u), s: "c" } : T(""), T(r.note)], n - 1));
    });
    return { name: `BOM_${u.name}`, cols: [6, 12, 24, 24, 16, 10, 9, 26], rows, heights: { 0: 28, 2: 22 }, freeze: 3, tab: "F59E0B", grid: false, landscape: true };
  });
  const { units, rows } = bomSummary(p);
  const sum = [[{ v: "BOM 전체 합계 (구매 수량)", s: "big" }], [],
    [H("NO"), H("구분"), H("품목"), H("모델명"), H("업체명"), ...units.map((u) => H(`${u.name} ×${u.qty}`)), H("총 수량"), H("비고")]];
  rows.forEach((r, i) => sum.push(zebra([C(i + 1), T(r.kind), T(r.item), T(r.model), T(r.maker),
    ...units.map((u) => ({ v: r.per[u.id] ?? "", s: "c" })), { v: r.total, s: "total" }, T(r.notes.join(" / "))], i)));
  const last = Xlsx.colName(6 + units.length);
  sheets.push({ name: "BOM 합계", cols: [6, 12, 24, 24, 16, ...units.map(() => 14), 10, 30], rows: sum, heights: { 0: 28, 2: 22 }, freeze: 3,
    filter: rows.length ? `A3:${last}${sum.length}` : "", tab: "F59E0B", grid: false, landscape: true });
  return sheets;
}

// 엑셀로 내보내기: 보기 좋게 (진한 머리글, 구역 제목, 상태 색, 머리글 고정·필터, 가로 인쇄)
// 시트 이름·글자·열 위치는 다시 불러오기(importXlsx)와 맞춰 둔다
const XL_TAB = { ov: "3B46B8", sched: "15803D", rev: "6B7280", spec: "7C3AED", part: "F59E0B", sub: "0EA5E9", chg: "DC2626", doc: "94A3B8" };
const stStyle = (v) => (/^(완료|제출|승인|수금완료|보증 중)$/.test(v) ? "ok" : /^(진행|청구)$/.test(v) ? "info" : /^(지연|반려|만료)$/.test(v) ? "bad"
  : /^(미제출|미청구|예정|시작 전|미정)$/.test(v) ? "warn" : "c");
// 긴 글(메모·회의 내용)은 한 줄에 한 행씩, 여러 열을 합친 칸에 줄바꿈해서 넣고 행 높이를 글 길이에 맞춘다
// (한 칸에 몰아넣으면 좁은 열에 세로로 길게 찌그러지거나 행 높이 한도(409)에 잘림). 다시 불러오면 행마다 한 줄로 읽힘
// 표 행 높이: 기본 20 (여유 있게), 지정한 행은 그대로
const rowHeights = (rows, fixed) => { const h = {}; rows.forEach((r, i) => { if (i > 2 && r?.length) h[i] = 20; }); return Object.assign(h, fixed); };
const textWidth = (t) => [...String(t)].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0);
function longText(rows, merges, heights, text, span, width, style = "wrap") {
  for (const line of String(text || "").split("\n")) {
    const r = rows.length;
    rows.push([{ v: line, s: style }, ...Array(span - 1).fill(0).map(() => ({ v: "", s: style }))]);
    if (span > 1) merges.push(`A${r + 1}:${Xlsx.colName(span - 1)}${r + 1}`);
    heights[r] = Math.min(409, Math.max(1, Math.ceil(textWidth(line) / (width * 0.95))) * 15 + 4);
  }
}
// 엑셀 내보내기 첫 시트 '한눈에 보기': 핵심 숫자 카드 · 일정 현황 · 주요 일자 · 할 일 · 최근 자료 (다시 불러올 때는 건너뜀)
function dashboardSheet(p) {
  const o = p.overview, c = contractInfo(p), kd = keyDates(p), sm = projectSummary(p), st = scheduleStatus(p);
  const base = today(), infos = scheduleInfos(p.schedule, base);
  const rows = [], merges = [], heights = {};
  const E = (s = "cell") => ({ v: "", s });
  const put = (cells) => { rows.push([null, ...cells]); return rows.length; }; // A열은 여백
  const span = (r, c1, c2) => merges.push(`${Xlsx.colName(c1)}${r}:${Xlsx.colName(c2)}${r}`);
  const fill = (v, s, n) => [{ v, s }, ...Array(n - 1).fill(0).map(() => E(s))];
  // 제목
  let r = put(fill(o.name || "프로젝트", "big", 8)); span(r, 1, 8); heights[r - 1] = 32;
  r = put(fill([o.customer, o.project, o.manager && `담당 ${o.manager}`, `상태 ${o.status || "-"}`, `출력일 ${fmtDot(base)}`].filter(Boolean).join("  ·  "), "note", 8)); span(r, 1, 8);
  rows.push([]);
  // 핵심 숫자 카드 4개 (2칸씩)
  const cards = [
    ["발주금액", c.amount || "-", "kpi", c.amount ? `부가세 ${o.vat || "별도"}` : "발주금액 미입력"],
    ["실행가 합계", c.actualCost ? c.totalCost : "-", "kpi", c.actualCost ? "실행가 + 인건비 + 재경비 + 워런티비" : "실행가 미입력"],
    ["이익", c.totalProfit ?? "-", c.totalProfit == null ? "kpi" : c.totalProfit < 0 ? "kpiBad" : "kpiOk", c.totalProfit != null ? `이익률 ${(c.totalRate * 100).toFixed(1)}%` : "발주금액 · 실행가 필요"],
    ["정산 (수금률)", c.payments.length ? `${c.paidRatio}%` : "-", c.paidRatio === 100 ? "kpiOk" : "kpi", c.payments.length ? `수금 ${fmtWon(c.paidAmount) || "0원"} · 미수 ${fmtWon(c.amount - c.paidAmount) || "0원"}` : "정산 비율 미입력"]];
  for (const [k, sty] of [[0, "kpiL"], [1, null], [3, "kpiS"]]) {
    r = put(cards.flatMap((cd) => fill(k === 0 ? cd[0] : k === 1 ? cd[1] : cd[3], sty || cd[2], 2)));
    for (let q = 0; q < 4; q++) span(r, 1 + q * 2, 2 + q * 2);
    heights[r - 1] = k === 1 ? 36 : k === 0 ? 20 : 30;
  }
  rows.push([]);
  const sec = (t) => { const rr = put(fill(t, "sec", 8)); heights[rr - 1] = 22; };
  const pair = (l1, v1, l2, v2, s1 = "cell", s2 = "cell") => {
    const rr = l2 == null ? put([{ v: l1, s: "label" }, { v: v1, s: s1 }, ...Array(6).fill(0).map(() => E(s1))])
      : put([{ v: l1, s: "label" }, { v: v1, s: s1 }, E(s1), E(s1), { v: l2, s: "label" }, { v: v2, s: s2 }, E(s2), E(s2)]);
    if (l2 == null) span(rr, 2, 8); else { span(rr, 2, 4); span(rr, 6, 8); }
    heights[rr - 1] = 20;
  };
  // 일정 현황
  sec("■ 일정 현황");
  const dated = infos.filter((x, k) => isDate(p.schedule[k].start));
  const done = dated.filter((x) => x.status === "완료").length, pct = dated.length ? Math.round((done / dated.length) * 100) : 0;
  pair("진행 상태", st.text || "-", "완료한 일정", dated.length ? `${done} / ${dated.length}건 (${pct}%)` : "-", stStyle(st.st || "") === "c" ? "cell" : stStyle(st.st || ""));
  pair("프로젝트 기간", sm.start ? `${fmtDot(sm.start)} ~ ${fmtDot(sm.end)}` : "-", "지연", `${sm.delayed.length}건`, "cell", sm.delayed.length ? "bad" : "ok");
  pair("다음 일정", sm.next ? `${sm.next.phase ? sm.next.phase + " · " : ""}${sm.next.name} (${fmtDot(sm.next.start)})` : "-");
  // 완료율 막대 (7칸)
  r = put([{ v: `완료율 ${pct}%`, s: "label" }, ...Array(7).fill(0).map((_, q) => E(q < Math.round((pct / 100) * 7) ? "gOk" : "gEmpty"))]); heights[r - 1] = 18;
  rows.push([]);
  // 주요 일자
  sec("■ 주요 일자");
  const d = (x) => (isDate(x) ? fmtDot(x) : "-");
  pair("Kick Off", d(kd.kickoffDate.value), "납품일", d(kd.receiveDate.value));
  pair("Setup 완료", d(kd.setupDate.value), "지급 완료", d(kd.paidDate.value), isDate(kd.setupDate.value) ? "ok" : "cell", isDate(kd.paidDate.value) ? "ok" : "cell");
  pair("Warranty", [kd.warranty.text, kd.warranty.state].filter(Boolean).join(" · ") || "-");
  rows.push([]);
  // 할 일
  sec("■ 할 일  (미완료 실천 의제 · 미제출 자료)");
  r = put([{ v: "구분", s: "th" }, { v: "내용", s: "th" }, E("th"), E("th"), E("th"), { v: "담당 / 제출처", s: "th" }, E("th"), { v: "기한", s: "th" }]);
  span(r, 2, 5); span(r, 6, 7); heights[r - 1] = 22;
  const todo = [...sm.openActions.map((a) => ["실천 의제", a.text, a.owner, a.due]), ...sm.pendingSubmissions.map((x) => ["제출 자료", x.item, x.to, ""])].slice(0, 12);
  if (!todo.length) { r = put(fill("남은 할 일이 없습니다", "c", 8)); span(r, 1, 8); }
  todo.forEach((t, i) => {
    r = put(zebra([{ v: t[0], s: "c" }, { v: t[1], s: "cell" }, E(), E(), E(), { v: t[2] || "", s: "c" }, E("c"), { v: t[3] || "", s: isDate(t[3]) ? "date" : "c" }], i));
    span(r, 2, 5); span(r, 6, 7); heights[r - 1] = 20;
  });
  rows.push([]);
  // 최근 자료 이력
  sec("■ 최근 자료 이력");
  r = put([{ v: "날짜", s: "th" }, { v: "제목", s: "th" }, E("th"), E("th"), E("th"), { v: "구분", s: "th" }, { v: "보낸 곳", s: "th" }, E("th")]);
  span(r, 2, 5); span(r, 7, 8); heights[r - 1] = 22;
  const recent = [...p.records].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  if (!recent.length) { r = put(fill("자료 이력이 없습니다", "c", 8)); span(r, 1, 8); }
  recent.forEach((x, i) => {
    r = put(zebra([{ v: x.date, s: "date" }, { v: x.title, s: "cell" }, E(), E(), E(), { v: x.kind, s: "c" }, { v: x.from || "", s: "c" }, E("c")], i));
    span(r, 2, 5); span(r, 7, 8); heights[r - 1] = 20;
  });
  return { name: "한눈에 보기", cols: [2, 14, 14, 14, 14, 14, 14, 14, 14], rows, merges, heights, tab: "111827", grid: false, fit: true };
}

// 짝수 행 줄무늬
const ZEBRA = { cell: "cellZ", c: "cZ", date: "dateZ", money: "moneyZ" };
const zebra = (row, i) => (i % 2 ? row.map((c) => (c && typeof c === "object" && ZEBRA[c.s] ? { ...c, s: ZEBRA[c.s] } : c)) : row);
async function buildWorkbook(p) {
  const sheets = [];
  const th = (labels) => labels.map((v) => ({ v, s: "th" }));
  const table = (key, title, tab) => {
    const def = LISTS[key];
    const rows = [[{ v: title || def.title, s: "big" }], [], th(["NO", ...def.cols.map((c) => c.label), ...(def.files ? ["첨부 파일"] : [])])];
    listRows(p, key).forEach((r, i) => rows.push(zebra([{ v: i + 1, s: "c" }, ...def.cols.map((c) => c.key === "status" ? { v: r[c.key] || "", s: stStyle(r[c.key] || "") }
      : c.type === "date" && isDate(r[c.key]) ? { v: r[c.key], s: "date" } : cellOf(c, r[c.key])),
      ...(def.files ? [{ v: fileNames(r.files), s: "cell" }] : [])], i)));
    const last = Xlsx.colName(def.cols.length + (def.files ? 1 : 0));
    return { name: def.sheet, cols: [6, ...def.cols.map((c) => c.w), ...(def.files ? [30] : [])], rows, heights: rowHeights(rows, { 0: 28, 2: 24 }),
      freeze: 3, filter: rows.length > 3 ? `A3:${last}${rows.length}` : "", tab, grid: false, landscape: true };
  };

  sheets.push(dashboardSheet(p));

  // ── 개요: 구역별 (프로젝트 개요 · 주요 일자 · 계약 · 정산 · 정산 단계)
  const ov = p.overview, kdx = keyDates(p), ci = contractInfo(p);
  const L = (v) => ({ v, s: "label" }), V = (v, st = "cell") => ({ v: v ?? "", s: st }), N = (v = "") => ({ v, s: "cell" });
  const sec = (t) => [{ v: t, s: "sec" }, { v: "", s: "sec" }, { v: "", s: "sec" }];
  const won = (n) => (n ? { v: n, s: "moneyL" } : V(""));
  const ovRows = [[{ v: `설비/품목명: ${ov.name}`, s: "big" }], [{ v: `${ov.customer || ""}${ov.customer ? " · " : ""}${ov.project || ""} · 출력일 ${today()}`, s: "note" }],
    th(["분류", "항목", "비고"]), sec("■ 프로젝트 개요")];
  for (const [k, label] of OVERVIEW_FIELDS) ovRows.push([L(label), V(ov[k] || "", k === "scope" || k === "note" ? "wrap" : "cell"), N()]);
  for (const x of ov.extra) ovRows.push([L(x.label), V(x.value), N()]);
  ovRows.push([L("상태"), V(ov.status, stStyle(ov.status) === "c" ? "cell" : stStyle(ov.status)), N()], [L("담당자"), V(ov.manager), N()]);
  ovRows.push(sec("■ 주요 일자 · Warranty"));
  for (const [k, label] of KEY_DATES.filter(([k]) => k !== "receiveDate")) ovRows.push([L(label), V(kdx[k].value, kdx[k].value ? "dateL" : "cell"), V(kdx[k].auto ? "자동" : "", "rem")]);
  ovRows.push([L("Warranty 기간"), V(kdx.warranty.text), V(kdx.warranty.state, kdx.warranty.state ? stStyle(kdx.warranty.state) : "cell")]);
  ovRows.push(sec("■ 계약 · 정산"),
    [L("발주일"), V(ov.orderDate || "", ov.orderDate ? "dateL" : "cell"), V(ov.vat ? `부가세 ${ov.vat}` : "", "rem")],
    [L("발주금액"), won(ci.amount), V(ci.amount ? `금 ${koreanAmount(ci.amount)}원정` : "", "rem")],
    [L("실행 예가"), won(ci.estimateCost), V(ci.estProfit != null ? `예상 이익 (실행 예가 − 실행가) ${fmtWon(ci.estProfit)} (${(ci.estRate * 100).toFixed(1)}%)` : "", "rem")],
    [L("실행목표가"), won(ci.targetCost), V(ci.targetProfit != null ? `목표 이익 (실행목표가 − 실행가) ${fmtWon(ci.targetProfit)} (${(ci.targetRate * 100).toFixed(1)}%)` : "", "rem")],
    [L("실행가"), won(ci.actualCost), N()],
    [L("인건비"), won(ci.labor), V([ci.mdTotal && `${ci.mdText} = ${ci.mdTotal} M/D`, ci.mdRate && `단가 ${fmtWon(ci.mdRate)}`].filter(Boolean).join(" · "), "rem")],
    [L("재경비"), won(ci.overhead), V(ci.overheadRate ? `(실행가 + 인건비) × ${ci.overheadRate}%` : "", "rem")],
    [L("워런티비"), won(ci.warrantyCost), V(ci.warrantyRate ? `(실행가 + 인건비) × ${ci.warrantyRate}%` : "", "rem")],
    // 이익은 따로 행을 만들지 않고 실행가 합계 옆에 (다시 불러올 때 추가 항목이 늘지 않도록)
    [L("실행가 합계"), ci.totalCost ? { v: ci.totalCost, s: "total" } : V(""),
      ci.totalProfit != null ? V(`이익 ${ci.totalProfit < 0 ? "−" : ""}${fmtWon(Math.abs(ci.totalProfit))} (${(ci.totalRate * 100).toFixed(1)}%) = 발주금액 − 실행가 합계`, ci.totalProfit < 0 ? "bad" : "ok")
        : V("실행가 + 인건비 + 재경비 + 워런티비", "rem")]);
  if (ci.payments.length) {
    ovRows.push(sec(`■ 정산 단계 (정산 완료 ${ci.paidRatio}%)`));
    for (const x of ci.payments) ovRows.push([L(`정산: ${x.name}`), V([`${x.ratio}%`, fmtWon(x.amount), x.cond].filter(Boolean).join(" · ")),
      V([x.status, x.paidDate].filter(Boolean).join(" "), stStyle(x.status || ""))]);
  }
  sheets.push({ name: "개요", cols: [18, 60, 44], rows: ovRows, heights: { 0: 30, 2: 22 }, freeze: 3, tab: XL_TAB.ov, grid: false, fit: true });

  // ── 일정: 표 + 아래에 일정표(간트, 시간이 옆으로). 세부사항 오른쪽은 좁은 같은 너비 칸 T개로 나누고
  //    위 표의 칸과 아래 일정표의 기간 칸이 모두 이 T칸을 꽉 채우도록 맞춤 (오른쪽 끝이 같음).
  //    단계 이름은 단계의 첫 줄에만 (다시 불러올 때 아래로 이어짐)
  const base = today(), b0 = dayNo(base);
  const infos = scheduleInfos(p.schedule, base);
  // 일정표 기간 칸: 전체 기간에 따라 하루 / 한 주(월요일 시작) / 한 달
  const datedTasks = p.schedule.filter((t) => isDate(t.start));
  const periods = [];
  let unit = "week";
  if (datedTasks.length) {
    const starts = datedTasks.map((t) => dayNo(t.start)), ends = datedTasks.map((t) => dayNo(isDate(t.end) ? t.end : t.start));
    const lo = Math.min(...starts, b0), hi = Math.max(...ends, b0);
    unit = hi - lo + 1 <= 45 ? "day" : (hi - lo) / 7 <= 70 ? "week" : "month";
    const fromNo = (n) => new Date(Date.UTC(1970, 0, 1) + n * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    if (unit === "day") for (let n = lo; n <= hi; n++) periods.push({ s: n, e: n, d: fromNo(n) });
    else if (unit === "week") {
      let n = lo - ((fromNo(lo).getUTCDay() + 6) % 7); // 그 주 월요일
      for (; n <= hi; n += 7) periods.push({ s: n, e: n + 6, d: fromNo(n) });
    } else {
      let d = new Date(Date.UTC(fromNo(lo).getUTCFullYear(), fromNo(lo).getUTCMonth(), 1));
      while (dayNo(iso(d)) <= hi) { const nx = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)); periods.push({ s: dayNo(iso(d)), e: dayNo(iso(nx)) - 1, d }); d = nx; }
    }
  }
  // 칸 수: 기간 칸 하나가 k칸, 모두 T = k × 기간 수 (표가 너무 좁지 않게 최소 36칸)
  const P = periods.length, k = P ? Math.max(1, Math.ceil(36 / P)) : 1, T = P ? k * P : 36;
  const WEIGHT = [["비고", 8], ["담당자", 4], ["시작일", 5], ["종료일", 5], ["기간", 3], ["경과일", 3], ["잔여일", 3], ["상태", 5]];
  const SPAN = WEIGHT.map(([l, w]) => [l, Math.max(2, Math.floor((w * T) / 36))]);
  SPAN[0][1] += T - SPAN.reduce((a, [, w]) => a + w, 0); // 남는 칸은 비고에
  const C0 = 2, colOf = (c) => Xlsx.colName(c), lastCol = colOf(C0 + T - 1);
  const sRows = [], sMerges = [];
  const fullRow = (first, style) => [first, ...Array(C0 + T - 1).fill(0).map(() => ({ v: "", s: style }))];
  const spanRow = (a, b2, cells) => {
    const row = [a, b2], r = sRows.length + 1;
    let c = C0;
    cells.forEach((cell, q) => {
      const w = SPAN[q][1];
      row.push(cell, ...Array(w - 1).fill(0).map(() => ({ v: "", s: cell?.s || "cell" })));
      if (w > 1) sMerges.push(`${colOf(c)}${r}:${colOf(c + w - 1)}${r}`);
      c += w;
    });
    sRows.push(row);
  };
  // 제목 줄: 오른쪽 끝(상태 칸 자리)에 기준일
  const title = [{ v: "일정", s: "big" }];
  const stW = SPAN[7][1], remW = SPAN[6][1], cDate = C0 + T - stW, cLab = cDate - remW;
  for (let c = 1; c < C0 + T; c++) title.push(c === cLab ? { v: "기준일", s: "label" } : c > cLab && c < cDate ? { v: "", s: "label" }
    : c === cDate ? { v: base, s: "date" } : c > cDate ? { v: "", s: "date" } : null);
  sRows.push(title);
  if (remW > 1) sMerges.push(`${colOf(cLab)}1:${colOf(cDate - 1)}1`);
  if (stW > 1) sMerges.push(`${colOf(cDate)}1:${lastCol}1`);
  sRows.push([]);
  spanRow({ v: "단계", s: "th" }, { v: "세부사항", s: "th" }, SPAN.map(([l]) => ({ v: l, s: "th" })));
  let prevPhase = null;
  for (const [n, t] of p.schedule.entries()) {
    const info = infos[n], first = t.phase !== prevPhase;
    prevPhase = t.phase;
    const zi = n;
    spanRow({ v: first ? t.phase : "", s: first ? "label" : "cell" }, { v: t.name, s: "cell" },
      [{ v: t.note, s: "cell" }, { v: t.owner, s: "c" }, { v: t.start, s: "date" }, { v: t.end, s: "date" },
        { v: info.dur, s: "c" }, { v: info.elapsed, s: "c" }, { v: info.remain, s: "c" }, { v: info.status, s: stStyle(info.status) }]);
    sRows[sRows.length - 1] = zebra(sRows[sRows.length - 1], zi);
  }
  let ganttRow = 0;
  if (P) {
    const nowIdx = periods.findIndex((x) => b0 >= x.s && b0 <= x.e);
    sRows.push([]);
    ganttRow = sRows.length; // 인쇄할 때 일정표는 새 쪽에서
    sRows.push(fullRow({ v: `■ 일정표 (${unit === "day" ? "하루" : unit === "week" ? "주" : "월"} 단위 · 오늘 ${fmtDot(base)})`, s: "sec" }, "sec"));
    // 머리글 1: 년·월 (같은 달은 합침), 머리글 2: 날짜(일) 또는 월 — 기간 칸 하나 = k칸 합침
    const rTop = sRows.length + 1;
    const top = [{ v: "단계", s: "th" }, { v: "세부사항", s: "th" }], sub = [{ v: "", s: "th" }, { v: "", s: "th" }];
    let q = 0;
    const keyOf = (x) => (unit === "month" ? `${x.d.getUTCFullYear()}` : `${x.d.getUTCFullYear()}.${x.d.getUTCMonth() + 1}`);
    while (q < P) {
      let m = q;
      while (m + 1 < P && keyOf(periods[m + 1]) === keyOf(periods[q])) m++;
      const [yy, mm] = keyOf(periods[q]).split(".").map(Number), wide = (m - q + 1) * k > 2;
      top.push({ v: unit === "month" ? `${yy}년` : (q === 0 || mm === 1) && wide ? `${yy}년 ${mm}월` : `${mm}월`, s: "th" });
      for (let z = 1; z < (m - q + 1) * k; z++) top.push({ v: "", s: "th" });
      if ((m - q + 1) * k > 1) sMerges.push(`${colOf(C0 + q * k)}${rTop}:${colOf(C0 + (m + 1) * k - 1)}${rTop}`);
      q = m + 1;
    }
    periods.forEach((x, z) => {
      const st = z === nowIdx ? "bad" : "gHead";
      sub.push({ v: unit === "month" ? `${x.d.getUTCMonth() + 1}월` : String(x.d.getUTCDate()), s: st }, ...Array(k - 1).fill(0).map(() => ({ v: "", s: st })));
      if (k > 1) sMerges.push(`${colOf(C0 + z * k)}${rTop + 1}:${colOf(C0 + z * k + k - 1)}${rTop + 1}`);
    });
    sMerges.push(`A${rTop}:A${rTop + 1}`, `B${rTop}:B${rTop + 1}`);
    sRows.push(top, sub);
    prevPhase = null;
    for (const [n, t] of p.schedule.entries()) {
      const info = infos[n], first = t.phase !== prevPhase;
      prevPhase = t.phase;
      const s0 = isDate(t.start) ? dayNo(t.start) : null, e0 = isDate(t.end) ? dayNo(t.end) : s0;
      const bar = { 완료: "gOk", 진행: "gInfo", 지연: "gBad" }[info.status] || "gPlan";
      const cells = [];
      periods.forEach((x, z) => {
        const on = s0 != null && s0 <= x.e && e0 >= x.s;
        // 한 기간이 여러 칸이면 안쪽 세로선 없이 (기간 경계에만 선)
        for (let y = 0; y < k; y++) cells.push(on ? { v: "", s: bar } : { v: z === 0 && y === 0 && s0 == null ? "날짜 미정" : "",
          s: k === 1 ? (z === nowIdx ? "gNow" : "gEmpty") : y === 0 ? (z === nowIdx ? "gNowL" : "gEL") : z === nowIdx ? "gNowIn" : "gIn" });
      });
      sRows.push([{ v: first ? t.phase : "", s: first ? "label" : "cell" }, { v: t.name, s: "cell" }, ...cells]);
    }
    // 색 설명 (오른쪽 끝에 맞춰)
    const legend = [["gOk", "완료"], ["gInfo", "진행"], ["gBad", "지연"], ["gPlan", "예정"], ["gNow", "오늘"]];
    const lg = fullRow({ v: "막대 색", s: "note" }, "note");
    let c = C0 + T - legend.length * 4;
    for (const [st, l] of legend) { lg[c] = { v: "", s: st }; lg[c + 1] = { v: l, s: "note" }; c += 4; }
    sRows.push([], lg);
  }
  const narrow = Math.min(3.3, Math.max(1.2, 120 / T));
  sheets.push({ name: "일정", cols: [16, 30, ...Array(T).fill(narrow)], rows: sRows, merges: sMerges,
    heights: { 0: 28, 2: 22 }, freeze: 3, freezeCols: 2, tab: XL_TAB.sched, grid: false, landscape: true, breaks: ganttRow ? [ganttRow] : [] });

  sheets.push(table("revisions", "Revision", XL_TAB.rev));

  // ── 사양: 머리글이 맨 위 (다시 불러올 때 표로 인식)
  for (const sp of ensureSpecs(p)) {
    const rows = [th(["NO", ...SPEC_COLS.map((c) => c.label)])];
    sp.rows.forEach((r, i) => rows.push(/^■/.test(r.item || "") && !r.content
      ? [{ v: "", s: "sec" }, ...SPEC_COLS.map((c) => ({ v: c.key === "item" ? r.item : r[c.key] || "", s: "sec" }))]
      : zebra([{ v: i + 1, s: "c" }, ...SPEC_COLS.map((c) => cellOf(c, r[c.key]))], i)));
    // 메모는 한 줄에 한 행 (합치지 않고 옆 빈 칸으로 흘러 보이게 — 합치면 다시 불러올 때 사양 항목으로 읽힘)
    if (sp.note) rows.push([], ...sp.note.split("\n").map((line) => [line]));
    const fileList = fileNames(sp.files.filter((id) => !Store.fileMeta(id)?.type.startsWith("image/")));
    if (fileList) rows.push([], [{ v: `첨부 파일: ${fileList}`, s: "note" }]);
    sheets.push({ name: sp.name, cols: [6, ...SPEC_COLS.map((c) => c.w)], rows, heights: { 0: 22 }, freeze: 1, tab: XL_TAB.spec, grid: false, landscape: true,
      images: await imageEntries(sp.files, rows.length + 1) });
  }
  sheets.push(table("supplied", "지정품/지급품", XL_TAB.part), table("consumables", "소모품", XL_TAB.part), ...unitBomSheets(p),
    table("submissions", "제출 자료", XL_TAB.sub), table("changes", "변경사항", XL_TAB.chg));

  // ── 자료 이력 · 회의록 (날짜순)
  const dated = [
    ...p.records.map((r) => ({ date: r.date, kind: "record", r })),
    ...p.meetings.map((m) => ({ date: m.date, kind: "meeting", m })),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  for (const x of dated) {
    if (x.kind === "record") {
      const r = x.r;
      const rows = [[{ v: r.title, s: "big" }], [],
        [L("날짜"), { v: r.date, s: "dateL" }], [L("구분"), V(r.kind)],
        [L("보낸 곳"), V(r.from)], [L("받는 곳"), V(r.to)],
        [L("첨부 파일"), V(fileNames(r.files))]];
      const merges = [], heights = { 0: 28 };
      if (r.memo) { rows.push([]); longText(rows, merges, heights, r.memo, 2, 104); }
      const images = await imageEntries(r.images, rows.length + 1);
      sheets.push({ name: `${r.title}(${fmtDot(r.date)})`, cols: [14, 90], rows, merges, heights, tab: XL_TAB.doc, grid: false, fit: true, images });
    } else {
      const m = x.m;
      const rows = [[{ v: "회     의     록", s: "big" }], [],
        [L("부 서 명"), V(m.dept), L("작 성 자"), V(m.writer)],
        [L("회의일자"), { v: m.date, s: "dateL" }, L("회의장소"), V(m.place)],
        [L("회의시간"), V(m.time), L("구분"), V(m.kind)],
        [L("제   목"), V(m.title), V(""), V("")],
        [L("참 석 자"), V(m.attendees), V(""), V("")],
        [], [{ v: "회 의 내 용", s: "sec" }, { v: "", s: "sec" }, { v: "", s: "sec" }, { v: "", s: "sec" }]];
      const merges = ["A1:D1", "B6:D6", "B7:D7", "A9:D9"], heights = { 0: 30 };
      longText(rows, merges, heights, m.content, 4, 124);
      rows.push([], [{ v: "실천 의제", s: "sec" }, { v: "", s: "sec" }, { v: "", s: "sec" }, { v: "", s: "sec" }], th(["지시 내용", "담당자", "기한", "완료"]));
      for (const a of m.actions) rows.push([V(a.text), { v: a.owner, s: "c" }, { v: a.due, s: isDate(a.due) ? "date" : "c" }, { v: a.done ? "완료" : "", s: a.done ? "ok" : "c" }]);
      rows.push([], [L("특이사항"), V(m.notes), V(""), V("")]);
      merges.push(`B${rows.length}:D${rows.length}`);
      if (m.files?.length) rows.push([L("첨부 파일"), V(fileNames(m.files))]);
      const images = await imageEntries(m.files || [], rows.length + 1);
      sheets.push({ name: `${m.title}(${fmtDot(m.date)})`, cols: [40, 30, 14, 40], rows, merges, heights,
        tab: XL_TAB.doc, grid: false, fit: true, images });
    }
  }
  return Xlsx.write(sheets);
}

// 프로젝트 전체(엑셀 + 첨부 원본 파일)를 폴더 구조의 ZIP 으로
async function buildProjectZip(p) {
  const safe = (s) => String(s || "").replace(/[\\/:*?"<>|]/g, "_").trim() || "자료";
  const root = `${safe(p.overview.name)}_${today()}`;
  const files = [{ name: `${root}/${safe(p.overview.name)}.xlsx`, data: await buildWorkbook(p), compress: false }];
  const usedNames = new Set();
  const add = async (folder, ids) => {
    for (const id of ids || []) {
      const meta = Store.fileMeta(id);
      const blob = meta && (await Store.getBlob(id));
      if (!blob) continue;
      let name = `${root}/첨부/${safe(folder)}/${safe(meta.name)}`;
      for (let i = 2; usedNames.has(name); i++) name = name.replace(/(\.[^./]+)?$/, ` (${i})$1`);
      usedNames.add(name);
      files.push({ name, data: blob, compress: !/^image\//.test(meta.type) });
    }
  };
  for (const r of p.records) await add(`${fmtDot(r.date)}_${r.title}`, [...r.images, ...r.files]);
  for (const m of p.meetings) await add(`${fmtDot(m.date)}_${m.title}`, m.files);
  for (const sp of ensureSpecs(p)) await add(sp.name, sp.files);
  for (const [key, ids] of Object.entries(p.listFiles || {})) {
    const title = key.startsWith("unit:") ? `BOM_${findUnit(p, key)?.name || "설비"}` : LISTS[key]?.title || key;
    await add(`${title}_원본`, ids);
  }
  for (const key of ["submissions", "changes"]) for (const r of p.lists[key]) await add(`${LISTS[key].title}_${r.item || r.content || ""}`.slice(0, 60), r.files);
  return Zip.write(files);
}

// ------------------------------------------------------- BOM 엑셀 가져오기·자동 정리
// 업체마다 다른 머리글 이름을 같은 열로 인식하기 위한 별칭 (정확히 같거나, 포함 단어)
const PART_FIELDS = [
  { key: "no", exact: ["no", "번호", "순번", "순서", "sl", "slno", "sno"] },
  { key: "kind", exact: ["구분", "분류", "category", "type", "group", "파트", "유닛", "unit", "대분류"] },
  { key: "item", exact: ["품목", "품목명", "품명", "부품명", "자재명", "item", "itemname", "part", "partname", "name", "description", "명칭"], has: ["품목", "item", "품명"] },
  { key: "model", exact: ["모델명", "모델", "model", "spec", "규격", "사양", "partno", "pn", "형번", "형식", "specification", "type no"], has: ["모델", "model", "spec", "규격", "partno"] },
  { key: "maker", exact: ["업체명", "업체", "maker", "제조사", "메이커", "vendor", "manufacturer", "brand", "제조업체", "공급사"], has: ["maker", "업체", "제조사", "메이커", "vendor", "manufacturer"] },
  { key: "qty", exact: ["개수", "수량", "qty", "quantity", "ea", "소요량", "q'ty"], has: ["수량", "qty", "quantity"] },
  { key: "note", exact: ["비고", "remark", "remarks", "note", "notes", "참고", "comment", "memo"], has: ["비고", "remark"] },
];
const partFieldOf = (label) => {
  const n = norm(label).replace(/'/g, "");
  if (!n) return null;
  const f = PART_FIELDS.find((x) => x.exact.some((a) => norm(a).replace(/'/g, "") === n))
    || PART_FIELDS.find((x) => (x.has || []).some((a) => n.includes(norm(a))));
  return f ? f.key : null;
};

// 시트에서 머리글 행을 찾아 열 목록과 자동 매핑을 만든다
function analyzePartSheet(sheet) {
  const rows = filledRows(sheet);
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 40); r++) {
    const mapping = {};
    (rows[r] || []).forEach((v, c) => {
      const k = partFieldOf(v);
      if (k && !(k in mapping)) mapping[k] = c;
    });
    const score = Object.keys(mapping).length;
    if ((mapping.item != null || mapping.model != null) && score >= 2 && (!best || score > best.score)) best = { row: r, mapping, score };
  }
  if (!best) return null;
  const columns = [];
  (rows[best.row] || []).forEach((v, c) => {
    const label = cellText(v);
    if (label && !columns.some((x) => x.c === c)) columns.push({ c, label });
  });
  // 머리글 바로 위의 짧은 글자 한 칸(예: "본체부", "Main Unit")은 첫 소제목으로 사용
  let section = "";
  for (let r = best.row - 1; r >= 0 && r >= best.row - 3; r--) {
    const vals = [...new Set((rows[r] || []).map(cellText).filter(Boolean))];
    if (vals.length >= 1 && vals.length <= 2 && vals.every((v) => v.length <= 20)) { section = vals[vals.length - 1]; break; }
  }
  return { headerRow: best.row, mapping: best.mapping, columns, section, rows };
}

// 매핑대로 행을 읽는다. 소제목 행은 { section } 으로 돌려준다.
function readPartRows(info, mapping, { extraToNote = true } = {}) {
  const out = [];
  if (info.section) out.push({ section: info.section });
  const header = info.rows[info.headerRow] || [];
  const used = new Set(Object.values(mapping).filter((c) => c !== "" && c != null).map(Number));
  const extras = info.columns.filter((x) => !used.has(x.c));
  // 계산식 결과 같은 긴 소수는 소수 둘째 자리까지
  const val = (v) => (typeof v === "number" && !Number.isInteger(v) ? String(Math.round(v * 100) / 100) : cellText(v));
  const get = (row, k) => (mapping[k] === "" || mapping[k] == null ? "" : val(row[Number(mapping[k])]));
  for (let r = info.headerRow + 1; r < info.rows.length; r++) {
    const row = info.rows[r] || [];
    const texts = [...new Set(row.map(cellText).filter(Boolean))];
    if (!texts.length) continue;
    // 머리글 반복 행
    if (texts.length > 1 && row.every((v, c) => !cellText(v) || norm(v) === norm(header[c]))) continue;
    const rec = { kind: get(row, "kind"), item: get(row, "item"), model: get(row, "model"), maker: get(row, "maker"),
      qty: get(row, "qty"), note: get(row, "note") };
    if (!rec.item && !rec.model && !rec.maker && !rec.qty) {
      // 번호만 있는 빈 양식 행은 건너뛰고, 글자가 있으면 소제목으로 본다
      const label = texts.find((t) => !/^\d+$/.test(t));
      if (label && texts.length <= 2) out.push({ section: label });
      continue;
    }
    if (extraToNote) {
      const add = extras.map((x) => [x.label, val(row[x.c])]).filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`);
      if (add.length) rec.note = [rec.note, ...add].filter(Boolean).join(" / ");
    }
    out.push(rec);
  }
  return out;
}

// 자동 정리: 공백 정리, 소제목으로 빈 구분 채우기, 중복 합치기(수량 합산), 구분별로 모으기
function organizeParts(input, { fillKind = true, merge = true, group = true } = {}) {
  const stats = { before: 0, merged: 0, filled: 0, removed: 0 };
  const clean = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
  // 소제목 단위로 나눠서 각 묶음 안에서 정리한다
  const blocks = [{ section: "", rows: [] }];
  for (const r of input) {
    const sec = r.section ?? (/^■\s*/.test(r.item || "") && !r.model && !r.maker && !r.qty ? r.item.replace(/^■\s*/, "") : null);
    if (sec != null) { blocks.push({ section: clean(sec), rows: [] }); continue; }
    stats.before++;
    const rec = { id: r.id || Store.uid() };
    for (const c of PART_COLS) rec[c.key] = clean(r[c.key]);
    if (!rec.item && !rec.model && !rec.maker && !rec.qty && !rec.note) { stats.removed++; continue; }
    if (fillKind && !rec.kind && blocks[blocks.length - 1].section) { rec.kind = blocks[blocks.length - 1].section; stats.filled++; }
    blocks[blocks.length - 1].rows.push(rec);
  }
  const out = [];
  for (const b of blocks) {
    let rows = b.rows;
    if (merge) {
      const seen = new Map(), kept = [];
      for (const r of rows) {
        const key = [r.kind, r.item, r.model, r.maker].map((v) => norm(v)).join("|");
        const prev = (r.item || r.model) && seen.get(key);
        if (!prev) { seen.set(key, r); kept.push(r); continue; }
        stats.merged++;
        const a = Number(prev.qty || 0), q = Number(r.qty || 0);
        if (!isNaN(a) && !isNaN(q) && (prev.qty || r.qty)) prev.qty = String(a + q);
        if (r.note && !prev.note.split(" / ").includes(r.note)) prev.note = [prev.note, r.note].filter(Boolean).join(" / ");
      }
      rows = kept;
    }
    if (group) {
      const order = [];
      rows.forEach((r) => !order.includes(r.kind) && order.push(r.kind));
      rows = order.flatMap((k) => rows.filter((r) => r.kind === k));
    }
    if (!b.rows.length && !b.section) continue;
    if (b.section) {
      const sec = { id: Store.uid() };
      PART_COLS.forEach((c) => (sec[c.key] = ""));
      sec.item = `■ ${b.section}`;
      out.push(sec);
    }
    out.push(...rows);
  }
  stats.after = out.filter((r) => !/^■/.test(r.item)).length;
  return { rows: out, stats };
}

// ------------------------------------------------------------- 계약·정산
const PAYMENT_STATUSES = ["미청구", "청구", "수금완료"];
// 기본 정산 비율 (사용자가 저장한 비율은 설정의 payPresets 에 추가로 보관)
const PAYMENT_PRESETS = [
  ["30 : 60 : 10", [["선금", 30, "발주 후"], ["중도금", 60, "납품 후"], ["잔금", 10, "Setup·검수 후"]]],
  ["30 : 40 : 30", [["선금", 30, "발주 후"], ["중도금", 40, "출하 전"], ["잔금", 30, "검수 후"]]],
  ["50 : 50", [["선금", 50, "발주 후"], ["잔금", 50, "검수 후"]]],
  ["30 : 70", [["선금", 30, "발주 후"], ["잔금", 70, "납품·검수 후"]]],
  ["10 : 80 : 10", [["선금", 10, "발주 후"], ["중도금", 80, "납품 후"], ["잔금", 10, "하자보증 후"]]],
  ["100", [["일시불", 100, "검수 후"]]],
];
const payPresets = () => [
  ...PAYMENT_PRESETS.map(([label, stages]) => ({ label, stages, builtin: true })),
  ...(Store.state.settings.payPresets || []).map((x) => ({ ...x, builtin: false })),
];
const presetLabel = (stages) => stages.map((x) => `${x[0]} ${x[1]}`).join(" : ");
// 단계 수에 맞는 기본 이름
const stageNames = (n) => (n === 1 ? ["일시불"] : n === 2 ? ["선금", "잔금"] : n === 3 ? ["선금", "중도금", "잔금"]
  : ["선금", ...Array.from({ length: n - 2 }, (_, i) => `중도금${i + 1}`), "잔금"]);
// "30/60/10", "30:60:10", "선금30 중도금60 잔금10", "선금 30%, 잔금 70%" → [[이름, 비율, 조건]]
function parsePayText(text) {
  const tokens = String(text || "").replace(/%/g, " ").match(/[^\d\s/:,·+]*\s*\d+(?:\.\d+)?/g) || [];
  const parts = tokens.map((t) => { const m = /^\s*(.*?)\s*(\d+(?:\.\d+)?)$/.exec(t); return [m[1].trim(), Number(m[2])]; }).filter(([, n]) => n > 0);
  const names = stageNames(parts.length);
  return parts.map(([name, n], i) => [name || names[i], n, ""]);
}
const toAmount = (v) => Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0;
const fmtWon = (n) => (n ? `${Math.round(n).toLocaleString("ko-KR")}원` : "-");
// 120000000 → "일억이천만"
function koreanAmount(n) {
  n = Math.floor(n);
  if (!n) return "영";
  const digits = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
  const small = ["", "십", "백", "천"], big = ["", "만", "억", "조"];
  let out = "", unit = 0;
  while (n > 0) {
    const part = n % 10000;
    if (part) {
      let s = "";
      String(part).padStart(4, "0").split("").forEach((d, i) => { if (+d) s += digits[+d] + small[3 - i]; });
      out = s + big[unit] + out;
    }
    n = Math.floor(n / 10000);
    unit++;
  }
  return out;
}
// 인건비: 분야별 M/D × M/D 단가 (인건비를 직접 넣으면 그 값). 실행가와는 따로 관리
const MD_FIELDS = [["control", "제어"], ["design", "설계"], ["elec", "전장"], ["make", "제작"], ["setup", "Setup"]];
const mdNum = (v) => Number(String(v ?? "").replace(/[^\d.]/g, "")) || 0;
function contractInfo(p) {
  const o = p.overview;
  const amount = toAmount(o.orderAmount);
  const payments = (o.payments || []).map((x) => ({ ...x, amount: Math.round((amount * (Number(x.ratio) || 0)) / 100) }));
  const ratioSum = payments.reduce((a, x) => a + (Number(x.ratio) || 0), 0);
  const paid = payments.filter((x) => x.status === "수금완료");
  // 실행 예가(예상) · 실행목표가 · 실행가(실제)
  const md = o.md || {}, mdTotal = Math.round(MD_FIELDS.reduce((a, [k]) => a + mdNum(md[k]), 0) * 100) / 100;
  const mdRate = toAmount(o.mdRate), laborAuto = Math.round(mdTotal * mdRate), labor = toAmount(o.laborCost) || laborAuto;
  const costBase = toAmount(o.actualCost);
  const estimateCost = toAmount(o.estimateCost), targetCost = toAmount(o.targetCost), actualCost = costBase;
  // 재경비·워런티비 = (실행가 + 인건비) × 설정 비율(%), 실행가 합계 = 실행가 + 인건비 + 재경비 + 워런티비
  const overheadRate = mdNum(o.overheadRate), warrantyRate = mdNum(o.warrantyRate);
  const rateBase = actualCost + labor;
  const overhead = Math.round((rateBase * overheadRate) / 100), warrantyCost = Math.round((rateBase * warrantyRate) / 100);
  const totalCost = actualCost + labor + overhead + warrantyCost;
  const rate = (cost) => (amount && cost ? (amount - cost) / amount : null);
  return { amount, payments, ratioSum, paidAmount: paid.reduce((a, x) => a + x.amount, 0),
    paidRatio: paid.reduce((a, x) => a + (Number(x.ratio) || 0), 0),
    estimateCost, targetCost, actualCost, costBase, md, mdTotal, mdRate, labor, laborAuto, laborManual: !!toAmount(o.laborCost),
    overheadRate, warrantyRate, rateBase, overhead, warrantyCost, totalCost,
    totalProfit: amount && totalCost ? amount - totalCost : null, totalRate: rate(totalCost),
    mdText: MD_FIELDS.filter(([k]) => mdNum(md[k])).map(([k, l]) => `${l} ${mdNum(md[k])}`).join(" · "),
    // 예상 이익 = 실행 예가 − 실행가, 목표 이익 = 실행목표가 − 실행가 (이익률은 각 기준 금액 대비). 화면·보고서 공통
    estProfit: estimateCost && actualCost ? estimateCost - actualCost : null,
    estRate: estimateCost && actualCost ? (estimateCost - actualCost) / estimateCost : null,
    targetProfit: targetCost && actualCost ? targetCost - actualCost : null,
    targetRate: targetCost && actualCost ? (targetCost - actualCost) / targetCost : null };
}

// ------------------------------------------------- 완료 프로젝트 마감 보고서 (엑셀 양식)
const addYears = (s, years) => {
  const d = new Date(Date.UTC(+s.slice(0, 4) + years, +s.slice(5, 7) - 1, +s.slice(8, 10)) - 86400000);
  return d.toISOString().slice(0, 10);
};
// 보고서에 들어갈 값: 직접 입력한 값(p.report)이 있으면 그것을, 없으면 프로그램 데이터에서 자동으로
// 주요 일자: 개요에 직접 입력한 값이 있으면 그것을, 없으면 다른 자료에서 자동으로
// 납품일자는 개요의 입고일자(receiveDate)를 그대로 쓴다
// 지급 완료일을 실제 값으로 채움: 정산 단계가 모두 수금완료면 항상 가장 늦은 정산일 (정산일을 고치면 따라 바뀜)
// 정산일이 하나도 없으면 오늘 날짜로 넣고 "today" 를 돌려줌 (화면에서 실제 입금일로 고치라고 안내)
// migrate: 예전 데이터를 처음 열 때 한 번만, 모두 수금완료인데 정산일이 하나도 없으면 오늘 날짜로 채움
function syncPaidDate(p, migrate = false) {
  const o = p.overview, pays = o.payments || [];
  const allPaid = pays.length && pays.every((x) => x.status === "수금완료");
  let filled = "";
  if (migrate) o.paidMigrated = true;
  if (allPaid) {
    if (!pays.some((x) => isDate(x.paidDate))) {
      if (!migrate) { if (o.paidDateAuto) { o.paidDate = ""; o.paidDateAuto = false; } return "cleared"; }
      pays.forEach((x) => (x.paidDate = today())); filled = "today";
    }
    const latest = pays.map((x) => x.paidDate).filter(isDate).sort().pop();
    if (o.paidDate !== latest) filled ||= "auto";
    o.paidDate = latest;
    o.paidDateAuto = true;
  } else if (o.paidDateAuto) { o.paidDate = ""; o.paidDateAuto = false; filled = "cleared"; }
  return filled;
}
// 프로젝트 완료 일자: Setup 완료일, 없으면 완료 보고서에 적은 완료일
const completionDate = (p) => (isDate(p.overview.setupDate) ? p.overview.setupDate : isDate(p.report?.completedDate) ? p.report.completedDate : "");
const KEY_DATES = [["kickoffDate", "Kick Off 일자"], ["receiveDate", "입고일자 (납품일자)"], ["setupDate", "Setup 완료일"], ["paidDate", "지급 완료일"]];
function keyDates(p) {
  const o = p.overview, c = contractInfo(p), sm = projectSummary(p);
  const kickoffMeeting = [...p.meetings].filter((m) => /kick|킥오프/i.test(m.title) && isDate(m.date)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const deliveryTask = p.schedule.filter((t) => /납품/.test(`${t.phase} ${t.name}`) && isDate(t.end)).map((t) => t.end).sort().pop();
  const paidDates = c.payments.map((x) => x.paidDate).filter(isDate).sort();
  const allPaid = c.payments.length && c.payments.every((x) => x.status === "수금완료");
  const auto = {
    kickoffDate: kickoffMeeting?.date || o.orderDate || sm.start || "",
    receiveDate: deliveryTask || "",
    setupDate: "",
    paidDate: allPaid ? paidDates[paidDates.length - 1] : "",
  };
  const out = {};
  for (const [k] of KEY_DATES) out[k] = { value: isDate(o[k]) ? o[k] : auto[k] || "", auto: !isDate(o[k]) && !!auto[k], autoValue: auto[k] || "" };
  if (o.paidDateAuto && isDate(o.paidDate)) out.paidDate.auto = true; // 정산 완료로 자동 입력된 값
  out.deliveryDate = out.receiveDate;
  // 모두 수금완료인데 정산일이 하나도 없으면 지급 완료일을 정할 수 없음 → 화면에 안내
  out.paidDate.missing = !!allPaid && !paidDates.length && !isDate(o.paidDate);
  // Warranty: 입력한 Warranty 시작일부터 설정한 기간(년) (다른 날짜로 짐작하지 않음)
  // 기간(년)은 예전 '하자보증기간' 글자에서도 읽어 온다
  const parsed = (/(\d+(?:\.\d+)?)\s*년/.exec(o.warranty) || [])[1] || ((/(\d+)\s*개월/.exec(o.warranty) || [])[1] ? String(+(/(\d+)\s*개월/.exec(o.warranty)[1]) / 12) : "");
  const years = Number(o.warrantyYears || parsed) || 0;
  const start = isDate(o.warrantyStart) ? o.warrantyStart : "";
  const end = isDate(start) && years ? addYears(start, years) : "";
  const started = isDate(start) && start <= today();
  const period = years ? `${years}년` : o.warranty || "";
  out.warranty = { start, startAuto: false, years, end, started,
    // 보고서용 글자: 정해진 기간 또는 예정
    text: end ? `${start} ~ ${end} (${years}년)` : start ? `${start} 시작${period ? ` (${period})` : ""}` : period ? `${period} (시작일 미입력)` : "",
    state: !isDate(start) ? (period ? "시작 전" : "") : !started ? "시작 전" : end && today() > end ? "만료" : "보증 중",
    remain: end && started && today() <= end ? dayNo(end) - dayNo(today()) : null, period };
  return out;
}

function closingInfo(p) {
  const o = p.overview, r = p.report || {}, c = contractInfo(p), sm = projectSummary(p);
  const kd = keyDates(p);
  const auto = { kickoffDate: kd.kickoffDate.autoValue, deliveryDate: kd.deliveryDate.autoValue, warrantyYears: kd.warranty.years ? String(kd.warranty.years) : "" };
  const setupDate = kd.setupDate.value, warrantyStart = kd.warranty.start, warrantyText = kd.warranty.text;
  const orderAmount = c.amount;
  const actualCost = c.actualCost, targetCost = c.targetCost, estimateCost = c.estimateCost, salesActual = toAmount(r.salesActual);
  // 미완료 내용: 직접 적은 내용 > 남은 일정·의제·미수금 요약 > "납품완료"
  const sd = scheduleDone(p);
  const openTasks = p.schedule.filter((t) => !sd.isDone(t)).length, unpaid = c.payments.filter((x) => x.status !== "수금완료").length;
  const autoUnfinished = [openTasks && `일정 ${openTasks}건`, sm.openActions.length && `실천 의제 ${sm.openActions.length}건`,
    sm.pendingSubmissions.length && `미제출 자료 ${sm.pendingSubmissions.length}건`, unpaid && `미수금 ${unpaid}건`].filter(Boolean);
  return {
    header: o.customer || o.name, projectName: o.project || o.name,
    items: (o.scope || "").split("\n").map((x) => x.trim()).filter(Boolean).join(" / "),
    issues: r.issues || "없음",
    unfinished: r.unfinished || (autoUnfinished.length ? `미완료: ${autoUnfinished.join(", ")}` : "납품완료"),
    kickoffDate: kd.kickoffDate.value, deliveryDate: kd.deliveryDate.value, setupDate, warrantyStart, warrantyYears: auto.warrantyYears, warrantyText,
    payTerms: c.payments.map((x) => `${x.name} ${x.ratio}%`).join(" / "),
    paidDate: kd.paidDate.value,
    orderAmount, estimateCost, targetCost, actualCost, salesActual,
    mdTotal: c.mdTotal, mdText: c.mdText, labor: c.labor, overheadRate: c.overheadRate, warrantyRate: c.warrantyRate,
    overhead: c.overhead, warrantyCost: c.warrantyCost, totalCost: actualCost ? c.totalCost : 0,
    totalProfit: orderAmount && actualCost ? orderAmount - c.totalCost : null, totalRate: orderAmount && actualCost ? (orderAmount - c.totalCost) / orderAmount : null,
    auto,
  };
}

// projects 를 열(D, E, F…)로 나란히 놓은 "완료 프로젝트 마감 보고서" + 종합 (+ 한 프로젝트면 세부 시트)
// 년도별 계약·정산: 발주일 년도(없으면 Kick Off·첫 일정 시작일 년도)로 묶는다
function contractYear(p) {
  const kd = keyDates(p), first = p.schedule.map((t) => t.start).filter(isDate).sort()[0];
  const d = [p.overview.orderDate, kd.kickoffDate.value, first].find(isDate);
  return d ? d.slice(0, 4) : "연도 미정";
}
// 여러 프로젝트 합계 (년도별 계약·정산 엑셀·PDF 공통).
// 이익·이익률은 실행가를 넣은 프로젝트만으로 계산 (실행가 없는 프로젝트의 발주금액을 이익으로 세지 않도록)
function contractStats(list) {
  const cs = list.map(contractInfo), t = (f) => cs.reduce((a, c) => a + (f(c) || 0), 0);
  const o = { count: list.length, done: list.filter((p) => p.overview.status === "완료").length,
    amount: t((c) => c.amount), costedAmount: t((c) => (c.actualCost ? c.amount : 0)),
    total: t((c) => (c.actualCost ? c.totalCost : 0)), profit: t((c) => (c.amount && c.actualCost ? c.totalProfit : 0)),
    paid: t((c) => c.paidAmount), missingCount: cs.filter((c) => c.amount && !c.actualCost).length };
  o.missingAmount = o.amount - o.costedAmount;
  o.rate = o.costedAmount && o.total ? o.profit / o.costedAmount : null;
  o.unpaid = o.amount - o.paid;
  return o;
}
// 년도마다 완료 보고서 양식(프로젝트를 열로) 시트 + 그 년도 종합, 맨 앞에 년도별 합계, 맨 뒤에 정산 내역
async function buildContractYearWorkbook(projects, years) {
  const H = (v) => ({ v, s: "head" }), txt = (v) => ({ v: v ?? "", s: "cell" }), money = (v) => ({ v: v || "", s: "money" });
  const date = (v) => ({ v: v || "", s: isDate(v) ? "date" : "cell" });
  const label = (y) => (y === "연도 미정" ? y : `${y}년`);
  const byYear = years.map((y) => ({ y, list: projects.filter((p) => contractYear(p) === y)
    .sort((a, b) => (a.overview.orderDate || "9").localeCompare(b.overview.orderDate || "9") || a.overview.name.localeCompare(b.overview.name)) }))
    .filter((g) => g.list.length);
  const sheets = [], summary = [];
  for (const { y, list } of byYear) {
    const [main, sum] = closingSheets(list, { title: `${label(y)} 프로젝트 마감 보고서 (계약 · 정산)`, name: label(y), sumName: `${label(y)} 종합` });
    sheets.push(main, sum);
    summary.push({ name: label(y), sumName: sum.name, t: sum.totalRow, ...contractStats(list) });
  }
  // 년도별 합계: 각 '년도 종합' 시트의 합계 행을 수식으로 참조 (C 수주가 · F 실행가 합계 · G 합계 기준 이익)
  const ref = (s, L) => `'${s.sumName}'!${L}${s.t}`;
  // 이익률 = 이익 / 실행가를 넣은 프로젝트의 발주금액 (J열). 실행가 미입력 프로젝트는 이익에 넣지 않음
  const sumRows = summary.map((s, i) => {
    const r = 4 + i, n = s.t === 3 ? 3 : s.t - 1;
    return [null, txt(s.name), { v: s.count, s: "cell" }, { f: ref(s, "C"), v: s.amount, s: "money" }, { f: ref(s, "F"), v: s.total, s: "money" },
      { f: ref(s, "G"), v: s.profit, s: "money" }, { f: `IF(J${r}=0,"",F${r}/J${r})`, v: s.rate ?? "", s: "pct" }, money(s.paid), { f: `D${r}-H${r}`, v: s.amount - s.paid, s: "money" },
      { f: `SUMIF('${s.sumName}'!F3:F${n},">0",'${s.sumName}'!C3:C${n})`, v: s.costedAmount, s: "money" },
      txt(s.missingCount ? `${s.missingCount}건 · ${fmtWon(s.missingAmount)}` : "")];
  });
  const m = 3 + summary.length;
  const front = { name: "년도별 합계", cols: [3, 14, 8, 17, 17, 17, 10, 17, 17, 19, 22], merges: ["B1:K1"], rows: [
    [null, { v: "년도별 계약 · 정산 합계", s: "title" }], [null, { v: `출력일 ${today()} · 단위 (원) · 년도 = 발주일 기준 (없으면 Kick Off·첫 일정) · 이익 = 발주가 - 실행가 합계 (실행가를 넣은 프로젝트만) · 이익률 = 이익 / 이익 계산 발주금액`, s: "cell" }],
    [null, ...["년도", "건수", "발주금액", "실행가 합계", "합계 기준 이익", "이익률", "수금액", "미수금", "이익 계산 발주금액", "실행가 미입력"].map(H)], ...sumRows,
    ...(summary.length > 1 ? [[null, H("전체"), { f: `SUM(C4:C${m})`, s: "cell" }, ...["D", "E", "F"].map((L) => ({ f: `SUM(${L}4:${L}${m})`, s: "moneyb" })),
      { f: `IF(J${m + 1}=0,"",F${m + 1}/J${m + 1})`, s: "pct" }, ...["H", "I", "J"].map((L) => ({ f: `SUM(${L}4:${L}${m})`, s: "moneyb" })), txt("")]] : [])] };
  // 정산 내역: 프로젝트별 정산 단계
  const payRows = byYear.flatMap(({ y, list }) => list.flatMap((p) => contractInfo(p).payments.map((x) =>
    [null, txt(label(y)), txt(p.overview.customer), txt(p.overview.project || p.overview.name), txt(x.name), { v: (Number(x.ratio) || 0) / 100, s: "pct" },
      money(x.amount), txt(x.cond), date(x.paidDate), txt(x.status || "미청구")])));
  const pays = { name: "정산 내역", cols: [3, 10, 18, 30, 10, 8, 15, 20, 11, 10], merges: ["B1:J1"], rows: [
    [null, { v: "프로젝트별 정산 내역", s: "title" }], [],
    [null, ...["년도", "고객사", "프로젝트", "구분", "비율", "금액", "지급 조건", "정산일", "상태"].map(H)], ...payRows] };
  return Xlsx.write([front, ...sheets, ...(payRows.length ? [pays] : [])]);
}
// 마감 보고서 양식 시트 2장 (프로젝트를 열로 + 종합). 완료 보고서·년도별 계약·정산이 함께 씀
function closingSheets(projects, { title = "완료 프로젝트 마감 보고서", name = "완료프로젝트 마감보고서", sumName = "종합" } = {}) {
  const infos = projects.map(closingInfo);
  const col = (i) => Xlsx.colName(3 + i); // D부터
  const H = (v) => ({ v, s: "head" });
  const row = (group, label, cell) => [null, group == null ? null : H(group), H(label), ...infos.map((x, i) => cell(x, i))];
  const txt = (v) => ({ v: v || "", s: "cell" });
  // 값 열은 글자·날짜를 모두 왼쪽 정렬, 금액만 오른쪽 정렬해 줄을 맞춘다
  const date = (v) => ({ v: v || "", s: isDate(v) ? "dateL" : "cell" });
  const money = (v) => ({ v: v || "", s: "money" });
  const last = col(infos.length - 1);
  const rows = [
    [null, { v: title, s: "title" }], [],
    [null, H("구분"), H("항목"), ...infos.map((x) => H(x.header))],
    row("프로젝트 내용", "프로젝트명", (x) => txt(x.projectName)),
    row("", "납품 물품 내역", (x) => txt(x.items)),
    row("", "이슈(특이)사항", (x) => txt(x.issues)),
    row("", "미완료 내용", (x) => txt(x.unfinished)),
    row("진행상황", "Kick off일자", (x) => date(x.kickoffDate)),
    row("", "납품일자", (x) => date(x.deliveryDate)),
    row("", "SET UP 완료일", (x) => date(x.setupDate)),
    row("", "Warranty 시작", (x) => txt(x.warrantyText)),
    row("정산관련", "지급조건", (x) => txt(x.payTerms)),
    row("", "입금완료일", (x) => date(x.paidDate)),
    row("", "발주가", (x) => money(x.orderAmount)),
    row("", "실행 예가", (x) => money(x.estimateCost)),
    row("", "실행목표가", (x) => money(x.targetCost)),
    row("", "실행가", (x) => money(x.actualCost)),
    // 실행가 구성: 인건비(M/D) · 재경비(비율) · 워런티비(비율) → 실행가 합계 (18~26행)
    // 재경비·워런티비 = (실행가 + 인건비) × 비율 칸 (비율을 고치면 금액·합계·이익이 따라 바뀜)
    row("", "투입 M/D", (x) => txt(x.mdTotal ? `${x.mdTotal} M/D (${x.mdText})` : "")),
    row("", "인건비", (x) => money(x.labor)),
    row("", "재경비 비율", (x) => (x.overheadRate ? { v: x.overheadRate / 100, s: "pct" } : txt(""))),
    row("", "재경비", (x, i) => (x.actualCost && x.overheadRate ? { f: `(${col(i)}17+N(${col(i)}19))*N(${col(i)}20)`, v: x.overhead, s: "money" } : money(""))),
    row("", "워런티비 비율", (x) => (x.warrantyRate ? { v: x.warrantyRate / 100, s: "pct" } : txt(""))),
    row("", "워런티비", (x, i) => (x.actualCost && x.warrantyRate ? { f: `(${col(i)}17+N(${col(i)}19))*N(${col(i)}22)`, v: x.warrantyCost, s: "money" } : money(""))),
    row("", "실행가 합계", (x, i) => (x.totalCost ? { f: `${col(i)}17+N(${col(i)}19)+N(${col(i)}21)+N(${col(i)}23)`, v: x.totalCost, s: "moneyb" } : txt(""))),
    row("", "합계 기준 이익", (x, i) => (x.orderAmount && x.totalCost ? { f: `${col(i)}14-${col(i)}24`, v: x.totalProfit, s: "moneyb" } : txt(""))),
    row("", "합계 기준 이익률", (x, i) => (x.orderAmount && x.totalCost ? { f: `IF(${col(i)}14=0,"",${col(i)}25/${col(i)}14)`, v: x.totalRate, s: "pct" } : txt(""))),
    // 예상 이익 = 실행 예가 − 실행가, 목표 이익 = 실행목표가 − 실행가, 이익률은 각 기준 금액 대비 (27~30행)
    ...[["예상", 15, "estimateCost", 27], ["목표", 16, "targetCost", 29]].flatMap(([l, br, key, pr]) => [
      row("", `${l} 이익 (${br === 15 ? "실행 예가" : "실행목표가"} − 실행가)`, (x, i) => (x[key] && x.actualCost ? { f: `${col(i)}${br}-${col(i)}17`, v: x[key] - x.actualCost, s: "money" } : txt(""))),
      row("", `${l} 이익률`, (x, i) => (x[key] && x.actualCost ? { f: `IF(${col(i)}${br}=0,"",${col(i)}${pr}/${col(i)}${br})`, v: (x[key] - x.actualCost) / x[key], s: "pct" } : txt("")))]),
    [], [null, { v: `※ 예상 이익 = 실행 예가 - 실행가 (이익률 = 예상 이익 / 실행 예가) · 목표 이익 = 실행목표가 - 실행가 (이익률 = 목표 이익 / 실행목표가) · 재경비·워런티비 = (실행가 + 인건비) × 각 비율 (재경비 비율·워런티비 비율 행) · 실행가 합계 = 실행가 + 인건비 + 재경비 + 워런티비 · 합계 기준 이익 = 발주가 - 실행가 합계 (이익률 = 합계 기준 이익 / 발주가) · 출력일 ${today()}`, s: "wrap" }],
  ];
  // 긴 글자 행은 줄 수만큼 높이를 키운다 (열 너비 34 ≈ 한 줄 17자)
  const lines = (t) => String(t || "").split("\n").reduce((a, l) => a + Math.max(1, Math.ceil([...l].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) / 32)), 0);
  const heights = { 0: 30, 2: 22 };
  rows.forEach((row, r) => {
    if (r < 3 || !row) return;
    const max = Math.max(1, ...row.slice(3).map((c) => lines(c && typeof c === "object" ? c.v : c)));
    heights[r] = Math.max(20, max * 15 + 5);
  });
  const sheets = [{ name, cols: [3, 14, 24, ...infos.map(() => 34)], rows, heights,
    merges: [`B1:${last}1`, "B4:B7", "B8:B11", "B12:B30", `B32:${last}32`] }];

  // 종합: 프로젝트별 금액
  const sum = [[null, { v: "** 프로젝트별 금액", s: "title" }, null, null, null, null, null, null, { v: "단위 (원)", s: "wrap" }],
    [null, ...["발주명", "수주가", "실적가", "실투입재료비", "실행가 합계", "합계 기준 이익", "합계 기준 이익률", "비고"].map(H)]];
  infos.forEach((x, i) => {
    const r = 3 + i;
    sum.push([null, txt(x.projectName), money(x.orderAmount), money(x.salesActual), money(x.actualCost),
      money(x.totalCost),
      x.orderAmount && x.totalCost ? { f: `C${r}-F${r}`, v: x.totalProfit, s: "money" } : txt(""),
      x.orderAmount && x.totalCost ? { f: `IF(C${r}=0,"",(C${r}-F${r})/C${r})`, v: x.totalRate, s: "pct" } : txt(""),
      txt(projects[i].report?.summary ? projects[i].report.summary.split("\n")[0] : "")]);
  });
  if (infos.length > 1) {
    const n = infos.length + 2;
    sum.push([null, H("합계"), { f: `SUM(C3:C${n})`, v: infos.reduce((a, x) => a + (x.orderAmount || 0), 0), s: "moneyb" },
      { f: `SUM(D3:D${n})`, v: infos.reduce((a, x) => a + (x.salesActual || 0), 0), s: "moneyb" },
      { f: `SUM(E3:E${n})`, v: infos.reduce((a, x) => a + (x.actualCost || 0), 0), s: "moneyb" },
      { f: `SUM(F3:F${n})`, v: infos.reduce((a, x) => a + (x.totalCost || 0), 0), s: "moneyb" },
      { f: `SUM(G3:G${n})`, s: "moneyb" }, { f: `IF(SUMIF(F3:F${n},">0",C3:C${n})=0,"",G${n + 1}/SUMIF(F3:F${n},">0",C3:C${n}))`, s: "pct" }, txt("")]);
  }
  sheets.push({ name: sumName, cols: [3, 40, 16, 16, 16, 16, 16, 14, 40], rows: sum, totalRow: infos.length > 1 ? infos.length + 3 : 3 });
  return sheets;
}
async function buildClosingWorkbook(projects) {
  const sheets = closingSheets(projects);
  const H = (v) => ({ v, s: "head" }), txt = (v) => ({ v: v || "", s: "cell" });
  const date = (v) => ({ v: v || "", s: isDate(v) ? "dateL" : "cell" }), money = (v) => ({ v: v || "", s: "money" });

  // 한 프로젝트만 내려받을 때는 근거 자료 시트도 함께
  if (projects.length === 1) {
    const p = projects[0], c = contractInfo(p);
    if (c.payments.length) sheets.push({ name: "정산 내역", cols: [3, 12, 9, 16, 22, 12, 10], rows: [
      [null, { v: "정산 내역", s: "title" }], [],
      [null, ...["구분", "비율", "금액", "지급 조건", "정산일", "상태"].map(H)],
      ...c.payments.map((x) => [null, txt(x.name), { v: (Number(x.ratio) || 0) / 100, s: "pct" }, money(x.amount), txt(x.cond), date(x.paidDate), txt(x.status)]),
      [null, H("합계"), { v: c.ratioSum / 100, s: "pct" }, { v: c.payments.reduce((a, x) => a + x.amount, 0), s: "moneyb" }]] });
    const sd = scheduleDone(p);
    if (p.schedule.length) sheets.push({ name: "일정 실적", cols: [3, 14, 28, 12, 12, 12, 8, 30], rows: [
      [null, { v: "일정 실적", s: "title" }], [],
      [null, ...["단계", "세부사항", "계획 시작", "계획 종료", "실제 완료", "완료", "비고"].map(H)],
      ...p.schedule.map((t) => [null, txt(t.phase), txt(t.name), date(t.start), date(t.end), date(sd.doneDate(t)), txt(sd.isDone(t) ? "완료" : "미완료"), txt(t.note)])] });
    if (p.lists.changes.length) sheets.push({ name: "변경사항", cols: [3, 12, 10, 10, 60, 24], rows: [
      [null, { v: "변경사항", s: "title" }], [],
      [null, ...["날짜", "작성자", "요청자", "변경 내용", "비고"].map(H)],
      ...p.lists.changes.map((x) => [null, date(x.date), txt(x.author), txt(x.requester), txt(x.content), txt(x.note)])] });
  }
  return Xlsx.write(sheets);
}

// ------------------------------------------------------------- 사양 (구분 추가 가능)
LISTS.specsec = { title: "사양", sheet: "사양", cols: SPEC_COLS };
// 사양 구분이 없으면 예전 SW 사양·HW 주요 Spec(자료·메모 포함)을 첫 두 구분으로 옮긴다
function ensureSpecs(p) {
  if (Array.isArray(p.specs) && p.specs.length) return p.specs;
  p.specs = [
    { id: Store.uid(), name: "SW 사양", rows: p.lists.sw || [], files: [], note: "" },
    { id: Store.uid(), name: "HW 주요 Spec", rows: p.lists.hw || [], files: p.hwImages || [], note: p.hwNote || "" },
  ];
  p.lists.sw = [];
  p.lists.hw = [];
  p.hwImages = [];
  p.hwNote = "";
  return p.specs;
}
const findSpec = (p, key) => ensureSpecs(p).find((x) => `spec:${x.id}` === key || x.id === key);
const specItemCount = (p) => ensureSpecs(p).reduce((a, x) => a + x.rows.length, 0);
// 새 사양 구분 예시와 기본 항목 (AMR·물류 설비 기준)
const SPEC_TEMPLATES = [
  ["기구 사양", ["외형 치수 (L×W×H)", "자중", "가반 하중", "프레임 재질", "도장 색상"]],
  ["전장 사양", ["전원 / 배터리", "충전 방식", "제어기 (PC/PLC)", "모터 / 드라이브", "I/O"]],
  ["성능 사양", ["최고 속도 (무부하/적재)", "정지 거리", "위치 정밀도", "회전 반경", "연속 운전 시간"]],
  ["안전 사양", ["비상 정지 (EMO)", "범퍼 / 접촉 센서", "Lidar 안전 영역", "경광등 / 부저", "안전 인증"]],
  ["통신·인터페이스", ["무선 통신 (Wi-Fi)", "상위 시스템 연동 (ACS/MES)", "PIO / 설비 연동", "원격 조작 (펜던트)", "HMI"]],
  ["유틸리티·환경", ["설치 환경 (온·습도)", "바닥 조건", "전원 공급", "네트워크", "소음"]],
];
// 사양 엑셀(기술 사양서 등) 머리글 인식
const SPEC_FIELDS = [
  { key: "kind", exact: ["구분", "분류", "영역", "area", "category", "대분류"], has: ["영역", "area", "구분"] },
  { key: "item", exact: ["항목", "item", "description", "사양항목"], has: ["항목", "요구사항", "technical", "description", "item"] },
  { key: "content", exact: ["내용", "사양", "spec", "요청", "requirements", "value", "값", "요구값"], has: ["요청", "requirement", "사양", "spec", "내용"] },
  { key: "review", exact: ["검토", "비고", "remark", "remarks", "답변", "확인", "status", "결과", "검토결과"], has: ["remark", "답변", "검토", "verified", "확인"] },
];
function analyzeSpecSheet(sheet) {
  const rows = filledRows(sheet);
  const fieldOf = (label) => {
    const n = norm(label);
    if (!n) return null;
    const f = SPEC_FIELDS.find((x) => x.exact.some((a) => norm(a) === n)) || SPEC_FIELDS.find((x) => x.has.some((a) => n.includes(norm(a))));
    return f ? f.key : null;
  };
  let best = null;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const mapping = {};
    (rows[r] || []).forEach((v, c) => { const k = fieldOf(v); if (k && !(k in mapping)) mapping[k] = c; });
    const score = Object.keys(mapping).length;
    if ((mapping.item != null || mapping.content != null) && score >= 2 && (!best || score > best.score)) best = { row: r, mapping, score };
  }
  if (!best) return null;
  const columns = [];
  (rows[best.row] || []).forEach((v, c) => { const label = cellText(v); if (label && !columns.some((x) => x.c === c)) columns.push({ c, label }); });
  return { headerRow: best.row, mapping: best.mapping, columns, rows };
}
// 이름이 사양·사양서·Spec·Technical Sheet 인 시트(문의·답변 메일 제외), 또는 머리글이 사양 표(항목·내용)인 시트
function isSpecSheet(sheet, date) {
  if (/사양|spec|technical|기술\s*요구/i.test(sheet.name) && !/문의|질의|답변|회신|회의/.test(sheet.name)) return true;
  // 날짜가 없는 그 밖의 시트(업무 Scope 정의, 설계 및 제작 조건 …)는 프로젝트마다 추가되는 사양 문서
  return !date && (sheetLines(sheet).length > 0 || sheet.images.length > 0 || sheet.embeds.length > 0);
}
// 시트에 넣어 둔 엑셀 원본 중 사양 표가 있는 시트(항목이 가장 많은 것)를 읽음
async function embeddedSpecRows(embeds) {
  let best = [];
  for (const e of embeds) {
    if (!/^xlsx$/i.test(e.ext)) continue;
    try {
      const wb = await Xlsx.read(new Blob([e.data]));
      for (const sh of wb.sheets) {
        const info = analyzeSpecSheet(sh);
        const rows = info ? readSpecRows(info, info.mapping) : [];
        if (rows.length > best.length) best = rows;
      }
    } catch { /* 읽을 수 없는 원본은 첨부로만 보관 */ }
  }
  return best;
}
function specRowsOf(sheet) {
  // 시트 전체가 사양 표(맨 위에 머리글)이면 표로, 아니면 문서형 사양서로 읽음
  const info = analyzeSpecSheet(sheet);
  if (info && info.rows.slice(0, info.headerRow).filter((r) => (r || []).some((v) => cellText(v))).length <= 1)
    return readSpecRows(info, info.mapping);
  return parseSpecDoc(sheet);
}

// 문서형 사양서(번호 제목 · 문단 · 중간중간 작은 표)를 사양 항목으로
//   1.1. 환경 조건 / ■ 설계          → 제목 (구분)
//   제목 아래 문단                    → 한 항목 (항목 = 제목, 내용 = 문단)
//   항목|내용|담당|비고 같은 작은 표   → 표의 행마다 한 항목 (첫 열 = 항목, 셋째 열부터는 검토에 '머리글: 값')
//   A. Robot / ii. Robot PC 같은 짧은 소제목 → 새 항목
const SPEC_HEAD = /^\s*(?:\d+\.\d+(?:\.\d+)*\.?|■)\s*/;
const SPEC_TOP = /^\s*\d+\.(?!\d)\s*/;
const SPEC_MINOR = /^\s*(?:[A-Z]|[ivx]+)\.\s*/;
const SPEC_HEADER_WORD = /항목|내용|기능|구분|구성|설명|비고|담당|특이|사항|명칭|사양|item|spec|remark/i;
const clean = (t) => t.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
function parseSpecDoc(sheet) {
  const out = [];
  let section = "", sub = "", para = null, table = null, topSeen = false;
  const flush = () => { para = null; };
  const addPara = (text) => {
    if (!para) { para = { id: Store.uid(), kind: section, item: sub === section ? "" : sub, content: "", review: "" }; out.push(para); }
    para.content += (para.content ? "\n" : "") + text;
  };
  for (const row of sheet.rows) {
    const cells = [];
    (row || []).forEach((v, c) => { const t = clean(cellText(v)); if (t) cells.push({ c, t }); });
    if (!cells.length) continue;
    const first = cells[0].t, joined = cells.map((x) => x.t).join(" ");
    const title = (re) => clean(first.replace(re, "")) || clean(cells.slice(1).map((x) => x.t).join(" "));
    const short = (t) => t.length <= 25 && !/[다함것]\.?$/.test(t);
    // 제목
    if (SPEC_HEAD.test(first) || (!topSeen && SPEC_TOP.test(first) && short(title(SPEC_TOP)))) {
      const t = title(SPEC_HEAD.test(first) ? SPEC_HEAD : SPEC_TOP);
      if (!SPEC_HEAD.test(first) || /^\s*\d+\.\d+\.?\s/.test(first)) topSeen = true;
      if (/^\s*\d+\.\d+\.?\s|^\s*\d+\.(?!\d)/.test(first) && !/^\s*\d+\.\d+\.\d+/.test(first)) { section = t; sub = t; }
      else sub = t;
      table = null; flush();
      continue;
    }
    // 작은 표 머리글
    if (cells.length >= 2 && cells.every((x) => x.t.length <= 12 && !/^[-•※·\d(]/.test(x.t))
      && cells.filter((x) => SPEC_HEADER_WORD.test(x.t)).length * 2 >= cells.length) {
      table = { item: cells[0].c, content: cells[1].c, extras: cells.slice(2), last: null };
      flush();
      continue;
    }
    if (table && cells[cells.length - 1].c > table.item) {
      const itemCell = cells.find((x) => x.c === table.item);
      const extras = [], content = [];
      for (const x of cells) {
        if (x === itemCell) continue;
        const ex = table.extras.find((e) => e.c === x.c);
        if (ex) extras.push(itemCell || !table.last ? `${ex.t}: ${x.t}` : x.t); else content.push(x.t);
      }
      if (itemCell || !table.last) {
        table.last = { id: Store.uid(), kind: sub || section, item: itemCell ? itemCell.t : "", content: content.join(" : "), review: extras.join(" · ") };
        out.push(table.last);
      } else {
        const r = table.last;
        if (content.length) r.content += (r.content ? "\n" : "") + content.join(" : ");
        if (extras.length) r.review += (r.review ? " " : "") + extras.join(" ");
      }
      continue;
    }
    table = null;
    // 짧은 소제목 (A. Robot, ii. Robot PC)
    if (cells.length === 1 && SPEC_MINOR.test(first) && short(title(SPEC_MINOR))) {
      flush();
      sub = title(SPEC_MINOR);
      continue;
    }
    addPara(joined);
  }
  return out;
}
function readSpecRows(info, mapping) {
  const out = [];
  let lastKind = "";
  const header = info.rows[info.headerRow] || [];
  const get = (row, k) => (mapping[k] === "" || mapping[k] == null ? "" : cellText(row[Number(mapping[k])]));
  for (let r = info.headerRow + 1; r < info.rows.length; r++) {
    const row = info.rows[r] || [];
    if (!row.some((v) => cellText(v))) continue;
    if (row.every((v, c) => !cellText(v) || norm(v) === norm(header[c]))) continue; // 머리글 반복
    const rec = { id: Store.uid(), kind: get(row, "kind"), item: get(row, "item"), content: get(row, "content"), review: get(row, "review") };
    if (rec.kind) lastKind = rec.kind; else rec.kind = lastKind;
    if (!rec.item && !rec.content && !rec.review) continue;
    out.push(rec);
  }
  return out;
}
