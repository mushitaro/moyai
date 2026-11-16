// パックの英語の名前と説明（グローバル対応の段 1b）。en は足すだけで、無いパックと前の形も今のまま通る（後方互換）。
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GroupsDoc, parsePack } from "../../../src/shared/pack";

const PACKS = join(__dirname, "../../../packs");
const folders = readdirSync(PACKS).filter((d) => !d.startsWith("_") && existsSync(join(PACKS, d, "pack.json")));
const read = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}　-〿＀-￯]/u;

describe("パックの英語の名前と説明", () => {
  it("パックが 1 つ以上ある", () => expect(folders.length).toBeGreaterThan(0));

  it.each(folders)("%s：en.name と en.description が英語で、日本語の name は今のまま", (folder) => {
    const json = read(join(PACKS, folder, "pack.json"));
    const r = parsePack(json, folder);
    expect(r.ok).toBe(true);
    expect(typeof json.name).toBe("string");
    expect(json.en?.name).toBeTruthy();
    expect(json.en?.description).toBeTruthy();
    expect(CJK.test(json.en.name)).toBe(false);
    expect(CJK.test(json.en.description)).toBe(false);
  });

  it("en の無い前の形も通る（後方互換）", () => {
    for (const folder of folders) {
      const json = read(join(PACKS, folder, "pack.json"));
      delete json.en;
      expect(parsePack(json, folder).ok, folder).toBe(true);
    }
  });

  it("空のパックの en に知らない欄があれば通さない（欄は閉じたまま）", () => {
    const json = read(join(PACKS, "aircraft", "pack.json"));
    json.en = { name: "Aircraft", extra: "x" };
    expect(parsePack(json, "aircraft").ok).toBe(false);
  });

  it("群（groups.json）と作業の属性（work.json）にも英語の名前がある", () => {
    const groups = read(join(PACKS, "_kinds", "groups.json"));
    expect(GroupsDoc.safeParse(groups).success).toBe(true);
    for (const g of groups.groups) expect(CJK.test(g.en?.name ?? "あ"), g.id).toBe(false);
    const work = read(join(PACKS, "_kinds", "work.json"));
    for (const code of ["INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"]) {
      expect(typeof work.work[code].label).toBe("string");
      expect(CJK.test(work.work[code].en?.label ?? "あ"), code).toBe(false);
      expect(CJK.test(work.work[code].en?.description ?? "あ"), code).toBe(false);
    }
  });
});
