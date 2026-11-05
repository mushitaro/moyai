// 正解の世界の入口を形ごとに分ける（今の工場の形と、指示書 §5 の answer の形）。answer の形は、一時のフォルダに置いた小さな世界で試す。
// 要る項目が無い世界は、推測で埋めず、無い項目の名前を返して止まる。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { generateSuite } from "../../../src/eval/gen";
import { WorldFormatError, detectWorldFormat, loadPack, loadWorld } from "../../../src/eval/world";

const root = mkdtempSync(join(tmpdir(), "moyai-eval-world-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** 架空の小さな世界（2 系列の同じ名前の機器を 3 組と共通の 1 台。点検は毎年か 3 年おき、整備は 2 年おき）。 */
function smallWorld(): Record<string, unknown> {
  const equipment: Record<string, unknown>[] = [];
  const works: Record<string, unknown>[] = [];
  const names = ["送り装置", "回転機", "受け槽", "単独の盤"];
  let n = 0;
  names.forEach((name, gi) => {
    for (const line of gi === 3 ? [null] : [1, 2]) {
      const id = `Q${++n}`;
      equipment.push({ id, ledger_name: name, furnace: line, furnace_label: line === null ? "共通" : `${line}系`, number: `${gi + 1}-${line ?? 0}` });
      for (let y = 2016; y <= 2025; y++) {
        // 後ろの 2 組は 3 年おき（記録に無い年度の問いを作れるように）
        if (gi >= 2 && y % 3 !== 1) continue;
        works.push({ id: `W${id}-${y}a`, equipment_id: id, attr: "INSPECT", label: `${name}の点検`, start: `${y}-${gi % 2 ? "02" : "06"}-1${gi}`, end: `${y}-${gi % 2 ? "03" : "07"}-0${gi + 1}`, man_days: 4 + gi });
        if (y % 2 === 0) works.push({ id: `W${id}-${y}b`, equipment_id: id, attr: "OVERHAUL", label: `${name}の整備`, start: `${y}-10-0${gi + 1}`, end: `${y}-10-2${gi}`, man_days: 10 + gi });
      }
    }
  });
  return { facility: { name: "【架空】小さな施設" }, contractors: [{ name: "【架空】小さな業者" }], man_day_hours: 8, equipment, works };
}

function place(name: string, world: unknown): string {
  const dir = join(root, name);
  mkdirSync(join(dir, "answer", "files"), { recursive: true });
  writeFileSync(join(dir, "answer", "world.json"), JSON.stringify(world));
  return dir;
}

describe("正解の世界の入口", () => {
  test("形を見分ける：今の工場の形と answer の形。どちらでもなければ止まる", () => {
    expect(detectWorldFormat("samples/truth/waste-incineration/fictional-1")).toBe("factory-v1");
    expect(detectWorldFormat(place("a", smallWorld()))).toBe("answer");
    expect(detectWorldFormat(root)).toBeNull();
    expect(() => loadWorld(root, { fiscalYearStartMonth: 4 })).toThrow(WorldFormatError);
  });

  test("answer の形：機器・作業・台帳の番号を読み、年度はパックの年度の始まりで日付から出す", () => {
    const w = loadWorld(place("b", smallWorld()), { fiscalYearStartMonth: 4 });
    expect(w.format).toBe("answer");
    expect(w.equipment).toHaveLength(7);
    expect(w.numbers.get("Q1")).toBe("1-1");
    const feb = w.works.find((x) => x.start.startsWith("2020-02")) as { fiscal_year: number };
    expect(feb.fiscal_year).toBe(2019);
    expect(w.works.every((x) => x.status === "actual")).toBe(true);
    expect(w.manDayHours).toBe(8);
    expect(w.unknownSymbol).toBeNull();
  });

  test("要る項目が無ければ、推測で埋めずに無い項目の名前を返す", () => {
    const bad = smallWorld();
    for (const x of bad.works as Record<string, unknown>[]) delete x.man_days;
    delete bad.equipment;
    try {
      loadWorld(place("c", bad), { fiscalYearStartMonth: 4 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(WorldFormatError);
      const m = (e as WorldFormatError).missing.join(" ");
      expect(m).toContain("world.equipment");
      expect(m).toContain("works[].man_days|manDays");
    }
  });

  test("answer の形の世界からも問題を作れる。世界に無い材料（凡例に無い記号・予定）の規則は、作れなかった問いに理由つきで数える", () => {
    const pack = loadPack("packs", "night-soil");
    const world = loadWorld(place("d", smallWorld()), { fiscalYearStartMonth: pack.fiscalYearStartMonth });
    const allPacks = ["night-soil", "waste-incineration"].map((id) => loadPack("packs", id));
    const out = generateSuite({ name: "small", worldDir: "tmp/small", world, pack, allPacks });
    const made = [...out.train, ...out.test];
    console.log(`小さな世界：作れた ${made.length}、作れなかった ${out.missing.map((m) => `${m.rule}-${m.index}`).join(" ")}`);
    expect(made.length + out.missing.length).toBe(100);
    // 凡例に無い記号と予定が世界に無いので、R08 だけが作れない
    expect([...new Set(out.missing.map((m) => m.rule))]).toEqual(["R08"]);
    expect(out.missing.every((m) => m.reason !== "")).toBe(true);
    expect(out.suite.properNounHits).toBe(0);
  });
});
