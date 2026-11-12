// 施設ごとの作業中（mushitaro/moyai#82）：作業中のもの（資料の写し・資料の印・取り込みの答え・作業中の計画・確定のシートの確定）を、
// 変わるたびに間を置いてまとめて、橋渡しへ送り、保管先の plans/<計画ID>/work/ に残す（src/bridge/work.ts）。
// - 保存のボタンと「保存しました」の文は置かない（人が保存の時を気にしなくてよい）。前の作業を戻す帯（IndexedDB の写し）は引いた。
// - 作業中は版ではない（署名も鎖も無い）。確定したあとは、次の版の作業中として続く（消さない。changed が false になる）。
// - 道は作業画面だけの経路（タブの秘密）。AI のツールの道には無い（ツールで作業画面が変わった結果が、ここから書かれるだけ）。
// - 写真の資料は写さない（写真の読み取りの格子はタブにしか無い。写さなかった数を skipped に書く）。
// - 行の値・鍵は記録（console）に書かない。
import { aiDecisions } from "../../plan/diff";
import type { Plan } from "../../shared/plan";
import type { Decision } from "../../import/questions";
import { acceptedList, isAccepted, restoreAccepted, subscribeAccepted } from "./decisions";
import { getWorkingPlan, restoreWorkingPlan, subscribeWorkingPlan } from "./plan-store";
import type { CrosswalkProposal } from "../../plan/crosswalk";

export const WORK_SCHEMA = "moyai.work/1";
/** 変わってから書くまでの間（続けて変わるときは、最後の変更から数える） */
export const WORK_DELAY_MS = 1500;

/** 橋渡しの道（試験は差し替える） */
export interface WorkPort {
  putSource(planId: string, bytes: Uint8Array): Promise<{ ok: true; sha256: string; size: number } | { ok: false; reason: string }>;
  save(state: WorkState): Promise<{ ok: boolean; reason?: string }>;
  read(planId: string): Promise<WorkState | null>;
  source(planId: string, sha256: string): Promise<Uint8Array | null>;
}

export interface WorkFile {
  name: string;
  sha256: string;
  size: number;
  demo?: boolean;
}

export interface WorkState {
  schema: typeof WORK_SCHEMA;
  savedAt: string;
  build: string;
  planId: string;
  displayName: string;
  fictional: boolean;
  open: number;
  changed: boolean;
  base: number | null;
  settings: { packId: string; facilityName: string; fiscalYearStartMonth: number; fictional: boolean };
  files: WorkFile[];
  skipped: number;
  decisions: Decision[];
  /** 作業中の計画（まだ作っていなければ null。資料と答えだけを残す） */
  plan: Plan | null;
  proposals: CrosswalkProposal[];
  accepted: { id: string; hash: string; reason: string }[];
}

/** 作業画面の取り込みの作業場のうち、作業中に要るところ（src/app/intake/workspace.ts） */
export interface WorkSource {
  settings: WorkState["settings"];
  readonly fileNames: string[];
  readonly userFileNames: string[];
  decisions(): Decision[];
  /** 今の施設の計画 ID（作業中の計画がまだ無いときの、作業中の置き場所） */
  facilityKey(): string;
  sourcesForCommit(): Promise<{ files: { name: string; bytes: Uint8Array; sha256: string }[] } | null>;
  subscribe(fn: () => void): () => void;
  pinPlanId(id: string): void;
  restoreWork(base: number | null, files: readonly { name: string; bytes: Uint8Array }[], decisions: readonly Decision[], demo: readonly string[]): Promise<void>;
}

/** 確定のシートで、まだ受けていない決定の数（トップの「未確定 n」） */
export function openCount(plan: Plan): number {
  return aiDecisions(plan).filter((d) => !isAccepted(d.id, d.hash)).length;
}

export class WorkKeeper {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();
  /** 戻している間は書かない（戻す途中の半端なものを書かない） */
  private paused = 0;
  /** 計画 ID と資料の名前の並び → 送った資料の写し（同じ資料は送り直さない） */
  private sent: { key: string; files: WorkFile[]; skipped: number } | null = null;
  private stops: (() => void)[] = [];

  constructor(
    private readonly o: {
      port: WorkPort;
      ws: WorkSource;
      build: string;
      delayMs?: number;
      now?: () => Date;
      setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
      clearTimer?: (t: ReturnType<typeof setTimeout>) => void;
    },
  ) {}

  start(): void {
    const changed = () => this.schedule();
    this.stops.push(subscribeWorkingPlan(changed), subscribeAccepted(changed), this.o.ws.subscribe(changed));
  }

  stop(): void {
    for (const s of this.stops.splice(0)) s();
    if (this.timer) (this.o.clearTimer ?? clearTimeout)(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.paused > 0) return;
    if (this.timer) (this.o.clearTimer ?? clearTimeout)(this.timer);
    this.timer = (this.o.setTimer ?? setTimeout)(() => {
      this.timer = null;
      void this.flush();
    }, this.o.delayMs ?? WORK_DELAY_MS);
  }

  /** 走っている書き込みが終わるのを待つ（試験と、閉じる前） */
  idle(): Promise<void> {
    return this.writing;
  }

  /** 今の作業中を書く（書く物が無ければ何もしない）。書き終わりを待てる */
  flush(): Promise<void> {
    this.writing = this.writing.then(() => this.write()).catch(() => {});
    return this.writing;
  }

  private async write(): Promise<void> {
    if (this.paused > 0) return;
    const w = getWorkingPlan();
    if (w && w.origin !== "intake") return;
    const ws = this.o.ws;
    // 計画をまだ作っていなくても、資料が入っていれば資料と答えを残す（資料の紐づきを切らない）
    // Skillパックは無くてよい（パックなしで読む。#67）。施設の名前が無ければ、置き場所が決まらないので書かない
    if (!w && (ws.fileNames.length === 0 || !ws.settings.facilityName.trim())) return;
    const planId = w ? w.plan.planId : ws.facilityKey();
    const names = ws.fileNames;
    const key = `${planId}\u0000${names.join("\u0000")}`;
    if (this.sent?.key !== key) {
      const src = names.length > 0 ? await ws.sourcesForCommit() : { files: [] };
      const demo = new Set(names.filter((n) => !ws.userFileNames.includes(n)));
      const files: WorkFile[] = [];
      for (const f of src?.files ?? []) {
        const r = await this.o.port.putSource(planId, f.bytes);
        if (!r.ok) return;
        files.push({ name: f.name, sha256: r.sha256, size: r.size, ...(demo.has(f.name) ? { demo: true } : {}) });
      }
      this.sent = { key, files, skipped: src ? 0 : names.length };
    }
    const accepted = acceptedList();
    const state: WorkState = {
      schema: WORK_SCHEMA,
      savedAt: (this.o.now ?? (() => new Date()))().toISOString(),
      build: this.o.build,
      planId,
      displayName: w ? w.plan.displayName : ws.settings.facilityName.trim(),
      fictional: w ? !!w.plan.facility.fictional : ws.settings.fictional,
      open: w ? openCount(w.plan) : 0,
      changed: !w || !w.stored || accepted.length > 0,
      base: w ? w.base : null,
      settings: { ...ws.settings },
      files: this.sent.files,
      skipped: this.sent.skipped,
      decisions: ws.decisions(),
      plan: w ? w.plan : null,
      proposals: w ? w.proposals : [],
      accepted,
    };
    await this.o.port.save(state);
  }

  /**
   * 作業中を資料ごと戻す（トップの「作業中」→「続きから開く」）。資料が 1 つでも読めなければ戻さない（理由を返す）。
   * 戻したものは、次の変更からまた書く
   */
  async restore(planId: string): Promise<{ ok: true; state: WorkState } | { ok: false; reason: "missing" | "source" }> {
    const s = await this.o.port.read(planId);
    if (!s) return { ok: false, reason: "missing" };
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const f of s.files) {
      const b = await this.o.port.source(planId, f.sha256);
      if (!b) return { ok: false, reason: "source" };
      files.push({ name: f.name, bytes: b });
    }
    this.paused++;
    try {
      const ws = this.o.ws;
      ws.settings = { ...s.settings };
      ws.pinPlanId(planId);
      await ws.restoreWork(
        s.base,
        files,
        s.decisions,
        s.files.filter((f) => f.demo).map((f) => f.name),
      );
      if (s.plan) restoreWorkingPlan(s.plan, "intake", s.proposals, s.base);
      restoreAccepted(s.accepted);
      this.sent = { key: `${planId}\u0000${ws.fileNames.join("\u0000")}`, files: s.files, skipped: s.skipped };
    } finally {
      this.paused--;
    }
    return { ok: true, state: s };
  }
}

let keeper: WorkKeeper | null = null;
export function installWorkKeeper(k: WorkKeeper): void {
  keeper?.stop();
  keeper = k;
  k.start();
}
export function workKeeper(): WorkKeeper | null {
  return keeper;
}
