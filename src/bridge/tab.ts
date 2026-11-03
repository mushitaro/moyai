// タブとの WebSocket。タブは 1 つだけ受け、2 つ目は断って理由を出す。
// 最初の握手でページが作ったタブの秘密を登録する。15 秒ごとに生存を確かめ、45 秒答えが無ければ切れたと見なす。
import { randomUUID, timingSafeEqual } from "node:crypto";
import type { WebSocket } from "ws";
import { errorBody, type TabErrorCode } from "../shared/errors";
import { decodeEvent, encodeEvent, type BridgeToTab, type EventData, type TabToBridge } from "../shared/events";
import type { TokenStore } from "./tokens";

export const HEARTBEAT_MS = 15_000;
export const DEAD_MS = 45_000;
export const HELLO_TIMEOUT_MS = 10_000;

/** 閉じるときの番号（4000 番台は使い手が決めてよい） */
export const CLOSE_REFUSED = 4001;
export const CLOSE_DEAD = 4002;

interface ActiveTab {
  ws: WebSocket;
  secret: Buffer;
  session: string;
  lastSeen: number;
}

export interface TabHubOptions {
  tokens: TokenStore;
  heartbeatMs: number;
  deadMs: number;
  helloTimeoutMs: number;
  tokenTtlMs: number;
  now: () => number;
  log: (msg: string) => void;
}

interface Conn {
  ws: WebSocket;
  active: ActiveTab | null;
}

type Handler<T extends TabToBridge> = (hub: TabHub, conn: Conn, data: EventData<T>) => void;

/** タブ → 橋渡しのイベントの受け手。tests/contract/ が、送り手のあるどのイベントにも受け手があることを数える。 */
export const TAB_EVENT_HANDLERS: { [K in TabToBridge]: Handler<K> } = {
  "tab.hello": (hub, conn, data) => hub.onHello(conn, data),
  "tab.pong": (hub, conn) => hub.onPong(conn),
  "tab.token_request": (hub, conn, data) => hub.onTokenRequest(conn, data),
};

export class TabHub {
  private active: ActiveTab | null = null;
  /** 握手のあとに飛ばした、読めない通信の数 */
  dropped = 0;
  private timer: NodeJS.Timeout | null = null;

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
  }

  /** 生きているタブがあるか */
  get connected(): boolean {
    return this.active !== null;
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
      if (!conn.active) this.refuse(conn, "hello_timeout");
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
      if (conn.active) conn.active.lastSeen = this.o.now();
      const handler = TAB_EVENT_HANDLERS[ev.type as TabToBridge] as Handler<TabToBridge> | undefined;
      handler?.(this, conn, ev.data as EventData<TabToBridge>);
    });
    ws.on("close", () => {
      clearTimeout(helloTimer);
      if (conn.active && this.active === conn.active) {
        this.o.tokens.dropSession(conn.active.session);
        this.active = null;
        this.o.log("作業画面のタブが閉じました");
      }
    });
    ws.on("error", () => ws.terminate());
  }

  onHello(conn: Conn, data: EventData<"tab.hello">): void {
    if (conn.active) return; // 2 回目の握手は無視する
    if (this.active) return this.refuse(conn, "tab_already_open");
    const tab: ActiveTab = { ws: conn.ws, secret: Buffer.from(data.secret, "utf8"), session: randomUUID(), lastSeen: this.o.now() };
    conn.active = tab;
    this.active = tab;
    this.send(conn.ws, "bridge.welcome", {
      heartbeatMs: this.o.heartbeatMs,
      deadMs: this.o.deadMs,
      tokenTtlMs: this.o.tokenTtlMs,
    });
    this.o.log("作業画面のタブがつながりました");
  }

  onPong(_conn: Conn): void {
    // lastSeen は受けたときに更新してある
  }

  onTokenRequest(conn: Conn, data: EventData<"tab.token_request">): void {
    if (!conn.active) return;
    const { token, expiresAt } = this.o.tokens.issue(data.action, data.payloadHash, conn.active.session);
    this.send(conn.ws, "bridge.token", { requestId: data.requestId, token, action: data.action, expiresAt });
  }

  private beat(): void {
    const tab = this.active;
    if (!tab) return;
    if (this.o.now() - tab.lastSeen > this.o.deadMs) {
      this.o.log("作業画面のタブから答えが無いので、切れたと見なしました");
      this.o.tokens.dropSession(tab.session);
      this.active = null;
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
