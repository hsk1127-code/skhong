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
    for (let i = 0; i < count; i++) {
      if (view.getUint32(p, true) !== 0x02014b50) throw new Error("손상된 ZIP 파일입니다.");
      const method = view.getUint16(p + 10, true);
      const csize = view.getUint32(p + 20, true);
      const nlen = view.getUint16(p + 28, true);
      const xlen = view.getUint16(p + 30, true);
      const clen = view.getUint16(p + 32, true);
      const local = view.getUint32(p + 42, true);
      const name = utf8.decode(buf.subarray(p + 46, p + 46 + nlen));
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
      const name = enc.encode(f.name);
      const crc = crc32(data);
      let body = data, method = 0;
      if (f.compress !== false && data.length > 64) {
        const z = await deflate(data);
        if (z.length < data.length) { body = z; method = 8; }
      }
      const head = new DataView(new ArrayBuffer(30));
      head.setUint32(0, 0x04034b50, true);
      head.setUint16(4, 20, true);
      head.setUint16(6, 0x0800, true); // UTF-8 파일명
      head.setUint16(8, method, true);
      head.setUint16(10, dosTime, true);
      head.setUint16(12, dosDate, true);
      head.setUint32(14, crc, true);
      head.setUint32(18, body.length, true);
      head.setUint32(22, data.length, true);
      head.setUint16(26, name.length, true);
      parts.push(head, name, body);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint16(10, method, true);
      cen.setUint16(12, dosTime, true);
      cen.setUint16(14, dosDate, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, body.length, true);
      cen.setUint32(24, data.length, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen, name);
      offset += 30 + name.length + body.length;
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
