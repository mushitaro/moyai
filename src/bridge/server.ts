// 橋渡し（moyai start）：1 プロセス、127.0.0.1 の 1 ポート。
// HTTP は許可の一覧（src/shared/routes.ts）の経路だけを受け、WebSocket はタブ 1 つだけを受ける。
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { errorBody, httpStatus, type ErrorCode } from "../shared/errors";
import {
  HEADER_RELAY_KEY,
  HEADER_TAB_SECRET,
  ROUTES,
  matchRoute,
  type HumanAction,
  type HumanRouteId,
  type RouteDef,
  type RouteId,
} from "../shared/routes";
import { EXPOSED_TOOL_NAMES, isToolName, toolDef, type ToolKind } from "../shared/tools";
import { approvedReadingVersions, listReadings, registerReading } from "./readings";
import { countsForApproval, trustOf } from "./people";
import type { SignatureInfo } from "../plan/store";
import { ToolRelay } from "./tools";
import { checkFetchSite, checkHost, checkOrigin } from "./guard";
import { HumanService, type HumanEnv } from "./human";
import { makeEd25519Sample } from "./selftest";
import { removeKeyFile, writeKeyFile } from "./state";
import { loadStatic } from "./static";
import { DEAD_MS, HEARTBEAT_MS, HELLO_TIMEOUT_MS, TabHub } from "./tab";
import { TOKEN_TTL_MS, TokenStore } from "./tokens";
import { resolvePacksDir } from "../share/pack";

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
  /** 作業画面を待つ上限（試験で短くするときだけ。既定は TOOL_TIMEOUTS） */
  toolTimeouts?: Partial<Record<ToolKind, number>>;
  now?: () => number;
  log?: (msg: string) => void;
  /** パックのフォルダ（共有の公開語彙・見え方・全国の表）。無ければリポジトリの packs/ */
  packsDir?: string;
  /** 人だけの経路の、外とつながる部品（Documents の調べ方・テキストエディタ）。試験は差し替える */
  human?: Pick<HumanEnv, "shell" | "platform" | "env" | "openText" | "github" | "githubClientId">;
}

export interface Bridge {
  port: number;
  url: string;
  relayKey: string;
  tabs: TabHub;
  tokens: TokenStore;
  tools: ToolRelay;
  close(): Promise<void>;
}

/** 待ち受けの誤りを、端末に出す誤りの型に読み替える。使われている → port_in_use、権限で断られた → port_denied。 */
export function listenErrorCode(e: { code?: string }): "port_in_use" | "port_denied" | null {
  if (e.code === "EADDRINUSE") return "port_in_use";
  if (e.code === "EACCES") return "port_denied";
  return null;
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
type HumanCtx = { session: string; action: HumanAction; payload: string };

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
  const human = new HumanService({ stateDir: opts.stateDir, packsDir: opts.packsDir ?? resolvePacksDir(), now, ...opts.human });
  // 読み方（3 段目の Skill）：保管先を読む・未承認の下書きを書く（決まり 1 の例外。承認は人の署名。docs/plan.md §2.17・§2.18.2）
  // 承認に数える署名：この PC が信じる鍵（自分の鍵か、確認済みの鍵）のものだけ（§2.18.2）
  const sd = opts.stateDir;
  const trusted = (x: SignatureInfo) => sd !== null && countsForApproval(trustOf(sd, x, new Date(now())));
  const tools = new ToolRelay(tabs, opts.toolTimeouts, {
    reading_skills_list: async (args) => {
      const root = await human.root();
      if (!root) return "no_reading_root";
      const list = await listReadings(root, await approvedReadingVersions(root, trusted));
      // 本文は頼まれたときだけ（保管先の SKILL.md の文。規則の 1 文と、人が手で書いた補い）
      return { skills: list.map(({ skill: _skill, text, ...x }) => (args.withText === true ? { ...x, text } : x)) };
    },
    // 似た施設：人が開いた比べはそのまま渡し、公開の台帳だけを読む頼みは橋渡しが台帳を読む（§2.18.4）
    peer_reference: async (fromTab) => {
      if (fromTab.mode !== "ledger") return fromTab;
      const a = fromTab.answers as { facility?: unknown; inNationalTable?: unknown } | null;
      const answers =
        a && typeof a === "object" && a.facility && typeof a.facility === "object"
          ? { facility: a.facility as Record<string, string | null>, inNationalTable: typeof a.inNationalTable === "boolean" ? a.inNationalTable : null }
          : null;
      return human.ledgerReference({
        packId: String(fromTab.packId),
        facility: (fromTab.facility as { scale: number | null; scaleUnit: string | null } | null) ?? null,
        answers,
        ...(typeof fromTab.commonItem === "string" ? { commonItem: fromTab.commonItem } : {}),
      });
    },
    reading_skill_register: async (fromTab) => {
      const root = await human.root();
      if (!root) return "no_reading_root";
      const w = await registerReading(root, fromTab.skill, typeof fromTab.by === "string" ? fromTab.by : null, typeof fromTab.facilityKey === "string" ? fromTab.facilityKey : null);
      if (!w.ok) return "tab_bad_result";
      const approved = (await approvedReadingVersions(root, trusted)).has(w.version);
      return { path: w.path, version: w.version, approved, rules: w.rules };
    },
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

  /** 中継の経路の守り：ブラウザでないこと、鍵ファイルの鍵が合うこと。 */
  const guardRelay = (req: IncomingMessage): ErrorCode | null => {
    // 中継はブラウザではない。Origin や Sec-Fetch-Site があるのは、ブラウザのページからの要求なので断る
    if (header(req, "origin") !== undefined) return "origin_not_allowed";
    if (header(req, "sec-fetch-site") !== undefined) return "fetch_site_not_allowed";
    const a = Buffer.from(String(header(req, HEADER_RELAY_KEY) ?? ""), "utf8");
    const b = Buffer.from(relayKey, "utf8");
    return a.length === b.length && timingSafeEqual(a, b) ? null : "relay_key_mismatch";
  };

  /**
   * 人だけの経路の守り。kind が human の経路は、処理の前に必ずここを通る（経路ごとに書かない）。
   * Origin・Sec-Fetch-Site・タブの秘密・1 回きりの印（操作の名前と中身のハッシュとタブの回に結ぶ）のすべてを求める。
   */
  const guardHuman = async (req: IncomingMessage, route: RouteDef): Promise<HumanCtx | ErrorCode> => {
    if (!route.requires?.tabSecret || !route.requires.oneTimeToken || !route.action) return "internal";
    const o = checkOrigin(header(req, "origin"), header(req, "host"), port, true);
    if (o) return o;
    const s = checkFetchSite(header(req, "sec-fetch-site"), false);
    if (s) return s;
    const tab = tabs.checkSecret(header(req, HEADER_TAB_SECRET));
    if (typeof tab === "string") return tab;
    const body = await readJson(req, route.maxBody ?? 0);
    if (typeof body === "string") return body;
    const { token, payload } = (body.value ?? {}) as { token?: unknown; payload?: unknown };
    if (typeof payload !== "string") return "bad_json";
    const hash = createHash("sha256").update(payload, "utf8").digest("hex");
    const t = tokens.consume(typeof token === "string" ? token : undefined, route.action, hash, tab.session);
    if (t) return t;
    return { session: tab.session, action: route.action, payload };
  };

  const handlers: { [K in Exclude<RouteId, HumanRouteId>]: RouteHandler } = {
    app: async ({ res, url }) => serveStatic(res, url.pathname),
    assets: async ({ res, url }) => serveStatic(res, url.pathname),
    selftestEd25519: ({ res }) => sendJson(res, 200, makeEd25519Sample()),
    // WebSocket の経路に、Upgrade の無い GET が来たとき
    ws: ({ res }) => reject(res, "method_not_allowed"),
    relayTool: async ({ req, res, route }) => {
      const g = guardRelay(req);
      if (g) return reject(res, g);
      const body = await readJson(req, route.maxBody ?? 0);
      if (typeof body === "string") return reject(res, body);
      const { name, args, conversation } = (body.value ?? {}) as { name?: unknown; args?: unknown; conversation?: unknown };
      if (typeof name !== "string" || !isToolName(name) || !(EXPOSED_TOOL_NAMES as string[]).includes(name)) {
        return reject(res, "unknown_tool");
      }
      const parsed = toolDef(name).input.safeParse(args ?? {});
      if (!parsed.success) return reject(res, "invalid_input");
      // 会話は中継の 1 つの接続。中継が付けない呼び出しは 1 つの会話にまとめて数える
      const conv = typeof conversation === "string" && /^[A-Za-z0-9-]{1,64}$/.test(conversation) ? conversation : "none";
      const answer = await tools.run(name, parsed.data as Record<string, unknown>, conv);
      return "ok" in answer ? sendJson(res, 200, answer) : reject(res, answer.error.code);
    },
  };

  /** 人だけの経路の処理。ここに来るのは guardHuman を通ったものだけ。 */
  // 確定・設定・輪と鍵・検問所の処理は src/bridge/human.ts（同じ守りを通ったあとで呼ぶ）
  const delegate = async (res: ServerResponse, h: HumanCtx) => sendJson(res, 200, await human.handle(h));
  const humanHandlers: { [K in HumanRouteId]: (res: ServerResponse, h: HumanCtx) => void | Promise<void> } = {
    commitTrial: (res, h) => {
      // 確定の試し：中身は何もしない。守りの形を試験するための経路
      log("確定の試しの経路を通りました（何も変えていません）");
      sendJson(res, 200, { ok: true, action: h.action, changed: false });
    },
    planStatus: delegate,
    planCommit: delegate,
    planRevert: delegate,
    planFileRead: delegate,
    templatesRead: delegate,
    templateSave: delegate,
    exportSign: delegate,
    exportFileRead: delegate,
    planSign: delegate,
    requestReceive: delegate,
    requestRenew: delegate,
    plansList: delegate,
    planVersionRead: delegate,
    commentAdd: delegate,
    commentsList: delegate,
    personKeyCreate: delegate,
    personKeyConfirm: delegate,
    settingsRead: delegate,
    settingsSave: delegate,
    ringCreate: delegate,
    checkpointPreview: delegate,
    checkpointOpenText: delegate,
    checkpointSend: delegate,
    ringVerify: delegate,
    ringMemberConfirm: delegate,
    ringRulesAccept: delegate,
    // 公開の台帳へ出す（通信の例外：github.com と api.github.com だけ。PR を出すのは人がボタンを押したときだけ）
    ledgerPreview: delegate,
    ledgerSend: delegate,
    ledgerPrs: delegate,
    githubConnectStart: delegate,
    githubConnectState: delegate,
    githubDisconnect: delegate,
    peersCompare: delegate,
    readingsRead: delegate,
    // 写真を AI クライアントに渡す許し：タブの回と、渡す画像のハッシュに結んでメモリに置く（中身の画像は受けない）
    photoAllow: (res, h) => sendJson(res, 200, tools.allowPhoto(h.session, h.payload)),
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
        const s = checkFetchSite(header(req, "sec-fetch-site"), true, route.kind === "static" ? { method: req.method ?? "", mode: header(req, "sec-fetch-mode"), dest: header(req, "sec-fetch-dest") } : undefined);
        if (s) return reject(res, s);
      }
      if (route.kind === "human") {
        const h = await guardHuman(req, route);
        if (typeof h === "string") return reject(res, h);
        return await humanHandlers[m.id as HumanRouteId](res, h);
      }
      await handlers[m.id as Exclude<RouteId, HumanRouteId>]({ req, res, route, url });
    } catch {
      if (!res.headersSent) reject(res, "internal");
      else res.destroy();
    }
  });

  // ツールの結果（星取表の行 200 行など）がタブから来るので、中継の経路の上限と同じ 1 MB まで受ける
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
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
      const code = listenErrorCode(e);
      reject(code ? new BridgeStartError(code, opts.port) : e);
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
    tools,
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
