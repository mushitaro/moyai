// 星取表の行と印を、計画の書類から作る（純な関数。画面にも試験にも同じものを使う）。plan §2.2。
// - 行は平らにして level と parentId を持たせる。開閉の状態は外から渡し、見える行だけを返す。
// - 段ごとに列を立て、上の行と同じ名前は空ける（ピボット表の表形式）。
// - 列は年度（施設の始まりの月）と、その下の月。印は ○ 計画、● 実施、◎ 同じ期に両方。
// - 自分の台帳の段の行と、共通の設備項目 × 作業の属性の行を切り替える。決まっていない記録は 1 行に集める。
// - 共通の設備項目の行には、似た施設の行と統計の行を場ごとに重ねられる（PeerOverlay）。
// 画面の言葉と業種の名前はここに置かない（言葉は呼ぶ側から、名前はパックのデータから受ける）。
import type { StarRow, StatCell } from "../share/aggregate";
import { STAT_FIELDS, type StatField } from "../share/bands";
import { WORK_ATTRIBUTES, type Plan, type WorkDetailT } from "../shared/plan";
import type { AuthorKind } from "../shared/fields";

export type WorkAttribute = (typeof WORK_ATTRIBUTES)[number];
export type Mark = "plan" | "actual" | "both";
export type RowMode = "ledger" | "common";
export type PeriodMode = "year" | "month";
export type Layer = "original" | "adjusted";

// ---------------------------------------------------------------- パックの名前

export interface CatalogItem {
  code: string;
  name: string;
  systemCode: string;
  /** パックの表の並び（行の順に使う） */
  order: number;
}
export interface CatalogSystem {
  code: string;
  name: string;
  order: number;
}
export interface ChartCatalog {
  workLabels: Record<WorkAttribute, string>;
  systems: Map<string, CatalogSystem>;
  items: Map<string, CatalogItem>;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string): string => {
  if (typeof v !== "string" || v === "") throw new Error(`パックの形が違う：${what}`);
  return v;
};

/**
 * パックの common.json と packs/_kinds/work.json から、行の名前の表を作る。
 * 作業の属性の名前は work.json が既定で、パックの common.json の work が言い換える。
 */
export function catalogFromPack(common: unknown, kindsWork: unknown): ChartCatalog {
  if (!isObj(common) || !Array.isArray(common.systems)) throw new Error("パックの形が違う：systems");
  if (!isObj(kindsWork) || !isObj(kindsWork.work)) throw new Error("パックの形が違う：work");
  const override = isObj(common.work) ? common.work : {};
  const workLabels = {} as Record<WorkAttribute, string>;
  for (const a of WORK_ATTRIBUTES) {
    const o = override[a];
    const d = kindsWork.work[a];
    const label = isObj(o) && typeof o.label === "string" && o.label !== "" ? o.label : isObj(d) ? d.label : undefined;
    workLabels[a] = str(label, `work.${a}.label`);
  }
  const systems = new Map<string, CatalogSystem>();
  const items = new Map<string, CatalogItem>();
  let order = 0;
  common.systems.forEach((s: unknown, si: number) => {
    if (!isObj(s)) throw new Error("パックの形が違う：systems[]");
    const code = str(s.code, "systems[].code");
    systems.set(code, { code, name: str(s.name, "systems[].name"), order: si });
    const lists: unknown[] = [];
    if (Array.isArray(s.items)) lists.push(...s.items);
    if (Array.isArray(s.variants)) for (const v of s.variants) if (isObj(v) && Array.isArray(v.items)) lists.push(...v.items);
    for (const it of lists) {
      if (!isObj(it)) throw new Error("パックの形が違う：items[]");
      const ic = str(it.code, "items[].code");
      if (!items.has(ic)) items.set(ic, { code: ic, name: str(it.name, "items[].name"), systemCode: code, order: order++ });
    }
  });
  return { workLabels, systems, items };
}

// ---------------------------------------------------------------- 期

export interface Period {
  /** 列の鍵。年度だけ "fy2019"、月 "fy2019-m04" */
  key: string;
  fiscalYear: number;
  /** 暦の月（1〜12）。年度だけの列は null */
  month: number | null;
}

/** 日付（YYYY-MM-DD）の年度。始まりの月より前の月は前の年の年度。 */
export function fiscalYearOf(date: string, startMonth: number): number {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(date);
  if (!m) throw new Error(`日付の形が違う：${date}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo >= startMonth ? y : y - 1;
}

/** 年度の中の月の並び（始まりの月から 12 か月） */
export function monthsOfFiscalYear(startMonth: number): number[] {
  return Array.from({ length: 12 }, (_, i) => ((startMonth - 1 + i) % 12) + 1);
}

const yearKey = (fy: number) => `fy${fy}`;
const monthKey = (fy: number, m: number) => `fy${fy}-m${String(m).padStart(2, "0")}`;
const monthOf = (date: string) => Number(date.slice(5, 7));

/** 記録の載る期の鍵。月の表で日付の無い記録は、その年度だけの列に載る。 */
export function periodKeyOf(d: Pick<WorkDetailT, "fiscalYear" | "startDate">, mode: PeriodMode): string {
  if (mode === "year" || d.startDate === null) return yearKey(d.fiscalYear);
  return monthKey(d.fiscalYear, monthOf(d.startDate));
}

/**
 * 列の期。年度は記録の最初から最後まで切れ目なく並べる。
 * 月の表では年度ごとに 12 か月を始まりの月から並べ、日付の無い記録がある年度だけ、その前に年度だけの列を置く。
 */
export function buildPeriods(plan: Plan, mode: PeriodMode, extraYears: number[] = []): Period[] {
  const years = [...plan.details.map((d) => d.fiscalYear), ...extraYears];
  if (years.length === 0) return [];
  const lo = Math.min(...years);
  const hi = Math.max(...years);
  const out: Period[] = [];
  const undated = new Set(plan.details.filter((d) => d.startDate === null).map((d) => d.fiscalYear));
  for (let fy = lo; fy <= hi; fy++) {
    if (mode === "year") {
      out.push({ key: yearKey(fy), fiscalYear: fy, month: null });
      continue;
    }
    if (undated.has(fy)) out.push({ key: yearKey(fy), fiscalYear: fy, month: null });
    for (const m of monthsOfFiscalYear(plan.facility.fiscalYearStartMonth)) out.push({ key: monthKey(fy, m), fiscalYear: fy, month: m });
  }
  return out;
}

// ---------------------------------------------------------------- 変更（調整後）

/** 調整後の印の変更。v0 の計画の書類には変更の層がまだ無いので、呼ぶ側が渡す（無ければ調整後＝元の計画）。 */
export interface ChartChange {
  nodeKey: string;
  fiscalYear: number;
  month: number | null;
  before: Mark | null;
  after: Mark | null;
  author: AuthorKind;
  who: string | null;
  reason: string;
}

// ---------------------------------------------------------------- 行

export interface ChartCell {
  /** 印。変更で消した印は null（変更の罫だけを見せる） */
  mark: Mark | null;
  /** 畳んだ行のまとめの印 */
  summary: boolean;
  /** 畳んだ行で、この期に印のある台数 */
  count: number | null;
  /** 写真から読んだもので、人がまだ画像と並べて確かめていない記録を含む */
  review: boolean;
  /** 調整後の表で、この期を変えた */
  change: ChartChange | null;
  /** この印のもとの記録（WorkDetail の detailKey） */
  detailKeys: string[];
}

export interface ChartRow {
  id: string;
  level: number;
  parentId: string | null;
  /** node：自分の行、unmapped：未当てはめ、peer：似た施設の 1 施設、stat：その場の統計の行 */
  kind: "node" | "unmapped" | "peer" | "stat";
  /** 1 段目からこの行までの名前（その段の列の位置に。飛ばした段は null） */
  path: (string | null)[];
  /** 段ごとの列に見せる名前。上の行と同じ名前は ""（この行の段の列は空けない） */
  levelCells: string[];
  hasChildren: boolean;
  folded: boolean;
  /** 畳んだ行は中の台数、未当てはめの行は件数。ほかは null */
  count: number | null;
  /** この行に載る記録（畳んだ行は中のすべて） */
  detailKeys: string[];
  /** 期の鍵 → 印。印の無い期は持たない */
  cells: Record<string, ChartCell>;
  /** 似た施設の行と統計の行：どの場のものか */
  place?: PlaceKind;
  /** 似た施設の行：その施設の帯（間隔・工数・日数のうちあるもの） */
  peerBands?: Partial<Record<StatField, string>>;
  /** 統計の行：欄ごとの統計（n は自分を除いた施設の数） */
  stats?: Record<StatField, StatCell>;
  /** 似た施設にだけある行（自分の計画にこの項目 × 作業の属性が無い） */
  ownMissing?: boolean;
}

export type PlaceKind = "ledger" | "ring";

/**
 * 星取表に重ねる似た施設（docs/plan.md §2.2 行の切り替え・§2.8 受け取りと 3 つの立場）。共通の設備項目の行で、年度の表のときだけ重ねる。
 * 場ごとの行（aggregate の StarRow）を、同じ項目 × 作業の属性の自分の行の下に、場の順に並べる。場をまたいで混ぜない。
 * 塊の分類が設備（1 段目の上）なら「設備全体」の行に、パックに無い分類なら行にせず数える。
 */
export interface PeerOverlay {
  places: readonly { kind: PlaceKind; rows: readonly StarRow[] }[];
  labels: {
    /** 設備の分類の塊を載せる行の名前 */
    wholeSystem: string;
    /** 似た施設の行の名前 */
    peer: (place: PlaceKind, label: string) => string;
    /** 統計の行の名前 */
    stat: (place: PlaceKind) => string;
  };
}

export interface ChartLabels {
  /** 名前の無い段（1 から数える） */
  levelFallback: (n: number) => string;
  /** 共通の設備項目の行の 3 つの段の名前（設備・項目・作業の属性） */
  commonLevels: [string, string, string];
  /** 未当てはめの行の名前 */
  unmapped: string;
  /** 系列（号炉・系統など）の見出し。計画の series（"1" か "common.<意味>"）から。同じ親の下の同じ名前の機器を見分けるため名前に添える */
  series: (series: string) => string;
}

export interface ChartOptions {
  mode: RowMode;
  period: PeriodMode;
  layer: Layer;
  /** この段で畳む（その段より深い行を隠す）。null は全部開く */
  foldLevel: number | null;
  /** 行ごとに畳んだ行（段で畳むのと重ねて使える） */
  collapsed?: ReadonlySet<string>;
  changes?: ChartChange[];
  /** 似た施設を重ねる（共通の設備項目の行・年度の表のときだけ効く） */
  peers?: PeerOverlay;
}

export interface ChartModel {
  levelNames: string[];
  periods: Period[];
  /** 見える行（表に渡す行） */
  rows: ChartRow[];
  /** すべての行の数（畳んで隠したものも） */
  totalRows: number;
  /** 行に載せられなかった記録（対象の機器が計画に無い・パックに無い項目）。黙って捨てない */
  orphanDetails: string[];
  /** 似た施設を重ねたか（帯の列を出す） */
  peersShown: boolean;
  /** 似た施設の塊のうち、パックに無い分類（行にしなかったもの）。黙って捨てない */
  unknownPeerClasses: string[];
}

interface Node {
  id: string;
  level: number;
  parentId: string | null;
  name: string;
  kind: "node" | "unmapped";
  children: Node[];
  /** この行に直に載る（記録, 機器の鍵）の組 */
  direct: { d: WorkDetailT; asset: string }[];
  /** この行に重ねる似た施設（場の順） */
  overlay?: { place: PlaceKind; row: StarRow }[];
}

interface Agg {
  plan: boolean;
  actual: boolean;
  review: boolean;
  details: Set<string>;
  assets: Set<string>;
}

function addAgg(map: Map<string, Agg>, key: string, d: WorkDetailT, asset: string) {
  let a = map.get(key);
  if (!a) map.set(key, (a = { plan: false, actual: false, review: false, details: new Set(), assets: new Set() }));
  if (d.planOrActual === "plan") a.plan = true;
  else a.actual = true;
  if (d.needsReview) a.review = true;
  a.details.add(d.detailKey);
  a.assets.add(asset);
}

const markOf = (a: { plan: boolean; actual: boolean }): Mark | null => (a.plan && a.actual ? "both" : a.plan ? "plan" : a.actual ? "actual" : null);

/** 自分の台帳の段の木。対象が計画の機器に無い記録は orphan に数える。 */
function ledgerTree(plan: Plan, labels: ChartLabels, orphan: Set<string>): Node[] {
  const byKey = new Map<string, Node>();
  // 同じ親の下に同じ名前の機器が 2 つ以上あるときだけ、名前に系列を添えて見分ける
  const sameName = new Map<string, number>();
  for (const a of plan.assets) sameName.set(`${a.parentKey ?? ""}\u0000${a.name}`, (sameName.get(`${a.parentKey ?? ""}\u0000${a.name}`) ?? 0) + 1);
  for (const a of plan.assets) {
    const dup = (sameName.get(`${a.parentKey ?? ""}\u0000${a.name}`) ?? 0) > 1;
    const name = dup && a.series !== null ? `${a.name}（${labels.series(a.series)}）` : a.name;
    byKey.set(a.nodeKey, { id: `n:${a.nodeKey}`, level: a.level, parentId: null, name, kind: "node", children: [], direct: [] });
  }
  const roots: Node[] = [];
  for (const a of plan.assets) {
    const n = byKey.get(a.nodeKey) as Node;
    const p = a.parentKey !== null ? byKey.get(a.parentKey) : undefined;
    if (p) {
      n.parentId = p.id;
      p.children.push(n);
    } else roots.push(n);
  }
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  for (const d of plan.details) {
    const w = works.get(d.workKey);
    if (!w) {
      orphan.add(d.detailKey);
      continue;
    }
    for (const t of w.targets) {
      const n = byKey.get(t);
      if (n) n.direct.push({ d, asset: t });
      else orphan.add(d.detailKey);
    }
  }
  return roots;
}

/** 共通の設備項目 × 作業の属性の木。人が受けた当てはめと作業の属性の両方がある記録だけを項目に載せ、残りは 1 行に集める。 */
function commonTree(plan: Plan, catalog: ChartCatalog, labels: ChartLabels, orphan: Set<string>, overlay: PeerOverlay | null, unknownPeer: Set<string>): Node[] {
  const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  const systems = new Map<string, Node>();
  const items = new Map<string, Node>();
  const leaves = new Map<string, Node>();
  const unmapped: Node = { id: "c:unmapped", level: 1, parentId: null, name: labels.unmapped, kind: "unmapped", children: [], direct: [] };
  for (const d of plan.details) {
    const w = works.get(d.workKey);
    if (!w) {
      orphan.add(d.detailKey);
      continue;
    }
    for (const t of w.targets) {
      const a = assets.get(t);
      if (!a) {
        orphan.add(d.detailKey);
        continue;
      }
      // 共通の行に入るのは、1 段目の項目と作業の属性の両方を人が受けたものだけ（crosswalk.ts の inCommonRows と同じ）。案のままは未当てはめ
      if (a.commonItem === null || !a.commonItemAccepted || w.attribute === null || !w.attributeAccepted) {
        unmapped.direct.push({ d, asset: t });
        continue;
      }
      const item = catalog.items.get(a.commonItem);
      const sys = item ? catalog.systems.get(item.systemCode) : undefined;
      if (!item || !sys) {
        orphan.add(d.detailKey);
        continue;
      }
      let sn = systems.get(sys.code);
      if (!sn) systems.set(sys.code, (sn = { id: `c:${sys.code}`, level: 1, parentId: null, name: sys.name, kind: "node", children: [], direct: [] }));
      let inode = items.get(item.code);
      if (!inode) {
        items.set(item.code, (inode = { id: `c:${item.code}`, level: 2, parentId: sn.id, name: item.name, kind: "node", children: [], direct: [] }));
        sn.children.push(inode);
      }
      const lk = `${item.code}:${w.attribute}`;
      let leaf = leaves.get(lk);
      if (!leaf) {
        leaves.set(lk, (leaf = { id: `c:${lk}`, level: 3, parentId: inode.id, name: catalog.workLabels[w.attribute], kind: "node", children: [], direct: [] }));
        inode.children.push(leaf);
      }
      leaf.direct.push({ d, asset: t });
    }
  }
  // 似た施設の塊：同じ項目 × 作業の属性の行に重ねる。自分に無い行は作る（自分の計画に無いことが見える）
  if (overlay) {
    const sysNode = (code: string): Node => {
      let sn = systems.get(code);
      if (!sn) systems.set(code, (sn = { id: `c:${code}`, level: 1, parentId: null, name: catalog.systems.get(code)!.name, kind: "node", children: [], direct: [] }));
      return sn;
    };
    for (const pl of overlay.places) {
      for (const r of pl.rows) {
        const item = catalog.items.get(r.class);
        const sysCode = item ? item.systemCode : catalog.systems.has(r.class) ? r.class : null;
        if (sysCode === null || !catalog.systems.has(sysCode)) {
          unknownPeer.add(r.class);
          continue;
        }
        const sn = sysNode(sysCode);
        const itemKey = item ? item.code : `${sysCode}:*`;
        let inode = items.get(itemKey);
        if (!inode) {
          items.set(itemKey, (inode = { id: `c:${itemKey}`, level: 2, parentId: sn.id, name: item ? item.name : overlay.labels.wholeSystem, kind: "node", children: [], direct: [] }));
          sn.children.push(inode);
        }
        const lk = `${itemKey}:${r.work}`;
        let leaf = leaves.get(lk);
        if (!leaf) {
          leaves.set(lk, (leaf = { id: `c:${lk}`, level: 3, parentId: inode.id, name: catalog.workLabels[r.work], kind: "node", children: [], direct: [] }));
          inode.children.push(leaf);
        }
        (leaf.overlay ??= []).push({ place: pl.kind, row: r });
      }
    }
  }
  // パックの表の並び、作業の属性はコードの並び（設備全体の行は、その設備の項目の前）
  const attrOrder = (n: Node) => WORK_ATTRIBUTES.findIndex((a) => n.id.endsWith(`:${a}`));
  const roots = [...systems.values()].sort((a, b) => (catalog.systems.get(a.id.slice(2))?.order ?? 0) - (catalog.systems.get(b.id.slice(2))?.order ?? 0));
  for (const s of roots) {
    const itemOrder = (n: Node) => (n.id.endsWith(":*") ? -1 : (catalog.items.get(n.id.slice(2))?.order ?? 0));
    s.children.sort((a, b) => itemOrder(a) - itemOrder(b));
    for (const i of s.children) i.children.sort((a, b) => attrOrder(a) - attrOrder(b));
  }
  if (unmapped.direct.length > 0) roots.push(unmapped);
  return roots;
}

function changeKey(nodeKey: string, periodKey: string) {
  return `${nodeKey}|${periodKey}`;
}

/** 計画から、見える行・列の期・段の名前を作る。 */
export function buildChart(plan: Plan, catalog: ChartCatalog, labels: ChartLabels, opts: ChartOptions): ChartModel {
  const orphan = new Set<string>();
  // 似た施設は、共通の設備項目の行・年度の表のときだけ重ねる（塊は年度の粒度しか持たない）
  const overlay = opts.peers && opts.mode === "common" && opts.period === "year" ? opts.peers : null;
  const unknownPeer = new Set<string>();
  const roots = opts.mode === "ledger" ? ledgerTree(plan, labels, orphan) : commonTree(plan, catalog, labels, orphan, overlay, unknownPeer);

  let maxLevel = 0;
  const walkMax = (ns: Node[]) => {
    for (const n of ns) {
      maxLevel = Math.max(maxLevel, n.level);
      walkMax(n.children);
    }
  };
  walkMax(roots);
  const levelNames =
    opts.mode === "ledger"
      ? Array.from({ length: Math.max(maxLevel, plan.levelNames.length) }, (_, i) => plan.levelNames[i] || labels.levelFallback(i + 1))
      : [...labels.commonLevels];
  const width = levelNames.length;

  // 調整後の表の変更（台帳の行だけに載る）
  const changes = new Map<string, ChartChange>();
  if (opts.layer === "adjusted" && opts.mode === "ledger") {
    for (const c of opts.changes ?? []) {
      const key = opts.period === "month" && c.month !== null ? monthKey(c.fiscalYear, c.month) : yearKey(c.fiscalYear);
      changes.set(changeKey(c.nodeKey, key), c);
    }
  }

  // 行ごとの集め（直に載るもの・中のすべて）
  const direct = new Map<string, Map<string, Agg>>();
  const subtree = new Map<string, Map<string, Agg>>();
  const subtreeAssets = new Map<string, Set<string>>();
  const subtreeDetails = new Map<string, Set<string>>();
  let total = 0;
  const collect = (n: Node): void => {
    total++;
    const dm = new Map<string, Agg>();
    const sm = new Map<string, Agg>();
    const assets = new Set<string>();
    const details = new Set<string>();
    for (const { d, asset } of n.direct) {
      const k = periodKeyOf(d, opts.period);
      addAgg(dm, k, d, asset);
      addAgg(sm, k, d, asset);
      details.add(d.detailKey);
      if (opts.mode === "common") assets.add(asset);
    }
    for (const c of n.children) {
      collect(c);
      for (const [k, a] of subtree.get(c.id) as Map<string, Agg>) {
        let s = sm.get(k);
        if (!s) sm.set(k, (s = { plan: false, actual: false, review: false, details: new Set(), assets: new Set() }));
        s.plan ||= a.plan;
        s.actual ||= a.actual;
        s.review ||= a.review;
        for (const x of a.details) s.details.add(x);
        for (const x of a.assets) s.assets.add(x);
      }
      for (const x of subtreeAssets.get(c.id) as Set<string>) assets.add(x);
      if (opts.mode === "ledger") assets.add(c.id);
      for (const x of subtreeDetails.get(c.id) as Set<string>) details.add(x);
    }
    direct.set(n.id, dm);
    subtree.set(n.id, sm);
    subtreeAssets.set(n.id, assets);
    subtreeDetails.set(n.id, details);
  };
  roots.forEach(collect);

  const rows: ChartRow[] = [];
  const emit = (n: Node, path: (string | null)[]) => {
    const p = path.slice();
    p[n.level - 1] = n.name;
    const hasChildren = n.children.length > 0;
    const folded = hasChildren && ((opts.foldLevel !== null && n.level >= opts.foldLevel) || (opts.collapsed?.has(n.id) ?? false));
    const cells: Record<string, ChartCell> = {};
    const src = folded ? (subtree.get(n.id) as Map<string, Agg>) : (direct.get(n.id) as Map<string, Agg>);
    for (const [k, a] of src) {
      cells[k] = { mark: markOf(a), summary: folded, count: folded ? a.assets.size : null, review: a.review, change: null, detailKeys: [...a.details] };
    }
    if (!folded && n.kind === "node" && opts.mode === "ledger" && changes.size > 0) {
      const nodeKey = n.id.slice(2);
      for (const [ck, c] of changes) {
        if (!ck.startsWith(`${nodeKey}|`)) continue;
        const k = ck.slice(nodeKey.length + 1);
        const prev = cells[k];
        cells[k] = { mark: c.after, summary: false, count: null, review: prev?.review ?? false, change: c, detailKeys: prev?.detailKeys ?? [] };
      }
    }
    const count = folded ? (subtreeAssets.get(n.id) as Set<string>).size : n.kind === "unmapped" ? (subtreeDetails.get(n.id) as Set<string>).size : null;
    const ownMissing = n.overlay !== undefined && n.direct.length === 0 && n.children.length === 0;
    rows.push({
      id: n.id,
      level: n.level,
      parentId: n.parentId,
      kind: n.kind,
      ...(ownMissing ? { ownMissing } : {}),
      path: Array.from({ length: width }, (_, i) => p[i] ?? null),
      levelCells: [],
      hasChildren,
      folded,
      count,
      detailKeys: folded ? [...(subtreeDetails.get(n.id) as Set<string>)] : [...new Set(n.direct.map((x) => x.d.detailKey))],
      cells,
    });
    if (!folded) for (const c of n.children) emit(c, p);
    if (!folded && n.overlay && overlay) emitPeers(n, p);
  };
  // 似た施設の行（場の順・札の順）と、場ごとの統計の行。段の列は最後の段にだけ名前を出す
  const emitPeers = (n: Node, path: (string | null)[]) => {
    const fullPath = Array.from({ length: width }, (_, i) => path[i] ?? null);
    for (const { place, row } of n.overlay!) {
      for (const peer of row.peers) {
        const cells: Record<string, ChartCell> = {};
        for (const y of peer.years) {
          const fy = Number(y.slice(2));
          if (Number.isInteger(fy)) cells[yearKey(fy)] = { mark: "actual", summary: false, count: null, review: false, change: null, detailKeys: [] };
        }
        const bands: Partial<Record<StatField, string>> = {};
        for (const f of STAT_FIELDS) if (peer[f] !== undefined) bands[f] = peer[f];
        const name = overlay!.labels.peer(place, peer.label);
        rows.push({ id: `${n.id}|${place}|${peer.label}`, level: n.level + 1, parentId: n.id, kind: "peer", place, peerBands: bands, path: fullPath, levelCells: lastOnly(name), hasChildren: false, folded: false, count: null, detailKeys: [], cells });
      }
      const name = overlay!.labels.stat(place);
      rows.push({ id: `${n.id}|${place}|stat`, level: n.level + 1, parentId: n.id, kind: "stat", place, stats: row.stats, path: fullPath, levelCells: lastOnly(name), hasChildren: false, folded: false, count: null, detailKeys: [], cells: {} });
    }
  };
  const lastOnly = (name: string) => Array.from({ length: width }, (_, i) => (i === width - 1 ? name : ""));
  for (const r of roots) emit(r, []);

  // 上の行と同じ名前は空ける。比べるのは 1 段目からその段までの名前の並び。この行の段の列は空けない
  let prev: ChartRow | null = null;
  for (const r of rows) {
    if (r.kind === "peer" || r.kind === "stat") continue;
    r.levelCells = r.path.map((name, i) => {
      if (name === null) return "";
      if (i === r.level - 1 || prev === null) return name;
      for (let j = 0; j <= i; j++) if (prev.path[j] !== r.path[j]) return name;
      return "";
    });
    prev = r;
  }

  // 似た施設の年度も列にする（自分の計画より前や後の年度でも、印が見えるように）
  const peerYears = overlay ? overlay.places.flatMap((pl) => pl.rows.flatMap((r) => r.peers.flatMap((x) => x.years.map((y) => Number(y.slice(2)))))).filter(Number.isInteger) : [];
  return {
    levelNames,
    periods: buildPeriods(plan, opts.period, [...(opts.layer === "adjusted" ? (opts.changes ?? []) : []).map((c) => c.fiscalYear), ...peerYears]),
    rows,
    totalRows: total,
    orphanDetails: [...orphan],
    peersShown: overlay !== null,
    unknownPeerClasses: [...unknownPeer].sort(),
  };
}

/** 段の見出しを押したときの次の畳む段：同じ段なら開き、違う段ならその段で畳む。 */
export function nextFoldLevel(current: number | null, clicked: number): number | null {
  return current === clicked ? null : clicked;
}
