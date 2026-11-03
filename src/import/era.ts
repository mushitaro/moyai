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
