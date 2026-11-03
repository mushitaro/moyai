// 人だけの経路の処理（確定・版・設定・輪と鍵・検問所）。ここに来るのは、server.ts の guardHuman
// （Origin・Sec-Fetch-Site・タブの秘密・操作と中身のハッシュに結んだ 1 回きりの印）を通ったものだけ。
// どれも MCP のツールにしない（src/shared/tools.ts に無い）。答えは JSON。断るときは { ok: false, reason }。
// 合言葉・鍵・計画の中身をログに出さない。
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { pendingDecisions } from "../plan/diff";
import { commitPlan, readHistory, revertPlan, PLAN_ID, type ExportCatalogs } from "../plan/store";
import { catalogFromPack } from "../plan/chart";
import type { HumanAction } from "../shared/routes";
import { createRing, loadRing, monthOf, previewCheckpoint, questionsOf, sendCheckpoint, verifyRing, type Answers } from "../share/checkpoint";
import { loadSharePack, PACK_ID, type SharePack } from "../share/pack";
import { POSITIONS, PROFILE_FROM, compare, defaultAxes, receiverProfile } from "../share/receive";
import { loadPlaces } from "../share/receive-load";
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
  }),
  plan_revert: z.object({ planId: planIdSchema, to: z.number().int().min(1), reason: z.string().max(500), basedOn: z.number().int().min(1).nullable() }),
  settings_read: z.object({}),
  settings_save: z.object({ root: z.string().max(1000).nullable(), ledger: z.string().max(1000).nullable().optional() }),
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

export class HumanService {
  private docs: DocumentsInfo | null = null;

  constructor(private readonly e: HumanEnv) {}

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
        return { ok: true, root, synced: await this.syncedOfPath(root), versions: h.versions, latest: h.latest ? { version: h.latest.version, plan: h.latest.plan } : null, accepted: h.accepted };
      }
      case "plan_commit": {
        const p = parsePayload("plan_commit", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const r = await commitPlan({ root, plan: p.plan, reason: p.reason, acceptances: p.acceptances, basedOn: p.basedOn, client: call.session, now, catalogs: (id) => this.catalogsFor(id) });
        if (!r.ok) return no(r.reason, r.pending !== undefined ? { pending: r.pending } : {});
        return { ok: true, version: r.version, plan: r.record.plan, summary: r.record.summary, files: r.files };
      }
      case "plan_revert": {
        const p = parsePayload("plan_revert", call.payload);
        if (!p) return no("payloadInvalid");
        const root = await this.root();
        if (!root) return no("noRoot");
        const r = await revertPlan({ root, planId: p.planId, to: p.to, reason: p.reason, basedOn: p.basedOn, client: call.session, now, catalogs: (id) => this.catalogsFor(id) });
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
        return { ok: true, documents: docs.documents, documentsSynced: docs.synced, defaultRoot: defaultRoot(docs), chosenRoot: s.root, root, rootSynced: root ? syncedOf(root, docs.syncRoots) : null, ledger: s.ledger, rings, packs: this.packs() };
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
        writeSettings(sd, { v: 1, root, ledger });
        return { ok: true, root, ledger };
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
