// 号機（No.1・No.2。機器の tag）の区別を、星取表の階層・chart_rows・Excel の書き出し・差分レポートに出す（ops/tasks/intake-tag-v1）。
// 見せ方だけを変える：版の記録の機器の名前・nodeKey・detailKey・basis（署名される字）は変えない。
// 計画はすべて架空。試験は一時のフォルダで行う。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool, type TabToolResult } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan, setWorkingPlan } from "../../../src/app/state/plan-store";
import { TEXT } from "../../../src/app/text";
import { assetLabels } from "../../../src/plan/asset-names";
import { buildChart, catalogFromPack, type ChartLabels, type ChartModel, type ChartOptions } from "../../../src/plan/chart";
import { diffPlans } from "../../../src/plan/diff";
import { EXPORT_TEXT, planWorkbook } from "../../../src/plan/export";
import { commitPlan, readHistory, readPlanVersion } from "../../../src/plan/store";
import { contentHash } from "../../../src/plan/signature";
import { Plan } from "../../../src/shared/plan";
import { SIGNER } from "../../helpers/signer";
import { asset, detail, plan, work } from "../share/fixtures";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const kinds = json("packs/_kinds/work.json");
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), kinds);
const empty = catalogFromPack({ systems: [] }, kinds);
const labels: ChartLabels = { levelFallback: (n) => `L${n}`, commonLevels: ["S", "I", "A"], unmapped: "UNMAPPED", series: (s) => `S${s}` };
const opts: ChartOptions = { mode: "ledger", period: "year", layer: "original", foldLevel: null };
const SEP = " › ";

type Tags = { pump: [string | null, string | null]; fan: [string | null, string | null]; spray: [string | null, string | null] };
const TAGGED: Tags = { pump: ["No.1", "No.2"], fan: ["No.1", "No.2"], spray: ["No.1", "No.2"] };
const UNTAGGED: Tags = { pump: [null, null], fan: [null, null], spray: [null, null] };

/**
 * 架空の計画：設備 › 機器 › 部位（号炉・系統は機器の属性 series）。
 * - 給水ポンプ ×2：同じ親・同じ名前・同じ号炉 1、号機 No.1・No.2（機器の tag）
 * - 送風機 ×2：号炉の無い機器、号機 No.1・No.2
 * - 計量機 ×2：号炉も号機も無い、同じ名前の機器
 * - 減温塔の下の噴霧ポンプ ×2：部位の階層の、号機で分かれる同じ名前の節
 * - 工事共通費 › 1号炉・2号炉：機器群の名前が号炉と同じ
 */
function tagPlan(t: Tags = TAGGED): Plan {
  const a = (key: string, level: number, parentKey: string | null, name: string, o: Partial<Plan["assets"][number]> = {}) =>
    asset(key, null, { level, parentKey, name, commonItemAuthor: null, commonItemBasis: null, commonItemAccepted: false, ...o });
  const assets = [
    a("S1", 1, null, "架空のボイラ設備"),
    a("P1", 2, "S1", "ボイラ 給水ポンプ", { tag: t.pump[0], series: "1" }),
    a("P2", 2, "S1", "ボイラ 給水ポンプ", { tag: t.pump[1], series: "1" }),
    a("B1", 3, "P1", "ポンプ本体 軸受・軸封"),
    a("B2", 3, "P2", "ポンプ本体 軸受・軸封"),
    a("S2", 1, null, "架空の通風設備"),
    a("F1", 2, "S2", "送風機", { tag: t.fan[0] }),
    a("F2", 2, "S2", "送風機", { tag: t.fan[1] }),
    a("K1", 2, "S2", "計量機"),
    a("K2", 2, "S2", "計量機"),
    a("S3", 1, null, "架空の排ガス設備"),
    a("M1", 2, "S3", "減温塔", { series: "1" }),
    a("L1", 3, "M1", "減温塔噴霧P", { tag: t.spray[0] }),
    a("L2", 3, "M1", "減温塔噴霧P", { tag: t.spray[1] }),
    a("S4", 1, null, "工事共通費"),
    a("G1", 2, "S4", "1号炉", { series: "1" }),
    a("G2", 2, "S4", "2号炉", { series: "2" }),
    a("C1", 3, "G1", "共通仮設・入出域管理"),
    a("C2", 3, "G2", "共通仮設・入出域管理"),
  ];
  // 作業の対象：機器（給水ポンプ）と部位
  const targets = ["P1", "P2", "B1", "B2", "F1", "F2", "K1", "K2", "L1", "L2", "C1", "C2"];
  return {
    ...plan({
      assets,
      works: targets.map((k) => work(`w-${k}`, "INSPECT", [k], { kind: "架空の点検" })),
      details: targets.map((k, i) => detail(`d-${k}`, `w-${k}`, 2020 + (i % 3), { basis: `架空の記録 ${k}` })),
    }),
    levelNames: ["設備", "機器", "部位"],
  };
}

const pathOf = (m: ChartModel, id: string) => {
  const r = m.rows.find((x) => x.id === id);
  if (!r) throw new Error(`行が無い：${id}`);
  return r.path.filter((x): x is string => !!x).join(SEP);
};
const allPaths = (m: ChartModel) => m.rows.map((r) => r.path.filter((x): x is string => !!x).join(SEP));

describe("星取表の階層：号機で分かれる同じ名前の機器", () => {
  it("同じ親の下の No.1・No.2 の 2 機器は、機器の名前に号機を添えた別の行になる。号炉・系統の階層は今どおり機器と部位のあいだ", () => {
    const m = buildChart(tagPlan(), catalog, labels, opts);
    expect(m.levelNames).toEqual(["設備", "機器", "号炉", "部位"]);
    expect(pathOf(m, "n:P1")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.1 › 1 号炉");
    expect(pathOf(m, "n:P2")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.2 › 1 号炉");
    expect(pathOf(m, "n:B1")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.1 › 1 号炉 › ポンプ本体 軸受・軸封");
    expect(pathOf(m, "n:B2")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.2 › 1 号炉 › ポンプ本体 軸受・軸封");
    // 機器の行は号機ごとに 1 つ（「ボイラ 給水ポンプ › 1 号炉」が 2 つ並ばない）
    const machines = m.rows.filter((r) => r.id.startsWith("m:") && r.path[1]?.startsWith("ボイラ 給水ポンプ"));
    expect(machines.map((r) => r.path[1])).toEqual(["ボイラ 給水ポンプ No.1", "ボイラ 給水ポンプ No.2"]);
    expect(new Set(machines.map((r) => r.id)).size).toBe(2);
    // 号機は号炉・系統の欄（3 つ目の列）に入れない
    for (const r of m.rows) expect(r.path[2] ?? "").not.toMatch(/No\./);
    // 号炉の無い機器（送風機）も、部位の階層の節（減温塔の噴霧ポンプ）も、号機を添えて分かれる
    expect(pathOf(m, "n:F1")).toBe("架空の通風設備 › 送風機 No.1");
    expect(pathOf(m, "n:F2")).toBe("架空の通風設備 › 送風機 No.2");
    expect(pathOf(m, "n:L1")).toBe("架空の排ガス設備 › 減温塔 › 1 号炉 › 減温塔噴霧P No.1");
    expect(pathOf(m, "n:L2")).toBe("架空の排ガス設備 › 減温塔 › 1 号炉 › 減温塔噴霧P No.2");
    // 号炉の無い機器の号炉・系統の欄は「―」のまま
    const f1 = m.rows.find((r) => r.id === "n:F1")!;
    expect(f1.levelCells).toEqual(["", "送風機 No.1", "―", ""]);
    // 号機で分けた行には、同じ名前の行が無い（号機の無い計量機の 2 行だけが今どおり同じ名前）
    const ps = allPaths(m).filter((p) => !p.includes("計量機"));
    expect(new Set(ps).size).toBe(ps.length);
    // 印はもとの機器の行に載ったまま（記録の行き先は変わらない）
    expect(new Set(m.rows.flatMap((r) => r.detailKeys)).size).toBe(12);
    expect(m.rows.find((r) => r.id === "n:P1")?.detailKeys).toEqual(["d-P1"]);
    expect(m.orphanDetails).toEqual([]);
  });

  it("号炉が機器群の名前と同じとき（工事共通費 › 1号炉）は、号炉を 2 回出さない", () => {
    const m = buildChart(tagPlan(), catalog, labels, opts);
    expect(pathOf(m, "n:G1")).toBe("工事共通費 › 1号炉");
    expect(pathOf(m, "n:C1")).toBe("工事共通費 › 1号炉 › 共通仮設・入出域管理");
    expect(pathOf(m, "n:C2")).toBe("工事共通費 › 2号炉 › 共通仮設・入出域管理");
    // 号炉・系統の行を足さない（機器の行「m:」も作らない）。部位は部位の列（4 つ目）に置く
    expect(m.rows.some((r) => r.id.startsWith("m:n:S4|"))).toBe(false);
    expect(m.rows.find((r) => r.id === "n:C1")?.level).toBe(4);
    // 行の見える字にも 2 回出さない（号炉・系統の欄は空ける）
    const g1 = m.rows.find((r) => r.id === "n:G1")!;
    expect(g1.levelCells).toEqual(["", "1号炉", "", ""]);
    for (const r of m.rows.filter((x) => x.path[0] === "工事共通費")) expect(r.levelCells.join("/")).not.toMatch(/\d 号炉/);
  });

  it("tag が無く名前だけが同じときは、名前を変えない（番号を振らない）。号機がみな同じでも添えない", () => {
    const m = buildChart(tagPlan(UNTAGGED), catalog, labels, opts);
    // 今どおり：1 つの機器の行の下に、号炉・系統の行が並ぶ
    expect(m.rows.filter((r) => r.id === "m:n:S1|ボイラ 給水ポンプ")).toHaveLength(1);
    expect(pathOf(m, "n:P1")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ › 1 号炉");
    expect(pathOf(m, "n:P2")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ › 1 号炉");
    expect(pathOf(m, "n:L1")).toBe("架空の排ガス設備 › 減温塔 › 1 号炉 › 減温塔噴霧P");
    expect(m.rows.filter((r) => r.id === "m:n:S2|計量機")).toHaveLength(1);
    expect(pathOf(m, "n:F1")).toBe("架空の通風設備 › 送風機 › ―");
    expect(allPaths(m).some((p) => p.includes("No."))).toBe(false);
    // 号機がみな同じ（No.1 だけ）なら、号機では分かれないので添えない
    const same = buildChart(tagPlan({ pump: ["No.1", "No.1"], fan: ["No.1", "No.1"], spray: ["No.1", "No.1"] }), catalog, labels, opts);
    expect(pathOf(same, "n:P1")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ › 1 号炉");
    expect(pathOf(same, "n:F1")).toBe("架空の通風設備 › 送風機 › ―");
    // 片方だけが号機を持つときは、号機を持つ方だけに添える（無い方に番号を振らない）
    const one = assetLabels(tagPlan({ pump: ["No.1", null], fan: [null, null], spray: [null, null] }).assets);
    expect([one.get("P1"), one.get("P2")]).toEqual(["ボイラ 給水ポンプ No.1", "ボイラ 給水ポンプ"]);
    // 名前の違う機器・兄弟の無い機器は、号機があっても名前のまま
    const lone = assetLabels([asset("x1", null, { name: "灰クレーン", tag: "No.1" }), asset("x2", null, { name: "給じん装置", tag: "No.2" })]);
    expect([...lone.values()]).toEqual(["灰クレーン", "給じん装置"]);
  });
});

describe("chart_rows（Claude が読む行）", () => {
  const ctx = { conversation: "c", rowsRemaining: 2000 };
  const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】号機の試験", fiscalYearStartMonth: 4, fictional: true });
  const ok = (r: TabToolResult) => {
    if (!r.ok) throw new Error(r.code);
    return r.data as { rows: { rowRef: string; cells: Record<string, string> }[] };
  };
  beforeEach(() => setWorkingPlan(tagPlan(), "intake"));
  afterEach(() => clearWorkingPlan());

  it("No.1・No.2 の 2 機器は別の名前の行になる。機器の行の id で読む作業の行の道にも号機が出る", () => {
    const r = ok(runTabTool(ws(), "chart_rows", { limit: 200 }, ctx));
    const path = (ref: string) => r.rows.find((x) => x.rowRef === ref)?.cells[TEXT.intake.ai.rowPath];
    expect(path("n:P1")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.1 › 1 号炉");
    expect(path("n:P2")).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.2 › 1 号炉");
    expect(path("n:G1")).toBe("工事共通費 › 1号炉");
    expect(path("n:C1")).toBe("工事共通費 › 1号炉 › 共通仮設・入出域管理");
    const w1 = ok(runTabTool(ws(), "chart_rows", { rowRef: "n:B1" }, ctx));
    const w2 = ok(runTabTool(ws(), "chart_rows", { rowRef: "n:B2" }, ctx));
    expect(w1.rows[0]?.cells[TEXT.intake.ai.rowPath]).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.1 › ポンプ本体 軸受・軸封");
    expect(w2.rows[0]?.cells[TEXT.intake.ai.rowPath]).toBe("架空のボイラ設備 › ボイラ 給水ポンプ No.2 › ポンプ本体 軸受・軸封");
  });

  it("tag が無ければ、行の名前は今どおり", () => {
    setWorkingPlan(tagPlan(UNTAGGED), "intake");
    const r = ok(runTabTool(ws(), "chart_rows", { limit: 200 }, ctx));
    const names = r.rows.map((x) => x.cells[TEXT.intake.ai.rowPath] ?? "");
    expect(names.filter((x) => x === "架空のボイラ設備 › ボイラ 給水ポンプ › 1 号炉")).toHaveLength(2);
    expect(names.some((x) => x.includes("No."))).toBe(false);
  });
});

describe("Excel の書き出しと差分レポート", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });
  const sheetRows = async (buf: Buffer, sheet?: string): Promise<string[][]> => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = sheet ? wb.getWorksheet(sheet)! : wb.worksheets[0]!;
    const out: string[][] = [];
    ws.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : String(v)))));
    return out;
  };

  it("書き出しの星取表のシートの機器の名前に号機が出る。号炉と同じ名前の機器群は 1 回だけ", async () => {
    const rows = await sheetRows(await planWorkbook({ plan: tagPlan(), version: 1, at: "2026-11-07T00:00:00.000Z", catalog, emptyCatalog: empty }), EXPORT_TEXT.sheetLedger);
    const cells = rows.flat();
    expect(cells).toContain("ボイラ 給水ポンプ No.1");
    expect(cells).toContain("ボイラ 給水ポンプ No.2");
    expect(cells).toContain("送風機 No.1");
    expect(cells).toContain("減温塔噴霧P No.2");
    const g1 = rows.find((r) => r.includes("1号炉"));
    expect(g1?.some((c) => /^1 号炉$/.test(c))).toBe(false);
  });

  it("差分の機器の名前も星取表と同じ形。tag が無ければ名前のまま", () => {
    const d = diffPlans(null, tagPlan());
    const eq = (k: string) => d.rows.find((r) => r.nodeKey === k)?.equipment;
    expect([eq("P1"), eq("P2"), eq("F1"), eq("L2"), eq("K1"), eq("G1"), eq("C1")]).toEqual([
      "ボイラ 給水ポンプ No.1",
      "ボイラ 給水ポンプ No.2",
      "送風機 No.1",
      "減温塔噴霧P No.2",
      "計量機",
      undefined,
      "共通仮設・入出域管理",
    ]);
    expect(diffPlans(null, tagPlan(UNTAGGED)).rows.find((r) => r.nodeKey === "F1")?.equipment).toBe("送風機");
  });

  it("署名される字（版の記録の機器の名前・nodeKey・detailKey・basis）は変えない。前の版の記録を読み直しても同じ版の記録になる。差分レポートには号機が出る", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-tag-"));
    const root = join(dir, "利用者", "OneDrive", "ドキュメント", "MOYAI");
    const p = tagPlan();
    const before = structuredClone(p);
    // 見せ方を作っても計画は変わらない
    buildChart(p, catalog, labels, opts);
    diffPlans(null, p);
    assetLabels(p.assets);
    expect(p).toEqual(before);

    const v1 = await commitPlan({ root, plan: p, reason: "号機の試験", acceptances: [], basedOn: null, signer: SIGNER, client: "t", catalogs: () => ({ catalog, empty }), now: new Date("2026-11-07T00:00:00.000Z") });
    if (!v1.ok) throw new Error(v1.reason);
    // 版の記録の計画は、渡した計画と同じ（機器の名前に号機を添えない）
    expect(v1.record.plan.assets).toEqual(p.assets);
    expect(v1.record.plan.assets.find((a) => a.nodeKey === "P1")).toMatchObject({ name: "ボイラ 給水ポンプ", tag: "No.1" });
    expect(v1.record.plan.details.map((x) => [x.detailKey, x.basis])).toEqual(p.details.map((x) => [x.detailKey, x.basis]));
    // 読み直すと同じ版の記録・同じ中身のハッシュ
    const read1 = await readPlanVersion(root, p.planId, 1);
    if (!read1.ok) throw new Error(read1.reason);
    expect(read1.record).toEqual(v1.record);
    expect(read1.contentHash).toBe(contentHash(v1.record));
    // 読み直した版の計画から次の版を作っても、印の差は無い（名前・鍵が変わっていない）
    const v2 = await commitPlan({ root, plan: Plan.parse(read1.record.plan), reason: "読み直しの試験", acceptances: [], basedOn: 1, signer: SIGNER, client: "t", catalogs: () => ({ catalog, empty }) });
    if (!v2.ok) throw new Error(v2.reason);
    expect(v2.record.summary).toEqual({ added: 0, removed: 0, changed: 0, same: 12 });
    const hist = await readHistory(root, p.planId);
    expect(hist.versions.map((x) => x.problem)).toEqual([null, null]);
    const again = await readPlanVersion(root, p.planId, 1);
    expect(again.ok && again.record).toEqual(v1.record);
    // 差分レポート（第 1 版）の機器の欄は、星取表と同じ見せる名前
    const report = await sheetRows(readFileSync(v1.files.report));
    const equipment = report.slice(7).map((r) => r[0]);
    expect(equipment).toContain("ボイラ 給水ポンプ No.1");
    expect(equipment).toContain("ボイラ 給水ポンプ No.2");
    expect(equipment).toContain("送風機 No.1");
    expect(equipment).toContain("送風機 No.2");
    expect(equipment).toContain("減温塔噴霧P No.1");
    expect(equipment).toContain("計量機");
  });
});
