// AI のツール screen_set の作業画面の側（仕事 chat-ops-v1）：チャットの頼みで、作業画面の今の状態を変える。
// どれも人の操作と同じ関数（state/screen.ts）を通す。確定・署名・送る・承認・昇格はしない（そのための道はここに無い）。
// 保存先（storageRoot）は人だけが変える（設定は人だけの経路。AGENTS.md）：橋渡しが設定と同じ確かめを通した道を、
// 設定の画面の保存先の欄に入れて開くだけで、保存は人が押す。答えでは変えなかった項目に数え、理由を添える。
// 星取表の見せ方（階層の並び・機器の並び・最大年度）は施設ごとに覚える見せ方で、作業中の計画は変えない。
import { SCREEN_REFUSAL_TEXT, SCREEN_SET_NOTE, type LevelOrder, type ScreenGo, type ScreenItem, type ScreenRefusal } from "../../shared/tools";
import { buildChart, siblingOrder } from "../../plan/chart";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { getWorkingPlan } from "../state/plan-store";
import { applyTheme, currentGo, currentTheme, displayPrefs, goTo, offerRoot, setDisplayPrefs, type Theme } from "../state/screen";
import { TEXT } from "../text";
import type { IntakeWorkspace } from "./workspace";

export interface ScreenSetArgs {
  theme?: Theme;
  go?: ScreenGo;
  storageRoot?: string;
  levelOrder?: LevelOrder;
  rowOrder?: { node: string; before: string };
  lastFiscalYear?: number;
}

type Result = { ok: true; data: Record<string, unknown> };

/** 星取表の行（施設台帳の見え方。畳まずに全部）：機器の並びを指す行の id を確かめるため */
function chartModelOf(facilityKey: string) {
  const working = getWorkingPlan();
  if (!working) return null;
  const prefs = displayPrefs(facilityKey);
  const C = TEXT.chart;
  return buildChart(
    working.plan,
    catalogFor(working.plan.packId) ?? emptyCatalog(),
    { levelFallback: C.levelFallback, commonLevels: C.commonLevels, unmapped: C.unmapped, series: C.series },
    { mode: "ledger", period: "year", layer: "adjusted", foldLevel: null, levelOrder: prefs.levelOrder, rowOrder: prefs.rowOrder },
  );
}

/** 作業中の計画の、星取のいちばん遅い年度（無ければ null） */
function lastStarYear(): number | null {
  const plan = getWorkingPlan()?.plan;
  if (!plan || plan.details.length === 0) return null;
  return plan.details.reduce((m, d) => Math.max(m, d.fiscalYear), -Infinity);
}

/** 施設の鍵：作業中の計画の施設（無ければ作業画面の施設設定から作る鍵） */
export function screenFacilityKey(ws: IntakeWorkspace): string {
  return getWorkingPlan()?.plan.facility.facilityKey ?? ws.facilityKey();
}

export function screenSet(ws: IntakeWorkspace, a: ScreenSetArgs): Result {
  const changed: ScreenItem[] = [];
  const refused: { item: ScreenItem; reason: ScreenRefusal; text: string }[] = [];
  const refuse = (item: ScreenItem, reason: ScreenRefusal) => refused.push({ item, reason, text: SCREEN_REFUSAL_TEXT[reason] });
  const facility = screenFacilityKey(ws);
  let siblings: { rowRef: string; name: string }[] | undefined;

  if (a.theme !== undefined) {
    if (applyTheme(a.theme)) changed.push("theme");
    else refuse("theme", "not_on_screen");
  }
  // 階層の並びを先に変える（機器の並びは、変えたあとの階層の行で指す）
  if (a.levelOrder !== undefined) {
    setDisplayPrefs(facility, { levelOrder: a.levelOrder });
    changed.push("levelOrder");
  }
  if (a.lastFiscalYear !== undefined) {
    // 列は星取を隠さない：今の星取より前の年度にはしない
    const last = lastStarYear();
    if (last !== null && a.lastFiscalYear < last) refuse("lastFiscalYear", "year_before_stars");
    else {
      setDisplayPrefs(facility, { lastFiscalYear: a.lastFiscalYear });
      changed.push("lastFiscalYear");
    }
  }
  if (a.rowOrder !== undefined) {
    const model = chartModelOf(facility);
    if (!model) refuse("rowOrder", "no_working_plan");
    else {
      const r = siblingOrder(model, a.rowOrder.node, a.rowOrder.before);
      if (r === "row_unknown" || r === "row_not_sibling") refuse("rowOrder", r);
      else {
        const prefs = displayPrefs(facility);
        setDisplayPrefs(facility, { rowOrder: { ...prefs.rowOrder, [r.parent]: r.order } });
        changed.push("rowOrder");
        const names = new Map(model.rows.map((x) => [x.id, x.path[x.level - 1] ?? ""]));
        siblings = r.order.slice(0, 50).map((id) => ({ rowRef: id, name: names.get(id) ?? "" }));
      }
    }
  }
  // 保存先：設定の画面の保存先の欄に入れて開く（保存は人。答えでは変えなかった項目に数える）
  if (a.storageRoot !== undefined) {
    offerRoot(a.storageRoot);
    goTo("settings");
    refuse("storageRoot", "root_human_save");
  }
  if (a.go !== undefined) {
    if (a.storageRoot !== undefined && a.go !== "settings") refuse("go", "go_replaced");
    else if (goTo(a.go)) changed.push("go");
    else refuse("go", "not_on_screen");
  }
  ws.note("ai", TEXT.intake.ai.screenSet(changed.length, refused.length));
  const prefs = displayPrefs(facility);
  return {
    ok: true,
    data: {
      changed,
      refused,
      current: {
        theme: currentTheme(),
        go: currentGo(),
        levelOrder: prefs.levelOrder,
        lastFiscalYear: prefs.lastFiscalYear,
        ...(siblings ? { siblings } : {}),
      },
      note: SCREEN_SET_NOTE,
    },
  };
}
