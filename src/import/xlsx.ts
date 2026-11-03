// 層 1：Excel（.xlsx・.xlsm）の読み手。exceljs の全部を読む読み手（流れで読む読み手は使わない）に、
// 読む前の zip の正規化と、exceljs が落とすものを zip の中の XML から読む・数える道を足す（日誌 2026-11-03 の当て試し）。
import type ExcelJSNS from "exceljs";
import { patchedExcelJS } from "./exceljs-setup";
import { formatValue } from "./numfmt";
import { readZip, writeZip, type ZipEntry } from "./zip";
import {
  cellRef,
  leadingSpaceWidth,
  parseRange,
  type GridCell,
  type LedgerEntry,
  type LineProps,
  type MergeRange,
  type SheetGrid,
  type SourceFile,
} from "./grid";

const RT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";

const dec = new TextDecoder("utf-8");
const enc = new TextEncoder();

function attr(tag: string, k: string): string | undefined {
  const m = new RegExp(`\\b${k.replace(":", "\\:")}="([^"]*)"`).exec(tag);
  return m ? unxml(m[1] ?? "") : undefined;
}
function unxml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}
function count(s: string, re: RegExp): number {
  return (s.match(re) ?? []).length;
}

// posix のパスの小さな道具（node:path を使わない。ブラウザでも動かすため）
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? p : p.slice(i + 1);
}
function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}
function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
function join(a: string, b: string): string {
  return normalizePath(a ? `${a}/${b}` : b);
}
function relative(fromDir: string, to: string): string {
  const f = fromDir ? fromDir.split("/") : [];
  const t = to.split("/");
  let i = 0;
  while (i < f.length && i < t.length - 1 && f[i] === t[i]) i++;
  return [...f.slice(i).map(() => ".."), ...t.slice(i)].join("/");
}
const relsOf = (part: string) => join(join(dirname(part), "_rels"), `${basename(part)}.rels`);
const sourceOf = (rels: string) => join(dirname(dirname(rels)), basename(rels).replace(/\.rels$/, ""));

interface Rel {
  tag: string;
  id: string;
  type: string;
  target: string;
  external: boolean;
  part: string | null;
}

function parseRels(xml: string, src: string): Rel[] {
  return [...xml.matchAll(/<Relationship\b[^>]*>/g)].map((m) => {
    const tag = m[0];
    const target = attr(tag, "Target") ?? "";
    const external = attr(tag, "TargetMode") === "External";
    return {
      tag,
      id: attr(tag, "Id") ?? "",
      type: attr(tag, "Type") ?? "",
      target,
      external,
      part: external || !target ? null : target.startsWith("/") ? target.slice(1) : join(dirname(src), target),
    };
  });
}

// ─── 読む前の正規化 ───────────────────────────────────────────────

const CANON: Record<string, { re: RegExp; make: (n: number, ext: string) => string }> = {
  comments: { re: /^xl\/comments\d+\.xml$/, make: (n) => `xl/comments${n}.xml` },
  vmlDrawing: { re: /^xl\/drawings\/vmlDrawing\d+\.vml$/, make: (n) => `xl/drawings/vmlDrawing${n}.vml` },
  table: { re: /^xl\/tables\/table\d+\.xml$/, make: (n) => `xl/tables/table${n}.xml` },
  worksheet: { re: /^xl\/worksheets\/sheet\d+\.xml$/, make: (n) => `xl/worksheets/sheet${n}.xml` },
  image: { re: /^xl\/media\/[a-zA-Z0-9]+\.[a-zA-Z0-9]{3,4}$/, make: (n, ext) => `xl/media/image${n}${ext}` },
};

interface Normalized {
  entries: ZipEntry[];
  renamed: number;
  rewrittenTargets: number;
  strippedDrawings: number;
  strippedDataValidations: number;
}

/**
 * exceljs 4.4.0 は部品を決まった名前で探し、注釈を相対の行き先で結ぶ。ほかの書き手（openpyxl など）の
 * 名前や絶対の行き先で落ちるか部品を失うので、名前と行き先をそろえる。図（DrawingML）は exceljs が読み損ねて
 * 落ちる形があるので外し（中身は元の zip から数える）、入力の規則は展開に時間がかかりすぎるので外す（範囲は XML から読む）。
 */
function normalizeForExceljs(src: ZipEntry[]): Normalized {
  const files = new Map<string, Uint8Array>(src.map((e) => [e.name, e.data]));
  const text = (n: string) => dec.decode(files.get(n) ?? new Uint8Array());
  let strippedDrawings = 0;
  for (const n of [...files.keys()].filter((k) => /^xl\/worksheets\/_rels\/[^/]+\.rels$/.test(k))) {
    const xml = text(n);
    const ids = [...xml.matchAll(/<Relationship\b[^>]*Type="[^"]*\/relationships\/drawing"[^>]*>/g)].map((m) => attr(m[0], "Id") ?? "");
    if (!ids.length) continue;
    const sheet = sourceOf(n);
    let sx = text(sheet);
    for (const id of ids) sx = sx.replace(new RegExp(`<drawing\\b[^>]*r:id="${id}"[^>]*/>`), "");
    files.set(sheet, enc.encode(sx));
    files.set(n, enc.encode(xml.replace(/<Relationship\b[^>]*Type="[^"]*\/relationships\/drawing"[^>]*>/g, "")));
    strippedDrawings += ids.length;
  }
  for (const n of [...files.keys()]) {
    if (/^xl\/drawings\/[^/]+\.xml$/.test(n) || /^xl\/drawings\/_rels\/[^/]+\.xml\.rels$/.test(n)) files.delete(n);
  }
  let strippedDataValidations = 0;
  for (const n of [...files.keys()].filter((k) => /^xl\/worksheets\/[^/]+\.xml$/.test(k))) {
    const sx = text(n);
    const out = sx.replace(/<dataValidations\b[\s\S]*?<\/dataValidations>/g, () => {
      strippedDataValidations++;
      return "";
    });
    if (out !== sx) files.set(n, enc.encode(out));
  }
  const relFiles = [...files.keys()].filter((n) => n.endsWith(".rels"));
  const rels = new Map<string, { xml: string; list: Rel[] }>();
  for (const rf of relFiles) {
    const xml = text(rf);
    rels.set(rf, { xml, list: parseRels(xml, rf === "_rels/.rels" ? "" : sourceOf(rf)) });
  }
  const renamed = new Map<string, string>();
  const used = new Set(files.keys());
  for (const [, { list }] of rels)
    for (const r of list) {
      if (!r.part || renamed.has(r.part)) continue;
      const kind = Object.keys(CANON).find((k) => r.type === RT + k);
      const canon = kind ? CANON[kind] : undefined;
      if (!canon || canon.re.test(r.part) || !files.has(r.part)) continue;
      let n = 1;
      let to: string;
      do to = canon.make(n++, extname(r.part));
      while (used.has(to));
      used.add(to);
      renamed.set(r.part, to);
    }
  for (const [from, to] of renamed) {
    const data = files.get(from);
    if (data) files.set(to, data);
    files.delete(from);
    const fr = relsOf(from);
    const rr = rels.get(fr);
    if (rr) {
      rels.set(relsOf(to), rr);
      rels.delete(fr);
      const d = files.get(fr);
      if (d) files.set(relsOf(to), d);
      files.delete(fr);
    }
  }
  let rewrittenTargets = 0;
  for (const [rf, { xml, list }] of rels) {
    const srcPart = rf === "_rels/.rels" ? "" : sourceOf(rf);
    let out = xml;
    for (const r of list) {
      if (!r.part) continue;
      const finalPart = renamed.get(r.part) ?? r.part;
      const rel = rf === "_rels/.rels" ? finalPart : relative(dirname(srcPart), finalPart);
      if (rel !== r.target) {
        out = out.replace(r.tag, r.tag.replace(`Target="${r.target}"`, `Target="${rel}"`));
        rewrittenTargets++;
      }
    }
    if (out !== xml) files.set(rf, enc.encode(out));
  }
  if (renamed.size) {
    let ct = text("[Content_Types].xml");
    for (const [from, to] of renamed) ct = ct.split(`PartName="/${from}"`).join(`PartName="/${to}"`);
    files.set("[Content_Types].xml", enc.encode(ct));
  }
  return {
    entries: [...files.entries()].map(([name, data]) => ({ name, data })),
    renamed: renamed.size,
    rewrittenTargets,
    strippedDrawings,
    strippedDataValidations,
  };
}

// ─── 読まない物を数える ───────────────────────────────────────────

interface SheetInfo {
  name: string;
  state: SheetGrid["state"];
  part: string | null;
  type: string;
}

function ledgerPush(ledger: LedgerEntry[], kind: LedgerEntry["kind"], what: string, n: number, detail: string, sheet: string | null = null) {
  if (n > 0) ledger.push({ kind, what, count: n, detail, sheet });
}

function scanSheetXml(x: string, sheet: string, ledger: LedgerEntry[]) {
  const dvs = [...x.matchAll(/<dataValidation\b([^>]*)>/g)].map((d) => attr(d[1] ?? "", "sqref") ?? "");
  ledgerPush(ledger, "unread", "dataValidation", dvs.length + count(x, /<x14:dataValidation\b/g), `入力の規則（範囲 ${dvs.join(" ") || "拡張の形"}）。読まない`, sheet);
  ledgerPush(ledger, "unread", "conditionalFormatting", count(x, /<conditionalFormatting\b/g) + count(x, /<x14:conditionalFormatting\b/g), "条件つきの書式。読まない", sheet);
  const rb = (/<rowBreaks\b[\s\S]*?<\/rowBreaks>/.exec(x) ?? [""])[0];
  const cb = (/<colBreaks\b[\s\S]*?<\/colBreaks>/.exec(x) ?? [""])[0];
  ledgerPush(ledger, "unread", "pageBreak", count(rb, /<brk\b/g) + count(cb, /<brk\b/g), "改ページ。読まない", sheet);
  ledgerPush(ledger, "unread", "hyperlinkTarget", count(x, /<hyperlink\b/g), "リンクの行き先。セルの文字だけを読む", sheet);
  ledgerPush(ledger, "unread", "control", count(x, /<control\b/g) + count(x, /<oleObject\b/g), "フォームの部品・埋め込みの物。読まない", sheet);
  const pane = /<pane\b[^>]*>/.exec(x);
  if (pane && /state="frozen"/.test(pane[0]))
    ledgerPush(ledger, "unread", "frozenPane", 1, `ウィンドウ枠の固定（${attr(pane[0], "topLeftCell") ?? ""}）。読み方には使わない`, sheet);
}

function drawingCounts(xml: string): { shapes: number; withText: number; pictures: number; charts: number; groups: number } {
  let withText = 0;
  for (const m of xml.matchAll(/<(?:xdr:)?sp\b[\s\S]*?<\/(?:xdr:)?sp>/g)) {
    const t = [...m[0].matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((x) => x[1] ?? "").join("").trim();
    if (t) withText++;
  }
  return {
    shapes: count(xml, /<(?:xdr:)?sp\b/g),
    withText,
    pictures: count(xml, /<(?:xdr:)?pic\b/g),
    charts: count(xml, /<c:chart\b/g),
    groups: count(xml, /<(?:xdr:)?grpSp\b/g),
  };
}

// ─── シートの XML から、行・列の性質・結合を読む ─────────────────────

function lineProps(x: string): { rows: Record<number, LineProps>; cols: Record<number, LineProps>; merges: MergeRange[] } {
  const rows: Record<number, LineProps> = {};
  for (const m of x.matchAll(/<row\b([^>]*)>/g)) {
    const a = m[1] ?? "";
    const r = Number(attr(a, "r"));
    if (!r) continue;
    const hidden = /\bhidden="(1|true)"/.test(a);
    const outline = Number(attr(a, "outlineLevel") ?? 0);
    if (hidden || outline) rows[r] = { hidden, outline };
  }
  const cols: Record<number, LineProps> = {};
  for (const m of x.matchAll(/<col\b([^>]*)\/?>/g)) {
    const a = m[1] ?? "";
    const min = Number(attr(a, "min"));
    const max = Number(attr(a, "max"));
    const hidden = /\bhidden="(1|true)"/.test(a);
    const outline = Number(attr(a, "outlineLevel") ?? 0);
    if (!min || !max || (!hidden && !outline)) continue;
    for (let c = min; c <= Math.min(max, 16384); c++) cols[c] = { hidden, outline };
  }
  const merges: MergeRange[] = [];
  for (const m of x.matchAll(/<mergeCell\b([^>]*)\/?>/g)) {
    const r = parseRange(attr(m[1] ?? "", "ref") ?? "");
    if (r) merges.push(r);
  }
  return { rows, cols, merges };
}

// ─── メモ（exceljs は値の無いセルのメモを落とすので、注釈の部品から読む） ─────────

function commentsOf(xml: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of xml.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)) {
    const ref = attr(m[1] ?? "", "ref");
    if (!ref) continue;
    const body = m[2] ?? "";
    // ふりがな（rPh）の中の文字は読まない
    const t = [...body.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((x) => unxml(x[1] ?? "")).join("");
    out.set(ref, t);
  }
  return out;
}

// ─── セル ─────────────────────────────────────────────────────

type XCell = ExcelJSNS.Cell;

function noteText(n: unknown): string | null {
  if (!n) return null;
  if (typeof n === "string") return n;
  if (typeof n === "object" && n !== null && "texts" in n) {
    const t = (n as { texts?: { text?: string }[] }).texts ?? [];
    return t.map((x) => x.text ?? "").join("");
  }
  return null;
}

function readCell(ExcelJS: typeof ExcelJSNS, cell: XCell, r: number, c: number, date1904: boolean, fmtFallbacks: { n: number }): GridCell | null {
  const VT = ExcelJS.ValueType;
  if (cell.type === VT.Merge) return null;
  const numFmt = (cell.numFmt as string | undefined) || "General";
  const note = noteText(cell.note);
  const base = {
    r,
    c,
    ref: cellRef(r, c),
    numFmt,
    formula: null as string | null,
    formulaNoCache: false,
    error: null as string | null,
    bold: !!cell.font?.bold,
    indent: Number(cell.alignment?.indent ?? 0) || 0,
    leadingSpaces: 0,
    note,
  };
  const v = cell.value as unknown;
  const fromScalar = (x: unknown): { value: GridCell["value"]; type: GridCell["type"]; error: string | null } => {
    if (x === null || x === undefined) return { value: null, type: "formula-no-cache", error: null };
    if (typeof x === "number") return { value: x, type: "number", error: null };
    if (typeof x === "string") return { value: x, type: "string", error: null };
    if (typeof x === "boolean") return { value: x, type: "boolean", error: null };
    if (x instanceof Date) {
      // 直しが効いていれば来ない。来たら通し番号に戻す（exceljs の excelToDate の逆）
      const serial = x.getTime() / 86400000 + 25569 - (date1904 ? 1462 : 0);
      return { value: serial, type: "number", error: null };
    }
    if (typeof x === "object") {
      const o = x as { error?: string; richText?: { text: string }[]; text?: unknown };
      if (o.error) return { value: null, type: "error", error: String(o.error) };
      if (o.richText) return { value: o.richText.map((t) => t.text).join(""), type: "string", error: null };
      if (o.text !== undefined) return fromScalar(o.text);
    }
    return { value: String(x), type: "string", error: null };
  };
  let out: { value: GridCell["value"]; type: GridCell["type"]; error: string | null };
  if (cell.type === VT.Null) {
    if (!note) return null;
    out = { value: null, type: "string", error: null };
  } else if (cell.type === VT.Formula) {
    const fv = v as { formula?: string; sharedFormula?: string; result?: unknown };
    base.formula = cell.formula || fv.formula || fv.sharedFormula || "";
    if (fv.result === undefined || fv.result === null) {
      base.formulaNoCache = true;
      out = { value: null, type: "formula-no-cache", error: null };
    } else out = fromScalar(fv.result);
  } else out = fromScalar(v);
  let text = "";
  if (out.type === "number" || out.type === "string" || out.type === "boolean") {
    const f = formatValue(numFmt, out.value as number | string | boolean, { date1904 });
    if (f === null) {
      fmtFallbacks.n++;
      text = String(out.value);
    } else text = f;
  } else if (out.type === "error") text = out.error ?? "";
  if (typeof out.value === "string") base.leadingSpaces = leadingSpaceWidth(out.value);
  return { ...base, value: out.value, text, type: out.type, error: out.error };
}

// ─── 入口 ─────────────────────────────────────────────────────

export async function readXlsx(file: string, bytes: Uint8Array, format: "xlsx" | "xlsm"): Promise<SourceFile> {
  const ledger: LedgerEntry[] = [];
  const entries = await readZip(bytes);
  const byName = new Map(entries.map((e) => [e.name, e.data]));
  const text = (n: string) => dec.decode(byName.get(n) ?? new Uint8Array());
  const wbXml = text("xl/workbook.xml");
  if (!wbXml) throw new Error("xl/workbook.xml が無い（Excel のファイルではない）");
  const date1904 = /<workbookPr\b[^>]*date1904="(1|true)"/.test(wbXml);
  const wbRels = parseRels(text("xl/_rels/workbook.xml.rels"), "xl/workbook.xml");
  const sheets: SheetInfo[] = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const t = m[0];
    const rel = wbRels.find((r) => r.id === attr(t, "r:id"));
    const st = attr(t, "state");
    sheets.push({
      name: attr(t, "name") ?? "",
      state: st === "hidden" ? "hidden" : st === "veryHidden" ? "veryHidden" : "visible",
      part: rel?.part ?? null,
      type: (rel?.type ?? "").split("/").pop() ?? "",
    });
  }
  // 名前の定義（印刷範囲など）。exceljs は行だけの印刷範囲を壊し、一部を黙って落とすので XML から数える
  const names = [...wbXml.matchAll(/<definedName\b([^>]*)>([\s\S]*?)<\/definedName>/g)].map((m) => ({
    name: attr(m[1] ?? "", "name") ?? "",
    value: unxml(m[2] ?? ""),
  }));
  const printAreas = names.filter((n) => /^_xlnm\.Print_(Area|Titles)$/i.test(n.name));
  ledgerPush(ledger, "unread", "printArea", printAreas.length, `印刷範囲・印刷の見出し（${printAreas.map((p) => p.value).join(" ")}）。読み方には使わない`);
  ledgerPush(ledger, "unread", "definedName", names.length - printAreas.length, "名前の定義。読まない");
  const all = [...byName.keys()];
  ledgerPush(ledger, "unread", "pivotTable", all.filter((n) => /^xl\/pivotTables\/[^/]+\.xml$/.test(n)).length, "ピボットテーブル。読まない");
  ledgerPush(ledger, "unread", "externalLink", all.filter((n) => /^xl\/externalLinks\/[^/]+\.xml$/.test(n)).length, "ほかのブックへのリンク。読まない");
  ledgerPush(ledger, "unread", "vbaProject", all.includes("xl/vbaProject.bin") ? 1 : 0, "マクロ。読まない（動かさない）");
  ledgerPush(ledger, "unread", "embedding", all.filter((n) => /^xl\/embeddings\//.test(n)).length, "埋め込みのファイル。読まない");
  ledgerPush(ledger, "unread", "threadedComment", all.filter((n) => /^xl\/threadedComments\//.test(n)).length, "スレッドのコメント（メモとして残る分だけを読む）");
  for (const s of sheets) {
    if (s.type !== "worksheet") {
      ledgerPush(ledger, "unread", "nonWorksheet", 1, `ワークシートでないシート（${s.type || "不明"}）。読まない`, s.name);
      continue;
    }
    if (!s.part || !byName.has(s.part)) continue;
    const sx = text(s.part);
    scanSheetXml(sx, s.name, ledger);
    for (const r of parseRels(text(relsOf(s.part)), s.part)) {
      if (r.type === `${RT}drawing` && r.part && byName.has(r.part)) {
        const d = drawingCounts(text(r.part));
        ledgerPush(ledger, "unread", "shape", d.shapes, `図形（文字のあるもの ${d.withText}）。読まない`, s.name);
        ledgerPush(ledger, "unread", "picture", d.pictures, "画像。読まない", s.name);
        ledgerPush(ledger, "unread", "chart", d.charts, "グラフ。読まない", s.name);
      }
    }
  }
  const norm = normalizeForExceljs(entries);
  ledgerPush(ledger, "normalized", "zipParts", norm.renamed + norm.rewrittenTargets, `読む前に部品の名前 ${norm.renamed} と行き先 ${norm.rewrittenTargets} をそろえた`);
  ledgerPush(ledger, "normalized", "drawingStripped", norm.strippedDrawings, "図の部品を読む前に外した（数は上の図形・画像・グラフ）");
  ledgerPush(ledger, "normalized", "dataValidationStripped", norm.strippedDataValidations, "入力の規則を読む前に外した（範囲は上に数えた）");

  const ExcelJS = patchedExcelJS();
  const wb = new ExcelJS.Workbook();
  const zipped = writeZip(norm.entries);
  await wb.xlsx.load(zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer);
  const fmtFallbacks = { n: 0 };
  const grids: SheetGrid[] = [];
  let index = 0;
  for (const s of sheets) {
    if (s.type !== "worksheet" || !s.part || !byName.has(s.part)) continue;
    const ws = wb.getWorksheet(s.name);
    const props = lineProps(text(s.part));
    const cells: GridCell[] = [];
    if (ws) {
      // 値の無いセルも見る（メモだけのセルを落とさないため。値もメモも無いセルは readCell が捨てる）
      ws.eachRow({ includeEmpty: true }, (row, r) => {
        row.eachCell({ includeEmpty: true }, (cell, c) => {
          const g = readCell(ExcelJS, cell, r, c, date1904, fmtFallbacks);
          if (g) cells.push(g);
        });
      });
    }
    // メモ：注釈の部品から読み、exceljs が落としたもの（値の無いセルのメモ）を足す
    for (const rel of parseRels(text(relsOf(s.part)), s.part)) {
      if (rel.type !== `${RT}comments` || !rel.part || !byName.has(rel.part)) continue;
      for (const [ref, note] of commentsOf(text(rel.part))) {
        const p = parseRange(ref);
        if (!p) continue;
        const have = cells.find((c) => c.r === p.top && c.c === p.left);
        if (have) {
          if (!have.note) have.note = note;
          continue;
        }
        cells.push({
          r: p.top,
          c: p.left,
          ref: cellRef(p.top, p.left),
          value: null,
          text: "",
          type: "string",
          numFmt: "General",
          formula: null,
          formulaNoCache: false,
          error: null,
          bold: false,
          indent: 0,
          leadingSpaces: 0,
          note,
        });
      }
    }
    cells.sort((a, b) => a.r - b.r || a.c - b.c);
    let maxRow = 0;
    let maxCol = 0;
    for (const c of cells) {
      maxRow = Math.max(maxRow, c.r);
      maxCol = Math.max(maxCol, c.c);
    }
    for (const m of props.merges) {
      maxRow = Math.max(maxRow, m.bottom);
      maxCol = Math.max(maxCol, m.right);
    }
    const noCache = cells.filter((c) => c.formulaNoCache).length;
    ledgerPush(ledger, "warning", "formulaNoCache", noCache, "数式があって計算済みの値が無いセル（未解決に数える）", s.name);
    grids.push({ name: s.name, index: index++, state: s.state, cells, merges: props.merges, rows: props.rows, cols: props.cols, maxRow, maxCol });
  }
  ledgerPush(ledger, "warning", "formatFallback", fmtFallbacks.n, "表示形式を当てられず、値の文字のまま表示にしたセル");
  return { file, format, sheets: grids, ledger, date1904 };
}
