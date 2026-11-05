// 確定した計画の置き場（docs/plan.md §2.9・§2.18.2）：<置き場所>/plans/<計画ID>/
//   versions/<版 6 桁>.json        版の記録（足すだけ。戻すのは、前の版を指す記録を足すこと）
//   signatures/<版>-<役目>-<鍵ID>.json  版の署名（1 つずつ別のファイル。版の記録は書き直さない）
//   ../../people/<鍵ID>.json       署名した人の呼び名と公開鍵（信じる元ではない。信じるのは各 PC が覚えた鍵）
//   reports/<版 6 桁>-diff.xlsx    差分レポート（機器名・作業名・年度・印の前後・誰が・なぜ）
//   exports/<版 6 桁>-plan.xlsx    人が見る様式の星取表（入れ子・縦の結合・アウトライン・小計・A3 横。src/plan/export.ts）
// 書くのは橋渡しの人だけの経路だけ。版のファイルは flag "wx" で書き、同じ版を 2 度書かない。
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import type { AuthorKind } from "../shared/fields";
import { Plan } from "../shared/plan";
import type { Rule } from "../shared/tools";
import type { ChartCatalog } from "./chart";
import { applyAcceptances, diffPlans, pendingDecisions, type Acceptance, type DiffMark, type PlanDiff } from "./diff";
import { planWorkbook } from "./export";
import { fixWorkbook } from "./xlsx-fix";
import { EXPORT_SIGNATURE_FILE, checkExports, type ExportInfo } from "./exports";
import { contentHash, personFile, signStatement, signatureFileName, SIGNATURE_FILE, validName, verifySignatureFile, type SignRole } from "./signature";
import { keyIdOf, type KeyPair } from "../share/sign";

/** 書き出しに使う、パックの名前の表（無ければ共通の設備項目のシートを作らない）と、作業の属性の名前だけの表 */
export interface ExportCatalogs {
  catalog: ChartCatalog | null;
  empty: ChartCatalog;
}
export type CatalogsFor = (packId: string) => ExportCatalogs;

import { PLAN_ID, planDir } from "./paths";
export { PLAN_ID, planDir };
export const VERSION_FILE = /^(\d{6})\.json$/;
/** 署名の無い前の形の版。読むだけにし、承認には数えない */
export const VERSION_SCHEMA_V0 = "moyai.plan-version/0";
export const VERSION_SCHEMA = "moyai.plan-version/1";

export interface VersionRecord {
  schema: typeof VERSION_SCHEMA | typeof VERSION_SCHEMA_V0;
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
  /** 前の形（v0）だけ：前の版のファイルの SHA-256（最初の版は null） */
  prev?: string | null;
  /**
   * 親の版（同じ計画の 1 つ前）：番号・中身のハッシュと、親の版を作った署名（確定・渡す・戻す）のファイルの SHA-256。最初の版は null（v1）。
   * 承認・差し戻しの署名は入れない（あとから足される承認や、同期で遅れて届く署名で、鎖が切れないように）。前の書き方（親の全署名）も読める。
   */
  parent?: { version: number; contentHash: string; signatures: string[] } | null;
  /** ほかの施設の版から作ったとき、その計画・版・中身のハッシュ（v1。無ければ null） */
  derivedFrom?: { planId: string; version: number; contentHash: string } | null;
  /** この版を作るのに使った読み方（3 段目の Skill）：名前・保管先からの道・版。署名した版が使った読み方は承認済み（docs/plan.md §2.17） */
  readingSkills?: { name: string; path: string; version: string }[];
  /**
   * 次の版に重ねるための記録（1C・重-2。Architect の形）：この版を組んだ資料（中身のアドレス plans/<計画ID>/sources/<SHA-256>）、
   * その資料に下した取り込みの決定、人が受けた当てはめの規則。次の版はこの資料と決定で組み直し、新しい資料を足す。
   * 当てはめは「第 n 版と同じ」の案として並べ、人が受けるまで決めない。写真のある版と前の形の版には無い（このタブの資料だけで組み直す）
   */
  sources?: VersionSource[];
  decisions?: VersionDecision[];
  crosswalk?: VersionCrosswalkRule[];
  /** 聞いた数（運営者の決定 2A）：取り込みで出た質問の数と、決定の数を作者ごとに。年ごとに「聞く数が減った」を署名のある記録で示す */
  intake?: VersionIntake;
  /** この版の差分レポートと書き出しの SHA-256（署名の中に入る。落とすときに照らす。監査 E1）。前に確定した版には無い */
  files?: { report: string; export: string | null };
  plan: Plan;
}

/** 版を組んだ資料（name は表示だけ。置き場所は SHA-256 だけで決める） */
export interface VersionSource {
  name: string;
  sha256: string;
  size: number;
}
/** 版を組んだ資料に下した取り込みの決定（作者のまま。sources はその決定が掛かった資料の SHA-256） */
export interface VersionDecision {
  questionId: string;
  answer: string;
  author: AuthorKind;
  reason: string;
  sources: string[];
}
/** 聞いた数（2A）：質問の数と、作者ごとの決定の数 */
export interface VersionIntake {
  questions: number;
  decisions: { human: number; ai: number; ai_relayed_human: number; rule_code: number };
}
/** 人が受けた当てはめの規則（次の版で「第 n 版と同じ」の案として並べる） */
export interface VersionCrosswalkRule {
  rule: Rule;
  target: "assetNode" | "work";
  value: string;
  basis: string;
}

/** 版の署名を読んで確かめたもの（鍵を信じるかは呼ぶ側が覚えた鍵と照らす） */
export interface SignatureInfo {
  role: SignRole;
  by: string;
  /** 鍵 ID と公開鍵 */
  key: string;
  pub: string;
  at: string;
  reason: string;
  /** 署名のファイルの SHA-256（次の版の親の鎖に入る） */
  fileHash: string;
}

export interface VersionInfo {
  version: number;
  kind: "confirm" | "revert";
  revertOf: number | null;
  at: string;
  reason: string;
  summary: VersionRecord["summary"];
  /** 版の記録の中身のハッシュ（JCS の SHA-256） */
  contentHash: string;
  /** 確かめた署名（形・署名・計画・版・中身のハッシュが合うものだけ） */
  signatures: SignatureInfo[];
  /** 署名の無い前の形の版（読むだけ。承認に数えない） */
  legacy: boolean;
  /** 様式で書き出した Excel への署名（確かめて合うものだけ。版を作る署名ではないので、鎖・承認・頼み・編集の番には数えない） */
  exports: ExportInfo[];
  /**
   * 確かめで合わなかったこと（無ければ null）。合わない版は開かない。
   * chain：鎖が合わない（署名の無い前の形の版が、署名のある版のあとに置かれたときも）。signature：署名のファイルが合わない。unsigned：版を作った署名が無い
   */
  problem: "chain" | "signature" | "unsigned" | null;
}

/** 版を作る署名の役目（確定・渡す・戻す）。承認・差し戻しは、版への独立の署名 */
export const CREATION_ROLES: readonly SignRole[] = ["confirm", "edit", "revert"];



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
  if ((record.schema !== VERSION_SCHEMA && record.schema !== VERSION_SCHEMA_V0) || record.version !== n || !p.success) throw new Error("版のファイルの形でない");
  return { record: { ...record, plan: p.data }, text };
}

/** 版の書き出しの署名を読む（plan/exports.ts で確かめる） */
async function readExportFiles(dir: string, version: number, planId: string, hash: string): Promise<{ ok: ExportInfo[]; bad: number }> {
  let names: string[] = [];
  try {
    names = (await readdir(join(dir, "signatures"))).filter((n) => EXPORT_SIGNATURE_FILE.exec(n)?.[1] === pad(version)).sort();
  } catch {
    return { ok: [], bad: 0 };
  }
  const files = await Promise.all(names.map(async (name) => ({ name, text: await readFile(join(dir, "signatures", name), "utf8") })));
  return checkExports(files, planId, version, hash);
}

/** 版の署名のファイルを読み、確かめて合うものだけを返す。合わないファイルは数えて返す */
async function readSignatures(dir: string, record: VersionRecord, hash: string): Promise<{ ok: SignatureInfo[]; bad: number }> {
  let names: string[] = [];
  try {
    names = (await readdir(join(dir, "signatures"))).filter((n) => SIGNATURE_FILE.exec(n)?.[1] === pad(record.version)).sort();
  } catch {
    return { ok: [], bad: 0 };
  }
  const ok: SignatureInfo[] = [];
  let bad = 0;
  for (const name of names) {
    const text = await readFile(join(dir, "signatures", name), "utf8");
    let f: unknown;
    try {
      f = JSON.parse(text);
    } catch {
      bad++;
      continue;
    }
    const m = SIGNATURE_FILE.exec(name)!;
    if (!verifySignatureFile(f)) {
      bad++;
      continue;
    }
    const st = f.statement;
    if (st.planId !== record.planId || st.version !== record.version || st.contentHash !== hash || st.role !== m[2] || st.key !== m[3]) {
      bad++;
      continue;
    }
    ok.push({ role: st.role, by: st.by, key: st.key, pub: f.pub, at: st.at, reason: st.reason, fileHash: sha(text) });
  }
  return { ok, bad };
}

export interface PlanHistory {
  versions: VersionInfo[];
  latest: VersionRecord | null;
  /** いちばん新しい版のひとつ前の版（承認を頼まれた人が、頼まれた版を前の版と比べるため） */
  previous: VersionRecord | null;
  /** 第 1 版が、ほかの施設の版から作ったものなら、その計画・版・中身のハッシュ（トップの派生の線） */
  derivedFrom: { planId: string; version: number; contentHash: string } | null;
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
  let previous: VersionRecord | null = null;
  let derivedFrom: PlanHistory["derivedFrom"] = null;
  let prevInfo: VersionInfo | null = null;
  let signedSeen = false;
  for (const n of nums) {
    const { record } = await readVersion(dir, n);
    const legacy = record.schema === VERSION_SCHEMA_V0;
    const hash = contentHash(record);
    const sigs = legacy ? { ok: [], bad: 0 } : await readSignatures(dir, record, hash);
    let problem: VersionInfo["problem"] = null;
    // 署名の無い前の形の版は、先頭に続く部分だけ許す（署名のある版のあとに置かれた前の形は、署名も鎖も見ずに最新になってしまうため）
    if (legacy && signedSeen) problem = "chain";
    if (!legacy) {
      signedSeen = true;
      // 親の鎖：前の版の中身のハッシュと、前の版を作った署名のファイルが、この版の記録と合うか。
      // 記録にある署名はどれも前の版の署名のうちにあり、少なくとも 1 つは前の版を作った署名（承認があとから足されても切れない）
      const p = record.parent ?? null;
      const prevHashes = new Set(prevInfo?.signatures.map((x) => x.fileHash) ?? []);
      const prevCreation = new Set(prevInfo?.signatures.filter((x) => CREATION_ROLES.includes(x.role)).map((x) => x.fileHash) ?? []);
      const chainOk =
        prevInfo === null
          ? p === null
          : p !== null &&
            p.version === prevInfo.version &&
            p.contentHash === prevInfo.contentHash &&
            (prevInfo.legacy ? p.signatures.length === 0 : p.signatures.every((h) => prevHashes.has(h)) && p.signatures.some((h) => prevCreation.has(h)));
      if (!chainOk || (prevInfo?.problem ?? null) !== null) problem = "chain";
      else if (sigs.bad > 0) problem = "signature";
      else if (!sigs.ok.some((x) => (record.kind === "revert" ? x.role === "revert" : x.role === "confirm" || x.role === "edit"))) problem = "unsigned";
    }
    const exports = legacy ? [] : (await readExportFiles(dir, n, record.planId, hash)).ok;
    const info: VersionInfo = { version: n, kind: record.kind, revertOf: record.revertOf, at: record.at, reason: record.reason, summary: record.summary, contentHash: hash, signatures: sigs.ok, legacy, problem, exports };
    versions.push(info);
    // 人が受けた決定に数えるのは、確かめで合う署名のある版だけ（前の形の版の受けた決定は数えない）
    if (!legacy && problem === null) for (const a of record.acceptances) accepted.push({ id: a.id, hash: a.hash, reason: a.reason });
    if (prevInfo === null) derivedFrom = record.derivedFrom ?? null;
    previous = latest;
    latest = record;
    prevInfo = info;
  }
  return { versions, latest, previous, derivedFrom, accepted };
}

/** 確かめで合う版の記録を 1 つ読む（トップの版の印のメニュー：開く・この版から次の版・この版から別の施設） */
export async function readPlanVersion(
  root: string,
  planId: string,
  version: number,
): Promise<{ ok: true; record: VersionRecord; contentHash: string } | { ok: false; reason: "versionUnknown" | "historyBroken" }> {
  const hist = await readHistory(root, planId);
  const info = hist.versions.find((v) => v.version === version);
  if (!info) return { ok: false, reason: "versionUnknown" };
  if (info.problem !== null) return { ok: false, reason: "historyBroken" };
  const { record } = await readVersion(planDir(root, planId), version);
  return { ok: true, record, contentHash: info.contentHash };
}

export type CommitResult =
  | { ok: true; version: number; record: VersionRecord; diff: PlanDiff; files: { version: string; report: string; export: string | null } }
  | {
      ok: false;
      reason: "reasonEmpty" | "planInvalid" | "planIdInvalid" | "stale" | "pendingDecisions" | "acceptanceReasonEmpty" | "acceptanceUnknown" | "exists" | "revertUnknown" | "nameInvalid" | "historyBroken" | "deriveNotFirst" | "deriveSourceInvalid";
      pending?: number;
    };

/** 署名する人：呼び名と、開いた鍵（橋渡しが開き、署名したら捨てる） */
export interface Signer {
  by: string;
  pair: KeyPair;
}

export interface CommitInput {
  root: string;
  signer: Signer;
  /** 版を作る署名の役目：自分で確定する（confirm。既定）か、編集・承認を頼んで渡す（edit）。docs/screens.md 3.4 */
  role?: "confirm" | "edit";
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
  /** 聞いた数（2A） */
  intake?: VersionIntake;
  /** 次の版に重ねるための記録（確かめは呼ぶ側の橋渡しがする） */
  sources?: VersionSource[];
  decisions?: VersionDecision[];
  crosswalk?: VersionCrosswalkRule[];
  /** ほかの施設の版から作った第 1 版のとき、その計画・版・中身のハッシュ（確かめで合う版だけ） */
  derivedFrom?: { planId: string; version: number; contentHash: string } | null;
}

/** 計画を確定する：人が受けていない決定が残っていれば止める。版の記録と差分レポートを足す。 */
export async function commitPlan(i: CommitInput): Promise<CommitResult> {
  if (i.reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const parsed = Plan.safeParse(i.plan);
  if (!parsed.success) return { ok: false, reason: "planInvalid" };
  const plan = parsed.data;
  if (!PLAN_ID.test(plan.planId)) return { ok: false, reason: "planIdInvalid" };
  if (!validName(i.signer.by)) return { ok: false, reason: "nameInvalid" };
  const hist = await readHistory(i.root, plan.planId);
  const latestNo = hist.latest?.version ?? null;
  if (latestNo !== i.basedOn) return { ok: false, reason: "stale" };
  // 確かめで合わない版の上には重ねない（鎖が切れたまま署名しない）
  if (hist.versions.some((v) => v.problem !== null)) return { ok: false, reason: "historyBroken" };
  const pending = pendingDecisions(plan, hist.accepted);
  const byId = new Map(i.acceptances.map((a) => [`${a.id}\u0000${a.hash}`, a]));
  for (const a of i.acceptances) {
    if (!pending.some((d) => d.id === a.id && d.hash === a.hash)) return { ok: false, reason: "acceptanceUnknown" };
    if (a.reason.trim().length === 0) return { ok: false, reason: "acceptanceReasonEmpty" };
  }
  const left = pending.filter((d) => !byId.has(`${d.id}\u0000${d.hash}`));
  if (left.length > 0) return { ok: false, reason: "pendingDecisions", pending: left.length };
  // 派生：第 1 版だけが、ほかの施設の確かめで合う版から作れる（元の中身のハッシュが合うときだけ）
  const from = i.derivedFrom ?? null;
  if (from) {
    if (latestNo !== null) return { ok: false, reason: "deriveNotFirst" };
    if (from.planId === plan.planId || !PLAN_ID.test(from.planId)) return { ok: false, reason: "deriveSourceInvalid" };
    const src = await readPlanVersion(i.root, from.planId, from.version);
    if (!src.ok || src.contentHash !== from.contentHash) return { ok: false, reason: "deriveSourceInvalid" };
  }
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
    sources: i.sources,
    decisions: i.decisions,
    crosswalk: i.crosswalk,
    intake: i.intake,
    signer: i.signer,
    role: i.role ?? "confirm",
    derivedFrom: from,
  });
}

/** 前の版に戻す：戻した先の版の計画をそのまま持つ、新しい版の記録を足す（前の版は書き換えない）。 */
export async function revertPlan(i: {
  root: string;
  signer: Signer;
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
  if (!validName(i.signer.by)) return { ok: false, reason: "nameInvalid" };
  const hist = await readHistory(i.root, i.planId);
  if ((hist.latest?.version ?? null) !== i.basedOn) return { ok: false, reason: "stale" };
  if (hist.versions.some((v) => v.problem !== null)) return { ok: false, reason: "historyBroken" };
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
    // 戻した先の版の資料・決定・規則も写す（次の版は、戻した先の版に重ねる）
    sources: record.sources,
    decisions: record.decisions,
    crosswalk: record.crosswalk,
    signer: i.signer,
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
    sources?: VersionSource[];
    decisions?: VersionDecision[];
    crosswalk?: VersionCrosswalkRule[];
    intake?: VersionIntake;
    signer: Signer;
    role?: "confirm" | "edit";
    derivedFrom?: VersionRecord["derivedFrom"];
  },
): Promise<CommitResult> {
  const dir = planDir(root, v.plan.planId);
  const version = (hist.latest?.version ?? 0) + 1;
  const prevInfo = hist.versions.at(-1) ?? null;
  const plan: Plan = { ...v.plan, version };
  const diff = diffPlans(hist.latest?.plan ?? null, plan);
  const base: VersionRecord = {
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
    parent: prevInfo
      ? { version: prevInfo.version, contentHash: prevInfo.contentHash, signatures: prevInfo.signatures.filter((x) => CREATION_ROLES.includes(x.role)).map((x) => x.fileHash).sort() }
      : null,
    derivedFrom: v.derivedFrom ?? null,
    ...(v.readingSkills?.length ? { readingSkills: v.readingSkills } : {}),
    ...(v.sources ? { sources: v.sources, decisions: v.decisions ?? [], crosswalk: v.crosswalk ?? [] } : {}),
    ...(v.intake ? { intake: v.intake } : {}),
    plan,
  };
  // 差分レポートと書き出しは署名の前に作り、そのハッシュを版の記録に入れる（落とすときに照らす。監査 E1）
  const reportBytes = await diffReport(base, diff, v.signer.by);
  const c = v.catalogs ? v.catalogs(plan.packId) : null;
  const exportBytes = c ? await planWorkbook({ plan, version, at: base.at, catalog: c.catalog, emptyCatalog: c.empty }) : null;
  const { plan: _plan, ...head } = base;
  const record: VersionRecord = { ...head, files: { report: sha(reportBytes), export: exportBytes ? sha(exportBytes) : null }, plan };
  const hash = contentHash(record);
  const role: SignRole = v.kind === "revert" ? "revert" : (v.role ?? "confirm");
  const signature = signStatement({ planId: plan.planId, version, contentHash: hash, role, by: v.signer.by, at: record.at, reason: v.reason }, v.signer.pair);
  await mkdir(join(dir, "versions"), { recursive: true });
  await mkdir(join(dir, "reports"), { recursive: true });
  await mkdir(join(dir, "signatures"), { recursive: true });
  await writePerson(root, v.signer, record.at);
  const versionPath = join(dir, "versions", `${pad(version)}.json`);
  const reportPath = join(dir, "reports", `${pad(version)}-diff.xlsx`);
  // 署名を先に書き、版の記録をあとに書く（どちらも 1 度だけ）。版の記録が先にあれば（ほかの確定が入った）、書いた署名を消して止める
  const signaturePath = join(dir, "signatures", signatureFileName(version, role, signature.statement.key));
  try {
    await writeFile(signaturePath, `${JSON.stringify(signature, null, 1)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, reason: "exists" };
    throw e;
  }
  try {
    await writeFile(versionPath, `${JSON.stringify(record, null, 1)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    await rm(signaturePath, { force: true });
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, reason: "exists" };
    throw e;
  }
  await writeAtomic(reportPath, reportBytes);
  let exportPath: string | null = null;
  if (exportBytes) {
    await mkdir(join(dir, "exports"), { recursive: true });
    exportPath = join(dir, "exports", `${pad(version)}-plan.xlsx`);
    await writeAtomic(exportPath, exportBytes);
  }
  return { ok: true, version, record, diff, files: { version: versionPath, report: reportPath, export: exportPath } };
}

export type SignResult = { ok: true; version: number; role: "approve" | "return" } | { ok: false; reason: "nameInvalid" | "reasonEmpty" | "notLatest" | "historyBroken" | "selfApprove" | "exists" | "alreadySigned" };

/**
 * いちばん新しい版に、承認（approve）か差し戻し（return。理由は必須）の署名を足す（docs/plan.md §2.18.2）。
 * いちばん新しい版にだけ足す（前の版はもう次の版の親で、承認を足す意味が無いため。鎖は作った署名だけを持つので、足しても切れない）。
 * その版を作った人（確定・渡す・戻すの署名をした鍵か、同じ呼び名）は、自分の版を承認できない。
 */
export async function signLatest(i: { root: string; planId: string; version: number; role: "approve" | "return"; reason: string; signer: Signer; now?: Date }): Promise<SignResult> {
  if (!validName(i.signer.by)) return { ok: false, reason: "nameInvalid" };
  if (i.role === "return" && i.reason.trim().length === 0) return { ok: false, reason: "reasonEmpty" };
  const hist = await readHistory(i.root, i.planId);
  const v = hist.versions.at(-1);
  if (!v || v.version !== i.version) return { ok: false, reason: "notLatest" };
  if (v.problem !== null) return { ok: false, reason: "historyBroken" };
  // 承認か差戻しがもうある版には、どちらも重ねない（両方が残ると、編集者の番が開いたままになる。台帳の新-7）
  if (v.signatures.some((x) => x.role === "approve" || x.role === "return")) return { ok: false, reason: "alreadySigned" };
  const key = keyIdOf(i.signer.pair.pub);
  if (i.role === "approve" && v.signatures.some((x) => CREATION_ROLES.includes(x.role) && (x.key === key || x.by === i.signer.by))) return { ok: false, reason: "selfApprove" };
  const at = (i.now ?? new Date()).toISOString();
  const sig = signStatement({ planId: i.planId, version: v.version, contentHash: v.contentHash, role: i.role, by: i.signer.by, at, reason: i.reason.trim() }, i.signer.pair);
  const dir = planDir(i.root, i.planId);
  await writePerson(i.root, i.signer, at);
  try {
    await writeFile(join(dir, "signatures", signatureFileName(v.version, i.role, key)), `${JSON.stringify(sig, null, 1)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return { ok: false, reason: "exists" };
    throw e;
  }
  return { ok: true, version: v.version, role: i.role };
}

/** 署名した人の呼び名と公開鍵を、保管先の people/ に置く（同じ鍵のファイルがあれば書かない）。信じる元ではない */
async function writePerson(root: string, signer: Signer, at: string): Promise<void> {
  await mkdir(join(root, "people"), { recursive: true });
  try {
    await writeFile(join(root, "people", `${keyIdOf(signer.pair.pub)}.json`), `${JSON.stringify(personFile(signer.by, signer.pair, at), null, 1)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
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
  planId: "計画 ID",
  by: "署名した人",
  intake: (x: VersionIntake) => `聞いた質問 ${x.questions}・決定 人 ${x.decisions.human}・Claude ${x.decisions.ai}・会話から写した答え ${x.decisions.ai_relayed_human}・決まり ${x.decisions.rule_code}`,
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
export async function diffReport(record: VersionRecord, diff: PlanDiff, by: string | null = null): Promise<Buffer> {
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
  // 頭：計画 ID と署名した人（台帳の中-7）、聞いた数（2A）。中身のハッシュは、このレポートのハッシュが版の記録に入るので書けない（E1）
  ws.getRow(2).values = [T.plan, record.plan.displayName, "", T.planId, record.planId];
  ws.getRow(3).values = [T.version, record.version, record.kind === "confirm" ? T.kind.confirm : T.kind.revert(record.revertOf ?? 0), ...(record.intake ? [T.intake(record.intake)] : [])];
  ws.getRow(4).values = [T.at, record.at, "", T.by, by ?? ""];
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
