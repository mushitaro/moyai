// 層 1：CSV・TSV の読み手。文字コード（UTF-8・BOM 付き・Shift_JIS／cp932）と区切りと囲みを判定し、
// 判定の結果を台帳に残す。決まらなければ読み方の候補を返し、呼ぶ側が質問にする。
// 文字コードは WHATWG の TextDecoder（fatal）で、壊れずに読めるかで決める（ブラウザと Node の両方にある）。
import { parse } from "csv-parse/browser/esm/sync";
import { cellRef, leadingSpaceWidth, type GridCell, type LedgerEntry, type SourceFile } from "./grid";

export type CsvEncoding = "utf-8" | "utf-8-bom" | "utf-16le-bom" | "utf-16be-bom" | "shift_jis" | "euc-jp";
export type CsvDelimiter = "," | "\t" | ";" | "|";

export interface CsvReadOptions {
  /** 人が決めた文字コード（決まらなかったときの答え） */
  encoding?: CsvEncoding;
  delimiter?: CsvDelimiter;
}

export interface CsvAmbiguity {
  what: "encoding" | "delimiter";
  candidates: string[];
  detail: string;
}

export interface CsvResult {
  source: SourceFile | null;
  ambiguity: CsvAmbiguity[];
}

function tryDecode(bytes: Uint8Array, label: string): string | null {
  try {
    return new TextDecoder(label, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export const ENCODING_LABEL: Record<CsvEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8（BOM 付き）",
  "utf-16le-bom": "UTF-16LE（BOM 付き）",
  "utf-16be-bom": "UTF-16BE（BOM 付き）",
  shift_jis: "Shift_JIS（cp932）",
  "euc-jp": "EUC-JP",
};

export function detectEncoding(bytes: Uint8Array): { encoding: CsvEncoding | null; candidates: CsvEncoding[]; text: Partial<Record<CsvEncoding, string>> } {
  const text: Partial<Record<CsvEncoding, string>> = {};
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    const t = tryDecode(bytes.subarray(3), "utf-8");
    if (t !== null) return { encoding: "utf-8-bom", candidates: ["utf-8-bom"], text: { "utf-8-bom": t } };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const t = tryDecode(bytes.subarray(2), "utf-16le");
    if (t !== null) return { encoding: "utf-16le-bom", candidates: ["utf-16le-bom"], text: { "utf-16le-bom": t } };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const t = tryDecode(bytes.subarray(2), "utf-16be");
    if (t !== null) return { encoding: "utf-16be-bom", candidates: ["utf-16be-bom"], text: { "utf-16be-bom": t } };
  }
  const ascii = bytes.every((b) => b < 0x80);
  const u8 = tryDecode(bytes, "utf-8");
  if (u8 !== null) {
    // UTF-8 として壊れずに読め、ASCII の外の文字があるなら、ほかの日本語の文字コードで偶然読める見込みは小さい
    text["utf-8"] = u8;
    return { encoding: "utf-8", candidates: ["utf-8"], text };
  }
  if (ascii) return { encoding: "utf-8", candidates: ["utf-8"], text: { "utf-8": dec(bytes) } };
  const cands: CsvEncoding[] = [];
  const sj = tryDecode(bytes, "shift_jis");
  if (sj !== null) {
    cands.push("shift_jis");
    text.shift_jis = sj;
  }
  const ej = tryDecode(bytes, "euc-jp");
  if (ej !== null) {
    cands.push("euc-jp");
    text["euc-jp"] = ej;
  }
  return { encoding: cands.length === 1 ? (cands[0] ?? null) : null, candidates: cands, text };
}

function dec(b: Uint8Array): string {
  return new TextDecoder("utf-8").decode(b);
}

export function decodeAs(bytes: Uint8Array, e: CsvEncoding): string | null {
  switch (e) {
    case "utf-8-bom":
      return tryDecode(bytes.subarray(3), "utf-8");
    case "utf-16le-bom":
      return tryDecode(bytes.subarray(2), "utf-16le");
    case "utf-16be-bom":
      return tryDecode(bytes.subarray(2), "utf-16be");
    default:
      return tryDecode(bytes, e);
  }
}

/** 囲みの外の区切りの数を行ごとに数える（囲みの中の改行は続きとして数えない） */
function countOutsideQuotes(text: string, ch: string): number[] {
  const out: number[] = [];
  let n = 0;
  let q = false;
  let lineHasContent = false;
  for (let i = 0; i < text.length; i++) {
    const x = text[i];
    if (x === '"') {
      if (q && text[i + 1] === '"') {
        i++;
        continue;
      }
      q = !q;
      lineHasContent = true;
      continue;
    }
    if (!q && (x === "\n" || x === "\r")) {
      if (x === "\r" && text[i + 1] === "\n") i++;
      if (lineHasContent) out.push(n);
      n = 0;
      lineHasContent = false;
      continue;
    }
    if (!q && x === ch) n++;
    if (x !== " " && x !== "\t") lineHasContent = true;
    else if (x === "\t" && ch === "\t") lineHasContent = true;
  }
  if (lineHasContent) out.push(n);
  return out;
}

/**
 * 区切りを決める：行ごとの区切りの数の最頻値（1 以上）をとる行の多さで比べる。
 * 2 つ以上の候補が同じほど当てはまれば、決めずに候補を返す。
 */
export function detectDelimiter(text: string, ext: string): { delimiter: CsvDelimiter | null; candidates: CsvDelimiter[]; detail: string } {
  const cands: CsvDelimiter[] = [",", "\t", ";", "|"];
  const scores: { d: CsvDelimiter; lines: number; mode: number }[] = [];
  for (const d of cands) {
    const counts = countOutsideQuotes(text, d);
    const freq = new Map<number, number>();
    for (const c of counts) if (c > 0) freq.set(c, (freq.get(c) ?? 0) + 1);
    let mode = 0;
    let best = 0;
    for (const [k, v] of freq) if (v > best || (v === best && k > mode)) [mode, best] = [k, v];
    if (best > 0) scores.push({ d, lines: best, mode });
  }
  scores.sort((a, b) => b.lines - a.lines || b.mode - a.mode);
  const top = scores[0];
  const second = scores[1];
  const name = (d: string) => (d === "\t" ? "タブ" : d);
  const detail = scores.map((s) => `${name(s.d)}：${s.lines} 行が ${s.mode} 個`).join("、") || "区切りが見つからない";
  // どの行にも区切りの候補が無ければ 1 列の表。区切りは読み方に効かない
  if (!top) return { delimiter: ",", candidates: [","], detail: "区切りの候補がどの行にも無い（1 列）" };
  // 拡張子が .tsv でタブが候補に入っていれば、タブを先にする（拡張子と中身が合うとき）
  if (ext === "tsv") {
    const tab = scores.find((s) => s.d === "\t");
    if (tab && tab.lines >= top.lines * 0.5) return { delimiter: "\t", candidates: ["\t"], detail };
  }
  if (second && second.lines >= top.lines * 0.8) return { delimiter: null, candidates: [top.d, second.d], detail };
  return { delimiter: top.d, candidates: [top.d], detail };
}

function newlineOf(text: string): string {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  const cr = (text.match(/\r(?!\n)/g) ?? []).length;
  const parts = [crlf ? `CRLF ${crlf}` : "", lf ? `LF ${lf}` : "", cr ? `CR ${cr}` : ""].filter(Boolean);
  return parts.join("・") || "改行なし";
}

/** 記録ごとの始まりの行の番号（1 から）。囲みは欄の頭の「"」だけが開き、中の「""」は 1 つの「"」 */
export function recordStartLines(text: string, delimiter: string): number[] {
  const starts: number[] = [1];
  let line = 1;
  let q = false;
  let fieldStart = true;
  for (let i = 0; i < text.length; i++) {
    const x = text[i];
    if (q) {
      if (x === '"') {
        if (text[i + 1] === '"') i++;
        else q = false;
      } else if (x === "\r" || x === "\n") {
        if (x === "\r" && text[i + 1] === "\n") i++;
        line++;
      }
      continue;
    }
    if (x === '"' && fieldStart) {
      q = true;
      fieldStart = false;
      continue;
    }
    if (x === "\r" || x === "\n") {
      if (x === "\r" && text[i + 1] === "\n") i++;
      line++;
      starts.push(line);
      fieldStart = true;
      continue;
    }
    fieldStart = x === delimiter;
  }
  // 終わりの改行の後ろには記録が無い
  if (/(\r\n|\r|\n)$/.test(text)) starts.pop();
  return starts;
}

export function readCsv(file: string, bytes: Uint8Array, opts: CsvReadOptions = {}): CsvResult {
  const ledger: LedgerEntry[] = [];
  const ambiguity: CsvAmbiguity[] = [];
  const ext = (/\.([a-z0-9]+)$/i.exec(file)?.[1] ?? "").toLowerCase();
  let text: string | null = null;
  let encoding: CsvEncoding | null = null;
  if (opts.encoding) {
    encoding = opts.encoding;
    text = decodeAs(bytes, opts.encoding);
    if (text === null) {
      ambiguity.push({ what: "encoding", candidates: [], detail: `${ENCODING_LABEL[opts.encoding]} では読めない` });
      return { source: null, ambiguity };
    }
    ledger.push({ kind: "decided", what: "encoding", count: 1, detail: `文字コード ${ENCODING_LABEL[opts.encoding]}（人が決めた）`, sheet: null });
  } else {
    const det = detectEncoding(bytes);
    if (!det.encoding) {
      ambiguity.push({
        what: "encoding",
        candidates: det.candidates,
        detail: det.candidates.length ? `${det.candidates.map((c) => ENCODING_LABEL[c]).join("・")} のどれでも読める` : "UTF-8・Shift_JIS・EUC-JP のどれでも壊れずに読めない",
      });
      return { source: null, ambiguity };
    }
    encoding = det.encoding;
    text = det.text[det.encoding] ?? null;
    ledger.push({ kind: "decided", what: "encoding", count: 1, detail: `文字コード ${ENCODING_LABEL[det.encoding]}（壊れずに読めるのがこれだけ）`, sheet: null });
  }
  if (text === null) return { source: null, ambiguity };
  let delimiter: CsvDelimiter | null = opts.delimiter ?? null;
  if (delimiter) ledger.push({ kind: "decided", what: "delimiter", count: 1, detail: `区切り「${delimiter === "\t" ? "タブ" : delimiter}」（人が決めた）`, sheet: null });
  else {
    const d = detectDelimiter(text, ext);
    if (!d.delimiter) {
      ambiguity.push({ what: "delimiter", candidates: d.candidates, detail: d.detail });
      return { source: null, ambiguity };
    }
    delimiter = d.delimiter;
    ledger.push({ kind: "decided", what: "delimiter", count: 1, detail: `区切り「${delimiter === "\t" ? "タブ" : delimiter}」（${d.detail}）`, sheet: null });
  }
  ledger.push({ kind: "decided", what: "newline", count: 1, detail: `改行 ${newlineOf(text)}`, sheet: null });
  ledger.push({ kind: "decided", what: "quote", count: 1, detail: "囲みは「\"」（中の「\"\"」は 1 つの「\"」）", sheet: null });
  let records: string[][];
  try {
    records = parse(text, {
      delimiter,
      quote: '"',
      relax_column_count: true,
      relax_quotes: true,
      skip_empty_lines: false,
      bom: false,
    }) as unknown as string[][];
  } catch (e) {
    ambiguity.push({ what: "delimiter", candidates: [], detail: `CSV の形が読めない（${e instanceof Error ? e.message.slice(0, 80) : "不明"}）` });
    return { source: null, ambiguity };
  }
  // 記録の始まりの行の番号は、自分で数える（囲みの中の改行を、記録の区切りにしない）
  const starts = recordStartLines(text, delimiter);
  if (starts.length < records.length) ledger.push({ kind: "warning", what: "lineNumbers", count: records.length - starts.length, detail: "行の番号を数え切れなかった記録（記録の順の番号にした）", sheet: null });
  const cells: GridCell[] = [];
  let maxRow = 0;
  let maxCol = 0;
  records.forEach((record, ri) => {
    const line = starts[ri] ?? ri + 1;
    record.forEach((field, i) => {
      if (field === "") return;
      const c = i + 1;
      cells.push({
        r: line,
        c,
        ref: cellRef(line, c),
        value: field,
        text: field,
        type: "string",
        numFmt: "General",
        formula: null,
        formulaNoCache: false,
        error: null,
        bold: false,
        indent: 0,
        leadingSpaces: leadingSpaceWidth(field),
        note: null,
      });
      maxRow = Math.max(maxRow, line);
      maxCol = Math.max(maxCol, c);
    });
  });
  return {
    source: {
      file,
      format: ext === "tsv" ? "tsv" : "csv",
      sheets: [{ name: null, index: 0, state: "visible", cells, merges: [], rows: {}, cols: {}, maxRow, maxCol }],
      ledger,
      date1904: false,
    },
    ambiguity,
  };
}
