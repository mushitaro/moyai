// 突き合せ（docs/screens.md 3.2「突き合せ」、絵は Match.dc.html）：資料をまたいで同じ作業と結んだもの（link.ts の Job と WorkLink）を、
// 資料ごとに何と書いたかで並べる。1 行は 機器 › 作業 › 年度。
// - 資料ごとの列：星取表は印の字（● ○ ◎）、日報や報告書は日付（期間は「始まり〜終わり」、日付が無ければ「記録あり」）。
// - 結果：2 つ以上の資料にあり、星取表が計画のまま（○）なのに日報か報告書に実施がある → 食い違い。2 つ以上の資料で合う → 一致。1 つの資料にだけある → 片方だけ。
// 結ぶかどうかの答えを待っているもの・外したものは並べない（決まっていない所は横の板、外したものは資料のシートが出す）。
// 星取表だけにある印も並べない（日報の無い年度の実績で埋まり、ほんとうに片方だけのものが見えなくなるため）。
import type { Linked } from "./link";

export type MatchResult = "ok" | "one" | "diff";

export interface MatchRow {
  id: string;
  machine: string;
  work: string;
  fiscalYear: number;
  /** 資料の名前 → その資料が書いたこと */
  cells: Record<string, string>;
  result: MatchResult;
  /** 片方だけのとき、その資料の名前 */
  onlyIn: string | null;
}

export interface Match {
  /** 列に並べる資料（名前の順） */
  files: string[];
  rows: MatchRow[];
  counts: Record<MatchResult, number>;
}

/** "2025-04-12" → "4/12" */
const short = (ymd: string): string => {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? `${Number(m[1])}/${Number(m[2])}` : ymd;
};

export function matchRows(linked: Linked, noDate: string): Match {
  const files = new Set<string>();
  const rows: MatchRow[] = [];
  for (const l of linked.links) {
    if (l.mode === "pending" || l.mode === "excluded") continue;
    const cells: Record<string, string> = {};
    let done = false;
    for (const u of l.job.units) {
      cells[u.file] = u.start ? (u.end && u.end !== u.start ? `${short(u.start)}〜${short(u.end)}` : short(u.start)) : noDate;
      files.add(u.file);
      done = true;
    }
    if (l.mark) {
      cells[l.mark.file] = l.mark.symbol;
      files.add(l.mark.file);
    }
    const names = Object.keys(cells);
    const result: MatchResult = names.length < 2 ? "one" : l.mark?.planOrActual === "plan" && done ? "diff" : "ok";
    rows.push({
      id: l.job.id,
      machine: l.cluster.name,
      work: l.job.units[0]?.workName ?? "",
      fiscalYear: l.job.fiscalYear,
      cells,
      result,
      onlyIn: names.length === 1 ? (names[0] ?? null) : null,
    });
  }
  rows.sort((a, b) => a.machine.localeCompare(b.machine, "ja") || a.work.localeCompare(b.work, "ja") || a.fiscalYear - b.fiscalYear);
  const counts: Record<MatchResult, number> = { ok: 0, one: 0, diff: 0 };
  for (const r of rows) counts[r.result]++;
  return { files: [...files].sort((a, b) => a.localeCompare(b, "ja")), rows, counts };
}
