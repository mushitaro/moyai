// pack.map（docs/plan.md §2.7・§5.1）：設備の地図の全行の空のパックがスキーマの検証を通り、【業種】の画面に群ごとに並ぶ。
// 中身のある 2 つ（ごみ焼却・し尿処理）は読みを変えない。数は packs/ から数える。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Industries } from "../../../src/app/pages/Industries";
import { industryMap } from "../../../src/app/industries";
import { TEXT } from "../../../src/app/text";
import { PACK_GROUPS, buildIndustryMap, parsePack } from "../../../src/shared/pack";
import { loadSharePack } from "../../../src/share/pack";

const PACKS = join(process.cwd(), "packs");
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as unknown;
const folders = readdirSync(PACKS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name)
  .sort();
const packs = folders.map((folder) => ({ folder, json: readJson(join(PACKS, folder, "pack.json")) }));
const groupsJson = readJson(join(PACKS, "_kinds", "groups.json")) as { groups: { id: string; order: string[] }[]; notBuilt: string[] };

describe("pack.map：空のパックの形", () => {
  test("packs/ のどのフォルダにも pack.json があり、スキーマの検証を通る", () => {
    expect(folders.length).toBeGreaterThan(2);
    for (const p of packs) {
      const r = parsePack(p.json, p.folder);
      expect(r.ok, `${p.folder}: ${r.ok ? "" : r.issues.join(", ")}`).toBe(true);
    }
  });

  test("中身のある 2 つは中身のあるパックとして通り、共有の読みは変わらない", () => {
    const kinds = Object.fromEntries(packs.map((p) => [p.folder, (parsePack(p.json, p.folder) as { kind: string }).kind]));
    expect(Object.entries(kinds).filter(([, k]) => k === "content").map(([f]) => f)).toEqual(["night-soil", "waste-incineration"]);
    expect(loadSharePack(PACKS, "waste-incineration").ok).toBe(true);
    expect(loadSharePack(PACKS, "night-soil")).toEqual({ ok: false, reason: "sharingOff" });
  });

  test("空のパックは、未確認・共有は off・中身のファイルが無い（pack.json だけ）・出どころの候補がある", () => {
    for (const p of packs) {
      const r = parsePack(p.json, p.folder);
      if (!r.ok || r.kind === "content") continue;
      expect(r.pack.verification, p.folder).toBe("未確認");
      expect(r.pack.sharing, p.folder).toBe("off");
      expect(readdirSync(join(PACKS, p.folder)), p.folder).toEqual(["pack.json"]);
      if (r.kind === "empty") expect(r.pack.sourceCandidates.length, p.folder).toBeGreaterThan(0);
      for (const c of r.pack.sourceCandidates) expect(c.url, `${p.folder}: URL は照らしてから書く`).toBeNull();
    }
  });

  test("作らない行は 1 つで、群を持たず、理由がある", () => {
    const nb = packs.map((p) => parsePack(p.json, p.folder)).filter((r) => r.ok && r.kind === "notBuilt");
    expect(nb).toHaveLength(1);
    expect(groupsJson.notBuilt).toEqual(nb.map((r) => (r as { pack: { id: string } }).pack.id));
  });

  test("groups.json の並びは、その群のパックとちょうど同じ（抜けも余りも無い）", () => {
    expect(groupsJson.groups.map((g) => g.id)).toEqual([...PACK_GROUPS]);
    for (const g of groupsJson.groups) {
      const inGroup = packs.filter((p) => (p.json as { group?: unknown }).group === g.id).map((p) => p.folder);
      expect([...g.order].sort(), g.id).toEqual(inGroup.sort());
    }
  });

  test("形の違うものは通さない：知らない欄・中身の欄・共有 on・度合いの外・URL が https でない・id とフォルダの食い違い", () => {
    const ok = packs.find((p) => (parsePack(p.json, p.folder) as { kind?: string }).kind === "empty")!;
    const base = ok.json as Record<string, unknown>;
    const bad: Record<string, unknown>[] = [
      { ...base, extra: 1 },
      { ...base, common: "common.json" },
      { ...base, sharing: "on" },
      { ...base, verification: "たぶん" },
      { ...base, sourceCandidates: [] },
      { ...base, sourceCandidates: [{ title: "x", issuer: null, url: "http://example.org/", scope: "row" }] },
      { ...base, group: "Z" },
      { ...base, content: "full" },
      { ...base, build: false },
    ];
    for (const b of bad) expect(parsePack(b, ok.folder).ok, JSON.stringify(b).slice(0, 80)).toBe(false);
    expect(parsePack(base, "other-folder").ok).toBe(false);
    const content = packs.find((p) => p.folder === "night-soil")!.json as Record<string, unknown>;
    const { common: _c, ...noCommon } = content;
    expect(parsePack(noCommon, "night-soil").ok).toBe(false);
  });
});

describe("pack.map：【業種】の画面", () => {
  test("地図は packs/ から数え、群 A〜H と作らない行に、どの行も 1 回だけ並ぶ", () => {
    const map = industryMap();
    expect(map.invalid).toEqual([]);
    expect(map.total).toBe(folders.length);
    const ids = [...map.groups.flatMap((g) => g.rows.map((r) => r.id)), ...map.notBuilt.map((r) => r.id)];
    expect(ids.sort()).toEqual([...folders]);
    expect(map.groups.map((g) => g.id)).toEqual([...PACK_GROUPS]);
    for (const g of map.groups) expect(g.rows.length, g.id).toBeGreaterThan(0);
    // 並びは groups.json の順（A の頭はごみ焼却・し尿処理）
    expect(map.groups[0]!.rows.slice(0, 2).map((r) => r.id)).toEqual(["waste-incineration", "night-soil"]);
  });

  test("形の通らない pack.json は並べず、読み込めないものとして出す", () => {
    const map = buildIndustryMap([...packs, { folder: "broken", json: { schema: "moyai.pack/0", id: "broken" } }], groupsJson);
    expect(map.invalid.map((x) => x.folder)).toEqual(["broken"]);
    expect(map.total).toBe(folders.length);
  });

  test("画面に全行が並び、中身のある行に印、作らない行に理由が出る", () => {
    const html = renderToStaticMarkup(
      <MantineProvider>
        <Industries />
      </MantineProvider>,
    );
    const map = industryMap();
    for (const g of map.groups) {
      expect(html).toContain(`data-testid="industry-group-${g.id}"`);
      for (const r of g.rows) {
        expect(html).toContain(`data-testid="industry-${r.id}"`);
        expect(html).toContain(r.name);
      }
    }
    expect((html.match(new RegExp(TEXT.industries.filled, "g")) ?? []).length).toBe(2);
    for (const r of map.notBuilt) {
      expect(html).toContain(r.name);
      expect(html).toContain(r.reason);
    }
    expect(html).toContain(`data-testid="industries-total"`);
    expect(existsSync(join(PACKS, "_kinds", "groups.json"))).toBe(true);
  });
});
