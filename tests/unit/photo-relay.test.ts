// 写真を AI に渡す道（docs/plan.md §2.12・§2.13）：中継（本物）→ 橋渡し（本物）→ タブ（ふり）。
// 人だけの経路 photo_allow で人が許した画像（タブの回とハッシュに結んだもの）だけを、MCP の画像の中身（type: image）で 1 回渡す。
// タブが許しの無い画像・許したものと違う画像・ほかのツールに画像を添えても、橋渡しが渡さない。型から外れた格子はタブに届く前に断る。
// タブのふりは、許しを押す人の代わりに試験の台本が経路を呼ぶ（結果に「試験の台本が押した」と書く）。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createRelayServer, toToolResult } from "../../src/cli/relay";
import { ERRORS, type ErrorCode } from "../../src/shared/errors";
import { HEADER_RELAY_KEY, HEADER_TAB_SECRET, ROUTES } from "../../src/shared/routes";
import { PHOTO_SEND } from "../../src/shared/tools";
import { FakeTab, SECRET_A, http, startTestBridge, type TestBridge } from "../helpers/bridge";
import { PHOTO_DIR, PHOTO_NAME, jpegSize, photoBytes } from "../helpers/photo";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const SHORT = { read: 300, propose: 300, start: 300 };
const sha = (b: Uint8Array | string) => createHash("sha256").update(b).digest("hex");

type Call = { requestId: string; name: string; args: any; conversation: string };

async function setup(answer: (call: Call) => unknown | null) {
  const tb: TestBridge = await startTestBridge({ toolTimeouts: SHORT });
  cleanups.push(() => tb.close());
  const tab = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
  await tab.opened;
  tab.send("tab.hello", { secret: SECRET_A, build: "test" });
  await tab.next("bridge.welcome");
  cleanups.push(() => tab.ws.close());
  const calls: Call[] = [];
  tab.ws.on("message", (raw) => {
    const ev = JSON.parse(raw.toString("utf8"));
    if (ev.type !== "bridge.tool_call") return;
    calls.push(ev.data);
    const result = answer(ev.data);
    if (result !== null) tab.ws.send(JSON.stringify({ type: "tab.tool_result", data: { requestId: ev.data.requestId, result } }));
  });
  const server = createRelayServer({ stateDir: tb.stateDir });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanups.push(() => client.close());
  await client.listTools(); // 本物のクライアントと同じく、出力の型を覚えさせてから呼ぶ
  let n = 0;
  /** 人だけの経路で許す（画面のボタンの代わりに、試験の台本が押した） */
  const allow = async (payload: Record<string, unknown>) => {
    const text = JSON.stringify(payload);
    tab.send("tab.token_request", { requestId: `r${++n}`, action: "photo_allow", payloadHash: sha(text) });
    const tok = await tab.next("bridge.token");
    const r = await http(
      tb.bridge.port,
      "POST",
      ROUTES.photoAllow.path,
      { "content-type": "application/json", origin: tb.origin, "sec-fetch-site": "same-origin", [HEADER_TAB_SECRET]: SECRET_A },
      JSON.stringify({ token: tok.token, payload: text }),
    );
    expect(r.status).toBe(200);
    return r.body;
  };
  return { tb, tab, calls, client, allow };
}

function expectError(r: any, code: ErrorCode): void {
  expect(r.isError).toBe(true);
  expect(r.structuredContent).toBeUndefined();
  expect(r.content).toEqual([{ type: "text", text: ERRORS[code].text }]);
}

const BYTES = photoBytes();
const SIZE = jpegSize(BYTES)!;
const B64 = Buffer.from(BYTES).toString("base64");
const PERMIT = { imageRef: PHOTO_NAME, sha256: sha(BYTES), bytes: BYTES.length, width: SIZE.width, height: SIZE.height };
/** タブが receive に返す結果（作業画面の写真の机と同じ形） */
const received = (image = { mimeType: "image/jpeg", data: B64 }, bytes = BYTES.length) => ({
  ok: true,
  data: {
    mode: "receive",
    imageRef: PHOTO_NAME,
    placedCells: 0,
    needsReview: true,
    image: { width: SIZE.width, height: SIZE.height, bytes, mimeType: "image/jpeg" },
    waiting: 0,
    note: "画像を添えました",
  },
  image,
});

describe("人が許した画像だけを、MCP の画像の中身で 1 回渡す", () => {
  it("許す前は、タブが画像を添えても橋渡しが渡さない", async () => {
    const s = await setup((c) => (c.name === "photo_transcribe" ? received() : null));
    expectError(await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } }), "photo_permission_mismatch");
    expect(s.calls).toHaveLength(1);
  });

  it("タブが断れば（人が許していない）、その文で返す", async () => {
    const s = await setup(() => ({ ok: false, code: "photo_not_allowed" }));
    const r: any = await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
    expectError(r, "photo_not_allowed");
    expect(r.content[0].text).toContain("許していません");
  });

  it("人だけの経路で許したあとは、JSON の横に画像（type: image・base64・mimeType）を添えて渡す。許しは 1 回で使い終わる", async () => {
    const s = await setup((c) => (c.name === "photo_transcribe" ? received() : null));
    const body = await s.allow(PERMIT);
    expect(body).toMatchObject({ ok: true, imageRef: PHOTO_NAME, sha256: PERMIT.sha256 });
    const r: any = await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
    expect(r.isError).toBeFalsy();
    expect(r.content).toHaveLength(2);
    expect(r.content[0].type).toBe("text");
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
    expect(r.content[1]).toEqual({ type: "image", data: B64, mimeType: "image/jpeg" });
    // 画像そのものは JSON に入れない（構造化の結果は小さな JSON だけ）
    expect(JSON.stringify(r.structuredContent)).not.toContain(B64.slice(0, 64));
    expect(r.structuredContent).toMatchObject({ mode: "receive", imageRef: PHOTO_NAME, needsReview: true, image: { width: SIZE.width, height: SIZE.height, bytes: BYTES.length } });
    const got = Uint8Array.from(Buffer.from(r.content[1].data, "base64"));
    expect(sha(got)).toBe(PERMIT.sha256);
    expect(jpegSize(got)).toEqual(SIZE);
    // 外へ出た台帳：画像の大きさを数え、中身は残さない
    const last = s.tb.bridge.tools.outboundLog().at(-1)!;
    expect(last).toMatchObject({ tool: "photo_transcribe", ok: true, imageBytes: BYTES.length });
    expect(JSON.stringify(s.tb.bridge.tools.outboundLog())).not.toContain(B64.slice(0, 64));
    // 同じ画像をもう一度は渡さない（人がもう一度許すまで）
    expectError(await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } }), "photo_permission_mismatch");
    await s.allow(PERMIT);
    const again: any = await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
    expect(again.content[1].type).toBe("image");
  });

  it("許した画像と違う画像（ほかの写真・大きさ違い）は渡さない", async () => {
    const f2 = new Uint8Array(readFileSync(`${PHOTO_DIR}/photos/inspection-photo-f2-fy2026.jpg`));
    const s = await setup((c) => (c.name === "photo_transcribe" ? received({ mimeType: "image/jpeg", data: Buffer.from(f2).toString("base64") }, f2.length) : null));
    await s.allow(PERMIT);
    expectError(await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } }), "photo_permission_mismatch");
    // 形の申告が違う（バイト数が画像と合わない）ものは、型に合わない答えとして渡さない
    const s2 = await setup((c) => (c.name === "photo_transcribe" ? received(undefined, BYTES.length + 1) : null));
    await s2.allow(PERMIT);
    expectError(await s2.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } }), "tab_bad_result");
  });

  it("receive のほかに添えた画像は渡さない（place・ほかのツール）", async () => {
    const survey = { files: [], samples: [], legends: [], notes: [], questions: [], unresolvedCells: 0, compose: { state: "idle", message: null }, crosswalk: null };
    const s = await setup((c) =>
      c.name === "intake_survey"
        ? { ok: true, data: survey, image: { mimeType: "image/jpeg", data: B64 } }
        : { ok: true, data: { mode: "place", imageRef: PHOTO_NAME, placedCells: 1, needsReview: true, image: null, waiting: 0, note: "置いた" }, image: { mimeType: "image/jpeg", data: B64 } },
    );
    await s.allow(PERMIT);
    expectError(await s.client.callTool({ name: "intake_survey", arguments: {} }), "tab_bad_result");
    const grid = { imageRef: PHOTO_NAME, cells: [{ row: 0, col: 0, text: "【架空】", box: { x: 1, y: 1, w: 10, h: 10 }, confidence: 1 }] };
    expectError(await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "place", grid } }), "tab_bad_result");
  });

  it("運ぶ上限を越える画像は、橋渡しが受けない（AI には結果不明と返り、画像は渡らない）", async () => {
    const big = "A".repeat(Math.ceil(PHOTO_SEND.maxBytes / 3) * 4 + 4);
    const s = await setup((c) => (c.name === "photo_transcribe" ? received({ mimeType: "image/jpeg", data: big }) : null));
    await s.allow(PERMIT);
    const r: any = await s.client.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
    expectError(r, "result_unknown");
    expect(s.tb.bridge.tabs.dropped).toBe(1);
  });

  it("許しの中身の形が違えば断る（人だけの経路でも、形は確かめる）", async () => {
    const s = await setup(() => null);
    expect(await s.allow({ imageRef: PHOTO_NAME, sha256: "x", bytes: 1, width: 1, height: 1 })).toEqual({ ok: false, reason: "payloadInvalid" });
    expect(await s.allow({ ...PERMIT, bytes: PHOTO_SEND.maxBytes + 1 })).toEqual({ ok: false, reason: "payloadInvalid" });
  });
});

describe("型から外れた格子は、作業画面に届く前に断る（直さない）", () => {
  it("中継（MCP の入力の型）と橋渡し（中継の経路）の両方で断り、タブは呼ばれない", async () => {
    const s = await setup(() => ({ ok: true, data: {} }));
    const bad = { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [{ row: 0, col: 0, text: "x", box: { x: 0, y: 0, w: 1, h: 1 }, confidence: 2 }] } };
    const r: any = await s.client.callTool({ name: "photo_transcribe", arguments: bad });
    expect(r.isError).toBe(true);
    const dup = { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [0, 1].map(() => ({ row: 0, col: 0, text: "x", box: { x: 0, y: 0, w: 1, h: 1 }, confidence: 1 })) } };
    expect(((await s.client.callTool({ name: "photo_transcribe", arguments: dup })) as any).isError).toBe(true);
    // 中継を通らない呼び方（鍵は合う）でも、橋渡しが型で断る
    const viaHttp = await http(s.tb.bridge.port, "POST", ROUTES.relayTool.path, { "content-type": "application/json", [HEADER_RELAY_KEY]: s.tb.bridge.relayKey }, JSON.stringify({ name: "photo_transcribe", args: dup }));
    expect(viaHttp.body.error.code).toBe("invalid_input");
    expect(s.calls).toHaveLength(0);
  });
});

describe("中継の結果の形", () => {
  it("画像のある答えは [文字, 画像]、無い答えは [文字] だけ。誤りは文字だけで構造化の結果を付けない", () => {
    const data = { a: 1 };
    expect(toToolResult({ ok: true, data, image: { mimeType: "image/jpeg", data: "QUJD" } })).toEqual({
      content: [
        { type: "text", text: JSON.stringify(data) },
        { type: "image", data: "QUJD", mimeType: "image/jpeg" },
      ],
      structuredContent: data,
    });
    expect(toToolResult({ ok: true, data })).toEqual({ content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data });
    expect(toToolResult({ error: { code: "photo_not_allowed", message: ERRORS.photo_not_allowed.text } })).toEqual({ isError: true, content: [{ type: "text", text: ERRORS.photo_not_allowed.text }] });
  });
});

