// 前の作業の写し（PWA の仕事 pwa-v0）。作業中の計画（state/plan-store.ts）と、確定のシートで確定した行（state/decisions.ts）を、
// 変わるたびにブラウザの保存領域（IndexedDB）へ書く（1 秒の間に起きた変わりは 1 回の書き込みにまとめる）。
// 開いたときに写しが残っていれば、下の帯に「前の作業を戻す｜捨てる」を出し、人が選ぶ。施設（計画の ID）と版（もとにした版）が今の作業と違えば戻さない。
// 確定・署名したら消す。資料（取り込みの作業場、src/app/intake/）は書かない。
// 正本はタブのメモリのまま。写しの中身はログにも console にも出さない。
import { useSyncExternalStore } from "react";
import { z } from "zod";
import type { Acceptance } from "../../plan/diff";
import type { CrosswalkProposal } from "../../plan/crosswalk";
import { Plan } from "../../shared/plan";
import { ruleSchema } from "../../shared/tools";
import { acceptedList, restoreAccepted, subscribeAccepted } from "./decisions";
import { getWorkingPlan, restoreWorkingPlan, subscribeWorkingPlan, type WorkingPlan } from "./plan-store";

/** 写しの形の名前。形を変えたら上げる（違う形の写しは戻さない） */
export const DRAFT_SCHEMA = "moyai.draft/0";
/** 変わってから書くまでの間（この間の変わりは 1 回の書き込みにまとめる） */
export const DRAFT_DELAY_MS = 1000;

const proposalSchema = z.object({
  ruleId: z.string(),
  target: z.enum(["assetNode", "work"]),
  value: z.string(),
  basis: z.string(),
  rule: ruleSchema,
  basedOnVersion: z.number(),
  matched: z.number(),
  conflicts: z.number(),
  examples: z.array(z.string()),
  state: z.enum(["proposed", "accepted", "rejected"]),
  humanReason: z.string().nullable(),
  sameAs: z.number().optional(),
});

const draftSchema = z.object({
  schema: z.literal(DRAFT_SCHEMA),
  savedAt: z.string(),
  /** 書いたときのビルドの印（記録だけ。戻すかどうかは施設と版で決める） */
  build: z.string(),
  working: z.object({
    plan: Plan,
    origin: z.literal("intake"),
    proposals: z.array(proposalSchema),
    base: z.number().int().min(0).nullable(),
  }),
  accepted: z.array(z.object({ id: z.string(), hash: z.string(), reason: z.string().min(1) })),
});

export interface Draft {
  schema: typeof DRAFT_SCHEMA;
  savedAt: string;
  build: string;
  working: { plan: Plan; origin: "intake"; proposals: CrosswalkProposal[]; base: number | null };
  accepted: Acceptance[];
}

/** 保存の口（IndexedDB。試験は差し替える） */
export interface DraftPort {
  read(): Promise<unknown>;
  write(d: Draft): Promise<void>;
  remove(): Promise<void>;
}

/** 読んだ値を写しとして読む。形が違えば null */
export function parseDraft(v: unknown): Draft | null {
  const r = draftSchema.safeParse(v);
  return r.success ? (r.data as Draft) : null;
}

/** 戻せない理由。facility：施設（計画の ID）が違う／version：もとにした版が違う／null：戻せる */
export type RestoreBlock = "facility" | "version" | null;

/** 今このタブに作業中の計画があれば、施設と版が写しと同じときだけ戻す（違うものを上書きしない） */
export function restoreBlock(d: Draft, now: Pick<WorkingPlan, "plan" | "base"> | null): RestoreBlock {
  if (!now) return null;
  if (now.plan.planId !== d.working.plan.planId) return "facility";
  if (now.base !== d.working.base) return "version";
  return null;
}

/** 今の作業から写しを作る。未確定のものが無ければ null（書かない） */
export function draftOf(w: WorkingPlan | null, accepted: readonly Acceptance[], build: string, at: Date): Draft | null {
  // 開発の見本（?plan=）は道から読み直せるので書かない
  if (!w || w.origin !== "intake") return null;
  // 保管先の版のままで、確定した行も無ければ、戻すものが無い
  if (w.stored && accepted.length === 0) return null;
  return {
    schema: DRAFT_SCHEMA,
    savedAt: at.toISOString(),
    build,
    working: { plan: w.plan, origin: "intake", proposals: w.proposals, base: w.base },
    accepted: [...accepted],
  };
}

export interface DraftKeeperOptions {
  port: DraftPort;
  build: string;
  delayMs?: number;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

export interface DraftView {
  /** 開いたときに見つけた写し（人が選ぶまで出す）。無ければ null */
  offer: Draft | null;
  /** 戻せない理由（今の作業と施設か版が違う） */
  block: RestoreBlock;
}

/**
 * 写しの番人。作業中の計画と確定した行の変わりを聞き、間を詰めて書く。
 * 開いたときに写しがあれば、人が「戻す」か「捨てる」を選ぶまで書かない（前の作業を黙って上書きしない）。
 */
export class DraftKeeper {
  private offer: Draft | null = null;
  private timer: unknown = null;
  /** 確定・署名した作業中の計画の回（この回のままなら書かない） */
  private settledRevision: number | null = null;
  /** 保存領域に今ある写しの計画の ID（無い・分からなければ null） */
  private storedPlanId: string | null = null;
  private view: DraftView = { offer: null, block: null };
  private readonly listeners = new Set<() => void>();
  private readonly unsub: (() => void)[] = [];
  private writing: Promise<void> = Promise.resolve();
  private readonly delayMs: number;
  private readonly now: () => Date;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (t: unknown) => void;
  /** 読み終えたか（読み終えるまでは書かない。前の写しを読む前に上書きしない） */
  private loaded = false;

  constructor(private readonly o: DraftKeeperOptions) {
    this.delayMs = o.delayMs ?? DRAFT_DELAY_MS;
    this.now = o.now ?? (() => new Date());
    this.setTimer = o.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = o.clearTimer ?? ((t) => clearTimeout(t as ReturnType<typeof setTimeout>));
  }

  /** 保存領域から前の写しを読み、変わりを聞き始める */
  async start(): Promise<void> {
    this.unsub.push(subscribeWorkingPlan(() => this.changed()), subscribeAccepted(() => this.changed()));
    let found: Draft | null = null;
    try {
      found = parseDraft(await this.o.port.read());
    } catch {
      // 読めなければ、戻すものは無いとして続ける（作業の画面は止めない）
      found = null;
    }
    this.offer = found;
    this.storedPlanId = found ? found.working.plan.planId : null;
    this.loaded = true;
    this.refresh();
    if (!this.offer) this.schedule();
  }

  stop(): void {
    for (const u of this.unsub.splice(0)) u();
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  /** 書き込みが済むまで待つ（試験用） */
  idle(): Promise<void> {
    return this.writing;
  }

  getView(): DraftView {
    return this.view;
  }

  subscribe(l: () => void): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** 前の作業を戻す。施設か版が違えば戻さず、その理由を返す */
  restore(): RestoreBlock | "none" {
    const d = this.offer;
    if (!d) return "none";
    const b = restoreBlock(d, getWorkingPlan());
    if (b) return b;
    this.offer = null;
    restoreWorkingPlan(d.working.plan, d.working.origin, d.working.proposals, d.working.base);
    restoreAccepted(d.accepted);
    this.refresh();
    this.schedule();
    return null;
  }

  /** 前の作業を捨てる（写しを消し、今の作業を書き始める） */
  async discard(): Promise<void> {
    if (!this.offer) return;
    this.offer = null;
    this.refresh();
    await this.removeStored();
    this.schedule();
  }

  /**
   * 確定・署名した（その計画の写しを消す）。保存領域にあるのがほかの施設の前の作業（まだ選んでいない写し）なら残す。
   * 確定した回の作業中の計画は、このあと変わるまで書かない（確定のダイアログを閉じるまで、確定の前の計画が残るため）。
   */
  async settle(planId: string): Promise<void> {
    if (this.offer && this.offer.working.plan.planId !== planId) return;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.settledRevision = getWorkingPlan()?.revision ?? null;
    this.offer = null;
    this.refresh();
    if (this.storedPlanId === null || this.storedPlanId === planId) await this.removeStored();
  }

  private changed(): void {
    this.refresh();
    this.schedule();
  }

  private refresh(): void {
    const block = this.offer ? restoreBlock(this.offer, getWorkingPlan()) : null;
    if (this.view.offer === this.offer && this.view.block === block) return;
    this.view = { offer: this.offer, block };
    for (const l of this.listeners) l();
  }

  private schedule(): void {
    if (!this.loaded || this.offer || this.timer !== null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush();
    }, this.delayMs);
  }

  private flush(): void {
    if (this.offer) return;
    const w = getWorkingPlan();
    const accepted = acceptedList();
    if (w && this.settledRevision !== null && w.revision === this.settledRevision && accepted.length === 0) return;
    const d = draftOf(w, accepted, this.o.build, this.now());
    // 未確定のものが無ければ書かない（前に書いた写しは、確定・署名・「捨てる」でだけ消す）
    if (!d) return;
    this.writing = this.writing.then(async () => {
      try {
        await this.o.port.write(d);
        this.storedPlanId = d.working.plan.planId;
      } catch {
        // 書けなくても作業は続ける（閉じる前の知らせは、写しとは別に出る）
      }
    });
  }

  private async removeStored(): Promise<void> {
    this.writing = this.writing.then(async () => {
      try {
        await this.o.port.remove();
        this.storedPlanId = null;
      } catch {
        // 消せなければ、次に開いたときにまた選んでもらう
      }
    });
    await this.writing;
  }
}

// ─── このタブの番人（App.tsx が置く） ──────────────────────────────

let keeper: DraftKeeper | null = null;

/** このタブの番人を置き、前の写しを読む（App.tsx。1 回だけ） */
export function installDraftKeeper(k: DraftKeeper): DraftKeeper {
  keeper?.stop();
  keeper = k;
  void k.start();
  return k;
}

/** 確定・署名したとき（確定のダイアログ・署名のダイアログ・前の版に戻す）。番人が無ければ何もしない */
export function settleDraft(planId: string): void {
  void keeper?.settle(planId);
}

const EMPTY: DraftView = { offer: null, block: null };
const subscribeView = (l: () => void): (() => void) => (keeper ? keeper.subscribe(l) : () => {});
const viewSnapshot = (): DraftView => (keeper ? keeper.getView() : EMPTY);

/** 下の帯が読む（番人が無ければ何も出さない） */
export function useDraftView(): DraftView {
  return useSyncExternalStore(subscribeView, viewSnapshot, () => EMPTY);
}

export function draftKeeper(): DraftKeeper | null {
  return keeper;
}

// ─── IndexedDB の口 ─────────────────────────────────────────────

const DB_NAME = "moyai";
const DB_VERSION = 1;
const STORE = "draft";
const KEY = "working";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error("IndexedDB"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB"));
  });
}

/** ブラウザの IndexedDB に 1 つだけ写しを置く口。IndexedDB が無ければ null */
export function indexedDbPort(idb: IDBFactory | undefined = globalThis.indexedDB): DraftPort | null {
  if (!idb) return null;
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    if (!db) {
      const r = idb.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      db = req(r);
      db.catch(() => (db = null));
    }
    return db;
  };
  return {
    async read() {
      const tx = (await open()).transaction(STORE, "readonly");
      return req(tx.objectStore(STORE).get(KEY));
    },
    async write(d) {
      const tx = (await open()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(d, KEY);
      await done(tx);
    },
    async remove() {
      const tx = (await open()).transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(KEY);
      await done(tx);
    },
  };
}
