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
import { commitPlan, planDir, readHistory, revertPlan, signLatest, PLAN_ID, type ExportCatalogs, type Signer } from "../plan/store";
import { TURN_SCHEMA, handoffMail, readTurn, writeTurn } from "../plan/turn";
import { validName } from "../plan/signature";
import { confirmKey, countsForApproval, createOwnKey, openOwnKey, ownKeys, trustList, trustOf } from "./people";
import { approvedReadingVersions, listReadings, loadedOf, registerReading } from "./readings";
import { catalogFromPack } from "../plan/chart";
import type { HumanAction } from "../shared/routes";
import { createRing, loadRing, monthOf, previewCheckpoint, questionsOf, sendCheckpoint, verifyRing, type Answers } from "../share/checkpoint";
import { loadSharePack, PACK_ID, type SharePack } from "../share/pack";
import { POSITIONS, PROFILE_FROM, compare, defaultAxes, receiverProfile } from "../share/receive";
import { loadLedgerPlace, loadPlaces } from "../share/receive-load";
import { peerAggregates } from "../share/peer-reference";
import { RECEIVE_MIN_K } from "../share/k";
import { HEX16, HEX64, fingerprint } from "../share/sign";
import { readFileSync, readdirSync } from "node:fs";
import {
  defaultRoot,
  detectDocuments,
  readRings,
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
    /** 使った読み方（作業画面が当てていた下書きと承認済みの読み方）。確定のときに橋渡しが保管先に書き（同じ中身なら書き直さない）、道と版を版の記録に書く */
    readings: z.array(z.object({ skill: z.unknown(), by: z.string().max(40).nullable(), facilityKey: z.string().max(200).nullable() })).max(20).optional(),
  }),
  readings_read: z.object({}),
  plan_revert: z.object({ planId: planIdSchema, to: z.number().int().min(1), reason: z.string().max(500), basedOn: z.number().int().min(1).nullable(), passphrase: z.string().min(1).max(1000) }),
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

export class HumanService {
  private docs: DocumentsInfo | null = null;

  constructor(private readonly e: HumanEnv) {}

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
          const link = `${p.origin ?? "http://127.0.0.1:43110"}/#/merge?open=${encodeURIComponent(planId)}&v=${r.version}&h=${contentHash.slice(0, 16)}`;
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
        return { ok: true, documents: docs.documents, documentsSynced: docs.synced, defaultRoot: defaultRoot(docs), chosenRoot: s.root, root, rootSynced: root ? syncedOf(root, docs.syncRoots) : null, ledger: s.ledger, rings, packs: this.packs(), name: s.name, people: trustList(sd) };
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
        const report = await verifyRing(ctx.ring.entry.root, p.ringId, ctx.pack, ctx.ring.confirmed);
        return { ok: true, fileName: r.fileName, hash: r.hash, seq: r.seq, report };
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
        return { ok: true, report: await verifyRing(entry.root, p.ringId, pack, ring.confirmed) };
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
      plan: { planId, packId: plan.packId, version: h.latest.version, displayName: plan.displayName, fictional: plan.facility.fictional, inNationalTable: plan.facility.inNationalTable, pending: pendingDecisions(plan, h.accepted).length },
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
