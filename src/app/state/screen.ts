// 作業画面の見せ方（仕事 chat-ops-v1）：明暗・開く画面・保存先の入力・星取表の階層の並び・機器の並び・計画の最大年度。
// 人の操作（ヘッダの 暗 / 明、段のリンク、設定の「表示」の節）と、AI のツール screen_set（intake/screen-set.ts）が、同じ関数を通す。
// 星取表の見せ方の 3 つは施設ごとにブラウザに覚える（見せ方だけ。作業中の計画・版の記録・署名される字には入れない）。
// 保存先は人だけが変える（設定は人だけの経路。AGENTS.md）：ここでは設定の画面の入力に入れて開くだけで、保存は人が押す。
import { useSyncExternalStore } from "react";
import { LEVEL_ORDERS, SCREEN_GO, type LevelOrder, type ScreenGo } from "../../shared/tools";
import { APP_PAGES } from "../../shared/routes";
import { routeOf, sheetHash } from "../stages";

type Listener = () => void;
const listeners = new Set<Listener>();
const emit = () => {
  for (const l of [...listeners]) l();
};
function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

// ─── 明暗（ヘッダの 暗 / 明 と同じ） ─────────────────────────────

export type Theme = "light" | "dark";
let themeSetter: ((t: Theme) => void) | null = null;
let theme: Theme | null = null;

/** ヘッダの切り替えが、明暗を変える手（Mantine の setColorScheme）と今の明暗を渡す。外すときは返した関数を呼ぶ */
export function bindTheme(setter: (t: Theme) => void): () => void {
  themeSetter = setter;
  return () => {
    if (themeSetter === setter) themeSetter = null;
  };
}

/** 今の明暗を覚える（ヘッダの切り替えが、描くたびに渡す） */
export function noteTheme(t: Theme): void {
  theme = t;
}

/** 明暗を変える（人がヘッダで押したときも、AI の screen_set も、この関数）。変える手がまだ無ければ false */
export function applyTheme(t: Theme): boolean {
  if (!themeSetter) return false;
  themeSetter(t);
  theme = t;
  return true;
}

export function currentTheme(): Theme | null {
  return theme;
}

// ─── 開く画面とシート ─────────────────────────────────────────

/** screen_set の go → 画面の道（段のリンクと同じ hash） */
export const GO_HASH: Record<ScreenGo, string> = {
  top: APP_PAGES.home,
  "hoshitori.chart": sheetHash("chart"),
  "hoshitori.cost": sheetHash("cost"),
  "hoshitori.match": sheetHash("match"),
  "hoshitori.rules": sheetHash("readings"),
  "hoshitori.review": sheetHash("check"),
  "hoshitori.decisions": sheetHash("decisions"),
  "hoshitori.export": sheetHash("export"),
  "hoshitori.share": sheetHash("share"),
  "hoshitori.files": sheetHash("files"),
  // 前の値（Claude Desktop は再起動までツールの定義を持ち続けるので断らない）。同じシートを開く
  export: sheetHash("export"),
  share: sheetHash("share"),
  settings: APP_PAGES.settings,
};

/** 画面を移る（段のリンクを押したのと同じに hash を替える）。画面の外（試験の node）では false */
export function goTo(g: ScreenGo): boolean {
  if (typeof location === "undefined") return false;
  location.hash = GO_HASH[g];
  return true;
}

/** 今の画面（go の値で。業種・自己診断の画面と、シートを選んでいない HOSHITORI は null） */
export function currentGo(): ScreenGo | null {
  if (typeof location === "undefined") return null;
  const r = routeOf(location.hash);
  if (r.stage === "top") return "top";
  if (r.stage === "settings") return r.stage;
  if (r.stage !== "merge" || r.sheet === null) return null;
  return SCREEN_GO.find((g) => GO_HASH[g] === sheetHash(r.sheet!)) ?? null;
}

// ─── 保存先の入力（人が「保存」を押すまで変わらない） ─────────────────

let rootOffer: string | null = null;

/** 保存先の道を、設定の画面の保存先の欄に入れる（AI の screen_set。橋渡しが設定と同じ確かめを通したものだけ） */
export function offerRoot(path: string): void {
  rootOffer = path;
  emit();
}

/** 設定の画面が、入れる道を受け取る（1 回だけ） */
export function takeRootOffer(): string | null {
  const r = rootOffer;
  rootOffer = null;
  return r;
}

export function useRootOffer(): string | null {
  return useSyncExternalStore(subscribe, () => rootOffer, () => rootOffer);
}

// ─── 星取表の見せ方（施設ごと） ──────────────────────────────────

/** 機器の並び：親の行の id（いちばん上は ""）→ 子の行の id の並び */
export type RowOrder = Readonly<Record<string, readonly string[]>>;

export interface DisplayPrefs {
  levelOrder: LevelOrder;
  rowOrder: RowOrder;
  /** 星取表の年度の列の最後の年度（null は計画の最後の年度まで） */
  lastFiscalYear: number | null;
}

export const DEFAULT_DISPLAY: DisplayPrefs = Object.freeze({ levelOrder: "asset-first", rowOrder: Object.freeze({}), lastFiscalYear: null });
/** 年度の上下（ツールの型と同じ） */
export const FISCAL_YEAR_MIN = 1900;
export const FISCAL_YEAR_MAX = 2200;
const ROW_ORDER_PARENTS = 500;
const ROW_ORDER_IDS = 2000;
const ID_MAX = 400;

const storeKey = (facilityKey: string) => `moyai.display.${facilityKey}`;
const cache = new Map<string, DisplayPrefs>();

/** 覚えた見せ方を読む（形の外れたものは既定に戻す） */
function parsePrefs(v: unknown): DisplayPrefs {
  if (typeof v !== "object" || v === null) return DEFAULT_DISPLAY;
  const o = v as Record<string, unknown>;
  const levelOrder = (LEVEL_ORDERS as readonly unknown[]).includes(o.levelOrder) ? (o.levelOrder as LevelOrder) : DEFAULT_DISPLAY.levelOrder;
  const y = o.lastFiscalYear;
  const lastFiscalYear = typeof y === "number" && Number.isInteger(y) && y >= FISCAL_YEAR_MIN && y <= FISCAL_YEAR_MAX ? y : null;
  const rowOrder: Record<string, string[]> = {};
  if (typeof o.rowOrder === "object" && o.rowOrder !== null) {
    for (const [k, ids] of Object.entries(o.rowOrder as Record<string, unknown>).slice(0, ROW_ORDER_PARENTS)) {
      if (k.length > ID_MAX || !Array.isArray(ids)) continue;
      const ok = ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= ID_MAX).slice(0, ROW_ORDER_IDS);
      if (ok.length > 0) rowOrder[k] = ok;
    }
  }
  return { levelOrder, rowOrder, lastFiscalYear };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** 施設の見せ方（覚えていなければ既定） */
export function displayPrefs(facilityKey: string | null): DisplayPrefs {
  if (!facilityKey) return DEFAULT_DISPLAY;
  const hit = cache.get(facilityKey);
  if (hit) return hit;
  let p = DEFAULT_DISPLAY;
  try {
    const raw = storage()?.getItem(storeKey(facilityKey));
    if (raw) p = parsePrefs(JSON.parse(raw));
  } catch {
    p = DEFAULT_DISPLAY;
  }
  cache.set(facilityKey, p);
  return p;
}

/** 施設の見せ方を変えて覚える（ブラウザに覚えられなければ、このタブの間だけ持つ） */
export function setDisplayPrefs(facilityKey: string, patch: Partial<DisplayPrefs>): DisplayPrefs {
  const next = parsePrefs({ ...displayPrefs(facilityKey), ...patch });
  cache.set(facilityKey, next);
  try {
    storage()?.setItem(storeKey(facilityKey), JSON.stringify(next));
  } catch {
    // 覚えられないときは、この画面の間だけ持つ
  }
  emit();
  return next;
}

export function useDisplayPrefs(facilityKey: string | null): DisplayPrefs {
  return useSyncExternalStore(
    subscribe,
    () => displayPrefs(facilityKey),
    () => displayPrefs(facilityKey),
  );
}

/** 試験用：覚えた見せ方と明暗の手を捨てる */
export function resetScreenForTest(): void {
  cache.clear();
  themeSetter = null;
  theme = null;
  rootOffer = null;
}
