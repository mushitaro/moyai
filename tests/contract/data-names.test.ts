// データの名前（src/shared/data-names.ts）と、そこから作るもの：1 段目の Skill の節、パックの SKILL.md の「資料とデータの名前」、
// docs/data-names.md の表。どれも正本と一致するか。業種の語が src/ のデータに無いか。Claude に intake_survey（part: skills）で届くか。
// 作り直すとき：MOYAI_WRITE_DOCS=1 npx vitest run tests/contract/data-names.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { activeSkills } from "../../src/app/skills";
import {
  DATA_NAMES,
  dataNamesDocTables,
  dataNamesSkillSection,
  GENERATED_END,
  packDataNamesSection,
  replaceGenerated,
  type PackDataNames,
} from "../../src/shared/data-names";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";

const PACK = "waste-incineration";
const PACK_JSON = `packs/${PACK}/data-names.json`;
const FROM = `src/shared/data-names.ts と ${PACK_JSON}`;
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const pack = JSON.parse(read(PACK_JSON)) as PackDataNames;

/** 印の範囲を正本から作り直したもの。MOYAI_WRITE_DOCS=1 なら書き直す */
function regenerated(path: string, body: string): { now: string; want: string } {
  const now = read(path);
  const want = replaceGenerated(now, FROM, body);
  if (process.env.MOYAI_WRITE_DOCS === "1" && want !== now) writeFileSync(path, want);
  return { now: read(path), want };
}

describe("データの名前の正本", () => {
  test("鍵は重ならず、どの名前にも定義・画面の言葉・欄・当ててはいけない例がある。決めた名前には決めた所がある", () => {
    expect(new Set(DATA_NAMES.map((n) => n.id)).size).toBe(DATA_NAMES.length);
    expect(new Set(DATA_NAMES.map((n) => n.name)).size).toBe(DATA_NAMES.length);
    for (const n of DATA_NAMES) {
      expect(n.definition.length, n.id).toBeGreaterThan(0);
      expect(n.screen.length, n.id).toBeGreaterThan(0);
      expect(n.code.length, n.id).toBeGreaterThan(0);
      expect(n.avoid.length, n.id).toBeGreaterThan(0);
      if (n.status === "decided") expect(n.decidedIn, n.id).toBeTruthy();
    }
  });

  test("運営者が挙げた名前をどれも持つ（作業明細は作業日報の 1 行、作業の年度の値は別の名前）", () => {
    const names = DATA_NAMES.map((n) => n.name).join("\n");
    for (const w of ["施設", "機器", "段", "系列", "作業", "作業分類", "作業の年度の値", "作業明細", "周期", "次回", "起点", "工数", "日数", "期間", "費用", "判定・測定値・前回値", "外注先", "実施者", "共通の設備項目", "紐付け", "ルール", "計画ルール", "周期の案", "確定", "版", "元の資料"])
      expect(names, w).toContain(w);
    const line = DATA_NAMES.find((n) => n.id === "line")!;
    expect(line.name).toBe("作業明細");
    expect(line.definition).toContain("作業日報の 1 行");
    expect(line.code).toContain("WorkDetailT.lines");
    expect(DATA_NAMES.find((n) => n.id === "yearValue")!.avoid).toContain("年度の値を作業明細と呼ばない");
  });

  test("パックの data-names.json は正本の鍵だけを使い、形どおり", () => {
    expect(pack.schema).toBe("moyai.data-names/0");
    expect(pack.pack).toBe(PACK);
    const ids = new Set(DATA_NAMES.map((n) => n.id));
    for (const [k, v] of Object.entries(pack.names)) {
      expect(ids.has(k), `正本に無い鍵 ${k}`).toBe(true);
      expect(Object.keys(v).every((x) => x === "examples" || x === "avoid"), k).toBe(true);
      for (const s of [...(v.examples ?? []), ...(v.avoid ?? [])]) expect(typeof s === "string" && s.length > 0, k).toBe(true);
    }
    expect(Object.keys(pack.names).length).toBeGreaterThan(20);
  });

  test("業種の語（パックの 1 段目の項目・検査が選ぶ作業の名前・尺度の名前）は src/shared/data-names.ts に無い（パックに置く）", () => {
    const words = new Set<string>();
    const add = (s: unknown) => {
      if (typeof s !== "string") return;
      const t = s.normalize("NFKC").trim();
      if (t.length >= 2 && !/^[\x00-\x7f]+$/.test(t)) words.add(t);
    };
    const walk = (n: unknown) => {
      if (Array.isArray(n)) n.forEach(walk);
      else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) (k === "name" && typeof v === "string" ? add(v) : walk(v));
    };
    for (const p of [PACK, "night-soil"]) {
      walk(JSON.parse(read(`packs/${p}/common.json`)));
      if (!existsSync(`packs/${p}/checks.json`)) continue;
      for (const c of JSON.parse(read(`packs/${p}/checks.json`)).checks) {
        for (const w of c.params.works ?? []) for (const v of w.values) add(v);
        add(c.params.scale);
      }
    }
    expect(words.size).toBeGreaterThan(30);
    const text = read("src/shared/data-names.ts").normalize("NFKC");
    for (const w of words) expect(text.includes(w), `src/shared/data-names.ts に「${w}」`).toBe(false);
  });
});

describe("正本から作るもの", () => {
  test("1 段目の Skill は instructions の後ろに「データの名前」の節を持ち、instructions には参照の 1 文だけ", () => {
    const section = dataNamesSkillSection();
    expect(skillMoyaiMarkdown()).toContain(`\n${section}\n`);
    expect(section).toContain("| 名前 | 定義 | 欄 | 当ててはいけない例 |");
    for (const n of DATA_NAMES) expect(section).toContain(`| ${n.name} |`);
    expect(MCP_INSTRUCTIONS).toContain("「データの名前」");
    expect(MCP_INSTRUCTIONS).not.toContain("| 名前 |");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  test(`${PACK} の SKILL.md の「資料とデータの名前」は data-names.json から作ったものと同じ（印の外は変えない）`, () => {
    const { now, want } = regenerated(`packs/${PACK}/SKILL.md`, packDataNamesSection(pack));
    expect(now).toBe(want);
    expect(now).toContain("## 資料とデータの名前");
    expect(now.indexOf(GENERATED_END)).toBeGreaterThan(now.indexOf("## 資料とデータの名前"));
  });

  test("docs/data-names.md の 1〜4 章の表は正本とパックのデータから作ったものと同じ。手で書く 5 章・6 章は残る", () => {
    const { now, want } = regenerated("docs/data-names.md", dataNamesDocTables(pack));
    expect(now).toBe(want);
    expect(now).toContain("| 名前 | 運営者の定義 | 画面の言葉 | コードの型と欄 | 資料の手本 | 当ててはいけない例 |");
    expect(now).toContain("## 5. 食い違い");
    expect(now).toContain("## 6. ");
    for (const n of DATA_NAMES) expect(now).toContain(`| ${n.name} |`);
  });

  test("Claude に届く：intake_survey（part: skills）の 1 段目と 2 段目の本文に、それぞれの節が入る", () => {
    const s = activeSkills(PACK, []);
    expect(s[0]!.text).toContain("## データの名前");
    expect(s[0]!.text).toContain("作業日報の 1 行");
    expect(s[1]!.text).toContain("## 資料とデータの名前");
    for (const n of DATA_NAMES.filter((x) => pack.names[x.id])) expect(s[1]!.text).toContain(`| ${n.name} |`);
  });
});
