// 中継（moyai mcp）：MCP のクライアントからつなぎ、今見せるツール・橋渡しが無いとき・未実装・待ちの上限を確かめる。
// 状態フォルダは一時のフォルダ。ビルドした dist/cli.js があれば、標準入出力でもつなぐ（標準出力が MCP だけか）。
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { writeKeyFile } from "../../src/bridge/state";
import { createRelayServer, type RelayOptions } from "../../src/cli/relay";
import { ERRORS, type ErrorCode } from "../../src/shared/errors";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { EXPOSED_TOOL_NAMES, TOOL_NAMES } from "../../src/shared/tools";
import { BRIDGE_TOOL_RECEIVERS } from "../../src/bridge/tools";
import { startTestBridge, type TestBridge } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

function expectError(r: any, code: ErrorCode, label = ""): void {
  expect(r.isError, label).toBe(true);
  expect(r.structuredContent, label).toBeUndefined();
  expect(r.content[0], label).toEqual({ type: "text", text: ERRORS[code].text });
  // 作業画面が開いていないときだけ、作業画面の URL を JSON の 1 文で添える（ほかの誤りには足さない）
  const rest = r.content.slice(1);
  if (code === "work_screen_not_open") expect(rest.every((x: any) => x.type === "text" && "workScreenUrl" in JSON.parse(x.text)), label).toBe(true);
  else expect(rest, label).toEqual([]);
}

function tempState(): string {
  const d = mkdtempSync(join(tmpdir(), "moyai-relay-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

async function connect(opts: RelayOptions): Promise<Client> {
  const server = createRelayServer(opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanups.push(() => client.close());
  return client;
}

describe("中継の MCP", () => {
  it("今見せるツール（17 のうち、F3 の画面を待つ skill_eval を除く 16）を、説明と入力・出力の型つきで出す", async () => {
    const c = await connect({ stateDir: tempState() });
    const { tools } = await c.listTools();
    expect(TOOL_NAMES).toHaveLength(17);
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPOSED_TOOL_NAMES].sort());
    expect(tools.map((t) => t.name)).not.toContain("skill_eval");
    expect(tools).toHaveLength(16);
    for (const t of tools) {
      expect(t.description, t.name).toMatch(/人だけ/);
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type, t.name).toBe("object");
    }
    expect(c.getInstructions()).toBe(MCP_INSTRUCTIONS);
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  it("橋渡しが起きていなければ「先に moyai start を」と返す", async () => {
    const c = await connect({ stateDir: tempState() });
    await c.listTools();
    const r = await c.callTool({ name: "check_results", arguments: {} });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).toContain("moyai start");
    expectError(r, "bridge_not_running");
  });

  it("鍵ファイルが古い（橋渡しが止まっている）ときも、起きていないと返す", async () => {
    const stateDir = tempState();
    const tb = await startTestBridge();
    const port = tb.bridge.port;
    await tb.close();
    writeKeyFile(stateDir, { version: 1, port, key: "k".repeat(43), pid: 1, startedAt: new Date().toISOString() });
    const c = await connect({ stateDir });
    const r = await c.callTool({ name: "chart_rows", arguments: {} });
    expectError(r, "bridge_not_running");
  });

  it("橋渡しが起きていれば、作業画面へ渡すものはタブが無いと「開いていません」、ほかは型どおりに「未実装」を返す", async () => {
    const tb: TestBridge = await startTestBridge();
    cleanups.push(() => tb.close());
    const c = await connect({ stateDir: tb.stateDir });
    await c.listTools(); // 本物のクライアントと同じく、出力の型を覚えさせてから呼ぶ
    const args: Record<string, Record<string, unknown>> = {
      intake_settle: { decisions: [{ questionId: "q1", answer: "a", author: "ai", reason: "r" }] },
      photo_transcribe: { mode: "receive" },
      crosswalk_propose: {
        rules: [{ when: [{ field: "work.kind", op: "equals", values: ["x"] }], set: { field: "work.attribute", value: "INSPECT" }, reason: "r" }],
        basedOnVersion: 0,
      },
      chart_propose: {
        rules: [{ when: [{ field: "assetNode.tag", op: "prefix", values: ["P-"] }], set: { field: "assetNode.series", value: "A" }, reason: "r" }],
        basedOnVersion: 0,
        basis: "b",
      },
      note_for_human: { before: "confirm", text: "見てください" },
      reading_rules_propose: { name: "【架空】甲", scope: "facility", rules: [{ id: "r1", text: "1 行目を見出しとして読む", kind: "headerRow", row: 1, author: "ai", reason: "r" }] },
      reading_skill_register: { name: "【架空】甲" },
      intake_add_files: { source: "demo" },
      screen_set: { theme: "light" },
    };
    for (const name of EXPOSED_TOOL_NAMES) {
      const r = await c.callTool({ name, arguments: args[name] ?? {} });
      // 保管先を読むだけのツールは、橋渡しが答える（作業画面は要らない）
      if (BRIDGE_TOOL_RECEIVERS[name] === "bridge") {
        expect(JSON.stringify(r.content), name).not.toContain("未実装");
        continue;
      }
      expect(r.isError, name).toBe(true);
      if (BRIDGE_TOOL_RECEIVERS[name] === "tab" || BRIDGE_TOOL_RECEIVERS[name] === "tab_then_bridge" || BRIDGE_TOOL_RECEIVERS[name] === "bridge_then_tab") {
        expectError(r, "work_screen_not_open", name);
        expect(JSON.stringify(r.content), name).toContain("作業画面が開いていません");
      } else {
        expectError(r, "not_implemented", name);
        expect(JSON.stringify(r.content), name).toContain("未実装");
      }
    }
  });

  it("型に合わない引数は、橋渡しへ送る前に断る（規則の値の組は 20 個まで）", async () => {
    const c = await connect({ stateDir: tempState() });
    const values = Array.from({ length: 21 }, (_, i) => `v${i}`);
    const r = await c.callTool({
      name: "chart_propose",
      arguments: {
        rules: [{ when: [{ field: "work.kind", op: "in", values }], set: { field: "work.kind", value: "x" }, reason: "r" }],
        basedOnVersion: 0,
        basis: "b",
      },
    });
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.content)).not.toContain("moyai start");
  });
});

describe("待ちの上限と送り直し", () => {
  async function silentServer(): Promise<{ port: number; hits: () => number }> {
    let hits = 0;
    const s: Server = createServer(() => {
      hits++; // 答えない
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    cleanups.push(
      () =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    );
    const a = s.address();
    return { port: typeof a === "object" && a ? a.port : 0, hits: () => hits };
  }

  it("読むツールは 1 回だけ送り直し、それでも来なければ時間切れを返す", async () => {
    const stateDir = tempState();
    const srv = await silentServer();
    writeKeyFile(stateDir, { version: 1, port: srv.port, key: "k".repeat(43), pid: 1, startedAt: "" });
    const c = await connect({ stateDir, timeouts: { read: { ms: 150, retries: 1 } } });
    const r = await c.callTool({ name: "chart_rows", arguments: {} });
    expectError(r, "bridge_timeout");
    expect(srv.hits()).toBe(2);
  });

  async function droppingServer(): Promise<{ port: number; hits: () => number }> {
    let hits = 0;
    const s: Server = createServer((req) => {
      hits++;
      req.socket.destroy(); // 受けてから、答えずに切る
    });
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", () => r()));
    cleanups.push(() => new Promise<void>((r) => s.close(() => r())));
    const a = s.address();
    return { port: typeof a === "object" && a ? a.port : 0, hits: () => hits };
  }

  it("送ったあとに切れたら、読むツールは 1 回送り直し、切れたと返す（起きていないとは言わない）", async () => {
    const stateDir = tempState();
    const srv = await droppingServer();
    writeKeyFile(stateDir, { version: 1, port: srv.port, key: "k".repeat(43), pid: 1, startedAt: "" });
    const c = await connect({ stateDir });
    const r = await c.callTool({ name: "check_results", arguments: {} });
    expectError(r, "bridge_connection_lost");
    expect(srv.hits()).toBe(2);
  });

  it("送ったあとに切れたら、始めるツールは送り直さず「結果不明」を返す", async () => {
    const stateDir = tempState();
    const srv = await droppingServer();
    writeKeyFile(stateDir, { version: 1, port: srv.port, key: "k".repeat(43), pid: 1, startedAt: "" });
    const c = await connect({ stateDir });
    const r = await c.callTool({ name: "intake_compose", arguments: {} });
    expectError(r, "result_unknown");
    expect(srv.hits()).toBe(1);
  });

  it("案を置くツールは送り直さず「結果不明」を返す", async () => {
    const stateDir = tempState();
    const srv = await silentServer();
    writeKeyFile(stateDir, { version: 1, port: srv.port, key: "k".repeat(43), pid: 1, startedAt: "" });
    const c = await connect({ stateDir, timeouts: { propose: { ms: 150, retries: 0 } } });
    const r = await c.callTool({ name: "note_for_human", arguments: { before: "send", text: "t" } });
    expectError(r, "result_unknown");
    expect(JSON.stringify(r.content)).toContain(ERRORS.result_unknown.text);
    expect(srv.hits()).toBe(1);
  });
});

// ビルドした CLI を標準入出力でつなぐ。CI はビルドのあとに走らせ、MOYAI_REQUIRE_DIST=1 で飛ばさせない。
const dist = join(process.cwd(), "dist", "cli.js");
const needDist = process.env.MOYAI_REQUIRE_DIST === "1";
describe.skipIf(!existsSync(dist) && !needDist)("dist/cli.js mcp（標準入出力）", () => {
  it("標準出力は MCP だけで、今見せるツールを出し、橋渡しが無ければ先に start をと返す", async () => {
    const stateDir = tempState();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [dist, "mcp"],
      // 中継が本物の橋渡し（既定のポート）を起こさないようにする（起こす道は tests/unit/relay-launch.test.ts で、起こす手を差し替えて確かめる）
      env: { ...(process.env as Record<string, string>), MOYAI_STATE_DIR: stateDir, MOYAI_NO_BRIDGE_LAUNCH: "1" },
      stderr: "pipe",
    });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    cleanups.push(() => client.close());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPOSED_TOOL_NAMES].sort());
    const r = await client.callTool({ name: "share_preview", arguments: {} });
    expectError(r, "bridge_not_running");
    // 起動中の印も残さない（起こしていない）
    expect(existsSync(join(stateDir, "bridge.starting"))).toBe(false);
  });
});
