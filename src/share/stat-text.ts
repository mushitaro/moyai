// 帯と統計の行の言い方。公開の台帳のサイト（site.ts）と星取表の画面（app/chart）が同じ言い方を使う。純粋な関数で、Node の部品を使わない。
import { SITE_TEXT as T } from "../app/text/site";
import type { StatCell } from "./aggregate";

/** 帯のコードを、短い日本語にする（I6_7 → 6〜7 年、W1000P → 1000 人・日以上）。知らない形はコードのまま */
export function bandShort(code: string): string {
  const m = /^([IWD])(\d+)(?:_(\d+)|(P))?$/.exec(code);
  if (!m) return code;
  const unit = T.bandUnit[m[1]!] ?? "";
  if (m[4] === "P") return T.bandAtLeast(m[2]!, unit);
  return T.bandRange(m[2]!, m[3] ?? m[2]!, unit);
}

/** 統計の行の 1 欄（x／幅の帯と n／中央の帯・四分位の帯・n） */
export function statText(c: StatCell): string {
  if (c.shown === "x") return T.statX;
  if (c.shown === "range") return T.statRange(bandShort(c.lo), bandShort(c.hi), c.n);
  return T.statMedian(bandShort(c.median), bandShort(c.q1), bandShort(c.q3), c.n);
}
