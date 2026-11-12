// moyai uninstall（運営者の決定 11-06「チャットだけで入れる・デモする・消す」）：橋渡しを止め、Claude Desktop の設定から moyai の行だけを外し
// （.bak を残す）、Claude Code の登録を外す手順を出し、状態フォルダを消す。保存先は既定で残し、--remove-root のときだけ消す。
// 何を消すかを先に出し、--yes が無く端末でもなければ何も消さない。どれも一時のフォルダで行う。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readKeyFile, writeKeyFile, type KeyFile } from "../../../src/bridge/state";
import { UNINSTALL_TEXT, type StopOutcome, parseUninstallArgs, rootRemovable, stopBridgeAt, uninstallCli, withoutMoyai } from "../../../src/cli/uninstall";
import { startTestBridge, type TestBridge } from "../../helpers/bridge";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

const LINE = { command: "C:\\node\\node.exe", args: ["C:\\moyai\\dist\\cli.js", "mcp"] };

/** 一時のフォルダに、設定（ほかのサーバーと moyai）・状態フォルダ・保存先を作る */
function world() {
  const d = mkdtempSync(join(tmpdir(), "moyai-uninstall-"));
  cleanups.push(() => rmSync(d, { recursive: true, force: true }));
  const config = join(d, "Claude", "claude_desktop_config.json");
  mkdirSync(join(d, "Claude"), { recursive: true });
  const before = { mcpServers: { other: { command: "x", args: ["y"] }, moyai: LINE }, theme: "dark" };
  writeFileSync(config, JSON.stringify(before));
  const stateDir = join(d, "state");
  const root = join(d, "Documents", "MOYAI");
  mkdirSync(join(root, "plans", "p1"), { recursive: true });
  writeFileSync(join(root, "plans", "p1", "v1.json"), "{}");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "settings.json"), JSON.stringify({ v: 1, root, ledger: null, name: "【架空】山田" }));
  writeFileSync(join(stateDir, "person.key"), "鍵のかわり");
  // moyai setup が入れた版のフォルダ（試験は必ず一時のフォルダ。既定の置き場所に触れない）
  const app = join(d, "app");
  mkdirSync(join(app, "versions", "0".repeat(40), "dist"), { recursive: true });
  writeFileSync(join(app, "launch.cjs"), "// 起動の台本\n");
  return { d, config, before, stateDir, root, app };
}

async function run(w: ReturnType<typeof world>, argv: string[], o: { stdin?: { isTTY?: boolean }; answer?: string; stop?: (stateDir: string, key: KeyFile) => Promise<StopOutcome> } = {}) {
  const said: string[] = [];
  const code = await uninstallCli({
    argv,
    stdin: o.stdin ?? { isTTY: false },
    stateDir: w.stateDir,
    configPath: w.config,
    repoDir: join(w.d, "repo"),
    appDir: w.app,
    home: join(w.d, "home"),
    ...(o.stop ? { stop: o.stop } : {}),
    ask: async () => o.answer ?? "いいえ",
    say: (m) => said.push(m),
  });
  return { code, text: said.join("\n") };
}

describe("moyai uninstall", () => {
  it("入れた版のフォルダ：--yes が無ければ消さず、--yes で消す（保存先は残したまま）", async () => {
    const w = world();
    const dry = await run(w, []);
    expect(dry.text).toContain(UNINSTALL_TEXT.app(w.app));
    expect(existsSync(w.app)).toBe(true);
    const r = await run(w, ["--yes"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain(UNINSTALL_TEXT.appDone);
    expect(existsSync(w.app)).toBe(false);
    expect(existsSync(join(w.root, "plans", "p1", "v1.json"))).toBe(true);
    const again = await run(w, ["--yes"]);
    expect(again.text).toContain(UNINSTALL_TEXT.appNone(w.app));
  });

  it("--yes が無く端末でもなければ、消す中身（場所・.bak・保存先は残す・claude mcp remove）を出して、何も消さない", async () => {
    const w = world();
    const r = await run(w, []);
    expect(r.code).toBe(3);
    expect(r.text).toContain(UNINSTALL_TEXT.desktop(w.config));
    expect(r.text).toContain(UNINSTALL_TEXT.state(w.stateDir));
    expect(r.text).toContain(UNINSTALL_TEXT.rootKeep(w.root));
    expect(r.text).toContain("claude mcp remove --scope user moyai");
    expect(r.text).toContain(UNINSTALL_TEXT.notTerminal);
    expect(JSON.parse(readFileSync(w.config, "utf8"))).toEqual(w.before);
    expect(existsSync(w.stateDir)).toBe(true);
    expect(existsSync(w.root)).toBe(true);
    // 端末で「はい」でなければ消さない
    const tty = await run(w, [], { stdin: { isTTY: true }, answer: "いいえ" });
    expect(tty.code).toBe(0);
    expect(existsSync(w.stateDir)).toBe(true);
  });

  it("--yes：Claude Desktop の設定から moyai の行だけを外し（.bak を残す）、状態フォルダを消す。保存先は既定で残す", async () => {
    const w = world();
    const r = await run(w, ["--yes"]);
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(w.config, "utf8"))).toEqual({ mcpServers: { other: { command: "x", args: ["y"] } }, theme: "dark" });
    expect(JSON.parse(readFileSync(`${w.config}.bak`, "utf8"))).toEqual(w.before);
    expect(existsSync(w.stateDir)).toBe(false);
    expect(existsSync(join(w.root, "plans", "p1", "v1.json"))).toBe(true);
    // 消す前に中身を出してから消す
    expect(r.text.indexOf(UNINSTALL_TEXT.state(w.stateDir))).toBeLessThan(r.text.indexOf(UNINSTALL_TEXT.stateDone));
    expect(r.text).toContain(UNINSTALL_TEXT.yes);
    // --keep-root も同じ
    const w2 = world();
    expect((await run(w2, ["--yes", "--keep-root"])).code).toBe(0);
    expect(existsSync(w2.root)).toBe(true);
    expect(existsSync(w2.stateDir)).toBe(false);
  });

  it("--remove-root のときだけ保存先を消す（場所は状態フォルダの設定から、消す前に読む）", async () => {
    const w = world();
    const r = await run(w, ["--yes", "--remove-root"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain(UNINSTALL_TEXT.rootRemove(w.root));
    expect(existsSync(w.root)).toBe(false);
    expect(existsSync(w.stateDir)).toBe(false);
  });

  it("ホームかドライブの根と重なる保存先は、--remove-root でも消さない", async () => {
    expect(rootRemovable("/", "linux", "/home/a")).toBe(false);
    expect(rootRemovable("/home", "linux", "/home/a")).toBe(false);
    expect(rootRemovable("/home/a", "linux", "/home/a")).toBe(false);
    expect(rootRemovable("/home/a/Documents/MOYAI", "linux", "/home/a")).toBe(true);
    const w = world();
    writeFileSync(join(w.stateDir, "settings.json"), JSON.stringify({ v: 1, root: join(w.d, "home"), ledger: null, name: null }));
    mkdirSync(join(w.d, "home"), { recursive: true });
    const r = await run(w, ["--yes", "--remove-root"]);
    expect(r.text).toContain(UNINSTALL_TEXT.rootUnsafe(join(w.d, "home")));
    expect(existsSync(join(w.d, "home"))).toBe(true);
  });

  it("設定に moyai の行が無い・設定が読めないときは、設定に書かない", async () => {
    const w = world();
    writeFileSync(w.config, JSON.stringify({ mcpServers: { other: {} } }));
    expect(withoutMoyai({ mcpServers: { other: {} } })).toBeNull();
    const r = await run(w, ["--yes"]);
    expect(r.text).toContain(UNINSTALL_TEXT.desktopNone(w.config));
    expect(existsSync(`${w.config}.bak`)).toBe(false);
    const w2 = world();
    writeFileSync(w2.config, "{ broken");
    const r2 = await run(w2, ["--yes"]);
    expect(r2.text).toContain(UNINSTALL_TEXT.desktopInvalid(w2.config));
    expect(readFileSync(w2.config, "utf8")).toBe("{ broken");
    expect(existsSync(w2.stateDir)).toBe(false);
  });

  it("引数の形", () => {
    expect(parseUninstallArgs([])).toEqual({ yes: false, removeRoot: false });
    expect(parseUninstallArgs(["--yes", "--remove-root"])).toEqual({ yes: true, removeRoot: true });
    expect(parseUninstallArgs(["--keep-root", "--remove-root"])).toBeNull();
    expect(parseUninstallArgs(["--all"])).toBeNull();
  });
});

describe("moyai uninstall が橋渡しを止める", () => {
  it("鍵ファイルの居場所に、鍵を添えて止める合図を送る。橋渡しは閉じて鍵ファイルを消す", async () => {
    const tb: TestBridge = await startTestBridge();
    cleanups.push(() => tb.close());
    const w = world();
    const key = readKeyFile(tb.stateDir)!;
    expect(key.port).toBe(tb.bridge.port);
    // 鍵が違えば止まらない
    expect(await stopBridgeAt(tb.stateDir, { ...key, key: "x".repeat(43) }, 300)).toBe("failed");
    expect(readKeyFile(tb.stateDir)).not.toBeNull();
    // 状態フォルダを試験の橋渡しのものにして消す
    const r = await run({ ...w, stateDir: tb.stateDir }, ["--yes"]);
    expect(r.code).toBe(0);
    expect(r.text).toContain(UNINSTALL_TEXT.bridge(key.port));
    expect(r.text).toContain(UNINSTALL_TEXT.stopped);
    expect(existsSync(tb.stateDir)).toBe(false);
    // 止まった：同じ居場所に新しくつなぐと、接続を拒まれる
    await expect(
      new Promise((res, rej) => {
        const s = connect(key.port, "127.0.0.1");
        s.once("connect", () => (s.destroy(), res("connected")));
        s.once("error", (e: NodeJS.ErrnoException) => rej(e.code));
      }),
    ).rejects.toBe("ECONNREFUSED");
  });

  it("鍵ファイルが無ければ止める手順は飛ばす。古い鍵ファイル（止まっている）なら、起きていなかったと出して続ける", async () => {
    const w = world();
    let called = 0;
    const r = await run(w, ["--yes"], { stop: async () => (called++, "stopped") });
    expect(called).toBe(0);
    expect(r.text).toContain(UNINSTALL_TEXT.bridgeNone);
    const w2 = world();
    const tb = await startTestBridge();
    const port = tb.bridge.port;
    await tb.close();
    writeKeyFile(w2.stateDir, { version: 1, port, key: "k".repeat(43), pid: 1, startedAt: new Date().toISOString() });
    const r2 = await run(w2, ["--yes"]);
    expect(r2.code).toBe(0);
    expect(r2.text).toContain(UNINSTALL_TEXT.stopSkipped);
    expect(existsSync(w2.stateDir)).toBe(false);
  });
});
