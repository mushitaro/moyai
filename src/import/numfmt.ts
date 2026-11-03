// 表示の文字を作る：ssf を土台に、ssf 0.11.2 が日本語の環境で誤る所だけを足す
// （元号 g/gg/ggg・e/ee・元年、曜日 aaa/aaaa、[DBNum1-3]、[$-411] など、ja-JP の組み込みの表示形式の番号）。
// 一般の性質だけ（ECMA-376 第 1 部 §18.8.30 の ja-JP の組み込みの番号、元号の始まりの日）。
// Excel の実物と並べて確かめたものではない（この PC に Excel が無い）。
import SSF from "ssf";
import { eraOf, serialToYmd } from "./era";

/** ja-JP の組み込みの表示形式の番号（14, 22, 27-36, 50-58）。 */
export const JA_BUILTIN: Readonly<Record<number, string>> = {
  14: "yyyy/m/d",
  22: "yyyy/m/d h:mm",
  27: '[$-411]ge.m.d',
  28: '[$-411]ggge"年"m"月"d"日"',
  29: '[$-411]ggge"年"m"月"d"日"',
  30: "m/d/yy",
  31: 'yyyy"年"m"月"d"日"',
  32: 'h"時"mm"分"',
  33: 'h"時"mm"分"ss"秒"',
  34: 'yyyy"年"m"月"',
  35: 'm"月"d"日"',
  36: '[$-411]ge.m.d',
  50: '[$-411]ge.m.d',
  51: '[$-411]ggge"年"m"月"d"日"',
  52: 'yyyy"年"m"月"',
  53: 'm"月"d"日"',
  54: '[$-411]ggge"年"m"月"d"日"',
  55: 'yyyy"年"m"月"',
  56: 'm"月"d"日"',
  57: '[$-411]ge.m.d',
  58: '[$-411]ggge"年"m"月"d"日"',
};

const WD_SHORT = ["日", "月", "火", "水", "木", "金", "土"];
const KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const DAIJI = ["〇", "壱", "弐", "参", "四", "伍", "六", "七", "八", "九"];

function kanjiPositional(n: number, digits: string[], big: boolean): string {
  if (n === 0) return digits[0] ?? "";
  const units = big ? ["", "拾", "百", "阡"] : ["", "十", "百", "千"];
  const groups = ["", "万", "億", "兆"];
  let out = "";
  let g = 0;
  while (n > 0) {
    let chunk = n % 10000;
    n = Math.floor(n / 10000);
    let s = "";
    for (let i = 0; chunk > 0; i++, chunk = Math.floor(chunk / 10)) {
      const dgt = chunk % 10;
      if (dgt === 0) continue;
      const lead = dgt === 1 && i > 0 && !big ? "" : (digits[dgt] ?? "");
      s = lead + (units[i] ?? "") + s;
    }
    if (s) out = s + (groups[g] ?? "") + out;
    g++;
  }
  return out;
}

function toFullWidth(s: string): string {
  return s.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));
}

/** 表示形式を ; で分ける（引用符と角括弧の中は分けない） */
function sections(fmt: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  let b = false;
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i] ?? "";
    if (ch === "\\" && !q) {
      cur += ch + (fmt[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === '"') q = !q;
    else if (!q && ch === "[") b = true;
    else if (!q && ch === "]") b = false;
    if (ch === ";" && !q && !b) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function replaceOutsideQuotes(sec: string, re: RegExp, fn: (tok: string) => string): string {
  return sec.replace(/("[^"]*"|\\.)|([^"\\]+)/g, (_m, lit: string | undefined, plain: string | undefined) =>
    lit ? lit : (plain ?? "").replace(re, fn),
  );
}

export function isDateSection(sec: string): boolean {
  const s = sec
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/general/gi, "")
    .replace(/AM\/PM|A\/P/gi, "h");
  return /[ymdhsgeaY]/.test(s) && !/[0#?@]/.test(s);
}

/** 表示形式の番号か文字から、表示形式の文字を返す。 */
export function formatCodeOf(fmt: number | string | null | undefined): string {
  if (fmt === null || fmt === undefined || fmt === "") return "General";
  if (typeof fmt === "number") {
    const table = SSF.get_table() as Record<number, string>;
    return JA_BUILTIN[fmt] ?? table[fmt] ?? "General";
  }
  return fmt;
}

/** 表示形式が日付か時刻か（値が通し番号の数のとき） */
export function isDateFormat(fmt: string): boolean {
  const secs = sections(fmt);
  return isDateSection(secs[0] ?? "");
}

/**
 * 表示の文字を作る。value は数・文字・真偽。日付は通し番号のまま渡す。
 * ssf が受けない表示形式なら null を返す（呼ぶ側が台帳に残し、値の文字で代える）。
 */
export function formatValue(fmtIn: number | string | null | undefined, value: number | string | boolean, opts: { date1904?: boolean } = {}): string | null {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  const fmt = formatCodeOf(fmtIn);
  if (typeof value === "string") {
    // 文字の値は、表示形式の 4 つ目の区分（@）があれば当てる。無ければそのまま
    const secs = sections(fmt);
    const textSec = secs.length >= 4 ? secs[3] : secs.find((s) => s.includes("@") && !/[0#?]/.test(s));
    if (!textSec) return value;
    try {
      return SSF.format(textSec, value);
    } catch {
      return value;
    }
  }
  if (/^general$/i.test(fmt)) return SSF.format("General", value);
  const secs = sections(fmt);
  let sec = secs[0] ?? "General";
  const hasCond = secs.some((s) => /\[(<|>|=)/.test(s));
  if (!hasCond && secs.length > 1) {
    if (value < 0) sec = secs[1] ?? sec;
    else if (value === 0 && secs.length > 2) sec = secs[2] ?? sec;
  }
  const dbnum = (/\[DBNum([123])\]/i.exec(sec) ?? [])[1];
  const gannen = /\[\$-ja-JP-x-gannen[^\]]*\]/i.test(sec);
  if (/\[\$-F800\]/i.test(sec)) sec = 'yyyy"年"m"月"d"日"';
  else if (/\[\$-F400\]/i.test(sec)) sec = "h:mm:ss";
  let body = sec.replace(/\[DBNum[123]\]/gi, "").replace(/\[\$-(411|ja-JP[^\]]*)\]/gi, "");
  try {
    if (isDateSection(body)) {
      const ymd = serialToYmd(value, opts.date1904);
      const era = eraOf(ymd);
      const lit = (s: string) => `"${s}"`;
      body = replaceOutsideQuotes(body, /ggg|gg|g|ee|e|aaaa|aaa/g, (tok) => {
        if (tok === "aaaa") return lit(`${WD_SHORT[ymd.wd] ?? ""}曜日`);
        if (tok === "aaa") return lit(WD_SHORT[ymd.wd] ?? "");
        if (!era) return lit("?");
        if (tok === "ggg") return lit(era.name);
        if (tok === "gg") return lit(era.short);
        if (tok === "g") return lit(era.letter);
        if (gannen && era.year === 1) return lit("元");
        return lit(tok === "ee" ? String(era.year).padStart(2, "0") : String(era.year));
      });
      // ssf は秒の後ろ（ss.00）のほかの「.」を日付の形に受けないので、ほかの「.」を引用符で包む
      body = replaceOutsideQuotes(body, /(?<!s)\.(?!0)/g, () => '"."');
      let text = SSF.format(body, value, { date1904: !!opts.date1904 });
      if (dbnum)
        text = text.replace(/\d+/g, (n) =>
          dbnum === "3" ? toFullWidth(n) : kanjiPositional(Number(n), dbnum === "2" ? DAIJI : KANJI, dbnum === "2"),
        );
      return text;
    }
    const JA_COLORS: Record<string, string> = { 赤: "Red", 黒: "Black", 青: "Blue", 緑: "Green", 白: "White", 黄: "Yellow", 水: "Cyan", 紫: "Magenta" };
    const whole = fmt
      .replace(/\[DBNum[123]\]/gi, "")
      .replace(/\[\$-(411|ja-JP[^\]]*)\]/gi, "")
      .replace(/\[(赤|黒|青|緑|白|黄|水|紫)\]/g, (_m, c: string) => `[${JA_COLORS[c] ?? c}]`);
    let text = SSF.format(whole, value, { date1904: !!opts.date1904 });
    if (dbnum) {
      const general = /general/i.test(sec);
      text = text.replace(/\d+/g, (n) => {
        if (dbnum === "3") return toFullWidth(n);
        const digits = dbnum === "2" ? DAIJI : KANJI;
        return general ? kanjiPositional(Number(n), digits, dbnum === "2") : [...n].map((c) => digits[Number(c)] ?? c).join("");
      });
    }
    return text;
  } catch {
    return null;
  }
}
