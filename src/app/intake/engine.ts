// 作業場（workspace.ts）から取り込みの受け手（intake-host.ts）への道。
// - SameThreadEngine：受け手を同じスレッドに置く（worker の無い所＝vitest の node）。同期でも読める。
// - WorkerEngine：受け手を worker に置く（画面のタブ）。通信は worker-protocol.ts の型だけで、答えは Promise で待つ。
//   worker が起きる前に落ちたら（読み込めない等）、同じ受け手を同じスレッドに置いて続ける（そのときは主のスレッドが止まる）。
//   起きたあとに worker が止まったら（terminate・落ちた。alive.ts の見張り）、待っている答えを誤りで終え、止まった知らせを出す。
import { IntakeHost } from "./intake-host";
import type { FromHost, IntakeRequest, ReplyOf, ToHost } from "./worker-protocol";

/** fallback：worker が起きずに同じスレッドで続けた／failed：受け手が答えなくなった（受け手の誤り・起きたあとに worker が止まった） */
export type EngineFault = "fallback" | "failed";

export interface IntakeEngine {
  /** 同じスレッドの受け手（同期で読める）。worker なら null */
  readonly local: IntakeHost | null;
  /** 答えを待たない要求（送った順に処理される） */
  post(req: IntakeRequest, v: number): void;
  /** 答えを待つ要求。transfer は worker へ移すバイト列（移したあと主のスレッドでは読めない） */
  request<R extends IntakeRequest>(req: R, v: number, transfer?: Transferable[]): Promise<ReplyOf<R>>;
  onFault(fn: (why: EngineFault) => void): void;
}

/** 同じスレッドの受け手（試験と、worker の無い所） */
export class SameThreadEngine implements IntakeEngine {
  constructor(readonly local: IntakeHost) {}

  post(req: IntakeRequest, v: number): void {
    if (req.op === "read" || req.op === "reset" || req.op === "commit") throw new Error(`答えを待たずに送れない要求：${req.op}`);
    this.local.applySync(req, v);
  }

  async request<R extends IntakeRequest>(req: R, v: number): Promise<ReplyOf<R>> {
    const r = await this.local.receive({ id: 1, v, req });
    if (!r || r.kind !== "reply") throw new Error("受け手の答えが無い");
    if (!r.ok) throw new Error(r.error);
    return r.reply as ReplyOf<R>;
  }

  onFault(): void {}
}

/** worker との通り道（ブラウザの Worker と、試験の node の worker_threads をそろえる） */
export interface IntakePort {
  post(msg: ToHost, transfer: Transferable[]): void;
  /**
   * on：受け手からの 1 通。fail：worker が落ちた（起きる前なら読み込めなかった）。
   * gone：起きたあとに worker が止まった（見張りの lock が離れた。alive.ts）。見張れない通り道は呼ばない
   */
  listen(on: (msg: FromHost) => void, fail: () => void, gone: () => void): void;
}

export class WorkerEngine implements IntakeEngine {
  readonly local = null;
  private seq = 0;
  private readonly waiting = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private ready = false;
  private dead = false;
  /** worker が起きるまで持っておく通信（起きなかったら、同じスレッドの受け手に渡す） */
  private held: { msg: ToHost; transfer: Transferable[] }[] = [];
  private fallbackHost: IntakeHost | null = null;
  private readonly faults = new Set<(why: EngineFault) => void>();

  constructor(
    private readonly port: IntakePort,
    /** worker が起きる前に落ちたときに、同じスレッドで使う受け手を作る。無ければ落ちたままにする */
    private readonly fallback: (() => IntakeHost) | null = null,
  ) {
    port.listen(
      (m) => this.onMessage(m),
      () => this.onFail(),
      () => this.onGone(),
    );
  }

  private onMessage(m: FromHost): void {
    if (m.kind === "ready") {
      if (this.ready) return;
      this.ready = true;
      const held = this.held;
      this.held = [];
      for (const h of held) this.port.post(h.msg, h.transfer);
      return;
    }
    if (m.id === 0) {
      if (!m.ok) this.fault("failed");
      return;
    }
    const w = this.waiting.get(m.id);
    if (!w) return;
    this.waiting.delete(m.id);
    if (m.ok) w.resolve(m.reply);
    else w.reject(new Error(m.error));
  }

  private onFail(): void {
    // 起きたあとの誤り（worker の中で捕まえていない例外）では止めない。受け手は要求ごとに誤りを答える
    if (this.ready || this.fallbackHost || this.dead) return;
    if (this.fallback) {
      // 起きる前に落ちた：持っておいた通信を、同じスレッドの受け手に順に渡す
      this.fallbackHost = this.fallback();
      const held = this.held;
      this.held = [];
      for (const h of held) this.toFallback(h.msg);
      this.fault("fallback");
      return;
    }
    this.dead = true;
    for (const w of this.waiting.values()) w.reject(new Error("取り込みの worker が止まった"));
    this.waiting.clear();
    this.fault("failed");
  }

  /** 起きたあとに worker が止まった：待っている答えを誤りで終え、そのあとの要求も受けない。止まった知らせ（failed）を 1 回だけ出す */
  private onGone(): void {
    if (this.dead || this.fallbackHost) return;
    this.dead = true;
    for (const w of this.waiting.values()) w.reject(new Error("取り込みの worker が止まった"));
    this.waiting.clear();
    this.fault("failed");
  }

  private toFallback(msg: ToHost): void {
    void this.fallbackHost?.receive(msg).then((r) => {
      if (r) this.onMessage(r);
    });
  }

  private fault(why: EngineFault): void {
    for (const f of this.faults) f(why);
  }

  private send(msg: ToHost, transfer: Transferable[]): void {
    if (this.fallbackHost) this.toFallback(msg);
    else if (!this.ready) this.held.push({ msg, transfer });
    else this.port.post(msg, transfer);
  }

  post(req: IntakeRequest, v: number): void {
    if (this.dead) return;
    this.send({ id: 0, v, req }, []);
  }

  request<R extends IntakeRequest>(req: R, v: number, transfer: Transferable[] = []): Promise<ReplyOf<R>> {
    if (this.dead) return Promise.reject(new Error("取り込みの worker が止まった"));
    const id = ++this.seq;
    return new Promise<ReplyOf<R>>((resolve, reject) => {
      this.waiting.set(id, { resolve: resolve as (r: unknown) => void, reject });
      try {
        this.send({ id, v, req }, transfer);
      } catch (e) {
        this.waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  onFault(fn: (why: EngineFault) => void): void {
    this.faults.add(fn);
  }
}

/**
 * 同じスレッドで、worker と同じ形（構造化複製・非同期の受け渡し）で受け手を動かす通り道。
 * 試験で、worker の側の道（写しを後から受ける・答えを待つ）を node のまま確かめるのに使う
 */
export function sameThreadPort(host: IntakeHost = new IntakeHost()): IntakePort {
  let deliver: (m: FromHost) => void = () => undefined;
  const later = (f: () => void) => setTimeout(f, 0);
  return {
    post(msg) {
      const copy = structuredClone(msg);
      later(() => {
        void host.receive(copy).then((r) => {
          if (r) {
            const back = structuredClone(r);
            later(() => deliver(back));
          }
        });
      });
    },
    listen(on) {
      deliver = on;
      later(() => on({ kind: "ready" }));
    },
  };
}
