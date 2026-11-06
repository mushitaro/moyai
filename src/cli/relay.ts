// 中継（moyai mcp）：標準入出力の MCP。つなぐだけで、判断も保存もしない。
// 橋渡しの居場所と鍵は、状態フォルダの鍵ファイルから毎回読む。
// 橋渡しが起きていなければ（鍵ファイルが無いか、接続を拒まれた）、起こす手（launch。moyai mcp は moyai start --no-open を切り離して起こす）で起こし、
// 新しい鍵ファイルができるまで待ってから 1 回だけ送る（拒まれたものは送れていないので、送り直しではない）。同時に 2 つ起こさないよう、
// 鍵ファイルのそばに起動中の印（bridge.starting）を置く。起こせなければ「先に moyai start を」と返す。
// 起こした直後の答えには、作業画面の URL を workScreenUrl として添える（--no-open なので、画面は開いていない）。
// 標準出力は MCP だけに使い、記録は標準エラーへ出す（作業データ・キー・行の値は出さない）。
// 結果は JSON の文字と structuredContent。写真の receive だけは、橋渡しが添えた画像を MCP の画像の中身（type: image）で渡す。
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { ERRORS, errorBody, errorBodySchema, type ErrorBody } from "../shared/errors";
import { MCP_INSTRUCTIONS } from "../shared/instructions";
import { HEADER_RELAY_KEY, ROUTES } from "../shared/routes";
import { EXPOSED_TOOL_NAMES, RELAY_MARGIN_MS, TOOL_TIMEOUTS, photoImageSchema, toolDef, type PhotoImage, type ToolKind, type ToolName } from "../shared/tools";
import { readKeyFile, type KeyFile } from "../bridge/state";

/** 起こした橋渡しの手がかり。exited は子プロセスが終わったら解ける（起きずに終わったら、待つのをやめる） */
export interface LaunchHandle {
  exited?: Promise<unknown>;
}

/** 鍵ファイルができるまで待つ上限 */
export const LAUNCH_WAIT_MS = 20_000;
/** 起動中の印のファイル（鍵ファイルのそば） */
export const STARTING_MARK = "bridge.starting";
/** 起動中の印が古いと見なす時間（待つ上限より長く。起こした中継が落ちて印だけが残ったとき） */
export const STARTING_STALE_MS = 30_000;
const POLL_MS = 100;

export interface RelayOptions {
  stateDir: string;
  /** 試験で 1 回の HTTP の待ちの上限と送り直しを変えるときだけ使う（既定は TOOL_TIMEOUTS＋RELAY_MARGIN_MS） */
  timeouts?: Partial<Record<ToolKind, { ms: number; retries: number }>>;
  version?: string;
  /** 会話の印。中継の 1 つの接続を 1 つの会話と数える（行を読む上限はこの単位）。無ければ作る */
  conversation?: string;
  /**
   * 橋渡しを起こす手。moyai mcp は moyai start --no-open を切り離した子プロセスで起こす（src/cli/main.ts）。
   * 無ければ起こさない（試験の既定）。試験は差し替える。
   */
  launch?: () => LaunchHandle | void | Promise<LaunchHandle | void>;
  /** 鍵ファイルができるまで待つ上限（既定 LAUNCH_WAIT_MS） */
  launchWaitMs?: number;
}

/** 起動中の印を取る。取れたら印の中身（自分のものと見分ける）、ほかの中継が起こしている最中なら null */
function takeStartingMark(stateDir: string, now = Date.now()): string | null {
  const file = join(stateDir, STARTING_MARK);
  const id = randomUUID();
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  for (let i = 0; i < 2; i++) {
    try {
      writeFileSync(file, JSON.stringify({ id, pid: process.pid, at: now }), { flag: "wx", mode: 0o600 });
      return id;
    } catch {
      // あれば、古いものだけを除いてもう 1 度
      let at = 0;
      try {
        at = Number((JSON.parse(readFileSync(file, "utf8")) as { at?: unknown }).at) || 0;
      } catch {
        at = 0;
      }
      if (now - at < STARTING_STALE_MS) return null;
      rmSync(file, { force: true });
    }
  }
  return null;
}

/** 自分の起動中の印だけを消す */
function dropStartingMark(stateDir: string, id: string): void {
  const file = join(stateDir, STARTING_MARK);
  try {
    if ((JSON.parse(readFileSync(file, "utf8")) as { id?: unknown }).id === id) rmSync(file, { force: true });
  } catch {
    /* 無い・読めない */
  }
}

/** 拒まれた鍵（stale）とは違う、新しい鍵ファイルができるまで待つ。子プロセスが先に終わったら、もう 1 度だけ見てやめる */
async function waitForKey(stateDir: string, stale: string | null, ms: number, exited?: Promise<unknown>): Promise<KeyFile | null> {
  let gone = false;
  void exited?.then(
    () => (gone = true),
    () => (gone = true),
  );
  const deadline = Date.now() + ms;
  for (;;) {
    const k = readKeyFile(stateDir);
    if (k && k.key !== stale) return k;
    if (gone || Date.now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

/**
 * 橋渡しを起こして、新しい鍵ファイルを待つ。起動中の印が取れたときだけ起こし、取れなければ（ほかの中継が起こしている）待つだけ。
 * 起きれば鍵ファイル、起こせなければ null。
 */
export async function ensureBridge(opts: RelayOptions, stale: string | null): Promise<KeyFile | null> {
  if (!opts.launch) return null;
  const wait = opts.launchWaitMs ?? LAUNCH_WAIT_MS;
  // ほかの中継が起こし終えていれば（拒まれた鍵と違う鍵ファイルがある）、起こさない
  const now = readKeyFile(opts.stateDir);
  if (now && now.key !== stale) return now;
  let mark: string | null;
  try {
    mark = takeStartingMark(opts.stateDir);
  } catch {
    return null;
  }
  if (!mark) return waitForKey(opts.stateDir, stale, wait);
  try {
    let handle: LaunchHandle | void;
    try {
      handle = await opts.launch();
    } catch {
      return null;
    }
    return await waitForKey(opts.stateDir, stale, wait, handle?.exited);
  } finally {
    dropStartingMark(opts.stateDir, mark);
  }
}

/** 接続を拒まれた誤りか（AggregateError の中に入っている形も見る）。 */
export function refused(cause: unknown): boolean {
  const c = cause as { code?: unknown; errors?: unknown } | undefined;
  if (!c) return false;
  if (c.code === "ECONNREFUSED") return true;
  return Array.isArray(c.errors) && c.errors.some((e) => (e as { code?: unknown })?.code === "ECONNREFUSED");
}

/** image は photo_transcribe の receive だけ（人が許した写真 1 枚。橋渡しが許しと照らしたもの） */
type BridgeAnswer = { ok: true; data: Record<string, unknown>; image?: PhotoImage } | ErrorBody;

/**
 * 橋渡しに 1 回送る。接続を拒まれたら bridge_not_running（送れていない）。
 * 時間切れは "timeout"、送ったあとに切れたなどは "lost"（どちらも、書けたかどうか分からない）。
 */
async function postOnce(stateDir: string, name: ToolName, args: unknown, conversation: string, ms: number): Promise<BridgeAnswer | "timeout" | "lost"> {
  const key = readKeyFile(stateDir);
  if (!key) return errorBody("bridge_not_running");
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${key.port}${ROUTES.relayTool.path}`, {
      method: "POST",
      headers: { "content-type": "application/json", [HEADER_RELAY_KEY]: key.key },
      body: JSON.stringify({ name, args, conversation }),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    if (err.name === "TimeoutError" || err.name === "AbortError") return "timeout";
    if (refused(err.cause)) return errorBody("bridge_not_running");
    return "lost";
  }
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return errorBody("result_unknown");
  }
  const asError = errorBodySchema.safeParse(body);
  if (asError.success) return asError.data;
  const ok = body as { ok?: unknown; data?: unknown; image?: unknown };
  if (ok.ok === true && ok.data && typeof ok.data === "object") {
    if (ok.image === undefined) return { ok: true, data: ok.data as Record<string, unknown> };
    // 画像は型を確かめてから添える（読めない画像は渡さない）
    const image = photoImageSchema.safeParse(ok.image);
    if (image.success) return { ok: true, data: ok.data as Record<string, unknown>, image: image.data };
  }
  return errorBody("result_unknown");
}

const notRunning = (r: BridgeAnswer | "timeout" | "lost") => typeof r === "object" && "error" in r && r.error.code === "bridge_not_running";

/**
 * 種類ごとの待ちの上限と送り直しで橋渡しを呼ぶ。読むものは 1 回だけ送り直し、書くものは送り直さない。
 * 橋渡しが起きていなければ、ensure で起こしてから 1 回だけ送る（拒まれたものは送れていない）。
 */
export async function callBridge(
  opts: RelayOptions,
  name: ToolName,
  args: unknown,
  conversation = "none",
  ensure?: (stale: string | null) => Promise<boolean>,
): Promise<BridgeAnswer> {
  const kind = toolDef(name).kind;
  // 橋渡しは作業画面を TOOL_TIMEOUTS だけ待ち、来なければ tab_no_answer を返す。中継はその答えを受けられるよう少し長く待つ
  const t = { ms: TOOL_TIMEOUTS[kind].ms + RELAY_MARGIN_MS, retries: TOOL_TIMEOUTS[kind].retries, ...(opts.timeouts?.[kind] ?? {}) };
  let last: "timeout" | "lost" = "timeout";
  for (let attempt = 0; attempt <= t.retries; attempt++) {
    // 送る前の鍵（拒まれたら、これと違う新しい鍵ファイルを待つ）
    const used = readKeyFile(opts.stateDir)?.key ?? null;
    let r = await postOnce(opts.stateDir, name, args, conversation, t.ms);
    if (notRunning(r) && ensure && (await ensure(used))) r = await postOnce(opts.stateDir, name, args, conversation, t.ms);
    // 作業画面から答えが来なかったのは、時間切れと同じに扱う（読むものだけ送り直す）
    if (r !== "timeout" && r !== "lost" && !("error" in r && r.error.code === "tab_no_answer")) return r;
    last = r === "lost" ? "lost" : "timeout";
  }
  // 書くもの・始めるものは、送れたかどうか分からないので「結果不明」。読むものは送り直しても来なかった理由を返す
  if (kind !== "read") return errorBody("result_unknown");
  return errorBody(last === "timeout" ? "bridge_timeout" : "bridge_connection_lost");
}

/** 作業画面の URL（鍵ファイルのポート） */
export function workScreenUrl(key: Pick<KeyFile, "port">): string {
  return `http://127.0.0.1:${key.port}/`;
}

/** workScreenUrl を添えるときは、結果の JSON に、誤りなら文の横に JSON の 1 つの文として添える */
export function toToolResult(answer: BridgeAnswer, url: string | null = null): CallToolResult {
  if ("ok" in answer) {
    const data = url ? { ...answer.data, workScreenUrl: url } : answer.data;
    const text = { type: "text" as const, text: JSON.stringify(data) };
    // 写真は文字にせず、MCP の画像の中身（type: image）として JSON の横に添える。AI クライアントが画像として読む
    if (answer.image) {
      return { content: [text, { type: "image", data: answer.image.data, mimeType: answer.image.mimeType }], structuredContent: data };
    }
    return { content: [text], structuredContent: data };
  }
  // 誤りのときは structuredContent を付けない（出力の型で検証するクライアントが、誤りの形を型違いとして落とすため）。
  // 文は ERRORS の文だけで、内部の名前（誤りの型の名前）は出さない。
  const extra = url ? [{ type: "text" as const, text: JSON.stringify({ workScreenUrl: url }) }] : [];
  return { isError: true, content: [{ type: "text", text: answer.error.message }, ...extra] };
}

export function createRelayServer(opts: RelayOptions): McpServer {
  const conversation = opts.conversation ?? randomUUID();
  // 同じ中継の中で、同時に起こさない（並んだ呼び出しは同じ起こしを待つ）
  let starting: Promise<KeyFile | null> | null = null;
  // 起こした（か、ほかの中継が起こすのを待った）あと、まだ URL を添えていない
  let announce: KeyFile | null = null;
  const ensure = async (stale: string | null): Promise<boolean> => {
    starting ??= ensureBridge(opts, stale).finally(() => (starting = null));
    const k = await starting;
    if (k) announce = k;
    return k !== null;
  };
  const server = new McpServer(
    { name: "moyai", version: opts.version ?? "0.0.0" },
    { instructions: MCP_INSTRUCTIONS, capabilities: { tools: {} } },
  );
  for (const name of EXPOSED_TOOL_NAMES) {
    const d = toolDef(name);
    server.registerTool(
      name,
      {
        title: d.title,
        description: d.description,
        inputSchema: d.input,
        outputSchema: d.output,
        annotations: {
          title: d.title,
          readOnlyHint: d.kind === "read",
          destructiveHint: false,
          idempotentHint: d.kind === "read",
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        const answer = await callBridge(opts, name, args, conversation, ensure);
        // 起こした直後の最初の答え（橋渡しが答えたもの）に、作業画面の URL を添える
        const fromBridge = "ok" in answer || ERRORS[answer.error.code].from !== "relay";
        const k = fromBridge ? announce : null;
        if (k) announce = null;
        return toToolResult(answer, k ? workScreenUrl(k) : null);
      },
    );
  }
  return server;
}
