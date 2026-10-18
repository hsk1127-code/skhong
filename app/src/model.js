// ---------------------------------------------------------------------------
// 화면 구성 정의, 일정 계산, 엑셀 불러오기/내보내기
// ---------------------------------------------------------------------------
const PROJECT_STATUSES = ["계획", "진행", "보류", "완료"];
const RECORD_KINDS = ["문의", "답변", "자료", "공지", "기타"];
const PART_COLS = [
  { key: "kind", label: "구분", w: 12 }, { key: "item", label: "품목", w: 22 }, { key: "model", label: "모델명", w: 22 },
  { key: "maker", label: "업체명", w: 16 }, { key: "qty", label: "개수", w: 7, type: "number" }, { key: "note", label: "비고", w: 24 },
];
const SPEC_COLS = [
  { key: "kind", label: "구분", w: 12 }, { key: "item", label: "항목", w: 22 },
  { key: "content", label: "내용", w: 50, type: "textarea" }, { key: "review", label: "검토", w: 16 },
];
const LISTS = {
  sw: { title: "SW 사양", sheet: "SW 사양", cols: SPEC_COLS },
  hw: { title: "HW 주요 Spec", sheet: "HW 주요 Spec", cols: SPEC_COLS },
  supplied: { title: "지정품/지급품", sheet: "지정품_지급품", cols: PART_COLS },
  consumables: { title: "소모품", sheet: "소모품", cols: PART_COLS },
  bom: { title: "BOM", sheet: "BOM", cols: PART_COLS },
  submissions: { title: "제출 자료", sheet: "제출 자료", files: true, cols: [
    { key: "item", label: "자료명", w: 30 }, { key: "to", label: "제출처", w: 14 },
    { key: "due", label: "기한", w: 12, type: "date" }, { key: "submitted", label: "제출일", w: 12, type: "date" },
    { key: "status", label: "상태", w: 9, type: "select", options: ["미제출", "제출", "승인", "반려"] },
    { key: "note", label: "비고", w: 24 }] },
  changes: { title: "변경사항", sheet: "변경사항", files: true, cols: [
    { key: "date", label: "날짜", w: 12, type: "date" }, { key: "author", label: "작성자", w: 10 },
    { key: "requester", label: "요청자", w: 10 }, { key: "content", label: "변경 내용", w: 50, type: "textarea" },
    { key: "note", label: "비고", w: 20 }] },
  revisions: { title: "Revision", sheet: "Revision", cols: [
    { key: "date", label: "날짜", w: 12, type: "date" }, { key: "author", label: "작성자", w: 10 },
    { key: "content", label: "내용", w: 50, type: "textarea" }, { key: "note", label: "비고", w: 20 }] },
};
const OVERVIEW_FIELDS = [
  ["project", "Project"], ["projectNo", "Project No"], ["partNo", "Part No"], ["customer", "고객사"],
  ["receiveDate", "입고일자"], ["receivePlace", "입고 장소"], ["scope", "사업 범위"], ["warranty", "하자보증기간"],
];

const listRows = (p, key) => (key === "revisions" ? p.revisions : p.lists[key]);

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
function projectSummary(p, base = today()) {
  const dated = p.schedule.filter((t) => isDate(t.start) && isDate(t.end));
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

function parseMeeting(sheet, fileIds) {
  const lines = sheetLines(sheet);
  const m = { id: Store.uid(), title: titleFromSheet(sheet.name), dept: "", writer: "", date: dateFromText(sheet.name), time: "",
    place: "", kind: "", attendees: "", content: "", actions: [], notes: "", files: fileIds };
  const LABELS = { 부서명: "dept", 작성자: "writer", 회의일자: "date", 회의장소: "place", 회의시간: "time", 구분: "kind", 제목: "title", 참석자: "attendees" };
  let section = "head", lastLabel = "";
  const content = [], notes = [];
  for (const vals of lines) {
    const n0 = norm(vals[0]);
    if (n0 === "회의록") continue;
    if (n0 === "회의내용") { section = "content"; continue; }
    if (n0 === "실천의제") { section = "actions"; continue; }
    if (n0 === "특이사항") { section = "notes"; if (vals.length > 1) notes.push(vals.slice(1).join(" ")); continue; }
    if (section === "head") {
      let matched = false;
      for (let i = 0; i < vals.length; i++) {
        const key = LABELS[norm(vals[i])];
        if (key) {
          matched = true;
          lastLabel = key;
          const v = vals[i + 1] && !LABELS[norm(vals[i + 1])] ? vals[i + 1] : "";
          if (key === "date") m.date = dateFromText(v) || m.date;
          else if (key === "kind") m.kind = (/■\s*(비?정례)/.exec(v) || [])[1] || v.replace(/[□■]/g, "").trim();
          else m[key] = v;
        }
      }
      if (!matched && lastLabel === "attendees") m.attendees += "\n" + vals.join(" ");
    } else if (section === "content") {
      if (norm(vals[0]) === "no" && vals.some((v) => norm(v) === "주요내용")) continue;
      content.push(/^\d+$/.test(vals[0]) && vals.length > 1 ? `${vals[0]}. ${vals.slice(1).join("  ")}` : vals.join("  "));
    } else if (section === "actions") {
      if (vals.some((v) => norm(v) === "지시내용")) continue;
      m.actions.push({ id: Store.uid(), text: vals[0] || "", owner: vals[1] || "", due: dateFromText(vals[2]) || vals[2] || "", done: false, note: vals[3] || "" });
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
          .map((v) => ({ id: Store.uid(), item: v.join(" "), to: "", due: "", submitted: "", status: "미제출", note: "" }));
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
  if (!p.revisions.length) p.revisions.push({ id: Store.uid(), date: today(), author: Store.state.settings.user, content: "신규 작성", note: "" });
  p.revisions.push({ id: Store.uid(), date: today(), author: Store.state.settings.user, content: `엑셀에서 가져옴: ${file.name}`, note: "" });
  p.records.sort((a, b) => a.date.localeCompare(b.date));
  p.meetings.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return p;
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
  sheets.push({ name: "개요", cols: [16, 60, 24], rows: ovRows, merges: ["A1:C1"] });

  sheets.push(table("sw"));
  const hw = table("hw");
  if (p.hwNote) hw.rows.push([], [{ v: p.hwNote, s: "wrap" }]);
  hw.images = await imageEntries(p.hwImages, hw.rows.length + 1);
  sheets.push(hw);
  sheets.push(table("supplied", "지정품/지급품"), table("consumables", "소모품"), table("bom", "BOM"), table("submissions"), table("changes"));

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
  await add("HW 주요 Spec", p.hwImages);
  for (const key of ["submissions", "changes"]) for (const r of p.lists[key]) await add(`${LISTS[key].title}_${r.item || r.content || ""}`.slice(0, 60), r.files);
  return Zip.write(files);
}
