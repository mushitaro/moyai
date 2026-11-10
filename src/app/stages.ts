// 画面の段（docs/screens.md 1・2）：MOYAI（トップ）› HOSHITORI と、設定。hash で分け、サーバーの経路は増やさない。
// 出力と共有は HOSHITORI のシート（#/merge/export・#/merge/share。mushitaro/moyai#30）。将来の帳票（KOUTEI など）も、それぞれのシートに出力と共有を持つ。
// 前の道（#/intake・#/chart・#/review・#/export・#/share・#/checkpoint）は、HOSHITORI のシートへの別名として残す（前のリンクと手順書を壊さないため）。
import { APP_PAGES } from "../shared/routes";
import { CHART_HASH } from "./chart/route";

export type Stage = "top" | "merge" | "settings" | "industries" | "selftest";
/** HOSHITORI のシート：星取表・費用・突合・ルール・照査・確定・出力・共有・資料（取り込み。開く資料は ?f=<資料の名前>。資料の選びで選ぶ） */
export type MergeSheet = "chart" | "cost" | "match" | "readings" | "check" | "decisions" | "export" | "share" | "files";
export const MERGE_SHEETS: readonly MergeSheet[] = ["chart", "cost", "match", "readings", "check", "decisions", "export", "share", "files"];
/** 確定した版があるときだけ並ぶシート（無いときに開いても「確定版なし」しか出せないので、並べない） */
export const CONFIRMED_SHEETS: readonly MergeSheet[] = ["export", "share"];

export const STAGE_HASH = { merge: "#/merge" } as const;
export const sheetHash = (s: MergeSheet) => `${STAGE_HASH.merge}/${s}`;
/** 前の段の道 → HOSHITORI のシート（ブックマークと手順書のため。開いたら新しい道に置き換える） */
export const LEGACY_HASH: Record<string, MergeSheet> = { "#/export": "export", "#/share": "share", [APP_PAGES.checkpoint]: "share" };

/** 前の段の道なら、同じ所を指す新しい道（? から後ろはそのまま）。前の道でなければ null */
export function canonicalHash(hash: string): string | null {
  const [h = "", ...rest] = hash.split("?");
  const s = LEGACY_HASH[h];
  if (!s) return null;
  return rest.length ? `${sheetHash(s)}?${rest.join("?")}` : sheetHash(s);
}

export interface Route {
  stage: Stage;
  /** HOSHITORI のとき、hash が指すシート（無ければ MERGE が選ぶ） */
  sheet: MergeSheet | null;
}

export function routeOf(hash: string): Route {
  const h = hash.split("?")[0] ?? "";
  if (h === APP_PAGES.selftest) return { stage: "selftest", sheet: null };
  if (h === APP_PAGES.settings) return { stage: "settings", sheet: null };
  if (h === APP_PAGES.industries) return { stage: "industries", sheet: null };
  const legacy = LEGACY_HASH[h];
  if (legacy) return { stage: "merge", sheet: legacy };
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
