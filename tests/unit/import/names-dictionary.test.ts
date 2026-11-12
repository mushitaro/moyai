// 作業の記録の機器の名前を引く読み方（mushitaro/moyai#79）：
// - 標準：名前の同じ機器が無いとき、号機の書き方（No.1・#1・1号機・(1)）を外し、「機器」か「機器 … 部位」として引く
// - Skillパック（2 段目）：機器の呼び名の辞書（packs/<id>/names.json）。作業の記録の名前から機器を引くときだけ使い、台帳と星取表の機器どうしの結びには使わない
// - 名前の同じ機器が無い名前は、様式ごとに 1 問（新しい機器にするか・1 件ずつ選ぶか・外すか）
import { describe, expect, test } from "vitest";
import { IntakeSession } from "../../../src/import";
import { packNameGroups } from "../../../src/import/pack-reading";
import { acceptDefaults, session } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);

function packSession(packId: string): IntakeSession {
  return new IntakeSession({
    planId: "plan-test",
    displayName: "【架空】試験",
    packId,
    facility: { facilityKey: "f-test", name: "【架空】試験", fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
  });
}

describe("Skillパックの呼び名の辞書", () => {
  test("どの組にも 2 つ以上の書き方と出どころがある。同じ書き方が 2 つの組に出ない", () => {
    const gs = packNameGroups("waste-incineration");
    expect(gs.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const g of gs) {
      expect(g.forms.length).toBeGreaterThanOrEqual(2);
      expect(g.source.length).toBeGreaterThan(0);
      for (const f of g.forms) {
        expect(seen.has(f), f).toBe(false);
        seen.add(f);
      }
    }
    expect(packNameGroups("test")).toEqual([]);
    expect(packNameGroups(null)).toEqual([]);
  });

  test("作業の記録の略（辞書の書き方）で、台帳の機器に当てる。辞書の無いパックでは当てない", async () => {
    const forms = packNameGroups("waste-incineration").find((g) => /^[A-Z]+$/.test(g.forms[1] ?? ""))?.forms ?? [];
    const [full, abbr] = [forms[0] ?? "", forms[1] ?? ""];
    expect(abbr).toMatch(/^[A-Z]+$/);
    const ledger = csv(["名称,系列", `${full},1号`]);
    const daily = csv(["日付,炉,機器,作業,工数", `2024/4/6,1,${abbr},点検,延べ2人`]);
    const s = packSession("waste-incineration");
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "eventAsset" && q.options.some((o) => o.id === "new"))).toBe(false);
    acceptDefaults(s);
    const plan = s.compose().plan;
    const node = plan?.assets.find((a) => a.name === full);
    expect(plan?.works.some((w) => w.targets.includes(node?.nodeKey ?? "?"))).toBe(true);
    const t = session();
    await t.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    expect(t.analyze().open.some((q) => q.kind === "eventAsset" && q.items.some((it) => it.note === abbr))).toBe(true);
  });

  test("辞書は、台帳と星取表の機器どうしの結びには使わない（略で書いた台帳の行を、星取表の機器と結ぶ問いにしない）", async () => {
    const forms = packNameGroups("waste-incineration").find((g) => /^[A-Z]+$/.test(g.forms[1] ?? ""))?.forms ?? [];
    const ledgerA = csv(["名称,系列", `${forms[1]},1号`]);
    const ledgerB = csv(["名称,系列", `${forms[0]},1号`]);
    const s = packSession("waste-incineration");
    await s.add([
      { name: "台帳A.csv", bytes: ledgerA },
      { name: "台帳B.csv", bytes: ledgerB },
    ]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "assetLink" && q.text.includes("同じものとして結ぶか"))).toBe(false);
  });
});

describe("号機の書き方を外して引く（標準）", () => {
  test("「ブロワ 1号機」「ブロワ No.1」「ブロワ #1」「ブロワ (1)」は、1 号のブロワに当てる（推した答えで）", async () => {
    const ledger = csv(["名称,系列", "ポンプ,1号", "ブロワ,1号"]);
    for (const w of ["ブロワ 1号機", "ブロワ No.1", "ブロワ #1", "ブロワ (1)"]) {
      const s = session();
      await s.add([
        { name: "台帳.csv", bytes: ledger },
        { name: "日報.csv", bytes: csv(["日付,炉,機器,作業,工数", `2024/4/6,1,${w},点検,延べ2人`]) },
      ]);
      const q = s.analyze().open.find((x) => x.kind === "eventAsset" && x.items.some((it) => it.note === w));
      expect(q?.text, w).toContain("号機と機器と部位に分けて");
      expect(q?.defaultAnswer).toBe("yes");
      acceptDefaults(s);
      const plan = s.compose().plan;
      const node = plan?.assets.find((a) => a.name === "ブロワ");
      expect(plan?.works.some((x) => x.targets.includes(node?.nodeKey ?? "?")), w).toBe(true);
    }
  });

  test("号機の数が機器の号と違えば当てない（名前の同じ機器が無い名前の問いになる）", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: csv(["名称,系列", "ポンプ,1号", "ブロワ,1号"]) },
      { name: "日報.csv", bytes: csv(["日付,炉,機器,作業,工数", "2024/4/6,1,ブロワ 2号機,点検,延べ2人"]) },
    ]);
    const q = s.analyze().open.find((x) => x.kind === "eventAsset" && x.items.some((it) => it.note === "ブロワ 2号機"));
    expect(q?.options.map((o) => o.id)).toEqual(["new", "split", "exclude"]);
    expect(q?.defaultAnswer).toBeNull();
  });
});
