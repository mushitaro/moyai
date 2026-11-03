// 中継（moyai mcp）：標準入出力の MCP。つなぐだけで、判断も保存もしない。
// 橋渡しの居場所と鍵は、状態フォルダの鍵ファイルから毎回読む。橋渡しが起きていなければ「先に moyai start を」と返す。
// 標準出力は MCP だけに使い、記録は標準エラーへ出す（作業データ・キー・行の値は出さない）。
// 結果は JSON の文字と structuredContent。写真の receive だけは、橋渡しが添えた画像を MCP の画像の中身（type: image）で渡す。
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorBody, errorBodySchema, type ErrorBody } from "../shared/errors";
import { MCP_INSTRUCTIONS } from "../shared/instructions";
import { HEADER_RELAY_KEY, ROUTES } from "../shared/routes";
import { EXPOSED_TOOL_NAMES, RELAY_MARGIN_MS, TOOL_TIMEOUTS, photoImageSchema, toolDef, type PhotoImage, type ToolKind, type ToolName } from "../shared/tools";
import { readKeyFile } from "../bridge/state";

export interface RelayOptions {
  stateDir: string;
  /** 試験で 1 回の HTTP の待ちの上限と送り直しを変えるときだけ使う（既定は TOOL_TIMEOUTS＋RELAY_MARGIN_MS） */
  timeouts?: Partial<Record<ToolKind, { ms: number; retries: number }>>;
  version?: string;
  /** 会話の印。中継の 1 つの接続を 1 つの会話と数える（行を読む上限はこの単位）。無ければ作る */
  conversation?: string;
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

/** 種類ごとの待ちの上限と送り直しで橋渡しを呼ぶ。読むものは 1 回だけ送り直し、書くものは送り直さない。 */
export async function callBridge(opts: RelayOptions, name: ToolName, args: unknown, conversation = "none"): Promise<BridgeAnswer> {
  const kind = toolDef(name).kind;
  // 橋渡しは作業画面を TOOL_TIMEOUTS だけ待ち、来なければ tab_no_answer を返す。中継はその答えを受けられるよう少し長く待つ
  const t = { ms: TOOL_TIMEOUTS[kind].ms + RELAY_MARGIN_MS, retries: TOOL_TIMEOUTS[kind].retries, ...(opts.timeouts?.[kind] ?? {}) };
  let last: "timeout" | "lost" = "timeout";
  for (let attempt = 0; attempt <= t.retries; attempt++) {
    const r = await postOnce(opts.stateDir, name, args, conversation, t.ms);
    // 作業画面から答えが来なかったのは、時間切れと同じに扱う（読むものだけ送り直す）
    if (r !== "timeout" && r !== "lost" && !("error" in r && r.error.code === "tab_no_answer")) return r;
    last = r === "lost" ? "lost" : "timeout";
  }
  // 書くもの・始めるものは、送れたかどうか分からないので「結果不明」。読むものは送り直しても来なかった理由を返す
  if (kind !== "read") return errorBody("result_unknown");
  return errorBody(last === "timeout" ? "bridge_timeout" : "bridge_connection_lost");
}

export function toToolResult(answer: BridgeAnswer): CallToolResult {
  if ("ok" in answer) {
    const text = { type: "text" as const, text: JSON.stringify(answer.data) };
    // 写真は文字にせず、MCP の画像の中身（type: image）として JSON の横に添える。AI クライアントが画像として読む
    if (answer.image) {
      return { content: [text, { type: "image", data: answer.image.data, mimeType: answer.image.mimeType }], structuredContent: answer.data };
    }
    return { content: [text], structuredContent: answer.data };
  }
  // 誤りのときは structuredContent を付けない（出力の型で検証するクライアントが、誤りの形を型違いとして落とすため）。
  // 文は ERRORS の文だけで、内部の名前（誤りの型の名前）は出さない。
  return { isError: true, content: [{ type: "text", text: answer.error.message }] };
}

export function createRelayServer(opts: RelayOptions): McpServer {
  const conversation = opts.conversation ?? randomUUID();
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
      async (args: unknown) => toToolResult(await callBridge(opts, name, args, conversation)),
    );
  }
  return server;
}
