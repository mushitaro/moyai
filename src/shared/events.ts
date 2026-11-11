// タブと橋渡しの間の WebSocket のイベントの一覧。どのイベントにも送り手（from）と受け手（to）を書く。
// 受け手は、src/bridge/tab.ts の TAB_EVENT_HANDLERS と src/app/bridge-client.ts の BRIDGE_EVENT_HANDLERS が持つ。
// tests/contract/ が、どのイベントにも送るコードと受ける処理があることを数える。
import { z } from "zod";
import { TAB_ERROR_CODES, TAB_SENT_CODES, type TabErrorCode, type TabSentCode } from "./errors";
import { HUMAN_ACTIONS } from "./routes";
import { TOOL_NAMES, photoImageSchema, type ToolName } from "./tools";

export type EventSide = "tab" | "bridge";

/** タブの秘密：ページの中で作る 32 バイトの乱数（base64url で 43 文字）。HTML にもどの GET にも入れない。 */
export const tabSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const requestId = z.string().min(1).max(64);
const toolName = z.enum(TOOL_NAMES as [ToolName, ...ToolName[]]);

export const EVENTS = {
  "tab.hello": {
    from: "tab",
    to: "bridge",
    data: z.object({ secret: tabSecretSchema, build: z.string().max(80) }),
  },
  "bridge.welcome": {
    from: "bridge",
    to: "tab",
    data: z.object({ heartbeatMs: z.number().int(), deadMs: z.number().int(), tokenTtlMs: z.number().int() }),
  },
  "bridge.refused": {
    from: "bridge",
    to: "tab",
    data: z.object({ code: z.enum(TAB_ERROR_CODES as [TabErrorCode, ...TabErrorCode[]]), message: z.string() }),
  },
  "bridge.ping": { from: "bridge", to: "tab", data: z.object({ at: z.number() }) },
  "tab.pong": { from: "tab", to: "bridge", data: z.object({ at: z.number() }) },
  // タブに作業（資料か作業中の計画）があるか。変わるたびと握手のあとに送る。橋渡しは、作業のある生きたタブを、あとから開いたタブに渡さない（#46）
  "tab.work": { from: "tab", to: "bridge", data: z.object({ work: z.boolean() }) },
  "tab.token_request": {
    from: "tab",
    to: "bridge",
    data: z.object({
      requestId: z.string().min(1).max(64),
      action: z.enum(HUMAN_ACTIONS),
      payloadHash: sha256Hex,
    }),
  },
  "bridge.token": {
    from: "bridge",
    to: "tab",
    data: z.object({
      requestId: z.string(),
      token: z.string(),
      action: z.enum(HUMAN_ACTIONS),
      expiresAt: z.number(),
    }),
  },
  // AI のツールの呼び出し（中継 → 橋渡し → タブ）。引数は橋渡しが型で確かめてから渡し、タブも確かめ直す。
  // rowsRemaining はこの会話であと読める星取表の行の数（数えるのは橋渡し。§2.12）。
  "bridge.tool_call": {
    from: "bridge",
    to: "tab",
    data: z.object({
      requestId,
      name: toolName,
      args: z.record(z.string(), z.unknown()),
      conversation: z.string().min(1).max(64),
      rowsRemaining: z.number().int().min(0),
    }),
  },
  // image は photo_transcribe の receive だけが添える（人が許した写真 1 枚。橋渡しが許しと照らしてから中継へ渡す）
  "tab.tool_result": {
    from: "tab",
    to: "bridge",
    data: z.object({
      requestId,
      result: z.discriminatedUnion("ok", [
        z.object({ ok: z.literal(true), data: z.record(z.string(), z.unknown()), image: photoImageSchema.optional() }),
        z.object({ ok: z.literal(false), code: z.enum(TAB_SENT_CODES as [TabSentCode, ...TabSentCode[]]) }),
      ]),
    }),
  },
  // 案を置くツール・始めるツールで、タブの答えが時間内に来なかった。AI には「結果不明」と返したので、画面にも出す
  "bridge.tool_unknown": {
    from: "bridge",
    to: "tab",
    data: z.object({ requestId, name: toolName }),
  },
} as const satisfies Record<string, { from: EventSide; to: EventSide; data: z.ZodType }>;

export type EventType = keyof typeof EVENTS;
export const EVENT_TYPES = Object.keys(EVENTS) as EventType[];
export type EventData<T extends EventType> = z.infer<(typeof EVENTS)[T]["data"]>;

export type TabToBridge = { [K in EventType]: (typeof EVENTS)[K]["from"] extends "tab" ? K : never }[EventType];
export type BridgeToTab = { [K in EventType]: (typeof EVENTS)[K]["from"] extends "bridge" ? K : never }[EventType];

/** 1 つの通信の形：{ type, data }。 */
export interface Envelope<T extends EventType = EventType> {
  type: T;
  data: EventData<T>;
}

export function encodeEvent<T extends EventType>(type: T, data: EventData<T>): string {
  return JSON.stringify({ type, data });
}

/** 受けた文字を読み、型を確かめる。読めなければ null（直さない）。 */
export function decodeEvent(raw: string, expectFrom: EventSide): Envelope | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const type = (v as { type?: unknown }).type;
  if (typeof type !== "string" || !(type in EVENTS)) return null;
  const def = EVENTS[type as EventType];
  if (def.from !== expectFrom) return null;
  const parsed = def.data.safeParse((v as { data?: unknown }).data);
  if (!parsed.success) return null;
  return { type: type as EventType, data: parsed.data } as Envelope;
}
