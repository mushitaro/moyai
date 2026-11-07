// 設定の「表示」の節（仕事 chat-ops-v1。置き場と字は docs/screens.md に無いので仮。Wire の確認待ち）：
// 星取表の階層の並び・機器の並び・計画の最大年度を、作業中の計画の施設ごとに人が切り替える。
// AI の screen_set と同じ関数（state/screen.ts の setDisplayPrefs、plan/chart.ts の siblingOrder）を通す。見せ方だけで、計画は変えない。
import { useMemo, useState } from "react";
import { buildChart, siblingOrder, type ChartModel } from "../../plan/chart";
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

export function DisplaySettings({ plan }: { plan: Plan | null }) {
  const key = plan?.facility.facilityKey ?? null;
  const prefs = useDisplayPrefs(key);
  const model = useMemo(() => (plan ? displayModel(plan, prefs) : null), [plan, prefs]);
  const parents = useMemo(() => (model ? reorderParents(model) : []), [model]);
  const [parent, setParent] = useState("");
  const [year, setYear] = useState("");
  const [yearError, setYearError] = useState<string | null>(null);
  if (!plan || !key || !model) return <span data-testid="display-no-plan">{T.displayNoPlan}</span>;
  const lastStar = plan.details.length > 0 ? plan.details.reduce((m, d) => Math.max(m, d.fiscalYear), -Infinity) : null;
  const moved = Object.keys(prefs.rowOrder).length;
  const chosen = parents.find((p) => p.id === parent) ?? null;
  const applyYear = () => {
    const y = Number(year.trim());
    if (!Number.isInteger(y) || y < FISCAL_YEAR_MIN || y > FISCAL_YEAR_MAX) return setYearError(T.lastYearInput);
    if (lastStar !== null && y < lastStar) return setYearError(T.lastYearBefore(y));
    setYearError(null);
    setDisplayPrefs(key, { lastFiscalYear: y });
    setYear("");
  };
  const up = (i: number) => {
    if (!chosen || i === 0) return;
    const r = siblingOrder(model, chosen.children[i]!.id, chosen.children[i - 1]!.id);
    if (typeof r === "string") return;
    setDisplayPrefs(key, { rowOrder: { ...prefs.rowOrder, [r.parent]: r.order } });
  };
  const label = (s: string) => (
    <span className="moyai-settings-label" style={{ fontSize: "var(--mantine-font-size-xs)", color: "var(--text-3)", minWidth: 72, display: "inline-block" }}>
      {s}
    </span>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="display-settings">
      <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
        {label(T.levelOrderLabel)}
        <Switch<LevelOrder>
          value={prefs.levelOrder}
          onChange={(v) => setDisplayPrefs(key, { levelOrder: v })}
          data={LEVEL_ORDERS.map((v) => ({ value: v, label: T.levelOrder[v] ?? v }))}
          aria-label={T.levelOrderLabel}
          data-testid="display-level-order"
        />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }} data-testid="display-row-order">
        {label(T.rowOrderLabel)}
        <span style={{ fontSize: "var(--mantine-font-size-sm)" }}>{moved === 0 ? T.rowOrderDefault : T.rowOrderChanged(moved)}</span>
        {moved > 0 && (
          <button type="button" className="moyai-inline-act" onClick={() => setDisplayPrefs(key, { rowOrder: DEFAULT_DISPLAY.rowOrder })} data-testid="display-row-order-reset">
            {T.rowOrderReset}
          </button>
        )}
        {parents.length > 0 && (
          <select aria-label={T.rowOrderParent} value={parent} onChange={(e) => setParent(e.currentTarget.value)} data-testid="display-row-parent">
            <option value="">{T.rowOrderParent}</option>
            {parents.map((p) => (
              <option key={p.id || "top"} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        )}
      </div>
      {chosen && (
        <ol style={{ margin: 0, paddingLeft: 96, fontSize: "var(--mantine-font-size-sm)" }} data-testid="display-row-children">
          {chosen.children.map((c, i) => (
            <li key={c.id} data-row={c.id}>
              {c.name}
              {i > 0 && (
                <button type="button" className="moyai-inline-act" onClick={() => up(i)} data-testid="display-row-up">
                  {T.rowOrderUp}
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
      <div style={{ display: "flex", gap: 12, alignItems: "baseline", flexWrap: "wrap" }} data-testid="display-last-year">
        {label(T.lastYearLabel)}
        <span style={{ fontSize: "var(--mantine-font-size-sm)" }} className="moyai-num">
          {prefs.lastFiscalYear === null ? T.lastYearNone : T.lastYearValue(prefs.lastFiscalYear)}
        </span>
        <input
          aria-label={T.lastYearInput}
          placeholder={T.lastYearInput}
          inputMode="numeric"
          value={year}
          onChange={(e) => setYear(e.currentTarget.value)}
          style={{ width: 140 }}
          data-testid="display-last-year-input"
        />
        <button type="button" className="moyai-inline-act" onClick={applyYear} disabled={year.trim() === ""} data-testid="display-last-year-apply">
          {T.lastYearApply}
        </button>
        {prefs.lastFiscalYear !== null && (
          <button type="button" className="moyai-inline-act" onClick={() => setDisplayPrefs(key, { lastFiscalYear: null })} data-testid="display-last-year-reset">
            {T.lastYearReset}
          </button>
        )}
        {yearError && (
          <span style={{ fontSize: "var(--mantine-font-size-xs)", color: "var(--shu-text)" }} data-testid="display-last-year-error">
            {yearError}
          </span>
        )}
      </div>
    </div>
  );
}
