// AI に渡す Skill（docs/plan.md §2.17・§2.18.3）：作業画面が選んでいる分だけ。どれを渡すかを AI に選ばせない。
// 1 段：基本操作（MCP の instructions と同じ文。src/shared/skill-moyai.ts）。2 段：選んでいるパックの packs/<パック>/SKILL.md。
// 3 段：作業画面が当てている読み方（承認済みと、作業中の版の下書き）の SKILL.md の文。
// どの結果にも目録（段・名前・版）だけを添え、本文は intake_survey（part: skills）で返す。版は本文の指紋（同じ本文なら同じ版）。
import type { LoadedReading } from "../import/reading";
import { skillMarkdown } from "../import/reading";
import { fnv64 } from "../plan/diff";
import { SKILL_MOYAI_NAME, skillMoyaiMarkdown } from "../shared/skill-moyai";

const PACK_SKILLS = import.meta.glob<string>("../../packs/*/SKILL.md", { eager: true, query: "?raw", import: "default" });

export interface SkillText {
  tier: 1 | 2 | 3;
  name: string;
  version: string;
  text: string;
}

export function packSkill(packId: string): string | null {
  return PACK_SKILLS[`../../packs/${packId}/SKILL.md`] ?? null;
}

export function activeSkills(packId: string | null, readings: readonly LoadedReading[]): SkillText[] {
  const out: SkillText[] = [];
  const add = (tier: SkillText["tier"], name: string, text: string) => out.push({ tier, name, version: fnv64(text), text });
  add(1, SKILL_MOYAI_NAME, skillMoyaiMarkdown());
  const pack = packId ? packSkill(packId) : null;
  if (pack && packId) add(2, `pack:${packId}`, pack);
  for (const r of readings) add(3, r.draft ? `${r.skill.name}（下書き）` : r.skill.name, skillMarkdown(r.skill));
  return out;
}

export const skillCatalog = (s: readonly SkillText[]) => s.map(({ tier, name, version }) => ({ tier, name, version }));
