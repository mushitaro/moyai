// タブの側の橋渡しとの往復。タブの秘密はここで作り、メモリだけに持つ（HTML にも URL にも入れない）。
// React を持たない純粋な TS にして、受け手の一覧（BRIDGE_EVENT_HANDLERS）を契約の試験から読めるようにする。
import { ERRORS, errorBodySchema, type TabErrorCode } from "../shared/errors";
import { decodeEvent, encodeEvent, type BridgeToTab, type EventData, type TabToBridge } from "../shared/events";
import { HEADER_TAB_SECRET, ROUTES, type HumanAction } from "../shared/routes";
import type { ToolName } from "../shared/tools";

export type ConnectionState =
  | { kind: "connecting" }
  | { kind: "open"; tokenTtlMs: number }
  | { kind: "refused"; code: TabErrorCode }
  | { kind: "reconnecting" }
  | { kind: "closed" };

type Handler<T extends BridgeToTab> = (client: BridgeClient, data: EventData<T>) => void;

export type ToolCallResult = EventData<"tab.tool_result">["result"];
/** AI のツールをこのタブで動かす処理（App が取り込みの作業場につなぐ） */
export interface ToolHandlers {
  call(name: ToolName, args: Record<string, unknown>, ctx: { conversation: string; rowsRemaining: number }): Promise<ToolCallResult>;
  /** 案を置くツールの答えが時間内に橋渡しへ届かず、AI に「結果不明」と返された */
  unknown(name: ToolName, requestId: string): void;
}

/** 橋渡し → タブのイベントの受け手。tests/contract/ が数える。 */
export const BRIDGE_EVENT_HANDLERS: { [K in BridgeToTab]: Handler<K> } = {
  "bridge.welcome": (c, d) => c.onWelcome(d),
  "bridge.refused": (c, d) => c.onRefused(d),
  "bridge.ping": (c, d) => c.onPing(d),
  "bridge.token": (c, d) => c.onToken(d),
  "bridge.tool_call": (c, d) => void c.onToolCall(d),
  "bridge.tool_unknown": (c, d) => c.onToolUnknown(d),
};

function randomSecret(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** 人だけの経路の答え。通れば橋渡しが返した中身（{ ok: false, reason } で断ることもある）を body に入れる。 */
export type HumanResult = { ok: true; body: unknown } | { ok: false; code: TabErrorCode | "network" };

/** 切れたあとのつなぎ直しの待ち（1・2・5・10 秒、そのあとは 10 秒ごと）と、あきらめるまでの時間（2 分） */
const RECONNECT_WAITS_MS = [1000, 2000, 5000, 10_000] as const;
const RECONNECT_GIVE_UP_MS = 120_000;

export class BridgeClient {
  private readonly secret = randomSecret();
  private ws: WebSocket | null = null;
  private state: ConnectionState = { kind: "connecting" };
  private readonly listeners = new Set<(s: ConnectionState, dropped: number) => void>();
  private readonly pending = new Map<string, (t: { token: string; expiresAt: number } | null) => void>();
  private seq = 0;
  private tools: ToolHandlers | null = null;
  /** 飛ばした、読めない通信の数 */
  dropped = 0;
  /** 続けてつなぎ直した回数（つながったら 0 に戻す） */
  private retries = 0;
  /** 切れた時刻（つながったら null） */
  private droppedAt: number | null = null;

  constructor(private readonly wsUrl: string) {}

  connect(): void {
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    ws.addEventListener("open", () => this.send("tab.hello", { secret: this.secret, build: __MOYAI_BUILD__.commit }));
    ws.addEventListener("message", (e) => this.receive(e.data));
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      for (const r of this.pending.values()) r(null);
      this.pending.clear();
      if (this.state.kind === "refused") return;
      // 切れたら、同じ秘密でつなぎ直す（1・2・5・10 秒…、2 分まで）。作業画面が重い処理で固まり、橋渡しが「切れた」と見なしたあとも、
      // 作業を続けられるように（撮影で、つながり直さずに止まった。Video の報告・Architect の 63、11-06）。断られたとき（2 つ目のタブなど）はつなぎ直さない。
      // 前の回のツールの呼び出しは返さない（橋渡しが時間切れで AI に返してある）
      const now = Date.now();
      this.droppedAt ??= now;
      if (now - this.droppedAt > RECONNECT_GIVE_UP_MS) {
        this.setState({ kind: "closed" });
        return;
      }
      this.setState({ kind: "reconnecting" });
      const wait = RECONNECT_WAITS_MS[Math.min(this.retries, RECONNECT_WAITS_MS.length - 1)]!;
      this.retries++;
      setTimeout(() => {
        if (this.ws === ws && this.state.kind === "reconnecting") this.connect();
      }, wait);
    });
  }

  /** 受けた通信を受け手に渡す。読めないものは飛ばして数え、画面に件数を出す（1 件の不正で全体を止めない）。 */
  receive(raw: unknown): void {
    const ev = typeof raw === "string" ? decodeEvent(raw, "bridge") : null;
    if (!ev) {
      this.dropped++;
      this.notify();
      return;
    }
    const h = BRIDGE_EVENT_HANDLERS[ev.type as BridgeToTab] as Handler<BridgeToTab> | undefined;
    h?.(this, ev.data as EventData<BridgeToTab>);
  }

  /** つながりの状態と、飛ばした通信の数を受ける。 */
  subscribe(fn: (s: ConnectionState, dropped: number) => void): () => void {
    this.listeners.add(fn);
    fn(this.state, this.dropped);
    return () => this.listeners.delete(fn);
  }

  onWelcome(d: EventData<"bridge.welcome">): void {
    this.retries = 0;
    this.droppedAt = null;
    this.setState({ kind: "open", tokenTtlMs: d.tokenTtlMs });
  }

  onRefused(d: EventData<"bridge.refused">): void {
    this.setState({ kind: "refused", code: d.code });
  }

  onPing(d: EventData<"bridge.ping">): void {
    this.send("tab.pong", { at: d.at });
  }

  onToken(d: EventData<"bridge.token">): void {
    const r = this.pending.get(d.requestId);
    this.pending.delete(d.requestId);
    r?.({ token: d.token, expiresAt: d.expiresAt });
  }

  setToolHandlers(h: ToolHandlers): void {
    this.tools = h;
  }

  async onToolCall(d: EventData<"bridge.tool_call">): Promise<void> {
    let result: ToolCallResult;
    try {
      result = this.tools ? await this.tools.call(d.name, d.args, { conversation: d.conversation, rowsRemaining: d.rowsRemaining }) : { ok: false, code: "tool_failed" };
    } catch {
      result = { ok: false, code: "tool_failed" };
    }
    this.send("tab.tool_result", { requestId: d.requestId, result });
  }

  onToolUnknown(d: EventData<"bridge.tool_unknown">): void {
    this.tools?.unknown(d.name, d.requestId);
  }

  /** 確かめのダイアログを開いたときに、その操作と中身に結んだ 1 回きりの印を求める。 */
  requestToken(action: HumanAction, payloadHash: string, timeoutMs = 10_000): Promise<{ token: string; expiresAt: number } | null> {
    const requestId = `r${++this.seq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        resolve(null);
      }, timeoutMs);
      this.pending.set(requestId, (t) => {
        clearTimeout(timer);
        resolve(t);
      });
      this.send("tab.token_request", { requestId, action, payloadHash });
    });
  }

  /** 人だけの経路を呼ぶ。タブの秘密を見出しに、印と中身を本文に入れる。 */
  async postHuman(path: string, token: string, payload: string): Promise<HumanResult> {
    let res: Response;
    try {
      res = await fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json", [HEADER_TAB_SECRET]: this.secret },
        body: JSON.stringify({ token, payload }),
        credentials: "omit",
        cache: "no-store",
      });
    } catch {
      return { ok: false, code: "network" };
    }
    const body: unknown = await res.json().catch(() => null);
    if (res.ok && body !== null && typeof body === "object" && typeof (body as { ok?: unknown }).ok === "boolean") return { ok: true, body };
    const err = errorBodySchema.safeParse(body);
    if (err.success && ERRORS[err.data.error.code].to === "tab") return { ok: false, code: err.data.error.code as TabErrorCode };
    return { ok: false, code: "internal" };
  }

  /**
   * AI が intake_add_files で入れる資料の中身を、橋渡しが渡した資料の印で取りに来る（タブの秘密が要る。印は 1 回きり）。
   * 取れなければ null（見つからない・読む間に変わった・切れた）。
   */
  async fetchIntakeFile(fileId: string): Promise<Uint8Array | null> {
    try {
      const res = await fetch(ROUTES.tabIntakeFile.path, {
        method: "POST",
        headers: { "content-type": "application/json", [HEADER_TAB_SECRET]: this.secret },
        body: JSON.stringify({ fileId }),
        credentials: "omit",
        cache: "no-store",
      });
      if (!res.ok || res.headers.get("content-type") !== "application/octet-stream") return null;
      return new Uint8Array(await res.arrayBuffer());
    } catch {
      return null;
    }
  }

  /** 人が押したその場で、中身に結んだ印をもらって人だけの経路を呼ぶ（印は 1 回きり）。 */
  async callHuman(action: HumanAction, path: string, payload: unknown): Promise<HumanResult> {
    const text = JSON.stringify(payload);
    const t = await this.requestToken(action, await sha256Hex(text));
    if (!t) return { ok: false, code: "token_missing" };
    return this.postHuman(path, t.token, text);
  }

  private setState(s: ConnectionState): void {
    this.state = s;
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn(this.state, this.dropped);
  }

  private send<T extends TabToBridge>(type: T, data: EventData<T>): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encodeEvent(type, data));
  }
}
