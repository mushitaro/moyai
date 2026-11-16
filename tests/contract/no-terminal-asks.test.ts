// Claude に渡す字に、利用者への端末の操作の頼み（Ctrl+C・ダブルクリック・端末で…）が無いか（運営者 11-07）。
// 見る字：MCP の instructions、1 段目の Skill（src/shared/skill-moyai.ts と skills/moyai/SKILL.md）、中継の字と中継の誤り、
// setup・uninstall が Claude のシェルに出す字（端末の人にだけ出す ask は除く）。
// 頼みの語は、「頼まない」「要らない」の文（禁じる文）の中にだけあってよい。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RELAY_TEXT } from "../../src/cli/relay";
import { SETUP_TEXT } from "../../src/cli/setup";
import { UNINSTALL_TEXT } from "../../src/cli/uninstall";
import { ERRORS } from "../../src/shared/errors";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { CHAT_INSTALL_SECTION, skillMoyaiMarkdown } from "../../src/shared/skill-moyai";

// AI が読む文は英語（グローバル対応 1b、2026-11-16）。setup・uninstall の端末の字は日本語のままなので、両方の語で見る
const ASKS = ["Ctrl+C", "ダブルクリック", "端末で", "start-moyai", ".cmd を", ".bat を", "double-click", "in a terminal", ".cmd", ".bat"];
const DENY = /頼まない|頼みません|要らない|要りません|させない|させません|もらわない|Do not ask|do not ask|is needed\b.*\bno\b|no \"yes\" in a terminal is needed/;

/** 字の一覧を文に分ける（。・英語の文の終わりと改行で） */
const sentences = (text: string): string[] =>
  text
    .split(/。|\n|(?<=[a-z)"])\. (?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean);

/** 値が関数なら、見本の値で字にする */
function textsOf(o: Record<string, unknown>, skip: readonly string[] = []): string[] {
  return Object.entries(o)
    .filter(([k]) => !skip.includes(k))
    .map(([, v]) => (typeof v === "function" ? (v as (...a: unknown[]) => string)("X", "Y") : String(v)));
}

const CLAUDE_TEXTS: Record<string, string[]> = {
  instructions: [MCP_INSTRUCTIONS],
  skill: [skillMoyaiMarkdown()],
  skillFile: [readFileSync("skills/moyai/SKILL.md", "utf8")],
  relay: [...textsOf(RELAY_TEXT), ...Object.values(ERRORS).filter((e) => e.from === "relay").map((e) => e.text)],
  setup: textsOf(SETUP_TEXT, ["ask"]),
  uninstall: textsOf(UNINSTALL_TEXT, ["ask"]),
};

describe("Claude に渡す字に、端末の操作の頼みが無い", () => {
  it.each(Object.keys(CLAUDE_TEXTS))("%s", (name) => {
    for (const text of CLAUDE_TEXTS[name]!) {
      for (const s of sentences(text)) {
        for (const w of ASKS) if (s.includes(w)) expect(s, `「${w}」を頼む文`).toMatch(DENY);
      }
    }
  });

  it("1 段目の Skill は、端末の操作を頼まないこと・setup は Claude が --yes で走らせること・Desktop の開き直しの 1 行・古い橋渡しは中継が替えることを書く", () => {
    const s = sentences(CHAT_INSTALL_SECTION);
    const deny = s.find((x) => x.includes("Ctrl+C") && x.includes("double-click") && x.includes(".cmd or .bat") && x.includes("open a terminal"));
    expect(deny).toMatch(/^Do not ask/);
    expect(CHAT_INSTALL_SECTION).toContain("Claude runs it with `--yes`");
    expect(CHAT_INSTALL_SECTION).toContain("no \"yes\" in a terminal is needed");
    expect(CHAT_INSTALL_SECTION).toContain("Desktop must be reopened once");
    expect(CHAT_INSTALL_SECTION).toContain("the relay stops the previous version and starts this version's bridge");
    expect(CHAT_INSTALL_SECTION).toContain("reload the work screen");
  });

  it("setup・uninstall の --yes の無いときの字は、チャットで見せて --yes で Claude が走らせると書き、端末が要るとは書かない", () => {
    for (const t of [SETUP_TEXT.notTerminal, UNINSTALL_TEXT.notTerminal]) {
      expect(t).toContain("利用者にチャットで見せ");
      expect(t).toContain("--yes を付けて Claude が走らせ");
      expect(t.startsWith("端末")).toBe(false);
      expect(t).not.toContain("端末で");
    }
  });

  it("ポートが使われているときの字は「ほかの道具が使っています」の形で、Ctrl+C・端末を頼まない", () => {
    const t = ERRORS.bridge_port_taken.text;
    expect(t).toContain("Another tool is using port {port}");
    for (const w of ["Ctrl+C", "terminal", "command", "double-click"]) expect(t).not.toContain(w);
  });
});
