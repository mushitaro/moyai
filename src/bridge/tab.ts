// タブとの WebSocket。タブは 1 つだけ受ける。あとから開いたタブが引き継ぎ、前のタブには「ほかのタブに移った」と知らせて閉じる
// （11-07。前は 2 つ目を断っていたので、Claude が開いたタブが使えず、利用者に前のタブを閉じてもらうしかなかった）。
// 最初の握手でページが作ったタブの秘密を登録する。15 秒ごとに生存を確かめ、45 秒答えが無ければ切れたと見なす。
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import { errorBody, type TabErrorCode, type TabSentCode } from "../shared/errors";
import type { PhotoImage, ToolName } from "../shared/tools";
import { decodeEvent, encodeEvent, type BridgeToTab, type EventData, type TabToBridge } from "../shared/events";
import type { TokenStore } from "./tokens";

export const HEARTBEAT_MS = 15_000;
export const DEAD_MS = 45_000;
export const HELLO_TIMEOUT_MS = 10_000;
/** 作業のある前のタブが今も答えるかを確かめる待ち（#46）。この間に何か届けば前のタブを残し、あとから開いたタブを断る */
export const PROBE_MS = 1_500;

/** 閉じるときの番号（4000 番台は使い手が決めてよい） */
export const CLOSE_REFUSED = 4001;
export const CLOSE_DEAD = 4002;

interface ActiveTab {
  ws: WebSocket;
  secret: Buffer;
  session: string;
  lastSeen: number;
  /** タブのビルドの commit（tab.hello） */
  build: string;
  /** 作業（資料か作業中の計画）があるか（tab.hello と tab.work。送らない前の版のタブは false） */
  work: boolean;
  /** 最後にこのタブから何かが届いた時刻（lastSeen と違い、呼び出しの時間切れでは進めない） */
  heard: number;
}

export interface TabHubOptions {
  tokens: TokenStore;
  heartbeatMs: number;
  deadMs: number;
  helloTimeoutMs: number;
  /** 前のタブが今も答えるかを確かめる待ち（既定 PROBE_MS） */
  probeMs?: number;
  tokenTtlMs: number;
  /** 橋渡しのビルドの commit。前のビルドのままのタブは、あとから開いたタブに渡す */
  build?: string;
  now: () => number;
  log: (msg: string) => void;
}

interface Conn {
  ws: WebSocket;
  active: ActiveTab | null;
  /** 握手を受け、前のタブを確かめている（2 回目の握手と、握手の時間切れを無視する） */
  probing?: boolean;
}

type Handler<T extends TabToBridge> = (hub: TabHub, conn: Conn, data: EventData<T>) => void;

/**
 * タブにツールを渡した結果。no_tab は渡せなかった、no_answer は時間切れか途中で閉じた（渡したかもしれない）。
 * ok の session は答えたタブの回（写真の許しはこの回に結ぶ）。image は photo_transcribe の receive だけが添える。
 */
export type TabCallOutcome =
  | { kind: "ok"; data: Record<string, unknown>; session: string; image?: PhotoImage }
  | { kind: "error"; code: TabSentCode }
  | { kind: "no_tab" }
  | { kind: "no_answer"; reason: "timeout" | "closed" };

interface PendingCall {
  name: ToolName;
  ws: WebSocket;
  session: string;
  timer: NodeJS.Timeout;
  resolve: (o: TabCallOutcome) => void;
}

/** タブ → 橋渡しのイベントの受け手。tests/contract/ が、送り手のあるどのイベントにも受け手があることを数える。 */
export const TAB_EVENT_HANDLERS: { [K in TabToBridge]: Handler<K> } = {
  "tab.hello": (hub, conn, data) => hub.onHello(conn, data),
  "tab.pong": (hub, conn) => hub.onPong(conn),
  "tab.work": (hub, conn, data) => hub.onWork(conn, data),
  "tab.token_request": (hub, conn, data) => hub.onTokenRequest(conn, data),
  "tab.tool_result": (hub, conn, data) => hub.onToolResult(conn, data),
};

export class TabHub {
  private active: ActiveTab | null = null;
  /** 今のタブの回で、握手のあとに飛ばした読めない通信の数 */
  dropped = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly calls = new Map<string, PendingCall>();
  private callSeq = 0;

  constructor(private readonly o: TabHubOptions) {}

  start(): void {
    this.timer = setInterval(() => this.beat(), this.o.heartbeatMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.active?.ws.terminate();
    this.active = null;
    this.dropCalls(null);
  }

  /** 生きているタブがあるか */
  get connected(): boolean {
    return this.active !== null;
  }

  /** 今のタブの回（無ければ null）。資料を作業画面に入れるときの印をこの回に結ぶ */
  /** つながっているタブから最後に便りがあってからの時間（ミリ秒）。タブが無ければ null（眠ったタブは ping に答えないので伸びる） */
  get sinceSeen(): number | null {
    return this.active ? this.o.now() - this.active.lastSeen : null;
  }

  get session(): string | null {
    return this.active?.session ?? null;
  }

  /** HTTP の人だけの経路で、見出しの秘密を今のタブの秘密と比べる。合えばその回の印を返す。 */
  checkSecret(secret: string | undefined): { session: string } | TabErrorCode {
    if (!this.active) return "tab_not_open";
    if (!secret) return "secret_missing";
    const got = Buffer.from(secret, "utf8");
    if (got.length !== this.active.secret.length || !timingSafeEqual(got, this.active.secret)) return "secret_mismatch";
    return { session: this.active.session };
  }

  /** 新しい WebSocket（Host と Origin はもう確かめてある） */
  accept(ws: WebSocket): void {
    const conn: Conn = { ws, active: null };
    const helloTimer = setTimeout(() => {
      if (!conn.active && !conn.probing) this.refuse(conn, "hello_timeout");
    }, this.o.helloTimeoutMs);
    helloTimer.unref();

    ws.on("message", (raw, isBinary) => {
      const ev = isBinary ? null : decodeEvent(raw.toString("utf8"), "tab");
      if (!ev) {
        // 握手の前の不正は断る。握手のあとの不正は飛ばして数える（1 件の不正で全体を止めない）
        if (!conn.active) return this.refuse(conn, "hello_invalid");
        this.dropped++;
        this.o.log(`タブからの読めない通信を飛ばしました（計 ${this.dropped} 件）`);
        return;
      }
      if (!conn.active && ev.type !== "tab.hello") return this.refuse(conn, "hello_invalid");
      if (conn.active) conn.active.lastSeen = conn.active.heard = this.o.now();
      const handler = TAB_EVENT_HANDLERS[ev.type as TabToBridge] as Handler<TabToBridge> | undefined;
      handler?.(this, conn, ev.data as EventData<TabToBridge>);
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (conn.active && this.active === conn.active) {
        this.o.tokens.dropSession(conn.active.session);
        this.active = null;
        this.dropCalls(conn.ws);
        this.o.log("作業画面のタブが閉じました");
      }
    });
    ws.on("error", () => ws.terminate());
  }

  onHello(conn: Conn, data: EventData<"tab.hello">): void {
    if (conn.active || conn.probing) return; // 2 回目の握手は無視する
    const prev = this.active;
    // 作業画面は 1 つ（#46）：作業（資料か作業中の計画）のある生きたタブがあれば、あとから開いたタブを断る（「別のタブで開いています」）。
    // 前のタブの作業はタブのメモリにあり、引き継ぐと消えるので。Claude がブラウザを操作する道具で開いたタブも、ここで断られる。
    // 引き継ぐのは、前のタブに作業が無い・前のビルドのまま（更新のあとの読み込み直し）・同じタブのつなぎ直し（同じ秘密）・
    // 確かめの ping に PROBE_MS の間に何も返さない（読み込み直した・固まった・閉じかけのタブ）とき
    if (prev && this.keepsPrevious(prev, data)) {
      conn.probing = true;
      const asked = this.o.now();
      this.send(prev.ws, "bridge.ping", { at: asked });
      const t = setTimeout(() => {
        conn.probing = false;
        if (conn.ws.readyState !== conn.ws.OPEN) return;
        if (this.active === prev && prev.heard >= asked && prev.ws.readyState === prev.ws.OPEN) {
          this.o.log("作業のあるタブが開いているので、あとから開いたタブを断りました");
          return this.refuse(conn, "tab_elsewhere");
        }
        this.takeOver(conn, data);
      }, this.o.probeMs ?? PROBE_MS);
      t.unref();
      return;
    }
    this.takeOver(conn, data);
  }

  /** あとから開いたこのタブが引き継ぐ。前のタブ（今もあれば）の待っている呼び出しは終え、前のタブには理由を送って閉じる */
  private takeOver(conn: Conn, data: EventData<"tab.hello">): void {
    const prev = this.active;
    if (prev) {
      this.active = null;
      this.dropCalls(prev.ws);
      this.send(prev.ws, "bridge.refused", { code: "tab_taken_over", message: errorBody("tab_taken_over").error.message });
      prev.ws.close(CLOSE_REFUSED, "tab_taken_over");
      this.o.log("あとから開いた作業画面のタブが引き継ぎました");
    }
    const now = this.o.now();
    const tab: ActiveTab = { ws: conn.ws, secret: Buffer.from(data.secret, "utf8"), session: randomUUID(), lastSeen: now, heard: now, build: data.build, work: data.work === true };
    conn.active = tab;
    this.active = tab;
    this.dropped = 0; // 数はタブの回ごと
    this.send(conn.ws, "bridge.welcome", {
      heartbeatMs: this.o.heartbeatMs,
      deadMs: this.o.deadMs,
      tokenTtlMs: this.o.tokenTtlMs,
    });
    this.o.log("作業画面のタブがつながりました");
  }

  /** 前のタブを残して、あとから開いたタブを断るか */
  private keepsPrevious(prev: ActiveTab, hello: EventData<"tab.hello">): boolean {
    if (!prev.work) return false;
    if (this.o.now() - prev.lastSeen > this.o.deadMs) return false;
    if (this.o.build && prev.build !== this.o.build) return false;
    const got = Buffer.from(hello.secret, "utf8");
    if (got.length === prev.secret.length && timingSafeEqual(got, prev.secret)) return false;
    return true;
  }

  onWork(conn: Conn, data: EventData<"tab.work">): void {
    if (conn.active) conn.active.work = data.work;
  }

  onPong(_conn: Conn): void {
    // lastSeen は受けたときに更新してある
  }

  onTokenRequest(conn: Conn, data: EventData<"tab.token_request">): void {
    if (!conn.active) return;
    const { token, expiresAt } = this.o.tokens.issue(data.action, data.payloadHash, conn.active.session);
    this.send(conn.ws, "bridge.token", { requestId: data.requestId, token, action: data.action, expiresAt });
  }

  /**
   * AI のツールを今のタブに 1 回だけ渡し、答えを待つ。送り直しはしない（読むものの送り直しは中継がする）。
   * 時間内に答えが来なければ no_answer。onUnknown が true なら、そのことをタブにも知らせる（画面に「結果不明」を出す）。
   */
  callTool(
    name: ToolName,
    args: Record<string, unknown>,
    conversation: string,
    rowsRemaining: number,
    timeoutMs: number,
    notifyUnknown: boolean,
  ): Promise<TabCallOutcome> {
    const tab = this.active;
    if (!tab) return Promise.resolve({ kind: "no_tab" });
    const requestId = `t${++this.callSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!this.calls.delete(requestId)) return;
        // 切れたと見なすまでの時間は、呼び出しの時間切れのあとから数える（重い処理の間は pong を返せないため。Architect の 63）
        if (this.active === tab) tab.lastSeen = Math.max(tab.lastSeen, this.o.now());
        if (notifyUnknown) this.send(tab.ws, "bridge.tool_unknown", { requestId, name });
        resolve({ kind: "no_answer", reason: "timeout" });
      }, timeoutMs);
      timer.unref();
      this.calls.set(requestId, { name, ws: tab.ws, session: tab.session, timer, resolve });
      this.send(tab.ws, "bridge.tool_call", { requestId, name, args, conversation, rowsRemaining });
    });
  }

  onToolResult(conn: Conn, data: EventData<"tab.tool_result">): void {
    const call = this.calls.get(data.requestId);
    // 時間切れのあとに来た答え・ほかのタブの答えは受けない（AI には返してある）
    if (!call || call.ws !== conn.ws) return;
    this.calls.delete(data.requestId);
    clearTimeout(call.timer);
    const r = data.result;
    call.resolve(r.ok ? { kind: "ok", data: r.data, session: call.session, ...(r.image ? { image: r.image } : {}) } : { kind: "error", code: r.code });
  }

  /** タブが閉じた・切れたとき、そのタブに渡して答えを待っているものを終える（ws が null ならすべて） */
  private dropCalls(ws: WebSocket | null): void {
    for (const [id, c] of this.calls) {
      if (ws && c.ws !== ws) continue;
      this.calls.delete(id);
      clearTimeout(c.timer);
      c.resolve({ kind: "no_answer", reason: "closed" });
    }
  }

  private beat(): void {
    const tab = this.active;
    if (!tab) return;
    // 待っているツールの呼び出しがある間は切らない（作業画面が重い処理で pong を返せないだけのことがある。Architect の 63）
    const waiting = [...this.calls.values()].some((c) => c.ws === tab.ws);
    if (!waiting && this.o.now() - tab.lastSeen > this.o.deadMs) {
      this.o.log("作業画面のタブから答えが無いので、切れたと見なしました");
      this.o.tokens.dropSession(tab.session);
      this.active = null;
      this.dropCalls(tab.ws);
      tab.ws.close(CLOSE_DEAD);
      tab.ws.terminate();
      return;
    }
    this.send(tab.ws, "bridge.ping", { at: this.o.now() });
  }

  private refuse(conn: Conn, code: TabErrorCode): void {
    const body = errorBody(code).error;
    this.send(conn.ws, "bridge.refused", { code, message: body.message });
    conn.ws.close(CLOSE_REFUSED, code);
  }

  private send<T extends BridgeToTab>(ws: WebSocket, type: T, data: EventData<T>): void {
    if (ws.readyState === ws.OPEN) ws.send(encodeEvent(type, data));
  }
}
