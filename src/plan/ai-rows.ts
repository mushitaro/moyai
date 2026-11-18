// AI に返す星取表の行（chart_rows の rows）を、計画 1 つから作る。作業画面（作業中の計画）と橋渡し（保管先の確定した版）が同じ関数を使う。
// 行は段の道と印のある年度だけ（印は画面と同じ記号）。字は画面の言語によらず日本語（AI が読む行の字は訳さない。2026-11-16）。
// 返す数は limit と会話の残り（rowsRemaining）の小さいほうまで。会話ごとの数は橋渡しが数える（§2.12）。
import type { Plan } from "../shared/plan";
import { TEXT } from "../app/text";
import { withLang } from "../app/text/i18n";
import { assetLabels } from "./asset-names";
import { assetKeyOf, buildChart, type ChartCatalog, type ChartOptions } from "./chart";
import { workRowRef } from "./star";

const T = TEXT.intake.ai;

export interface AiRows {
  rows: { rowRef: string; cells: Record<string, string> }[];
  total: number;
}

/** 施設の見せ方（階層の並び・行の並び）。作業画面は施設ごとに覚えたもの、橋渡しは既定（覚えたものは作業画面のブラウザにだけある） */
export type AiRowsView = Pick<ChartOptions, "levelOrder" | "rowOrder">;

/** 星取表の行：段の道と、印のある年度だけ。階層と行の並びは、渡した施設の見せ方 */
export function aiChartRows(plan: Plan, catalog: ChartCatalog, layer: "base" | "adjusted", view: AiRowsView, offset: number, limit: number, rowsRemaining: number): AiRows {
  return withLang("ja", () => {
    const model = buildChart(
      plan,
      catalog,
      { levelFallback: TEXT.chart.levelFallback, commonLevels: TEXT.chart.commonLevels, unmapped: TEXT.chart.unmapped, series: TEXT.chart.series },
      { mode: "ledger", period: "year", layer: layer === "base" ? "original" : "adjusted", foldLevel: null, ...view },
    );
    const take = Math.max(0, Math.min(limit, rowsRemaining));
    const rows = model.rows.slice(offset, offset + take).map((r) => {
      const cells: Record<string, string> = { [T.rowPath]: r.path.filter((x): x is string => !!x).join(TEXT.chart.pathSep) };
      for (const p of model.periods) {
        const c = r.cells[p.key];
        if (c?.mark) cells[TEXT.chart.fiscalYear(p.fiscalYear)] = `${c.review ? TEXT.chart.reviewPrefix : ""}${TEXT.chart.mark[c.mark]}`;
      }
      return { rowRef: r.id, cells };
    });
    return { rows, total: model.rows.length };
  });
}

/**
 * 機器の行（n:…）の作業を 1 行ずつ（chart_propose の stars で指すため）：行の id は w:<作業>、欄は機器の段の道・作業の名前・星取のある年度。
 * 機器の行でない id（m:・c:）や無い機器は 0 行
 */
export function aiWorkRows(plan: Plan, rowRef: string, offset: number, limit: number, rowsRemaining: number): AiRows {
  return withLang("ja", () => {
    const nodeKey = assetKeyOf(rowRef);
    const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
    // 機器の名前は星取表の階層と同じ見せる名前（号機で分かれる同じ名前の機器は「名前 号機」）
    const shown = assetLabels(plan.assets);
    const path: string[] = [];
    for (let a = nodeKey !== null ? byKey.get(nodeKey) : undefined; a; a = a.parentKey !== null ? byKey.get(a.parentKey) : undefined) path.unshift(shown.get(a.nodeKey) ?? a.name);
    const works = nodeKey !== null && byKey.has(nodeKey) ? plan.works.filter((w) => w.targets.includes(nodeKey)) : [];
    const take = Math.max(0, Math.min(limit, rowsRemaining));
    const rows = works.slice(offset, offset + take).map((w) => {
      const cells: Record<string, string> = { [T.rowPath]: path.join(TEXT.chart.pathSep), [T.rowWork]: w.kind || w.workKey };
      const by = new Map<number, { plan: boolean; actual: boolean; review: boolean }>();
      for (const d of plan.details) {
        if (d.workKey !== w.workKey) continue;
        const c = by.get(d.fiscalYear) ?? { plan: false, actual: false, review: false };
        if (d.planOrActual === "plan") c.plan = true;
        else c.actual = true;
        if (d.needsReview) c.review = true;
        by.set(d.fiscalYear, c);
      }
      for (const fy of [...by.keys()].sort((a, b) => a - b)) {
        const c = by.get(fy)!;
        const mark = c.plan && c.actual ? "both" : c.actual ? "actual" : "plan";
        cells[TEXT.chart.fiscalYear(fy)] = `${c.review ? TEXT.chart.reviewPrefix : ""}${TEXT.chart.mark[mark]}`;
      }
      return { rowRef: workRowRef(w.workKey), cells };
    });
    return { rows, total: works.length };
  });
}
