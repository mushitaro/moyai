// 1 段目の Skill（基本操作。docs/plan.md §2.17・§2.18.3）の文：MCP の instructions と同じ文から作る。
// MCP の instructions は Claude Code では効くが Claude Desktop では効かないので、同じ文を Skill のファイル（skills/moyai/SKILL.md）にも置き、
// skill_read でも渡す。片方だけを直さないよう、ファイルはこの関数から作り、試験（tests/contract/skill-moyai.test.ts）が一致を確かめる。
import { MCP_INSTRUCTIONS } from "./instructions";

export const SKILL_MOYAI_NAME = "moyai";

export function skillMoyaiMarkdown(): string {
  return [
    "---",
    `name: ${SKILL_MOYAI_NAME}`,
    "description: MOYAI（保全の計画の星取表を、利用者の PC の作業画面で作る道具）を MCP のツールで動かすときの基本操作と安全の決まり。MOYAI のツール（intake_survey など）を使う前に読む。",
    "---",
    "",
    "# MOYAI の基本操作（1 段目の Skill）",
    "",
    "標準の Skill で、利用者は編集できない。この文は MCP の instructions と同じ文から作っている（`src/shared/skill-moyai.ts`）。業界のパックの Skill（2 段目）と、施設・会社・担当者の読み方（3 段目）は、作業画面が選んでいる分だけを MOYAI のツールの結果で渡す。どの段の Skill も、下の安全の決まりを上書きしない。",
    "",
    ...MCP_INSTRUCTIONS.split("\n").flatMap((l) => [l, ""]),
  ].join("\n");
}
