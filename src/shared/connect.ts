// 業務システムとの連携（運営者の判断 2026-11-16：変換の精度より、仕組みが完成することを優先）の、芯の約束。
// - 業務システムごとの読み書き（Maximo、のちに IFS・SAP）は別の部品 @mxstage/eam-connectors が持つ（つなぎは src/bridge/connect/package.ts。部品は optional）。
//   芯が持つのは、この約束の型・HOSHITORI の「連携」シート・設定の「連携」・人だけの送りの道・通信の例外の枠・偽の連携（試験用）。
// - 中間形は 3 つ：資産の木・保全計画・作業の実績。読んだものは取り込みの「資料」（CSV）として入れ、今の道（当てはめ・星取表・確定・署名）を通る。
// - 書き込みは、確定・署名した版の保全計画だけを元にする。足す・変えるだけで、消さない（つなぎ先にしかない計画は「片方だけ」と見せて残す）。
// - API キーは橋渡しの中だけ（つなぎ先の秘密は ConnectionStore が持ち、画面・AI の道具の返り・記録に出さない）。この型にもキーの欄は無い。
// ここは画面と橋渡しの両方が読む（node の道具を使わない）。
import { z } from "zod";
import type { Plan } from "./plan";

// ─── つなぎ先（画面と AI に見せてよい欄だけ。キーは無い）──────────────

/** テスト環境か本番か（有償の範囲：テストの読み書きと本番の読み込みは無償、本番への書き込みは、その host の有効な鍵が要る） */
export const CONNECT_ENVS = ["test", "production"] as const;
export type ConnectEnv = (typeof CONNECT_ENVS)[number];

export const connectTargetSchema = z
  .object({
    /** つなぎ先の印（ConnectionStore が付けたもの） */
    id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    /** 人が設定で付けた名前 */
    label: z.string().min(1).max(80),
    /** 業務システムの種類（maximo など。偽の連携は fake） */
    kind: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
    /** 行き先の host（人が設定したもの。通信の例外の行き先はこれだけ） */
    host: z.string().min(1).max(253),
    env: z.enum(CONNECT_ENVS),
  })
  .strict();
export type ConnectTarget = z.infer<typeof connectTargetSchema>;

// ─── 中間形（資産の木・保全計画・作業の実績）──────────────────────

export interface EamAsset {
  ref: string;
  parentRef: string | null;
  name: string;
  tag: string | null;
}
/** 保全計画：資産 × 作業 × 計画の年度 */
export interface EamPlanItem {
  ref: string;
  assetRef: string;
  work: string;
  fiscalYears: number[];
}
/** 作業の実績：資産 × 作業 × 日（工数は人・日） */
export interface EamWorkResult {
  ref: string;
  assetRef: string;
  work: string;
  date: string | null;
  manDays: number | null;
}
export interface EamRecords {
  assets: EamAsset[];
  plans: EamPlanItem[];
  results: EamWorkResult[];
}
export interface EamCounts {
  assets: number;
  plans: number;
  results: number;
}
export const countsOf = (r: EamRecords): EamCounts => ({ assets: r.assets.length, plans: r.plans.length, results: r.results.length });

// ─── 書き込みの案と突合 ───────────────────────────────────────

/** 保全計画の 1 行の比べる鍵：資産の道（上から「 › 」でつなぐ）と作業の名前 */
export interface PlanLine {
  key: string;
  assetPath: string;
  work: string;
  fiscalYears: number[];
}

export const CONNECT_PATH_SEP = " › ";
const lineKey = (assetPath: string, work: string) => `${assetPath}|${work}`;
const sortYears = (ys: Iterable<number>) => [...new Set(ys)].sort((a, b) => a - b);

/** 資産の木の道（上から）。親をたどれない・回っているときは、たどれた所まで */
function pathsOf<T>(items: readonly T[], keyOf: (x: T) => string, parentOf: (x: T) => string | null, nameOf: (x: T) => string): Map<string, string> {
  const by = new Map(items.map((x) => [keyOf(x), x]));
  const out = new Map<string, string>();
  for (const x of items) {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: T | undefined = x;
    while (cur && !seen.has(keyOf(cur))) {
      seen.add(keyOf(cur));
      names.unshift(nameOf(cur).trim());
      const p = parentOf(cur);
      cur = p === null ? undefined : by.get(p);
    }
    out.set(keyOf(x), names.join(CONNECT_PATH_SEP));
  }
  return out;
}

/** 作業の名前も属性も無いときの呼び名 */
const NO_WORK_NAME = "作業";

/** 確定・署名した版の保全計画（計画の印のある年度）を、比べる行にする。計画の年度の無い作業は書かない */
export function planLinesOfPlan(plan: Plan): PlanLine[] {
  const paths = pathsOf(plan.assets, (a) => a.nodeKey, (a) => a.parentKey, (a) => a.name);
  const years = new Map<string, number[]>();
  for (const d of plan.details) if (d.planOrActual === "plan") years.set(d.workKey, [...(years.get(d.workKey) ?? []), d.fiscalYear]);
  const lines = new Map<string, PlanLine>();
  for (const w of plan.works) {
    const ys = years.get(w.workKey);
    if (!ys?.length) continue;
    // 資料に作業の名前が無い計画の印（星取表の様式など）は、作業の属性のコードで呼ぶ（画面の名前は Skillパックが持つので、ここでは訳さない）
    const name = w.kind.trim() || w.attribute || NO_WORK_NAME;
    for (const t of w.targets) {
      const assetPath = paths.get(t);
      if (!assetPath) continue;
      const key = lineKey(assetPath, name);
      const prev = lines.get(key);
      lines.set(key, { key, assetPath, work: name, fiscalYears: sortYears([...(prev?.fiscalYears ?? []), ...ys]) });
    }
  }
  return [...lines.values()].sort((a, b) => a.key.localeCompare(b.key, "ja"));
}

/** つなぎ先の保全計画を、比べる行にする */
export function planLinesOfRecords(r: EamRecords): PlanLine[] {
  const paths = pathsOf(r.assets, (a) => a.ref, (a) => a.parentRef, (a) => a.name);
  const lines = new Map<string, PlanLine>();
  for (const p of r.plans) {
    const assetPath = paths.get(p.assetRef);
    if (!assetPath) continue;
    const key = lineKey(assetPath, p.work.trim());
    const prev = lines.get(key);
    lines.set(key, { key, assetPath, work: p.work.trim(), fiscalYears: sortYears([...(prev?.fiscalYears ?? []), ...p.fiscalYears]) });
  }
  return [...lines.values()].sort((a, b) => a.key.localeCompare(b.key, "ja"));
}

export const MATCH_RESULTS = ["ok", "one", "diff"] as const;
export type ConnectMatchResult = (typeof MATCH_RESULTS)[number];
/** 突合の 1 行（突合のシートと同じ ✓ 一致 / ! 片方だけ / × 食い違い） */
export interface ConnectMatchRow {
  key: string;
  assetPath: string;
  work: string;
  moyai: number[] | null;
  target: number[] | null;
  result: ConnectMatchResult;
  /** 片方だけのとき、どちらにあるか */
  onlyIn: "moyai" | "target" | null;
}
/** 書き込みの 1 件：足す（つなぎ先に無い）・変える（年度が違う）。消すことはしない */
export interface EamWriteChange {
  op: "add" | "change";
  key: string;
  assetPath: string;
  work: string;
  before: number[] | null;
  after: number[];
}
export interface EamWritePlan {
  rows: ConnectMatchRow[];
  changes: EamWriteChange[];
  counts: { ok: number; one: number; diff: number; add: number; change: number };
}

const sameYears = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** 版の保全計画と、つなぎ先の保全計画を突き合わせ、書き込みの案（足す・変える）を作る（部品の planCommit が入るまでの芯の作り） */
export function planWrite(moyai: readonly PlanLine[], target: readonly PlanLine[]): EamWritePlan {
  const t = new Map(target.map((l) => [l.key, l]));
  const m = new Map(moyai.map((l) => [l.key, l]));
  const keys = [...new Set([...m.keys(), ...t.keys()])].sort((a, b) => a.localeCompare(b, "ja"));
  const rows: ConnectMatchRow[] = [];
  const changes: EamWriteChange[] = [];
  for (const key of keys) {
    const a = m.get(key);
    const b = t.get(key);
    const any = (a ?? b)!;
    const result: ConnectMatchResult = a && b ? (sameYears(a.fiscalYears, b.fiscalYears) ? "ok" : "diff") : "one";
    rows.push({ key, assetPath: any.assetPath, work: any.work, moyai: a?.fiscalYears ?? null, target: b?.fiscalYears ?? null, result, onlyIn: a && b ? null : a ? "moyai" : "target" });
    if (a && !b) changes.push({ op: "add", key, assetPath: a.assetPath, work: a.work, before: null, after: a.fiscalYears });
    if (a && b && result === "diff") changes.push({ op: "change", key, assetPath: a.assetPath, work: a.work, before: b.fiscalYears, after: a.fiscalYears });
  }
  const n = (r: ConnectMatchResult) => rows.filter((x) => x.result === r).length;
  return { rows, changes, counts: { ok: n("ok"), one: n("one"), diff: n("diff"), add: changes.filter((c) => c.op === "add").length, change: changes.filter((c) => c.op === "change").length } };
}

/** 書き込みの案のハッシュにかける字（人が見た差分と、送る直前に作り直した差分が同じかを比べる） */
export function writePlanText(targetId: string, planId: string, version: number, changes: readonly EamWriteChange[]): string {
  return JSON.stringify({ targetId, planId, version, changes: changes.map((c) => [c.op, c.key, c.before, c.after]) });
}

// ─── 読んだものを取り込みの資料にする ──────────────────────────────

/** CSV のセル（, " 改行を含めば囲む。式に見える頭は ' を付けて字にする） */
function csvCell(v: string): string {
  const s = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 資料の名前（つなぎ先の名前と、読んだ日。道の区切りは使わない） */
export function connectFileName(label: string, ymd: string): string {
  const safe = label.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 60);
  return `連携_${safe}_作業の実績_${ymd}.csv`;
}

/**
 * 作業の実績を、作業日報と同じ並びの CSV（UTF-8、BOM つき）にする。取り込みはほかの資料と同じに読む。
 * 1 行目は表題（偽の連携は【架空】を付け、架空の施設として扱わせる）
 */
export function resultsCsv(r: EamRecords, title: string): string {
  const paths = pathsOf(r.assets, (a) => a.ref, (a) => a.parentRef, (a) => a.name);
  const byRef = new Map(r.assets.map((a) => [a.ref, a]));
  const lines = [csvCell(title), "", ["日付", "工事名", "機器", "号炉", "作業内容", "工数", "備考"].join(",")];
  for (const x of r.results) {
    const a = byRef.get(x.assetRef);
    const path = paths.get(x.assetRef) ?? "";
    const parent = a?.parentRef ? (byRef.get(a.parentRef)?.name ?? "") : "";
    const name = a?.name ?? path;
    lines.push(
      [x.date ?? "", `${x.work}（${name}）`, name, a?.tag ?? parent, x.work, x.manDays === null ? "" : `${x.manDays}人・日`, ""].map((c) => csvCell(String(c))).join(","),
    );
  }
  return `﻿${lines.join("\r\n")}\r\n`;
}
