// The text the AI reads through MCP is English (global support, stage 1b, 2026-11-16).
// Collects: every tool's title and description, every string in the JSON Schema of every input and output
// (descriptions and enum values), the MCP instructions, the tier-1 Skill, the notes and refusal texts the tools
// return to the AI, and the Skill files in SKILL_FILES. Any run of Japanese characters must be listed in
// tests/fixtures/ai-text-ja-allow.json with a reason; an entry that no text uses fails too (the list stays honest).
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { z } from "zod";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import * as tools from "../../src/shared/tools";
import { RELAY_TEXT } from "../../src/cli/relay";
import { ERRORS } from "../../src/shared/errors";

/** Skill files the AI reads (tier 1 and the pack Skills). Add a path here to check it. */
export const SKILL_FILES = ["skills/moyai/SKILL.md"];

const ALLOW_PATH = "tests/fixtures/ai-text-ja-allow.json";
/** A run: a maximal run of Japanese characters (kanji, kana, CJK punctuation, full-width forms) */
const RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯ー]+/gu;

function stringsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => stringsOf(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) (out.push(k), stringsOf(x, out));
  return out;
}

function collect(): { where: string; text: string }[] {
  const texts: { where: string; text: string }[] = [];
  for (const [name, d] of Object.entries(tools.TOOLS)) {
    texts.push({ where: `${name}.title`, text: d.title }, { where: `${name}.description`, text: d.description });
    for (const [side, s] of [["input", d.input], ["output", d.output]] as const)
      for (const t of stringsOf(z.toJSONSchema(s, { unrepresentable: "any" }))) texts.push({ where: `${name}.${side}`, text: t });
  }
  texts.push({ where: "MCP_INSTRUCTIONS", text: MCP_INSTRUCTIONS }, { where: "skillMoyaiMarkdown", text: skillMoyaiMarkdown() });
  for (const [k, v] of Object.entries(tools)) {
    if (/_NOTE$/.test(k) && typeof v === "string") texts.push({ where: k, text: v });
    if (/_TEXT$/.test(k) && v && typeof v === "object" && k !== "TEMPLATE_TEXT") for (const t of stringsOf(v)) texts.push({ where: k, text: t });
  }
  texts.push({ where: "readingRuleExamplesText", text: tools.readingRuleExamplesText() });
  texts.push({ where: "RELAY_TEXT.replaced", text: RELAY_TEXT.replaced("http://127.0.0.1:43110/") });
  for (const [k, e] of Object.entries(ERRORS)) if (e.to === "ai") texts.push({ where: `ERRORS.${k}`, text: e.text });
  for (const p of SKILL_FILES) texts.push({ where: p, text: readFileSync(p, "utf8") });
  return texts;
}

interface Allow {
  schema: string;
  entries: { text: string; reason: string }[];
}

test("the text the AI reads is English; Japanese only where the allow list gives a reason", () => {
  const allow = JSON.parse(readFileSync(ALLOW_PATH, "utf8")) as Allow;
  expect(allow.schema).toBe("moyai.ai-text-ja-allow/0");
  for (const e of allow.entries) expect(e.reason.trim().length, `reason for ${e.text}`).toBeGreaterThan(10);
  const allowed = new Set(allow.entries.map((e) => e.text));
  const texts = collect();
  expect(texts.length).toBeGreaterThan(100);
  const used = new Set<string>();
  const bad: string[] = [];
  for (const { where, text } of texts)
    for (const m of text.matchAll(RUN)) {
      if (allowed.has(m[0])) used.add(m[0]);
      else bad.push(`${where}: ${m[0]}`);
    }
  expect([...new Set(bad)]).toEqual([]);
  expect(allow.entries.map((e) => e.text).filter((t) => !used.has(t))).toEqual([]);
});

test("the AI is told to reply in the user's language", () => {
  expect(MCP_INSTRUCTIONS).toContain("Reply to the user in the user's language");
  expect(tools.TOOLS.intake_survey.description).toContain("Reply to the user in the user's language");
});
