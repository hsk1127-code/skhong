// ---------------------------------------------------------------------------
// 엑셀(xlsx) 읽기/쓰기
// ---------------------------------------------------------------------------
const Xlsx = (() => {
  const parse = (text) => new DOMParser().parseFromString(text, "application/xml");
  const all = (node, tag) => Array.from(node.getElementsByTagNameNS("*", tag));
  const first = (node, tag) => node.getElementsByTagNameNS("*", tag)[0];
  const relAttr = (el, name) =>
    el.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", name) ||
    el.getAttribute("r:" + name);

  // "A1" -> {r:0, c:0}
  function addr(ref) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref);
    let c = 0;
    for (const ch of m[1]) c = c * 26 + ch.charCodeAt(0) - 64;
    return { r: Number(m[2]) - 1, c: c - 1 };
  }
  const colName = (c) => {
    let s = "";
    for (c += 1; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + ((c - 1) % 26)) + s;
    return s;
  };
  const resolve = (base, target) => {
    if (target.startsWith("/")) return target.slice(1);
    const parts = base.split("/").slice(0, -1);
    for (const seg of target.split("/")) {
      if (seg === "..") parts.pop();
      else if (seg !== ".") parts.push(seg);
    }
    return parts.join("/");
  };
  const relsPath = (path) => path.replace(/([^/]+)$/, "_rels/$1.rels");
  async function readRels(zip, path) {
    const entry = zip[relsPath(path)];
    if (!entry) return {};
    const out = {};
    for (const r of all(parse(await entry.text()), "Relationship")) {
      if (r.getAttribute("TargetMode") === "External") continue;
      out[r.getAttribute("Id")] = { type: r.getAttribute("Type"), path: resolve(path, r.getAttribute("Target")) };
    }
    return out;
  }

  const serialToDate = (n) => {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(n * 86400000));
    return d.toISOString().slice(0, 10);
  };
  function isDateFormat(id, code) {
    if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
    if (!code || code === "General") return false;
    const stripped = code.replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "").replace(/\\./g, "");
    return /[yd]/i.test(stripped) || /m{1,4}[^a-z]*d|d[^a-z]*m/i.test(stripped);
  }

  const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp",
    webp: "image/webp", emf: "image/x-emf", wmf: "image/x-wmf",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    pdf: "application/pdf" };
  const extOf = (p) => (p.split(".").pop() || "").toLowerCase();

  // 반환: { sheets: [{ name, rows: [[값]], merges: [{r1,c1,r2,c2}], images: [{row,col,ext,type,data}], embeds: [{ext,type,data}] }] }
  async function read(file) {
    const zip = await Zip.read(file);
    if (!zip["xl/workbook.xml"]) throw new Error("엑셀(xlsx) 파일이 아닙니다.");
    const wbRels = await readRels(zip, "xl/workbook.xml");

    const strings = [];
    if (zip["xl/sharedStrings.xml"]) {
      for (const si of all(parse(await zip["xl/sharedStrings.xml"].text()), "si")) {
        // 윗주(rPh) 안의 글자는 제외
        strings.push(all(si, "t").filter((t) => t.parentNode.localName !== "rPh").map((t) => t.textContent).join(""));
      }
    }
    const dateStyles = new Set();
    if (zip["xl/styles.xml"]) {
      const st = parse(await zip["xl/styles.xml"].text());
      const fmts = {};
      for (const f of all(st, "numFmt")) fmts[f.getAttribute("numFmtId")] = f.getAttribute("formatCode");
      const xfs = first(st, "cellXfs");
      if (xfs) all(xfs, "xf").forEach((xf, i) => {
        const id = Number(xf.getAttribute("numFmtId") || 0);
        if (isDateFormat(id, fmts[id])) dateStyles.add(i);
      });
    }

    const sheets = [];
    const wb = parse(await zip["xl/workbook.xml"].text());
    for (const s of all(wb, "sheet")) {
      const rel = wbRels[relAttr(s, "id")];
      if (!rel || !zip[rel.path] || !/worksheet$/.test(rel.type)) continue;
      const doc = parse(await zip[rel.path].text());
      const rows = [];
      for (const c of all(doc, "c")) {
        const { r, c: col } = addr(c.getAttribute("r"));
        const t = c.getAttribute("t");
        const vEl = first(c, "v");
        let v = vEl ? vEl.textContent : null;
        if (t === "s") v = strings[Number(v)] ?? "";
        else if (t === "inlineStr") v = all(c, "t").map((x) => x.textContent).join("");
        else if (t === "b") v = v === "1" ? "TRUE" : "FALSE";
        else if (t === "e") v = null;
        else if (v != null && t !== "str") {
          const n = Number(v);
          v = dateStyles.has(Number(c.getAttribute("s") || 0)) && n > 0 && n < 2958466 ? serialToDate(n) : n;
        }
        if (v === null || v === "") continue;
        (rows[r] ||= [])[col] = v;
      }
      const merges = all(doc, "mergeCell").map((m) => {
        const [a, b = a] = m.getAttribute("ref").split(":");
        const p = addr(a), q = addr(b);
        return { r1: p.r, c1: p.c, r2: q.r, c2: q.c };
      });

      const images = [], embeds = [];
      const sheetRels = await readRels(zip, rel.path);
      for (const sr of Object.values(sheetRels)) {
        if (/\/drawing$/.test(sr.type) && zip[sr.path]) {
          const drels = await readRels(zip, sr.path);
          const ddoc = parse(await zip[sr.path].text());
          for (const pic of all(ddoc, "pic")) {
            const blip = first(pic, "blip");
            const target = blip && drels[relAttr(blip, "embed")];
            if (!target || !zip[target.path]) continue;
            let anchor = pic.parentNode;
            while (anchor && !/Anchor$/.test(anchor.localName)) anchor = anchor.parentNode;
            const from = anchor && first(anchor, "from");
            const ext = extOf(target.path);
            images.push({
              row: from ? Number(first(from, "row").textContent) : 0,
              col: from ? Number(first(from, "col").textContent) : 0,
              ext, type: MIME[ext] || "application/octet-stream",
              data: await zip[target.path].bytes(),
            });
          }
        } else if (/\/(package|oleObject)$/.test(sr.type) && zip[sr.path]) {
          const ext = extOf(sr.path);
          if (ext === "bin") continue; // 원본 형식을 알 수 없는 OLE 개체는 제외
          embeds.push({ ext, type: MIME[ext] || "application/octet-stream", data: await zip[sr.path].bytes() });
        }
      }
      images.sort((a, b) => a.row - b.row || a.col - b.col);
      sheets.push({ name: s.getAttribute("name"), rows, merges, images, embeds });
    }
    return { sheets };
  }

  // ------------------------------------------------------------------ 쓰기
  const xmlEsc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
    // 엑셀이 허용하지 않는 제어 문자 제거
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const dateToSerial = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  };
  // 스타일 번호: 0 기본, 1 머리글, 2 테두리+줄바꿈, 3 날짜, 4 제목, 5 줄바꿈, 6 금액(#,##0), 7 비율(0.0%), 8 굵은 금액
  // 10~ : 엑셀 내보내기용 — th 진한 머리글, label 항목명, sec 구역 제목, c 가운데, ok/warn/bad/info 상태, big 큰 제목, note 작은 설명,
  //       total 합계 금액, moneyL 왼쪽 정렬 금액, rem 테두리 있는 작은 설명
  const STYLE = { head: 1, cell: 2, date: 3, title: 4, wrap: 5, money: 6, pct: 7, moneyb: 8, dateL: 9,
    th: 10, label: 11, sec: 12, c: 13, ok: 14, warn: 15, bad: 16, info: 17, big: 18, note: 19, total: 20, moneyL: 21, rem: 22 };
  const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/><numFmt numFmtId="165" formatCode="0.0%"/></numFmts>
<fonts count="11"><font><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/></font><font><b/><sz val="14"/><name val="맑은 고딕"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="맑은 고딕"/></font><font><b/><sz val="11"/><color rgb="FF2F3A9E"/><name val="맑은 고딕"/></font>
<font><b/><sz val="10"/><color rgb="FF15803D"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FF9A5B00"/><name val="맑은 고딕"/></font>
<font><b/><sz val="10"/><color rgb="FFB42318"/><name val="맑은 고딕"/></font><font><b/><sz val="10"/><color rgb="FF1D4ED8"/><name val="맑은 고딕"/></font>
<font><b/><sz val="16"/><color rgb="FF2F3A9E"/><name val="맑은 고딕"/></font><font><sz val="9"/><color rgb="FF6B7280"/><name val="맑은 고딕"/></font></fonts>
<fills count="11"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7ECF3"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3B46B8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F5F9"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE8EBFA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF4DB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFDECEC"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7EEFC"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF0FB"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFB7BEC8"/></left><right style="thin"><color rgb="FFB7BEC8"/></right><top style="thin"><color rgb="FFB7BEC8"/></top><bottom style="thin"><color rgb="FFB7BEC8"/></bottom><diagonal/></border><border><left/><right/><top/><bottom style="medium"><color rgb="FF3B46B8"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="23">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="3" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1" indent="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="6" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="8" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="9" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="10" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="3" fontId="1" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="10" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  function safeSheetName(name, used) {
    let base = String(name || "Sheet").replace(/[\[\]:*?/\\]/g, " ").replace(/^'+|'+$/g, "").trim() || "Sheet";
    base = base.slice(0, 31);
    let n = base, i = 2;
    while (used.has(n.toLowerCase())) {
      const suffix = ` (${i++})`;
      n = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(n.toLowerCase());
    return n;
  }

  async function imageSize(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const size = { w: bmp.width, h: bmp.height };
      bmp.close();
      return size;
    } catch { return { w: 600, h: 400 }; }
  }

  // sheets: [{ name, cols: [너비], rows: [[셀]], merges: ["A1:C1"], images: [{ blob, ext, row, col, maxWidth }] }]
  // 셀: 문자열 | 숫자 | null | { v, s: "head"|"cell"|"date"|"title"|"wrap" }
  async function write(sheets) {
    const files = [];
    const used = new Set();
    const ctypes = [];
    const wbSheets = [], wbRels = [];
    let mediaNo = 0;
    const mediaExt = new Set();
    for (let i = 0; i < sheets.length; i++) {
      const sh = sheets[i], n = i + 1;
      const name = safeSheetName(sh.name, used);
      const out = [];
      (sh.rows || []).forEach((row, r) => {
        if (!row) return;
        const cells = [];
        row.forEach((cell, c) => {
          if (cell == null || cell === "") {
            if (cell === "" || (cell && cell.s)) cells.push(`<c r="${colName(c)}${r + 1}"/>`);
            return;
          }
          const o = typeof cell === "object" ? cell : { v: cell };
          const ref = `${colName(c)}${r + 1}`;
          const s = STYLE[o.s] ? ` s="${STYLE[o.s]}"` : "";
          if (o.f) cells.push(typeof o.v === "string" && o.v
            ? `<c r="${ref}"${s} t="str"><f>${xmlEsc(o.f)}</f><v>${xmlEsc(o.v)}</v></c>`
            : `<c r="${ref}"${s}><f>${xmlEsc(o.f)}</f>${typeof o.v === "number" && isFinite(o.v) ? `<v>${o.v}</v>` : ""}</c>`);
          else if (o.v == null || o.v === "") cells.push(`<c r="${ref}"${s}/>`);
          else if ((o.s === "date" || o.s === "dateL") && /^\d{4}-\d{2}-\d{2}$/.test(o.v)) cells.push(`<c r="${ref}"${s}><v>${dateToSerial(o.v)}</v></c>`);
          else if (typeof o.v === "number" && isFinite(o.v)) cells.push(`<c r="${ref}"${s}><v>${o.v}</v></c>`);
          else cells.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(o.v)}</t></is></c>`);
        });
        const ht = sh.heights?.[r];
        out.push(`<row r="${r + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells.join("")}</row>`);
      });
      const cols = (sh.cols || []).map((w, c) => w ? `<col min="${c + 1}" max="${c + 1}" width="${w}" customWidth="1"/>` : "").join("");
      const merges = (sh.merges || []).length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
      let drawing = "";
      if (sh.images?.length) {
        const anchors = [], rels = [];
        for (let k = 0; k < sh.images.length; k++) {
          const img = sh.images[k];
          const ext = (img.ext || "png").toLowerCase().replace("jpg", "jpeg");
          mediaExt.add(ext);
          const media = `image${++mediaNo}.${ext}`;
          files.push({ name: `xl/media/${media}`, data: img.blob, compress: false });
          rels.push(`<Relationship Id="rId${k + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${media}"/>`);
          const { w, h } = await imageSize(img.blob);
          const scale = Math.min(1, (img.maxWidth || 1000) / w);
          const cx = Math.round(w * scale * 9525), cy = Math.round(h * scale * 9525);
          anchors.push(`<xdr:oneCellAnchor><xdr:from><xdr:col>${img.col || 0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${img.row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${k + 2}" name="그림 ${k + 1}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${k + 1}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`);
        }
        files.push({ name: `xl/drawings/drawing${n}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${anchors.join("")}</xdr:wsDr>` });
        files.push({ name: `xl/drawings/_rels/drawing${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join("")}</Relationships>` });
        files.push({ name: `xl/worksheets/_rels/sheet${n}.xml.rels`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${n}.xml"/></Relationships>` });
        ctypes.push(`<Override PartName="/xl/drawings/drawing${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`);
        drawing = `<drawing r:id="rId1"/>`;
      }
      // 선택: tab(탭 색), grid:false(눈금선 숨김), freeze(이 행 수만큼 위를 고정), filter("A3:F20" 자동 필터),
      //       landscape(가로 인쇄) · fit(세로 인쇄) — 둘 다 용지 너비에 맞춤
      const fit = sh.landscape || sh.fit;
      const sheetPr = sh.tab || fit ? `<sheetPr>${sh.tab ? `<tabColor rgb="FF${sh.tab}"/>` : ""}${fit ? '<pageSetUpPr fitToPage="1"/>' : ""}</sheetPr>` : "";
      const pane = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.freeze + 1}" sqref="A${sh.freeze + 1}"/>` : "";
      const view = `<sheetViews><sheetView workbookViewId="0"${sh.grid === false ? ' showGridLines="0"' : ""}${i === 0 ? ' tabSelected="1"' : ""}${pane ? `>${pane}</sheetView>` : "/>"}</sheetViews>`;
      const filter = sh.filter ? `<autoFilter ref="${sh.filter}"/>` : "";
      const setup = fit ? `<pageSetup paperSize="9" orientation="${sh.landscape ? "landscape" : "portrait"}" fitToWidth="1" fitToHeight="0"/>` : "";
      files.push({ name: `xl/worksheets/sheet${n}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${sheetPr}${view}<sheetFormatPr defaultRowHeight="16.5"/>${cols ? `<cols>${cols}</cols>` : ""}<sheetData>${out.join("")}</sheetData>${filter}${merges}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>${setup}${drawing}</worksheet>` });
      ctypes.push(`<Override PartName="/xl/worksheets/sheet${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      wbSheets.push(`<sheet name="${xmlEsc(name)}" sheetId="${n}" r:id="rId${n}"/>`);
      wbRels.push(`<Relationship Id="rId${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${n}.xml"/>`);
    }
    const styleRel = sheets.length + 1;
    wbRels.push(`<Relationship Id="rId${styleRel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`);
    const defaults = [...mediaExt].map((e) => `<Default Extension="${e}" ContentType="${MIME[e === "jpeg" ? "jpg" : e] || "image/" + e}"/>`).join("");
    files.unshift(
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${ctypes.join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${wbSheets.join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${wbRels.join("")}</Relationships>` },
      { name: "xl/styles.xml", data: STYLES_XML },
    );
    const blob = await Zip.write(files);
    return new Blob([blob], { type: MIME.xlsx });
  }

  return { read, write, colName, MIME };
})();
