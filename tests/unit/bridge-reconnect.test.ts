// 作業画面のタブは、橋渡しとの接続が切れたら（断られたときを除く）同じ秘密でつなぎ直し、ツールがまた通る（Architect の 63）。
// 撮影で、重い処理のあとに切れて、つながり直さずに止まった（Video の報告、11-06）
import WebSocket from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { BridgeClient, type ConnectionState } from "../../src/app/bridge-client";
import { startTestBridge, type TestBridge } from "../helpers/bridge";

let tb: TestBridge | null = null;
const realWs = (globalThis as { WebSocket?: unknown }).WebSocket;
afterEach(async () => {
  (globalThis as { WebSocket?: unknown }).WebSocket = realWs;
  await tb?.close();
  tb = null;
});

const until = async (ok: () => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("時間切れ");
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe("つなぎ直し", () => {
  it("切れたら「つなぎ直しています」を出し、つながるとツールが通る", async () => {
    tb = await startTestBridge();
    const origin = tb.origin;
    // ブラウザの WebSocket の代わり（Origin を付ける）
    (globalThis as { WebSocket?: unknown }).WebSocket = class extends WebSocket {
      constructor(url: string) {
        super(url, { origin });
      }
    };
    const c = new BridgeClient(`ws://${tb.host}/ws`);
    c.setToolHandlers({ call: async () => ({ ok: true, data: { mode: "ledger" } }), unknown: () => {} });
    const states: ConnectionState["kind"][] = [];
    c.subscribe((s) => states.push(s.kind));
    c.connect();
    await until(() => states.at(-1) === "open");
    // 接続を切る（橋渡しが切れたと見なしたのと同じ）
    (c as unknown as { ws: WebSocket }).ws.terminate();
    await until(() => states.includes("reconnecting"));
    await until(() => states.at(-1) === "open" && tb!.bridge.tabs.connected);
    const r = await tb.bridge.tabs.callTool("peer_reference", {}, "c1", 100, 3000, false);
    expect(r.kind).toBe("ok");
  });
});
