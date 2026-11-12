// Skill の文の採点を、API を使わずにする道（柱 C・S-C4。運営者の判断 #23 の 2、2026-11-12）。
// 開発の作業役のセッションが問題を解いて答えをファイルに書き、ここがコードの採点 6 種（grade.ts。eval run と同じ）で採点して記録を置く。
// - prompts：問題の組から、解く人に渡す文だけ（system＝前置き＋Skill の文、user＝記録＋問い＋答え方）を書き出す。正解（checks）は書かない。
// - score：答えのファイル（<問題の id>.txt か .json。中身は答えの文そのまま）を採点し、eval/skill-scores/<パック>/<文の指紋の頭 16 字>.json に記録を書く。
// 採点する文は「1 段目（skills/moyai/SKILL.md）＋その業種の Skillパック（packs/<パック>/SKILL.md）」をこの順に空行でつないだもの。どちらを直しても指紋が変わる。
// ここは API を呼ばない・キーを読まない（@anthropic-ai/sdk を引かない。試験 tests/unit/eval/score.test.ts が確かめる）。判定はコードがする。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gradeCase } from "./grade";
import { countEvalProperNouns, leakedTestCases, sha256, systemText, userText } from "./prompt";
import type { EvalCase, GraderId, Suite } from "./types";

export const SCORE_SCHEMA = "moyai.eval.skill-score/0";
export const PROMPTS_SCHEMA = "moyai.eval.prompts/0";

/** 採点する Skill の文の並び（リポジトリの根からの道）。scripts/skill-scores/check.mjs も同じ並び */
export const skillPathsOf = (pack: string): string[] => ["skills/moyai/SKILL.md", `packs/${pack}/SKILL.md`];

/** 並びの文を、空行でつないだ 1 つの文にする（改行は LF にそろえる：Windows で取り出しても指紋が変わらないように） */
export function joinSkills(texts: string[]): string {
  return texts.map((t) => t.replace(/\r\n/g, "\n").trim()).join("\n\n");
}

/** 問題の組の指紋：suite.json と cases の 2 つのファイル（改行は LF にそろえる） */
export function suiteShaOf(evalDir: string, name: string): string {
  const f = (p: string) => (existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : "");
  return sha256([f(join(evalDir, name, "suite.json")), f(join(evalDir, name, "cases", "train.jsonl")), f(join(evalDir, name, "cases", "test.jsonl"))].join("\n\u0000\n"));
}

export interface SkillScore {
  schema: typeof SCORE_SCHEMA;
  pack: string;
  suite: string;
  suiteSha: string;
  /** 採点した文（並び）と、その指紋 */
  skills: { path: string; sha256: string }[];
  skillSha: string;
  label: string | null;
  at: string;
  cases: number;
  answered: number;
  pass: number;
  perRule: Record<string, { pass: number; total: number }>;
  perGrader: Record<string, { pass: number; total: number }>;
  /** 落ちた問題の id（並びは問題の組の順） */
  failing: string[];
}

export type PromptsResult = { ok: true; files: number; outbound: number } | { ok: false; reason: "leaked"; ids: string[] } | { ok: false; reason: "properNoun"; hits: number };

/** 解く人に渡す文を書き出す（正解は書かない）。eval run と同じ確かめ（試験用の問題の混入・固有名詞）を通す */
export function writePrompts(i: { cases: EvalCase[]; test: EvalCase[]; skill: string; terms: string[]; outDir: string; suite: string; skillSha: string }): PromptsResult {
  const leaked = leakedTestCases(i.skill, i.test);
  if (leaked.length) return { ok: false, reason: "leaked", ids: leaked };
  const system = systemText(i.skill);
  const users = i.cases.map((c) => userText(c));
  const all = [system, ...users].join("\n");
  const pn = countEvalProperNouns(all, i.terms);
  if (pn.hits) return { ok: false, reason: "properNoun", hits: pn.hits };
  mkdirSync(join(i.outDir, "cases"), { recursive: true });
  writeFileSync(join(i.outDir, "system.txt"), `${system}\n`);
  i.cases.forEach((c, k) => writeFileSync(join(i.outDir, "cases", `${c.id}.txt`), `${users[k]}\n`));
  const index = { schema: PROMPTS_SCHEMA, suite: i.suite, skillSha: i.skillSha, ids: i.cases.map((c) => c.id), how: "system.txt を Skill として読み、cases/<id>.txt の問いに答える。答えは answers/<id>.txt に、答え方のとおりの JSON だけを書く。" };
  writeFileSync(join(i.outDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  return { ok: true, files: i.cases.length, outbound: all.length };
}

/** 答えのファイルを読む（無ければ null：落ち） */
export function readAnswer(dir: string, id: string): string | null {
  for (const ext of [".txt", ".json"]) {
    const p = join(dir, `${id}${ext}`);
    if (existsSync(p)) return readFileSync(p, "utf8");
  }
  return null;
}

/** 採点して記録を作る（書くのは呼ぶ側） */
export function scoreAnswers(i: { suite: Suite; suiteSha: string; cases: EvalCase[]; answersDir: string; skills: { path: string; sha256: string }[]; skillSha: string; label: string | null; now: Date }): SkillScore {
  const perRule: SkillScore["perRule"] = {};
  const perGrader: SkillScore["perGrader"] = {};
  const failing: string[] = [];
  let pass = 0;
  let answered = 0;
  for (const c of i.cases) {
    const text = readAnswer(i.answersDir, c.id);
    if (text !== null) answered++;
    const g = gradeCase(c, text, i.suite.packSourceUrls);
    const r = (perRule[c.rule] ??= { pass: 0, total: 0 });
    r.total++;
    if (g.pass) {
      pass++;
      r.pass++;
    } else failing.push(c.id);
    for (const ch of g.checks) {
      const k = (perGrader[ch.grader as GraderId] ??= { pass: 0, total: 0 });
      k.total++;
      if (ch.pass) k.pass++;
    }
  }
  return { schema: SCORE_SCHEMA, pack: i.suite.pack, suite: i.suite.name, suiteSha: i.suiteSha, skills: i.skills, skillSha: i.skillSha, label: i.label, at: i.now.toISOString(), cases: i.cases.length, answered, pass, perRule, perGrader, failing };
}

export const scoreFileOf = (evalDir: string, pack: string, skillSha: string): string => join(evalDir, "skill-scores", pack, `${skillSha.slice(0, 16)}.json`);
