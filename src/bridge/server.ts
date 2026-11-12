// 橋渡し（moyai start）：1 プロセス、127.0.0.1 の 1 ポート。
// HTTP は許可の一覧（src/shared/routes.ts）の経路だけを受け、WebSocket はタブ 1 つだけを受ける。
import { readSettings, validRoot } from "./places";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname } from "node:path";
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
import { EXPOSED_TOOL_NAMES, isToolName, sharePreviewFromTabSchema, toolDef, type ToolKind } from "../shared/tools";
import { approvedReadingVersions, listReadings, readingTextShown, registerReading } from "./readings";
import { countsForApproval, trustOf } from "./people";
import type { SignatureInfo } from "../plan/store";
import { ToolRelay } from "./tools";
import { listWork, readWork, readWorkSource, writeWork } from "./work";
import { putSource } from "./sources";
import { PLAN_ID } from "../plan/paths";
import { beginPrepare, checkUpdate, isReady, startAutoCheck, lastPrepare, preparing, readPointer, type UpdateEnv } from "./app-update";
import { checkFetchSite, checkHost, checkOrigin } from "./guard";
import { collectIntake, readIntakeFile, skillPacksText } from "./intake-files";
import ExcelJS from "exceljs";
import { templateShape } from "../plan/template-layout";
import { HumanService, type HumanEnv } from "./human";
import { makeEd25519Sample } from "./selftest";
import { removeKeyFile, writeKeyFile } from "./state";
import { loadStatic } from "./static";
import { DEAD_MS, HEARTBEAT_MS, HELLO_TIMEOUT_MS, TabHub } from "./tab";
import { TOKEN_TTL_MS, TokenStore } from "./tokens";
import { resolvePacksDir } from "../share/pack";
import { createWindowArranger, type ScriptRunner } from "./window-arrange";

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
  /** 作業のある前のタブが今も答えるかを確かめる待ち（#46。試験は短くする） */
  probeMs?: number;
  tokenTtlMs?: number;
  /** 作業画面を待つ上限（試験で短くするときだけ。既定は TOOL_TIMEOUTS） */
  toolTimeouts?: Partial<Record<ToolKind, number>>;
  now?: () => number;
  log?: (msg: string) => void;
  /** パックのフォルダ（共有の公開語彙・見え方・全国の表）。無ければリポジトリの packs/ */
  packsDir?: string;
  /** 人だけの経路の、外とつながる部品（Documents の調べ方・テキストエディタ）。試験は差し替える */
  human?: Pick<HumanEnv, "shell" | "platform" | "env" | "openText" | "github" | "githubClientId" | "ledgerIntake">;
  /** リポジトリの根（intake_add_files はこの中のフォルダを読まない）。無ければパックのフォルダの上 */
  repoRoot?: string;
  /** 作業画面を既定のブラウザで開く手（moyai start が渡す。無ければ work_screen_open は opened: false、自動で開くこともしない） */
  openUrl?: (url: string) => void;
  /** intake_survey（show: true）で開いたタブを待つ上限（試験で短くするときだけ。既定は SCREEN_OPEN_WAIT_MS） */
  screenOpenWaitMs?: number;
  /** 止める合図（moyai uninstall か、古い版の橋渡しを替える中継）が来たとき（moyai start はプロセスを終える）。無ければ橋渡しを閉じるだけ */
  onStopRequest?: () => void;
  /** このビルドの commit。鍵ファイルに書き、中継が自分の版と比べる（違えば止めて替える）。無ければ書かない（版が分からない） */
  build?: string;
  /** 「Claude と並べる」の、OS の見分けと PowerShell を走らせる部品。試験は差し替える（無ければこの PC の OS と本物の PowerShell） */
  windowArrange?: { platform?: NodeJS.Platform; run?: ScriptRunner };
  /**
   * 入っている MOYAI の更新（moyai_update。#65）：版のフォルダの親と、今動いている版（開発の clone なら null）。
   * 無ければ dev_clone と答える。試験だけが run と取ってくる先を差し替える
   */
  appUpdate?: Pick<UpdateEnv, "root" | "running" | "run" | "sourceForTest">;
  /** 自動の確かめの間（試験で短くするときだけ。既定は起動の 1 分あとと 6 時間ごと） */
  autoCheckMs?: { first: number; every: number };
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
    ...(opts.probeMs !== undefined ? { probeMs: opts.probeMs } : {}),
    tokenTtlMs,
    ...(opts.build ? { build: opts.build } : {}),
    now,
    log,
  });
  // 前に用意できた次の版が残っていれば（橋渡しだけを起こし直したとき）、画面のビルドの印を朱にする（#65）
  if (opts.appUpdate?.running) {
    const n = readPointer(opts.appUpdate.root).next;
    if (n && n !== opts.appUpdate.running && isReady(opts.appUpdate.root, n)) tabs.announceNext(n);
  }
  const packsDir = opts.packsDir ?? resolvePacksDir();
  const human = new HumanService({ stateDir: opts.stateDir, packsDir, now, ...opts.human });
  // 読み方（3 段目の Skill）：保管先を読む・未承認の下書きを書く（決まり 1 の例外。承認は人の署名。docs/plan.md §2.17・§2.18.2）
  // 承認に数える署名：この PC が信じる鍵（自分の鍵か、確認済みの鍵）のものだけ（§2.18.2）
  const sd = opts.stateDir;
  const trusted = (x: SignatureInfo) => sd !== null && countsForApproval(trustOf(sd, x, new Date(now())));
  const tools = new ToolRelay(tabs, opts.toolTimeouts, {
    reading_skills_list: async (fromTab, args) => {
      const root = await human.root();
      if (!root) return "no_reading_root";
      const list = await listReadings(root, await approvedReadingVersions(root, trusted));
      // 本文は頼まれたときだけ（保管先の SKILL.md の文。規則の 1 文と、人が手で書いた補い）。
      // 渡す本文は、作業画面の今の施設・この PC の呼び名の担当・会社の範囲だけ。ほかの施設や担当の読み方は名前と数だけ（客先の呼び名を混ぜない。台帳の中-4）
      const facility = typeof fromTab.facilityKey === "string" ? fromTab.facilityKey : null;
      const me = sd ? readSettings(sd).name : null;
      return { skills: list.map(({ skill: _skill, text, ...x }) => (args.withText === true && readingTextShown(x, facility, me) ? { ...x, text } : x)) };
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
        aiAxes: Array.isArray(fromTab.aiAxes) ? fromTab.aiAxes.filter((x): x is string => typeof x === "string") : [],
      });
    },
    // 共有ファイルの形と数（share-preview-v1）：作業画面が計画と SHARE の選びを渡し、SHARE の画面と同じ関数で数える（読むだけ。署名も書き込みもしない）。
    // 作業画面に計画が無ければ、作業画面の答え（needs）をそのまま返す
    share_preview: async (fromTab) => {
      if (fromTab.mode !== "share") return fromTab;
      const p = sharePreviewFromTabSchema.safeParse(fromTab);
      if (!p.success) return "tab_bad_result";
      return human.sharePreview(p.data);
    },
    ledger_version: async () => human.ledgerHead(),
    // 入っている MOYAI の更新（#65）。取ってくる先は固定（引数は action だけ）。動いているものは止めない。用意できたら画面のビルドの印を朱にするだけ
    moyai_update: async (args) => {
      const action = args.action === "prepare" ? "prepare" : "check";
      const u = opts.appUpdate;
      if (!u || !u.running) return { action, state: "dev_clone" };
      if (action === "check") {
        const c = await checkUpdate(u);
        const last = lastPrepare(u.root);
        const pick = (k: string) => (typeof last?.[k] === "string" ? { [k]: String(last[k]) } : {});
        return {
          action,
          ...c,
          next: readPointer(u.root).next,
          preparing: preparing(u.root),
          last: last && typeof last.state === "string" ? { state: last.state, ...pick("step"), ...pick("latest"), ...pick("at") } : null,
        };
      }
      const b = await beginPrepare(u);
      if ("result" in b) return { action, ...b.result };
      void b.done.then((r) => {
        if (r.state === "ready") tabs.announceNext(r.latest);
      });
      return { action, state: "started", ...b.started };
    },
    // 作業画面の見せ方（screen_set）の保存先：設定の保存と同じ確かめ（validRoot）だけを通す。保存はしない（人が設定の画面で押す）
    storage_root: async (path) => ({ valid: validRoot(path), current: await human.root() }),
    reading_skill_register: async (fromTab) => {
      const root = await human.root();
      if (!root) return "no_reading_root";
      // 担当者は、この PC の設定の呼び名（人の経路と同じ。AI の引数やタブの答えからは取らない。監-3）
      const by = sd ? readSettings(sd).name : null;
      const w = await registerReading(root, fromTab.skill, by, typeof fromTab.facilityKey === "string" ? fromTab.facilityKey : null);
      if (!w.ok) return "tab_bad_result";
      const approved = (await approvedReadingVersions(root, trusted)).has(w.version);
      return { path: w.path, version: w.version, approved, rules: w.rules };
    },
    // 資料を作業画面に入れる：道を確かめて資料を選ぶ（状態フォルダとリポジトリの中は読まない。中身は作業画面が経路で取りに来る）
    // 無い Skillパックは、選べる Skillパックの ID と名前を文に添えて返す（AI が利用者の業種に合うものを選び直せるように）
    work_screen_open: async () => {
      // 開く手が無い橋渡し（試験）は開かずに opened: false
      if (!opts.openUrl) return { opened: false };
      opts.openUrl(`http://${BIND_HOST}:${port}/`);
      return { opened: true };
    },
    intake_add_files: async (args) => {
      const c = collectIntake(args as { source: "demo" | "folder" | "template"; path?: string; pack?: string; facilityName?: string; match?: string; list?: boolean }, {
        packsDir,
        stateDir: opts.stateDir,
        repoRoot: opts.repoRoot ?? dirname(packsDir),
      });
      if (c === "intake_pack_unknown") return errorBody(c, { packs: skillPacksText(packsDir) });
      if (typeof c === "string" || c.source !== "template") return c;
      // 様式：橋渡しが読んで形だけを作る（値の入ったデータの行の字と値は入れない。src/plan/template-layout.ts の templateShape）
      const f = c.files[0]!;
      const bytes = await readIntakeFile(f);
      if (!bytes) return "intake_template_missing";
      try {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(bytes as unknown as ArrayBuffer);
        return { ...c, template: templateShape(wb, f.name.replace(/\.xlsx$/i, "")) };
      } catch {
        return "intake_template_unreadable";
      }
    },
  }, opts.screenOpenWaitMs);
  const arrangeWindows = createWindowArranger(opts.windowArrange);
  const relayKey = randomBytes(32).toString("base64url");
  let port = opts.port;
  let closing: Promise<void> | null = null;
  // 自動の確かめ（#65 の 5）を止める手。橋渡しが待ち受けを始めてから回す
  let stopAutoCheck = (): void => {};
  // 閉じる（2 回目からは同じ約束を返す）。鍵ファイルは自分のものだけを消す
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      tabs.stop();
      stopAutoCheck();
      for (const c of wss.clients) c.terminate();
      wss.close();
      if (opts.stateDir) removeKeyFile(opts.stateDir, relayKey);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    })());

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

  /** 体を受けない経路（maxBody 0）：体があれば断る。 */
  const readNoBody = async (req: IncomingMessage): Promise<{ value: null } | ErrorCode> => {
    if (Number(req.headers["content-length"] ?? "0") > 0) return "body_too_large";
    for await (const c of req) if ((c as Buffer).length > 0) return "body_too_large";
    return { value: null };
  };

  /**
   * 作業画面だけが呼ぶ経路の守り：Origin・Sec-Fetch-Site・タブの秘密（人だけの操作ではないので 1 回きりの印は求めない）。
   * 通れば、そのタブの回と中身を返す。maxBody が 0 の経路は体を受けない（中身は null）。
   */
  const guardTab = async (req: IncomingMessage, route: RouteDef): Promise<{ session: string; body: unknown } | ErrorCode> => {
    if (!route.requires?.tabSecret) return "internal";
    const o = checkOrigin(header(req, "origin"), header(req, "host"), port, true);
    if (o) return o;
    const s = checkFetchSite(header(req, "sec-fetch-site"), false);
    if (s) return s;
    const tab = tabs.checkSecret(header(req, HEADER_TAB_SECRET));
    if (typeof tab === "string") return tab;
    const body = route.maxBody === 0 ? await readNoBody(req) : await readJson(req, route.maxBody ?? 0);
    if (typeof body === "string") return body;
    return { session: tab.session, body: body.value };
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
    // PWA：manifest・Service Worker・アイコン（型は static.ts の表。sw.js は no-store なので、版が変わればブラウザが読み直す）
    manifest: async ({ res, url }) => serveStatic(res, url.pathname),
    serviceWorker: async ({ res, url }) => serveStatic(res, url.pathname),
    icon192: async ({ res, url }) => serveStatic(res, url.pathname),
    icon512: async ({ res, url }) => serveStatic(res, url.pathname),
    iconMaskable192: async ({ res, url }) => serveStatic(res, url.pathname),
    iconMaskable512: async ({ res, url }) => serveStatic(res, url.pathname),
    // タブとホーム画面のしるし（src/app/public/brand/README.md）
    faviconIco: async ({ res, url }) => serveStatic(res, url.pathname),
    faviconSvg: async ({ res, url }) => serveStatic(res, url.pathname),
    appleTouchIcon: async ({ res, url }) => serveStatic(res, url.pathname),
    faviconRoot: async ({ res, url }) => serveStatic(res, url.pathname),
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
      // 誤りは、橋渡しが作った文のまま返す（値を添えた文：intake_pack_unknown の選べる Skillパック）
      return "ok" in answer ? sendJson(res, 200, answer) : sendJson(res, httpStatus(answer.error.code), answer);
    },
    // 止める合図（moyai uninstall と、古い版の橋渡しを替える中継。鍵ファイルの鍵が要る）。答えを返してから止める
    relayStop: async ({ req, res, route }) => {
      const g = guardRelay(req);
      if (g) return reject(res, g);
      const body = await readJson(req, route.maxBody ?? 0);
      if (typeof body === "string") return reject(res, body);
      sendJson(res, 200, { ok: true, stopping: true });
      log("止める合図（moyai uninstall か、新しい版の中継）が来たので、橋渡しを止めます");
      setImmediate(() => (opts.onStopRequest ? opts.onStopRequest() : void close()));
    },
    // intake_add_files：作業画面が、渡された資料の印で中身を取りに来る（その回の、まだ使っていない印だけ。1 回で使い終わる）
    tabIntakeFile: async ({ req, res, route }) => {
      const g = await guardTab(req, route);
      if (typeof g === "string") return reject(res, g);
      const fileId = (g.body as { fileId?: unknown } | null)?.fileId;
      if (typeof fileId !== "string") return reject(res, "bad_json");
      const f = tools.takeStagedFile(g.session, fileId);
      const bytes = f ? await readIntakeFile(f) : null;
      if (!bytes) return reject(res, "intake_file_unavailable");
      res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Length": String(bytes.length) });
      res.end(bytes);
    },
    // 施設ごとの作業中（#82）：作業画面だけの道（タブの秘密）。保管先が無ければ noRoot。行の値は記録に書かない
    tabWorkSource: async ({ req, res, route }) => {
      const g = await guardTab(req, route);
      if (typeof g === "string") return reject(res, g);
      const b = g.body as { planId?: unknown; base64?: unknown } | null;
      if (typeof b?.planId !== "string" || !PLAN_ID.test(b.planId) || typeof b.base64 !== "string") return sendJson(res, 200, { ok: false, reason: "workInvalid" });
      const root = await human.root();
      if (!root) return sendJson(res, 200, { ok: false, reason: "noRoot" });
      // 書けない（権限・空き）ときも、値を記録に書かずに断る
      const r = await putSource(root, b.planId, new Uint8Array(Buffer.from(b.base64, "base64"))).catch(() => null);
      if (!r) return sendJson(res, 200, { ok: false, reason: "workWriteFailed" });
      sendJson(res, 200, r.ok ? { ok: true, sha256: r.sha256, size: r.size } : { ok: false, reason: r.reason });
    },
    tabWorkSave: async ({ req, res, route }) => {
      const g = await guardTab(req, route);
      if (typeof g === "string") return reject(res, g);
      const root = await human.root();
      if (!root) return sendJson(res, 200, { ok: false, reason: "noRoot" });
      sendJson(res, 200, await writeWork(root, (g.body as { state?: unknown } | null)?.state).catch(() => ({ ok: false, reason: "workWriteFailed" })));
    },
    tabWorkList: async ({ req, res, route }) => {
      const g = await guardTab(req, route);
      if (typeof g === "string") return reject(res, g);
      const root = await human.root();
      sendJson(res, 200, { ok: true, root, works: root ? await listWork(root) : [] });
    },
    tabWorkRead: async ({ req, res, route }) => {
      const g = await guardTab(req, route);
      if (typeof g === "string") return reject(res, g);
      const b = g.body as { planId?: unknown; sha256?: unknown } | null;
      if (typeof b?.planId !== "string") return sendJson(res, 200, { ok: false, reason: "workInvalid" });
      const root = await human.root();
      if (!root) return sendJson(res, 200, { ok: false, reason: "noRoot" });
      if (typeof b.sha256 === "string") {
        const bytes = await readWorkSource(root, b.planId, b.sha256);
        if (!bytes) return sendJson(res, 200, { ok: false, reason: "workSourceMissing" });
        res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "Content-Length": String(bytes.length) });
        res.end(bytes);
        return;
      }
      const w = await readWork(root, b.planId);
      sendJson(res, 200, w ? { ok: true, state: w } : { ok: false, reason: "workMissing" });
    },
    // ヘッダの「Claude と並べる」：守りを通ったら、決まった台本を走らせて答えを返す（体は無し。タブから受けた値は台本に渡さない）
    tabWindowArrange: async ({ req, res, route }) => {
      const g = await guardTab(req, route);
      if (typeof g === "string") return reject(res, g);
      sendJson(res, 200, await arrangeWindows());
    },
  };

  /** 人だけの経路の処理。ここに来るのは guardHuman を通ったものだけ。 */
  // 確定・設定・輪と鍵・検問所の処理は src/bridge/human.ts（同じ守りを通ったあとで呼ぶ）
  const delegate = async (res: ServerResponse, h: HumanCtx) => sendJson(res, 200, await human.handle(h));
  const humanHandlers: { [K in HumanRouteId]: (res: ServerResponse, h: HumanCtx) => void | Promise<void> } = {
    workDiscard: delegate,
    commitTrial: (res, h) => {
      // 確定の試し：中身は何もしない。守りの形を試験するための経路
      log("確定の試しの経路を通りました（何も変えていません）");
      sendJson(res, 200, { ok: true, action: h.action, changed: false });
    },
    planStatus: delegate,
    planCommit: delegate,
    planRevert: delegate,
    planFileRead: delegate,
    planSourcePut: delegate,
    planSourceRead: delegate,
    ledgerRulesAccept: delegate,
    templatesRead: delegate,
    templateSave: delegate,
    templateFileRead: delegate,
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
    facilityKeyRotate: delegate,
    // 公開の台帳へ出す（通信の例外：github.com と api.github.com だけ。PR を出すのは人がボタンを押したときだけ）
    ledgerPreview: delegate,
    ledgerSend: delegate,
    // GitHub のアカウントなしで出す（通信の例外：受け口の 1 つだけ。送るのは人がボタンを押したときだけ）
    ledgerIntakeSend: delegate,
    ledgerPrs: delegate,
    githubConnectStart: delegate,
    githubConnectState: delegate,
    githubDisconnect: delegate,
    peersCompare: delegate,
    readingsRead: delegate,
    readingsLineage: delegate,
    readingFeedbackSave: delegate,
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
  // 自動の確かめ（運営者の決定 2026-11-11。#65 の 5）：入っている MOYAI だけ。設定の「最新の確かめ」を切ったら問い合わせない（毎回読み直す）
  if (opts.appUpdate?.running && sd) {
    const u = opts.appUpdate;
    stopAutoCheck = startAutoCheck(u, () => readSettings(sd).autoUpdate !== false, (latest) => tabs.announceNext(latest), opts.autoCheckMs);
  }

  if (opts.stateDir) {
    // 版（ビルドの commit）も書く。中継はこれを自分の版と比べ、違えば止める合図を送って新しい版を起こす（src/cli/relay.ts）
    writeKeyFile(opts.stateDir, {
      version: 1,
      port,
      key: relayKey,
      pid: process.pid,
      startedAt: new Date(now()).toISOString(),
      ...(opts.build ? { build: opts.build } : {}),
    });
  }

  return {
    port,
    url: `http://${BIND_HOST}:${port}/`,
    relayKey,
    tabs,
    tokens,
    tools,
    close,
  };
}
