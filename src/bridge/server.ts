// 橋渡し（moyai start）：1 プロセス、127.0.0.1 の 1 ポート。
// HTTP は許可の一覧（src/shared/routes.ts）の経路だけを受け、WebSocket はタブ 1 つだけを受ける。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { errorBody, httpStatus, type ErrorCode } from "../shared/errors";
import { HEADER_RELAY_KEY, HEADER_TAB_SECRET, ROUTES, matchRoute, type HumanAction, type RouteDef, type RouteId } from "../shared/routes";
import { isToolName, toolDef } from "../shared/tools";
import { checkFetchSite, checkHost, checkOrigin } from "./guard";
import { makeEd25519Sample } from "./selftest";
import { removeKeyFile, writeKeyFile } from "./state";
import { loadStatic } from "./static";
import { DEAD_MS, HEARTBEAT_MS, HELLO_TIMEOUT_MS, TabHub } from "./tab";
import { TOKEN_TTL_MS, TokenStore } from "./tokens";

export const DEFAULT_PORT = 43110;
export const BIND_HOST = "127.0.0.1";

export interface BridgeOptions {
  /** 待ち受けるポート。0 は試験だけ（空きを OS が選ぶ） */
  port: number;
  /** ビルドした画面のフォルダ（dist/app） */
  staticDir: string;
  /** 鍵ファイルを書く状態フォルダ。null なら書かない（試験） */
  stateDir: string | null;
  heartbeatMs?: number;
  deadMs?: number;
  helloTimeoutMs?: number;
  tokenTtlMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface Bridge {
  port: number;
  url: string;
  relayKey: string;
  tabs: TabHub;
  tokens: TokenStore;
  close(): Promise<void>;
}

export class BridgeStartError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly port: number,
  ) {
    super(code);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
};

function csp(port: number): string {
  // Mantine は style の要素を差し込むので、style だけ unsafe-inline を許す。スクリプトは自分のファイルだけ。
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data:",
    `connect-src 'self' ws://127.0.0.1:${port} ws://localhost:${port}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

type Ctx = { req: IncomingMessage; res: ServerResponse; route: RouteDef; url: URL };
type RouteHandler = (ctx: Ctx) => Promise<void> | void;

export async function startBridge(opts: BridgeOptions): Promise<Bridge> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? (() => {});
  const tokenTtlMs = opts.tokenTtlMs ?? TOKEN_TTL_MS;
  const tokens = new TokenStore(tokenTtlMs, now);
  const tabs = new TabHub({
    tokens,
    heartbeatMs: opts.heartbeatMs ?? HEARTBEAT_MS,
    deadMs: opts.deadMs ?? DEAD_MS,
    helloTimeoutMs: opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS,
    tokenTtlMs,
    now,
    log,
  });
  const relayKey = randomBytes(32).toString("base64url");
  let port = opts.port;

  const sendJson = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra });
    res.end(JSON.stringify(body));
  };
  const reject = (res: ServerResponse, code: ErrorCode) => sendJson(res, httpStatus(code), errorBody(code));

  const readJson = async (req: IncomingMessage, max: number): Promise<{ value: unknown } | ErrorCode> => {
    const type = String(req.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "application/json") return "content_type_not_allowed";
    const declared = Number(req.headers["content-length"] ?? "0");
    if (declared > max) return "body_too_large";
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > max) return "body_too_large";
      chunks.push(c as Buffer);
    }
    try {
      return { value: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
    } catch {
      return "bad_json";
    }
  };

  const header = (req: IncomingMessage, name: string): string | undefined => {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  };

  const handlers: { [K in RouteId]: RouteHandler } = {
    app: async ({ res, url }) => serveStatic(res, url.pathname),
    assets: async ({ res, url }) => serveStatic(res, url.pathname),
    selftestEd25519: ({ res }) => sendJson(res, 200, makeEd25519Sample()),
    // WebSocket の経路に、Upgrade の無い GET が来たとき
    ws: ({ res }) => reject(res, "method_not_allowed"),
    relayTool: async ({ req, res, route }) => {
      // 中継はブラウザではない。Origin や Sec-Fetch-Site があるのは、ブラウザのページからの要求なので断る
      if (header(req, "origin") !== undefined) return reject(res, "origin_not_allowed");
      if (header(req, "sec-fetch-site") !== undefined) return reject(res, "fetch_site_not_allowed");
      const key = header(req, HEADER_RELAY_KEY);
      const a = Buffer.from(String(key ?? ""), "utf8");
      const b = Buffer.from(relayKey, "utf8");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return reject(res, "relay_key_mismatch");
      const body = await readJson(req, route.maxBody ?? 0);
      if (typeof body === "string") return reject(res, body);
      const { name, args } = (body.value ?? {}) as { name?: unknown; args?: unknown };
      if (typeof name !== "string" || !isToolName(name)) return reject(res, "unknown_tool");
      if (!toolDef(name).input.safeParse(args ?? {}).success) return reject(res, "invalid_input");
      // v0：どのツールも名前と型だけ。呼ばれたら「未実装」と型どおりに返す
      return reject(res, "not_implemented");
    },
    commitTrial: async ({ req, res, route }) => {
      // 人だけの経路。Origin・Sec-Fetch-Site・タブの秘密・1 回きりの印のすべてを求める
      const host = header(req, "host");
      const o = checkOrigin(header(req, "origin"), host, port, true);
      if (o) return reject(res, o);
      const s = checkFetchSite(header(req, "sec-fetch-site"), false);
      if (s) return reject(res, s);
      const tab = tabs.checkSecret(header(req, HEADER_TAB_SECRET));
      if (typeof tab === "string") return reject(res, tab);
      const body = await readJson(req, route.maxBody ?? 0);
      if (typeof body === "string") return reject(res, body);
      const { token, payload } = (body.value ?? {}) as { token?: unknown; payload?: unknown };
      if (typeof payload !== "string") return reject(res, "bad_json");
      const hash = createHash("sha256").update(payload, "utf8").digest("hex");
      const t = tokens.consume(typeof token === "string" ? token : undefined, route.action as HumanAction, hash, tab.session);
      if (t) return reject(res, t);
      log("確定の試しの経路を通りました（何も変えていません）");
      return sendJson(res, 200, { ok: true, action: route.action, changed: false });
    },
  };

  async function serveStatic(res: ServerResponse, pathname: string) {
    const file = await loadStatic(opts.staticDir, pathname);
    if (!file) return reject(res, "route_not_allowed");
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      "Content-Type": file.type,
      "Cache-Control": file.immutable ? "public, max-age=31536000, immutable" : "no-store",
      ...(file.type.startsWith("text/html") ? { "Content-Security-Policy": csp(port) } : {}),
    });
    res.end(file.body);
  }

  const server = createServer(async (req, res) => {
    try {
      const host = header(req, "host");
      const h = checkHost(host, port);
      if (h) return reject(res, h);
      const url = new URL(req.url ?? "/", `http://${host}`);
      const m = matchRoute(req.method ?? "", url.pathname);
      if (m.id === null) return reject(res, m.pathKnown ? "method_not_allowed" : "route_not_allowed");
      const route: RouteDef = ROUTES[m.id];
      if (route.kind === "static" || route.kind === "public" || route.kind === "ws") {
        const o = checkOrigin(header(req, "origin"), host, port, false);
        if (o) return reject(res, o);
        const s = checkFetchSite(header(req, "sec-fetch-site"), true);
        if (s) return reject(res, s);
      }
      await handlers[m.id]({ req, res, route, url });
    } catch {
      if (!res.headersSent) reject(res, "internal");
      else res.destroy();
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const host = header(req, "host");
    const url = new URL(req.url ?? "/", "http://x");
    const bad =
      (url.pathname !== ROUTES.ws.path && "route_not_allowed") ||
      checkHost(host, port) ||
      checkOrigin(header(req, "origin"), host, port, true) ||
      checkFetchSite(header(req, "sec-fetch-site"), false);
    if (bad) {
      socket.end(`HTTP/1.1 ${httpStatus(bad)} Refused\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => tabs.accept(ws));
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (e: NodeJS.ErrnoException) => {
      server.off("listening", onListening);
      reject(e.code === "EADDRINUSE" || e.code === "EACCES" ? new BridgeStartError("port_in_use", opts.port) : e);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ port: opts.port, host: BIND_HOST, exclusive: true });
  });
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : opts.port;
  tabs.start();

  if (opts.stateDir) {
    writeKeyFile(opts.stateDir, { version: 1, port, key: relayKey, pid: process.pid, startedAt: new Date(now()).toISOString() });
  }

  return {
    port,
    url: `http://${BIND_HOST}:${port}/`,
    relayKey,
    tabs,
    tokens,
    close: async () => {
      tabs.stop();
      for (const c of wss.clients) c.terminate();
      wss.close();
      if (opts.stateDir) removeKeyFile(opts.stateDir, relayKey);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
