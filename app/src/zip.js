// ---------------------------------------------------------------------------
// ZIP 읽기/쓰기 (xlsx 파일과 백업 파일 처리용). 브라우저 내장 압축 API만 사용한다.
// ---------------------------------------------------------------------------
const Zip = (() => {
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  const inflate = (b) => pipe(b, new DecompressionStream("deflate-raw"));
  const deflate = (b) => pipe(b, new CompressionStream("deflate-raw"));

  // 읽기: { "경로": Entry } 를 돌려주고, 각 Entry 는 필요할 때 bytes()/text() 로 압축을 푼다.
  async function read(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("ZIP 형식의 파일이 아닙니다.");
    const count = view.getUint16(eocd + 10, true);
    let p = view.getUint32(eocd + 16, true);
    const entries = {};
    const utf8 = new TextDecoder("utf-8");
    let euckr = null;
    try { euckr = new TextDecoder("euc-kr"); } catch {}
    const utf8Valid = (b) => { try { new TextDecoder("utf-8", { fatal: true }).decode(b); return true; } catch { return false; } };
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error("손상된 ZIP 파일입니다.");
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const nlen = view.getUint16(p + 28, true);
      const xlen = view.getUint16(p + 30, true);
      const clen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      let name = (view.getUint16(p + 8, true) & 0x0800) || !euckr ? utf8.decode(buf.subarray(p + 46, p + 46 + nlen))
        : utf8Valid(buf.subarray(p + 46, p + 46 + nlen)) ? utf8.decode(buf.subarray(p + 46, p + 46 + nlen)) : euckr.decode(buf.subarray(p + 46, p + 46 + nlen));
      // Unicode Path 추가 필드(0x7075)가 있으면 그 UTF-8 이름을 씀
      for (let x = p + 46 + nlen; x + 4 <= p + 46 + nlen + xlen;) {
        const tag = view.getUint16(x, true), size = view.getUint16(x + 2, true);
        if (tag === 0x7075 && size > 5) name = utf8.decode(buf.subarray(x + 9, x + 4 + size));
        x += 4 + size;
      }
      p += 46 + nlen + xlen + clen;
      if (name.endsWith("/")) continue;
      const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
      const raw = buf.subarray(start, start + csize);
      let cache;
      const bytes = () => (cache ||= method === 0 ? Promise.resolve(raw) : method === 8 ? inflate(raw)
        : Promise.reject(new Error(`지원하지 않는 압축 방식입니다: ${name}`)));
      entries[name] = { name, bytes, text: async () => utf8.decode(await bytes()) };
    }
    return entries;
  }

  // 쓰기: files = [{ name, data: Uint8Array|string|Blob, compress?: boolean }]
  // 한글 파일 이름: 윈도우 기본 압축 풀기(특히 윈도우 10)는 UTF-8 표시를 모르고 CP949 로 읽으므로
  // 이름은 CP949 로 쓰고, 반디집·7-Zip 등을 위해 UTF-8 이름을 Unicode Path 추가 필드(0x7075)로 함께 넣는다.
  let cp949 = null;
  function cp949Map() {
    if (cp949) return cp949;
    cp949 = new Map();
    try {
      const dec = new TextDecoder("euc-kr", { fatal: false });
      for (let lead = 0x81; lead <= 0xfe; lead++) {
        const buf = [];
        for (let trail = 0x41; trail <= 0xfe; trail++) buf.push(lead, trail, 0x0a);
        const parts = dec.decode(new Uint8Array(buf)).split("\n");
        for (let i = 0, trail = 0x41; trail <= 0xfe; trail++, i++) {
          const ch = parts[i];
          if (ch && ch.length === 1 && ch !== "\ufffd" && !cp949.has(ch)) cp949.set(ch, [lead, trail]);
        }
      }
    } catch { /* euc-kr 디코더가 없으면 UTF-8 이름만 사용 */ }
    return cp949;
  }
  function encodeCp949(str) {
    const map = cp949Map(), out = [];
    for (const ch of str) {
      const c = ch.codePointAt(0);
      if (c < 0x80) out.push(c);
      else if (map.has(ch)) out.push(...map.get(ch));
      else return null; // CP949 로 못 쓰는 글자 → UTF-8 이름 사용
    }
    return new Uint8Array(out);
  }
  // 이름 바이트, UTF-8 표시 여부, 추가 필드
  function entryName(name, enc) {
    const utf8 = enc.encode(name);
    if (/^[\x00-\x7f]*$/.test(name)) return { bytes: utf8, flag: 0, extra: new Uint8Array(0) };
    const local = encodeCp949(name);
    if (!local) return { bytes: utf8, flag: 0x0800, extra: new Uint8Array(0) };
    const extra = new DataView(new ArrayBuffer(9 + utf8.length));
    extra.setUint16(0, 0x7075, true);
    extra.setUint16(2, 5 + utf8.length, true);
    extra.setUint8(4, 1);
    extra.setUint32(5, crc32(local), true);
    new Uint8Array(extra.buffer).set(utf8, 9);
    return { bytes: local, flag: 0, extra: new Uint8Array(extra.buffer) };
  }

  async function write(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      let data = f.data;
      if (typeof data === "string") data = enc.encode(data);
      else if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
      const { bytes: name, flag, extra } = entryName(f.name, enc);
      const crc = crc32(data);
      let body = data, method = 0;
      if (f.compress !== false && data.length > 64) {
        const z = await deflate(data);
        if (z.length < data.length) { body = z; method = 8; }
      }
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, flag, true); // 0x0800 = UTF-8 파일명 (CP949 로 쓸 수 없을 때만)
      head.setUint16(8, method, true);
      head.setUint16(10, dosTime, true);
      head.setUint16(12, dosDate, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, body.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      head.setUint16(28, extra.length, true);
      parts.push(head, name, extra, body);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, flag, true);
      cen.setUint16(10, method, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, body.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint16(30, extra.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen, name, extra);
      offset += 30 + name.length + extra.length + body.length;
    }
    const csize = central.reduce((n, x) => n + x.byteLength, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: "application/zip" });
  }

  return { read, write };
})();
