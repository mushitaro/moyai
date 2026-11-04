// 確定した計画の置き場（docs/plan.md §2.9）：<置き場所>/plans/<計画ID>/
//   versions/<版 6 桁>.json        版の記録（足すだけ。戻すのは、前の版を指す記録を足すこと）
//   reports/<版 6 桁>-diff.xlsx    差分レポート（機器名・作業名・年度・印の前後・誰が・なぜ）
//   exports/<版 6 桁>-plan.xlsx    人が見る様式の星取表（入れ子・縦の結合・アウトライン・小計・A3 横。src/plan/export.ts）
// 書くのは橋渡しの人だけの経路だけ。版のファイルは flag "wx" で書き、同じ版を 2 度書かない。
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { AuthorKind } from "../shared/fields";
import { Plan } from "../shared/plan";
import type { ChartCatalog } from "./chart";
import { applyAcceptances, diffPlans, pendingDecisions, type Acceptance, type DiffMark, type PlanDiff } from "./diff";
import { planWorkbook } from "./export";
import { fixWorkbook } from "./xlsx-fix";

/** 書き出しに使う、パックの名前の表（無ければ共通の設備項目のシートを作らない）と、作業の属性の名前だけの表 */
export interface ExportCatalogs {
  catalog: ChartCatalog | null;
  empty: ChartCatalog;
}
export type CatalogsFor = (packId: string) => ExportCatalogs;

export const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const VERSION_FILE = /^(\d{6})\.json$/;
export const VERSION_SCHEMA = "moyai.plan-version/0";

export interface VersionRecord {
  schema: typeof VERSION_SCHEMA;
  planId: string;
  version: number;
  kind: "confirm" | "revert";
  /** 戻したときの、戻した先の版 */
  revertOf: number | null;
  /** 確定した時刻（ISO） */
  at: string;
  /** 確定したのは人だけ */
  author: "human";
  /** 作業画面のタブの回（どのクライアントか） */
  client: string;
  reason: string;
  /** この版で人が受けた決定 */
  acceptances: (Acceptance & { author: "human" })[];
  summary: { added: number; removed: number; changed: number; same: number };
  /** 前の版のファイルの SHA-256（最初の版は null） */
  prev: string | null;
  /** この版を作るのに使った読み方（3 段目の Skill）：名前・保管先からの道・版。署名した版が使った読み方は承認済み（docs/plan.md §2.17） */
  readingSkills?: { name: string; path: string; version: string }[];
  plan: Plan;
}

export interface VersionInfo {
  version: number;
  kind: "confirm" | "revert";
  revertOf: number | null;
  at: string;
  reason: string;
  summary: VersionRecord["summary"];
}

export function planDir(root: string, planId: string): string {
  if (!PLAN_ID.test(planId)) throw new Error("計画 ID の形でない");
  return join(root, "plans", planId);
}

const pad = (n: number) => String(n).padStart(6, "0");
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

async function versionNumbers(dir: string): Promise<number[]> {
  try {
    return (await readdir(join(dir, "versions")))
      .map((n) => VERSION_FILE.exec(n)?.[1])
      .filter((x): x is string => x !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

async function readVersion(dir: string, n: number): Promise<{ record: VersionRecord; text: string }> {
  const text = await readFile(join(dir, "versions", `${pad(n)}.json`), "utf8");
  const record = JSON.parse(text) as VersionRecord;
  const p = Plan.safeParse(record.plan);
  if (record.schema !== VERSION_SCHEMA || record.version !== n || !p.success) throw new Error("版のファイルの形でない");
  return { record: { ...record, plan: p.data }, text };
}

export interface PlanHistory {
  versions: VersionInfo[];
  latest: VersionRecord | null;
  /** これまでに人が受けた決定（どの版でも） */
  accepted: Acceptance[];
}

/** 計画の版の一覧と、いちばん新しい版。読めない版があれば止める（黙って飛ばさない）。 */
export async function readHistory(root: string, planId: string): Promise<PlanHistory> {
  const dir = planDir(root, planId);
  const nums = await versionNumbers(dir);
  const versions: VersionInfo[] = [];
  const accepted: Acceptance[] = [];
  let latest: VersionRecord | null = null;
  for (const n of nums) {
    const { record } = await readVersion(dir, n);
    versions.push({ version: n, kind: record.kind, revertOf: record.revertOf, at: record.at, reason: record.reason, summary: record.summary });
    for (const a of record.acceptances) accepted.push({ id: a.id, hash: a.hash, reason: a.reason });
    latest = record;
  }
  return { versions, latest, accepted };
}

export type CommitResult =
  | { ok: true; version: number; record: VersionRecord; diff: PlanDiff; files: { version: string; report: string; export: string | null } }
  | { ok: false; reason: "reasonEmpty" | "planInvalid" | "planIdInvalid" | "stale" | "pendingDecisions" | "acceptanceReasonEmpty" | "acceptanceUnknown" | "exists" | "revertUnknown"; pending?: number };

export interface CommitInput {
  root: string;
  plan: unknown;
  reason: string;
  acceptances: Acceptance[];
  /** 人がダイアログを開いたときに見た、いちばん新しい版（無ければ null）。違えば先にほかの確定が入っている */
  basedOn: number | null;
  client: string;
  now?: Date;
  /** 人が見る様式の書き出しに使う名前の表を、パックの ID から引く（無ければ書き出しを作らない） */
  catalogs?: CatalogsFor;
  /** 使った読み方（橋渡しが保管先に書いて、道と版を決めたもの） */
  readingSkills?: { name: string; path: string; version: string }[];
}

/** 計画を確定する：人が受けていない決定が残っていれば止める。版の記録と差分レポートを足す。 */
export async function commitPlan(i: CommitInput): Promise<CommitResult> {
  if (i.reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const parsed = Plan.safeParse(i.plan);
  if (!parsed.success) return { ok: false, reason: "planInvalid" };
  const plan = parsed.data;
  if (!PLAN_ID.test(plan.planId)) return { ok: false, reason: "planIdInvalid" };
  const hist = await readHistory(i.root, plan.planId);
  const latestNo = hist.latest?.version ?? null;
  if (latestNo !== i.basedOn) return { ok: false, reason: "stale" };
  const pending = pendingDecisions(plan, hist.accepted);
  const byId = new Map(i.acceptances.map((a) => [`${a.id}\u0000${a.hash}`, a]));
  for (const a of i.acceptances) {
    if (!pending.some((d) => d.id === a.id && d.hash === a.hash)) return { ok: false, reason: "acceptanceUnknown" };
    if (a.reason.trim().length === 0) return { ok: false, reason: "acceptanceReasonEmpty" };
  }
  const left = pending.filter((d) => !byId.has(`${d.id}\u0000${d.hash}`));
  if (left.length > 0) return { ok: false, reason: "pendingDecisions", pending: left.length };
  const applied = applyAcceptances(plan, i.acceptances);
  return writeVersion(i.root, hist, {
    kind: "confirm",
    revertOf: null,
    plan: applied,
    reason: i.reason.trim(),
    acceptances: i.acceptances.map((a) => ({ id: a.id, hash: a.hash, reason: a.reason.trim(), author: "human" as const })),
    client: i.client,
    now: i.now ?? new Date(),
    catalogs: i.catalogs ?? null,
    readingSkills: i.readingSkills ?? [],
  });
}

/** 前の版に戻す：戻した先の版の計画をそのまま持つ、新しい版の記録を足す（前の版は書き換えない）。 */
export async function revertPlan(i: {
  root: string;
  planId: string;
  to: number;
  reason: string;
  basedOn: number | null;
  client: string;
  now?: Date;
  catalogs?: CatalogsFor;
}): Promise<CommitResult> {
  if (i.reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  if (!PLAN_ID.test(i.planId)) return { ok: false, reason: "planIdInvalid" };
  const hist = await readHistory(i.root, i.planId);
  if ((hist.latest?.version ?? null) !== i.basedOn) return { ok: false, reason: "stale" };
  if (!hist.versions.some((v) => v.version === i.to)) return { ok: false, reason: "revertUnknown" };
  const { record } = await readVersion(planDir(i.root, i.planId), i.to);
  return writeVersion(i.root, hist, {
    kind: "revert",
    revertOf: i.to,
    plan: record.plan,
    reason: i.reason.trim(),
    acceptances: [],
    client: i.client,
    now: i.now ?? new Date(),
    catalogs: i.catalogs ?? null,
  });
}

async function writeVersion(
  root: string,
  hist: PlanHistory,
  v: {
    kind: "confirm" | "revert";
    revertOf: number | null;
    plan: Plan;
    reason: string;
    acceptances: VersionRecord["acceptances"];
    client: string;
    now: Date;
    catalogs: CatalogsFor | null;
    readingSkills?: { name: string; path: string; version: string }[];
  },
): Promise<CommitResult> {
  const dir = planDir(root, v.plan.planId);
  const version = (hist.latest?.version ?? 0) + 1;
  const prevText = hist.latest ? (await readVersion(dir, hist.latest.version)).text : null;
  const plan: Plan = { ...v.plan, version };
  const diff = diffPlans(hist.latest?.plan ?? null, plan);
  const record: VersionRecord = {
    schema: VERSION_SCHEMA,
    planId: plan.planId,
    version,
    kind: v.kind,
    revertOf: v.revertOf,
    at: v.now.toISOString(),
    author: "human",
    client: v.client,
    reason: v.reason,
    acceptances: v.acceptances,
    summary: { added: diff.added, removed: diff.removed, changed: diff.changed, same: diff.same },
    prev: prevText === null ? null : sha(prevText),
    ...(v.readingSkills?.length ? { readingSkills: v.readingSkills } : {}),
    plan,
  };
  await mkdir(join(dir, "versions"), { recursive: true });
  await mkdir(join(dir, "reports"), { recursive: true });
  const versionPath = join(dir, "versions", `${pad(version)}.json`);
  const reportPath = join(dir, "reports", `${pad(version)}-diff.xlsx`);
  try {
    await writeFile(versionPath, `${JSON.stringify(record, null, 1)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, reason: "exists" };
    throw e;
  }
  await writeAtomic(reportPath, await diffReport(record, diff));
  let exportPath: string | null = null;
  if (v.catalogs) {
    await mkdir(join(dir, "exports"), { recursive: true });
    exportPath = join(dir, "exports", `${pad(version)}-plan.xlsx`);
    const c = v.catalogs(plan.packId);
    await writeAtomic(exportPath, await planWorkbook({ plan, version, at: record.at, catalog: c.catalog, emptyCatalog: c.empty }));
  }
  return { ok: true, version, record, diff, files: { version: versionPath, report: reportPath, export: exportPath } };
}

/** 一時の名前で書いてから置き換える（書きかけを残さない。同じ名前のファイルがあれば書かない） */
async function writeAtomic(path: string, bytes: Buffer): Promise<void> {
  const tmp = `${path}.part`;
  await writeFile(tmp, bytes, { flag: "wx" });
  try {
    await rename(tmp, path);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

// ─── 差分レポート（Excel） ──────────────────────────────────

/** レポートの言葉（Excel に書く言葉。画面の言葉は src/app/text/） */
export const REPORT_TEXT = {
  sheet: "差分",
  title: "計画の差分レポート",
  plan: "計画",
  version: "版",
  kind: { confirm: "確定", revert: (n: number) => `第 ${n} 版に戻した` },
  at: "確定した時刻",
  reason: "確定の理由",
  summary: (s: VersionRecord["summary"]) => `足した印 ${s.added}　消した印 ${s.removed}　変えた印 ${s.changed}　同じ印 ${s.same}`,
  fiction: "【架空】",
  head: ["機器", "作業", "年度", "前の印", "後の印", "誰が", "なぜ"],
  mark: { plan: "○ 計画", actual: "● 実施", both: "◎ 計画と実施", none: "（印なし）" } as Record<DiffMark | "none", string>,
  author: {
    human: "人",
    ai: "AI",
    ai_relayed_human: "AI（チャットでの人の答え）",
    ai_reading: "AI（読み取り）",
    rule_code: "決まり（コード）",
  } satisfies Record<AuthorKind, string>,
  noRows: "前の版と同じです（印の差はありません）。",
  accepted: (n: number) => `この版で人が受けた AI の決定 ${n} 件`,
};

/** 差分レポートの xlsx（人が見る様式：見出しの固定、列の幅、A4 横）。 */
export async function diffReport(record: VersionRecord, diff: PlanDiff): Promise<Buffer> {
  const T = REPORT_TEXT;
  const wb = new ExcelJS.Workbook();
  wb.created = new Date(record.at);
  const ws = wb.addWorksheet(T.sheet, {
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    views: [{ state: "frozen", ySplit: 7 }],
  });
  ws.columns = [{ width: 28 }, { width: 28 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 24 }, { width: 48 }];
  const title = ws.getRow(1);
  title.getCell(1).value = `${T.title}${record.plan.facility.fictional ? `　${T.fiction}` : ""}`;
  title.font = { bold: true, size: 14 };
  ws.getRow(2).values = [T.plan, record.plan.displayName];
  ws.getRow(3).values = [T.version, record.version, record.kind === "confirm" ? T.kind.confirm : T.kind.revert(record.revertOf ?? 0)];
  ws.getRow(4).values = [T.at, record.at];
  ws.getRow(5).values = [T.reason, record.reason];
  ws.getRow(6).values = [T.summary(record.summary), "", "", "", "", "", T.accepted(record.acceptances.length)];
  const head = ws.getRow(7);
  head.values = T.head;
  head.font = { bold: true };
  head.eachCell((c) => {
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE6EEF0" } };
    c.border = { bottom: { style: "thin" } };
  });
  if (diff.rows.length === 0) ws.getRow(8).getCell(1).value = T.noRows;
  diff.rows.forEach((r, i) => {
    const row = ws.getRow(8 + i);
    row.values = [
      r.equipment,
      r.work,
      r.fiscalYear,
      T.mark[r.before ?? "none"],
      T.mark[r.after ?? "none"],
      r.authors.map((a) => T.author[a]).join("、"),
      r.basis.join(" / "),
    ];
    row.getCell(3).numFmt = "0";
  });
  ws.autoFilter = { from: { row: 7, column: 1 }, to: { row: 7, column: 7 } };
  return fixWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));
}
