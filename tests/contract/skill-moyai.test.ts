// skills/moyai/SKILL.md（1 段目の Skill）が、MCP の instructions と同じ文から作ったものと同じか（docs/plan.md §2.18.3）。
// 作り直すとき：MOYAI_WRITE_DOCS=1 npx vitest run tests/contract/skill-moyai.test.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";

const PATH = "skills/moyai/SKILL.md";

test("skills/moyai/SKILL.md は MCP の instructions と同じ文から作ったものと同じで、決まりの文をどれも含む", () => {
  const text = skillMoyaiMarkdown();
  if (process.env.MOYAI_WRITE_DOCS === "1") {
    mkdirSync("skills/moyai", { recursive: true });
    writeFileSync(PATH, text);
  }
  expect(readFileSync(PATH, "utf8").replace(/\r\n/g, "\n")).toBe(text);
  for (const line of MCP_INSTRUCTIONS.split("\n")) expect(text).toContain(line);
});
