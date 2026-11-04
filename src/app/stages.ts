// 画面の段（docs/screens.md 1・2）：MOYAI（トップ）› MERGE › EXPORT › SHARE と、設定。hash で分け、サーバーの経路は増やさない。
// 前の道（#/intake・#/chart・#/review・#/checkpoint）は、MERGE のシートと SHARE への別名として残す（前のリンクを壊さないため）。
import { APP_PAGES } from "../shared/routes";
import { CHART_HASH } from "./chart/route";

export type Stage = "top" | "merge" | "export" | "share" | "settings" | "selftest";
/** MERGE のシート：星取表・読み方・検査・決定・資料（取り込み） */
export type MergeSheet = "chart" | "readings" | "check" | "decisions" | "files";
export const MERGE_SHEETS: readonly MergeSheet[] = ["chart", "readings", "check", "decisions", "files"];

export const STAGE_HASH = { merge: "#/merge", export: "#/export", share: "#/share" } as const;
export const sheetHash = (s: MergeSheet) => `${STAGE_HASH.merge}/${s}`;

export interface Route {
  stage: Stage;
  /** MERGE のとき、hash が指すシート（無ければ MERGE が選ぶ） */
  sheet: MergeSheet | null;
}

export function routeOf(hash: string): Route {
  const h = hash.split("?")[0] ?? "";
  if (h === APP_PAGES.selftest) return { stage: "selftest", sheet: null };
  if (h === APP_PAGES.settings) return { stage: "settings", sheet: null };
  if (h === STAGE_HASH.export) return { stage: "export", sheet: null };
  if (h === STAGE_HASH.share || h === APP_PAGES.checkpoint) return { stage: "share", sheet: null };
  if (h === APP_PAGES.intake) return { stage: "merge", sheet: "files" };
  if (h === CHART_HASH) return { stage: "merge", sheet: "chart" };
  if (h === APP_PAGES.review) return { stage: "merge", sheet: "check" };
  if (h === STAGE_HASH.merge) return { stage: "merge", sheet: null };
  if (h.startsWith(`${STAGE_HASH.merge}/`)) {
    const s = h.slice(STAGE_HASH.merge.length + 1) as MergeSheet;
    return { stage: "merge", sheet: MERGE_SHEETS.includes(s) ? s : null };
  }
  return { stage: "top", sheet: null };
}
