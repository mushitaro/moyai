// AI は作業画面（127.0.0.1）を MOYAI の道具で読み・見せ、ブラウザの操作・画面の操作の道具では触らない（運営者の困りごと 2026-11-24：
// Claude が MOYAI の道具を使わず、Claude in Chrome で作業画面をクリックして取り込みの画面を開いた）。
// instructions（Claude Code）・1 段目の Skill（Claude Desktop）・intake_survey の説明（どの客でも）の 3 つに、この決まりがあることを確かめる。
// 文は英語で、「Reply to the user in the user's language」の形のまま。
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import { TOOLS } from "../../src/shared/tools";

const SKILL = readFileSync("skills/moyai/SKILL.md", "utf8").replace(/\r\n/g, "\n");
const lines = (t: string) => t.split("\n");

describe("作業画面は MOYAI の道具で読み、見せる。ブラウザ・画面の操作の道具で触らない", () => {
  test("instructions：作業画面は MOYAI の道具だけで、ブラウザ・computer use で開く・押す・読むことをしない。見せるのは intake_survey の show", () => {
    const rule = lines(MCP_INSTRUCTIONS).find((l) => l.includes("127.0.0.1"));
    expect(rule, "instructions に作業画面（127.0.0.1）の決まりの行がある").toBeDefined();
    expect(rule).toMatch(/only with MOYAI tools/);
    for (const w of ["intake_survey", "chart_rows"]) expect(rule).toContain(w);
    expect(rule).toMatch(/never open, click or read it with browser or computer-use tools/);
    expect(rule).toContain("Claude in Chrome");
    expect(rule).toContain("computer use");
    expect(rule).toContain("show: true");
    // 決まりは安全の決まりの中（番号の付いた行）にある
    expect(rule).toMatch(/^\d\. /);
  });

  test("instructions：MOYAI の道具が見えないときは、ブラウザに回らず、待って一覧を見直すか、Claude を開き直すよう 1 行で頼む", () => {
    const rule = lines(MCP_INSTRUCTIONS).find((l) => l.includes("127.0.0.1"))!;
    expect(rule).toMatch(/If MOYAI tools are missing.*?, do not use the browser/);
    expect(rule).toMatch(/list the tools again/);
    expect(rule).toMatch(/ask the user in one line to reopen Claude/);
  });

  test("instructions：「Reply to the user in the user's language」が先にあり、4,096 字の内", () => {
    const reply = MCP_INSTRUCTIONS.indexOf("Reply to the user in the user's language");
    expect(reply).toBeGreaterThanOrEqual(0);
    expect(reply).toBeLessThan(MCP_INSTRUCTIONS.indexOf("127.0.0.1"));
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  test("1 段目の Skill（SKILL.md）：instructions の決まりの行と、作業画面とブラウザの道具の節がある", () => {
    expect(SKILL).toBe(skillMoyaiMarkdown());
    expect(SKILL).toContain(lines(MCP_INSTRUCTIONS).find((l) => l.includes("127.0.0.1"))!);
    const at = SKILL.indexOf("### The work screen and browser tools");
    expect(at).toBeGreaterThan(0);
    const section = SKILL.slice(at, SKILL.indexOf("\n### ", at + 1));
    expect(section).toContain("only through MOYAI tools");
    for (const w of ["intake_survey", "chart_rows", "screen_set", "show: true"]) expect(section).toContain(w);
    expect(section).toMatch(/Never open, click, type in or read the work screen with browser or computer-use tools/);
    expect(section).toContain("Claude in Chrome");
    expect(section).toContain("computer use");
    expect(section).toMatch(/even if a browser tab is already open/);
    expect(section).toMatch(/If MOYAI tools are not listed[^.]*, do not switch to the browser/);
    expect(section).toMatch(/ask the user in one line to reopen Claude/);
    expect(SKILL).toContain("Reply to the user in the user's language");
  });

  test("1 段目の Skill：作業画面を開く手順は intake_survey の show で、ブラウザの道具では開かない", () => {
    const step = lines(SKILL).find((l) => l.startsWith("8. Open the work screen"));
    expect(step).toBeDefined();
    expect(step).toContain("intake_survey with show: true");
    expect(step).toContain("not with browser or computer-use tools");
  });

  test("道具の説明（intake_survey）：作業画面は MOYAI の道具で読み、ブラウザの道具で触らない。道具が見えなければ一覧を見直すか開き直しを頼む", () => {
    const d = TOOLS.intake_survey.description;
    expect(d).toContain("never open, click or read it with browser or computer-use tools (Claude in Chrome, computer use)");
    expect(d).toMatch(/do not switch to the browser: list the tools again or ask the user to reopen Claude/);
  });
});
