// 署名した版の呼び名（docs/screens.md §3.4 の末尾、docs/words.md。Wire、11-07）。
// 署名した日の年度（施設の年度の始まりで数える）を和暦で「令和 8 年度版（第 1 版）」とする。版を一意に決めるのは「第 n 版」のまま。
// 見せ方だけ：版の記録・署名される字には足さない。出すのは署名の結果の 1 文とトップの版の履歴の行だけ。編集中の版には付けない。
// 和暦の表と年度の数え方は src/import/era.ts のものを使う（読むだけ）。
import { eraOf, fiscalYearOf, type Ymd } from "../import/era";
import { HUMAN_TEXT } from "./text";

const V = HUMAN_TEXT.versionName;

const TOKYO_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });

/** 時刻（ISO）の、日本時間の年月日。読めない時刻は null */
export function tokyoYmd(iso: string): Ymd | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const parts = TOKYO_DATE.formatToParts(new Date(t));
  const n = (k: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === k)?.value);
  const y = n("year");
  const m = n("month");
  const d = n("day");
  return Number.isInteger(y) && Number.isInteger(m) && Number.isInteger(d) ? { y, m, d } : null;
}

/**
 * 署名した日の年度を和暦で（{ era: "令和", year: 8 }）。元号は署名した日のもの。
 * 年度がその元号の始まりの年より前に始まっていれば（その元号の年で数えると 0 以下）、年度の初日の元号で数える。
 * 読めない時刻・年度の始まりの月が 1〜12 でない・元号の表より前は null。
 */
export function signedFiscalYear(iso: string, startMonth: number): { era: string; year: number } | null {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) return null;
  const ymd = tokyoYmd(iso);
  if (!ymd) return null;
  const fy = fiscalYearOf(ymd, startMonth);
  const at = eraOf(ymd);
  if (!at) return null;
  if (fy >= at.start[0]) return { era: at.name, year: fy - at.start[0] + 1 };
  const first = eraOf({ y: fy, m: startMonth, d: 1 });
  return first ? { era: first.name, year: fy - first.start[0] + 1 } : null;
}

/**
 * 版の呼び名。署名した版（signedAt がある）は「令和 8 年度版（第 1 版）」。
 * 署名の前（編集中・渡しただけ）、年度の始まりが分からない、年度が出せないときは「第 1 版」。
 */
export function versionName(version: number, signedAt: string | null | undefined, startMonth: number | null | undefined): string {
  const fy = signedAt && typeof startMonth === "number" ? signedFiscalYear(signedAt, startMonth) : null;
  return fy ? V.signed(V.fiscalYear(fy.era, fy.year), version) : V.plain(version);
}
