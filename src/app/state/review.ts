// 検査の画面と AI のツール（check_results）が共に使う：パックの検査（packs/<パック>/checks.json と sources.json）を読み、
// 作業中の計画に、画面の基準日で走らせる。検査そのものは src/review/ の純粋な関数で、ここは読み込み・基準日・AI に返す形だけを持つ。
// 基準日は人が画面で変えられる（既定は今日の日本時間の日付）。AI のツールは、画面と同じ基準日で読む（変える道は無い）。
// 延長の承認の記録の置き場はまだ無い（人だけの画面が要る）ので、承認の一覧はいつも空で渡す（画面に未実装と出す）。
import { useSyncExternalStore } from "react";
import { nodePath, runChecks, type CheckRun, type NumberKey } from "../../review/checks";
import { loadPackChecks, type ChecksLoadProblem } from "../../review/spec";
import type { Plan } from "../../shared/plan";
import { REVIEW_TEXT, exampleText, numberLabel, numberValue } from "../text/review";

const checksJsons = import.meta.glob<unknown>("../../../packs/*/checks.json", { eager: true, import: "default" });
const sourcesJsons = import.meta.glob<unknown>("../../../packs/*/sources.json", { eager: true, import: "default" });

export type Review = { kind: "ok"; run: CheckRun } | { kind: "noChecks" } | { kind: "invalid"; reason: ChecksLoadProblem; detail: string };

/** パックの検査を、計画と基準日で走らせる（同じ計画と同じ基準日なら同じ結果） */
export function reviewOf(plan: Plan, referenceDate: string): Review {
  const checks = checksJsons[`../../../packs/${plan.packId}/checks.json`];
  if (checks === undefined) return { kind: "noChecks" };
  const loaded = loadPackChecks(checks, sourcesJsons[`../../../packs/${plan.packId}/sources.json`]);
  if (!loaded.ok) return { kind: "invalid", reason: loaded.reason, detail: loaded.detail };
  return { kind: "ok", run: runChecks(loaded, { plan, referenceDate, approvals: [] }) };
}

export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** 今日の日本時間の日付（YYYY-MM-DD） */
export function todayJst(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

let referenceDate: string | null = null;
const listeners = new Set<() => void>();

/** 検査の基準日（人が画面で選んだ日。選んでいなければ今日） */
export function getReferenceDate(): string {
  return referenceDate ?? todayJst();
}

/** 人が画面で基準日を選ぶ。日付の形でなければ変えない（false を返す） */
export function setReferenceDate(date: string): boolean {
  if (!DATE_RE.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return false;
  referenceDate = date;
  for (const l of listeners) l();
  return true;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useReferenceDate(): string {
  return useSyncExternalStore(subscribe, getReferenceDate, getReferenceDate);
}

/** AI のツール（check_results）に返す形：画面と同じ言葉で、数字は丸めずに。例は段の道と年度と中身の文 */
export function checkResultsOf(plan: Plan, planVersion: number, referenceDate: string, checkId?: string): Record<string, unknown> {
  const r = reviewOf(plan, referenceDate);
  const base = {
    notice: REVIEW_TEXT.notice,
    packId: plan.packId,
    planVersion,
    referenceDate,
    notImplemented: [...REVIEW_TEXT.codeUnimplemented],
  };
  if (r.kind !== "ok")
    return {
      ...base,
      packChecks: r.kind === "noChecks" ? "none" : "invalid",
      packChecksProblem: r.kind === "invalid" ? `${REVIEW_TEXT.loadProblem[r.reason]}（${r.detail}）` : null,
      checksVersion: null,
      referenceFiscalYear: null,
      checks: [],
      notMade: [],
    };
  return {
    ...base,
    packChecks: "loaded",
    packChecksProblem: null,
    checksVersion: r.run.checksVersion,
    referenceFiscalYear: r.run.referenceFiscalYear,
    checks: r.run.results
      .filter((c) => checkId === undefined || c.checkId === checkId)
      .map((c) => ({
        checkId: c.checkId,
        kind: c.kind,
        name: c.name,
        what: c.what,
        result: c.result,
        notApplicableReason: c.notApplicable ? REVIEW_TEXT.notApplicable[c.notApplicable] : null,
        numbers: Object.fromEntries(
          (Object.entries(c.numbers) as [NumberKey, number | null][]).map(([k, v]) => [numberLabel(k, c.kind), v === null ? numberValue(k, v) : v]),
        ),
        count: c.count,
        examples: c.examples.map((e) => ({
          rowRef: e.nodeKey ? `n:${e.nodeKey}` : null,
          path: e.nodeKey ? nodePath(plan, e.nodeKey).join(REVIEW_TEXT.pathSep) : REVIEW_TEXT.wholePlan,
          fiscalYears: e.fiscalYears,
          text: exampleText(e, c),
        })),
        source: c.source,
        level: c.level,
        thresholdOrigin: c.thresholdOrigin,
        verification: c.verification,
        unimplemented: c.unimplemented,
        note: c.note,
      })),
    notMade: r.run.notMade,
  };
}
