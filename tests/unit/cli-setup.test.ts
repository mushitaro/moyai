// moyai setup（docs/plan.md §2.12・§8 の 7）：Claude Desktop の設定に moyai の 1 行だけを足す。ほかのサーバーは消さない。
// 端末でなければ断り、「はい」でなければ書かない。前の設定は .bak に残す。読めない設定には書かない
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { claudeConfigPath, setupCli, withMoyai } from "../../src/cli/setup";

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
