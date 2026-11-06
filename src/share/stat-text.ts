// 帯と統計の行の言い方。公開の台帳のサイト（site.ts）と星取表の画面（app/chart）が同じ言い方を使う。純粋な関数で、Node の部品を使わない。
// 画面には「中央値」「四分位」「範囲」と、その値（階級の字）を出す（docs/words.md の置き換えの残り、Wire、11-06）。
import { SITE_TEXT as T } from "../app/text/site";
import type { StatCell } from "./aggregate";

const CODE = /^([IWD])(\d+)(?:_(\d+)|(P))?$/;

/** 帯のコードを、短い日本語にする（I6_7 → 6〜7 年、W1000P → 1000 人・日以上）。知らない形はコードのまま */
export function bandShort(code: string): string {
  const m = CODE.exec(code);
  if (!m) return code;
  const unit = T.bandUnit[m[1]!] ?? "";
  if (m[4] === "P") return T.bandAtLeast(m[2]!, unit);
  return T.bandRange(m[2]!, m[3] ?? m[2]!, unit);
}

/** 2 つの帯のコードの間（下の帯の下〜上の帯の上）を、短い日本語にする（I2・I5 → 2〜5 年）。頭の字が違えば 2 つを並べる */
export function spanShort(lo: string, hi: string): string {
  if (lo === hi) return bandShort(lo);
  const a = CODE.exec(lo);
  const b = CODE.exec(hi);
  if (!a || !b || a[1] !== b[1]) return `${bandShort(lo)}〜${bandShort(hi)}`;
  const unit = T.bandUnit[a[1]!] ?? "";
  if (b[4] === "P") return T.bandAtLeast(a[2]!, unit);
  return T.bandRange(a[2]!, b[3] ?? b[2]!, unit);
}

/** 統計の行の 1 欄（x／範囲と n／中央値・四分位・n） */
export function statText(c: StatCell): string {
  if (c.shown === "x") return T.statX;
  if (c.shown === "range") return T.statRange(spanShort(c.lo, c.hi), c.n);
  return T.statMedian(bandShort(c.median), c.q1 === c.median && c.q3 === c.median ? null : spanShort(c.q1, c.q3), c.n);
}
