// 古い版の橋渡しを中継が替える（運営者 11-07「こういうのを全部自動でやってくれないと」）。
// 鍵ファイルの橋渡しの版（build）が中継の版と違えば、鍵を添えて止める合図を送り、鍵ファイルが消えるのを待って、新しい版を起こす。
// 替えた直後の答えに workScreenUrl と「作業画面を読み込み直す」の字を添える。
// 鍵が合わない・止まらないときは止めずに bridge_port_taken。版が片方でも分からなければ替えない。中継より後に起きた橋渡しも替えない。
// 起こす手は試験で差し替える（同じプロセスで橋渡しを起こす）。ポートは空きを使う。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { startBridge, type Bridge } from "../../src/bridge/server";
import { readKeyFile, writeKeyFile } from "../../src/bridge/state";
import { RELAY_TEXT, bridgeIsOld, createRelayServer, knownBuild, portInUse, type RelayOptions } from "../../src/cli/relay";
import { ERRORS, errorBody } from "../../src/shared/errors";
import { encodeEvent } from "../../src/shared/events";
import { FakeTab, SECRET_A } from "../helpers/bridge";

const OLD = "aaaaaaa";
const NEW = "bbbbbbb";

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
  const d = join(tempDir("moyai-replace-app-"), "app");
  mkdirSync(join(d, "assets"), { recursive: true });
  writeFileSync(join(d, "index.html"), "<!doctype html><title>t</title>");
  return d;
}

async function bridge(stateDir: string | null, build?: string): Promise<Bridge> {
  const b = await startBridge({ port: 0, staticDir: staticDir(), stateDir, ...(build ? { build } : {}) });
  cleanups.push(() => b.close());
  return b;
}

async function connect(opts: RelayOptions): Promise<Client> {
  const server = createRelayServer(opts);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanups.push(() => client.close());
  await client.listTools();
  return client;
}

/** 起こす手の代わり：同じプロセスで、新しい版の橋渡しを起こす（鍵ファイルは startBridge が書く）。起こした数を数える */
function launcher(stateDir: string, build: string | undefined = NEW) {
  const state = { count: 0, bridges: [] as Bridge[] };
  const launch = () => {
    state.count++;
    void bridge(stateDir, build).then((b) => state.bridges.push(b));
  };
  return { state, launch };
}

const urlOf = (b: Bridge) => `http://127.0.0.1:${b.port}/`;
const texts = (r: any): string[] => (r.content as { type: string; text?: string }[]).map((c) => c.text ?? "");

describe("版を比べる", () => {
  const key = { version: 1 as const, port: 1, key: "k".repeat(43), pid: 1, startedAt: "2026-11-07T00:00:00.000Z" };
  const after = Date.parse(key.startedAt) + 1_000;

  it("ビルドの commit の形だけを分かる版とする", () => {
    expect(knownBuild("9eb76b2")).toBe(true);
    expect(knownBuild("9eb76b2+")).toBe(true);
    for (const v of [undefined, "", "unknown", "test", "9eb76"]) expect(knownBuild(v), String(v)).toBe(false);
  });

  it("両方が分かり、違い、橋渡しが中継より前に起きたときだけ替える", () => {
    expect(bridgeIsOld({ ...key, build: OLD }, NEW, after)).toBe(true);
    expect(bridgeIsOld({ ...key, build: NEW }, NEW, after)).toBe(false);
    expect(bridgeIsOld({ ...key }, NEW, after)).toBe(false);
    expect(bridgeIsOld({ ...key, build: OLD }, undefined, after)).toBe(false);
    expect(bridgeIsOld({ ...key, build: OLD }, "unknown", after)).toBe(false);
    expect(bridgeIsOld({ ...key, build: OLD, startedAt: "" }, NEW, after)).toBe(false);
    expect(bridgeIsOld({ ...key, build: OLD }, NEW, Date.parse(key.startedAt) - 1_000)).toBe(false);
  });
});

describe("古い版の橋渡しを中継が替える", () => {
  it("古い版の橋渡しが動いていれば、止める合図を送って止め、新しい版を起こす。直後の答えに URL と読み込み直しの字を添える", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    const old = await bridge(stateDir, OLD);
    const oldKey = readKeyFile(stateDir)!;
    expect(oldKey.build).toBe(OLD);
    const l = launcher(stateDir);
    const c = await connect({ stateDir, version: NEW, launch: l.launch, launchWaitMs: 5_000 });
    const r: any = await c.callTool({ name: "check_results", arguments: {} });

    // 古い版は止まった（ポートが空き、鍵ファイルは新しい版のもの）
    expect(await portInUse(old.port)).toBe(false);
    expect(l.state.count).toBe(1);
    const b = l.state.bridges[0]!;
    const k = readKeyFile(stateDir)!;
    expect(k.key).toBe(b.relayKey);
    expect(k.key).not.toBe(oldKey.key);
    expect(k.build).toBe(NEW);

    // 新しい版が答え（作業画面はまだ無い）、URL と読み込み直しの字が添わる
    expect(r.isError).toBe(true);
    expect(texts(r)).toEqual([ERRORS.work_screen_not_open.text, JSON.stringify({ workScreenUrl: urlOf(b) }), RELAY_TEXT.replaced(urlOf(b))]);
    expect(RELAY_TEXT.replaced(urlOf(b))).toContain("作業画面を読み込み直してください");

    // 次の答えには添えない。もう替えない・起こさない
    const r2: any = await c.callTool({ name: "check_results", arguments: {} });
    expect(texts(r2).slice(0, 1)).toEqual([ERRORS.work_screen_not_open.text]);
    expect(l.state.count).toBe(1);
  });

  it("替えた直後の答えが結果なら、JSON と structuredContent に workScreenUrl を添え、読み込み直しの字は別の文で添える（出力の型で受けられる）", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    await bridge(stateDir, OLD);
    // 新しい版の橋渡しに、作業画面の代わりのタブをつないでから鍵ファイルを書く
    const state = { count: 0, bridge: null as Bridge | null };
    const launch = () => {
      state.count++;
      void (async () => {
        const b = await bridge(null, NEW);
        const host = `127.0.0.1:${b.port}`;
        const t = new FakeTab(`ws://${host}/ws`, `http://${host}`);
        await t.opened;
        t.send("tab.hello", { secret: SECRET_A, build: "test" });
        await t.next("bridge.welcome");
        t.ws.on("message", (raw) => {
          const ev = JSON.parse(raw.toString("utf8"));
          if (ev.type === "bridge.tool_call") {
            t.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: { ok: true, data: { started: true, startedAt: "2026-11-07T00:00:00.000Z" } } as never }));
          }
        });
        cleanups.push(() => t.ws.close());
        state.bridge = b;
        writeKeyFile(stateDir, { version: 1, port: b.port, key: b.relayKey, pid: process.pid, startedAt: new Date().toISOString(), build: NEW });
      })();
    };
    const c = await connect({ stateDir, version: NEW, launch, launchWaitMs: 5_000 });
    const r: any = await c.callTool({ name: "intake_compose", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(state.count).toBe(1);
    const url = urlOf(state.bridge!);
    expect(r.structuredContent).toEqual({ started: true, startedAt: "2026-11-07T00:00:00.000Z", workScreenUrl: url });
    expect(JSON.parse(r.content[0].text).workScreenUrl).toBe(url);
    expect(texts(r).slice(1)).toEqual([RELAY_TEXT.replaced(url)]);
  });

  it("鍵ファイルの鍵が橋渡しと合わなければ、止めずに「ほかの道具が使っています」を返す。起こさない", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    const running = await bridge(null, OLD);
    writeKeyFile(stateDir, { version: 1, port: running.port, key: "k".repeat(43), pid: 1, startedAt: new Date(Date.now() - 60_000).toISOString(), build: OLD });
    const l = launcher(stateDir);
    const c = await connect({ stateDir, version: NEW, launch: l.launch, replaceWaitMs: 300 });
    const r: any = await c.callTool({ name: "check_results", arguments: {} });
    expect(r.isError).toBe(true);
    expect(texts(r)).toEqual([errorBody("bridge_port_taken", { port: running.port }).error.message]);
    expect(texts(r)[0]).toContain(`ポート ${running.port} をほかの道具が使っています`);
    // 止めていない・起こしていない・鍵ファイルを変えていない
    expect(await portInUse(running.port)).toBe(true);
    expect(l.state.count).toBe(0);
    expect(readKeyFile(stateDir)?.key).toBe("k".repeat(43));
  });

  it("止める合図を受けても上限までに鍵ファイルが消えなければ（止まらない）、同じく「ほかの道具が使っています」を返す", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    // 合図に 200 を返すが止まらない、ほかの道具
    const srv: Server = createHttpServer((req, res) => {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end("{}");
    });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    cleanups.push(() => new Promise<void>((r) => srv.close(() => r())));
    const port = (srv.address() as { port: number }).port;
    writeKeyFile(stateDir, { version: 1, port, key: "k".repeat(43), pid: 1, startedAt: new Date(Date.now() - 60_000).toISOString(), build: OLD });
    const l = launcher(stateDir);
    const c = await connect({ stateDir, version: NEW, launch: l.launch, replaceWaitMs: 300 });
    const r: any = await c.callTool({ name: "check_results", arguments: {} });
    expect(texts(r)).toEqual([errorBody("bridge_port_taken", { port }).error.message]);
    expect(l.state.count).toBe(0);
  });

  it("橋渡しの版が分からなければ（前の形の鍵ファイル）替えない。今の橋渡しにそのまま送る", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    const old = await bridge(stateDir);
    expect(readKeyFile(stateDir)?.build).toBeUndefined();
    const l = launcher(stateDir);
    const c = await connect({ stateDir, version: NEW, launch: l.launch });
    const r: any = await c.callTool({ name: "check_results", arguments: {} });
    expect(texts(r).slice(0, 1)).toEqual([ERRORS.work_screen_not_open.text]);
    expect(l.state.count).toBe(0);
    expect(await portInUse(old.port)).toBe(true);
    expect(readKeyFile(stateDir)?.key).toBe(old.relayKey);
  });

  it("中継の版が分からなければ（版の無い中継・unknown のビルド）替えない", async () => {
    for (const version of [undefined, "unknown"]) {
      const stateDir = join(tempDir("moyai-replace-"), "state");
      const old = await bridge(stateDir, OLD);
      const l = launcher(stateDir);
      const c = await connect({ stateDir, launch: l.launch, ...(version ? { version } : {}) });
      const r: any = await c.callTool({ name: "check_results", arguments: {} });
      expect(texts(r).slice(0, 1), String(version)).toEqual([ERRORS.work_screen_not_open.text]);
      expect(l.state.count).toBe(0);
      expect(readKeyFile(stateDir)?.key).toBe(old.relayKey);
    }
  });

  it("同じ版なら替えない。中継より後に起きた橋渡し（ほかの中継が起こしたもの）も替えない", async () => {
    const same = join(tempDir("moyai-replace-"), "state");
    const s = await bridge(same, NEW);
    const l1 = launcher(same);
    const c1 = await connect({ stateDir: same, version: NEW, launch: l1.launch });
    expect(texts(await c1.callTool({ name: "check_results", arguments: {} })).slice(0, 1)).toEqual([ERRORS.work_screen_not_open.text]);
    expect(l1.state.count).toBe(0);
    expect(readKeyFile(same)?.key).toBe(s.relayKey);

    const later = join(tempDir("moyai-replace-"), "state");
    const l2 = launcher(later);
    const c2 = await connect({ stateDir: later, version: NEW, launch: l2.launch, startedAt: Date.now() - 60_000 });
    const other = await bridge(later, OLD);
    expect(texts(await c2.callTool({ name: "check_results", arguments: {} })).slice(0, 1)).toEqual([ERRORS.work_screen_not_open.text]);
    expect(l2.state.count).toBe(0);
    expect(readKeyFile(later)?.key).toBe(other.relayKey);
  });

  it("起こす手が無ければ（MOYAI_NO_BRIDGE_LAUNCH）、止めない", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    const old = await bridge(stateDir, OLD);
    const c = await connect({ stateDir, version: NEW });
    expect(texts(await c.callTool({ name: "check_results", arguments: {} })).slice(0, 1)).toEqual([ERRORS.work_screen_not_open.text]);
    expect(await portInUse(old.port)).toBe(true);
    expect(readKeyFile(stateDir)?.key).toBe(old.relayKey);
  });

  it("鍵ファイルが無く、起こせず、起こすポートが使われていれば「ほかの道具が使っています」を返す（使われていなければ今どおり）", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    const holder = createNetServer();
    await new Promise<void>((r) => holder.listen(0, "127.0.0.1", () => r()));
    cleanups.push(() => new Promise<void>((r) => holder.close(() => r())));
    const port = (holder.address() as { port: number }).port;
    const c = await connect({ stateDir, version: NEW, launch: () => ({ exited: Promise.resolve(1) }), launchPort: port });
    const r: any = await c.callTool({ name: "check_results", arguments: {} });
    expect(texts(r)).toEqual([errorBody("bridge_port_taken", { port }).error.message]);

    // ポートが空いていれば、今どおり bridge_not_running
    await new Promise<void>((r) => holder.close(() => r()));
    await sleep(50);
    const c2 = await connect({ stateDir, version: NEW, launch: () => ({ exited: Promise.resolve(1) }), launchPort: port });
    expect(texts(await c2.callTool({ name: "check_results", arguments: {} }))).toEqual([ERRORS.bridge_not_running.text]);
  });

  it("同じ中継の並んだ呼び出しでも、止めて起こすのは 1 回", async () => {
    const stateDir = join(tempDir("moyai-replace-"), "state");
    await bridge(stateDir, OLD);
    const l = launcher(stateDir);
    const c = await connect({ stateDir, version: NEW, launch: l.launch, launchWaitMs: 5_000 });
    const rs: any[] = await Promise.all([
      c.callTool({ name: "check_results", arguments: {} }),
      c.callTool({ name: "chart_rows", arguments: {} }),
    ]);
    expect(l.state.count).toBe(1);
    const url = urlOf(l.state.bridges[0]!);
    // 読み込み直しの字は 1 回だけ添える
    const notices = rs.flatMap((r) => texts(r)).filter((t) => t === RELAY_TEXT.replaced(url));
    expect(notices).toHaveLength(1);
    expect(readKeyFile(stateDir)?.build).toBe(NEW);
  });
});
