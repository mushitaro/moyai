// 読み方（3 段目の Skill）の保管先（docs/plan.md §2.17）：範囲ごとの置き場所、版と前の版、未承認と承認済み、名前の守り。
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { approvedReadingVersions, listReadings, loadedOf, readingDir, registerReading } from "../../src/bridge/readings";
import { READING_SCHEMA, type ReadingSkill } from "../../src/import/reading";
import { commitPlan } from "../../src/plan/store";
import { keyIdOf } from "../../src/share/sign";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan, work } from "./share/fixtures";

const root = mkdtempSync(join(tmpdir(), "moyai-readings-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const skill = (name: string, scope: ReadingSkill["scope"], n = 1): ReadingSkill => ({
  schema: READING_SCHEMA,
  name,
  scope,
  rules: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, text: `${i + 1} 行目を見出しとして読む`, kind: "headerRow" as const, row: i + 1, author: "ai" as const, reason: "会話で決めた" })),
});

describe("読み方の保管先", () => {
  it("範囲ごとの置き場所。名前に道の区切りや予約の文字は使えない", () => {
    expect(readingDir(root, "company", "甲", null, null)).toBe(join(root, "skills", "会社", "甲"));
    expect(readingDir(root, "person", "甲", "山田", null)).toBe(join(root, "skills", "担当", "山田", "甲"));
    expect(readingDir(root, "facility", "甲", null, "intake-x-甲工場")).toBe(join(root, "intake-x-甲工場", "skills", "甲"));
    for (const bad of ["../甲", "甲/乙", ".hidden", "a:b", ""]) expect(readingDir(root, "company", bad, null, null), bad).toBeNull();
    expect(readingDir(root, "person", "甲", null, null)).toBeNull();
  });

  it("書くと SKILL.md と rules.json。同じ中身は書き直さず、変えると前の版を versions/ に残す。一覧では未承認", async () => {
    const a = await registerReading(root, skill("【架空】甲工場の読み方", "facility"), null, "f1");
    if (!a.ok) throw new Error(a.reason);
    expect(a.path).toBe("f1/skills/【架空】甲工場の読み方");
    const dir = join(root, a.path);
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toContain("- 1 行目を見出しとして読む");
    expect(JSON.parse(readFileSync(join(dir, "rules.json"), "utf8")).schema).toBe(READING_SCHEMA);
    const same = await registerReading(root, skill("【架空】甲工場の読み方", "facility"), null, "f1");
    expect(same.ok && same.version).toBe(a.version);
    expect(existsSync(join(dir, "versions"))).toBe(false);
    const b = await registerReading(root, skill("【架空】甲工場の読み方", "facility", 2), null, "f1");
    if (!b.ok) throw new Error(b.reason);
    expect(b.version).not.toBe(a.version);
    expect(readdirSync(join(dir, "versions"))).toEqual([a.version]);
    const list = await listReadings(root, new Map());
    expect(list.map((x) => [x.name, x.scope, x.version, x.rules, x.approved])).toEqual([["【架空】甲工場の読み方", "facility", b.version, 2, false]]);
    expect(loadedOf(list)).toEqual([]);
  });

  it("形の外れた読み方は書かず、一覧にも出さない", async () => {
    expect((await registerReading(root, { ...skill("乙", "company"), rules: [{ kind: "script", code: "x" }] }, null, null)).ok).toBe(false);
    mkdirSync(join(root, "skills", "会社", "壊れた"), { recursive: true });
    writeFileSync(join(root, "skills", "会社", "壊れた", "rules.json"), "{ not json");
    expect((await listReadings(root, new Map())).some((x) => x.name === "壊れた")).toBe(false);
  });

  it("確かめた確定の署名があり、その鍵を信じる版が使った読み方の版だけが承認済み。承認済みだけを作業画面に渡す", async () => {
    const c = await registerReading(root, skill("【架空】会社の読み方", "company"), null, null);
    if (!c.ok) throw new Error(c.reason);
    // 版の記録に名前を書いただけ（署名の無いファイル）では承認済みにしない
    mkdirSync(join(root, "plans", "intake-x", "versions"), { recursive: true });
    writeFileSync(join(root, "plans", "intake-x", "versions", "000001.json"), JSON.stringify({ readingSkills: [{ name: "【架空】会社の読み方", path: c.path, version: c.version }] }));
    expect((await approvedReadingVersions(root, () => true)).has(c.version)).toBe(false);
    rmSync(join(root, "plans", "intake-x"), { recursive: true, force: true });
    // 署名して確定した版が使った読み方
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "INSPECT", ["a1"])], details: [detail("d1", "w1", 2020)] });
    const readingSkills = [{ name: "【架空】会社の読み方", path: c.path, version: c.version }];
    const v1 = await commitPlan({ root, plan: p, reason: "確定", acceptances: [], basedOn: null, signer: SIGNER, client: "t", readingSkills });
    if (!v1.ok) throw new Error(v1.reason);
    const v2 = await commitPlan({ root, plan: v1.record.plan, reason: "2 版目", acceptances: [], basedOn: 1, signer: SIGNER, client: "t", readingSkills });
    if (!v2.ok) throw new Error(v2.reason);
    // 署名の鍵を信じなければ承認しない。信じれば、最初に使った版の番号で承認済み
    expect((await approvedReadingVersions(root, () => false)).has(c.version)).toBe(false);
    const approved = await approvedReadingVersions(root, (x) => x.key === keyIdOf(SIGNER.pair.pub));
    expect(approved.get(c.version)).toBe(1);
    const list = await listReadings(root, approved);
    expect(list.find((x) => x.name === "【架空】会社の読み方")?.approved).toBe(true);
    expect(loadedOf(list).map((x) => [x.skill.name, x.approved, x.approvedIn, x.draft])).toEqual([["【架空】会社の読み方", true, 1, false]]);
    // 読み方の版は SHA-256 の全長
    expect(c.version).toMatch(/^[0-9a-f]{64}$/);
  });
});
