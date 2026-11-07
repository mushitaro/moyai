// moyai setup（docs/plan.md §2.12・§8 の 7）：Claude Desktop の設定に moyai の 1 行だけを足す。ほかのサーバーは消さない。
// 端末でなければ断り、「はい」でなければ書かない。前の設定は .bak に残す。読めない設定には書かない
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSettings } from "../../src/bridge/places";
import { SETUP_TEXT, claudeCodeAddLine, claudeConfigPath, parseSetupArgs, setupCli, withMoyai } from "../../src/cli/setup";

const LINE = { command: "C:\\node\\node.exe", args: ["C:\\moyai\\dist\\cli.js", "mcp"] };
const TTY = { isTTY: true };
let dir = "";
afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));
const run = (path: string, answer: string | null, stdin = TTY) => setupCli({ stdin, path, line: LINE, ask: async () => answer, say: () => {} });

describe("moyai setup", () => {
  it("ほかのサーバーと欄はそのままに、moyai の行だけを足す。前の設定は .bak に残す", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-setup-"));
    const path = join(dir, "claude_desktop_config.json");
    const before = { mcpServers: { other: { command: "x", args: [] } }, theme: "dark" };
    writeFileSync(path, JSON.stringify(before));
    expect(await run(path, "はい")).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ mcpServers: { other: { command: "x", args: [] }, moyai: LINE }, theme: "dark" });
    expect(JSON.parse(readFileSync(`${path}.bak`, "utf8"))).toEqual(before);
    // 同じ中身なら変えない
    expect(withMoyai(JSON.parse(readFileSync(path, "utf8")), LINE)).toBeNull();
  });

  it("「はい」でなければ書かない。端末でなければ断る。読めない設定には書かない。無ければ作る", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-setup-"));
    const path = join(dir, "claude_desktop_config.json");
    writeFileSync(path, "{}");
    expect(await run(path, "いいえ")).toBe(0);
    expect(readFileSync(path, "utf8")).toBe("{}");
    expect(await run(path, "はい", { isTTY: false })).toBe(3);
    expect(readFileSync(path, "utf8")).toBe("{}");
    writeFileSync(path, "{ broken");
    expect(await run(path, "はい")).toBe(1);
    expect(readFileSync(path, "utf8")).toBe("{ broken");
    const fresh = join(dir, "sub", "claude_desktop_config.json");
    expect(await run(fresh, "はい")).toBe(0);
    expect(JSON.parse(readFileSync(fresh, "utf8"))).toEqual({ mcpServers: { moyai: LINE } });
    expect(existsSync(`${fresh}.bak`)).toBe(false);
  });

  it("設定のファイルの場所（OS ごと）", () => {
    expect(claudeConfigPath({ APPDATA: "C:\\Users\\a\\AppData\\Roaming" }, "win32")).toBe(join("C:\\Users\\a\\AppData\\Roaming", "Claude", "claude_desktop_config.json"));
    expect(claudeConfigPath({ MOYAI_CLAUDE_CONFIG: join(tmpdir(), "c.json") }, "win32")).toBe(join(tmpdir(), "c.json"));
  });
});

// チャットから入れる（運営者の決定 11-06）：--yes・--target code・--name。書く前に、何をどこに書くか（.bak を残すこと）を出す
describe("moyai setup をチャットから走らせる", () => {
  const NOT_TTY = { isTTY: false };
  const tmp = () => (dir = mkdtempSync(join(tmpdir(), "moyai-setup-")));
  const runArgs = (argv: string[], o: { path: string; stateDir: string; stdin?: { isTTY?: boolean } }) => {
    const said: string[] = [];
    const asked: string[] = [];
    const p = setupCli({ argv, stdin: o.stdin ?? NOT_TTY, path: o.path, stateDir: o.stateDir, line: LINE, ask: async (q) => (asked.push(q), "いいえ"), say: (m) => said.push(m) });
    return p.then((code) => ({ code, said, asked }));
  };

  it("--yes：端末でなくても、聞かずに書く。書く前に、足す行・設定の場所・.bak を残すことを出す", async () => {
    const d = tmp();
    const path = join(d, "claude_desktop_config.json");
    const before = { mcpServers: { other: { command: "x", args: [] } } };
    writeFileSync(path, JSON.stringify(before));
    const r = await runArgs(["--yes"], { path, stateDir: join(d, "state") });
    expect(r.code).toBe(0);
    expect(r.asked).toEqual([]);
    expect(JSON.parse(readFileSync(path, "utf8")).mcpServers.moyai).toEqual(LINE);
    expect(JSON.parse(readFileSync(`${path}.bak`, "utf8"))).toEqual(before);
    const text = r.said.join("\n");
    const at = (s: string) => text.indexOf(s);
    expect(at(path)).toBeGreaterThanOrEqual(0);
    expect(at(`${path}.bak に残します`)).toBeGreaterThan(at(SETUP_TEXT.change));
    expect(at(SETUP_TEXT.written(`${path}.bak`))).toBeGreaterThan(at(`${path}.bak に残します`));
    expect(text).toContain(JSON.stringify(LINE));
  });

  it("--yes が無く端末でもなければ、書く中身だけを出して何も書かない（名前も書かない）", async () => {
    const d = tmp();
    const path = join(d, "claude_desktop_config.json");
    const stateDir = join(d, "state");
    const r = await runArgs(["--name", "【架空】山田"], { path, stateDir });
    expect(r.code).toBe(3);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(join(stateDir, "settings.json"))).toBe(false);
    expect(r.said.join("\n")).toContain(SETUP_TEXT.notTerminal);
    expect(r.said.join("\n")).toContain("「【架空】山田」を置きます");
  });

  it("--target code：Claude Code に渡す 1 行（.mcp.json か claude mcp add）を出し、Claude Desktop の設定には書かない", async () => {
    const d = tmp();
    const path = join(d, "claude_desktop_config.json");
    const r = await runArgs(["--target", "code", "--yes"], { path, stateDir: join(d, "state") });
    expect(r.code).toBe(0);
    expect(existsSync(path)).toBe(false);
    const text = r.said.join("\n");
    expect(text).toContain(".mcp.json");
    expect(text).toContain(claudeCodeAddLine(LINE));
    expect(claudeCodeAddLine(LINE)).toBe('claude mcp add --scope user moyai -- C:\\node\\node.exe C:\\moyai\\dist\\cli.js mcp');
    expect(claudeCodeAddLine({ command: "C:\\Program Files\\nodejs\\node.exe", args: ["C:\\a b\\cli.js", "mcp"] })).toBe(
      'claude mcp add --scope user moyai -- "C:\\Program Files\\nodejs\\node.exe" "C:\\a b\\cli.js" mcp',
    );
  });

  it("--name：settings.json の name を置く（ほかの欄はそのまま）。40 字まで。空・41 字・使えない字は断り、何も書かない", async () => {
    const d = tmp();
    const path = join(d, "claude_desktop_config.json");
    const stateDir = join(d, "state");
    mkdirSync(stateDir, { recursive: true });
    const root = join(d, "保存先");
    writeFileSync(join(stateDir, "settings.json"), JSON.stringify({ v: 1, root, ledger: null, name: null }));
    const r = await runArgs(["--target=code", "--name", "  【架空】山田  ", "--yes"], { path, stateDir });
    expect(r.code).toBe(0);
    expect(JSON.parse(readFileSync(join(stateDir, "settings.json"), "utf8"))).toEqual({ v: 1, root, ledger: null, name: "【架空】山田" });
    expect(readSettings(stateDir).name).toBe("【架空】山田");
    // 同じ名前なら書かない
    const again = await runArgs(["--target", "code", "--name", "【架空】山田", "--yes"], { path, stateDir });
    expect(again.said.join("\n")).toContain(SETUP_TEXT.nameSame("【架空】山田"));
    // 40 字までは置ける
    const forty = "あ".repeat(40);
    expect((await runArgs(["--target", "code", "--name", forty, "--yes"], { path, stateDir })).code).toBe(0);
    expect(readSettings(stateDir).name).toBe(forty);
    for (const bad of ["", "   ", "あ".repeat(41), "a/b", "..", "名前:x"]) {
      const b = await runArgs(["--name", bad, "--yes"], { path, stateDir });
      expect(b.code, bad).toBe(2);
      expect(b.said, bad).toEqual([SETUP_TEXT.badName]);
    }
    expect(readSettings(stateDir).name).toBe(forty);
    expect(existsSync(path)).toBe(false);
  });

  it("引数の形が違えば 2（何も書かない）", async () => {
    expect(parseSetupArgs(["--target", "web"])).toEqual({ error: "bad_args" });
    expect(parseSetupArgs(["--name"])).toEqual({ error: "bad_args" });
    expect(parseSetupArgs(["--force"])).toEqual({ error: "bad_args" });
    expect(parseSetupArgs([])).toEqual({ target: "desktop", yes: false, name: null, waitDesktop: false });
    expect(parseSetupArgs(["-y", "--target=code", "--name=甲"])).toEqual({ target: "code", yes: true, name: "甲", waitDesktop: false });
  });
});

describe("moyai setup：Claude Desktop が開いているとき", () => {
  const argv = ["--target", "desktop", "--yes"];
  it("書いたあと、Desktop が動いていれば見張りを起こし、開き直しを頼む字を出す。動いていなければ起こさない", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-setup-"));
    const path = join(dir, "claude_desktop_config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: {} }));
    let spawned = 0;
    const said: string[] = [];
    expect(await setupCli({ argv, path, line: LINE, say: (m) => said.push(m), desktopRunning: () => true, spawnWatcher: () => spawned++ })).toBe(0);
    expect(spawned).toBe(1);
    expect(said).toContain(SETUP_TEXT.desktopOpen);
    expect(JSON.parse(readFileSync(path, "utf8")).mcpServers.moyai).toEqual(LINE);
    writeFileSync(path, JSON.stringify({ mcpServers: {} }));
    expect(await setupCli({ argv, path, line: LINE, say: () => {}, desktopRunning: () => false, spawnWatcher: () => spawned++ })).toBe(0);
    expect(spawned).toBe(1);
  });

  it("見張り（--wait-desktop）は Desktop が閉じるのを待ってから、そのときの設定に足す。見張りは見張りを起こさない", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-setup-"));
    const path = join(dir, "claude_desktop_config.json");
    let checks = 0;
    // Desktop が閉じるまでの間に、Desktop が自分の設定（moyai の無いもの）を書き直す
    const running = () => {
      checks++;
      if (checks === 2) writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "x", args: [] } }, preferences: { a: 1 } }));
      return checks < 3;
    };
    writeFileSync(path, JSON.stringify({ mcpServers: {} }));
    let spawned = 0;
    const code = await setupCli({ argv: [...argv, "--wait-desktop"], path, line: LINE, say: () => {}, desktopRunning: running, spawnWatcher: () => spawned++, waitMs: { poll: 1, settle: 1, limit: 10_000 } });
    expect(code).toBe(0);
    expect(spawned).toBe(0);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ mcpServers: { other: { command: "x", args: [] }, moyai: LINE }, preferences: { a: 1 } });
  });

  it("見張りは、上限まで Desktop が閉じなければ書かずに終える。--yes の無い見張りは断る", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-setup-"));
    const path = join(dir, "claude_desktop_config.json");
    writeFileSync(path, JSON.stringify({ mcpServers: {} }));
    const said: string[] = [];
    expect(await setupCli({ argv: [...argv, "--wait-desktop"], path, line: LINE, say: (m) => said.push(m), desktopRunning: () => true, waitMs: { poll: 1, settle: 1, limit: 5 } })).toBe(1);
    expect(said).toContain(SETUP_TEXT.waitGaveUp);
    expect(JSON.parse(readFileSync(path, "utf8")).mcpServers.moyai).toBeUndefined();
    expect(await setupCli({ argv: ["--target", "desktop", "--wait-desktop"], path, line: LINE, say: () => {} })).toBe(2);
  });

  it("設定の場所を指したときは、本物の Desktop を見ない（見張りを起こさない）", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-setup-"));
    const path = join(dir, "claude_desktop_config.json");
    let spawned = 0;
    expect(await setupCli({ argv, path, line: LINE, say: () => {}, spawnWatcher: () => spawned++ })).toBe(0);
    expect(spawned).toBe(0);
  });
});
