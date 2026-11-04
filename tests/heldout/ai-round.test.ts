// AI を入れた 1 回（docs/plan.md §2.6）：見ていない様式を、Claude が会話で作った読み方（3 段目の Skill の下書き）を当てて読む。
// MOYAI_AI_ROUND=<組のフォルダ> MOYAI_AI_OUT=<回のフォルダ> のときだけ走る。回のフォルダ（組の measured/ の下に置く。組のハッシュに入れないため）の readings.json（ReadingSkill の並び）を下書きとして当て、
// Claude が見るもの（intake_survey と同じ要約）を survey.json に、物差しを result.json に書く。
// 指示書 §5 の形の組（施設ごとのフォルダ）は、施設ごとに <回>/<施設>/readings.json を当て、<回>/<施設>/survey.json・result.json を書く。
// MOYAI_AI_FACILITY=<施設>（, で区切る）なら、その施設だけを走らせる（組の result.json は、すべての施設を走らせたときだけ書く）。
// Claude の役は survey.json だけを見て規則を書く。質問には、正解だけを見る台本（harness.ts）が人の代わりに答える。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ReadingSkill, type LoadedReading } from "../../src/import/reading";
import { loadAnswerSet, mergeResults } from "./answer";
import { loadSet } from "./contract";
import { runSet, type SetResult } from "./harness";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const loadReadings = (dir: string) => {
  const path = join(dir, "readings.json");
  const skills = existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as unknown[]).map((x) => ReadingSkill.parse(x)) : [];
  const readings: LoadedReading[] = skills.map((skill) => ({ skill, version: "draft", path: null, approved: false, draft: true }));
  return { skills, readings };
};

const ruleCount = (skills: ReadingSkill[]) => skills.reduce((n, k) => n + k.rules.length, 0);

const write = (dir: string, name: string, value: unknown) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 1)}\n`, "utf8");
};

const reader = () => ({ commit: git("rev-parse", "HEAD"), src: git("rev-parse", "HEAD:src"), dirty: git("status", "--porcelain", "--", "src", "packs") !== "" });

const line = (name: string, rules: number, r: SetResult) => `AI を入れた回 ${name}：規則 ${rules}・②前 ${r.unresolvedBefore}→後 ${r.unresolvedAfter}・⑤ ${r.asked}（開いたまま ${r.openAtEnd.length}）・計画 ${r.planMade ? "作った" : "作らなかった"}・⑥ ${r.recovery.together}/${r.recovery.denominator}`;

describe("import.heldout：AI を入れた 1 回", () => {
  const dir = process.env.MOYAI_AI_ROUND;
  const out = process.env.MOYAI_AI_OUT;
  it.runIf(!!dir && !!out)("Claude が会話で作った読み方を当てて読み、要約と物差しを書く", async () => {
    if (existsSync(join(dir!, "truth.json"))) {
      const set = loadSet(dir!);
      const { skills, readings } = loadReadings(out!);
      const { result, survey, analysis } = await runSet(set, { readings });
      write(out!, "survey.json", { ...survey, ruleHits: skills.flatMap((k) => k.rules.map((r) => ({ id: r.id, hits: analysis.ruleHits.count(r.id) }))) });
      write(out!, "result.json", { schema: "moyai.heldout.ai-round/0", set: set.truth.set, reader: reader(), rules: ruleCount(skills), result });
      console.log(line(set.truth.set, ruleCount(skills), result));
      expect(result.files.length).toBeGreaterThan(0);
      return;
    }
    // 指示書 §5 の形の組：施設ごと（① の相手の事実は、組の measured/facts/<施設>__<資料>.facts.json）
    const { set, facilities } = loadAnswerSet(dir!);
    const only = process.env.MOYAI_AI_FACILITY?.split(",").map((s) => s.trim()).filter(Boolean);
    const factsDir = join(dir!, "measured", "facts");
    const factsOf = (key: string) => {
      const facts: Record<string, unknown> = {};
      const answers = join(dir!, key, "answer", "files");
      if (existsSync(factsDir) && existsSync(answers))
        for (const n of readdirSync(answers)) {
          const file = JSON.parse(readFileSync(join(answers, n), "utf8")).file as string;
          const p = join(factsDir, `${key}__${file.replace(/\//g, "__")}.facts.json`);
          if (existsSync(p)) facts[file] = JSON.parse(readFileSync(p, "utf8"));
        }
      return facts;
    };
    const per: { key: string; industry: string; rules: number; result: SetResult; unmapped: string[] }[] = [];
    for (const f of facilities) {
      if (only && !only.includes(f.key)) continue;
      const fdir = join(out!, f.key);
      const { skills, readings } = loadReadings(fdir);
      const { result, survey, analysis } = await runSet(f.set, { readings, facts: factsOf(f.key), facilityKey: f.set.world.facility.id });
      write(fdir, "survey.json", { ...survey, ruleHits: skills.flatMap((k) => k.rules.map((r) => ({ id: r.id, hits: analysis.ruleHits.count(r.id) }))) });
      write(fdir, "result.json", { schema: "moyai.heldout.ai-round/0", set, facility: f.key, industry: f.industry, reader: reader(), rules: ruleCount(skills), result });
      console.log(line(`${set}/${f.key}`, ruleCount(skills), result));
      per.push({ key: f.key, industry: f.industry, rules: ruleCount(skills), result, unmapped: f.unmapped });
    }
    expect(per.length).toBeGreaterThan(0);
    if (per.length === facilities.length) {
      const result = mergeResults(set, per);
      write(out!, "result.json", { schema: "moyai.heldout.ai-round/0", set, reader: reader(), rules: per.reduce((n, p) => n + p.rules, 0), result, facilities: per.map(({ key, industry, rules, result }) => ({ key, industry, rules, result })) });
      console.log(line(set, per.reduce((n, p) => n + p.rules, 0), result));
    }
  }, 1_200_000);
});
