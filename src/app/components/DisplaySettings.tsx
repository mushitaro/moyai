// 設定の「表示」の節（docs/screens.md 3.7、Wire、11-07。言葉は docs/words.md）：星取表の見せ方。施設ごとにブラウザに覚え、版には入れない。
// 押すとすぐ効く（上の行の「保存」とは別）。ふだんは Claude との会話で変えるので、ここは今の値と戻す口だけ：
// 階層「設備 › 機器 › 号炉」「設備 › 号炉 › 機器」の切り替え（号炉・系統の字は Skillパックの既定の階層の名前）、並び「計画の順」か「入れ替え n」と「| 計画の順に戻す」
// （並べ替えはここでしない。「親の行」「上へ」は置かない）、最終年度（等幅の欄と「| 適用」、既定は「計画の最終年度」、変えたら「| 計画の最終年度に戻す」、
// 当てられないときは「理由：2040 年度より後の星取 n」）。作業中の計画が無ければ「作業中の計画なし」の 1 行。
// AI の screen_set と同じ関数（state/screen.ts の setDisplayPrefs）を通す。見せ方だけで、計画は変えない。
import { useMemo, useState } from "react";
import { buildChart, type ChartModel } from "../../plan/chart";
import type { Plan } from "../../shared/plan";
import { LEVEL_ORDERS, type LevelOrder } from "../../shared/tools";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { DEFAULT_DISPLAY, FISCAL_YEAR_MAX, FISCAL_YEAR_MIN, setDisplayPrefs, useDisplayPrefs, type DisplayPrefs } from "../state/screen";
import { HUMAN_TEXT, TEXT } from "../text";
import { Switch } from "./Switch";

const T = HUMAN_TEXT.settings;

/** 施設台帳の行（畳まずに全部。今の見せ方で） */
export function displayModel(plan: Plan, prefs: DisplayPrefs): ChartModel {
  const C = TEXT.chart;
  return buildChart(
    plan,
    catalogFor(plan.packId) ?? emptyCatalog(),
    { levelFallback: C.levelFallback, commonLevels: C.commonLevels, unmapped: C.unmapped, series: C.series },
    { mode: "ledger", period: "year", layer: "adjusted", foldLevel: null, levelOrder: prefs.levelOrder, rowOrder: prefs.rowOrder },
  );
}

/** 子が 2 つ以上ある親の行（並びを入れ替えられるところ）。いちばん上は "" */
export function reorderParents(model: ChartModel): { id: string; name: string; children: { id: string; name: string }[] }[] {
  const nameOf = (id: string) => {
    const r = model.rows.find((x) => x.id === id);
    return r ? r.path.filter((x): x is string => !!x).join(TEXT.chart.pathSep) : "";
  };
  const by = new Map<string, { id: string; name: string }[]>();
  for (const r of model.rows) {
    if (r.kind !== "node") continue;
    const k = r.parentId ?? "";
    by.set(k, [...(by.get(k) ?? []), { id: r.id, name: r.path[r.level - 1] ?? "" }]);
  }
  return [...by.entries()].filter(([, c]) => c.length >= 2).map(([id, children]) => ({ id, name: id === "" ? T.rowOrderTop : nameOf(id), children }));
}

/** 号炉・系統の階層の名前（Skillパックの既定。ごみ焼却は号炉、し尿は系統。無ければ「号炉・系統」） */
export function seriesLevelName(packId: string): string {
  return catalogFor(packId)?.seriesUnit ?? T.seriesFallback;
}

/** 最終年度の欄の字を読む：当てられる年度か、当てられない理由（その年度より後の星取の数）か、読めない（null） */
export function lastYearCheck(plan: Plan, text: string): { year: number; after: number } | null {
  const t = text.normalize("NFKC").trim();
  if (!/^\d{4}$/.test(t)) return null;
  const y = Number(t);
  if (y < FISCAL_YEAR_MIN || y > FISCAL_YEAR_MAX) return null;
  // 列は星取を隠さない：その年度より後の星取があれば当てない（screen_set と同じ決まり）
  return { year: y, after: plan.details.filter((d) => d.fiscalYear > y).length };
}

export function DisplaySettings({ plan }: { plan: Plan | null }) {
  const key = plan?.facility.facilityKey ?? null;
  const prefs = useDisplayPrefs(key);
  // 欄の字（人が打っているあいだだけ持つ。打っていなければ今の最終年度）
  const [typed, setTyped] = useState<string | null>(null);
  const series = useMemo(() => (plan ? seriesLevelName(plan.packId) : T.seriesFallback), [plan?.packId]);
  if (!plan || !key) {
    return (
      <span style={{ fontSize: "var(--mantine-font-size-sm)", color: "var(--text-3)" }} data-testid="display-no-plan">
        {T.displayNoPlan}
      </span>
    );
  }
  const moved = Object.keys(prefs.rowOrder).length;
  const text = typed ?? (prefs.lastFiscalYear === null ? "" : String(prefs.lastFiscalYear));
  const check = lastYearCheck(plan, text);
  const blocked = check !== null && check.after > 0;
  const canApply = check !== null && !blocked && check.year !== prefs.lastFiscalYear;
  const apply = () => {
    if (!canApply || !check) return;
    setDisplayPrefs(key, { lastFiscalYear: check.year });
    setTyped(null);
  };
  const label = (s: string) => (
    <span className="moyai-settings-label" style={{ fontSize: "var(--mantine-font-size-xs)", color: "var(--text-3)", minWidth: 72, display: "inline-block" }}>
      {s}
    </span>
  );
  const levels = T.levelOrder(series);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="display-settings">
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        {label(T.levelOrderLabel)}
        <Switch<LevelOrder>
          value={prefs.levelOrder}
          onChange={(v) => setDisplayPrefs(key, { levelOrder: v })}
          data={LEVEL_ORDERS.map((v) => ({ value: v, label: levels[v] }))}
          aria-label={T.levelOrderLabel}
          data-testid="display-level-order"
        />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }} data-testid="display-row-order">
        {label(T.rowOrderLabel)}
        <span style={{ fontSize: "var(--mantine-font-size-sm)" }} className={moved > 0 ? "moyai-num" : undefined} data-testid="display-row-order-value">
          {moved === 0 ? T.rowOrderDefault : T.rowOrderChanged(moved)}
        </span>
        {moved > 0 && (
          <button type="button" className="moyai-inline-act" onClick={() => setDisplayPrefs(key, { rowOrder: DEFAULT_DISPLAY.rowOrder })} data-testid="display-row-order-reset">
            {T.rowOrderReset}
          </button>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }} data-testid="display-last-year">
        {label(T.lastYearLabel)}
        <input
          className="moyai-display-year moyai-num"
          aria-label={T.lastYearLabel}
          placeholder={T.lastYearPlaceholder}
          inputMode="numeric"
          maxLength={4}
          value={text}
          onChange={(e) => setTyped(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") apply();
          }}
          data-testid="display-last-year-input"
        />
        <button type="button" className="moyai-inline-act" onClick={apply} disabled={!canApply} data-testid="display-last-year-apply">
          {T.lastYearApply}
        </button>
        {prefs.lastFiscalYear === null ? (
          <span style={{ fontSize: "var(--mantine-font-size-xs)", color: "var(--text-3)" }} data-testid="display-last-year-default">
            {T.lastYearDefault}
          </span>
        ) : (
          <button
            type="button"
            className="moyai-inline-act"
            onClick={() => {
              setDisplayPrefs(key, { lastFiscalYear: null });
              setTyped(null);
            }}
            data-testid="display-last-year-reset"
          >
            {T.lastYearReset}
          </button>
        )}
        {blocked && check && (
          <span style={{ fontSize: "var(--mantine-font-size-xs)", color: "var(--text-3)" }} data-testid="display-last-year-blocked">
            {T.lastYearBlocked(check.year, check.after)}
          </span>
        )}
      </div>
    </div>
  );
}
