// 和暦の表と、日付・年・年度の書き方を読む決まり（一般の性質だけ。業種の語は置かない）。
// 元号の始まりの日は公のもの。元号の年 n は「始まりの年 + n - 1」。
// 読めない書き方は null を返し、呼ぶ側が質問にする（日付に見えない書き方を日付と決めつけない）。

export interface Era {
  name: string; // 令和
  short: string; // 令
  letter: string; // R
  start: readonly [number, number, number];
}

export const ERAS: readonly Era[] = [
  { name: "令和", short: "令", letter: "R", start: [2019, 5, 1] },
  { name: "平成", short: "平", letter: "H", start: [1989, 1, 8] },
  { name: "昭和", short: "昭", letter: "S", start: [1926, 12, 25] },
  { name: "大正", short: "大", letter: "T", start: [1912, 7, 30] },
  { name: "明治", short: "明", letter: "M", start: [1868, 1, 1] },
];

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

/** Excel の通し番号 → 年月日と曜日（1900 年の基準では Excel の架空の 1900-02-29 を保つ）。 */
export function serialToYmd(serial: number, date1904 = false): Ymd & { wd: number } {
  const day = Math.floor(serial);
  if (!date1904 && day === 60) return { y: 1900, m: 2, d: 29, wd: 3 };
  let ms: number;
  if (date1904) ms = Date.UTC(1904, 0, 1) + day * 86400000;
  else if (day < 60) ms = Date.UTC(1899, 11, 31) + day * 86400000;
  else ms = Date.UTC(1899, 11, 30) + day * 86400000;
  const dt = new Date(ms);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

export function eraOf(ymd: Ymd): (Era & { year: number }) | null {
  const key = ymd.y * 10000 + ymd.m * 100 + ymd.d;
  for (const e of ERAS) {
    const s = e.start[0] * 10000 + e.start[1] * 100 + e.start[2];
    if (key >= s) return { ...e, year: ymd.y - e.start[0] + 1 };
  }
  return null;
}

function eraByToken(tok: string): Era | null {
  const t = tok.toUpperCase();
  return ERAS.find((e) => e.name === tok || e.short === tok || e.letter === t) ?? null;
}

const ERA_TOKEN = "(令和|平成|昭和|大正|明治|令|平|昭|大|明|[RHSTMrhstm])";

function eraYear(tok: string, n: string): number | null {
  const e = eraByToken(tok);
  if (!e) return null;
  const k = n === "元" ? 1 : Number(n);
  if (!Number.isInteger(k) || k < 1 || k > 99) return null;
  return e.start[0] + k - 1;
}

function validYmd(y: number, m: number, d: number): boolean {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1868 && y <= 2200)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 前後の空白を除き、全角の数字と記号を半角にする（比べるための形。表示には使わない）。 */
export function nfkc(s: string): string {
  return s.normalize("NFKC").trim();
}

/**
 * 日付の文字を読む。読めるのは年月日がそろった書き方だけ：
 * 2022/04/07・2022-4-7・2022.4.7・2022年4月7日・R4.4.6・R4/4/6・令和4年4月6日・令和元年5月1日。
 * 「昭和63年度末」「4月上旬」のように日に決まらないものは null。
 */
export function parseDateText(text: string): Ymd | null {
  const s = nfkc(text).replace(/\s+/g, "");
  let m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(s) ?? /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return validYmd(y, mo, d) ? { y, m: mo, d } : null;
  }
  m =
    new RegExp(`^${ERA_TOKEN}(\\d{1,2}|元)[./\\-](\\d{1,2})[./\\-](\\d{1,2})$`).exec(s) ??
    new RegExp(`^${ERA_TOKEN}(\\d{1,2}|元)年(\\d{1,2})月(\\d{1,2})日$`).exec(s);
  if (m) {
    const y = eraYear(m[1] ?? "", m[2] ?? "");
    const mo = Number(m[3]);
    const d = Number(m[4]);
    if (y === null || !validYmd(y, mo, d)) return null;
    return { y, m: mo, d };
  }
  return null;
}

/**
 * 年の無い日付：「4/6」「4/6(月)」「4月6日」「4月6日（月）」。曜日の括弧は読まない（年が決まらないので曜日では確かめない）。
 * 年は、呼ぶ側が表の外（題や頭書き）に書いてある年度から決める。読めなければ null。
 */
export function parseMonthDay(text: string): { m: number; d: number } | null {
  const s = nfkc(text).replace(/\s+/g, "").replace(/[(（][^()（）]{1,3}[)）]$/u, "");
  const m = /^(\d{1,2})[/.](\d{1,2})$/.exec(s) ?? /^(\d{1,2})月(\d{1,2})日$/.exec(s);
  if (!m) return null;
  const mo = Number(m[1]);
  const d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? { m: mo, d } : null;
}

/** 年の無い日付に年度から年を付ける（年度の始まりの月より前の月は、次の年） */
export function withFiscalYear(md: { m: number; d: number }, fiscalYear: number, startMonth: number): Ymd | null {
  const y = md.m >= startMonth ? fiscalYear : fiscalYear + 1;
  return validYmd(y, md.m, md.d) ? { y, m: md.m, d: md.d } : null;
}

/**
 * 文の中の年度の書き方（「2026年度」「令和8年度」「R8年度」）をすべて読み、1 つの年度にそろっていればその年度。
 * 無い・2 つ以上の年度があるときは null（題に「令和4年度～令和7年度」とあれば、年の無い日付の年は決めない）。
 */
export function fiscalYearInText(texts: readonly string[]): number | null {
  const found = new Set<number>();
  const re = new RegExp(`(?:(\\d{4})|${ERA_TOKEN}(\\d{1,2}|元))年度`, "gu");
  for (const t of texts)
    for (const m of nfkc(t).replace(/\s+/g, "").matchAll(re)) {
      const y = m[1] ? Number(m[1]) : eraYear(m[2] ?? "", m[3] ?? "");
      if (y !== null && y >= 1868 && y <= 2200) found.add(y);
    }
  return found.size === 1 ? ([...found][0] ?? null) : null;
}

/** 期間の区切りの書き方（〜・～）。日付の「/」「.」と同じ、日付の書き方の一般の性質 */
const RANGE_SEP = /\s*[〜~]\s*/u;

/**
 * 期間の文字を読む：「2019/04/06〜2019/04/17」「R1.5.10〜R1.5.20」「令和元年5月10日〜令和元年5月20日」。
 * 両側とも年月日のそろった日付で、始まりが終わりより後でないときだけ。片側だけ・「4月上旬〜」などは null。
 */
export function parseDateRange(text: string): { start: Ymd; end: Ymd } | null {
  const s = nfkc(text);
  const parts = s.split(RANGE_SEP);
  if (parts.length !== 2) return null;
  const start = parseDateText(parts[0] ?? "");
  const end = parseDateText(parts[1] ?? "");
  if (!start || !end) return null;
  if (ymdString(start) > ymdString(end)) return null;
  return { start, end };
}

/** 両端を含む日の数（2019-04-06〜2019-04-17 → 12） */
export function daysInclusive(a: Ymd, b: Ymd): number {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000) + 1;
}

/** 日数の書き方：「12」「12日」「12日間」（正の整数だけ） */
export function parseDayCount(v: string | number): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v > 0 ? v : null;
  const m = /^(\d{1,4})(?:日間?)?$/u.exec(nfkc(v).replace(/\s+/g, ""));
  if (!m) return null;
  const n = Number(m[1]);
  return n > 0 ? n : null;
}

export interface YearLabel {
  year: number;
  /** 「年度」と書いてあれば true、「年」と書いてあれば false、どちらも無ければ null */
  fiscal: boolean | null;
  era: string | null;
}

/** 見出しの年の書き方を読む：2022年度・2022年・2022・FY2022・令和3年度・R5年度・R8・H31・平成31年度・令和元年度。 */
export function parseYearLabel(text: string): YearLabel | null {
  const s = nfkc(text).replace(/\s+/g, "");
  let m = /^(?:FY)?(\d{4})(年度|年)?$/i.exec(s);
  if (m) {
    const y = Number(m[1]);
    if (y < 1868 || y > 2200) return null;
    const fy = /^FY/i.test(s) ? true : m[2] === "年度" ? true : m[2] === "年" ? false : null;
    return { year: y, fiscal: fy, era: null };
  }
  m = new RegExp(`^${ERA_TOKEN}\\.?(\\d{1,2}|元)(年度|年)?$`).exec(s);
  if (m) {
    const y = eraYear(m[1] ?? "", m[2] ?? "");
    if (y === null) return null;
    return { year: y, fiscal: m[3] === "年度" ? true : m[3] === "年" ? false : null, era: m[1] ?? null };
  }
  return null;
}

/** 設置年などの「年」だけの書き方を読む：2002（数）・"2002"・2002年・平成10年・H10。年度・年度末・月つきは null。 */
export function parseYearOnly(value: number | string): number | null {
  if (typeof value === "number") return Number.isInteger(value) && value >= 1868 && value <= 2200 ? value : null;
  const l = parseYearLabel(value);
  if (!l || l.fiscal === true) return null;
  return l.year;
}

/** 年月日 → 年度（始まりの月から数える） */
export function fiscalYearOf(ymd: Ymd, startMonth: number): number {
  return ymd.m >= startMonth ? ymd.y : ymd.y - 1;
}

export function ymdString(d: Ymd): string {
  return `${String(d.y).padStart(4, "0")}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}`;
}
