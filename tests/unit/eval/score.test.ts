// API を使わない Skill の文の採点（S-C4）：解く人に渡す文に正解が無い・コードの採点 6 種で採点する・API を呼ばずキーを読まない
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { evalCli } from "../../../src/eval/cli";
import { joinSkills, scoreAnswers, skillPathsOf, suiteShaOf, writePrompts } from "../../../src/eval/score";
import type { EvalCase, Suite } from "../../../src/eval/types";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const SUITE = "waste-incineration";
const suite: Suite = JSON.parse(readFileSync(join(REPO, "eval", SUITE, "suite.json"), "utf8"));
const jsonl = (p: string): EvalCase[] => readFileSync(p, "utf8").split(/\r?\n/).filter((l) => l.trim()).map((l) => JSON.parse(l));
const train = jsonl(join(REPO, "eval", SUITE, "cases", "train.jsonl"));
const test = jsonl(join(REPO, "eval", SUITE, "cases", "test.jsonl"));
const cases = [...train, ...test];

/** 正解どおりの答え（試験のためだけに、checks から作る） */
function perfect(c: EvalCase): string {
  const answers: Record<string, unknown> = {};
  const notInRecord: string[] = [];
  for (const ch of c.checks) {
    if (ch.key === undefined) continue;
    if (ch.grader === "not_in_record") {
      if (ch.expect) notInRecord.push(ch.key);
    } else answers[ch.key] = ch.expect ?? null;
  }
  return JSON.stringify({ answers, notInRecord, sources: [] });
}

let dir = "";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("API を使わない Skill の文の採点", () => {
  it("解く人に渡す文：問題の数だけあり、正解（checks・expect）を書かない。試験用の問題が Skill の文に入っていれば書き出さない", () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-eval-prompts-"));
    const r = writePrompts({ cases, test, skill: "# 試しの Skill\n記録に無いことは記録に無いと答える。", terms: [], outDir: dir, suite: SUITE, skillSha: "x" });
    expect(r.ok).toBe(true);
    expect(readdirSync(join(dir, "cases"))).toHaveLength(cases.length);
    const all = [readFileSync(join(dir, "system.txt"), "utf8"), readFileSync(join(dir, "index.json"), "utf8"), ...readdirSync(join(dir, "cases")).map((f) => readFileSync(join(dir, "cases", f), "utf8"))].join("\n");
    for (const w of ['"checks"', '"expect"', '"grader"', "no_guess", "not_in_record"]) expect(all).not.toContain(w);
    const leaked = writePrompts({ cases, test, skill: test[0]!.record, terms: [], outDir: join(dir, "x"), suite: SUITE, skillSha: "x" });
    expect(leaked).toMatchObject({ ok: false, reason: "leaked" });
    expect(writePrompts({ cases, test, skill: "施設のなまえ", terms: ["施設のなまえ"], outDir: join(dir, "y"), suite: SUITE, skillSha: "x" })).toMatchObject({ ok: false, reason: "properNoun" });
  });

  it("コードの採点 6 種で採点する：正解どおりなら全部が通り、答えの無い問題・形の崩れた答えは落ちる", () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-eval-score-"));
    for (const c of cases) writeFileSync(join(dir, `${c.id}.txt`), perfect(c));
    const base = { suite, suiteSha: "s", cases, answersDir: dir, skills: [], skillSha: "k", label: "試し", now: new Date("2026-11-12T00:00:00Z") };
    const all = scoreAnswers(base);
    expect(all.pass).toBe(cases.length);
    expect(all.answered).toBe(cases.length);
    expect(Object.keys(all.perGrader).sort()).toEqual(["fiscal_year", "identity", "json", "no_guess", "not_in_record", "source"]);
    rmSync(join(dir, `${cases[0]!.id}.txt`));
    writeFileSync(join(dir, `${cases[1]!.id}.txt`), "答えは次のとおりです。");
    const some = scoreAnswers(base);
    expect(some.pass).toBe(cases.length - 2);
    expect(some.failing).toEqual([cases[0]!.id, cases[1]!.id]);
  });

  it("文の指紋は 1 段目＋業種の文をつないだもの。改行の違い（CRLF）では変わらない", () => {
    expect(skillPathsOf("p")).toEqual(["skills/moyai/SKILL.md", "packs/p/SKILL.md"]);
    expect(joinSkills(["a\r\nb\r\n", "c"])).toBe(joinSkills(["a\nb", "c\n"]));
    expect(suiteShaOf(join(REPO, "eval"), SUITE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("score は API を呼ばず、キーを読まない：通信を止め、キーの変数を置いても採点して記録を書く", async () => {
    const src = readFileSync(join(REPO, "src", "eval", "score.ts"), "utf8");
    const code = src.split("\n").filter((l) => !l.trimStart().startsWith("//"));
    expect(code.filter((l) => l.startsWith("import")).join("\n")).not.toMatch(/anthropic|\.\/run|api-spend|node:https?/);
    for (const w of ["ANTHROPIC_API_KEY", "fetch(", "process.env"]) expect(code.join("\n")).not.toContain(w);
    dir = mkdtempSync(join(tmpdir(), "moyai-eval-cli-"));
    mkdirSync(join(dir, "answers"));
    for (const c of cases) writeFileSync(join(dir, "answers", `${c.id}.txt`), perfect(c));
    const fetchSpy = vi.fn(() => {
      throw new Error("通信してはいけない");
    });
    vi.stubGlobal("fetch", fetchSpy);
    vi.stubEnv("ANTHROPIC_API_KEY", "これは使われないはずの値");
    const record = join(dir, "record.json");
    const exit = await evalCli(["score", "--suite", SUITE, "--answers", join(dir, "answers"), "--label", "試し", "--record", record], REPO);
    expect(exit).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    const rec = JSON.parse(readFileSync(record, "utf8"));
    expect(rec).toMatchObject({ schema: "moyai.eval.skill-score/0", pack: "waste-incineration", pass: cases.length, cases: cases.length });
    expect(rec.skills.map((s: { path: string }) => s.path)).toEqual(skillPathsOf("waste-incineration"));
    expect(JSON.stringify(rec)).not.toContain("これは使われないはずの値");
    expect(existsSync(join(REPO, "eval", "skill-scores", "waste-incineration", "x.json"))).toBe(false);
  });
});
