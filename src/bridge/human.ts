// 人だけの経路の処理（確定・版・設定・輪と鍵・検問所）。ここに来るのは、server.ts の guardHuman
// （Origin・Sec-Fetch-Site・タブの秘密・操作と中身のハッシュに結んだ 1 回きりの印）を通ったものだけ。
// どれも MCP のツールにしない（src/shared/tools.ts に無い）。答えは JSON。断るときは { ok: false, reason }。
// 鍵・トークン・計画の中身をログに出さない。
import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { pendingDecisions } from "../plan/diff";
import { commitPlan, planDir, readHistory, readPlanVersion, revertPlan, signLatest, CREATION_ROLES, PLAN_ID, type ExportCatalogs, type Signer } from "../plan/store";
import { COMMENT_MAX, addComment, readComments } from "../plan/comments";
import { TURN_SCHEMA, handoffMail, readTurn, writeTurn } from "../plan/turn";
import { validName } from "../plan/signature";
import { confirmKey, countsForApproval, createOwnKey, openOwnKey, ownKeys, previousOf, trustList, trustOf } from "./people";
import { checkSeen } from "./seen";
import { activeRequest, createRequest, readRequests, receiveRequest } from "../plan/request";
import { checkRules, diffRuleRows } from "../share/rules";
import { approvedReadingVersions, listReadings, loadedOf, planRulesBacked, readingLineage, recordReadingVersion, recordedReadings, registerReading } from "./readings";
import { ReadingSkill, isPlanRule } from "../import/reading";
import { checkSources, putSource, readSource, SOURCE_MAX_BYTES } from "./sources";
import { ruleSchema } from "../shared/tools";
import { AUTHOR_KINDS } from "../shared/fields";
import { approvedTemplateVersions, listTemplates, readTemplateVersion, saveTemplate } from "./templates";
import { exportExcelName, exportSignatureName, signExport } from "../plan/exports";
import { writeTemplate } from "../plan/template-layout";
import { dueBaseDate } from "../plan/due-view";
import ExcelJS from "exceljs";
import { catalogFromPack } from "../plan/chart";
import type { HumanAction } from "../shared/routes";
import { createRing, loadRing, monthOf, previewCheckpoint, previewPlace, questionsOf, rotateKeysOf, rotateRingKey, unmarkedRetired, sealPlace, sendCheckpoint, verifyRing, withSentInfo, type Answers, type PreviewView } from "../share/checkpoint";
import { acceptLedger, checkAgainstLedger, LEDGER_PR_TEXT, ledgerAcceptance, ledgerBranch, ledgerBundlePath, ledgerPlace, ledgerProfileText, loadLedgerForSend, pendingSent } from "../share/ledger-send";
import { GITHUB_CLIENT_ID, githubClientIdOf, githubHostsOf, githubIo, openLedgerPr, pollDevice, prStatus, repoOfRemote, startDevice, whoAmI, type GitHubIo, type Repo } from "./github";
import { LEDGER_INTAKE_URL, ledgerIntakeUrlOf, sendToIntake, type IntakeIo } from "./ledger-intake";
import { parseJsonStrict } from "../share/jcs";
import { loadSharePack, PACK_ID, type SharePack } from "../share/pack";
import { parsePack } from "../shared/pack";
import { POSITIONS, PROFILE_FROM, compare, defaultAxes, receiverProfile } from "../share/receive";
import { loadLedgerPlace, loadPlaces } from "../share/receive-load";
import { peerAggregates } from "../share/peer-reference";
import { RECEIVE_MIN_K } from "../share/k";
import { HEX16, HEX64, fingerprint, generateKeyPair, keyIdOf, sha256Hex, type KeyPair } from "../share/sign";
import { allPlanSent, appendPlanSent, facilityKey, ownKeysAt, readPlanSent, retiredKeyFiles, retiredKeys, storeFacilityKey, storedKeys, writePlanSent, type Facility, type FacilityKey } from "../share/facility";

/** 再発行のダイアログに出す鍵：鍵番号（公開鍵が読めれば）と作成月（その鍵で最初に出した月。持ち出し簿か場の束から） */
function keyInfoOf(ring: Extract<Awaited<ReturnType<typeof loadRing>>, { ok: true }>, facility: Facility, key: string): { key: string; fingerprint: string | null; month: string | null } {
  const ringId = ring.entry.ringId;
  const pub = [...storedKeys(facility, ringId).map((k) => k.pub), ...retiredKeyFiles(facility, ringId).map((k) => k.pair.pub)].find((p) => keyIdOf(p) === key) ?? null;
  const months = [
    ...readPlanSent<SentEntry>(facility, ringId).filter((e) => e.key === key).map((e) => e.month),
    ...ring.read.bundles.filter((b) => b.folder === key && b.month).map((b) => b.month!),
  ].sort();
  return { key, fingerprint: pub ? fingerprint(pub) : null, month: months[0] ?? null };
}
import { existsSync, readFileSync, readdirSync } from "node:fs";
import {
  defaultRoot,
  detectDocuments,
  readGitHub,
  type LedgerSentEntry,
  type SentEntry,
  addRing,
  readRings,
  writeRings,
  removeGitHub,
  writeGitHub,
  readSettings,
  readKeyFile,
  syncedOf,
  validRoot,
  writeSettings,
  type DocumentsInfo,
  type ShellRunner,
  addLedger,
} from "./places";

/** 設備の地図の空のパック（名前と出どころだけ。docs/plan.md §2.7）。輪を作るときの選択に並べない */
function emptyPack(dir: string): boolean {
  try {
    const r = parsePack(JSON.parse(readFileSync(join(dir, "pack.json"), "utf8")));
    return r.ok && r.kind !== "content";
  } catch {
    return false;
  }
}

export interface HumanEnv {
  stateDir: string | null;
  packsDir: string;
  now: () => number;
  /** Documents の調べ方（試験は差し替える） */
  shell?: ShellRunner;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  /** 一時のファイルを OS のテキストエディタで開く（試験は差し替える） */
  openText?: (path: string) => void;
  /** GitHub とのやりとり（既定は github.com と api.github.com。試験は 127.0.0.1 の試験の台） */
  github?: GitHubIo;
  /** OAuth App の Client ID（既定は github.ts の GITHUB_CLIENT_ID） */
  githubClientId?: string | null;
  /** 公開の台帳の受け口（既定は ledger-intake.ts の LEDGER_INTAKE_URL。null か空なら、GitHub のアカウントなしの道を出さない）。試験は差し替える */
  ledgerIntake?: IntakeIo | null;
}

/** GitHub につなぐ途中（デバイスフロー）。デバイスのコードはつながるか終わるまでこのメモリだけに置き、どこにも書かない */
interface GitHubConnecting {
  state: "waiting" | "ok" | "denied" | "expired" | "failed";
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  login: string | null;
  stop: () => void;
}

export interface HumanCall {
  action: HumanAction;
  payload: string;
  session: string;
}

type Out = Record<string, unknown> & { ok: boolean };
const no = (reason: string, extra: Record<string, unknown> = {}): Out => ({ ok: false, reason, ...extra });

const answersSchema = z.object({
  facility: z.record(z.string().max(64), z.string().max(64).nullable()),
  inNationalTable: z.boolean().nullable(),
  fromRung: z.number().int().min(0).max(32).optional(),
});
const planIdSchema = z.string().regex(PLAN_ID);
const ringIdSchema = z.string().regex(HEX16);

const SCHEMAS = {
  plan_status: z.object({ planId: planIdSchema }),
  plan_commit: z.object({
    plan: z.unknown(),
    reason: z.string().max(500),
    acceptances: z.array(z.object({ id: z.string().max(200), hash: z.string().regex(/^[0-9a-f]{16}$/), reason: z.string().max(500) })).max(100_000),
    basedOn: z.number().int().min(1).nullable(),
    /** 頼むこと（docs/screens.md 3.4）：自分で確定する・編集を頼む・承認を頼む。頼むときは宛先（メール）とひとこと */
    request: z.object({ kind: z.enum(["self", "edit", "approve"]), to: z.string().max(200).nullable(), note: z.string().max(1000) }).optional(),
    /** 受け取る人の MOYAI で版を開くリンクの頭（画面の origin。メールの文に入れる） */
    origin: z.string().max(200).optional(),
    /** ほかの施設の版から作った第 1 版のとき（トップの「この版から別の施設をつくる」） */
    derivedFrom: z.object({ planId: planIdSchema, version: z.number().int().min(1), contentHash: z.string().regex(/^[0-9a-f]{64}$/) }).nullable().optional(),
    /** 次の版に重ねるための記録（1C・重-2）：先に plan_source_put で置いた資料の SHA-256、その資料への決定、人が受けた当てはめの規則。写真のある版は送らない */
    sources: z.array(z.object({ name: z.string().min(1).max(200), sha256: z.string().regex(/^[0-9a-f]{64}$/), size: z.number().int().min(1) })).max(200).optional(),
    decisions: z
      .array(z.object({ questionId: z.string().min(1).max(200), answer: z.string().max(200), author: z.enum(AUTHOR_KINDS), reason: z.string().min(1).max(1000), sources: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(200) }))
      .max(100_000)
      .optional(),
    /** 聞いた数（2A）：質問の数と、作者ごとの決定の数 */
    intake: z
      .object({
        questions: z.number().int().min(0),
        decisions: z.object({ human: z.number().int().min(0), ai: z.number().int().min(0), ai_relayed_human: z.number().int().min(0), rule_code: z.number().int().min(0) }),
      })
      .optional(),
    crosswalk: z.array(z.object({ rule: ruleSchema, target: z.enum(["assetNode", "work"]), value: z.string().min(1).max(200), basis: z.string().max(2000) })).max(2000).optional(),
    /** 画面の星取表の行の並び（見せ方。書き出しの Excel の行の並びにだけ使い、版の記録の計画には入れない。仕事 chat-ops-v1） */
    rowOrder: z
      .record(z.string().max(400), z.array(z.string().min(1).max(400)).max(2000))
      .refine((r) => Object.keys(r).length <= 500)
      .optional(),
    /** 使った読み方（作業画面が当てていた下書きと承認済みの読み方）。確定のときに橋渡しが保管先に書き（同じ中身なら書き直さない）、道と版を版の記録に書く */
    /** trimmed：案を受けていない計画ルールを削った中身（保管先の今の下書きは書き直さず、versions/ にだけ書く。Architect の 42 の答え 4） */
    readings: z.array(z.object({ skill: z.unknown(), by: z.string().max(40).nullable(), facilityKey: z.string().max(200).nullable(), trimmed: z.boolean().optional() })).max(20).optional(),
  }),
  readings_read: z.object({}),
  readings_lineage: z.object({}),
  plan_source_put: z.object({ planId: planIdSchema, base64: z.string().min(1).max(Math.ceil((SOURCE_MAX_BYTES * 4) / 3) + 8) }),
  plan_source_read: z.object({ planId: planIdSchema, version: z.number().int().min(1), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  templates_read: z.object({ planId: planIdSchema.nullable() }),
  template_file_read: z.object({ name: z.string().min(1).max(80), version: z.string().regex(/^[0-9a-f]{64}$/) }),
  // 写し方だけを直すときは base64 を空にし、from に元の様式の版を書く（様式のファイルは共有フォルダのものを使う）
  template_save: z.object({ name: z.string().min(1).max(80), base64: z.string().max(12 * 1024 * 1024), columns: z.unknown(), from: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional() }),
  export_sign: z.object({ planId: planIdSchema, version: z.number().int().min(1), name: z.string().min(1).max(80), templateVersion: z.string().regex(/^[0-9a-f]{64}$/) }),
  export_file_read: z.object({ planId: planIdSchema, version: z.number().int().min(1), name: z.string().min(1).max(80), templateVersion: z.string().regex(/^[0-9a-f]{64}$/) }),
  plan_revert: z.object({ planId: planIdSchema, to: z.number().int().min(1), reason: z.string().max(500), basedOn: z.number().int().min(1).nullable() }),
  plans_list: z.object({}),
  plan_version_read: z.object({ planId: planIdSchema, version: z.number().int().min(1) }),
  comment_add: z.object({
    planId: planIdSchema,
    version: z.number().int().min(0),
    row: z.object({ mode: z.enum(["ledger", "common"]), id: z.string().min(1).max(500), label: z.string().max(500) }).nullable(),
    text: z.string().max(COMMENT_MAX),
  }),
  comments_list: z.object({ planId: planIdSchema }),
  plan_sign: z.object({ planId: planIdSchema, version: z.number().int().min(1), role: z.enum(["approve", "return"]), reason: z.string().max(500) }),
  request_receive: z.object({ planId: planIdSchema, version: z.number().int().min(1), token: z.string().regex(/^[A-Za-z0-9_-]{20,100}$/) }),
  request_renew: z.object({ planId: planIdSchema, version: z.number().int().min(1), to: z.string().max(200), note: z.string().max(1000) }),
  plan_file_read: z.object({ planId: planIdSchema, version: z.number().int().min(1), kind: z.enum(["export", "report"]) }),
  person_key_create: z.object({}),
  person_key_confirm: z.object({ pub: z.string().regex(HEX64) }),
  settings_read: z.object({}),
  settings_save: z.object({ root: z.string().max(1000).nullable(), ledger: z.string().max(1000).nullable().optional(), name: z.string().max(40).nullable().optional() }),
  ring_create: z.object({ root: z.string().max(1000), packId: z.string().regex(PACK_ID) }),
  checkpoint_preview: z.object({ planId: planIdSchema, ringId: ringIdSchema.nullable(), answers: answersSchema }),
  checkpoint_open_text: z.object({ planId: planIdSchema, ringId: ringIdSchema, answers: answersSchema }),
  checkpoint_send: z.object({
    planId: planIdSchema,
    version: z.number().int().min(1),
    ringId: ringIdSchema,
    answers: answersSchema,
    previewHash: z.string().regex(HEX64),
  }),
  ring_verify: z.object({ ringId: ringIdSchema }),
  ring_member_confirm: z.object({ ringId: ringIdSchema, pub: z.string().regex(HEX64) }),
  ring_rules_accept: z.object({ ringId: ringIdSchema, rulesHash: z.string().regex(HEX64) }),
  /** keys：人が画面で見た、今の鍵の ID（見たときから鍵が変わっていれば作り直さない） */
  facility_key_rotate: z.object({ planId: planIdSchema, ringId: ringIdSchema, keys: z.array(z.string().regex(/^[0-9a-f]{16}$/)).min(1).max(8) }),
  ledger_preview: z.object({ planId: planIdSchema, answers: answersSchema }),
  ledger_send: z.object({
    planId: planIdSchema,
    version: z.number().int().min(1),
    answers: answersSchema,
    previewHash: z.string().regex(HEX64),
  }),
  ledger_intake_send: z.object({
    planId: planIdSchema,
    version: z.number().int().min(1),
    answers: answersSchema,
    previewHash: z.string().regex(HEX64),
  }),
  ledger_rules_accept: z.object({ packId: z.string().regex(PACK_ID), rulesHash: z.string().regex(HEX64) }),
  ledger_prs: z.object({ packId: z.string().regex(PACK_ID) }),
  github_connect_start: z.object({ packId: z.string().regex(PACK_ID) }),
  github_connect_state: z.object({}),
  github_disconnect: z.object({}),
  peers_compare: z.object({
    packId: z.string().regex(PACK_ID),
    position: z.enum(POSITIONS),
    /** 人が選んだ見え方の軸。null なら既定（主要の軸のうち答えのあるもの） */
    axes: z.array(z.string().max(64)).max(16).nullable(),
    /** 自分の施設の見え方の答え（市町村・保全子会社） */
    answers: answersSchema,
    /** 入札の対象の見え方の答え（O&M）。まだなら null */
    target: answersSchema.nullable(),
    /** 作業中の計画の規模（帯の答えの見込みに使う） */
    facility: z.object({ scale: z.number().nullable(), scaleUnit: z.string().max(32).nullable() }).nullable(),
  }),
} satisfies Partial<Record<HumanAction, z.ZodType>>;

export type HumanPayload<A extends keyof typeof SCHEMAS> = z.infer<(typeof SCHEMAS)[A]>;

export function parsePayload<A extends keyof typeof SCHEMAS>(action: A, payload: string): HumanPayload<A> | null {
  let v: unknown;
  try {
    v = JSON.parse(payload);
  } catch {
    return null;
  }
  const p = SCHEMAS[action].safeParse(v);
  return p.success ? (p.data as HumanPayload<A>) : null;
}

/** 既定の editor で開く（Windows はメモ帳）。開けなくても止めない。 */
function openWithEditor(path: string): void {
  const [cmd, args] = process.platform === "win32" ? ["notepad.exe", [path]] : process.platform === "darwin" ? ["open", ["-t", path]] : ["xdg-open", [path]];
  try {
    const c = spawn(cmd as string, args as string[], { detached: true, stdio: "ignore", windowsHide: false });
    c.on("error", () => {});
    c.unref();
  } catch {
    /* 開けなかった */
  }
}

/** 台帳の clone の版（git の commit の先頭 12 文字）。.git を読むだけで、git は呼ばない。読めなければ null */
function gitHead(root: string): string | null {
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    const ref = /^ref: (refs\/[\w./-]+)$/.exec(head)?.[1];
    if (!ref) return /^[0-9a-f]{40}$/.test(head) ? head.slice(0, 12) : null;
    try {
      return readFileSync(join(root, ".git", ...ref.split("/")), "utf8").trim().slice(0, 12);
    } catch {
      const line = readFileSync(join(root, ".git", "packed-refs"), "utf8").split(/\r?\n/).find((l) => l.endsWith(` ${ref}`));
      return line ? line.slice(0, 12) : null;
    }
  } catch {
    return null;
  }
}

/** 台帳の clone の origin の URL（.git/config を読む。git は走らせない）。読めなければ null */
export function gitRemote(root: string): string | null {
  try {
    const text = readFileSync(join(root, ".git", "config"), "utf8");
    let inOrigin = false;
    for (const line of text.split(/\r?\n/)) {
      const sec = /^\s*\[(.+)\]\s*$/.exec(line);
      if (sec) {
        inOrigin = /^remote\s+"origin"$/.test(sec[1]!.trim());
        continue;
      }
      const m = inOrigin ? /^\s*url\s*=\s*(.+?)\s*$/.exec(line) : null;
      if (m) return m[1]!;
    }
    return null;
  } catch {
    return null;
  }
}

const sha256OfLedger = (L: { ledgerBytes: Uint8Array }) => sha256Hex(L.ledgerBytes);

/** 渡すメールのリンクの行き先：受け取る人の MOYAI（moyai start の既定のポート。server.ts の DEFAULT_PORT と同じ） */
export const HANDOFF_ORIGIN = "http://127.0.0.1:43110";

/** 受け取る人の MOYAI（既定のポート）で開くリンク。送る人が --port を変えていても、その番号は載せない。合言葉はリンクにだけ入れる */
function handoffLink(planId: string, version: number, contentHash: string, token: string): string {
  return `${HANDOFF_ORIGIN}/#/merge?open=${encodeURIComponent(planId)}&v=${version}&h=${contentHash.slice(0, 16)}&t=${token}`;
}

/** 施設の鍵がまだ決まらないとき（鍵が 2 つある）に、見え方だけを出すための仮の鍵（メモリだけ。署名には使わない） */
const PLACEHOLDER_PAIR: KeyPair = generateKeyPair();

/** 輪の決まりが、人が受け入れたものから変わっていれば、その差（受け入れのダイアログの表）と、決まりに署名した鍵と月 */
function rulesChangeOf(ring: Extract<Awaited<ReturnType<typeof loadRing>>, { ok: true }>) {
  if (ring.entry.acceptedRulesHash === ring.ctx.rulesHash) return null;
  const p = parseJsonStrict(ring.circleBytes.toString("utf8"));
  const body = p.ok ? (p.value as { body?: { founder?: unknown; month?: unknown } }).body : undefined;
  const pub = typeof body?.founder === "string" && HEX64.test(body.founder) ? body.founder : null;
  const rows = diffRuleRows(ring.entry.acceptedRules, ring.rules);
  return {
    rulesHash: ring.ctx.rulesHash,
    loosened: rows.filter((r) => r.dir === "loosened").length,
    tightened: rows.filter((r) => r.dir === "tightened").length,
    rows,
    changer: pub ? { pub, fingerprint: fingerprint(pub), confirmed: ring.confirmed.has(keyIdOf(pub)) } : null,
    month: typeof body?.month === "string" ? body.month : null,
  };
}

export class HumanService {
  private docs: DocumentsInfo | null = null;
  private connecting: GitHubConnecting | null = null;
  /** 施設の鍵のうち、まだ保管先に書いていないもの（人が送ったときに書く。docs/plan.md §2.19） */
  private readonly pendingKeys = new Map<string, KeyPair>();

  constructor(private readonly e: HumanEnv) {}

  private githubIo(): GitHubIo {
    return this.e.github ?? githubIo(githubHostsOf(this.e.env ?? process.env));
  }

  /** 公開の台帳の受け口（GitHub のアカウントなしの道）。URL が決まっていなければ null（道を出さない） */
  private intakeIo(): IntakeIo | null {
    if (this.e.ledgerIntake !== undefined) return this.e.ledgerIntake;
    const url = ledgerIntakeUrlOf(LEDGER_INTAKE_URL, this.e.env ?? process.env);
    return url ? { url, fetch: (u, i) => fetch(u, i) } : null;
  }

  private githubClientId(io: GitHubIo): string | null {
    if (this.e.githubClientId !== undefined) return this.e.githubClientId;
    return githubClientIdOf(GITHUB_CLIENT_ID, this.e.env ?? process.env, io.hosts);
  }

  /** 署名する人：設定の呼び名と、開いた自分の鍵（署名したらすぐ捨てる。署名は、人が画面で署名のボタンを押したときに決まる） */
  private signer(sd: string): { ok: true; signer: Signer } | { ok: false; reason: "nameMissing" | "personKeyMissing" | "oldKey" } {
    const name = readSettings(sd).name;
    if (!name) return { ok: false, reason: "nameMissing" };
    const k = openOwnKey(sd, name);
    if (!k.ok) return { ok: false, reason: k.reason };
    return { ok: true, signer: { by: name, pair: k.pair } };
  }

  /**
   * いちばん新しい版の、数えない頼み：置いた鍵の名乗り・指紋・時刻と、効かない理由
   * （otherKey：その版を作った鍵でない。otherContent：その版を作った鍵が、ほかの中身に宛てた）
   */
  private async ignoredRequests(root: string, planId: string, h: Awaited<ReturnType<typeof readHistory>>) {
    const top = h.versions.at(-1);
    if (!top) return [];
    const makers = new Set(top.signatures.filter((x) => CREATION_ROLES.includes(x.role)).map((x) => x.pub));
    const { foreign } = await readRequests(root, planId, top);
    return foreign.map((q) => ({ by: q.body.by, fingerprint: fingerprint(q.body.pub), at: q.body.at, why: makers.has(q.body.pub) ? ("otherContent" as const) : ("otherKey" as const) }));
  }

  /** いちばん新しい版の頼みの見え方：頼むこと・宛先・頼んだ人・受け取った人（信じ方つき）・自分が頼んだか・自分が受け取ったか・済んだか */
  private async requestView(root: string, planId: string, h: Awaited<ReturnType<typeof readHistory>>, name: string | null) {
    const sd = this.e.stateDir!;
    const top = h.versions.at(-1);
    if (!top) return null;
    const act = await activeRequest(root, planId, top);
    if (!act) return null;
    const mine = ownKeys(sd).filter((k) => !k.old && k.by === name).map((k) => k.pub);
    const r = act.receipt;
    const received = r
      ? (() => {
          const sig = { by: r.by, key: keyIdOf(r.pub), pub: r.pub };
          const trust = trustOf(sd, sig, new Date(this.e.now()));
          return { by: r.by, pub: r.pub, fingerprint: fingerprint(r.pub), trust, previous: trust === "changed" ? previousOf(sd, r.pub) : null };
        })()
      : null;
    return {
      version: top.version,
      kind: act.request.body.kind,
      to: act.request.body.to,
      by: act.request.body.by,
      mine: mine.includes(act.request.body.pub),
      received,
      receivedByMe: !!r && mine.includes(r.pub),
      done: top.signatures.some((x) => x.role === "approve" || x.role === "return"),
    };
  }

  /**
   * いちばん新しい版の上に、この鍵が次の版を作ってよいか（編集の番。監査 B1・台帳の新-1）。
   * - 編集を頼んだ版：頼みを受け取った鍵（まだ誰も受け取っていなければ頼んだ人）だけ
   * - 承認を頼んだ版：承認されるまで（差戻されたあとも）頼んだ人だけ。承認されれば閉じて、誰でも次の版を作れる
   */
  private async mayBuildOn(root: string, planId: string, h: Awaited<ReturnType<typeof readHistory>>, pub: string): Promise<boolean> {
    const top = h.versions.at(-1);
    const act = top ? await activeRequest(root, planId, top) : null;
    if (!act || !top) return true;
    if (act.request.body.kind === "edit") return pub === (act.receipt?.pub ?? act.request.body.pub);
    if (top.signatures.some((x) => x.role === "approve")) return true;
    return pub === act.request.body.pub;
  }

  /** 書き出しに使うパックの名前の表（packs/<パック>/common.json と packs/_kinds/work.json）。読めなければ共通のシートは作らない */
  private catalogsFor(packId: string): ExportCatalogs {
    const read = (p: string): unknown => JSON.parse(readFileSync(p, "utf8"));
    const work = read(join(this.e.packsDir, "_kinds", "work.json"));
    const empty = catalogFromPack({ systems: [] }, work);
    if (!PACK_ID.test(packId)) return { catalog: null, empty };
    try {
      return { catalog: catalogFromPack(read(join(this.e.packsDir, packId, "common.json")), work), empty };
    } catch {
      return { catalog: null, empty };
    }
  }

  async documents(refresh = false): Promise<DocumentsInfo> {
    if (!this.docs || refresh) this.docs = await detectDocuments({ ...(this.e.shell ? { shell: this.e.shell } : {}), ...(this.e.platform ? { platform: this.e.platform } : {}), ...(this.e.env ? { env: this.e.env } : {}) });
    return this.docs;
  }

  /** 置き場所：人が選んだものか、既定（Documents の下の MOYAI/）。 */
  async root(): Promise<string | null> {
    if (!this.e.stateDir) return null;
    return readSettings(this.e.stateDir).root ?? defaultRoot(await this.documents());
  }

  /**
   * 公開の台帳だけを読んで、似た施設の集計を返す（AI の peer_reference の place: "ledger"。docs/plan.md §2.18.4）。
   * 場は公開の台帳だけ、立場は市町村（自分の施設の見え方）に固める。輪（非公開）は読まない。
   * 見え方の答えが無い・足りなければ、比べずに、聞くこと（軸と選べるコード）を返す（推測で埋めない）。
   */
  async ledgerReference(i: { packId: string; facility: { scale: number | null; scaleUnit: string | null } | null; answers: z.infer<typeof answersSchema> | null; commonItem?: string; aiAxes?: string[] }): Promise<Record<string, unknown> | "no_ledger" | "ledger_pack_not_ready"> {
    const sd = this.e.stateDir;
    if (!sd) return "no_ledger";
    const pack = this.pack(i.packId);
    if (typeof pack === "string") return "ledger_pack_not_ready";
    const s = readSettings(sd);
    if (!s.ledger) return "no_ledger";
    const needs = questionsOf(pack, i.facility ? { facility: i.facility } : null).map((q) => ({ key: q.key, name: q.name, codes: q.codes, suggested: q.suggested }));
    const ledgerVersion = gitHead(s.ledger);
    const empty = { mode: "ledger", position: "municipal", floorK: RECEIVE_MIN_K, places: [], aggregates: [], cards: [], ledgerVersion };
    if (!i.answers) return { ...empty, needs, reason: "answersMissing" };
    const chosen = defaultAxes(pack.spec, pack.table, i.answers);
    const prof = receiverProfile(pack.spec, pack.table, i.answers, chosen);
    if (!prof.ok) return { ...empty, needs, reason: prof.reason };
    // 保管先の計画がこの台帳へ出す施設の鍵は、自分の鍵として似た施設に数えない（受け手と同じ。台帳の中-5）
    const l = await loadLedgerPlace(s.ledger, pack, await this.root());
    const c = compare({ table: pack.table, position: "municipal", profile: prof.profile, places: l.place ? [l.place] : [] });
    const out = peerAggregates(c, i.commonItem);
    return { mode: "ledger", position: c.position, floorK: RECEIVE_MIN_K, ...out, ledgerVersion, needs: [], reason: null, aiAxes: i.aiAxes ?? [] };
  }

  /** 今の公開の台帳の clone の版（設定に台帳が無ければ null） */
  ledgerHead(): string | null {
    const sd = this.e.stateDir;
    const ledger = sd ? readSettings(sd).ledger : null;
    return ledger ? gitHead(ledger) : null;
  }

  private pack(id: string): SharePack | string {
    const l = loadSharePack(this.e.packsDir, id);
    return l.ok ? l.pack : l.reason;
  }

  private packs(): { id: string; name: string; ready: boolean; reason: string | null }[] {
    let ids: string[] = [];
    try {
      ids = readdirSync(this.e.packsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && PACK_ID.test(d.name) && !emptyPack(join(this.e.packsDir, d.name)))
        .map((d) => d.name)
        .sort();
    } catch {
      ids = [];
    }
    return ids.map((id) => {
      const l = loadSharePack(this.e.packsDir, id);
      return l.ok ? { id, name: l.pack.name, ready: true, reason: null } : { id, name: id, ready: false, reason: l.reason };
    });
  }

  async handle(call: HumanCall): Promise<Out> {
    const sd = this.e.stateDir;
    if (call.action === "commit_trial") return { ok: true, action: call.action, changed: false };
    if (!sd) return no("noStateDir");
    const now = new Date(this.e.now());
    switch (call.action) {
      case "plan_status": {
        const p = parsePayload("plan_status", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const h = await readHistory(root, p.planId);
        // この PC が前に見た版と署名が、保管先から消えていないか（監査 A5）。消えていれば、確定・承認・戻す・送るを止める
        const vanished = checkSeen(sd, root, p.planId, h);
        // 署名ごとに、この PC が覚えた鍵と照らした信じ方を添える（未確認の鍵は覚えるが、信じはしない）。替わった鍵には、前に確かめた鍵の指紋
        const versions = h.versions.map((v) => ({
          ...v,
          signatures: v.signatures.map((x) => {
            const trust = trustOf(sd, x, now);
            return { ...x, trust, fingerprint: fingerprint(x.pub), previous: trust === "changed" ? previousOf(sd, x.pub) : null };
          }),
          exports: v.exports.map((x) => {
            const trust = trustOf(sd, x, now);
            return { ...x, trust, fingerprint: fingerprint(x.pub), previous: trust === "changed" ? previousOf(sd, x.pub) : null };
          }),
        }));
        const s = readSettings(sd);
        return {
          ok: true,
          root,
          synced: await this.syncedOfPath(root),
          versions,
          latest: h.latest ? { version: h.latest.version, plan: h.latest.plan, sources: h.latest.sources ?? null, decisions: h.latest.decisions ?? null, crosswalk: h.latest.crosswalk ?? null } : null,
          // ひとつ前の版（確かめで合うときだけ）：承認を頼まれた人の星取表は、頼まれた版をこの版と比べる
          previous: h.previous && h.versions.find((v) => v.version === h.previous!.version)?.problem === null ? { version: h.previous.version, plan: h.previous.plan } : null,
          accepted: h.accepted,
          name: s.name,
          hasKey: s.name !== null && ownKeys(sd).some((k) => k.by === s.name),
          // 編集の番（渡す・承認・差し戻しで替わる）
          turn: await readTurn(root, p.planId),
          // いちばん新しい版の頼みと受け取り（頼んだ人には受け取った人を、受け取った人には自分だと出す。監査 B1）
          request: await this.requestView(root, p.planId, h, s.name),
          // いちばん新しい版に、その版を作った鍵でない頼みが置かれていれば、数えずに出す（監査 B1 の追い）
          requestsIgnored: await this.ignoredRequests(root, p.planId, h),
          vanished,
        };
      }
      case "plan_commit": {
        const p = parsePayload("plan_commit", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd);
        if (!signer.ok) return no(signer.reason);
        // 使った読み方を保管先に書き、道と版を版の記録に書く（この版に人が署名すると、その版の読み方が承認済みになる）。担当者の範囲の読み方は、署名する人の呼び名の下に置く
        const readingSkills: { name: string; path: string; version: string }[] = [];
        // 計画ルールは、承認済みの同じ中身か、この署名で人が受けた周期の案のもとになったものだけを載せる（Architect の 42 の 2）
        const acceptedIds = new Set(p.acceptances.map((a) => a.id));
        let approvedList: Awaited<ReturnType<typeof listReadings>> | null = null;
        // 先にどれも照らしてから書く（途中で断ったときに、前の読み方だけを書かない）
        for (const x of p.readings ?? []) {
          // 担当者の範囲の読み方の持ち主は、署名する人だけ（タブから来たほかの呼び名は受けない。監査 D2）
          if (x.by !== null && x.by !== signer.signer.by) return no("readingInvalid");
          const sk = ReadingSkill.safeParse(x.skill);
          if (!sk.success) return no("readingInvalid");
          if (sk.data.rules.some(isPlanRule)) {
            approvedList ??= await listReadings(root, await approvedReadingVersions(root, (v) => countsForApproval(trustOf(sd, v, now))));
            if (!planRulesBacked(sk.data, p.plan, acceptedIds, approvedList)) return no("readingInvalid");
          }
        }
        for (const x of p.readings ?? []) {
          const w = await (x.trimmed ? recordReadingVersion : registerReading)(root, x.skill, signer.signer.by, x.facilityKey);
          if (!w.ok) return no("readingInvalid");
          readingSkills.push({ name: (x.skill as { name: string }).name, path: w.path, version: w.version });
        }
        // 前に見た版や署名が保管先から消えていれば、その上には重ねない（監査 A5）
        const pid = (p.plan as { planId?: unknown } | null)?.planId;
        if (typeof pid === "string" && PLAN_ID.test(pid)) {
          const h0 = await readHistory(root, pid);
          if (checkSeen(sd, root, pid, h0)) return no("historyVanished");
          if (!(await this.mayBuildOn(root, pid, h0, signer.signer.pair.pub))) return no("notYourTurn");
        }
        // 次の版に重ねるための資料：あること・ハッシュ・上限を照らす。合わなければ確定しない（黙って記録を欠かさない）
        if (p.sources && typeof pid === "string" && PLAN_ID.test(pid)) {
          const sc = await checkSources(root, pid, p.sources, p.decisions ?? []);
          if (!sc.ok) return no(sc.reason);
        }
        // 頼むこと：自分で確定する（confirm の署名）か、編集・承認を頼んで渡す（edit の署名）。頼むときは宛先が要る
        const req = p.request ?? { kind: "self" as const, to: null, note: "" };
        if (req.kind !== "self" && !(req.to && /^[^\s@]+@[^\s@]+$/.test(req.to.trim()))) return no("mailToInvalid");
        const r = await commitPlan({
          root,
          signer: signer.signer,
          role: req.kind === "self" ? "confirm" : "edit",
          plan: p.plan,
          reason: p.reason,
          acceptances: p.acceptances,
          basedOn: p.basedOn,
          client: call.session,
          now,
          catalogs: (id) => this.catalogsFor(id),
          readingSkills,
          derivedFrom: p.derivedFrom ?? null,
          ...(p.sources ? { sources: p.sources, decisions: p.decisions ?? [], crosswalk: p.crosswalk ?? [] } : {}),
          ...(p.intake ? { intake: p.intake } : {}),
          ...(p.rowOrder ? { rowOrder: p.rowOrder } : {}),
        });
        if (!r.ok) return no(r.reason, r.pending !== undefined ? { pending: r.pending } : {});
        const at = now.toISOString();
        const by = signer.signer.by;
        const planId = r.record.planId;
        let mail: { to: string; subject: string; body: string } | null = null;
        if (req.kind === "self") await writeTurn(root, { schema: TURN_SCHEMA, planId, version: r.version, state: "approved", holder: by, to: null, from: by, note: "", at });
        else {
          await writeTurn(root, { schema: TURN_SCHEMA, planId, version: r.version, state: req.kind === "edit" ? "editing" : "awaitingApproval", holder: null, to: req.to!.trim(), from: by, note: req.note, at });
          const hist = await readHistory(root, planId);
          const contentHash = hist.versions.at(-1)!.contentHash;
          // 頼みに署名して保管先に置き、使い捨ての合言葉をリンクにだけ入れる（監査 B1）
          const q = await createRequest({ root, planId, version: r.version, contentHash, kind: req.kind, to: req.to!.trim(), by, pair: signer.signer.pair, now });
          mail = handoffMail({ name: r.record.plan.displayName, version: r.version, contentHash, kind: req.kind, to: req.to!.trim(), note: req.note, by, planId, link: handoffLink(planId, r.version, contentHash, q.token) });
        }
        // at は版の記録の署名の時刻（画面が結果の 1 文で版を年度で呼ぶのに使う。見せ方だけ。docs/screens.md §3.4 の末尾）
        return { ok: true, version: r.version, at: r.record.at, plan: r.record.plan, summary: r.record.summary, files: r.files, mail };
      }
      case "plan_revert": {
        const p = parsePayload("plan_revert", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd);
        if (!signer.ok) return no(signer.reason);
        const hr = await readHistory(root, p.planId);
        if (checkSeen(sd, root, p.planId, hr)) return no("historyVanished");
        // 戻すのも、次の版を作ること。確定と同じく、番の人だけ（台帳の新-1）
        if (!(await this.mayBuildOn(root, p.planId, hr, signer.signer.pair.pub))) return no("notYourTurn");
        const r = await revertPlan({ root, signer: signer.signer, planId: p.planId, to: p.to, reason: p.reason, basedOn: p.basedOn, client: call.session, now, catalogs: (id) => this.catalogsFor(id) });
        if (!r.ok) return no(r.reason);
        return { ok: true, version: r.version, plan: r.record.plan, summary: r.record.summary, files: r.files };
      }
      case "settings_read": {
        if (!parsePayload("settings_read", call.payload)) return no("payloadInvalid");
        const docs = await this.documents(true);
        const s = readSettings(sd);
        const root = s.root ?? defaultRoot(docs);
        const rings = readRings(sd).rings.map((r) => {
          const w = readKeyFile(sd, r.ringId);
          return { ringId: r.ringId, root: r.root, pack: r.pack, key: r.key, fingerprint: w ? fingerprint(w.pub) : null, synced: syncedOf(r.root, docs.syncRoots) };
        });
        return { ok: true, documents: docs.documents, documentsSynced: docs.synced, defaultRoot: defaultRoot(docs), chosenRoot: s.root, root, rootSynced: root ? syncedOf(root, docs.syncRoots) : null, ledger: s.ledger, github: readGitHub(sd)?.login ?? null, rings, packs: this.packs(), name: s.name, people: trustList(sd) };
      }
      case "settings_save": {
        const p = parsePayload("settings_save", call.payload);
        if (!p) return no("payloadInvalid");
        const root = p.root === null ? null : validRoot(p.root);
        if (p.root !== null && root === null) return no("rootInvalid");
        // 台帳の場所は送られたときだけ変える（送られなければ前のまま）
        const prev = readSettings(sd);
        const ledger = p.ledger === undefined ? prev.ledger : p.ledger === null ? null : validRoot(p.ledger);
        if (p.ledger !== undefined && p.ledger !== null && ledger === null) return no("ledgerInvalid");
        // 呼び名も、送られたときだけ変える
        const name = p.name === undefined ? prev.name : p.name === null ? null : validName(p.name) ? p.name : undefined;
        if (name === undefined) return no("nameInvalid");
        writeSettings(sd, { v: 1, root, ledger, name });
        return { ok: true, root, ledger, name };
      }
      case "comment_add": {
        const p = parsePayload("comment_add", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        // 書いた人は、この PC の呼び名（画面で選ばせない）
        const name = readSettings(sd).name;
        if (!name) return no("nameMissing");
        const r = await addComment(root, { planId: p.planId, version: p.version, row: p.row, by: name, text: p.text }, now);
        if (!r.ok) return no(r.reason);
        return { ok: true, comment: r.comment };
      }
      case "comments_list": {
        const p = parsePayload("comments_list", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return { ok: true, comments: [], unreadable: 0 };
        const r = await readComments(root, p.planId);
        return { ok: true, comments: r.comments, unreadable: r.unreadable };
      }
      case "plan_version_read": {
        const p = parsePayload("plan_version_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const r = await readPlanVersion(root, p.planId, p.version);
        if (!r.ok) return no(r.reason);
        // その版をつくったときに当てていた読み方（版の記録から読むだけ。古い版のルールのシートと署名の「適用 Skill」。記録が無ければ null）
        const recorded = r.record.readingSkills?.length ? await recordedReadings(root, r.record.readingSkills) : null;
        return { ok: true, version: r.record.version, plan: r.record.plan, contentHash: r.contentHash, at: r.record.at, readingSkills: recorded };
      }
      case "plans_list": {
        if (!parsePayload("plans_list", call.payload)) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return { ok: true, root: null, plans: [] };
        let ids: string[] = [];
        try {
          ids = readdirSync(join(root, "plans"), { withFileTypes: true })
            .filter((e) => e.isDirectory() && PLAN_ID.test(e.name))
            .map((e) => e.name)
            .sort();
        } catch {
          ids = [];
        }
        const plans: Record<string, unknown>[] = [];
        for (const id of ids) {
          try {
            const h = await readHistory(root, id);
            if (!h.latest) continue;
            plans.push({
              planId: id,
              displayName: h.latest.plan.displayName,
              fictional: h.latest.plan.facility.fictional,
              // 施設の年度の始まり（トップで、確定した版を年度で呼ぶのに使う。docs/screens.md §3.4 の末尾）
              fiscalYearStartMonth: h.latest.plan.facility.fiscalYearStartMonth,
              versions: h.versions.map((v) => ({
                version: v.version,
                at: v.at,
                contentHash: v.contentHash,
                roles: v.signatures.map((x) => x.role),
                // 版を確定した署名の時刻（承認があれば承認、無ければ自分で確定した署名）。渡しただけ・差し戻し・戻すは null。トップで版を年度で呼ぶのに使う（見せ方だけ）
                signedAt: (v.signatures.find((x) => x.role === "approve") ?? v.signatures.find((x) => x.role === "confirm"))?.at ?? null,
                // 版を作った人（確定か渡すの署名の呼び名）。トップの「ほかの人が持っていた間」に使う
                by: v.signatures.find((x) => x.role === "confirm" || x.role === "edit" || x.role === "revert")?.by ?? null,
                // 版を作った鍵が、前に確かめた鍵と替わっている（トップは替わったときだけ朱で知らせる。KeyWarn.dc.html の 6）
                keyChanged: v.signatures.some((x) => (x.role === "confirm" || x.role === "edit" || x.role === "revert") && trustOf(sd, x, now) === "changed"),
                problem: v.problem,
                legacy: v.legacy,
              })),
              derivedFrom: h.derivedFrom,
              turn: await readTurn(root, id),
            });
          } catch {
            plans.push({ planId: id, displayName: id, fictional: false, versions: [], turn: null, unreadable: true });
          }
        }
        return { ok: true, root, plans, name: readSettings(sd).name };
      }
      case "request_receive": {
        // メールのリンクを開いた人：合言葉を頼みと照らし、自分の鍵で受け取りに署名する（鍵がまだ無ければ作る。呼び名は要る）
        const p = parsePayload("request_receive", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        let signer = this.signer(sd);
        if (!signer.ok && signer.reason === "personKeyMissing") {
          const name = readSettings(sd).name;
          if (name) createOwnKey(sd, name, now);
          signer = this.signer(sd);
        }
        if (!signer.ok) return no(signer.reason);
        const v = (await readHistory(root, p.planId)).versions.find((x) => x.version === p.version);
        if (!v) return { ok: true, state: "unknown" };
        const r = await receiveRequest({ root, planId: p.planId, version: v, token: p.token, by: signer.signer.by, pair: signer.signer.pair, now });
        if (r.state === "takenByOther") return { ok: true, state: r.state, requester: r.request.body.by, receiver: { by: r.receipt.by, fingerprint: fingerprint(r.receipt.pub) } };
        if (r.state === "received" || r.state === "mine") return { ok: true, state: r.state, requester: r.request.body.by, kind: r.request.body.kind };
        return { ok: true, state: r.state };
      }
      case "request_renew": {
        // 頼み直す：頼んだ人だけ、承認か差し戻しが済む前だけ。新しい頼みを置き、前のリンクは使えなくなる（Wire の B1）
        const p = parsePayload("request_renew", call.payload);
        if (!p) return no("payloadInvalid");
        if (!/^[^\s@]+@[^\s@]+$/.test(p.to.trim())) return no("mailToInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd);
        if (!signer.ok) return no(signer.reason);
        const h = await readHistory(root, p.planId);
        const top = h.versions.at(-1);
        if (!top || top.version !== p.version || !h.latest) return no("notLatest");
        if (top.problem) return no("historyBroken");
        const act = await activeRequest(root, p.planId, top);
        if (!act || act.request.body.pub !== signer.signer.pair.pub) return no("notRequested");
        if (top.signatures.some((x) => x.role === "approve" || x.role === "return")) return no("notRequested");
        const q = await createRequest({ root, planId: p.planId, version: p.version, contentHash: top.contentHash, kind: act.request.body.kind, to: p.to.trim(), by: signer.signer.by, pair: signer.signer.pair, now });
        const prev = await readTurn(root, p.planId);
        if (prev) await writeTurn(root, { ...prev, to: p.to.trim(), note: p.note, at: now.toISOString() });
        const mail = handoffMail({ name: h.latest.plan.displayName, version: p.version, contentHash: top.contentHash, kind: act.request.body.kind, to: p.to.trim(), note: p.note, by: signer.signer.by, planId: p.planId, link: handoffLink(p.planId, p.version, top.contentHash, q.token) });
        return { ok: true, mail };
      }
      case "plan_sign": {
        const p = parsePayload("plan_sign", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd);
        if (!signer.ok) return no(signer.reason);
        const hs = await readHistory(root, p.planId);
        if (checkSeen(sd, root, p.planId, hs)) return no("historyVanished");
        // 承認・差し戻しは、承認の頼みを受け取った鍵だけ（監査 B1）
        const sv = hs.versions.find((x) => x.version === p.version);
        const act = sv ? await activeRequest(root, p.planId, sv) : null;
        if (!act || act.request.body.kind !== "approve" || act.receipt?.pub !== signer.signer.pair.pub) return no("notRequested");
        const r = await signLatest({ root, planId: p.planId, version: p.version, role: p.role, reason: p.reason, signer: signer.signer, now });
        if (!r.ok) return no(r.reason);
        // 承認すると番は閉じ、差し戻すと渡した人に番が戻る
        const prev = await readTurn(root, p.planId);
        const at = now.toISOString();
        const by = signer.signer.by;
        await writeTurn(root, {
          schema: TURN_SCHEMA,
          planId: p.planId,
          version: p.version,
          state: p.role === "approve" ? "approved" : "returned",
          holder: p.role === "approve" ? by : (prev?.from ?? null),
          to: null,
          from: by,
          note: p.reason.trim(),
          at,
        });
        // at は承認・差し戻しの署名の時刻（signLatest に渡した now と同じ）。承認の結果の 1 文で版を年度で呼ぶのに使う（見せ方だけ）
        return { ok: true, version: r.version, role: r.role, at };
      }
      case "plan_file_read": {
        const p = parsePayload("plan_file_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        // 確かめで合う版だけ（署名と鎖が合わない版の書き出しは渡さない）
        const pv = await readPlanVersion(root, p.planId, p.version);
        if (!pv.ok) return no(pv.reason);
        const n = String(p.version).padStart(6, "0");
        const file = join(planDir(root, p.planId), p.kind === "export" ? "exports" : "reports", p.kind === "export" ? `${n}-plan.xlsx` : `${n}-diff.xlsx`);
        let bytes: Buffer;
        try {
          bytes = await readFile(file);
        } catch {
          return no("fileMissing");
        }
        // 署名の中のハッシュと照らす（監査 E1）。合わなければ渡さない。ハッシュの無い前の版は、そのまま渡す
        const want = pv.record.files ? (p.kind === "export" ? pv.record.files.export : pv.record.files.report) : undefined;
        if (want !== undefined && want !== sha256Hex(bytes)) return no("fileChanged");
        return { ok: true, version: p.version, kind: p.kind, base64: bytes.toString("base64") };
      }
      case "plan_source_put": {
        const p = parsePayload("plan_source_put", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const r = await putSource(root, p.planId, new Uint8Array(Buffer.from(p.base64, "base64")));
        if (!r.ok) return no(r.reason);
        return { ok: true, sha256: r.sha256, size: r.size };
      }
      case "plan_source_read": {
        const p = parsePayload("plan_source_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        // 確かめで合う版の記録にある資料だけ。ハッシュが合わなければ渡さない（黙って残りの資料だけで組み直させない）
        const pv = await readPlanVersion(root, p.planId, p.version);
        if (!pv.ok) return no(pv.reason);
        const r = await readSource(root, p.planId, pv.record.sources, p.sha256);
        if (!r.ok) return no(r.reason);
        return { ok: true, name: r.name, sha256: p.sha256, base64: r.bytes.toString("base64") };
      }
      case "templates_read": {
        const p = parsePayload("templates_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return { ok: true, root: null, templates: [] };
        const list = await listTemplates(root, await approvedTemplateVersions(root, (x) => countsForApproval(trustOf(sd, x, now))));
        // その計画のいちばん新しい版で書き出した様式（どの鍵の署名でも。信じ方は版の一覧の書き出しの署名に出る）
        let exported = new Set<string>();
        if (p.planId) {
          const v = (await readHistory(root, p.planId)).versions.at(-1);
          if (v) exported = new Set(v.exports.map((x) => x.template.version));
        }
        // 並べるのは、いちばん上の版と、承認済みの前の版（承認済みの写し方を直しても、承認済みのほうは消えない。Wire）
        const shown = list.filter((t) => t.current || t.approval);
        return {
          ok: true,
          root,
          templates: shown.map((t) => ({ name: t.name, version: t.version, current: t.current, columns: t.columns, approval: t.approval, exported: exported.has(t.version) })),
        };
      }
      case "template_save": {
        const p = parsePayload("template_save", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        let bytes: Uint8Array = new Uint8Array(Buffer.from(p.base64, "base64"));
        if (bytes.length === 0) {
          const src = p.from ? await readTemplateVersion(root, p.name, p.from) : null;
          if (!src) return no("templateUnknown");
          bytes = src.bytes;
        }
        const r = await saveTemplate(root, p.name, bytes, p.columns);
        if (!r.ok) return no(r.reason);
        return { ok: true, name: r.name, version: r.version };
      }
      case "template_file_read": {
        const p = parsePayload("template_file_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        // 名前と版（様式のファイルと写し方のハッシュ）が合うものだけ
        const t = await readTemplateVersion(root, p.name, p.version);
        if (!t) return no("templateUnknown");
        return { ok: true, name: p.name, version: p.version, base64: Buffer.from(t.bytes).toString("base64") };
      }
      case "export_sign": {
        const p = parsePayload("export_sign", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd);
        if (!signer.ok) return no(signer.reason);
        const h = await readHistory(root, p.planId);
        if (checkSeen(sd, root, p.planId, h)) return no("historyVanished");
        // 新しく書き出すのは、確かめで合う最新の版だけ。差し戻された版は書き出さない（Architect の縛り 4）
        const v = h.versions.find((x) => x.version === p.version);
        if (!v || !h.latest) return no("versionUnknown");
        if (h.versions.some((x) => x.problem !== null)) return no("historyBroken");
        if (h.latest.version !== p.version) return no("notLatest");
        if (v.signatures.some((x) => x.role === "return")) return no("returned");
        const t = await readTemplateVersion(root, p.name, p.templateVersion);
        if (!t) return no("templateUnknown");
        const plan = h.latest.plan;
        const cat = this.catalogsFor(plan.packId);
        // 写し方に案（layout）があれば案のとおり、無ければ列の役目で平らに（src/plan/template-layout.ts の writeTemplate）
        let excel: Uint8Array;
        try {
          excel = (await writeTemplate(new ExcelJS.Workbook(), t.bytes, t.columns, { plan, catalog: cat.catalog ?? cat.empty, asOf: dueBaseDate(h.latest.at) })).bytes;
        } catch {
          return no("templateLayoutInvalid");
        }
        const excelHash = sha256Hex(excel);
        const file = signExport(
          { planId: p.planId, version: p.version, contentHash: v.contentHash, by: signer.signer.by, at: now.toISOString(), template: { name: p.name, file: t.fileHash, columns: t.columnsHash, version: p.templateVersion }, excel: excelHash },
          signer.signer.pair,
        );
        const dir = planDir(root, p.planId);
        await mkdir(join(dir, "exports"), { recursive: true });
        await mkdir(join(dir, "signatures"), { recursive: true });
        // Excel のバイト列を先に置き、署名をあとに置く（署名があるのに Excel が無い、を作らない。Architect の縛り 3）
        const xlsx = join(dir, "exports", exportExcelName(p.version, excelHash));
        // 同じ名前があっても、中身が違えば一時のファイルから置き換える（先に置かれた別の中身で、毎回 fileChanged にしない。Architect の小 1）
        if (!existsSync(xlsx) || sha256Hex(await readFile(xlsx)) !== excelHash) {
          const tmp = `${xlsx}.tmp-${process.pid}`;
          await writeFile(tmp, excel);
          await rename(tmp, xlsx);
        }
        try {
          await writeFile(join(dir, "signatures", exportSignatureName(p.version, keyIdOf(signer.signer.pair.pub), excelHash)), `${JSON.stringify(file, null, 1)}\n`, { encoding: "utf8", flag: "wx" });
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        }
        return { ok: true, version: p.version, name: p.name, excel: excelHash };
      }
      case "export_file_read": {
        const p = parsePayload("export_file_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const pv = await readPlanVersion(root, p.planId, p.version);
        if (!pv.ok) return no(pv.reason);
        const v = (await readHistory(root, p.planId)).versions.find((x) => x.version === p.version);
        // その様式の版で署名した書き出しのうち、信じる鍵（自分か確認済み）のものを先に、その中で時刻の新しいもの。無ければほかの鍵のもの。
        // 時刻は署名した人が書くので、未確認の鍵が先の時刻を書いても、信じる鍵の書き出しを差し置かない（Architect の 3C の直し）
        const cands = (v?.exports ?? []).filter((e) => e.template.name === p.name && e.template.version === p.templateVersion).map((e) => ({ e, trust: trustOf(sd, e, now) }));
        const newest = (xs: typeof cands) => [...xs].sort((a, b) => (a.e.at < b.e.at ? 1 : -1))[0];
        const pick = newest(cands.filter((c) => countsForApproval(c.trust))) ?? newest(cands);
        if (!pick) return no("exportUnknown");
        const x = pick.e;
        let bytes: Buffer;
        try {
          bytes = await readFile(join(planDir(root, p.planId), "exports", exportExcelName(p.version, x.excel)));
        } catch {
          return no("fileMissing");
        }
        if (sha256Hex(bytes) !== x.excel) return no("fileChanged");
        // 渡したファイルの署名者（画面は、この 1 つについて鍵の警告を出す）
        const signer = { by: x.by, key: x.key, pub: x.pub, trust: pick.trust, fingerprint: fingerprint(x.pub), previous: pick.trust === "changed" ? previousOf(sd, x.pub) : null };
        return { ok: true, version: p.version, name: p.name, base64: bytes.toString("base64"), signer };
      }
      case "person_key_create": {
        const p = parsePayload("person_key_create", call.payload);
        if (!p) return no("payloadInvalid");
        const name = readSettings(sd).name;
        if (!name) return no("nameMissing");
        const r = createOwnKey(sd, name, now);
        if (!r.ok) return no(r.reason);
        return { ok: true, name, key: r.key, fingerprint: r.fingerprint };
      }
      case "person_key_confirm": {
        const p = parsePayload("person_key_confirm", call.payload);
        if (!p) return no("payloadInvalid");
        return confirmKey(sd, p.pub, now) ? { ok: true, key: keyIdOf(p.pub) } : no("keyUnknown");
      }
      case "ring_create": {
        const p = parsePayload("ring_create", call.payload);
        if (!p) return no("payloadInvalid");
        const root = validRoot(p.root);
        if (!root) return no("rootInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const r = await createRing({ stateDir: sd, root, pack, now });
        if (!r.ok) return no(r.reason);
        return { ok: true, ringId: r.ringId, key: r.key, fingerprint: r.fingerprint, synced: await this.syncedOfPath(root) };
      }
      case "checkpoint_preview":
      case "checkpoint_open_text": {
        const p = call.action === "checkpoint_preview" ? parsePayload("checkpoint_preview", call.payload) : parsePayload("checkpoint_open_text", call.payload);
        if (!p) return no("payloadInvalid");
        const ctx = await this.shareContext(p.planId, p.ringId, p.answers);
        if (!ctx.ok) return ctx.out;
        if (call.action === "checkpoint_open_text") {
          const v = this.ringView(ctx, monthOf(now));
          if (!v.bodyText || !v.bodyHash) return no("noPreview");
          // 同期されない一時のフォルダに写す（施設名で検索して見つからないことを、人が自分で確かめられる）
          const file = join(tmpdir(), `moyai-preview-${v.bodyHash.slice(0, 16)}.json`);
          await writeFile(file, v.bodyText, "utf8");
          (this.e.openText ?? openWithEditor)(file);
          return { ok: true, file };
        }
        const view = this.ringView(ctx, monthOf(now));
        return { ok: true, ...ctx.info, view };
      }
      case "checkpoint_send": {
        const p = parsePayload("checkpoint_send", call.payload);
        if (!p) return no("payloadInvalid");
        const ctx = await this.shareContext(p.planId, p.ringId, p.answers);
        if (!ctx.ok) return ctx.out;
        if (ctx.version !== p.version) return no("versionChanged");
        if (!ctx.sender.ok) return no("keysForked");
        const sender = { facility: ctx.facility, pair: ctx.sender.pair, stored: ctx.sender.stored };
        const r = await sendCheckpoint(ctx.ring, sender, ctx.pack, ctx.plan, p.answers, monthOf(now), p.previewHash, now, this.pendingKeys);
        if (!r.ok) return no(r.reason);
        // 初めて出した施設の鍵も、自分の鍵として確認済みに数える
        const confirmed = new Set([...ctx.ring.confirmed, keyIdOf(sender.pair.pub)]);
        const report = withSentInfo(await verifyRing(ctx.ring.entry.root, p.ringId, ctx.pack, confirmed, ctx.ring.known), readPlanSent(ctx.facility, p.ringId));
        return { ok: true, fileName: r.fileName, hash: r.hash, seq: r.seq, report };
      }
      case "ledger_preview": {
        const p = parsePayload("ledger_preview", call.payload);
        if (!p) return no("payloadInvalid");
        const c = await this.ledgerSendContext(p.planId);
        if (!c.ok) return c.out;
        const pend = c.sender.ok ? pendingSent(c.facility, c.L, keyIdOf(c.sender.pair.pub)) : null;
        const view = this.ledgerView(c, p.answers, monthOf(now), !!pend, c.info.intake);
        // 台帳の決まりが、この PC が受け入れたものから変わっていれば、その差（受け入れ直しは ledger_rules_accept。台帳の新-3）
        const rulesHash = sha256Hex(c.L.ledgerBytes);
        const rulesChange =
          c.accepted && c.accepted.acceptedRulesHash !== rulesHash
            ? (() => {
                const rows = diffRuleRows(c.accepted.acceptedRules, c.L.rules);
                return { rulesHash, loosened: rows.filter((r) => r.dir === "loosened").length, tightened: rows.filter((r) => r.dir === "tightened").length, rows };
              })()
            : null;
        return { ok: true, ...c.info, pending: pend ? { pr: pend.pr, url: pend.url } : null, view, rulesChange };
      }
      case "ledger_send": {
        const p = parsePayload("ledger_send", call.payload);
        if (!p) return no("payloadInvalid");
        const c = await this.ledgerSendContext(p.planId);
        if (!c.ok) return c.out;
        if (c.version !== p.version) return no("versionChanged");
        if (!c.repo) return no("ledgerNotGitHub");
        const gh = readGitHub(sd);
        if (!gh) return no("githubNotConnected");
        if (!c.accepted) return no("noKey");
        if (!c.sender.ok) return no("keysForked");
        const sender = { facility: c.facility, pair: c.sender.pair };
        if (pendingSent(c.facility, c.L, keyIdOf(sender.pair.pub))) return no("ledgerPending");
        const token = gh.token;
        const s = sealPlace(ledgerPlace(c.L, c.accepted, sender), sender.pair, c.pack, c.plan, p.answers, monthOf(now), p.previewHash);
        if (!s.ok) return no(s.reason);
        const bytes = new Uint8Array(Buffer.from(s.text, "utf8"));
        const seq = s.input.seq;
        const key = keyIdOf(s.input.pub);
        const path = ledgerBundlePath(key, seq, s.hash);
        const check = checkAgainstLedger(c.L, c.pack, path, bytes);
        if (!check.ok) return no("ledgerNg", { reasons: check.reasons });
        // 施設の鍵を先に置く（PR だけが出て、鍵が保管先に無い状態を作らない）。ほかの PC が先に別の鍵を書いていれば出さない
        if (!c.sender.stored && storeFacilityKey(c.facility, c.L.id, sender.pair, this.pendingKeys) === "differs") return no("keysForked");
        const parsed = parseJsonStrict(s.text);
        const body = parsed.ok ? (parsed.value as unknown as { body: { profile: Parameters<typeof ledgerProfileText>[1]["profile"]; chunks: unknown[] } }).body : null;
        const io = this.githubIo();
        const r = await openLedgerPr(io, token, {
          upstream: c.repo,
          path,
          bytes,
          branch: ledgerBranch(key, seq, s.hash),
          title: LEDGER_PR_TEXT.title(key, seq),
          body: LEDGER_PR_TEXT.body({ key, pub: s.input.pub, seq, hash: s.hash, path, profile: body ? ledgerProfileText(c.pack, body) : "", chunks: body?.chunks.length ?? 0, ledgerId: c.L.id }),
          commitMessage: LEDGER_PR_TEXT.commitMessage(key, seq),
        });
        if (!r.ok) return no(`github.${r.reason}`);
        appendPlanSent(c.facility, c.L.id, { ledgerId: c.L.id, key, seq, hash: s.hash, path, month: monthOf(now), at: now.toISOString(), repo: `${c.repo.owner}/${c.repo.name}`, pr: r.number, url: r.url, login: r.login, version: c.version, state: "open" });
        return { ok: true, pr: r.number, url: r.url, path, hash: s.hash, seq, login: r.login };
      }
      case "ledger_intake_send": {
        // GitHub のアカウントなしで出す（運営者の決定 2026-11-07）：束は GitHub の道と同じ関数で作って署名し、台帳の clone の木で確かめてから、
        // 受け口（LEDGER_INTAKE_URL の 1 つだけ）に送る。受け口が運営者の GitHub のアカウントで PR を出す。行方は GitHub の道と同じ持ち出し簿と読み方
        const p = parsePayload("ledger_intake_send", call.payload);
        if (!p) return no("payloadInvalid");
        const io = this.intakeIo();
        if (!io) return no("intakeNotReady");
        const c = await this.ledgerSendContext(p.planId);
        if (!c.ok) return c.out;
        if (c.version !== p.version) return no("versionChanged");
        if (!c.sender.ok) return no("keysForked");
        const sender = { facility: c.facility, pair: c.sender.pair };
        if (pendingSent(c.facility, c.L, keyIdOf(sender.pair.pub))) return no("ledgerPending");
        // 台帳の決まりをまだ受け入れていなければ、今の決まりで束を作る（プレビューと同じ）。受け入れの記録は、送る直前に書く
        const accepted = c.accepted ?? { ledgerId: c.L.id, pack: c.pack.id, acceptedRulesHash: sha256OfLedger(c.L), acceptedRules: c.L.rules, createdAt: now.toISOString() };
        const s = sealPlace(ledgerPlace(c.L, accepted, sender), sender.pair, c.pack, c.plan, p.answers, monthOf(now), p.previewHash);
        if (!s.ok) return no(s.reason);
        const bytes = new Uint8Array(Buffer.from(s.text, "utf8"));
        const seq = s.input.seq;
        const key = keyIdOf(s.input.pub);
        const path = ledgerBundlePath(key, seq, s.hash);
        const check = checkAgainstLedger(c.L, c.pack, path, bytes);
        if (!check.ok) return no("ledgerNg", { reasons: check.reasons });
        // 施設の鍵を先に置く（PR だけが出て、鍵が保管先に無い状態を作らない）。ほかの PC が先に別の鍵を書いていれば出さない
        if (!c.sender.stored && storeFacilityKey(c.facility, c.L.id, sender.pair, this.pendingKeys) === "differs") return no("keysForked");
        if (!c.accepted) acceptLedger(sd, c.L, c.pack, now);
        const r = await sendToIntake(io, s.text);
        if (!r.ok) return no(`intake.${r.reason}`, { reasons: r.reasons });
        // 同じ中身の束は、受け口が前の PR を返す。持ち出し簿に同じ PR があれば足さない
        const sentBefore = readPlanSent<LedgerSentEntry>(c.facility, c.L.id).some((e) => e.hash === s.hash && e.pr === r.number && e.repo === `${r.repo.owner}/${r.repo.name}`);
        if (!sentBefore) {
          appendPlanSent(c.facility, c.L.id, { ledgerId: c.L.id, key, seq, hash: s.hash, path, month: monthOf(now), at: now.toISOString(), repo: `${r.repo.owner}/${r.repo.name}`, pr: r.number, url: r.url, login: "", via: "intake", version: c.version, state: "open" } satisfies LedgerSentEntry);
        }
        return { ok: true, pr: r.number, url: r.url, path, hash: s.hash, seq };
      }
      case "ledger_prs": {
        const p = parsePayload("ledger_prs", call.payload);
        if (!p) return no("payloadInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const L = await loadLedgerForSend(readSettings(sd).ledger, pack);
        if (!L.ok) return no(`ledger.${L.reason}`);
        const io = this.githubIo();
        const root = await this.root();
        // 保管先の計画ごとの持ち出し簿（share/sent/<台帳ID>.json）から、出した PR を新しい順に 10 まで
        const books = root ? allPlanSent<LedgerSentEntry>(root, L.id) : [];
        const mine = books.flatMap((b) => b.entries.filter((e) => e.ledgerId === L.id).map((e) => ({ e, b }))).sort((x, y) => (x.e.at < y.e.at ? -1 : 1));
        const prs = [];
        const touched = new Set<(typeof books)[number]>();
        for (const { e, b } of mine.slice(-10).reverse()) {
          const [owner, name] = e.repo.split("/");
          const st = owner && name ? await prStatus(io, { owner, name }, e.pr) : null;
          if (st && e.state !== st.state) {
            e.state = st.state;
            touched.add(b);
          }
          prs.push({ pr: e.pr, url: e.url, seq: e.seq, at: e.at, version: e.version ?? null, login: e.login, via: e.via ?? "github", status: st });
        }
        for (const b of touched) writePlanSent(b.facility, L.id, b.entries);
        return { ok: true, prs };
      }
      case "github_connect_start": {
        const p = parsePayload("github_connect_start", call.payload);
        if (!p) return no("payloadInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const L = await loadLedgerForSend(readSettings(sd).ledger, pack);
        if (!L.ok) return no(`ledger.${L.reason}`);
        const io = this.githubIo();
        const clientId = this.githubClientId(io);
        if (!clientId) return no("githubNoClient");
        // 台帳の決まりを受け入れる（束に署名する鍵は施設のもの。人が送ったときに計画のフォルダに書く。docs/plan.md §2.19）
        const accepted = ledgerAcceptance(sd, L.id);
        acceptLedger(sd, L, pack, now);
        const d = await startDevice(io, clientId);
        if (!d.ok) return no(`github.${d.reason}`);
        this.connecting?.stop();
        let stopped = false;
        let interval = d.interval;
        const st: GitHubConnecting = {
          state: "waiting",
          userCode: d.userCode,
          verificationUri: d.verificationUri,
          expiresAt: this.e.now() + d.expiresIn * 1000,
          login: null,
          stop: () => {
            stopped = true;
          },
        };
        this.connecting = st;
        const tick = async (): Promise<void> => {
          if (stopped) return;
          if (this.e.now() > st.expiresAt) {
            st.state = "expired";
            return;
          }
          const r = await pollDevice(io, clientId, d.deviceCode);
          if (stopped) return;
          if (r.state === "ok") {
            const login = await whoAmI(io, r.token);
            if (!login) {
              st.state = "failed";
              return;
            }
            writeGitHub(sd, { v: "moyai.github/1", login, token: r.token, connectedAt: new Date(this.e.now()).toISOString() });
            st.login = login;
            st.state = "ok";
            return;
          }
          if (r.state === "pending" || r.state === "slowDown") {
            if (r.state === "slowDown") interval += 5;
            setTimeout(() => void tick(), interval * 1000);
            return;
          }
          st.state = r.state;
        };
        setTimeout(() => void tick(), interval * 1000);
        return { ok: true, userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, acceptedNow: !accepted };
      }
      case "github_connect_state": {
        if (!parsePayload("github_connect_state", call.payload)) return no("payloadInvalid");
        const c = this.connecting;
        const gh = readGitHub(sd);
        if (!c) return { ok: true, state: gh ? "ok" : "none", login: gh?.login ?? null };
        if (c.state !== "waiting") this.connecting = null;
        return { ok: true, state: c.state, login: c.login ?? gh?.login ?? null, userCode: c.userCode, verificationUri: c.verificationUri };
      }
      case "github_disconnect": {
        if (!parsePayload("github_disconnect", call.payload)) return no("payloadInvalid");
        this.connecting?.stop();
        this.connecting = null;
        removeGitHub(sd);
        return { ok: true };
      }
      case "ring_member_confirm": {
        // 輪の仲間の鍵を、人が指紋を読み合わせて確認済みにする（その輪に、この公開鍵の仲間のファイルがあるときだけ）
        const p = parsePayload("ring_member_confirm", call.payload);
        if (!p) return no("payloadInvalid");
        const entry = readRings(sd).rings.find((r) => r.ringId === p.ringId);
        if (!entry) return no("noRing");
        const pack = this.pack(entry.pack);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const ring = await loadRing(sd, p.ringId, pack);
        if (!ring.ok) return no(ring.reason);
        const rep = await verifyRing(entry.root, p.ringId, pack, ring.confirmed, ring.known);
        if (!rep.lines.some((l) => l.kind === "member" && l.pub === p.pub)) return no("keyUnknown");
        const rs = readRings(sd);
        const key = keyIdOf(p.pub);
        if (!rs.confirmed.includes(key)) writeRings(sd, { ...rs, confirmed: [...rs.confirmed, key] });
        return { ok: true, key };
      }
      case "ledger_rules_accept": {
        // 変わった台帳の決まりを、人が差を見て受け入れる（見た決まりのハッシュと今のハッシュが同じで、緩くした決まりでないときだけ。輪と同じ形。台帳の新-3）
        const p = parsePayload("ledger_rules_accept", call.payload);
        if (!p) return no("payloadInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const L = await loadLedgerForSend(readSettings(sd).ledger, pack);
        if (!L.ok) return no(`ledger.${L.reason}`);
        if (sha256Hex(L.ledgerBytes) !== p.rulesHash) return no("previewChanged");
        if (checkRules(L.rules).length > 0) return no("rules");
        const cur = ledgerAcceptance(sd, L.id);
        addLedger(sd, { ledgerId: L.id, pack: pack.id, acceptedRulesHash: p.rulesHash, acceptedRules: L.rules, createdAt: cur?.createdAt ?? now.toISOString() });
        return { ok: true };
      }
      case "facility_key_rotate": {
        // 署名鍵を作り直す（docs/plan.md §2.19 の 5・6）：鍵が 2 つある・鎖が分かれたときの直し方。人が画面で見た鍵と今の鍵が同じときだけ
        const p = parsePayload("facility_key_rotate", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const entry = readRings(sd).rings.find((r) => r.ringId === p.ringId);
        if (!entry) return no("noRing");
        const pack = this.pack(entry.pack);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const ring = await loadRing(sd, p.ringId, pack, ownKeysAt(root, p.ringId));
        if (!ring.ok) return no(ring.reason);
        const facility: Facility = { root, planId: p.planId };
        // 今の鍵と、前に移したのに輪に印が無い鍵（前の作り直しが途中で落ちた。押し直せば印を置き直す）
        const now = rotateKeysOf(ring, facility);
        if (now.length === 0) return no("noKey");
        if (now.join(",") !== [...new Set(p.keys)].sort().join(",")) return no("previewChanged");
        const r = await rotateRingKey(ring, facility, monthOf(new Date()));
        if (!r.ok) return no(r.reason, { retired: r.retired });
        this.pendingKeys.delete(`${root}|${p.planId}|${p.ringId}`);
        return { ok: true, retired: r.retired, unsigned: r.unsigned };
      }
      case "ring_rules_accept": {
        // 変わった輪の決まりを、人が差を見て受け入れる（見た決まりのハッシュと今のハッシュが同じで、緩くした決まりでないときだけ）
        const p = parsePayload("ring_rules_accept", call.payload);
        if (!p) return no("payloadInvalid");
        const entry = readRings(sd).rings.find((r) => r.ringId === p.ringId);
        if (!entry) return no("noRing");
        const pack = this.pack(entry.pack);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const ring = await loadRing(sd, p.ringId, pack);
        if (!ring.ok) return no(ring.reason);
        if (ring.ctx.rulesHash !== p.rulesHash) return no("previewChanged");
        if (checkRules(ring.rules).length > 0) return no("rules");
        addRing(sd, { ...ring.entry, acceptedRulesHash: ring.ctx.rulesHash, acceptedRules: ring.rules });
        return { ok: true };
      }
      case "ring_verify": {
        const p = parsePayload("ring_verify", call.payload);
        if (!p) return no("payloadInvalid");
        const entry = readRings(sd).rings.find((r) => r.ringId === p.ringId);
        if (!entry) return no("noRing");
        const pack = this.pack(entry.pack);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const root = await this.root();
        const ring = await loadRing(sd, p.ringId, pack, root ? ownKeysAt(root, p.ringId) : []);
        if (!ring.ok) return no(ring.reason);
        const sent = root ? allPlanSent<{ ringId: string; hash: string; version?: number; at: string }>(root, p.ringId).flatMap((b) => b.entries) : [];
        return { ok: true, report: withSentInfo(await verifyRing(entry.root, p.ringId, pack, ring.confirmed, ring.known), sent) };
      }
      case "readings_read": {
        if (!parsePayload("readings_read", call.payload)) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return { ok: true, root: null, readings: [] };
        const list = await listReadings(root, await approvedReadingVersions(root, (x) => countsForApproval(trustOf(sd, x, now))));
        return { ok: true, root, readings: loadedOf(list, readSettings(sd).name) };
      }
      case "readings_lineage": {
        // ルールの詳細の適用先（docs/screens.md 3.2）：保存先の版の記録から読むだけ。読めない施設は数えない
        if (!parsePayload("readings_lineage", call.payload)) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return { ok: true, root: null, places: [], applied: [] };
        return { ok: true, root, ...(await readingLineage(root)) };
      }
      case "peers_compare": {
        const p = parsePayload("peers_compare", call.payload);
        if (!p) return no("payloadInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const s = readSettings(sd);
        const loaded = await loadPlaces({ stateDir: sd, ledgerRoot: s.ledger, pack, storage: await this.root() });
        const base = {
          packName: pack.name,
          questions: questionsOf(pack, p.facility === null ? null : { facility: p.facility }),
          classNames: pack.classNames,
          axes: pack.axes,
          spec: pack.spec.axes,
          /** 全国の表に列のある軸（受け手が選べるのはこの軸だけ） */
          tableAxes: pack.table.axes.map((a) => a.key),
          places: loaded.status,
          ledgerRoot: s.ledger,
        };
        // 見え方の出どころは立場で決まる（自分の施設か、入札の対象か）。決まらなければ聞く（推測で埋めない）
        const answers = PROFILE_FROM[p.position] === "self" ? p.answers : p.target;
        if (answers === null) return { ok: true, ...base, chosenAxes: [], comparison: null, reason: "targetMissing" };
        const chosen = p.axes ?? defaultAxes(pack.spec, pack.table, answers);
        const prof = receiverProfile(pack.spec, pack.table, answers, chosen);
        if (!prof.ok) return { ok: true, ...base, chosenAxes: chosen, comparison: null, reason: prof.reason };
        return { ok: true, ...base, chosenAxes: chosen, comparison: compare({ table: pack.table, position: p.position, profile: prof.profile, places: loaded.places }), reason: null };
      }
      default:
        return no("unknownAction");
    }
  }

  private async syncedOfPath(path: string) {
    return syncedOf(path, (await this.documents()).syncRoots);
  }

  /** 公開の台帳へ出す文脈：確定したいちばん新しい版・パック・台帳の clone（受け手と同じ関数で読む）・台帳のリポジトリ・GitHub の接続 */
  private async ledgerSendContext(planId: string) {
    const sd = this.e.stateDir!;
    const root = await this.root();
    const io = this.githubIo();
    const gh = readGitHub(sd);
    const github = { login: gh?.login ?? null, ready: this.githubClientId(io) !== null };
    const fail = (reason: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, out: no(reason, { github, ...extra }) });
    if (!root) return fail("noRoot");
    const h = await readHistory(root, planId);
    if (!h.latest) return fail("notConfirmed");
    // 確かめで合わない版（鎖・署名・作った署名）は、輪にも公開の台帳にも出さない。前に見た版や署名が消えていても出さない
    if (h.versions.at(-1)?.problem) return fail("historyBroken");
    if (checkSeen(this.e.stateDir!, root, planId, h)) return fail("historyVanished");
    const plan = h.latest.plan;
    const pack = this.pack(plan.packId);
    if (typeof pack === "string") return fail("packNotReady", { packReason: pack });
    const base = {
      plan: { planId, packId: plan.packId, version: h.latest.version, displayName: plan.displayName, fictional: plan.facility.fictional, inNationalTable: plan.facility.inNationalTable, profile: plan.facility.profile ?? null, pending: pendingDecisions(plan, h.accepted).length },
      questions: questionsOf(pack, plan),
      classNames: pack.classNames,
      axes: pack.axes,
      packName: pack.name,
      github,
      // GitHub のアカウントなしの道（受け口の URL が決まっているときだけ出す）
      intake: this.intakeIo() !== null,
    };
    const ledgerRoot = readSettings(sd).ledger;
    const L = await loadLedgerForSend(ledgerRoot, pack);
    if (!L.ok) return fail(`ledger.${L.reason}`, base);
    const repo: Repo | null = repoOfRemote(gitRemote(L.root));
    const facility: Facility = { root, planId };
    const sender = facilityKey(facility, L.id, this.pendingKeys);
    const accepted = ledgerAcceptance(sd, L.id);
    const key = sender.ok ? keyIdOf(sender.pair.pub) : null;
    const info = { ...base, ledger: { id: L.id, repo: repo ? `${repo.owner}/${repo.name}` : null, key, fingerprint: sender.ok ? fingerprint(sender.pair.pub) : null } };
    return { ok: true as const, L, pack, plan, version: h.latest.version, repo, info, facility, sender, accepted };
  }

  /**
   * 公開の台帳の見え方（GitHub につないでいないか、施設の鍵が 2 つあれば、相手から見たあなたまでを出し、束のバイト列は出さない）。
   * GitHub のアカウントなしの道（受け口）があれば、つないでいなくても束のバイト列を出す（GitHub の道は noKey で止め、受け口の道は送れる）
   */
  private ledgerView(c: Extract<Awaited<ReturnType<HumanService["ledgerSendContext"]>>, { ok: true }>, answers: Answers, month: string, pending: boolean, intake: boolean): PreviewView {
    const accepted = c.accepted ?? { ledgerId: c.L.id, pack: c.pack.id, acceptedRulesHash: sha256OfLedger(c.L), acceptedRules: c.L.rules, createdAt: "" };
    const place = ledgerPlace(c.L, accepted, { facility: c.facility, pair: c.sender.ok ? c.sender.pair : PLACEHOLDER_PAIR });
    // 台帳では、出した束が審査中で clone にまだ無いのはふつうのこと（「消えた」ではない）。次の束を止めるのは pending
    const v = { ...previewPlace(place, c.pack, c.plan, answers, month), vanished: false };
    // 見え方と塊（鍵によらない）は見せるが、送れないので、ハッシュとバイト列は出さない（画面は「出ていくもの」を出さない）
    if (!c.sender.ok) return { ...v, blockers: [...v.blockers, "keysForked"], bodyHash: null, bodyText: null, bytes: null };
    if (!c.accepted && !intake) return { ...v, blockers: [...v.blockers, "noKey"], bodyHash: null, bodyText: null, bytes: null };
    const blockers: PreviewView["blockers"] = [...v.blockers, ...(c.accepted ? [] : (["noKey"] as const)), ...(pending ? (["pending"] as const) : [])];
    return { ...v, blockers };
  }

  /** 輪の見え方。施設の鍵が 2 つあれば、相手から見たあなたまでを出し、束のバイト列は出さない */
  private ringView(ctx: Extract<Awaited<ReturnType<HumanService["shareContext"]>>, { ok: true }>, month: string): PreviewView {
    const v = previewCheckpoint(ctx.ring, { facility: ctx.facility, pair: ctx.sender.ok ? ctx.sender.pair : PLACEHOLDER_PAIR }, ctx.pack, ctx.plan, ctx.answers, month);
    if (!ctx.sender.ok) return { ...v, blockers: [...v.blockers, "keysForked"], bodyHash: null, bodyText: null, bytes: null };
    // 前に移したのに輪に失効の印が無い鍵が残っていれば送らない（作り直しの押し直しで直す）
    return unmarkedRetired(ctx.ring, ctx.facility).length > 0 && !v.blockers.includes("keyRetired") ? { ...v, blockers: [...v.blockers, "keyRetired"] } : v;
  }

  /** 検問所の文脈：確定したいちばん新しい版・パック・輪。足りなければ、何が足りないかと、聞くことを返す。 */
  private async shareContext(planId: string, ringId: string | null, answers: Answers) {
    const sd = this.e.stateDir!;
    const root = await this.root();
    const docs = await this.documents();
    const rings = readRings(sd).rings.map((r) => ({ ringId: r.ringId, root: r.root, pack: r.pack, synced: syncedOf(r.root, docs.syncRoots) }));
    const fail = (reason: string, extra: Record<string, unknown> = {}) => ({ ok: false as const, out: no(reason, { rings, ...extra }) });
    if (!root) return fail("noRoot");
    const h = await readHistory(root, planId);
    if (!h.latest) return fail("notConfirmed");
    // 確かめで合わない版（鎖・署名・作った署名）は、輪にも公開の台帳にも出さない。前に見た版や署名が消えていても出さない
    if (h.versions.at(-1)?.problem) return fail("historyBroken");
    if (checkSeen(this.e.stateDir!, root, planId, h)) return fail("historyVanished");
    const plan = h.latest.plan;
    const pack = this.pack(plan.packId);
    if (typeof pack === "string") return fail("packNotReady", { packReason: pack });
    const questions = questionsOf(pack, plan);
    const base = {
      plan: { planId, packId: plan.packId, version: h.latest.version, displayName: plan.displayName, fictional: plan.facility.fictional, inNationalTable: plan.facility.inNationalTable, profile: plan.facility.profile ?? null, pending: pendingDecisions(plan, h.accepted).length },
      questions,
      classNames: pack.classNames,
      axes: pack.axes,
      rings,
      packName: pack.name,
    };
    if (ringId === null) return fail("noRingChosen", base);
    const entry = rings.find((r) => r.ringId === ringId);
    if (!entry || entry.pack !== plan.packId) return fail("noRing", base);
    const ring = await loadRing(sd, ringId, pack, ownKeysAt(root, ringId));
    if (!ring.ok) return fail(ring.reason, base);
    // 束に署名する鍵は施設のもの（保管先の計画のフォルダ。まだ無ければメモリの鍵で見せ、送ったときに書く）
    const facility: Facility = { root, planId };
    const sender: FacilityKey = facilityKey(facility, ringId, this.pendingKeys);
    const info = {
      ...base,
      ring: {
        ...entry,
        key: sender.ok ? keyIdOf(sender.pair.pub) : null,
        // 今の鍵の ID（鍵が 2 つあれば両方。署名鍵を作り直すダイアログが見せ、作り直す経路が照らす）
        // 作り直しで照らす鍵（前に移したのに輪に印が無い鍵も。経路が照らす鍵と同じ関数）
        keys: rotateKeysOf(ring, facility),
        // 再発行のダイアログに出す鍵番号と作成月（鍵 ID は出さない。Wire）。当施設の失効した鍵の数（今の鍵の右に「失効 n」）
        keyInfo: rotateKeysOf(ring, facility).map((k) => keyInfoOf(ring, facility, k)),
        retiredCount: retiredKeys(facility, ringId).size,
        fingerprint: sender.ok ? fingerprint(sender.pair.pub) : null,
        folder: join(entry.root, ringId),
        rulesChange: rulesChangeOf(ring),
      },
      ringCount: rings.length,
    };
    return { ok: true as const, ring, pack, plan, version: h.latest.version, info, answers, facility, sender };
  }
}
