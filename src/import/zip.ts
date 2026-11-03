// 層 1 の下回り：xlsx の zip を読み書きする小さな道具（依存を足さないため。ブラウザと Node の両方にある
// DecompressionStream の deflate-raw で解き、書くときは無圧縮で詰める）。
// zip64・暗号化・分割は扱わず、理由をつけて止める（黙って読み落とさない）。

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

function u16(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}
function u32(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16) | ((b[o + 3] ?? 0) << 24)) >>> 0;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** zip の中のファイルをすべて取り出す（フォルダの項目は除く）。 */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  // 終わりの記録（EOCD）を後ろから探す（注釈は 65535 バイトまで）
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError("zip の終わりの記録が無い（xlsx ではないか、壊れている）");
  const total = u16(bytes, eocd + 10);
  const cdOffset = u32(bytes, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new ZipError("zip64 の xlsx は読めない");
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < total; i++) {
    if (u32(bytes, p) !== SIG_CEN) throw new ZipError("zip の目次が壊れている");
    const flags = u16(bytes, p + 8);
    const method = u16(bytes, p + 10);
    const csize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const local = u32(bytes, p + 42);
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLen);
    const name = new TextDecoder(flags & 0x800 ? "utf-8" : "utf-8").decode(nameBytes);
    p += 46 + nameLen + extraLen + commentLen;
    if (flags & 0x1) throw new ZipError("暗号化した xlsx は読めない");
    if (name.endsWith("/")) continue;
    if (u32(bytes, local) !== SIG_LOC) throw new ZipError("zip の中身の頭が壊れている");
    const lNameLen = u16(bytes, local + 26);
    const lExtraLen = u16(bytes, local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    let data: Uint8Array;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflateRaw(raw);
    else throw new ZipError(`zip の圧縮の方式 ${method} は読めない`);
    out.push({ name, data });
  }
  return out;
}

let crcTable: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = (crcTable[(c ^ (data[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 無圧縮の zip に詰める（読み手に渡すためだけ。日時は固定）。 */
export function writeZip(entries: ZipEntry[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const crc = crc32(e.data);
    const loc = new Uint8Array(30 + name.length);
    const dv = new DataView(loc.buffer);
    dv.setUint32(0, SIG_LOC, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 0x800, true);
    dv.setUint16(8, 0, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, 0x21, true); // 1980-01-01
    dv.setUint32(14, crc, true);
    dv.setUint32(18, e.data.length, true);
    dv.setUint32(22, e.data.length, true);
    dv.setUint16(26, name.length, true);
    dv.setUint16(28, 0, true);
    loc.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x21, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    parts.push(loc, e.data);
    central.push(cen);
    offset += loc.length + e.data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const size = all.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(size);
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
