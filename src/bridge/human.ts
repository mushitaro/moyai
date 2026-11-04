// 人だけの経路の処理（確定・版・設定・輪と鍵・検問所）。ここに来るのは、server.ts の guardHuman
// （Origin・Sec-Fetch-Site・タブの秘密・操作と中身のハッシュに結んだ 1 回きりの印）を通ったものだけ。
// どれも MCP のツールにしない（src/shared/tools.ts に無い）。答えは JSON。断るときは { ok: false, reason }。
// 合言葉・鍵・計画の中身をログに出さない。
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { pendingDecisions } from "../plan/diff";
import { commitPlan, planDir, readHistory, readPlanVersion, revertPlan, signLatest, PLAN_ID, type ExportCatalogs, type Signer } from "../plan/store";
import { COMMENT_MAX, addComment, readComments } from "../plan/comments";
import { TURN_SCHEMA, handoffMail, readTurn, writeTurn } from "../plan/turn";
import { validName } from "../plan/signature";
import { confirmKey, countsForApproval, createOwnKey, openOwnKey, ownKeys, trustList, trustOf } from "./people";
import { approvedReadingVersions, listReadings, loadedOf, registerReading } from "./readings";
import { catalogFromPack } from "../plan/chart";
import type { HumanAction } from "../shared/routes";
import { createRing, loadRing, monthOf, previewCheckpoint, previewPlace, questionsOf, sealPlace, sendCheckpoint, verifyRing, withSentInfo, type Answers, type PreviewView } from "../share/checkpoint";
import { LEDGER_PR_TEXT, checkAgainstLedger, ensureLedgerKey, ledgerBranch, ledgerBundlePath, ledgerKeyOf, ledgerPlace, ledgerProfileText, loadLedgerForSend, pendingSent } from "../share/ledger-send";
import { GITHUB_CLIENT_ID, githubClientIdOf, githubHostsOf, githubIo, openLedgerPr, pollDevice, prStatus, repoOfRemote, startDevice, whoAmI, type GitHubIo, type Repo } from "./github";
import { parseJsonStrict } from "../share/jcs";
import { loadSharePack, PACK_ID, type SharePack } from "../share/pack";
import { POSITIONS, PROFILE_FROM, compare, defaultAxes, receiverProfile } from "../share/receive";
import { loadLedgerPlace, loadPlaces } from "../share/receive-load";
import { peerAggregates } from "../share/peer-reference";
import { RECEIVE_MIN_K } from "../share/k";
import { HEX16, HEX64, WrongPassphrase, fingerprint, keyIdOf, sha256Hex, unwrapSecret, wrapSecret } from "../share/sign";
import { readFileSync, readdirSync } from "node:fs";
import {
  GITHUB_TOKEN_AAD,
  defaultRoot,
  detectDocuments,
  readGitHub,
  readLedgerSent,
  readRings,
  readSent,
  removeGitHub,
  writeGitHub,
  writeLedgerSent,
  readSettings,
  readWrappedKey,
  syncedOf,
  validRoot,
  writeSettings,
  type DocumentsInfo,
  type ShellRunner,
} from "./places";

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
}

/** GitHub につなぐ途中（デバイスフロー）。合言葉はつながるか終わるまでこのメモリだけに置き、どこにも書かない */
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
    /** 署名の鍵を開く合言葉（橋渡しが開き、署名したらすぐ捨てる。どこにも残さない） */
    passphrase: z.string().min(1).max(1000),
    /** 頼むこと（docs/screens.md 3.4）：自分で確定する・編集を頼む・承認を頼む。頼むときは宛先（メール）とひとこと */
    request: z.object({ kind: z.enum(["self", "edit", "approve"]), to: z.string().max(200).nullable(), note: z.string().max(1000) }).optional(),
    /** 受け取る人の MOYAI で版を開くリンクの頭（画面の origin。メールの文に入れる） */
    origin: z.string().max(200).optional(),
    /** ほかの施設の版から作った第 1 版のとき（トップの「この版から別の施設をつくる」） */
    derivedFrom: z.object({ planId: planIdSchema, version: z.number().int().min(1), contentHash: z.string().regex(/^[0-9a-f]{64}$/) }).nullable().optional(),
    /** 使った読み方（作業画面が当てていた下書きと承認済みの読み方）。確定のときに橋渡しが保管先に書き（同じ中身なら書き直さない）、道と版を版の記録に書く */
    readings: z.array(z.object({ skill: z.unknown(), by: z.string().max(40).nullable(), facilityKey: z.string().max(200).nullable() })).max(20).optional(),
  }),
  readings_read: z.object({}),
  plan_revert: z.object({ planId: planIdSchema, to: z.number().int().min(1), reason: z.string().max(500), basedOn: z.number().int().min(1).nullable(), passphrase: z.string().min(1).max(1000) }),
  plans_list: z.object({}),
  plan_version_read: z.object({ planId: planIdSchema, version: z.number().int().min(1) }),
  comment_add: z.object({
    planId: planIdSchema,
    version: z.number().int().min(0),
    row: z.object({ mode: z.enum(["ledger", "common"]), id: z.string().min(1).max(500), label: z.string().max(500) }).nullable(),
    text: z.string().max(COMMENT_MAX),
  }),
  comments_list: z.object({ planId: planIdSchema }),
  plan_sign: z.object({ planId: planIdSchema, version: z.number().int().min(1), role: z.enum(["approve", "return"]), reason: z.string().max(500), passphrase: z.string().min(1).max(1000) }),
  plan_file_read: z.object({ planId: planIdSchema, version: z.number().int().min(1), kind: z.enum(["export", "report"]) }),
  person_key_create: z.object({ passphrase: z.string().min(1).max(1000) }),
  person_key_confirm: z.object({ key: z.string().regex(/^[0-9a-f]{16}$/) }),
  settings_read: z.object({}),
  settings_save: z.object({ root: z.string().max(1000).nullable(), ledger: z.string().max(1000).nullable().optional(), name: z.string().max(40).nullable().optional() }),
  ring_create: z.object({ root: z.string().max(1000), packId: z.string().regex(PACK_ID), passphrase: z.string().max(1000) }),
  checkpoint_preview: z.object({ planId: planIdSchema, ringId: ringIdSchema.nullable(), answers: answersSchema }),
  checkpoint_open_text: z.object({ planId: planIdSchema, ringId: ringIdSchema, answers: answersSchema }),
  checkpoint_send: z.object({
    planId: planIdSchema,
    version: z.number().int().min(1),
    ringId: ringIdSchema,
    answers: answersSchema,
    previewHash: z.string().regex(HEX64),
    passphrase: z.string().max(1000),
  }),
  ring_verify: z.object({ ringId: ringIdSchema }),
  ledger_preview: z.object({ planId: planIdSchema, answers: answersSchema }),
  ledger_send: z.object({
    planId: planIdSchema,
    version: z.number().int().min(1),
    answers: answersSchema,
    previewHash: z.string().regex(HEX64),
    passphrase: z.string().max(1000),
  }),
  ledger_prs: z.object({ packId: z.string().regex(PACK_ID) }),
  github_connect_start: z.object({ packId: z.string().regex(PACK_ID), passphrase: z.string().max(1000) }),
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

export class HumanService {
  private docs: DocumentsInfo | null = null;
  private connecting: GitHubConnecting | null = null;

  constructor(private readonly e: HumanEnv) {}

  private githubIo(): GitHubIo {
    return this.e.github ?? githubIo(githubHostsOf(this.e.env ?? process.env));
  }

  private githubClientId(io: GitHubIo): string | null {
    if (this.e.githubClientId !== undefined) return this.e.githubClientId;
    return githubClientIdOf(GITHUB_CLIENT_ID, this.e.env ?? process.env, io.hosts);
  }

  /** 署名する人：設定の呼び名と、合言葉で開いた自分の鍵（署名したらすぐ捨てる。鍵も合言葉もどこにも残さない） */
  private signer(sd: string, passphrase: string): { ok: true; signer: Signer } | { ok: false; reason: "nameMissing" | "personKeyMissing" | "wrongPassphrase" } {
    const name = readSettings(sd).name;
    if (!name) return { ok: false, reason: "nameMissing" };
    const k = openOwnKey(sd, name, passphrase);
    if (!k.ok) return { ok: false, reason: k.reason };
    return { ok: true, signer: { by: name, pair: k.pair } };
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
  async ledgerReference(i: { packId: string; facility: { scale: number | null; scaleUnit: string | null } | null; answers: z.infer<typeof answersSchema> | null; commonItem?: string }): Promise<Record<string, unknown> | "no_ledger" | "ledger_pack_not_ready"> {
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
    const l = await loadLedgerPlace(s.ledger, pack);
    const c = compare({ table: pack.table, position: "municipal", profile: prof.profile, places: l.place ? [l.place] : [] });
    const out = peerAggregates(c, i.commonItem);
    return { mode: "ledger", position: c.position, floorK: RECEIVE_MIN_K, ...out, ledgerVersion, needs: [], reason: null };
  }

  private pack(id: string): SharePack | string {
    const l = loadSharePack(this.e.packsDir, id);
    return l.ok ? l.pack : l.reason;
  }

  private packs(): { id: string; name: string; ready: boolean; reason: string | null }[] {
    let ids: string[] = [];
    try {
      ids = readdirSync(this.e.packsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && PACK_ID.test(d.name))
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
        // 署名ごとに、この PC が覚えた鍵と照らした信じ方を添える（未確認の鍵は覚えるが、信じはしない）
        const versions = h.versions.map((v) => ({ ...v, signatures: v.signatures.map((x) => ({ ...x, trust: trustOf(sd, x, now), fingerprint: fingerprint(x.pub) })) }));
        const s = readSettings(sd);
        return {
          ok: true,
          root,
          synced: await this.syncedOfPath(root),
          versions,
          latest: h.latest ? { version: h.latest.version, plan: h.latest.plan } : null,
          // ひとつ前の版（確かめで合うときだけ）：承認を頼まれた人の星取表は、頼まれた版をこの版と比べる
          previous: h.previous && h.versions.find((v) => v.version === h.previous!.version)?.problem === null ? { version: h.previous.version, plan: h.previous.plan } : null,
          accepted: h.accepted,
          name: s.name,
          hasKey: s.name !== null && ownKeys(sd).some((k) => k.by === s.name),
          // 編集の番（渡す・承認・差し戻しで替わる）
          turn: await readTurn(root, p.planId),
        };
      }
      case "plan_commit": {
        const p = parsePayload("plan_commit", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd, p.passphrase);
        if (!signer.ok) return no(signer.reason);
        // 使った読み方を保管先に書き、道と版を版の記録に書く（この版に人が署名すると、その版の読み方が承認済みになる）。担当者の範囲の読み方は、署名する人の呼び名の下に置く
        const readingSkills: { name: string; path: string; version: string }[] = [];
        for (const x of p.readings ?? []) {
          const w = await registerReading(root, x.skill, x.by ?? signer.signer.by, x.facilityKey);
          if (!w.ok) return no("readingInvalid");
          readingSkills.push({ name: (x.skill as { name: string }).name, path: w.path, version: w.version });
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
          // リンクは受け取る人の MOYAI（既定のポート）で開く。送る人が --port を変えていても、その番号は載せない
          const link = `${HANDOFF_ORIGIN}/#/merge?open=${encodeURIComponent(planId)}&v=${r.version}&h=${contentHash.slice(0, 16)}`;
          mail = handoffMail({ name: r.record.plan.displayName, version: r.version, contentHash, kind: req.kind, to: req.to!.trim(), note: req.note, by, planId, link });
        }
        return { ok: true, version: r.version, plan: r.record.plan, summary: r.record.summary, files: r.files, mail };
      }
      case "plan_revert": {
        const p = parsePayload("plan_revert", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd, p.passphrase);
        if (!signer.ok) return no(signer.reason);
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
          const w = readWrappedKey(sd, r.ringId);
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
        return { ok: true, version: r.record.version, plan: r.record.plan, contentHash: r.contentHash, at: r.record.at };
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
              versions: h.versions.map((v) => ({
                version: v.version,
                at: v.at,
                contentHash: v.contentHash,
                roles: v.signatures.map((x) => x.role),
                // 版を作った人（確定か渡すの署名の呼び名）。トップの「ほかの人が持っていた間」に使う
                by: v.signatures.find((x) => x.role === "confirm" || x.role === "edit" || x.role === "revert")?.by ?? null,
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
      case "plan_sign": {
        const p = parsePayload("plan_sign", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const signer = this.signer(sd, p.passphrase);
        if (!signer.ok) return no(signer.reason);
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
        return { ok: true, version: r.version, role: r.role };
      }
      case "plan_file_read": {
        const p = parsePayload("plan_file_read", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        // 確かめで合う版だけ（署名と鎖が合わない版の書き出しは渡さない）
        const h = await readHistory(root, p.planId);
        const v = h.versions.find((x) => x.version === p.version);
        if (!v) return no("versionUnknown");
        if (v.problem !== null) return no("historyBroken");
        const n = String(p.version).padStart(6, "0");
        const file = join(planDir(root, p.planId), p.kind === "export" ? "exports" : "reports", p.kind === "export" ? `${n}-plan.xlsx` : `${n}-diff.xlsx`);
        let bytes: Buffer;
        try {
          bytes = await readFile(file);
        } catch {
          return no("fileMissing");
        }
        return { ok: true, version: p.version, kind: p.kind, base64: bytes.toString("base64") };
      }
      case "person_key_create": {
        const p = parsePayload("person_key_create", call.payload);
        if (!p) return no("payloadInvalid");
        const name = readSettings(sd).name;
        if (!name) return no("nameMissing");
        const r = createOwnKey(sd, name, p.passphrase, now);
        if (!r.ok) return no(r.reason);
        return { ok: true, name, key: r.key, fingerprint: r.fingerprint };
      }
      case "person_key_confirm": {
        const p = parsePayload("person_key_confirm", call.payload);
        if (!p) return no("payloadInvalid");
        return confirmKey(sd, p.key) ? { ok: true, key: p.key } : no("keyUnknown");
      }
      case "ring_create": {
        const p = parsePayload("ring_create", call.payload);
        if (!p) return no("payloadInvalid");
        const root = validRoot(p.root);
        if (!root) return no("rootInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const r = await createRing({ stateDir: sd, root, pack, passphrase: p.passphrase, now });
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
          const v = previewCheckpoint(sd, ctx.ring, ctx.pack, ctx.plan, p.answers, monthOf(now));
          if (!v.bodyText || !v.bodyHash) return no("noPreview");
          // 同期されない一時のフォルダに写す（施設名で検索して見つからないことを、人が自分で確かめられる）
          const file = join(tmpdir(), `moyai-preview-${v.bodyHash.slice(0, 16)}.json`);
          await writeFile(file, v.bodyText, "utf8");
          (this.e.openText ?? openWithEditor)(file);
          return { ok: true, file };
        }
        const view = previewCheckpoint(sd, ctx.ring, ctx.pack, ctx.plan, p.answers, monthOf(now));
        return { ok: true, ...ctx.info, view };
      }
      case "checkpoint_send": {
        const p = parsePayload("checkpoint_send", call.payload);
        if (!p) return no("payloadInvalid");
        const ctx = await this.shareContext(p.planId, p.ringId, p.answers);
        if (!ctx.ok) return ctx.out;
        if (ctx.version !== p.version) return no("versionChanged");
        const r = await sendCheckpoint(sd, ctx.ring, ctx.pack, ctx.plan, p.answers, monthOf(now), p.previewHash, p.passphrase, now);
        if (!r.ok) return no(r.reason);
        const report = withSentInfo(await verifyRing(ctx.ring.entry.root, p.ringId, ctx.pack, ctx.ring.confirmed), readSent(sd));
        return { ok: true, fileName: r.fileName, hash: r.hash, seq: r.seq, report };
      }
      case "ledger_preview": {
        const p = parsePayload("ledger_preview", call.payload);
        if (!p) return no("payloadInvalid");
        const c = await this.ledgerSendContext(p.planId);
        if (!c.ok) return c.out;
        const k = ledgerKeyOf(sd, c.L.id);
        const pend = k ? pendingSent(sd, c.L, k.entry.key) : null;
        const view = this.ledgerView(c, k, p.answers, monthOf(now), !!pend);
        return { ok: true, ...c.info, pending: pend ? { pr: pend.pr, url: pend.url } : null, view };
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
        const k = ledgerKeyOf(sd, c.L.id);
        const w = readWrappedKey(sd, c.L.id);
        if (!k || !w) return no("noKey");
        if (pendingSent(sd, c.L, k.entry.key)) return no("ledgerPending");
        let token: string;
        try {
          token = unwrapSecret(gh.token, p.passphrase, GITHUB_TOKEN_AAD);
        } catch (e) {
          if (e instanceof WrongPassphrase) return no("passphrase");
          throw e;
        }
        const s = sealPlace(ledgerPlace(sd, c.L, k), w, c.pack, c.plan, p.answers, monthOf(now), p.previewHash, p.passphrase);
        if (!s.ok) return no(s.reason);
        const bytes = new Uint8Array(Buffer.from(s.text, "utf8"));
        const seq = s.input.seq;
        const key = keyIdOf(s.input.pub);
        const path = ledgerBundlePath(key, seq, s.hash);
        const check = checkAgainstLedger(c.L, c.pack, path, bytes);
        if (!check.ok) return no("ledgerNg", { reasons: check.reasons });
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
        writeLedgerSent(sd, [
          ...readLedgerSent(sd),
          { ledgerId: c.L.id, key, seq, hash: s.hash, path, month: monthOf(now), at: now.toISOString(), repo: `${c.repo.owner}/${c.repo.name}`, pr: r.number, url: r.url, login: r.login, version: c.version, state: "open" },
        ]);
        return { ok: true, pr: r.number, url: r.url, path, hash: s.hash, seq, login: r.login };
      }
      case "ledger_prs": {
        const p = parsePayload("ledger_prs", call.payload);
        if (!p) return no("payloadInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const L = await loadLedgerForSend(readSettings(sd).ledger, pack);
        if (!L.ok) return no(`ledger.${L.reason}`);
        const io = this.githubIo();
        const all = readLedgerSent(sd);
        const mine = all.filter((e) => e.ledgerId === L.id);
        const prs = [];
        for (const e of mine.slice(-10).reverse()) {
          const [owner, name] = e.repo.split("/");
          const st = owner && name ? await prStatus(io, { owner, name }, e.pr) : null;
          if (st) e.state = st.state;
          prs.push({ pr: e.pr, url: e.url, seq: e.seq, at: e.at, version: e.version ?? null, login: e.login, status: st });
        }
        writeLedgerSent(sd, all);
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
        // 台帳の自分の鍵：あれば合言葉で開けるかを確かめ、無ければこの合言葉で作る（トークンも同じ合言葉で包む）
        const k = ensureLedgerKey(sd, L, pack, p.passphrase, now);
        if (!k.ok) return no(k.reason === "wrongPassphrase" ? "passphrase" : k.reason);
        const d = await startDevice(io, clientId);
        if (!d.ok) return no(`github.${d.reason}`);
        this.connecting?.stop();
        const passphrase = p.passphrase;
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
            writeGitHub(sd, { v: "moyai.github/0", login, token: wrapSecret(r.token, passphrase, GITHUB_TOKEN_AAD), connectedAt: new Date(this.e.now()).toISOString() });
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
        return { ok: true, userCode: d.userCode, verificationUri: d.verificationUri, expiresIn: d.expiresIn, keyCreated: k.created };
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
      case "ring_verify": {
        const p = parsePayload("ring_verify", call.payload);
        if (!p) return no("payloadInvalid");
        const entry = readRings(sd).rings.find((r) => r.ringId === p.ringId);
        if (!entry) return no("noRing");
        const pack = this.pack(entry.pack);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const ring = await loadRing(sd, p.ringId, pack);
        if (!ring.ok) return no(ring.reason);
        return { ok: true, report: withSentInfo(await verifyRing(entry.root, p.ringId, pack, ring.confirmed), readSent(sd)) };
      }
      case "readings_read": {
        if (!parsePayload("readings_read", call.payload)) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return { ok: true, root: null, readings: [] };
        const list = await listReadings(root, await approvedReadingVersions(root, (x) => countsForApproval(trustOf(sd, x, now))));
        return { ok: true, root, readings: loadedOf(list) };
      }
      case "peers_compare": {
        const p = parsePayload("peers_compare", call.payload);
        if (!p) return no("payloadInvalid");
        const pack = this.pack(p.packId);
        if (typeof pack === "string") return no("packNotReady", { packReason: pack });
        const s = readSettings(sd);
        const loaded = await loadPlaces({ stateDir: sd, ledgerRoot: s.ledger, pack });
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
    };
    const ledgerRoot = readSettings(sd).ledger;
    const L = await loadLedgerForSend(ledgerRoot, pack);
    if (!L.ok) return fail(`ledger.${L.reason}`, base);
    const repo: Repo | null = repoOfRemote(gitRemote(L.root));
    const k = ledgerKeyOf(sd, L.id);
    const info = { ...base, ledger: { id: L.id, repo: repo ? `${repo.owner}/${repo.name}` : null, key: k?.entry.key ?? null, fingerprint: k ? fingerprint(k.pub) : null } };
    return { ok: true as const, L, pack, plan, version: h.latest.version, repo, info };
  }

  /** 公開の台帳の見え方（鍵がまだ無ければ、相手から見たあなたまでを出し、束のバイト列は出さない） */
  private ledgerView(
    c: Extract<Awaited<ReturnType<HumanService["ledgerSendContext"]>>, { ok: true }>,
    k: ReturnType<typeof ledgerKeyOf>,
    answers: Answers,
    month: string,
    pending: boolean,
  ): PreviewView {
    const sd = this.e.stateDir!;
    const place = ledgerPlace(sd, c.L, k ?? { entry: { ledgerId: c.L.id, pack: c.pack.id, key: "0".repeat(16), acceptedRulesHash: sha256OfLedger(c.L), acceptedRules: c.L.rules, createdAt: "" }, pub: "0".repeat(64) });
    // 台帳では、出した束が審査中で clone にまだ無いのはふつうのこと（「消えた」ではない）。次の束を止めるのは pending
    const v = { ...previewPlace(place, c.pack, c.plan, answers, month), vanished: false };
    // 鍵がまだ無い：見え方と塊（鍵によらない）は見せるが、鍵の欄が仮なので、ハッシュは出さず送れない（画面は「出ていくもの」を出さない）
    if (!k) return { ...v, blockers: [...v.blockers, "noKey"], bodyHash: null, bytes: null };
    return pending ? { ...v, blockers: [...v.blockers, "pending"] } : v;
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
    const ring = await loadRing(sd, ringId, pack);
    if (!ring.ok) return fail(ring.reason, base);
    const w = readWrappedKey(sd, ringId);
    const info = { ...base, ring: { ...entry, key: ring.entry.key, fingerprint: w ? fingerprint(w.pub) : null, folder: join(entry.root, ringId) }, ringCount: rings.length };
    return { ok: true as const, ring, pack, plan, version: h.latest.version, info, answers };
  }
}
