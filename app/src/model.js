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
  { key: "kind", label: "구분", w: 12 }, { key: "item", label: "항목", w: 30, type: "textarea" },
  { key: "content", label: "내용", w: 40, type: "textarea" }, { key: "review", label: "검토", w: 22, type: "textarea" },
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
  ["receiveDate", "입고일자"], ["receivePlace", "입고 장소"], ["scope", "사업 범위"], ["warranty", "하자보증기간"],
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
function parseScopeUnits(scope) {
  return String(scope || "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(.*?)\s*[:：x×]\s*(\d+)\s*(?:EA|ea|대|개|set|SET|식|기)?\s*$/.exec(l);
    return m ? { name: m[1].trim(), qty: Number(m[2]) } : { name: l, qty: 1 };
  });
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
  const info = p.schedule.map((t) => ({ t, ...taskInfo(t, base) }));
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
  for (const sheet of wb.sheets) {
    onProgress(`시트 가져오는 중 (${++i}/${wb.sheets.length}): ${sheet.name}`);
    const key = norm(sheet.name);
    const title = titleFromSheet(sheet.name);
    const date = dateFromText(sheet.name);
    const images = [];
    for (let k = 0; k < sheet.images.length; k++) {
      const img = sheet.images[k];
      if (!img.type.startsWith("image/") || /emf|wmf/.test(img.ext)) continue;
      images.push(await addBytes(img.data, img.type, `${title}${sheet.images.length > 1 ? "_" + (k + 1) : ""}.${img.ext}`));
    }
    const files = [];
    for (let k = 0; k < sheet.embeds.length; k++) {
      const e = sheet.embeds[k];
      files.push(await addBytes(e.data, e.type, `${title}${sheet.embeds.length > 1 ? "_" + (k + 1) : ""}.${e.ext}`));
    }
    const firstText = sheetLines(sheet).slice(0, 5).flat().map(norm);

    if (key === "revision") {
      p.revisions = readTable(sheet, LISTS.revisions.cols);
    } else if (key === "개요") {
      parseOverview(sheet, p);
    } else if (key === "일정") {
      p.schedule = parseSchedule(sheet);
    } else if (key === "sw사양") {
      p.lists.sw = readTable(sheet, SPEC_COLS, { carry: ["kind"] });
    } else if (key === "hw주요spec") {
      p.lists.hw = readTable(sheet, SPEC_COLS, { carry: ["kind"] });
      p.hwImages.push(...images, ...files);
    } else if (["지정품지급품", "소모품", "bom"].includes(key)) {
      const k = { 지정품지급품: "supplied", 소모품: "consumables", bom: "bom" }[key];
      p.lists[k] = readTable(sheet, PART_COLS, { carry: ["kind"] });
    } else if (key === "제출자료") {
      p.lists.submissions = readTable(sheet, [{ key: "item", label: "자료명", alias: ["자료", "항목", "제출 자료"] }, ...LISTS.submissions.cols.slice(1)]);
      if (!p.lists.submissions.length) {
        p.lists.submissions = sheetLines(sheet).filter((v) => norm(v[0]) !== "제출자료")
          .map((v) => ({ id: Store.uid(), item: v.join(" "), to: "", submitted: "", status: "미제출", note: "" }));
      }
    } else if (key === "변경사항") {
      p.lists.changes = readTable(sheet, LISTS.changes.cols).map((r) => ({ ...r, files: [] }));
    } else if (firstText.includes("회의록")) {
      p.meetings.push(parseMeeting(sheet, [...images, ...files]));
    } else {
      const memo = sheetLines(sheet).map((v) => v.join("  ")).join("\n");
      if (!images.length && !files.length && !memo) continue;
      const kind = /답변|회신/.test(title) ? "답변" : /문의|질의/.test(title) ? "문의" : "자료";
      p.records.push({ id: Store.uid(), date: date || today(), kind, title, from: "", to: "", memo, images, files });
    }
  }
  fillSubmitTo(p);
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
  const H = (v) => ({ v, s: "head" }), T = (v) => ({ v: v ?? "", s: "cell" });
  const sheets = ensureUnits(p).map((u) => {
    const rows = [[{ v: `BOM · ${u.name}`, s: "title" }, null, null, null, null, { v: "대수", s: "head" }, { v: Number(u.qty) || 0, s: "cell" }], [],
      [H("NO"), H("구분"), H("품목"), H("모델명"), H("업체명"), H("1대당 수량"), H("총 수량"), H("비고")]];
    let n = 0;
    u.bom.forEach((r) => {
      if (!isItemRow(r)) { rows.push([T(""), { v: r.item.replace(/^■\s*/, ""), s: "head" }, T(""), T(""), T(""), T(""), T(""), T("")]); return; }
      const q = Number(r.qty), rowNo = rows.length + 1;
      rows.push([{ v: ++n, s: "cell" }, T(r.kind), T(r.item), T(r.model), T(r.maker), { v: r.qty !== "" && !isNaN(q) ? q : r.qty, s: "cell" },
        r.qty !== "" && !isNaN(q) ? { f: `F${rowNo}*$G$1`, v: unitTotalQty(r, u), s: "cell" } : T(""), T(r.note)]);
    });
    return { name: `BOM_${u.name}`, cols: [6, 12, 22, 22, 16, 10, 9, 24], rows };
  });
  const { units, rows } = bomSummary(p);
  const sum = [[{ v: "BOM 전체 합계 (구매 수량)", s: "title" }], [],
    [H("NO"), H("구분"), H("품목"), H("모델명"), H("업체명"), ...units.map((u) => H(`${u.name} ×${u.qty}`)), H("총 수량"), H("비고")]];
  rows.forEach((r, i) => sum.push([{ v: i + 1, s: "cell" }, T(r.kind), T(r.item), T(r.model), T(r.maker),
    ...units.map((u) => ({ v: r.per[u.id] ?? "", s: "cell" })), { v: r.total, s: "cell" }, T(r.notes.join(" / "))]));
  sheets.push({ name: "BOM 합계", cols: [6, 12, 22, 22, 16, ...units.map(() => 14), 10, 30], rows: sum });
  return sheets;
}

async function buildWorkbook(p) {
  const sheets = [];
  const table = (key, extraTitle) => {
    const def = LISTS[key];
    const rows = [head(["NO", ...def.cols.map((c) => c.label), ...(def.files ? ["첨부 파일"] : [])])];
    listRows(p, key).forEach((r, i) => rows.push([{ v: i + 1, s: "cell" }, ...def.cols.map((c) => cellOf(c, r[c.key])),
      ...(def.files ? [{ v: fileNames(r.files), s: "cell" }] : [])]));
    if (extraTitle) rows.unshift([{ v: extraTitle, s: "title" }]);
    return { name: def.sheet, cols: [6, ...def.cols.map((c) => c.w), ...(def.files ? [30] : [])], rows };
  };
  sheets.push(table("revisions"));

  const ov = p.overview;
  const ovRows = [[{ v: `설비/품목명: ${ov.name}`, s: "title" }], [], head(["분류", "항목", "비고"])];
  for (const [k, label] of OVERVIEW_FIELDS) ovRows.push([{ v: label, s: "head" }, { v: ov[k] || "", s: "cell" }, { v: "", s: "cell" }]);
  for (const x of ov.extra) ovRows.push([{ v: x.label, s: "head" }, { v: x.value, s: "cell" }, { v: "", s: "cell" }]);
  ovRows.push([{ v: "상태", s: "head" }, { v: ov.status, s: "cell" }, { v: "", s: "cell" }],
    [{ v: "담당자", s: "head" }, { v: ov.manager, s: "cell" }, { v: "", s: "cell" }]);
  const kdx = keyDates(p);
  for (const [k, label] of KEY_DATES.filter(([k]) => k !== "receiveDate")) ovRows.push([{ v: label, s: "head" }, { v: kdx[k].value, s: kdx[k].value ? "date" : "cell" }, { v: kdx[k].auto ? "자동" : "", s: "cell" }]);
  ovRows.push([{ v: "Warranty 기간", s: "head" }, { v: kdx.warranty.text, s: "cell" }, { v: kdx.warranty.state, s: "cell" }]);
  const ci = contractInfo(p);
  ovRows.push([{ v: "발주일", s: "head" }, { v: ov.orderDate || "", s: ov.orderDate ? "date" : "cell" }, { v: "", s: "cell" }],
    [{ v: "발주금액", s: "head" }, { v: ci.amount || "", s: "cell" }, { v: ci.amount ? `부가세 ${ov.vat || "별도"} · 금 ${koreanAmount(ci.amount)}원정` : "", s: "cell" }]);
  ovRows.push([{ v: "실행 예가", s: "head" }, { v: ci.estimateCost || "", s: "money" }, { v: ci.estProfit != null ? `예상 이익 ${fmtWon(ci.estProfit)} (${(ci.estRate * 100).toFixed(1)}%)` : "", s: "cell" }],
    [{ v: "실행가", s: "head" }, { v: ci.actualCost || "", s: "money" }, { v: ci.profit != null ? `이익 ${fmtWon(ci.profit)} (${(ci.profitRate * 100).toFixed(1)}%)` : "", s: "cell" }],
    [{ v: "실행목표가", s: "head" }, { v: ci.targetCost || "", s: "money" }, { v: ci.targetRate != null ? `목표 이익률 ${(ci.targetRate * 100).toFixed(1)}%` : "", s: "cell" }]);
  for (const x of ci.payments) ovRows.push([{ v: `정산: ${x.name}`, s: "head" }, { v: `${x.ratio}% · ${fmtWon(x.amount)} · ${x.cond || ""}`, s: "cell" },
    { v: [x.status, x.paidDate].filter(Boolean).join(" "), s: "cell" }]);
  sheets.push({ name: "개요", cols: [16, 60, 24], rows: ovRows, merges: ["A1:C1"] });

  for (const sp of ensureSpecs(p)) {
    const rows = [head(["NO", ...SPEC_COLS.map((c) => c.label)])];
    sp.rows.forEach((r, i) => rows.push([{ v: i + 1, s: "cell" }, ...SPEC_COLS.map((c) => cellOf(c, r[c.key]))]));
    if (sp.note) rows.push([], [{ v: sp.note, s: "wrap" }]);
    const fileList = fileNames(sp.files.filter((id) => !Store.fileMeta(id)?.type.startsWith("image/")));
    if (fileList) rows.push([], [{ v: `첨부 파일: ${fileList}`, s: "wrap" }]);
    sheets.push({ name: sp.name, cols: [6, ...SPEC_COLS.map((c) => c.w)], rows, images: await imageEntries(sp.files, rows.length + 1) });
  }
  sheets.push(table("supplied", "지정품/지급품"), table("consumables", "소모품"), ...unitBomSheets(p), table("submissions"), table("changes"));

  const dated = [
    ...p.records.map((r) => ({ date: r.date, kind: "record", r })),
    ...p.meetings.map((m) => ({ date: m.date, kind: "meeting", m })),
  ].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  for (const x of dated) {
    if (x.kind === "record") {
      const r = x.r;
      const rows = [[{ v: r.title, s: "title" }], [],
        [{ v: "날짜", s: "head" }, { v: r.date, s: "date" }], [{ v: "구분", s: "head" }, { v: r.kind, s: "cell" }],
        [{ v: "보낸 곳", s: "head" }, { v: r.from, s: "cell" }], [{ v: "받는 곳", s: "head" }, { v: r.to, s: "cell" }],
        [{ v: "첨부 파일", s: "head" }, { v: fileNames(r.files), s: "cell" }]];
      if (r.memo) rows.push([], [{ v: r.memo, s: "wrap" }]);
      const images = await imageEntries(r.images, rows.length + 1);
      sheets.push({ name: `${r.title}(${fmtDot(r.date)})`, cols: [14, 90], rows, images });
    } else {
      const m = x.m;
      const rows = [[{ v: "회     의     록", s: "title" }], [],
        [{ v: "부 서 명", s: "head" }, { v: m.dept, s: "cell" }, { v: "작 성 자", s: "head" }, { v: m.writer, s: "cell" }],
        [{ v: "회의일자", s: "head" }, { v: m.date, s: "date" }, { v: "회의장소", s: "head" }, { v: m.place, s: "cell" }],
        [{ v: "회의시간", s: "head" }, { v: m.time, s: "cell" }, { v: "구분", s: "head" }, { v: m.kind, s: "cell" }],
        [{ v: "제   목", s: "head" }, { v: m.title, s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }],
        [{ v: "참 석 자", s: "head" }, { v: m.attendees, s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }],
        [], [{ v: "회 의 내 용", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }, { v: "", s: "head" }],
        [{ v: m.content, s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }],
        [], [{ v: "실천 의제", s: "title" }], head(["지시 내용", "담당자", "기한", "완료"])];
      const merges = ["A1:D1", "B6:D6", "B7:D7", "A9:D9", "A10:D10"];
      for (const a of m.actions) rows.push([{ v: a.text, s: "cell" }, { v: a.owner, s: "cell" }, { v: a.due, s: isDate(a.due) ? "date" : "cell" }, { v: a.done ? "완료" : "", s: "cell" }]);
      rows.push([], [{ v: "특이사항", s: "head" }, { v: m.notes, s: "cell" }, { v: "", s: "cell" }, { v: "", s: "cell" }]);
      merges.push(`B${rows.length}:D${rows.length}`);
      if (m.files?.length) rows.push([{ v: "첨부 파일", s: "head" }, { v: fileNames(m.files), s: "cell" }]);
      const images = await imageEntries(m.files || [], rows.length + 1);
      sheets.push({ name: `${m.title}(${fmtDot(m.date)})`, cols: [40, 30, 14, 40], rows, merges, images });
    }
  }

  const base = today();
  const sRows = [[{ v: "일정", s: "title" }, null, null, null, null, null, null, null, { v: "기준일", s: "head" }, { v: base, s: "date" }], [],
    head(["단계", "세부사항", "비고", "담당자", "시작일", "종료일", "기간", "경과일", "잔여일", "상태"])];
  for (const t of p.schedule) {
    const info = taskInfo(t, base);
    sRows.push([{ v: t.phase, s: "cell" }, { v: t.name, s: "cell" }, { v: t.note, s: "cell" }, { v: t.owner, s: "cell" },
      { v: t.start, s: "date" }, { v: t.end, s: "date" }, { v: info.dur, s: "cell" }, { v: info.elapsed, s: "cell" },
      { v: info.remain, s: "cell" }, { v: info.status, s: "cell" }]);
  }
  sheets.push({ name: "일정", cols: [14, 28, 18, 10, 12, 12, 7, 7, 7, 8], rows: sRows });
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
function contractInfo(p) {
  const o = p.overview;
  const amount = toAmount(o.orderAmount);
  const payments = (o.payments || []).map((x) => ({ ...x, amount: Math.round((amount * (Number(x.ratio) || 0)) / 100) }));
  const ratioSum = payments.reduce((a, x) => a + (Number(x.ratio) || 0), 0);
  const paid = payments.filter((x) => x.status === "수금완료");
  // 실행 예가(예상) · 실행목표가 · 실행가(실제)
  const estimateCost = toAmount(o.estimateCost), targetCost = toAmount(o.targetCost), actualCost = toAmount(o.actualCost);
  const rate = (cost) => (amount && cost ? (amount - cost) / amount : null);
  return { amount, payments, ratioSum, paidAmount: paid.reduce((a, x) => a + x.amount, 0),
    paidRatio: paid.reduce((a, x) => a + (Number(x.ratio) || 0), 0),
    estimateCost, targetCost, actualCost,
    estProfit: amount && estimateCost ? amount - estimateCost : null, estRate: rate(estimateCost),
    targetProfit: amount && targetCost ? amount - targetCost : null, targetRate: rate(targetCost),
    profit: amount && actualCost ? amount - actualCost : null, profitRate: rate(actualCost),
    // 목표 대비: 실행가가 있으면 실행가, 없으면 실행 예가 기준
    overBasis: actualCost ? "실행가" : estimateCost ? "실행 예가" : "",
    overBudget: targetCost && (actualCost || estimateCost) ? (actualCost || estimateCost) - targetCost : null };
}

// ------------------------------------------------- 완료 프로젝트 마감 보고서 (엑셀 양식)
const addYears = (s, years) => {
  const d = new Date(Date.UTC(+s.slice(0, 4) + years, +s.slice(5, 7) - 1, +s.slice(8, 10)) - 86400000);
  return d.toISOString().slice(0, 10);
};
// 보고서에 들어갈 값: 직접 입력한 값(p.report)이 있으면 그것을, 없으면 프로그램 데이터에서 자동으로
// 주요 일자: 개요에 직접 입력한 값이 있으면 그것을, 없으면 다른 자료에서 자동으로
// 납품일자는 개요의 입고일자(receiveDate)를 그대로 쓴다
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
  out.deliveryDate = out.receiveDate;
  // Warranty: 시작일을 직접 넣었거나 Setup 완료일이 있을 때만 시작일이 정해진다 (납품일로 짐작하지 않음)
  // 기간(년)은 예전 '하자보증기간' 글자에서도 읽어 온다
  const parsed = (/(\d+(?:\.\d+)?)\s*년/.exec(o.warranty) || [])[1] || ((/(\d+)\s*개월/.exec(o.warranty) || [])[1] ? String(+(/(\d+)\s*개월/.exec(o.warranty)[1]) / 12) : "");
  const years = Number(o.warrantyYears || parsed) || 0;
  const start = isDate(o.warrantyStart) ? o.warrantyStart : out.setupDate.value || "";
  const end = isDate(start) && years ? addYears(start, years) : "";
  const started = isDate(start) && start <= today();
  const period = years ? `${years}년` : o.warranty || "";
  out.warranty = { start, startAuto: !isDate(o.warrantyStart) && !!start, years, end, started,
    // 보고서용 글자: 정해진 기간 또는 예정
    text: end ? `${start} ~ ${end} (${years}년)` : start ? `${start} 시작${period ? ` (${period})` : ""}` : period ? `Setup 완료 후 ${period}` : "",
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
  const openTasks = p.schedule.filter((t) => !t.done).length, unpaid = c.payments.filter((x) => x.status !== "수금완료").length;
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
    profit: orderAmount && actualCost ? orderAmount - actualCost : null,
    profitRate: orderAmount && actualCost ? (orderAmount - actualCost) / orderAmount : null,
    auto,
  };
}

// projects 를 열(D, E, F…)로 나란히 놓은 "완료 프로젝트 마감 보고서" + 종합 (+ 한 프로젝트면 세부 시트)
async function buildClosingWorkbook(projects) {
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
    [null, { v: "완료 프로젝트 마감 보고서", s: "title" }], [],
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
    row("", "이익", (x, i) => (x.orderAmount && x.actualCost ? { f: `${col(i)}14-${col(i)}17`, v: x.profit, s: "moneyb" } : txt(""))),
    row("", "이익률", (x, i) => (x.orderAmount && x.actualCost ? { f: `IF(${col(i)}14=0,"",${col(i)}18/${col(i)}14)`, v: x.profitRate, s: "pct" } : txt(""))),
    [], [null, { v: `※ 이익 = 발주가 - 실행가, 이익률 = 이익 / 발주가 · 출력일 ${today()}`, s: "wrap" }],
  ];
  // 긴 글자 행은 줄 수만큼 높이를 키운다 (열 너비 34 ≈ 한 줄 17자)
  const lines = (t) => String(t || "").split("\n").reduce((a, l) => a + Math.max(1, Math.ceil([...l].reduce((w, ch) => w + (ch.charCodeAt(0) > 255 ? 2 : 1), 0) / 32)), 0);
  const heights = { 0: 30, 2: 22 };
  rows.forEach((row, r) => {
    if (r < 3 || !row) return;
    const max = Math.max(1, ...row.slice(3).map((c) => lines(c && typeof c === "object" ? c.v : c)));
    heights[r] = Math.max(20, max * 15 + 5);
  });
  const sheets = [{ name: "완료프로젝트 마감보고서", cols: [3, 14, 24, ...infos.map(() => 34)], rows, heights,
    merges: [`B1:${last}1`, "B4:B7", "B8:B11", "B12:B19", `B21:${last}21`] }];

  // 종합: 프로젝트별 금액
  const sum = [[null, { v: "** 프로젝트별 금액", s: "title" }, null, null, null, null, null, { v: "단위 (원)", s: "wrap" }],
    [null, ...["발주명", "수주가", "실적가", "실투입재료비", "이익 (수주가 - 재료비)", "이익률 (수주가 기준)", "비고"].map(H)]];
  infos.forEach((x, i) => {
    const r = 3 + i;
    sum.push([null, txt(x.projectName), money(x.orderAmount), money(x.salesActual), money(x.actualCost),
      x.orderAmount && x.actualCost ? { f: `C${r}-E${r}`, v: x.profit, s: "money" } : txt(""),
      x.orderAmount && x.actualCost ? { f: `IF(C${r}=0,"",(C${r}-E${r})/C${r})`, v: x.profitRate, s: "pct" } : txt(""),
      txt(projects[i].report?.summary ? projects[i].report.summary.split("\n")[0] : "")]);
  });
  if (infos.length > 1) {
    const n = infos.length + 2;
    sum.push([null, H("합계"), { f: `SUM(C3:C${n})`, v: infos.reduce((a, x) => a + (x.orderAmount || 0), 0), s: "moneyb" },
      { f: `SUM(D3:D${n})`, v: infos.reduce((a, x) => a + (x.salesActual || 0), 0), s: "moneyb" },
      { f: `SUM(E3:E${n})`, v: infos.reduce((a, x) => a + (x.actualCost || 0), 0), s: "moneyb" },
      { f: `SUM(F3:F${n})`, s: "moneyb" }, { f: `IF(C${n + 1}=0,"",F${n + 1}/C${n + 1})`, s: "pct" }, txt("")]);
  }
  sheets.push({ name: "종합", cols: [3, 40, 16, 16, 16, 18, 14, 40], rows: sum });

  // 한 프로젝트만 내려받을 때는 근거 자료 시트도 함께
  if (projects.length === 1) {
    const p = projects[0], c = contractInfo(p);
    if (c.payments.length) sheets.push({ name: "정산 내역", cols: [3, 12, 9, 16, 22, 12, 10], rows: [
      [null, { v: "정산 내역", s: "title" }], [],
      [null, ...["구분", "비율", "금액", "지급 조건", "정산일", "상태"].map(H)],
      ...c.payments.map((x) => [null, txt(x.name), { v: (Number(x.ratio) || 0) / 100, s: "pct" }, money(x.amount), txt(x.cond), date(x.paidDate), txt(x.status)]),
      [null, H("합계"), { v: c.ratioSum / 100, s: "pct" }, { v: c.payments.reduce((a, x) => a + x.amount, 0), s: "moneyb" }]] });
    if (p.schedule.length) sheets.push({ name: "일정 실적", cols: [3, 14, 28, 12, 12, 12, 8, 30], rows: [
      [null, { v: "일정 실적", s: "title" }], [],
      [null, ...["단계", "세부사항", "계획 시작", "계획 종료", "실제 완료", "완료", "비고"].map(H)],
      ...p.schedule.map((t) => [null, txt(t.phase), txt(t.name), date(t.start), date(t.end), date(t.doneDate), txt(t.done ? "완료" : "미완료"), txt(t.note)])] });
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
