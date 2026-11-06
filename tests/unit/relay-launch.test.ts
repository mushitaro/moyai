// 中継が橋渡しを起こす（運営者の決定 11-06「チャットだけで入れる」）：鍵ファイルが無いか接続を拒まれたら、起こす手で起こし、
// 新しい鍵ファイルができるまで待ってから 1 回だけ送る。起こせなければ bridge_not_running。起こした直後の答えに workScreenUrl を添える。
// 同時に 2 つ起こさない（鍵ファイルのそばの起動中の印）。起こす手は試験で差し替える（同じプロセスで橋渡しを起こす）。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { startBridge, type Bridge } from "../../src/bridge/server";
import { readKeyFile, writeKeyFile } from "../../src/bridge/state";
import { STARTING_MARK, createRelayServer, toToolResult, type RelayOptions } from "../../src/cli/relay";
import { ERRORS } from "../../src/shared/errors";
import { encodeEvent } from "../../src/shared/events";
import { TOOLS } from "../../src/shared/tools";
import { FakeTab, SECRET_A } from "../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function tempDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  return d;
}

function staticDir(): string {
  const d = join(tempDir("moyai-launch-app-"), "app");
  mkdirSync(join(d, "assets"), { recursive: true });
  writeFileSync(join(d, "index.html"), "<!doctype html><title>t</title>");
  return d;
}

async function connect(opts: RelayOptions): Promise<Client> {
  const server = createRelayServer(opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanups.push(() => client.close());
  await client.listTools(); // 本物のクライアントと同じく、出力の型を覚えさせてから呼ぶ
  return client;
}

/** 起こす手の代わり：同じプロセスで橋渡しを起こす（鍵ファイルは startBridge が書く）。起こした数を数える */
function launcher(stateDir: string, o: { delayMs?: number; answer?: (call: { name: string; requestId: string }) => unknown } = {}) {
  const state = { count: 0, bridges: [] as Bridge[] };
  const launch = () => {
    state.count++;
    void (async () => {
      if (o.delayMs) await sleep(o.delayMs);
      // タブを先につなぐときは、つないでから鍵ファイルを書く（中継が先に送らないように）
      const b = await startBridge({ port: 0, staticDir: staticDir(), stateDir: o.answer ? null : stateDir });
      state.bridges.push(b);
      cleanups.push(() => b.close());
      if (o.answer) {
        const host = `127.0.0.1:${b.port}`;
        const t = new FakeTab(`ws://${host}/ws`, `http://${host}`);
        await t.opened;
        t.send("tab.hello", { secret: SECRET_A, build: "test" });
        await t.next("bridge.welcome");
        t.ws.on("message", (raw) => {
          const ev = JSON.parse(raw.toString("utf8"));
          if (ev.type === "bridge.tool_call") t.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: o.answer!(ev.data) as never }));
        });
        cleanups.push(() => t.ws.close());
        writeKeyFile(stateDir, { version: 1, port: b.port, key: b.relayKey, pid: process.pid, startedAt: new Date().toISOString() });
      }
    })();
  };
  return { state, launch };
}

const urlOf = (b: Bridge) => `http://127.0.0.1:${b.port}/`;

function expectNotOpen(r: any, url: string | null): void {
  expect(r.isError).toBe(true);
  expect(r.content[0]).toEqual({ type: "text", text: ERRORS.work_screen_not_open.text });
  if (url) expect(r.content.slice(1)).toEqual([{ type: "text", text: JSON.stringify({ workScreenUrl: url }) }]);
  else expect(r.content).toHaveLength(1);
}

describe("中継が橋渡しを起こす", () => {
  it("鍵ファイルが無ければ起こし、鍵ファイルができてから送る。起こした直後の答えにだけ workScreenUrl を添える", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    const l = launcher(stateDir, { delayMs: 200 });
    const c = await connect({ stateDir, launch: l.launch });
    const r1 = await c.callTool({ name: "check_results", arguments: {} });
    expect(l.state.count).toBe(1);
    expectNotOpen(r1, urlOf(l.state.bridges[0]!));
    // 起動中の印は残さない
    expect(existsSync(join(stateDir, STARTING_MARK))).toBe(false);
    // 次の答えには添えない。もう起きているので起こさない
    expectNotOpen(await c.callTool({ name: "check_results", arguments: {} }), null);
    expect(l.state.count).toBe(1);
  });

  it("起こした直後の答えが結果なら、結果の JSON と structuredContent に workScreenUrl を添える（クライアントは出力の型で受ける）", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    const l = launcher(stateDir, { answer: () => ({ ok: true, data: { started: true, startedAt: "2026-11-06T00:00:00.000Z" } }) });
    const c = await connect({ stateDir, launch: l.launch });
    const r: any = await c.callTool({ name: "intake_compose", arguments: {} });
    expect(r.isError).toBeFalsy();
    const url = urlOf(l.state.bridges[0]!);
    expect(r.structuredContent).toEqual({ started: true, startedAt: "2026-11-06T00:00:00.000Z", workScreenUrl: url });
    expect(JSON.parse(r.content[0].text).workScreenUrl).toBe(url);
    const r2: any = await c.callTool({ name: "intake_compose", arguments: {} });
    expect(r2.structuredContent.workScreenUrl).toBeUndefined();
  });

  it("接続を拒まれたら（古い鍵ファイル）起こし、前と違う新しい鍵ファイルを待つ", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    const old = await startBridge({ port: 0, staticDir: staticDir(), stateDir: null });
    const oldPort = old.port;
    await old.close();
    writeKeyFile(stateDir, { version: 1, port: oldPort, key: "k".repeat(43), pid: 1, startedAt: new Date().toISOString() });
    const l = launcher(stateDir, { delayMs: 100 });
    const c = await connect({ stateDir, launch: l.launch });
    const r = await c.callTool({ name: "chart_rows", arguments: {} });
    expect(l.state.count).toBe(1);
    const b = l.state.bridges[0]!;
    expect(b.port).not.toBe(oldPort);
    expectNotOpen(r, urlOf(b));
    expect(readKeyFile(stateDir)?.key).toBe(b.relayKey);
  });

  it("起こせなければ、待つのは上限までで bridge_not_running を返す。起動中の印は残さない", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    let count = 0;
    const c = await connect({ stateDir, launch: () => void count++, launchWaitMs: 300 });
    const t0 = Date.now();
    const r = await c.callTool({ name: "check_results", arguments: {} });
    expect(count).toBe(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(250);
    expect(r.isError).toBe(true);
    expect(r.content).toEqual([{ type: "text", text: ERRORS.bridge_not_running.text }]);
    expect(existsSync(join(stateDir, STARTING_MARK))).toBe(false);
  });

  it("起こした子が先に終われば（ポートが使われているなど）、上限まで待たずに bridge_not_running を返す", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    const c = await connect({ stateDir, launch: () => ({ exited: Promise.resolve(1) }), launchWaitMs: 10_000 });
    const t0 = Date.now();
    const r = await c.callTool({ name: "check_results", arguments: {} });
    expect(Date.now() - t0).toBeLessThan(3_000);
    expect(r.content).toEqual([{ type: "text", text: ERRORS.bridge_not_running.text }]);
  });

  it("同時に 2 つ起こさない：同じ中継の並んだ呼び出しも、同じ状態フォルダの 2 つの中継も、起こすのは 1 回", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    const l = launcher(stateDir, { delayMs: 400 });
    const a = await connect({ stateDir, launch: l.launch });
    const b = await connect({ stateDir, launch: l.launch });
    const rs = await Promise.all([
      a.callTool({ name: "check_results", arguments: {} }),
      a.callTool({ name: "chart_rows", arguments: {} }),
      b.callTool({ name: "check_results", arguments: {} }),
    ]);
    expect(l.state.count).toBe(1);
    for (const r of rs) {
      expect(r.isError).toBe(true);
      expect((r.content as any[])[0]).toEqual({ type: "text", text: ERRORS.work_screen_not_open.text });
    }
    expect(existsSync(join(stateDir, STARTING_MARK))).toBe(false);
  });

  it("ほかの中継の起動中の印があれば、起こさずに鍵ファイルを待つ。古い印は除いて起こす", async () => {
    const stateDir = join(tempDir("moyai-launch-"), "state");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, STARTING_MARK), JSON.stringify({ id: "other", pid: 1, at: Date.now() }));
    const l = launcher(stateDir);
    const c = await connect({ stateDir, launch: l.launch, launchWaitMs: 5_000 });
    // ほかの中継が起こした橋渡し（少し遅れて鍵ファイルを書く）
    let other: Bridge | null = null;
    setTimeout(() => {
      void startBridge({ port: 0, staticDir: staticDir(), stateDir }).then((b) => {
        other = b;
        cleanups.push(() => b.close());
      });
    }, 200);
    const r = await c.callTool({ name: "check_results", arguments: {} });
    expect(other).not.toBeNull();
    // 待って起きた直後の答えにも、作業画面の URL を添える
    expectNotOpen(r, urlOf(other!));
    expect(l.state.count).toBe(0);
    // ほかの中継の印は消さない
    expect(existsSync(join(stateDir, STARTING_MARK))).toBe(true);

    // 古い印（待つ上限より前のもの）は除いて、自分で起こす
    const stateDir2 = join(tempDir("moyai-launch-"), "state");
    mkdirSync(stateDir2, { recursive: true });
    writeFileSync(join(stateDir2, STARTING_MARK), JSON.stringify({ id: "other", pid: 1, at: Date.now() - 60_000 }));
    const l2 = launcher(stateDir2, { delayMs: 50 });
    const c2 = await connect({ stateDir: stateDir2, launch: l2.launch });
    expectNotOpen(await c2.callTool({ name: "check_results", arguments: {} }), urlOf((await waitFor(() => l2.state.bridges[0]))!));
    expect(l2.state.count).toBe(1);
    expect(existsSync(join(stateDir2, STARTING_MARK))).toBe(false);
  });

  it("結果の型は workScreenUrl を受ける（どのツールも、127.0.0.1 の URL の形だけ）", () => {
    for (const t of Object.values(TOOLS)) {
      const shape = (t.output as any).shape;
      expect(shape.workScreenUrl, t.name).toBeDefined();
    }
    expect(TOOLS.intake_compose.output.safeParse({ started: true, startedAt: "x", workScreenUrl: "http://127.0.0.1:43110/" }).success).toBe(true);
    expect(TOOLS.intake_compose.output.safeParse({ started: true, startedAt: "x", workScreenUrl: "http://evil.example/" }).success).toBe(false);
    const r = toToolResult({ error: { code: "work_screen_not_open", message: ERRORS.work_screen_not_open.text } }, "http://127.0.0.1:43110/");
    expect(r.structuredContent).toBeUndefined();
    expect(r.content).toHaveLength(2);
  });
});

async function waitFor<T>(f: () => T | undefined, ms = 3_000): Promise<T | undefined> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = f();
    if (v !== undefined) return v;
    await sleep(20);
  }
  return undefined;
}
