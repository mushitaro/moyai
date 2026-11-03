// 写し取り：計画の書類（Plan）から、塊の並びを作る。塊は 1 つの施設の、1 段目の項目 × 作業の属性ごとに 1 行。
// 写すのは許可リストの欄だけで、欄ごとの作り手（CHUNK_BUILDERS）が数とコードからだけ値を作る。
// 費用・人・日付・備考・名前・系統の名前は、作り手が読まないので構造上写らない（写さなかった数は withheld に数える）。
// 写すのは、当てはめを人が受けた（commonItemAccepted が true の）資産の、作業の属性を人が受けた（attributeAccepted が true の）作業の、
// 実績の作業明細だけ。写さなかった行は理由ごとに数える。
import { WORK_ATTRIBUTES, type AssetNodeT, type Plan, type WorkT } from "../shared/plan";
import {
  BAND_DEFS,
  ageBand,
  intervalBand,
  observedBand,
  perVisitBand,
  type ObservedCode,
  type StatField,
  type Visit,
} from "./bands";
import { SEND_MIN_K } from "./k";

export type WorkAttribute = (typeof WORK_ATTRIBUTES)[number];

/** 塊の欄の許可リスト（順もこのとおり）。class・work・years・observed は必ず写す。 */
export const CHUNK_FIELDS = ["class", "work", "years", "observed", "interval", "manDays", "days", "ageAtWork"] as const;
export type ChunkField = (typeof CHUNK_FIELDS)[number];
export const REQUIRED_CHUNK_FIELDS = ["class", "work", "years", "observed"] as const satisfies readonly ChunkField[];
export const OPTIONAL_CHUNK_FIELDS = ["interval", "manDays", "days", "ageAtWork"] as const satisfies readonly ChunkField[];
export type OptionalChunkField = (typeof OPTIONAL_CHUNK_FIELDS)[number];

export interface Chunk {
  class: string;
  work: WorkAttribute;
  /** 作業をした年度（FY2016 の形、小さい順） */
  years: string[];
  observed: ObservedCode;
  interval?: string;
  manDays?: string;
  days?: string;
  ageAtWork?: string;
}

/** 年度の上下限（束の型と同じ） */
export const FY_MIN = 1900;
export const FY_MAX = 2199;

export type Destination = { kind: "ring" | "ledger"; id: string };

/** 写さなかった行の理由（行は、作業明細 × 対象の資産の 1 組）。 */
export const SKIP_REASONS = [
  "workMissing", // 作業明細の作業が無い
  "planned", // 計画（予定）の印。写すのは実績だけ
  "needsReview", // 写真から読み、人がまだ確かめていない
  "attributeUndecided", // 作業の属性が決まらない
  "attributeNotAccepted", // 作業の属性の当てはめを人が受けていない（案のまま）
  "fiscalYearInvalid", // 年度が上下限の外
  "targetMissing", // 対象の資産が無い
  "commonItemUndecided", // 1 段目の項目が決まらない
  "notAccepted", // 当てはめを人が受けていない（案のまま）
  "classNotCountable", // 数えられる分類まで上げても上げ先が無い（分からないものは出さない）
  "upgradeLedger", // UPGRADE は公開の台帳に出さない
  "upgradeBelowK", // UPGRADE は輪で k が下限に届くときだけ
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** 原本にあるが、欄ごと写さないもの（費用は帯にもしない）。 */
export const WITHHELD_FIELDS = ["cost", "performer", "dates", "contractor", "series", "notes", "names"] as const;
export type WithheldField = (typeof WITHHELD_FIELDS)[number];

/** 塊の欄を出さなかった理由 */
export const OMIT_REASONS = [
  "intervalSingle", // N1（年度が 1 つ）
  "intervalNoRepeat", // どの系統にも 2 回目が無い
  "intervalOutOfRange", // 間隔が帯の外
  "manDaysBundled", // まとめ工事の回（数は回の数）
  "manDaysUnconvertible", // 工数が無いか、人・日に直せない回
  "manDaysNone", // 使える回が無く、欄を出さなかった塊
  "daysBundled",
  "daysUnconvertible",
  "daysNone",
  "ageInstalledUnknown", // 最初の作業の対象の設置の年度が分からない
  "ageNegative", // 設置より前の作業（どちらかの誤り）
  "ageInstallAmbiguous", // 設置が年だけで、暦年と年度のどちらに読むかで帯が変わる
  "fieldNotAllowed", // 場の決まりが欄を外している
] as const;
export type OmitReason = (typeof OMIT_REASONS)[number];

export interface CopyRules {
  /** 写してよい欄（場の決まり）。既定はすべて */
  fields: readonly OptionalChunkField[];
  /** 帯の境目（場の決まりで粗くしたもの）。無ければコードの境目 */
  bands: Partial<Record<StatField, readonly number[]>>;
}

export const DEFAULT_COPY_RULES: CopyRules = { fields: OPTIONAL_CHUNK_FIELDS, bands: {} };

export interface CopyInput {
  plan: Plan;
  /** 分類 → 写す分類（k.ts の chooseProfile が作る）。null と、無い分類は出さない */
  lift: ReadonlyMap<string, string | null>;
  to: Destination;
  /** 輪の中で数えた k（UPGRADE を輪に出すときだけ使う） */
  ringK?: number;
  rules?: CopyRules;
}

export interface CopyResult {
  chunks: Chunk[];
  /** 写した行の数 */
  copied: number;
  /** 写さなかった行の数（理由ごと）。行の総数＝copied＋skipped の和 */
  skipped: Record<SkipReason, number>;
  /** 欄ごと写さなかったものの数 */
  withheld: Record<WithheldField, number>;
  /** 塊の欄を出さなかった数 */
  omitted: Record<OmitReason, number>;
  /** 行の総数 */
  rows: number;
}

/** 写す候補の分類：当てはめを人が受けた資産の 1 段目の項目（重ねない、コード順）。 */
export function candidateClasses(plan: Plan): string[] {
  const s = new Set<string>();
  for (const a of plan.assets) if (a.commonItemAccepted && a.commonItem) s.add(a.commonItem);
  return [...s].sort();
}

/** 日付の文字（YYYY-MM-DD・YYYY-MM）か FY の形から年度を出す。読めなければ null（推測しない）。 */
export function fiscalYearOf(s: string | null, startMonth: number): number | null {
  if (s === null) return null;
  const fy = /^FY(\d{4})$/.exec(s);
  if (fy) return Number(fy[1]);
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  return mo >= startMonth ? y : y - 1;
}

/**
 * 設置の文字から、あり得る年度の幅 [早い方, 遅い方] を出す。年だけ（"2002"）は暦年か年度かが決まらないので、
 * 年度の始まりが 1 月でなければ [y-1, y] の幅にする（どちらかに決めない）。読めなければ null。
 */
export function installFiscalRange(s: string | null, startMonth: number): [number, number] | null {
  if (s === null) return null;
  const y = /^(\d{4})$/.exec(s);
  if (y) {
    const n = Number(y[1]);
    return startMonth === 1 ? [n, n] : [n - 1, n];
  }
  const fy = fiscalYearOf(s, startMonth);
  return fy === null ? null : [fy, fy];
}

/** 集めた 1 塊分の中身。数とキーだけを持つ（系統のキーは間隔を数えるためだけに使い、写さない）。 */
interface Gathered {
  cls: string;
  work: WorkAttribute;
  /** 系統のキー → 年度の集合 */
  yearsBySeries: Map<string, Set<number>>;
  /** 年度 → その年度の対象の設置の年度の幅（分からなければ null） */
  installByYear: Map<number, ([number, number] | null)[]>;
  /** 作業明細のキー → 工数・日数・まとめ工事か・入れ子の子か */
  visits: Map<string, { manDays: number | null; days: number | null; bundled: boolean; child: boolean }>;
}

type Builder = (g: Gathered, rules: CopyRules, omit: (r: OmitReason, n?: number) => void) => string | string[] | undefined;

function allYears(g: Gathered): number[] {
  const s = new Set<number>();
  for (const ys of g.yearsBySeries.values()) for (const y of ys) s.add(y);
  return [...s].sort((a, b) => a - b);
}

function visitsOf(g: Gathered, field: "manDays" | "days"): Visit[] {
  // 入れ子の子は、自分の値が無ければ親の明細にある（まとめ工事に数え、親から割らない）。自分の値があればそれを使う
  return [...g.visits.values()].map((v) => ({ value: v[field], bundled: v.bundled || (v.child && v[field] === null) }));
}

function perVisit(field: "manDays" | "days"): Builder {
  return (g, rules, omit) => {
    const r = perVisitBand(field, visitsOf(g, field), rules.bands[field] ?? BAND_DEFS[field].edges);
    omit(field === "manDays" ? "manDaysBundled" : "daysBundled", r.bundled);
    omit(field === "manDays" ? "manDaysUnconvertible" : "daysUnconvertible", r.unconvertible);
    if (r.band === null) omit(field === "manDays" ? "manDaysNone" : "daysNone");
    return r.band ?? undefined;
  };
}

/** 欄ごとの作り手。許可リストの欄だけがここにあり、塊はここからしか作らない。 */
const CHUNK_BUILDERS: Record<Exclude<ChunkField, "class" | "work">, Builder> = {
  years: (g) => allYears(g).map((y) => `FY${y}`),
  observed: (g) => observedBand(allYears(g).length) ?? undefined,
  interval: (g, rules, omit) => {
    const r = intervalBand(
      [...g.yearsBySeries.values()].map((s) => [...s]),
      rules.bands.interval ?? BAND_DEFS.interval.edges,
    );
    if (r.band === null) omit(r.reason === "single" ? "intervalSingle" : r.reason === "noRepeat" ? "intervalNoRepeat" : "intervalOutOfRange");
    return r.band ?? undefined;
  },
  manDays: perVisit("manDays"),
  days: perVisit("days"),
  ageAtWork: (g, _rules, omit) => {
    const first = allYears(g)[0]!;
    const installs = (g.installByYear.get(first) ?? []).filter((x): x is [number, number] => x !== null);
    if (installs.length === 0) {
      omit("ageInstalledUnknown");
      return undefined;
    }
    // いちばん早い設置の幅。幅の両端で帯が同じときだけ出す
    const oldest = ageBand(first - Math.min(...installs.map((r) => r[0])), g.work);
    const youngest = ageBand(first - Math.min(...installs.map((r) => r[1])), g.work);
    if (oldest === null) {
      omit("ageNegative");
      return undefined;
    }
    // 遅い方の端だけが負：暦年か年度かが決まらないだけ（設置より前の作業とは言えない）
    if (youngest === null || oldest !== youngest) {
      omit("ageInstallAmbiguous");
      return undefined;
    }
    return oldest;
  },
};

function zeros<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
}

/** 計画の書類から塊の並びを作る。 */
export function copyOut(input: CopyInput): CopyResult {
  const { plan, lift, to } = input;
  const rules = input.rules ?? DEFAULT_COPY_RULES;
  const skipped = zeros(SKIP_REASONS);
  const withheld = zeros(WITHHELD_FIELDS);
  const omitted = zeros(OMIT_REASONS);
  const omit = (r: OmitReason, n = 1) => {
    omitted[r] += n;
  };
  const assets = new Map<string, AssetNodeT>(plan.assets.map((a) => [a.nodeKey, a]));
  const works = new Map<string, WorkT>(plan.works.map((w) => [w.workKey, w]));
  const parents = new Set(plan.works.map((w) => w.parentWorkKey).filter((x): x is string => x !== null));
  // まとめ工事：ほかの機器と一緒の作業、入れ子の親。入れ子の子は欄ごとに visitsOf で決める
  const isBundled = (w: WorkT) => w.targets.length > 1 || parents.has(w.workKey) || w.tagRange !== null || w.tagList.length > 1;
  const startMonth = plan.facility.fiscalYearStartMonth;

  // 欄ごと写さないものを数える（読むのは null かどうかだけ）
  for (const d of plan.details) {
    if (d.cost !== null) withheld.cost++;
    if (d.performer !== null) withheld.performer++;
    if (d.startDate !== null || d.endDate !== null) withheld.dates++;
    if (d.resultValue !== null || d.measuredValue !== null || d.previousValue !== null) withheld.notes++;
  }
  for (const w of plan.works) if (w.contractor !== null) withheld.contractor++;
  for (const a of plan.assets) {
    if (a.series !== null) withheld.series++;
    if (a.name !== "" || a.tag !== null) withheld.names++;
  }
  if (plan.facility.name !== "") withheld.names++;

  const groups = new Map<string, Gathered>();
  let copied = 0;
  let rows = 0;
  for (const d of plan.details) {
    const w = works.get(d.workKey);
    if (!w) {
      rows++;
      skipped.workMissing++;
      continue;
    }
    const n = w.targets.length;
    rows += n;
    const detailSkip: SkipReason | null =
      d.planOrActual !== "actual"
        ? "planned"
        : d.needsReview
          ? "needsReview"
          : w.attribute === null
            ? "attributeUndecided"
            : !w.attributeAccepted
              ? "attributeNotAccepted"
              : !Number.isInteger(d.fiscalYear) || d.fiscalYear < FY_MIN || d.fiscalYear > FY_MAX
              ? "fiscalYearInvalid"
              : null;
    if (detailSkip !== null) {
      skipped[detailSkip] += n;
      continue;
    }
    const attr = w.attribute!;
    for (const t of w.targets) {
      const a = assets.get(t);
      let reason: SkipReason | null = null;
      let cls: string | null = null;
      if (!a) reason = "targetMissing";
      else if (a.commonItem === null) reason = "commonItemUndecided";
      else if (!a.commonItemAccepted) reason = "notAccepted";
      else {
        cls = lift.get(a.commonItem) ?? null;
        if (cls === null) reason = "classNotCountable";
        else if (attr === "UPGRADE" && to.kind === "ledger") reason = "upgradeLedger";
        else if (attr === "UPGRADE" && (input.ringK ?? 0) < SEND_MIN_K) reason = "upgradeBelowK";
      }
      if (reason !== null || !a || cls === null) {
        skipped[reason ?? "targetMissing"]++;
        continue;
      }
      const key = `${cls}\u0000${attr}`;
      let g = groups.get(key);
      if (!g) {
        g = { cls, work: attr, yearsBySeries: new Map(), installByYear: new Map(), visits: new Map() };
        groups.set(key, g);
      }
      const seriesKey = a.series ?? `\u0000${a.nodeKey}`;
      if (!g.yearsBySeries.has(seriesKey)) g.yearsBySeries.set(seriesKey, new Set());
      g.yearsBySeries.get(seriesKey)!.add(d.fiscalYear);
      if (!g.installByYear.has(d.fiscalYear)) g.installByYear.set(d.fiscalYear, []);
      g.installByYear.get(d.fiscalYear)!.push(installFiscalRange(a.installedOn, startMonth));
      if (!g.visits.has(d.detailKey)) g.visits.set(d.detailKey, { manDays: d.manDays, days: d.days, bundled: isBundled(w), child: w.parentWorkKey !== null });
      copied++;
    }
  }

  const order = (x: WorkAttribute) => WORK_ATTRIBUTES.indexOf(x);
  const sorted = [...groups.values()].sort((x, y) => (x.cls < y.cls ? -1 : x.cls > y.cls ? 1 : order(x.work) - order(y.work)));
  const chunks: Chunk[] = sorted.map((g) => {
    const out: Record<string, unknown> = { class: g.cls, work: g.work };
    for (const f of CHUNK_FIELDS) {
      if (f === "class" || f === "work") continue;
      if ((OPTIONAL_CHUNK_FIELDS as readonly string[]).includes(f) && !rules.fields.includes(f as OptionalChunkField)) {
        omit("fieldNotAllowed");
        continue;
      }
      const v = CHUNK_BUILDERS[f](g, rules, omit);
      if (v !== undefined) out[f] = v;
    }
    return out as unknown as Chunk;
  });
  return { chunks, copied, skipped, withheld, omitted, rows };
}
