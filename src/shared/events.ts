// タブと橋渡しの間の WebSocket のイベントの一覧。どのイベントにも送り手（from）と受け手（to）を書く。
// 受け手は、src/bridge/tab.ts の TAB_EVENT_HANDLERS と src/app/bridge-client.ts の BRIDGE_EVENT_HANDLERS が持つ。
// tests/contract/ が、どのイベントにも送るコードと受ける処理があることを数える。
import { z } from "zod";
import { TAB_ERROR_CODES, type TabErrorCode } from "./errors";
import { HUMAN_ACTIONS } from "./routes";

export type EventSide = "tab" | "bridge";

/** タブの秘密：ページの中で作る 32 バイトの乱数（base64url で 43 文字）。HTML にもどの GET にも入れない。 */
export const tabSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

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
