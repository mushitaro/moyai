// 層 1：文字のある PDF の読み手。pdf.js（pdfjs-dist 6.4.299）の文字と位置と、描く命令の一覧の罫線から、
// 頁ごとの「セルの格子＋出どころ（ファイル・頁・位置）」を組む。層 2 から先は形式を知らない（plan §2.3）。
// - 頁は上から順に 1 つの格子に積む（印刷した Excel の 1 シートと同じ形。頁ごとにくり返す見出しは層 2 が見つける）。
// - 行は文字の基準線、列は縦の罫線（あれば）、無ければ文字の左端の位置で決める。
// - どの文字の並びも、ちょうど 1 つのセルに入るか、読まなかった理由つきで台帳に数える（黙って捨てない）。
// - 文字の無い頁（スキャン）は推し量って読まず、写真の道に回す（写真の読み取りは未実装。呼ぶ側が質問にする）。
// 埋め込みの無い日本語の書体のために、cMap と標準の書体のデータは pdfjs-dist に同梱のものを使う
// （Node では legacy の build と同梱のフォルダ、タブではビルドに入れた同じファイル。外のサーバーからは取らない）。
// 標準の書体は Foxit の .pfb だけ（Liberation の .ttf は使用条件が GPL-2.0 なので配らない。どちらの環境でも読まない）。
import type { PDFDocumentProxy } from "pdfjs-dist";
import { cellRef, type GridCell, type LedgerEntry, type PageInfo, type SourceFile } from "./grid";

type Pdfjs = typeof import("pdfjs-dist");
type Matrix = [number, number, number, number, number, number];

/** pdf.js が cMap・標準の書体・wasm を求めるときの受け手（getDocument の BinaryDataFactory） */
interface BinaryFiles {
  fetch(req: { kind: string; filename: string }): Promise<Uint8Array>;
}
type BinaryFilesCtor = new (opts: unknown) => BinaryFiles;

// タブ（ブラウザ）：同梱のファイルを Vite のビルドの資産にし、その URL から読む（名前 → URL）。
// 標準の書体は Foxit の .pfb（BSD-3-Clause）だけを配る。同梱の Liberation の .ttf（GPL-2.0 と書体の例外）は配らない
// （THIRD_PARTY_NOTICES）。無い書体は pdf.js が内蔵の字の幅で読むので、文字は読める（描く形だけが変わる）
const CMAP_URLS = import.meta.glob("../../node_modules/pdfjs-dist/cmaps/*.bcmap", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const FONT_URLS = import.meta.glob("../../node_modules/pdfjs-dist/standard_fonts/*.pfb", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
/** 配るファイルの形（Node でもタブと同じものだけを読む。同じ入力からはどこでも同じ出力） */
const SHIPPED: Record<string, RegExp> = { cMapUrl: /\.bcmap$/, standardFontDataUrl: /\.pfb$/ };

function byFileName(map: Record<string, string>, filename: string): string | null {
  for (const [k, v] of Object.entries(map)) if (k.endsWith(`/${filename}`)) return v;
  return null;
}

class AssetFiles implements BinaryFiles {
  constructor(_opts: unknown) {}
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const map = kind === "cMapUrl" ? CMAP_URLS : kind === "standardFontDataUrl" ? FONT_URLS : null;
    const url = map && SAFE_NAME.test(filename) && SHIPPED[kind]?.test(filename) ? byFileName(map, filename) : null;
    // wasm（画像の復号）はビルドに入れていない。pdf.js は無ければ画像を飛ばす（画像は読まない物として数える）
    if (!url) throw new Error(`同梱に無いファイル：${kind} ${filename}`);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`同梱のファイルを読めない：${filename}（${r.status}）`);
    return new Uint8Array(await r.arrayBuffer());
  }
}

let loaded: Promise<{ lib: Pdfjs; Files: BinaryFilesCtor }> | null = null;

/** pdf.js を読み込む。Node（試験）は legacy の build と同梱のフォルダ、タブは通常の build とビルドに入れた worker */
function pdfjs(): Promise<{ lib: Pdfjs; Files: BinaryFilesCtor }> {
  loaded ??= (async () => {
    if (import.meta.env.SSR) {
      const [lib, fs, mod, path] = await Promise.all([
        import("pdfjs-dist/legacy/build/pdf.mjs") as unknown as Promise<Pdfjs>,
        import("node:fs/promises"),
        import("node:module"),
        import("node:path"),
      ]);
      const pkg = path.dirname(mod.createRequire(import.meta.url).resolve("pdfjs-dist/package.json"));
      class NodeFiles implements BinaryFiles {
        constructor(_opts: unknown) {}
        async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
          const dir = kind === "cMapUrl" ? "cmaps" : kind === "standardFontDataUrl" ? "standard_fonts" : null;
          if (!dir || !SAFE_NAME.test(filename) || !SHIPPED[kind]?.test(filename)) throw new Error(`同梱に無いファイル：${kind} ${filename}`);
          return new Uint8Array(await fs.readFile(path.join(pkg, dir, filename)));
        }
      }
      return { lib, Files: NodeFiles };
    }
    const [lib, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return { lib, Files: AssetFiles };
  })();
  return loaded;
}

// ─── 文字の並びと罫線 ───────────────────────────────────────────

interface Run {
  page: number;
  text: string;
  /** 頁の左上を原点にした pt */
  x: number;
  top: number;
  w: number;
  h: number;
  /** 基準線（上から） */
  base: number;
  size: number;
  bold: boolean;
}

interface Seg {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PageRead {
  page: number;
  width: number;
  height: number;
  runs: Run[];
  vertical: Seg[];
  horizontal: Seg[];
  /** 数えたもの（台帳に書く） */
  whitespace: number;
  rotated: number;
  offPage: number;
  invisibleShows: number;
  visibleShows: number;
  images: number;
  annotations: number;
}

// 6.4.299 の描く命令の道の符号（DrawOPS）。版を上げたら確かめ直す（plan §2.3「罫線の取り方は 6.4.299 で確かめて固定する」）
const DRAW = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 } as const;
/** 罫線とみなす細さ（pt）と、短すぎる線を外す長さ（pt） */
const THIN = 2;
const MIN_RULE = 4;

function mul(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function asMatrix(v: unknown): Matrix | null {
  if (!v || typeof (v as ArrayLike<number>).length !== "number" || (v as ArrayLike<number>).length < 6) return null;
  const a = Array.from(v as ArrayLike<number>).slice(0, 6);
  return a.every((x) => Number.isFinite(x)) ? (a as Matrix) : null;
}

/** 道（moveTo・lineTo…）を、頁の座標の線分と小さな四角に分ける */
function pathPieces(data: ArrayLike<number>, m: Matrix): { segs: [number, number, number, number][]; rects: [number, number, number, number][] } {
  const segs: [number, number, number, number][] = [];
  const rects: [number, number, number, number][] = [];
  let sub: [number, number][] = [];
  let curved = false;
  const flush = () => {
    if (sub.length === 5 || sub.length === 4) {
      // 軸にそろった四角か（塗った細い四角を罫線として拾う）
      const pts = sub.length === 5 ? sub.slice(0, 4) : sub;
      const xs = [...new Set(pts.map((p) => Math.round(p[0] * 100)))];
      const ys = [...new Set(pts.map((p) => Math.round(p[1] * 100)))];
      if (!curved && xs.length === 2 && ys.length === 2) {
        const x0 = Math.min(...pts.map((p) => p[0]));
        const x1 = Math.max(...pts.map((p) => p[0]));
        const y0 = Math.min(...pts.map((p) => p[1]));
        const y1 = Math.max(...pts.map((p) => p[1]));
        rects.push([x0, y0, x1, y1]);
      }
    }
    sub = [];
    curved = false;
  };
  let i = 0;
  let cur: [number, number] | null = null;
  let start: [number, number] | null = null;
  while (i < data.length) {
    const op = data[i++];
    if (op === DRAW.moveTo) {
      flush();
      cur = apply(m, data[i] ?? 0, data[i + 1] ?? 0);
      start = cur;
      sub.push(cur);
      i += 2;
    } else if (op === DRAW.lineTo) {
      const p = apply(m, data[i] ?? 0, data[i + 1] ?? 0);
      if (cur) segs.push([cur[0], cur[1], p[0], p[1]]);
      cur = p;
      sub.push(p);
      i += 2;
    } else if (op === DRAW.curveTo) {
      cur = apply(m, data[i + 4] ?? 0, data[i + 5] ?? 0);
      curved = true;
      i += 6;
    } else if (op === DRAW.quadraticCurveTo) {
      cur = apply(m, data[i + 2] ?? 0, data[i + 3] ?? 0);
      curved = true;
      i += 4;
    } else if (op === DRAW.closePath) {
      if (cur && start && (cur[0] !== start[0] || cur[1] !== start[1])) segs.push([cur[0], cur[1], start[0], start[1]]);
      if (start) sub.push(start);
      cur = start;
    } else break; // 知らない符号：この道の残りは読まない（罫線を取りこぼすだけ）
  }
  flush();
  return { segs, rects };
}

async function readPage(lib: Pdfjs, doc: PDFDocumentProxy, n: number): Promise<PageRead> {
  const page = await doc.getPage(n);
  const vp = page.getViewport({ scale: 1 });
  const vpm = asMatrix(vp.transform) ?? [1, 0, 0, -1, 0, vp.height];
  const out: PageRead = {
    page: n,
    width: vp.width,
    height: vp.height,
    runs: [],
    vertical: [],
    horizontal: [],
    whitespace: 0,
    rotated: 0,
    offPage: 0,
    invisibleShows: 0,
    visibleShows: 0,
    images: 0,
    annotations: 0,
  };
  // 描く命令：罫線・画像・見えない文字を数える（書体もここで読み込まれ、太字が分かる）
  const ops = await page.getOperatorList();
  const O = lib.OPS;
  const strokeOps = new Set<number>([O.stroke, O.closeStroke, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const fillOps = new Set<number>([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke, O.closeFillStroke, O.closeEOFillStroke]);
  const imageOps = new Set<number>([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintImageMaskXObjectRepeat, O.paintSolidColorImageMask]);
  let ctm: Matrix = [1, 0, 0, 1, 0, 0];
  let mode = 0;
  const stack: { ctm: Matrix; mode: number }[] = [];
  const addSeg = (x1: number, y1: number, x2: number, y2: number) => {
    const [ax, ay] = apply(vpm, x1, y1);
    const [bx, by] = apply(vpm, x2, y2);
    const dx = Math.abs(bx - ax);
    const dy = Math.abs(by - ay);
    if (dy <= 0.5 && dx >= MIN_RULE) out.horizontal.push({ page: n, x1: Math.min(ax, bx), y1: (ay + by) / 2, x2: Math.max(ax, bx), y2: (ay + by) / 2 });
    else if (dx <= 0.5 && dy >= MIN_RULE) out.vertical.push({ page: n, x1: (ax + bx) / 2, y1: Math.min(ay, by), x2: (ax + bx) / 2, y2: Math.max(ay, by) });
  };
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i] as unknown[] | null;
    if (fn === O.save) stack.push({ ctm, mode });
    else if (fn === O.restore) {
      const s = stack.pop();
      if (s) ({ ctm, mode } = s);
    } else if (fn === O.transform) {
      const m = asMatrix(args);
      if (m) ctm = mul(ctm, m);
    } else if (fn === O.paintFormXObjectBegin) {
      stack.push({ ctm, mode });
      const m = asMatrix(args?.[0]);
      if (m) ctm = mul(ctm, m);
    } else if (fn === O.paintFormXObjectEnd) {
      const s = stack.pop();
      if (s) ({ ctm, mode } = s);
    } else if (fn === O.setTextRenderingMode) mode = Number(args?.[0] ?? 0);
    else if (fn === O.showText || fn === O.showSpacedText || fn === O.nextLineShowText || fn === O.nextLineSetSpacingShowText) {
      if (mode === 3 || mode === 7) out.invisibleShows++;
      else out.visibleShows++;
    } else if (fn !== undefined && imageOps.has(fn)) out.images++;
    else if (fn === O.constructPath) {
      const paint = Number(args?.[0]);
      const paths = (args?.[1] ?? []) as ArrayLike<number>[];
      const isStroke = strokeOps.has(paint);
      const isFill = fillOps.has(paint);
      if (!isStroke && !isFill) continue;
      for (const data of Array.from(paths)) {
        if (!data || typeof data.length !== "number") continue;
        const { segs, rects } = pathPieces(data, ctm);
        if (isStroke) for (const s of segs) addSeg(...s);
        if (isFill)
          for (const [x0, y0, x1, y1] of rects) {
            // 細く塗った四角は罫線（線で描かずに塗りで罫を描く書き手がある）。太い塗り（網掛け）は罫線にしない
            if (y1 - y0 <= THIN && x1 - x0 >= MIN_RULE) addSeg(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2);
            else if (x1 - x0 <= THIN && y1 - y0 >= MIN_RULE) addSeg((x0 + x1) / 2, y0, (x0 + x1) / 2, y1);
          }
      }
    }
  }
  // 文字
  const tc = await page.getTextContent({ includeMarkedContent: false, disableNormalization: true });
  const styles = tc.styles as Record<string, { ascent?: number; descent?: number; vertical?: boolean }>;
  const boldOf = new Map<string, boolean>();
  const isBold = (fontName: string): boolean => {
    if (boldOf.has(fontName)) return boldOf.get(fontName) ?? false;
    let b = false;
    try {
      const f = page.commonObjs.has(fontName) ? (page.commonObjs.get(fontName) as { bold?: boolean; black?: boolean; name?: string } | null) : null;
      b = !!(f && (f.bold || f.black || /bold|black|heavy|\bW[6-9]\b/i.test(f.name ?? "")));
    } catch {
      b = false;
    }
    boldOf.set(fontName, b);
    return b;
  };
  for (const it of tc.items) {
    if (!("str" in it)) continue;
    const str = it.str;
    if (str.trim() === "") {
      if (str !== "") out.whitespace++;
      continue;
    }
    const m = mul(vpm, (asMatrix(it.transform) ?? [1, 0, 0, 1, 0, 0]) as Matrix);
    const st = styles[it.fontName] ?? {};
    // 頁の上で横に流れる文字だけを格子に置く（縦書き・回転した文字は読まない物に数える）
    const horizontal = Math.abs(m[1]) < 1e-3 && Math.abs(m[2]) < 1e-3 && m[0] > 0 && m[3] < 0 && !st.vertical && it.dir !== "ttb";
    if (!horizontal) {
      out.rotated++;
      continue;
    }
    const size = Math.abs(m[3]) || it.height || 1;
    const ascent = typeof st.ascent === "number" && st.ascent > 0 ? st.ascent : 0.8;
    const descent = typeof st.descent === "number" && st.descent < 0 ? st.descent : -0.2;
    const x = m[4];
    const base = m[5];
    // 幅は頁の座標の長さ（倍率 1 の viewport なので回転しても長さは変わらない）
    const w = Math.max(0, it.width);
    const top = base - ascent * size;
    const h = (ascent - descent) * size;
    if (x + w < 0 || x > vp.width || top + h < 0 || top > vp.height) {
      out.offPage++;
      continue;
    }
    out.runs.push({ page: n, text: str, x, top, w, h, base, size, bold: isBold(it.fontName) });
  }
  try {
    out.annotations = (await page.getAnnotations()).length;
  } catch {
    out.annotations = 0;
  }
  page.cleanup();
  return out;
}

// ─── 格子を組む ──────────────────────────────────────────────────

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? 0) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

/** 1 次元の値を、間が tol を越えるところで切って群にする（昇順。群ごとに最小・最大・平均） */
function groups(values: number[], tol: number): { min: number; max: number; mean: number }[] {
  const s = [...values].sort((a, b) => a - b);
  const out: number[][] = [];
  for (const v of s) {
    const g = out[out.length - 1];
    if (g && v - (g[g.length - 1] ?? v) <= tol) g.push(v);
    else out.push([v]);
  }
  return out.map((g) => ({ min: g[0] ?? 0, max: g[g.length - 1] ?? 0, mean: g.reduce((a, b) => a + b, 0) / g.length }));
}

/** 頁の文字の並びを、基準線で行に分ける */
function linesOf(runs: Run[]): Run[][] {
  const center = (r: Run) => r.top + r.h / 2;
  const sorted = [...runs].sort((a, b) => center(a) - center(b) || a.x - b.x);
  const lines: Run[][] = [];
  for (const r of sorted) {
    const cur = lines[lines.length - 1];
    if (cur) {
      const c = cur.reduce((a, x) => a + center(x), 0) / cur.length;
      const size = median(cur.map((x) => x.size));
      if (Math.abs(center(r) - c) <= 0.45 * Math.max(r.size, size)) {
        cur.push(r);
        continue;
      }
    }
    lines.push([r]);
  }
  for (const l of lines) l.sort((a, b) => a.x - b.x);
  return lines;
}

interface Columns {
  /** 文字の並び → 列（1 から） */
  of(r: Run): number;
  boundaries: number;
  marginColumns: number;
}

/** 列：縦の罫線（全頁で寄せた x）の間を列にし、罫線の外の文字は左端の位置で列にする。罫線が無ければ左端の位置だけ */
function columnsOf(pages: PageRead[], runs: Run[]): Columns {
  const size = median(runs.map((r) => r.size)) || 10;
  // 縦の罫線の x を全頁で寄せる（頁ごとの小さなずれを同じ列の境にする。頁をまたいで列の番号をそろえる）
  const bounds = groups(
    pages.flatMap((p) => p.vertical.map((s) => s.x1)),
    1.5,
  ).map((g) => g.mean);
  const lattice = bounds.length >= 2;
  const probe = (r: Run) => r.x + Math.min(1, 0.1 * r.size);
  const inside = (x: number) => lattice && x >= (bounds[0] ?? 0) - 1 && x < (bounds[bounds.length - 1] ?? 0);
  // 罫線の外の文字は、左端の位置の群を列にする
  const margin = groups(
    runs.filter((r) => !inside(probe(r))).map((r) => r.x),
    0.6 * size,
  );
  type Anchor = { x: number; kind: "lattice" | "margin"; i: number };
  const anchors: Anchor[] = [];
  if (lattice) for (let i = 0; i < bounds.length - 1; i++) anchors.push({ x: bounds[i] ?? 0, kind: "lattice", i });
  margin.forEach((g, i) => anchors.push({ x: g.min, kind: "margin", i }));
  anchors.sort((a, b) => a.x - b.x || (a.kind === "lattice" ? -1 : 1));
  const colOfLattice = new Map<number, number>();
  const colOfMargin = new Map<number, number>();
  anchors.forEach((a, k) => (a.kind === "lattice" ? colOfLattice : colOfMargin).set(a.i, k + 1));
  return {
    boundaries: lattice ? bounds.length : 0,
    marginColumns: margin.length,
    of(r: Run): number {
      const x = probe(r);
      if (inside(x)) {
        let i = 0;
        while (i < bounds.length - 2 && x >= (bounds[i + 1] ?? Infinity)) i++;
        return colOfLattice.get(i) ?? 1;
      }
      const i = margin.findIndex((g) => r.x >= g.min && r.x <= g.max);
      return colOfMargin.get(i < 0 ? 0 : i) ?? 1;
    },
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function push(ledger: LedgerEntry[], kind: LedgerEntry["kind"], what: string, count: number, detail: string) {
  if (count > 0) ledger.push({ kind, what, count, detail, sheet: null });
}

export async function readPdf(file: string, bytes: Uint8Array): Promise<SourceFile> {
  const { lib, Files } = await pdfjs();
  // pdf.js は渡したバイト列を手放す（転送する）ので写しを渡す。セッションは元のバイト列を持ち続ける
  const task = lib.getDocument({
    data: bytes.slice(),
    BinaryDataFactory: Files,
    cMapPacked: true,
    // 描かないので書体を画面に登録しない。標準の書体も同梱のデータを使う（OS の書体に頼らない）
    disableFontFace: true,
    useSystemFonts: false,
    // 書体の名前（BaseFont）を画面の側でも持つ（太字を名前から読むため）
    fontExtraProperties: true,
    // 標準出力を汚さない（誤りだけ。読めなかったことは台帳と拒みに書く）
    verbosity: 0,
    stopAtErrors: false,
    enableXfa: false,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === "PasswordException") throw new Error("パスワードで守られた PDF は読めない（守りを外して保存し直してください）");
    throw e;
  }
  const ledger: LedgerEntry[] = [];
  const pages: PageRead[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) pages.push(await readPage(lib, doc, n));
  } finally {
    await task.destroy();
  }
  // 文字の無い頁：見える文字が 1 つも無い頁。見えない文字（OCR の文字の層など）だけの頁も、推し量って読まずに写真の道へ
  const scanned = new Set(pages.filter((p) => p.runs.length === 0 || (p.visibleShows === 0 && p.invisibleShows > 0)).map((p) => p.page));
  const invisibleOnly = pages.filter((p) => scanned.has(p.page) && p.runs.length > 0);
  const runs = pages.filter((p) => !scanned.has(p.page)).flatMap((p) => p.runs);
  const cols = columnsOf(
    pages.filter((p) => !scanned.has(p.page)),
    runs,
  );
  // 行：頁ごとに基準線で分け、頁の中の大きな間は空の行にする（表の切れ目。印刷した Excel の空の行と同じ働き）
  const cells: GridCell[] = [];
  const infos: PageInfo[] = [];
  let row = 0;
  let blank = 0;
  let joined = 0;
  for (const p of pages) {
    if (scanned.has(p.page)) {
      infos.push({ page: p.page, width: round2(p.width), height: round2(p.height), rows: null, runs: p.runs.length, placed: 0, scanned: true });
      continue;
    }
    const lines = linesOf(p.runs);
    const bases = lines.map((l) => median(l.map((r) => r.base)));
    const gaps: number[] = [];
    for (let i = 1; i < bases.length; i++) gaps.push((bases[i] ?? 0) - (bases[i - 1] ?? 0));
    const size = median(p.runs.map((r) => r.size)) || 10;
    const pitch = gaps.length >= 2 ? median(gaps) : 1.35 * size;
    const from = row + 1;
    let placed = 0;
    lines.forEach((line, i) => {
      if (i > 0 && (gaps[i - 1] ?? 0) > 1.7 * Math.max(pitch, size)) {
        row++;
        blank++;
      }
      row++;
      const byCol = new Map<number, Run[]>();
      for (const r of line) byCol.set(cols.of(r), [...(byCol.get(cols.of(r)) ?? []), r]);
      for (const [c, rs] of [...byCol.entries()].sort((a, b) => a[0] - b[0])) {
        rs.sort((a, b) => a.x - b.x);
        let text = "";
        let right = -Infinity;
        for (const r of rs) {
          // 間が字の幅の 2 割を越えるところは空白でつなぐ（pdf.js が空白を別の並びにしたもの）
          if (text && r.x - right > 0.2 * r.size && !/\s$/.test(text)) text += " ";
          text += r.text;
          right = r.x + r.w;
        }
        joined += rs.length - 1;
        placed += rs.length;
        const x0 = Math.min(...rs.map((r) => r.x));
        const y0 = Math.min(...rs.map((r) => r.top));
        const x1 = Math.max(...rs.map((r) => r.x + r.w));
        const y1 = Math.max(...rs.map((r) => r.top + r.h));
        cells.push({
          r: row,
          c,
          ref: cellRef(row, c),
          value: text,
          text,
          type: "string",
          numFmt: "General",
          formula: null,
          formulaNoCache: false,
          error: null,
          bold: rs.every((r) => r.bold),
          indent: 0,
          leadingSpaces: 0,
          note: null,
          page: p.page,
          box: [round2(x0), round2(y0), round2(x1 - x0), round2(y1 - y0)],
        });
      }
    });
    infos.push({ page: p.page, width: round2(p.width), height: round2(p.height), rows: lines.length ? { from, to: row } : null, runs: p.runs.length, placed, scanned: false });
  }
  const sum = (f: (p: PageRead) => number) => pages.reduce((a, p) => a + f(p), 0);
  push(ledger, "decided", "pdfPages", pages.length, `頁 ${pages.length}（文字のある頁 ${pages.length - scanned.size}・文字の無い頁 ${scanned.size}）`);
  push(
    ledger,
    "decided",
    "pdfGrid",
    runs.length ? 1 : 0,
    cols.boundaries
      ? `格子の組み方：行は文字の基準線、列は縦の罫線 ${cols.boundaries} 本の間${cols.marginColumns ? `と、罫線の外の文字の左端の位置 ${cols.marginColumns} 列` : ""}`
      : `格子の組み方：行は文字の基準線、列は文字の左端の位置 ${cols.marginColumns} 列（縦の罫線が無い）`,
  );
  push(ledger, "normalized", "pdfBlankRows", blank, "頁の中の行の大きな間を空の行にした（表の切れ目）");
  push(ledger, "normalized", "pdfJoinedRuns", joined, "同じセルに入った文字の並びをつないだ（並びの数）");
  push(ledger, "normalized", "pdfWhitespaceRuns", sum((p) => p.whitespace), "空白だけの文字の並び（位置の隙間）。セルにしない");
  push(ledger, "unread", "pdfRotatedText", sum((p) => p.rotated), "縦書き・回転した文字の並び。読まない");
  push(ledger, "unread", "pdfOffPageText", sum((p) => p.offPage), "頁の外にある文字の並び。読まない");
  push(
    ledger,
    "unread",
    "pdfInvisibleText",
    invisibleOnly.reduce((a, p) => a + p.runs.length, 0),
    "見えない描き方の文字だけの頁の文字の並び（OCR の文字の層の見込み）。推し量って読まず、頁を写真の道に回す",
  );
  const mixed = pages.filter((p) => !scanned.has(p.page) && p.invisibleShows > 0);
  push(ledger, "warning", "pdfInvisibleMixed", mixed.length, `見える文字と見えない描き方の文字が混じる頁（${mixed.map((p) => p.page).join("・")}）。どの並びが見えないかは分けられず、読んだ文字に混じっている見込み`);
  push(ledger, "unread", "pdfImage", sum((p) => p.images), "画像。読まない");
  push(ledger, "unread", "pdfAnnotation", sum((p) => p.annotations), "注釈・フォームの部品。読まない");
  push(
    ledger,
    "unread",
    "scannedPage",
    scanned.size,
    `文字の無い頁（${[...scanned].join("・")} 頁）。推し量って読まない。写真の道に回す（写真の読み取りは未実装）`,
  );
  // どの文字の並びも、セルに入ったか読まなかった物に数えたか（数え漏れは誤りとして台帳に出す）
  const counted = infos.reduce((a, p) => a + p.placed, 0) + invisibleOnly.reduce((a, p) => a + p.runs.length, 0);
  const all = pages.reduce((a, p) => a + p.runs.length, 0);
  push(ledger, "warning", "pdfRunsUncounted", all - counted, "セルにも読まなかった物にも数えられなかった文字の並び（読み手の誤り）");
  cells.sort((a, b) => a.r - b.r || a.c - b.c);
  const maxCol = cells.reduce((a, c) => Math.max(a, c.c), 0);
  return {
    file,
    format: "pdf",
    sheets: [{ name: null, index: 0, state: "visible", cells, merges: [], rows: {}, cols: {}, maxRow: row, maxCol }],
    ledger,
    date1904: false,
    pages: infos,
  };
}

// ─── 文字の無い頁の画像（写真の道の入口に渡す） ─────────────────────────

export interface PageImage {
  page: number;
  /** 画像の画素の数 */
  width: number;
  height: number;
  /** 頁の pt から画素への倍率 */
  scale: number;
  /** PNG のバイト列 */
  png: Uint8Array;
}

/**
 * PDF の 1 頁を描いて PNG にする。文字の無い頁（SourceFile.pages の scanned）を写真の道に回すときに使う。
 * 写真の道（画像を人の許しで AI クライアントに渡して読む）につなぐのは呼ぶ側。ここは画像を作るだけ。
 * Node（試験）は pdfjs-dist の任意の依存 @napi-rs/canvas の canvas、タブは画面の canvas に描く。
 * 画像の復号に wasm の要る形（JBIG2・JPEG 2000）は、タブのビルドに wasm を入れていないので描けないことがある（未確認）。
 */
export async function renderPdfPage(bytes: Uint8Array, page: number, opts: { scale?: number } = {}): Promise<PageImage> {
  const { lib, Files } = await pdfjs();
  const scale = opts.scale ?? 2;
  const task = lib.getDocument({ data: bytes.slice(), BinaryDataFactory: Files, cMapPacked: true, disableFontFace: true, useSystemFonts: false, verbosity: 0, stopAtErrors: false });
  try {
    const doc = await task.promise;
    if (!Number.isInteger(page) || page < 1 || page > doc.numPages) throw new Error(`頁 ${page} は無い（頁の数 ${doc.numPages}）`);
    const p = await doc.getPage(page);
    const vp = p.getViewport({ scale });
    const factory = doc.canvasFactory as { create(w: number, h: number): { canvas: unknown; context: unknown } };
    const { canvas } = factory.create(Math.ceil(vp.width), Math.ceil(vp.height));
    await p.render({ canvas: canvas as HTMLCanvasElement, viewport: vp }).promise;
    const c = canvas as {
      width: number;
      height: number;
      toBuffer?: (t: string) => Uint8Array;
      toBlob?: (cb: (b: Blob | null) => void, t: string) => void;
      convertToBlob?: (o: { type: string }) => Promise<Blob>;
    };
    let png: Uint8Array;
    if (typeof c.toBuffer === "function") png = new Uint8Array(c.toBuffer("image/png"));
    else if (typeof c.convertToBlob === "function") png = new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
    else if (typeof c.toBlob === "function") {
      const toBlob = c.toBlob.bind(c);
      const blob = await new Promise<Blob | null>((res) => toBlob(res, "image/png"));
      if (!blob) throw new Error("頁の画像を PNG にできない");
      png = new Uint8Array(await blob.arrayBuffer());
    } else throw new Error("頁を描く canvas が無い");
    return { page, width: c.width, height: c.height, scale, png };
  } finally {
    await task.destroy();
  }
}
