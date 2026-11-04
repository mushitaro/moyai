// F3 の問題の生成器（docs/plan.md §2.10）：決まった種から同じ問題を作る、規則 10 × 10 問、期間で分ける、近い重複を除く、
// 固有名詞の当たり 0、試験用の問題の混入を見つける、正解が世界のデータと合う。業種の語が src/eval/ に無いことも見る。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { generateSuite, rangeLabel, RULES, splitFyOf, yearLabel, effortText, CASES_PER_RULE } from "../../../src/eval/gen";
import { bodyHash, countEvalProperNouns, leakedTestCases, systemText, userText } from "../../../src/eval/prompt";
import { fiscalYearOf, loadPack, loadWorld, properNounTerms } from "../../../src/eval/world";
import { gradeCase } from "../../../src/eval/grade";
import type { EvalCase } from "../../../src/eval/types";

const WORLDS = {
  "waste-incineration": "samples/truth/waste-incineration/fictional-1",
  "night-soil": "samples/truth/night-soil/fictional-ns-1",
} as const;
type PackId = keyof typeof WORLDS;
const packIds = readdirSync("packs").filter((d) => !d.startsWith("_"));
const gen = (pack: PackId) =>
  generateSuite({
    name: pack,
    worldDir: WORLDS[pack],
    world: loadWorld(WORLDS[pack], { fiscalYearStartMonth: loadPack("packs", pack).fiscalYearStartMonth }),
    pack: loadPack("packs", pack),
    allPacks: packIds.map((id) => loadPack("packs", id)).sort((a, b) => a.id.localeCompare(b.id)),
  });
const readJsonl = (p: string): EvalCase[] =>
  readFileSync(p, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));

describe.each(Object.keys(WORLDS) as PackId[])("生成器：%s", (pack) => {
  const out = gen(pack);
  const all = [...out.train, ...out.test];
  const world = loadWorld(WORLDS[pack], { fiscalYearStartMonth: loadPack("packs", pack).fiscalYearStartMonth });

  test("同じ種からは同じ問題になる。リポジトリの eval/<suite>/ は生成器の出力と同じ", () => {
    expect(JSON.stringify(gen(pack))).toBe(JSON.stringify(out));
    expect(readJsonl(`eval/${pack}/cases/train.jsonl`)).toEqual(out.train);
    expect(readJsonl(`eval/${pack}/cases/test.jsonl`)).toEqual(out.test);
    expect(JSON.parse(readFileSync(`eval/${pack}/suite.json`, "utf8"))).toEqual(out.suite);
  });

  test("規則は 10、1 規則 10 問まで。作れなかった問いは理由つきで数える（作れた数＋作れなかった数＝100）", () => {
    expect(RULES).toHaveLength(10);
    expect(all.length + out.missing.length).toBe(RULES.length * CASES_PER_RULE);
    for (const r of RULES) expect(all.filter((c) => c.rule === r.id).length).toBeLessThanOrEqual(CASES_PER_RULE);
    for (const m of out.missing) expect(m.reason).not.toBe("");
    expect(out.suite.missing).toEqual(out.missing);
    // 足りないのは、世界に年度の始まりより前の月の日付が無い、し尿処理の R04 の学習用だけ（測った値）
    if (pack === "waste-incineration") expect(out.missing).toEqual([]);
    else expect(out.missing.map((m) => `${m.rule}-${m.index}`)).toEqual(["R04-1", "R04-2", "R04-3", "R04-4", "R04-5"]);
  });

  test("学習用と試験用は期間で分ける（年度を持たない R03・R08 は番号で分ける）", () => {
    const fy = splitFyOf(world);
    for (const c of all) {
      if (c.splitBy === "period") {
        expect(c.anchorFy).not.toBeNull();
        // 問いの中のどの年度も、その分けの期間の中（日付の年は年度ではないので見ない。R04 は日付の年度の正解で見る）
        const years = [...c.record.matchAll(/(?<![-\d])(20\d\d)(?![-\d])/g)].map((m) => Number(m[1]));
        for (const y of years) expect(c.split === "train" ? y < fy : y >= fy, `${c.id} の ${y}`).toBe(true);
      } else {
        expect(["R03", "R08"]).toContain(c.rule);
        expect(c.split).toBe(Number(c.id.slice(4)) <= 5 ? "train" : "test");
      }
    }
    expect(out.suite.testHashes).toEqual(out.test.map((c) => c.hash));
  });

  test("ハッシュは正規化した本文から取り、重複は無い", () => {
    for (const c of all) expect(c.hash).toBe(bodyHash(c));
    expect(new Set(all.map((c) => c.hash)).size).toBe(all.length);
    // 空白と全角半角だけが違う本文は、同じハッシュになる（近い重複）
    const c = all[0] as EvalCase;
    expect(bodyHash({ record: c.record.replace(/ /g, "　").replace(/\|/g, "｜"), question: c.question })).toBe(c.hash);
  });

  test("送る文に固有名詞（施設名・業者名）が 0。混ぜれば数える", () => {
    const terms = properNounTerms(world);
    expect(terms.length).toBeGreaterThan(1);
    const text = [systemText(readFileSync(`packs/${pack}/SKILL.md`, "utf8")), ...all.map(userText)].join("\n");
    expect(countEvalProperNouns(text, terms).hits).toBe(0);
    expect(out.suite.properNounHits).toBe(0);
    expect(countEvalProperNouns(`${text}\n${world.facilityName}`, terms).hits).toBeGreaterThan(0);
  });

  test("試験用の問題の記録が Skill の文に入っていれば見つける。いまの SKILL.md には入っていない", () => {
    const skill = readFileSync(`packs/${pack}/SKILL.md`, "utf8");
    expect(leakedTestCases(skill, out.test)).toEqual([]);
    const t = out.test.find((c) => c.rule === "R01") as EvalCase;
    const line = t.record.split("\n")[2] as string;
    expect(leakedTestCases(`${skill}\n例：\n${line}\n`, out.test)).toContain(t.id);
  });

  test("どの問いも、正解どおりの答えなら採点を全部通り、何も答えなければ落ちる（生成器と採点が食い違わない）", () => {
    const urls = out.suite.packSourceUrls;
    for (const c of all) {
      const answers: Record<string, unknown> = {};
      const notInRecord: string[] = [];
      for (const ch of c.checks) {
        if (!ch.key) continue;
        if (ch.grader === "not_in_record") {
          if (ch.expect) notInRecord.push(ch.key);
        } else answers[ch.key] = ch.expect;
      }
      const sources = Object.values(answers).filter((v): v is string => typeof v === "string" && urls.includes(v));
      expect(gradeCase(c, JSON.stringify({ answers, notInRecord, sources }), urls).pass, c.id).toBe(true);
      expect(gradeCase(c, JSON.stringify({ answers: {}, notInRecord: [], sources: [] }), urls).pass, c.id).toBe(false);
      for (const k of c.keys) expect(c.checks.some((ch) => ch.key === k), `${c.id} の ${k}`).toBe(true);
    }
  });

  test("正解は世界のデータと合う（年度・工数・台帳の番号）", () => {
    const start = loadPack("packs", pack).fiscalYearStartMonth;
    for (const c of all.filter((x) => x.rule === "R04")) {
      for (const ch of c.checks.filter((x) => x.grader === "fiscal_year")) {
        const row = c.record.split("\n").find((l) => l.startsWith(`| ${ch.key} |`)) as string;
        const date = /(\d{4}-\d\d-\d\d)/.exec(row)?.[1] as string;
        expect(ch.expect).toBe(fiscalYearOf(date, start));
      }
      // 年度の始まりより前の月の日付が、少なくとも 1 つある
      expect(c.record.split("\n").some((l) => /-0[1-3]-\d\d/.test(l))).toBe(true);
    }
    for (const c of all.filter((x) => x.rule === "R10")) {
      const withRate = c.record.includes("時間として数える");
      for (const ch of c.checks.filter((x) => x.grader === "no_guess")) {
        const row = c.record.split("\n").find((l) => l.startsWith(`| ${ch.key} |`)) as string;
        if (row.includes("時間 |") && !withRate) expect(ch.expect).toBeNull();
        else expect(typeof ch.expect).toBe("number");
      }
    }
    const numbers = new Set(world.numbers.values());
    for (const c of all.filter((x) => x.rule === "R02" || x.rule === "R07")) {
      for (const ch of c.checks.filter((x) => x.grader === "identity")) {
        const ids = Array.isArray(ch.expect) ? (ch.expect as string[]) : Object.keys(ch.expect as object);
        for (const n of ids) expect(numbers.has(n)).toBe(true);
      }
    }
  });
});

describe("年度と範囲と工数の書き方", () => {
  test("和暦：令和元年度＝平成31年度＝2019 年度。R5 は 2023 年度", () => {
    expect(yearLabel(2019, "reiwa")).toBe("令和元年度");
    expect(yearLabel(2019, "heisei")).toBe("平成31年度");
    expect(yearLabel(2023, "r")).toBe("R5");
    expect(yearLabel(2024, "seireki")).toBe("2024年度");
  });
  test("年度の始まりの月より前は前の年度", () => {
    expect(fiscalYearOf("2024-03-31", 4)).toBe(2023);
    expect(fiscalYearOf("2024-04-01", 4)).toBe(2024);
  });
  test("範囲のタグ", () => {
    expect(rangeLabel("1号炉", "2号炉")).toBe("1～2号炉");
    expect(rangeLabel("1系", "3系")).toBe("1～3系");
    expect(rangeLabel("A", "B")).toBe("A～B");
  });
  test("工数", () => {
    expect(effortText(3, "hours", 8)).toBe("24時間");
    expect(effortText(3, "nobe", 8)).toBe("延べ3人");
  });
});

describe("業種の語は src/eval/ に無い（パックと世界のデータから取る）", () => {
  test("パックの 1 段目の設備・機器・検査の名前（2 文字以上、NFKC）が、採点のコードに出ない", () => {
    const words = new Set<string>();
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object")
        for (const [k, v] of Object.entries(n)) {
          if (k === "name" && typeof v === "string" && v.normalize("NFKC").length >= 2 && !/^[\x00-\x7f]+$/.test(v)) words.add(v.normalize("NFKC"));
          else walk(v);
        }
    };
    for (const id of packIds) {
      walk(JSON.parse(readFileSync(`packs/${id}/common.json`, "utf8")).systems);
      try {
        walk(JSON.parse(readFileSync(`packs/${id}/checks.json`, "utf8")).checks);
      } catch {
        /* 検査の無いパック */
      }
    }
    expect(words.size).toBeGreaterThan(30);
    const files = readdirSync("src/eval", { recursive: true, withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => join(d.parentPath, d.name));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const text = readFileSync(f, "utf8").normalize("NFKC");
      for (const w of words) expect(text.includes(w), `${f} に「${w}」`).toBe(false);
      for (const id of packIds) expect(text.includes(id), `${f} に「${id}」`).toBe(false);
    }
  });
});
