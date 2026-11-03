// 帯の境目を決めた測り（docs/sharing.md）を、試験の実行から作り直す道具。数え方は写し取り（copyout.ts）と同じ組み方で、
// 帯にする前の生の値（中央の値）も出す。生の値は工場の正解の世界（架空）からだけ作り、試験の中でだけ使う。
// 経過年は 2026-11-03 にどこにも出さないと決めた（src に作る道は無い）。その理由の数を作り直すため、経過年があったとしたらの帯
// （bands-1 の写し取りと同じ作り方）を、ここで計画から作る。束には入れない。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planFromWorld } from "../../../scripts/ledger/truth-plan.mjs";
import { BAND_DEFS, bandOf, median, type BandDef } from "../../../src/share/bands";
import { FY_MAX, FY_MIN, REMOVED_CHUNK_FIELDS, copyOut, installFiscalRange, type Chunk } from "../../../src/share/copyout";
import { SEND_MIN_K, coarseOf, kNational, ladder, liftClass, loadNational, loadVocab, type NationalTable } from "../../../src/share/k";
import { Plan } from "../../../src/shared/plan";
import { ROOT } from "./fixtures";

const PACK = join(ROOT, "packs", "waste-incineration");
export const nationalTable = loadNational(readFileSync(join(PACK, "national", "table.json"), "utf8"));
export const packVocab = loadVocab(readFileSync(join(PACK, "vocab.json"), "utf8"));
const packJson = JSON.parse(readFileSync(join(PACK, "pack.json"), "utf8")) as { profile: { axes: { key: string; tier: "primary" | "secondary" | "refine" }[] } };
export const packSpec = { axes: packJson.profile.axes.map((a) => ({ key: a.key, tier: a.tier })) };

export function worldOf(rel: string): unknown {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

/** 段の順と、見え方だけで k ≥ 5 に届いた段ごとの施設の数（全国の表の行から） */
export function ladderCounts(table: NationalTable = nationalTable) {
  const rungs = ladder(packSpec, table);
  const counts = rungs.map(() => 0);
  let notReached = 0;
  for (const row of table.rows) {
    if (row.n === 0) continue;
    // chooseProfile と同じ：段ごとに見え方の値を作り（粗い段は帯を粗く）、kNational で数え、最初に届いた段
    const i = rungs.findIndex((r) => {
      const axes: Record<string, string> = {};
      for (const a of r.kept) {
        const v = row.values[a]!;
        axes[a] = r.coarse && table.axes.find((x) => x.key === a)!.band ? coarseOf(table, a, v)! : v;
      }
      return kNational(table, packVocab, axes, [], r.stage) >= SEND_MIN_K;
    });
    if (i < 0) notReached += row.n;
    else counts[i]! += row.n;
  }
  return { of: table.active, rungs: rungs.map((r, i) => ({ stage: r.stage, kept: r.kept, coarse: r.coarse, facilities: counts[i]! })), notReached };
}

interface RawChunk {
  class: string;
  work: string;
  interval: number | null;
  manDays: number | null;
  days: number | null;
}

/** 写し取りと同じ組み方で、塊ごとの帯にする前の中央の値を出す（段 0 の上げ方。外した軸は無い） */
export function rawOf(plan: Plan, lift: ReadonlyMap<string, string | null>): RawChunk[] {
  const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  const groups = new Map<string, { cls: string; work: string; series: Map<string, Set<number>>; visits: Map<string, { m: number | null; d: number | null; bundled: boolean }> }>();
  for (const d of plan.details) {
    const w = works.get(d.workKey);
    if (!w || d.planOrActual !== "actual" || !w.attributeAccepted || w.attribute === null || w.attribute === "UPGRADE") continue;
    for (const t of w.targets) {
      const a = assets.get(t);
      if (!a?.commonItem || !a.commonItemAccepted) continue;
      const cls = lift.get(a.commonItem) ?? null;
      if (cls === null) continue;
      const key = `${cls}|${w.attribute}`;
      if (!groups.has(key)) groups.set(key, { cls, work: w.attribute, series: new Map(), visits: new Map() });
      const g = groups.get(key)!;
      const s = a.series ?? `#${a.nodeKey}`;
      if (!g.series.has(s)) g.series.set(s, new Set());
      g.series.get(s)!.add(d.fiscalYear);
      g.visits.set(d.detailKey, { m: d.manDays, d: d.days, bundled: w.targets.length > 1 });
    }
  }
  return [...groups.values()].map((g) => {
    const gaps: number[] = [];
    for (const ys of g.series.values()) {
      const s = [...ys].sort((x, y) => x - y);
      for (let i = 1; i < s.length; i++) gaps.push(s[i]! - s[i - 1]!);
    }
    const vs = [...g.visits.values()].filter((v) => !v.bundled);
    return {
      class: g.cls,
      work: g.work,
      interval: median(gaps),
      manDays: median(vs.map((v) => v.m).filter((x): x is number => x !== null && x > 0)),
      days: median(vs.map((v) => v.d).filter((x): x is number => x !== null && x > 0)),
    };
  });
}

const tally = (xs: (string | undefined)[]) => {
  const out: Record<string, number> = {};
  for (const x of xs) if (x !== undefined) out[x] = (out[x] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};
const uniq = (xs: (number | null)[]) => [...new Set(xs.filter((x): x is number => x !== null))].sort((a, b) => a - b);

/** 値が、いちばん近い内側の境目からどれだけ離れているか（境目に対する割合） */
function nearEdge(v: number, edges: readonly number[]): number {
  return Math.min(...edges.slice(1).map((e) => Math.abs(v - e) / e));
}

/**
 * 経過年の帯（bands-1 の写し取りが作っていた欄の境目。src には無い）。ふつうは 5 年、UPGRADE は 10 年。40 年以上は 1 つにまとめる。
 * 測りのためだけにここに置く。
 */
export const WOULD_BE_AGE_DEFS = {
  normal: { prefix: "A", edges: [0, 5, 10, 15, 20, 25, 30, 35, 40], lowOpen: false, highOpen: true },
  upgrade: { prefix: "A", edges: [0, 10, 20, 30, 40], lowOpen: false, highOpen: true },
} as const satisfies Record<string, BandDef>;

/** 経過年があったとしたらの帯。UPGRADE は 10 年帯。負の値は null。 */
export function wouldBeAgeBand(age: number, work: string): string | null {
  if (!Number.isInteger(age) || age < 0) return null;
  return bandOf(work === "UPGRADE" ? WOULD_BE_AGE_DEFS.upgrade : WOULD_BE_AGE_DEFS.normal, age);
}

/**
 * 塊ごとに、経過年があったとしたらの帯（bands-1 の写し取りと同じ作り方）。最初の年度の、その塊に写った行の対象の設置の年度の幅を集め、
 * いちばん早い設置の幅の両端で帯が同じときだけ出す（設置が分からない・設置より前・暦年か年度かで帯が割れるなら undefined）。
 * 行の選び方は写し取りと同じ（実績・確かめ済み・属性と当てはめを人が受けた・年度が上下限の内・上げた分類がその塊）。
 */
export function wouldBeAges(plan: Plan, lift: ReadonlyMap<string, string | null>, chunks: readonly Chunk[]): (string | undefined)[] {
  const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  const startMonth = plan.facility.fiscalYearStartMonth;
  return chunks.map((c) => {
    const first = Number(c.years[0]!.slice(2));
    const installs: [number, number][] = [];
    for (const d of plan.details) {
      const w = works.get(d.workKey);
      if (!w || d.fiscalYear !== first || d.planOrActual !== "actual" || d.needsReview) continue;
      if (w.attribute !== c.work || !w.attributeAccepted || d.fiscalYear < FY_MIN || d.fiscalYear > FY_MAX) continue;
      for (const t of w.targets) {
        const a = assets.get(t);
        if (!a?.commonItem || !a.commonItemAccepted || (lift.get(a.commonItem) ?? null) !== c.class) continue;
        const r = installFiscalRange(a.installedOn, startMonth);
        if (r) installs.push(r);
      }
    }
    if (installs.length === 0) return undefined;
    const oldest = wouldBeAgeBand(first - Math.min(...installs.map((r) => r[0])), c.work);
    const youngest = wouldBeAgeBand(first - Math.min(...installs.map((r) => r[1])), c.work);
    return oldest !== null && oldest === youngest ? oldest : undefined;
  });
}

/** 受け手が、塊の years と経過年の帯から読めたはずの設置の年度の幅（塊ごとの幅の重なり。重ならなければ null） */
export function installWindow(chunks: readonly Chunk[], ages: readonly (string | undefined)[]): [number, number] | null {
  let lo = -Infinity;
  let hi = Infinity;
  let any = false;
  chunks.forEach((c, i) => {
    const age = ages[i];
    const m = age ? /^A(\d+)(?:_(\d+)|P)$/.exec(age) : null;
    if (!m) return;
    const first = Number(c.years[0]!.slice(2));
    const aLo = Number(m[1]);
    const aHi = m[2] !== undefined ? Number(m[2]) : Infinity;
    lo = Math.max(lo, first - aHi);
    hi = Math.min(hi, first - aLo);
    any = true;
  });
  return any && lo <= hi ? [lo, hi] : null;
}

/** 束の塊に、どこにも出さない欄が出ている数（0 のはず） */
function removedFieldCount(chunks: readonly Chunk[]): number {
  return chunks.filter((c) => REMOVED_CHUNK_FIELDS.some((f) => Object.hasOwn(c, f))).length;
}

/** 1 つの正解の世界を測る */
export function measureWorld(rel: string) {
  const plan = Plan.parse(planFromWorld(worldOf(rel)));
  const lift = new Map<string, string | null>();
  for (const a of plan.assets) if (a.commonItem) lift.set(a.commonItem, liftClass(packVocab, nationalTable, a.commonItem, new Set()));
  const ring = copyOut({ plan, lift, to: { kind: "ring", id: "0000000000000000" }, ringK: SEND_MIN_K });
  const ledger = copyOut({ plan, lift, to: { kind: "ledger", id: "0000000000000000" } });
  const raw = rawOf(plan, lift);
  const ages = wouldBeAges(plan, lift, ring.chunks);
  const installs = plan.assets.map((a) => installFiscalRange(a.installedOn, 4)).filter((x): x is [number, number] => x !== null);
  const within = (field: "manDays" | "days") =>
    raw.filter((r) => r[field] !== null && nearEdge(r[field]!, BAND_DEFS[field].edges) < 0.15).length;
  return {
    chunks: { ring: ring.chunks.length, ledger: ledger.chunks.length },
    interval: tally(ledger.chunks.map((c) => c.interval)),
    intervalRaw: uniq(raw.map((r) => r.interval)),
    manDays: tally(ledger.chunks.map((c) => c.manDays)),
    manDaysRaw: uniq(raw.map((r) => r.manDays)),
    manDaysNearEdge: within("manDays"),
    days: tally(ledger.chunks.map((c) => c.days)),
    daysRaw: uniq(raw.map((r) => r.days)),
    daysNearEdge: within("days"),
    ageWouldBe: tally(ages),
    ageInBundles: { ring: removedFieldCount(ring.chunks), ledger: removedFieldCount(ledger.chunks) },
    installFiscalYears: [Math.min(...installs.map((r) => r[0])), Math.max(...installs.map((r) => r[1]))],
    installWindowWouldBe: installWindow(ring.chunks, ages),
    installedWithheld: { ring: ring.withheld.installed, ledger: ledger.withheld.installed },
  };
}

/** 決めた境目（コードの定数） */
export function decidedEdges() {
  return {
    interval: [...BAND_DEFS.interval.edges],
    manDays: [...BAND_DEFS.manDays.edges],
    days: [...BAND_DEFS.days.edges],
  };
}
