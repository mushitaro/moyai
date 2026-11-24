// MOYAI への困りごと・要望・開発の要件の道（運営者の困りごと 2026-11-18「Chat で開発要件を送ろうとしたら、GitHub のリポジトリに送ろうとした」）。
// AI 向けの文（instructions・1 段目の Skill のファイル・skill-moyai.ts・screen_set の説明）のどれにも、
// 「設定の『困りごと』に案を置き、人が送る。GitHub（Issue・PR・コメント）に直接書かない。ほかの道具があっても使わない」がある。
// 送る道具は無い（送るのは人だけの経路 app_feedback_send）。
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { FLOWS_SECTION, skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import { SCREEN_REFUSAL_TEXT, TOOLS, TOOL_NAMES } from "../../src/shared/tools";
import { HUMAN_ACTIONS } from "../../src/shared/routes";
import toolNames from "../../src/shared/tool-names.json";

const SKILL_FILE = readFileSync("skills/moyai/SKILL.md", "utf8").replace(/\r\n/g, "\n");
const TELL = "I put a draft in the Feedback field of Settings. Read the full text and press Send";

test("instructions：困りごと・要望・開発の要件は設定の「困りごと」に案を置き、人が送る。GitHub に直接書かない（ほかの道具でも）", () => {
  const rule = MCP_INSTRUCTIONS.split("\n").find((l) => l.startsWith("8. "))!;
  expect(rule).toBeDefined();
  for (const s of ["Troubles, requests and development requirements for MOYAI", "Feedback field of Settings", "feedbackDraft", "press Send", "Only a person sends", "Never write them to GitHub (issues, PRs, comments)", "even with other tools"]) expect(rule).toContain(s);
  for (const s of ["no file contents", "row values", "facility or company names", "keys", "paths"]) expect(rule).toContain(s);
  // 安全の決まりの並びの中（「Reply to the user in the user's language」のあと）
  expect(MCP_INSTRUCTIONS.indexOf("Reply to the user in the user's language")).toBeLessThan(MCP_INSTRUCTIONS.indexOf(rule));
  expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
});

test("1 段目の Skill（skill-moyai.ts と skills/moyai/SKILL.md）に、同じ決まりと、利用者に言う文がある", () => {
  for (const text of [skillMoyaiMarkdown(), SKILL_FILE]) {
    expect(text).toContain(MCP_INSTRUCTIONS.split("\n").find((l) => l.startsWith("8. "))!);
    expect(text).toContain("Reply to the user in the user's language");
    expect(text).toContain("screen_set feedbackDraft");
    expect(text).toContain(TELL);
    expect(text).toContain("moyai.app-feedback/0");
    expect(text).toContain("Never write MOYAI troubles, requests or development requirements to GitHub (issues, pull requests, comments) yourself, even if other tools");
  }
  expect(FLOWS_SECTION).toContain("MOYAI troubles, requests and development requirements");
});

test("screen_set の説明と答えの文：案を置く道・利用者に言う文・GitHub に書かない。送る道具は無い", () => {
  const d = TOOLS.screen_set.description;
  for (const s of ["development requirement for MOYAI", "feedbackDraft", TELL, "Only the user sends it", "never write them to GitHub (issues, pull requests, comments) yourself", "even if other tools"]) expect(d).toContain(s);
  expect(SCREEN_REFUSAL_TEXT.feedback_human_send).toContain(TELL);
  expect(SCREEN_REFUSAL_TEXT.feedback_human_send).toContain("Nothing was sent");
  expect(SCREEN_REFUSAL_TEXT.feedback_human_send).toContain("Do not write it to GitHub yourself");
  // AI の道具に、送るもの・GitHub に書くものは無い。送るのは人だけの経路
  for (const n of [...TOOL_NAMES, ...toolNames]) expect(n, n).not.toMatch(/send|feedback|github|issue|pull|comment/i);
  expect(HUMAN_ACTIONS).toContain("app_feedback_send");
});
