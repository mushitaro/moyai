// AI を入れた 1 回（docs/plan.md §2.6）：見ていない様式を、Claude が会話で作った読み方（3 段目の Skill の下書き）を当てて読む。
// MOYAI_AI_ROUND=<組のフォルダ> MOYAI_AI_OUT=<回のフォルダ> のときだけ走る。回のフォルダの readings.json（ReadingSkill の並び）を下書きとして当て、
// Claude が見るもの（intake_survey と同じ要約）を survey.json に、物差しを result.json に書く。
// Claude の役は survey.json だけを見て規則を書く。質問には、正解だけを見る台本（harness.ts）が人の代わりに答える。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReadingSkill, type LoadedReading } from "../../src/import/reading";
import { loadSet } from "./contract";
import { runSet } from "./harness";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

describe("import.heldout：AI を入れた 1 回", () => {
  const dir = process.env.MOYAI_AI_ROUND;
  const out = process.env.MOYAI_AI_OUT;
  it.runIf(!!dir && !!out)("Claude が会話で作った読み方を当てて読み、要約と物差しを書く", async () => {
    const set = loadSet(dir!);
    const path = join(out!, "readings.json");
    const skills = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]).map((x) => ReadingSkill.parse(x)) : [];
    const readings: LoadedReading[] = skills.map((skill) => ({ skill, version: "draft", path: null, approved: false, draft: true }));
    const { result, survey, analysis } = await runSet(set, { readings });
    mkdirSync(out!, { recursive: true });
    writeFileSync(join(out!, "survey.json"), `${JSON.stringify({ ...survey, ruleHits: skills.flatMap((k) => k.rules.map((r) => ({ id: r.id, hits: analysis.ruleHits.count(r.id) }))) }, null, 1)}\n`, "utf8");
    writeFileSync(
      join(out!, "result.json"),
      `${JSON.stringify({ schema: "moyai.heldout.ai-round/0", set: set.truth.set, reader: { commit: git("rev-parse", "HEAD"), src: git("rev-parse", "HEAD:src"), dirty: git("status", "--porcelain", "--", "src", "packs") !== "" }, rules: skills.reduce((n, k) => n + k.rules.length, 0), result }, null, 1)}\n`,
      "utf8",
    );
    console.log(`AI を入れた回 ${set.truth.set}：規則 ${skills.reduce((n, k) => n + k.rules.length, 0)}・②前 ${result.unresolvedBefore}→後 ${result.unresolvedAfter}・⑤ ${result.asked}・計画 ${result.planMade ? "作った" : "作らなかった"}`);
    expect(result.files.length).toBeGreaterThan(0);
  }, 600_000);
});
