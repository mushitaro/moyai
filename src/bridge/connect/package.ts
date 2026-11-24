// 業務システムごとの読み書きの部品（`@mxstage/eam-connectors`、BUSL-1.1、TSUNAGI。運営者が承認した形 2026-11-16）へのつなぎ（薄い adapter）。
// 部品は MOYAI の optionalDependencies（package.json が commit を指す。MX Stage と同じ指し方）。入っていない・中身（dist）が無いときは null を返し、
// 連携のつなぎ先を出さない（MOYAI の芯は部品なしで動く）。
//
// 使う部品の出口（部品の README と src/index.ts。commit 7d7c9be）：
// - `@mxstage/eam-connectors`：MaximoClient・loadRecords・planCommit・executeCommit・makeParentKey
// - `@mxstage/eam-connectors/node`：ConnectionStore・LicenseStore・licenseTestKeysAllowed（置き場所は部品の既定 ~/.config/mxstage。MX Stage と共有し、1 つの鍵で両方に効く）
// - `@mxstage/eam-connectors/eam`：中間形（資産の木・保全計画・作業の実績）と Maximo の対応（maximoLoadOptions・assetFromMaximo など）
// 部品の /mx の中継（handleMaximoProxy）は使わない（MOYAI の作業画面は Maximo に直に話さない）。本番への書き込みの鍵の確かめは、
// 部品の writeGuard ではなく、橋渡しの人だけの送りの道（index.ts の send）で LicenseStore.authorize を必ず通す。
//
// 写し方（Maximo ⇄ MOYAI の約束の形。src/shared/connect.ts）：
// - 資産の木：MXAPIASSET＋MXAPIOPERLOC の節。名前は説明（無ければ番号）。
// - 保全計画：MXAPIPM の 1 件 = 資産 × 作業 × 1 つの年度。作業の名前は説明、年度は次の予定日（NEXTDATE）の年度（4 月始まり）。
//   同じ資産・作業の PM の年度を束ねて、MOYAI の 1 行にする。
// - 作業の実績：MXAPIWODETAIL。日は実績の終わり（無ければ始め・予定）の日。工数は時間なので、人・日には直さない（空にする）。
// - 書き込み：足す年度は PM を作り、減らす年度の PM は、足す年度があればその次の予定日を書き換えて使う。減らすだけの年度が残る
//   （PM を消すか止めるしかない）変更と、資産の木に無い資産の変更は、書かない（unwritable。橋渡しは差分ごと止めて、人に返す）。
// - API キーは、この中の closure だけが持つ（ConnectionStore.resolve で開き、MaximoClient に関数で渡す）。返り・ログ・誤りの文に出さない。
import { createHash } from "node:crypto";
import { CONNECT_PATH_SEP, planLinesOfRecords, planWrite, type ConnectTarget, type EamAsset, type EamPlanItem, type EamRecords, type EamWorkResult, type EamWriteChange, type PlanLine } from "../../shared/connect";
import type { ConnectAddProblem, ConnectBackend, ConnectSecret, EamConnector, LicenseAnswer, LicenseCheck } from "./types";

/** 部品の名前（package.json の optionalDependencies） */
export const EAM_PACKAGE = "@mxstage/eam-connectors";

// ─── 部品の形のうち、ここで使うところ（部品が無くても MOYAI の型の確かめが通るように、ここに写す）──────

type CellValue = string | number | boolean | null;
interface MaximoRecord {
  href: string;
  rowstamp: string | null;
  attrs: Record<string, CellValue>;
  children: Record<string, unknown[]>;
}
interface LoadRecordsOptions {
  os: string;
  select: string[];
  childIdAttrs: Record<string, string | null>;
  knownAttrs: Set<string>;
  keyColumns?: string[];
  maxRows?: number;
}
type MaximoEamKind = "asset" | "location" | "pm" | "jobPlan" | "work";
interface ColumnSchema {
  name: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "datetime" | "unknown";
  readOnly?: boolean;
}
interface SheetMeta {
  name: string;
  source: { kind: "maximo"; os: string; select: string[]; where: never[] };
  columns: ColumnSchema[];
  keyColumns: string[];
  childIdAttrs: Record<string, string | null>;
}
interface CommitChanges {
  cells: { rowKey: string; col: string; value: CellValue }[];
  addedRows: { rowKey: string; parentKey: string; childName: string | null; values: Record<string, CellValue> }[];
  deletedRows: string[];
}
interface CommitRowOutcome {
  rowKey: string;
  status: string;
}
export interface MaximoClientLike {
  readonly baseUrl: string;
}
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
interface EamNode {
  id: string;
  kind: "asset" | "location";
  code: string;
  siteId: string | null;
  description: string | null;
  parentId: string | null;
}
interface EamPm {
  id: string;
  code: string;
  siteId: string | null;
  description: string | null;
  targetId: string | null;
  nextDue: string | null;
}
interface EamWork {
  id: string;
  code: string;
  description: string | null;
  assetId: string | null;
  locationId: string | null;
  scheduledStart: string | null;
  actualStart: string | null;
  actualFinish: string | null;
}
interface ConnectionEntry {
  id: string;
  name: string;
  baseUrl: string;
  environment: "production" | "test" | null;
}
type AuthorizeResult = { ok: true } | { ok: false; problem: "no_license" | "not_licensed" | "expired" | "revoked" | "bad_scope"; host: string | null; licensedHosts: string[] };

/** 部品の出口のうち、ここで使うもの */
export interface EamPackage {
  main: {
    MaximoClient: new (o: { baseUrl: string; apiKey: () => string; via: "direct"; fetchImpl?: FetchLike; sleep?: (ms: number) => Promise<void> }) => MaximoClientLike;
    loadRecords(client: MaximoClientLike, opts: LoadRecordsOptions): Promise<{ records: MaximoRecord[]; truncated: boolean }>;
    planCommit(meta: SheetMeta, records: MaximoRecord[], changes: CommitChanges): unknown[];
    executeCommit(client: MaximoClientLike, plans: unknown[], opts: { waitForCanaryContinue: () => Promise<boolean>; meta: SheetMeta; os: string; maxParents: number }): Promise<CommitRowOutcome[]>;
    makeParentKey(values: CellValue[]): string;
  };
  node: {
    ConnectionStore: new (o: { dir?: string }) => {
      list(): { connections: ConnectionEntry[] };
      save(input: { name: string; baseUrl: string; environment: "production" | "test" | null; apiKey?: string }): Promise<{ ok: true; connection: ConnectionEntry } | { ok: false; problem: string }>;
      resolve(id: string): Promise<{ ok: true; origin: string; apiKey: string } | { ok: false }>;
    };
    LicenseStore: new (o: { dir?: string; allowTestKeys?: boolean }) => { authorize(baseUrl: string): AuthorizeResult };
    licenseTestKeysAllowed(env?: NodeJS.ProcessEnv): boolean;
  };
  eam: {
    maximoLoadOptions(kind: MaximoEamKind, opts?: { maxRows?: number }): LoadRecordsOptions;
    assetFromMaximo(rec: MaximoRecord): EamNode;
    locationFromMaximo(rec: MaximoRecord): EamNode;
    planFromMaximo(rec: MaximoRecord): EamPm;
    workRecordFromMaximo(rec: MaximoRecord): EamWork;
  };
}

/** 部品を読み込む。無い・中身が無いときは null（例外の文は外へ出さない） */
export async function importEamPackage(spec: string = EAM_PACKAGE): Promise<EamPackage | null> {
  try {
    const [main, node, eam] = await Promise.all([import(/* @vite-ignore */ spec), import(/* @vite-ignore */ `${spec}/node`), import(/* @vite-ignore */ `${spec}/eam`)]);
    return { main, node, eam } as EamPackage;
  } catch {
    return null;
  }
}

// ─── 写し方 ─────────────────────────────────────────────

const PM_OS = "MXAPIPM";
/** 1 回に読む件数の上限（打ち切ったら、読めなかったとして止める。黙って一部だけにしない） */
const MAX_ROWS = 20_000;
const DESCRIPTION_MAX = 100;
/** PM の番号の頭（MOYAI が作った PM と分かるように） */
const PMNUM_PREFIX = "MY";

/** 日の字（ISO 8601）から年度（4 月始まり）。読めなければ null */
export function fiscalYearOf(date: string | null): number | null {
  const m = date ? /^(\d{4})-(\d{2})/.exec(date) : null;
  if (!m) return null;
  const y = Number(m[1]);
  return Number(m[2]) >= 4 ? y : y - 1;
}
/** 年度の始めの日（PM の次の予定日に書く） */
export const fiscalYearStart = (fy: number): string => `${fy}-04-01T00:00:00+09:00`;
const ymd = (date: string | null): string | null => (date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10).replace(/-/g, "/") : null);

interface Loaded {
  records: EamRecords;
  nodes: Map<string, EamNode>;
  pms: { rec: MaximoRecord; pm: EamPm; fy: number | null }[];
}

/** Maximo の資産の木・PM・作業指示を読んで、約束の中間形にする。打ち切ったら例外（読めなかったとして扱う） */
async function loadAll(pkg: EamPackage, client: MaximoClientLike): Promise<Loaded> {
  const read = async (kind: MaximoEamKind) => {
    const r = await pkg.main.loadRecords(client, pkg.eam.maximoLoadOptions(kind, { maxRows: MAX_ROWS }));
    if (r.truncated) throw new Error("truncated");
    return r.records;
  };
  const [assetRecs, locationRecs, pmRecs, woRecs] = [await read("asset"), await read("location"), await read("pm"), await read("work")];
  const nodes = new Map<string, EamNode>();
  for (const n of [...locationRecs.map((r) => pkg.eam.locationFromMaximo(r)), ...assetRecs.map((r) => pkg.eam.assetFromMaximo(r))]) if (!nodes.has(n.id)) nodes.set(n.id, n);
  const assets: EamAsset[] = [...nodes.values()].map((n) => ({
    ref: n.id,
    parentRef: n.parentId !== null && n.parentId !== n.id && nodes.has(n.parentId) ? n.parentId : null,
    name: (n.description ?? n.code).trim(),
    tag: null,
  }));
  const pms = pmRecs.map((rec) => {
    const pm = pkg.eam.planFromMaximo(rec);
    return { rec, pm, fy: fiscalYearOf(pm.nextDue) };
  });
  const plans: EamPlanItem[] = pms.map(({ pm, fy }) => ({ ref: pm.id, assetRef: pm.targetId ?? "", work: (pm.description ?? pm.code).trim(), fiscalYears: fy === null ? [] : [fy] }));
  const results: EamWorkResult[] = woRecs.map((rec) => {
    const w = pkg.eam.workRecordFromMaximo(rec);
    return { ref: w.id, assetRef: w.assetId ?? w.locationId ?? "", work: (w.description ?? w.code).trim(), date: ymd(w.actualFinish ?? w.actualStart ?? w.scheduledStart), manDays: null };
  });
  return { records: { assets, plans, results }, nodes, pms };
}

/** 資産の道（上から名前を「 › 」でつなぐ）→ 節の印。同じ道の節が 2 つ以上あれば、どれか決めないので外す */
function nodeByPath(r: EamRecords): Map<string, string> {
  const by = new Map(r.assets.map((a) => [a.ref, a]));
  const out = new Map<string, string>();
  const twice = new Set<string>();
  for (const a of r.assets) {
    const names: string[] = [];
    const seen = new Set<string>();
    let cur: EamAsset | undefined = a;
    while (cur && !seen.has(cur.ref)) {
      seen.add(cur.ref);
      names.unshift(cur.name.trim());
      cur = cur.parentRef === null ? undefined : by.get(cur.parentRef);
    }
    const path = names.join(CONNECT_PATH_SEP);
    if (out.has(path)) twice.add(path);
    out.set(path, a.ref);
  }
  for (const p of twice) out.delete(p);
  return out;
}

/**
 * 書けない変更：資産の木に無い（または同じ名前の道が 2 つある）資産・説明が空か長すぎる・減らすだけの年度が残る
 * （その資産・作業で、今の年度が書く年度に無い PM の数が、足す年度の数より多い。PM を消すか止めるしかないので書かない）
 */
function writable(c: EamWriteChange, paths: Map<string, string>, current: EamRecords): boolean {
  const ref = paths.get(c.assetPath);
  if (!ref || c.work.length === 0 || c.work.length > DESCRIPTION_MAX) return false;
  const before = new Set(c.before ?? []);
  const after = new Set(c.after);
  const adds = [...after].filter((y) => !before.has(y)).length;
  const reuse = current.plans.filter((p) => p.assetRef === ref && p.work.trim() === c.work && p.fiscalYears.some((y) => !after.has(y))).length;
  return reuse <= adds;
}

const PM_COLUMNS: ColumnSchema[] = [
  { name: "PMNUM", type: "string" },
  { name: "SITEID", type: "string" },
  { name: "DESCRIPTION", type: "string" },
  { name: "ASSETNUM", type: "string" },
  { name: "LOCATION", type: "string" },
  { name: "NEXTDATE", type: "datetime" },
];
const PM_META: SheetMeta = {
  name: PM_OS,
  source: { kind: "maximo", os: PM_OS, select: PM_COLUMNS.map((c) => c.name), where: [] },
  columns: PM_COLUMNS,
  keyColumns: ["PMNUM", "SITEID"],
  childIdAttrs: {},
};

/** MOYAI が作る PM の番号（つなぎ先・行・年度から決める。重なれば次の候補） */
function newPmNum(target: ConnectTarget, key: string, fy: number, taken: Set<string>): string {
  for (let i = 0; ; i++) {
    const h = createHash("sha256").update(`${target.id}|${key}|${fy}|${i}`).digest("hex").slice(0, 6).toUpperCase();
    const num = `${PMNUM_PREFIX}${h}`;
    if (!taken.has(num)) {
      taken.add(num);
      return num;
    }
  }
}

/** 書く変更を、部品の書き込みエンジンの差分（PM のシートのセルの変更と、親の行の追加）にする */
function commitChangesOf(pkg: EamPackage, target: ConnectTarget, loaded: Loaded, changes: readonly EamWriteChange[]): { changes: CommitChanges; parentKeysOf: Map<string, string[]> } {
  const paths = nodeByPath(loaded.records);
  const taken = new Set(loaded.pms.map((p) => p.pm.code));
  const out: CommitChanges = { cells: [], addedRows: [], deletedRows: [] };
  const parentKeysOf = new Map<string, string[]>();
  for (const c of changes) {
    const ref = paths.get(c.assetPath);
    const node = ref ? loaded.nodes.get(ref) : undefined;
    if (!node || !writable(c, paths, loaded.records)) throw new Error("unwritable");
    const mine = loaded.pms.filter((p) => p.pm.targetId === node.id && (p.pm.description ?? p.pm.code).trim() === c.work);
    const before = new Set(c.before ?? []);
    const after = new Set(c.after);
    const adds = [...after].filter((y) => !before.has(y)).sort((a, b) => a - b);
    const reuse = mine.filter((p) => p.fy !== null && !after.has(p.fy));
    const keys: string[] = [];
    adds.forEach((fy, i) => {
      const old = reuse[i];
      if (old) {
        const rowKey = pkg.main.makeParentKey(PM_META.keyColumns.map((k) => old.rec.attrs[k] ?? null));
        out.cells.push({ rowKey, col: "NEXTDATE", value: fiscalYearStart(fy) });
        keys.push(rowKey);
        return;
      }
      const pmnum = newPmNum(target, c.key, fy, taken);
      const rowKey = pkg.main.makeParentKey([pmnum, node.siteId]);
      out.addedRows.push({
        rowKey,
        parentKey: rowKey,
        childName: null,
        values: {
          PMNUM: pmnum,
          SITEID: node.siteId,
          DESCRIPTION: c.work,
          ...(node.kind === "asset" ? { ASSETNUM: node.code } : { LOCATION: node.code }),
          NEXTDATE: fiscalYearStart(fy),
        },
      });
      keys.push(rowKey);
    });
    parentKeysOf.set(c.key, keys);
  }
  return { changes: out, parentKeysOf };
}

function licenseAnswer(a: AuthorizeResult): LicenseAnswer {
  if (a.ok) return { ok: true };
  if (a.problem === "expired" || a.problem === "revoked") return { ok: false, reason: "expired" };
  if (a.problem === "not_licensed") return { ok: false, reason: "otherHost" };
  return { ok: false, reason: "noKey" };
}

/** 部品の ConnectionStore の problem → MOYAI の理由の名前 */
function addProblem(p: string): ConnectAddProblem {
  if (p === "invalid_name") return "name";
  if (p === "invalid_url") return "url";
  if (p === "invalid_key" || p === "key_required") return "key";
  if (p === "too_many") return "tooMany";
  return "unavailable";
}

function targetOf(c: ConnectionEntry): ConnectTarget | null {
  let host: string;
  try {
    host = new URL(c.baseUrl).host;
  } catch {
    return null;
  }
  // 申告の無いつなぎ先は本番として扱う（鍵が無ければ書かない。部品の writeGuard と同じ安全側）
  return { id: c.id, label: c.name.slice(0, 80) || host, kind: "maximo", host, env: c.environment === "test" ? "test" : "production" };
}

/**
 * Maximo の読み書き（部品の MaximoClient・loadRecords・planCommit・executeCommit）。clientOf がつなぎ先の秘密から MaximoClient を作る
 * （本物のつなぎ先は部品の ConnectionStore、デモの架空の Maximo は橋渡しの中の偽の Maximo。src/bridge/connect/demo.ts）
 */
export function maximoConnector(pkg: EamPackage, clientOf: (secret: ConnectSecret) => Promise<MaximoClientLike>): EamConnector {
  return {
    loadRecords: async (_target, secret) => (await loadAll(pkg, await clientOf(secret))).records,
    planCommit: (_target, current, desired: readonly PlanLine[]) => {
      const all = planWrite(desired, planLinesOfRecords(current)).changes;
      const paths = nodeByPath(current);
      return { changes: all, unwritable: all.filter((c) => !writable(c, paths, current)).length };
    },
    executeCommit: async (target, secret, changes) => {
      const client = await clientOf(secret);
      const loaded = await loadAll(pkg, client);
      const { changes: cc, parentKeysOf } = commitChangesOf(pkg, target, loaded, changes);
      const plans = pkg.main.planCommit(PM_META, loaded.pms.map((p) => p.rec), cc);
      // 1 件目の確かめ（カナリア）は橋渡しの send が持つ（変更 1 件を送って読み直す）。ここでは渡された分を続けて送る
      const results = await pkg.main.executeCommit(client, plans, { waitForCanaryContinue: async () => true, meta: PM_META, os: PM_OS, maxParents: Number.POSITIVE_INFINITY });
      const done = new Set(results.filter((r) => r.status === "verified").map((r) => r.rowKey));
      // 変更 1 件は、その PM がすべて書けて確かめられたときだけ数える
      const applied = changes.filter((c) => (parentKeysOf.get(c.key) ?? []).every((k) => done.has(k))).length;
      return { applied };
    },
  };
}

export interface PackageBackendOptions {
  /** 部品（試験が差し替える。省けば import する） */
  pkg?: EamPackage | null;
  /** 接続とライセンスの置き場所。省けば部品の既定（~/.config/mxstage。MX Stage と共有）。試験は一時のフォルダを渡す */
  dir?: string;
  /** Maximo への通信（試験は部品の /testing の createFakeMaximo の fetch を渡す） */
  fetchImpl?: FetchLike;
  env?: NodeJS.ProcessEnv;
  /** ライセンスの確かめ（試験は試験の公開鍵の部品の LicenseStore を渡す）。省けば部品の LicenseStore を既定で作る */
  licenses?: { authorize(baseUrl: string): AuthorizeResult };
}

/** 部品から連携の裏を作る。部品が無い・中身が無いときは null（つなぎ先を出さない） */
export async function loadPackageBackend(o: PackageBackendOptions = {}): Promise<ConnectBackend | null> {
  const pkg = o.pkg === undefined ? await importEamPackage() : o.pkg;
  if (!pkg) return null;
  const dirOpt = o.dir === undefined ? {} : { dir: o.dir };
  const connections = new pkg.node.ConnectionStore(dirOpt);
  const licenses = o.licenses ?? new pkg.node.LicenseStore({ ...dirOpt, allowTestKeys: pkg.node.licenseTestKeysAllowed(o.env ?? process.env) });
  const idOf = (s: ConnectSecret): string => (s.opaque as { connectionId: string }).connectionId;
  const clientOf = async (secret: ConnectSecret): Promise<MaximoClientLike> => {
    const r = await connections.resolve(idOf(secret));
    if (!r.ok) throw new Error("connection");
    const apiKey = r.apiKey;
    return new pkg.main.MaximoClient({ baseUrl: r.origin, apiKey: () => apiKey, via: "direct", ...(o.fetchImpl ? { fetchImpl: o.fetchImpl } : {}) });
  };
  const connector = maximoConnector(pkg, clientOf);
  const license: LicenseCheck = { authorize: async (host) => licenseAnswer(licenses.authorize(`https://${host}`)) };
  const entries = () => connections.list().connections.map((c) => ({ c, t: targetOf(c) })).filter((x): x is { c: ConnectionEntry; t: ConnectTarget } => x.t !== null);
  return {
    fake: false,
    store: {
      list: () => entries().map((x) => x.t),
      add: async (input) => {
        const r = await connections.save({ name: input.label, baseUrl: input.url, environment: input.env, apiKey: input.apiKey });
        if (!r.ok) return { ok: false, problem: addProblem(r.problem) };
        const t = targetOf(r.connection);
        return t ? { ok: true, target: t } : { ok: false, problem: "url" };
      },
      open: (id) => {
        const x = entries().find((e) => e.t.id === id);
        return x ? { target: x.t, secret: { opaque: { connectionId: x.c.id } } } : null;
      },
    },
    connectors: { maximo: connector },
    license,
  };
}
