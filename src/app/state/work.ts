// 施設ごとの作業中（mushitaro/moyai#82）：作業中のもの（資料の写し・資料の印・取り込みの答え・作業中の計画・確定のシートの確定）を、
// 変わるたびに間を置いてまとめて、橋渡しへ送り、保管先の plans/<計画ID>/work/ に残す（src/bridge/work.ts）。
// - 保存のボタンと「保存しました」の文は置かない（人が保存の時を気にしなくてよい）。前の作業を戻す帯（IndexedDB の写し）は引いた。
// - 作業中は版ではない（署名も鎖も無い）。確定したあとは、次の版の作業中として続く（消さない。changed が false になる）。
// - 道は作業画面だけの経路（タブの秘密）。AI のツールの道には無い（ツールで作業画面が変わった結果が、ここから書かれるだけ）。
// - 写真も写す（資料の紐づきを切らない）。写真の読み取りの格子は写さない（タブにしか無い）。戻した写真は読み直しが要る状態で並ぶ。
// - 行の値・鍵は記録（console）に書かない。
import { aiDecisions } from "../../plan/diff";
import type { Plan } from "../../shared/plan";
import type { Decision } from "../../import/questions";
import type { DerivedFrom } from "../../shared/tools";
import { acceptedList, isAccepted, restoreAccepted, subscribeAccepted } from "./decisions";
import { clearWorkingPlan, getWorkingPlan, restoreWorkingPlan, subscribeWorkingPlan } from "./plan-store";
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
  /** 同じタブが今の作業で書いた仮の作業中（計画なし）を、新しい ID に移し終えたあとで、前の ID を片づける（橋渡しが確かめる） */
  move?(from: string, to: string, writer: string): Promise<{ ok: boolean; reason?: string }>;
}

export interface WorkFile {
  name: string;
  sha256: string;
  size: number;
  demo?: boolean;
  /** 加工したファイルの出どころ（#47） */
  derivedFrom?: DerivedFrom;
}

export interface WorkState {
  schema: typeof WORK_SCHEMA;
  /** 書いたタブの印（タブごとの乱数。前の形の作業中には無い） */
  writer?: string;
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
  /** 加工したファイルの出どころ（#47） */
  derivedOf(name: string): DerivedFrom | null;
  /** 今の施設の計画 ID（作業中の計画がまだ無いときの、作業中の置き場所） */
  facilityKey(): string;
  /** 落とした資料（写真も）のバイト列と SHA-256。skipped は写さなかった資料の数（今は 0） */
  sourcesForWork(): Promise<{ files: { name: string; bytes: Uint8Array; sha256: string }[]; skipped: number }>;
  /** 資料の並びが変わるたびに進む数 */
  readonly filesVersion: number;
  /** 資料の印（デモ・出どころ）が変わるたびに進む数 */
  readonly marksVersion: number;
  subscribe(fn: () => void): () => void;
  pinPlanId(id: string): void;
  restoreWork(
    base: number | null,
    files: readonly { name: string; bytes: Uint8Array }[],
    decisions: readonly Decision[],
    demo: readonly string[],
    hasPlan?: boolean,
    derived?: readonly { name: string; derivedFrom: DerivedFrom }[],
  ): Promise<void>;
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
  /** 計画 ID と資料の並びの版 → 送った資料の写し（同じ資料は送り直さない） */
  private sent: { key: string; files: WorkFile[]; skipped: number } | null = null;
  /** 置いた資料の SHA-256（計画 ID ごと。失敗のあとも、送れたものは送り直さない） */
  private uploaded = new Set<string>();
  /** 戻すたびに進む（戻す前に始まった書き込みは、書かずに捨てる） */
  private generation = 0;
  /**
   * このタブで書いてよい作業中（計画 ID）。このタブで作り始めた作業中か、戻した作業中だけ。
   * 保管先にほかの作業中（確定していない変更か未確定がある）が残っていれば、人が戻すか消すまで上書きしない（#82 の見直し）
   */
  private owned = new Set<string>();
  /** 人が消した作業中（このタブにまだ残っていても、戻すまで書き直さない） */
  private discarded = new Set<string>();
  /** このタブが、保管先に無かったところから書き始めた作業中（戻した作業中・ほかのタブの作業中は入らない） */
  private created = new Set<string>();
  /**
   * 計画を作る前にこのタブが書いた仮の作業中（資料を入れたあとにパックが決まると、計画 ID が替わる）。
   * 次に別の ID へ書けたら、読み直して資料がそろっているのを確かめてから、前の ID を片づける（移す。資料の紐づきを切らない）
   */
  private provisional: { planId: string; generation: number; files: string[] } | null = null;
  /** このタブの印（作業中に書く。同じタブが書いた写しだけを移すため） */
  readonly writer = tabWriterId();
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
    const gen = this.generation;
    const w = getWorkingPlan();
    if (w && w.origin !== "intake") return;
    const ws = this.o.ws;
    // 計画をまだ作っていなくても、資料が入っていれば資料と答えを残す（資料の紐づきを切らない）
    // Skillパックは無くてよい（パックなしで読む。#67）。施設の名前が無ければ、置き場所が決まらないので書かない
    if (!w && (ws.fileNames.length === 0 || !ws.settings.facilityName.trim())) return;
    const planId = w ? w.plan.planId : ws.facilityKey();
    // 計画と資料が別の施設のもの（版を開いている途中など）なら書かない。混ぜた作業中で、よい作業中を上書きしない
    if (w && w.plan.planId !== ws.facilityKey()) return;
    if (this.discarded.has(planId)) return;
    if (!this.owned.has(planId)) {
      const there = await this.o.port.read(planId);
      if (there && (there.changed || there.open > 0)) return;
      this.owned.add(planId);
      if (!there) this.created.add(planId);
    }
    const names = ws.fileNames;
    const key = `${planId}\u0000${ws.filesVersion}\u0000${ws.marksVersion}\u0000${names.join("\u0000")}`;
    if (this.sent?.key !== key) {
      const src = names.length > 0 ? await ws.sourcesForWork() : { files: [], skipped: 0 };
      const demo = new Set(names.filter((n) => !ws.userFileNames.includes(n)));
      const files: WorkFile[] = [];
      for (const f of src.files) {
        const id = `${planId}\u0000${f.sha256}`;
        if (!this.uploaded.has(id)) {
          const r = await this.o.port.putSource(planId, f.bytes);
          if (!r.ok) return;
          this.uploaded.add(`${planId}\u0000${r.sha256}`);
        }
        const from = ws.derivedOf(f.name);
        files.push({ name: f.name, sha256: f.sha256, size: f.bytes.length, ...(demo.has(f.name) ? { demo: true } : {}), ...(from ? { derivedFrom: from } : {}) });
      }
      this.sent = { key, files, skipped: src.skipped };
    }
    if (gen !== this.generation || this.paused > 0) return;
    const accepted = acceptedList();
    const state: WorkState = {
      schema: WORK_SCHEMA,
      writer: this.writer,
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
    const r = await this.o.port.save(state);
    if (!r.ok) return;
    await this.moveProvisional(planId, gen);
    // 計画を作る前に、このタブが書き始めた作業中は仮の写し（あとでパックが決まって ID が替われば移す）
    this.provisional = !w && this.created.has(planId) ? { planId, generation: gen, files: state.files.map((f) => f.sha256) } : this.provisional?.planId === planId ? null : this.provisional;
  }

  /** 仮の写しを、今書いた ID に移し終えていれば、前の ID を片づける（読み直して、前の資料がすべて新しい写しにあるときだけ） */
  private async moveProvisional(planId: string, gen: number): Promise<void> {
    const p = this.provisional;
    if (!p || p.planId === planId || !this.o.port.move) return;
    if (p.generation !== gen) {
      this.provisional = null;
      return;
    }
    const back = await this.o.port.read(planId);
    if (!back || back.writer !== this.writer) return;
    const have = new Set(back.files.map((f) => f.sha256));
    if (!p.files.every((x) => have.has(x))) return;
    const m = await this.o.port.move(p.planId, planId, this.writer);
    if (!m.ok) return;
    this.owned.delete(p.planId);
    this.created.delete(p.planId);
    this.provisional = null;
  }

  /** 人が作業中を消した（トップの「作業中を消す」）。このタブに残っていても、戻すまで書き直さない */
  forget(planId: string): void {
    this.discarded.add(planId);
    this.owned.delete(planId);
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
    this.generation++;
    this.provisional = null;
    try {
      const ws = this.o.ws;
      ws.settings = { ...s.settings };
      ws.pinPlanId(planId);
      await ws.restoreWork(
        s.base,
        files,
        s.decisions,
        s.files.filter((f) => f.demo).map((f) => f.name),
        s.plan !== null,
        s.files.flatMap((f) => (f.derivedFrom ? [{ name: f.name, derivedFrom: f.derivedFrom }] : [])),
      );
      if (s.plan) restoreWorkingPlan(s.plan, "intake", s.proposals, s.base);
      else clearWorkingPlan();
      restoreAccepted(s.accepted);
      this.sent = { key: `${planId}\u0000${ws.filesVersion}\u0000${ws.marksVersion}\u0000${ws.fileNames.join("\u0000")}`, files: s.files, skipped: s.skipped };
      for (const f of s.files) this.uploaded.add(`${planId}\u0000${f.sha256}`);
      this.owned.add(planId);
      this.discarded.delete(planId);
    } finally {
      this.paused--;
    }
    return { ok: true, state: s };
  }
}

/** タブごとの印（乱数 16 バイトを base64url で） */
function tabWriterId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
