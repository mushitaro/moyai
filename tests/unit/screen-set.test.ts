// チャットの頼みで作業画面を動かすツール screen_set と、表示の 3 つ（階層の入れ替え・並び順・計画の最大年度）。仕事 chat-ops-v1。
// - 6 つの引数（theme・go・storageRoot・levelOrder・rowOrder・lastFiscalYear）が、それぞれ作業画面の状態を変える（人の操作と同じ関数）
// - 階層の入れ替えで、星取表の行が 設備 › 号炉 › 機器 になる。並び順の入れ替えが、星取表・chart_rows・確定のときの Excel に出る
// - 最大年度で、年度の列が 2040 まで出る。周期の案もその年度まで置ける
// - 見せ方は作業中の計画を変えず、版の記録の計画（署名される字）も変わらない。保存先は人が設定の画面で「保存」を押すまで変わらない
// 計画はすべて架空。ファイルを書く試験は一時のフォルダで行う。
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool, type TabToolResult } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { GO_HASH, bindTheme, currentGo, displayPrefs, resetScreenForTest, setDisplayPrefs, takeRootOffer } from "../../src/app/state/screen";
import { DisplaySettings, displayModel, reorderParents } from "../../src/app/components/DisplaySettings";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TEXT } from "../../src/app/text";
import { routeOf } from "../../src/app/stages";
import { buildChart, catalogFromPack, siblingOrder, type ChartModel, type ChartOptions } from "../../src/plan/chart";
import { EXPORT_TEXT, planWorkbook } from "../../src/plan/export";
import { commitPlan } from "../../src/plan/store";
import { BRIDGE_TOOL_RECEIVERS } from "../../src/bridge/tools";
import { MCP_INSTRUCTIONS } from "../../src/shared/instructions";
import { SCREEN_GO, TOOLS, TOOL_NAMES } from "../../src/shared/tools";
import toolNames from "../../src/shared/tool-names.json";
import type { Plan } from "../../src/shared/plan";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createRelayServer } from "../../src/cli/relay";
import { encodeEvent } from "../../src/shared/events";
import { readSettings, writeSettings } from "../../src/bridge/places";
import { FakeTab, SECRET_A, startTestBridge } from "../helpers/bridge";
import { SIGNER } from "../helpers/signer";
import { asset, detail, plan as planOf, work } from "./share/fixtures";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const kinds = json("packs/_kinds/work.json");
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), kinds);
const empty = catalogFromPack({ systems: [] }, kinds);
const C = TEXT.chart;
const labels = { levelFallback: C.levelFallback, commonLevels: C.commonLevels, unmapped: C.unmapped, series: C.series };
const LEDGER: ChartOptions = { mode: "ledger", period: "year", layer: "adjusted", foldLevel: null };
const SEP = C.pathSep;
const FAC = "fac-screen";
const CTX = { conversation: "c-screen", rowsRemaining: 2000 };

/**
 * 架空の計画：設備 › 機器 › 部位（号炉は機器の属性 series）。
 * - 架空の燃焼設備：給じん装置 ×2（1 号炉・2 号炉）とその軸受、押込送風機 ×2（1 号炉・2 号炉）、計量機（号炉なし。分けない）
 * - 架空の通風設備：誘引通風機 ×1（1 号炉）
 */
function screenPlan(): Plan {
  const a = (key: string, level: number, parentKey: string | null, name: string, series: string | null = null) =>
    asset(key, null, { level, parentKey, name, series, commonItemAuthor: null, commonItemBasis: null, commonItemAccepted: false });
  const assets = [
    a("S1", 1, null, "架空の燃焼設備"),
    a("P1", 2, "S1", "架空の給じん装置", "1"),
    a("P2", 2, "S1", "架空の給じん装置", "2"),
    a("B1", 3, "P1", "架空の軸受"),
    a("B2", 3, "P2", "架空の軸受"),
    a("F1", 2, "S1", "架空の押込送風機", "1"),
    a("F2", 2, "S1", "架空の押込送風機", "2"),
    a("K1", 2, "S1", "架空の計量機"),
    a("S2", 1, null, "架空の通風設備"),
    a("D1", 2, "S2", "架空の誘引通風機", "1"),
  ];
  const targets = ["P1", "P2", "B1", "B2", "F1", "F2", "K1", "D1"];
  const p = planOf({
    assets,
    works: targets.map((k) => work(`w-${k}`, "OVERHAUL", [k], { kind: "架空の整備" })),
    details: targets.map((k, i) => detail(`d-${k}`, `w-${k}`, 2020 + (i % 5), { basis: `架空の記録 ${k}` })),
  });
  return { ...p, planId: "plan-screen", levelNames: ["設備", "機器", "部位"], facility: { ...p.facility, facilityKey: FAC } };
}

const ws = () => new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】見せ方の試験", fiscalYearStartMonth: 4, fictional: true });
const ok = (r: TabToolResult): any => {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
};
const call = (args: Record<string, unknown>, w = ws()) => ok(runTabTool(w, "screen_set", args, CTX));
const pathOf = (m: ChartModel, id: string) => m.rows.find((x) => x.id === id)?.path.filter((x): x is string => !!x).join(SEP);
const chartRowsPaths = (w: IntakeWorkspace) => (ok(runTabTool(w, "chart_rows", { limit: 200 }, CTX)).rows as { rowRef: string; cells: Record<string, string> }[]).map((r) => [r.rowRef, r.cells[TEXT.intake.ai.rowPath]] as const);

/** 画面の外（node）で location.hash を持つ代わり */
const fakeLocation = { hash: "#/" };
beforeEach(() => {
  resetScreenForTest();
  fakeLocation.hash = "#/";
  (globalThis as { location?: unknown }).location = fakeLocation;
});
afterEach(() => {
  clearWorkingPlan();
  resetScreenForTest();
  delete (globalThis as { location?: unknown }).location;
});

describe("ツールの定義", () => {
  it("ツールは 18。screen_set は作業画面が受ける案のツールで、instructions には名前の 1 語だけ", () => {
    expect(TOOL_NAMES).toHaveLength(18);
    expect(toolNames).toContain("screen_set");
    expect(TOOLS.screen_set.kind).toBe("propose");
    expect(TOOLS.screen_set.waitsFor).toBeNull();
    expect(BRIDGE_TOOL_RECEIVERS.screen_set).toBe("tab");
    expect(MCP_INSTRUCTIONS).toContain("screen_set");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
    expect(MCP_INSTRUCTIONS.match(/screen_set/g)).toHaveLength(1);
  });

  it("説明に、想定のプロンプトとその引数があり、人だけの操作はしないと書いてある", () => {
    const d = TOOLS.screen_set.description;
    for (const s of ["「ライトモードにして」", "「ファイルの保管場所を変更して」", "「星取表画面に切り替えて」", "「機器階層を入れ替えて表示して」", "並び順を入れ替えて」", "「計画の最大年度は 2040 年までにして」"]) expect(d).toContain(s);
    for (const s of ["theme: light", "go: hoshitori.chart", "storageRoot", "levelOrder", "rowOrder", "lastFiscalYear: 2040"]) expect(d).toContain(s);
    expect(d).toContain("確定・署名・送る・承認・昇格は、このツールではしない");
  });

  it("引数は 1 つ以上。知らない引数・形の外れた値は断る", () => {
    const input = TOOLS.screen_set.input;
    expect(input.safeParse({}).success).toBe(false);
    expect(input.safeParse({ theme: "sepia" }).success).toBe(false);
    // 「PC の設定に合わせて」は auto（#61。既定も自動）
    expect(input.safeParse({ theme: "auto" }).success).toBe(true);
    expect(input.safeParse({ go: "hoshitori.unknown" }).success).toBe(false);
    expect(input.safeParse({ confirm: true, theme: "light" }).success).toBe(false);
    expect(input.safeParse({ lastFiscalYear: 2040.5 }).success).toBe(false);
    expect(input.safeParse({ rowOrder: { node: "n:P1" } }).success).toBe(false);
    expect(input.safeParse({ theme: "light", go: "hoshitori.chart", levelOrder: "series-first", lastFiscalYear: 2040 }).success).toBe(true);
  });
});

describe("6 つの引数がそれぞれ作業画面の状態を変える", () => {
  it("theme：ヘッダの 暗 / 明 と同じ手（applyTheme）で明暗を変える。手がまだ無ければ変えずに理由を返す", () => {
    const none = call({ theme: "light" });
    expect(none.changed).toEqual([]);
    expect(none.refused[0]).toMatchObject({ item: "theme", reason: "not_on_screen" });
    const set: string[] = [];
    bindTheme((t) => set.push(t));
    const r = call({ theme: "light" });
    expect(set).toEqual(["light"]);
    expect(r.changed).toEqual(["theme"]);
    expect(r.current.theme).toBe("light");
    expect(call({ theme: "dark" }).current.theme).toBe("dark");
    expect(set).toEqual(["light", "dark"]);
  });

  it("go：段のリンクと同じ hash に移る。どの行き先も、画面の道の読み方で同じ画面に戻る（前の export・share は出力・共有のシート）", () => {
    const r = call({ go: "hoshitori.chart" });
    expect(fakeLocation.hash).toBe("#/merge/chart");
    expect(r.changed).toEqual(["go"]);
    expect(r.current.go).toBe("hoshitori.chart");
    for (const g of SCREEN_GO) {
      call({ go: g });
      expect(fakeLocation.hash).toBe(GO_HASH[g]);
      // 前の値 export・share は HOSHITORI の出力・共有のシートを開き、今の画面は新しい値で返す（mushitaro/moyai#30）
      const now = g === "export" || g === "share" ? (`hoshitori.${g}` as const) : g;
      expect(currentGo(), g).toBe(now);
      expect(routeOf(fakeLocation.hash).stage, g).toBe(now === "top" ? "top" : now.startsWith("hoshitori.") ? "merge" : now);
    }
    expect(routeOf(GO_HASH["hoshitori.rules"]).sheet).toBe("readings");
    expect(routeOf(GO_HASH["hoshitori.review"]).sheet).toBe("check");
    expect(GO_HASH.export).toBe("#/merge/export");
    expect(GO_HASH.share).toBe("#/merge/share");
    expect(routeOf("#/checkpoint")).toEqual({ stage: "merge", sheet: "share" });
  });

  it("storageRoot：設定の画面の保存先の欄に入れて開くだけ（保存は人）。変えなかった項目に数え、理由を添える", () => {
    const r = call({ storageRoot: "/tmp/架空の保存先" });
    expect(r.changed).toEqual([]);
    expect(r.refused).toEqual([expect.objectContaining({ item: "storageRoot", reason: "root_human_save" })]);
    expect(r.refused[0].text).toContain("「保存」");
    expect(fakeLocation.hash).toBe("#/settings");
    expect(r.current.go).toBe("settings");
    expect(takeRootOffer()).toBe("/tmp/架空の保存先");
    expect(takeRootOffer()).toBeNull();
    // 保存先と一緒にほかの画面を頼まれても、保存先の欄を見せる設定の画面にする
    const both = call({ storageRoot: "/tmp/架空の保存先", go: "export" });
    expect(both.refused.map((x: { reason: string }) => x.reason).sort()).toEqual(["go_replaced", "root_human_save"]);
    expect(fakeLocation.hash).toBe("#/settings");
  });

  it("levelOrder：施設ごとに覚え、星取表と chart_rows の行が 設備 › 号炉 › 機器 になる", () => {
    setWorkingPlan(screenPlan(), "intake");
    const w = ws();
    expect(pathOf(displayModel(screenPlan(), displayPrefs(FAC)), "n:B1")).toBe(["架空の燃焼設備", "架空の給じん装置", "1 号炉", "架空の軸受"].join(SEP));
    const r = call({ levelOrder: "series-first" }, w);
    expect(r.changed).toEqual(["levelOrder"]);
    expect(r.current.levelOrder).toBe("series-first");
    expect(displayPrefs(FAC).levelOrder).toBe("series-first");
    expect(displayPrefs("fac-other").levelOrder).toBe("asset-first");
    const paths = new Map(chartRowsPaths(w));
    expect(paths.get("n:P1")).toBe(["架空の燃焼設備", "1 号炉", "架空の給じん装置"].join(SEP));
    expect(paths.get("n:B2")).toBe(["架空の燃焼設備", "2 号炉", "架空の給じん装置", "架空の軸受"].join(SEP));
    expect(paths.get("n:D1")).toBe(["架空の通風設備", "1 号炉", "架空の誘引通風機"].join(SEP));
  });

  it("rowOrder：同じ親の下の行を before の前に置き、施設ごとに覚える。行が無い・親が違うときは理由を返す", () => {
    setWorkingPlan(screenPlan(), "intake");
    const w = ws();
    const before = chartRowsPaths(w).map(([id]) => id);
    const feeder = before.find((id) => id.startsWith("m:") && id.includes("給じん装置"))!;
    const fan = before.find((id) => id.startsWith("m:") && id.includes("押込送風機"))!;
    expect(before.indexOf(feeder)).toBeLessThan(before.indexOf(fan));
    const r = call({ rowOrder: { node: fan, before: feeder } }, w);
    expect(r.changed).toEqual(["rowOrder"]);
    expect(r.current.siblings.map((x: { rowRef: string }) => x.rowRef)).toEqual([fan, feeder, "n:K1"]);
    expect(r.current.siblings[0].name).toBe("架空の押込送風機");
    const after = chartRowsPaths(w).map(([id]) => id);
    expect(after.indexOf(fan)).toBeLessThan(after.indexOf(feeder));
    expect(displayPrefs(FAC).rowOrder["n:S1"]).toEqual([fan, feeder, "n:K1"]);
    expect(call({ rowOrder: { node: "n:無い", before: feeder } }, w).refused[0]).toMatchObject({ item: "rowOrder", reason: "row_unknown" });
    expect(call({ rowOrder: { node: "n:D1", before: feeder } }, w).refused[0]).toMatchObject({ item: "rowOrder", reason: "row_not_sibling" });
    clearWorkingPlan();
    expect(call({ rowOrder: { node: fan, before: feeder } }, w).refused[0]).toMatchObject({ item: "rowOrder", reason: "no_working_plan" });
  });

  it("lastFiscalYear：施設ごとに覚え、星取表の年度の列が 2040 まで出る。いちばん遅い星取より前の年度は断る", () => {
    setWorkingPlan(screenPlan(), "intake");
    const r = call({ lastFiscalYear: 2040 });
    expect(r.changed).toEqual(["lastFiscalYear"]);
    expect(r.current.lastFiscalYear).toBe(2040);
    const m = buildChart(screenPlan(), catalog, labels, { ...LEDGER, lastFiscalYear: displayPrefs(FAC).lastFiscalYear });
    expect(m.periods[0]!.fiscalYear).toBe(2020);
    expect(m.periods.at(-1)!.fiscalYear).toBe(2040);
    expect(m.periods).toHaveLength(21);
    // 既定（覚えていない）は計画の最後の年度まで
    expect(buildChart(screenPlan(), catalog, labels, LEDGER).periods.at(-1)!.fiscalYear).toBe(2024);
    const early = call({ lastFiscalYear: 2023 });
    expect(early.changed).toEqual([]);
    expect(early.refused[0]).toMatchObject({ item: "lastFiscalYear", reason: "year_before_stars" });
    expect(displayPrefs(FAC).lastFiscalYear).toBe(2040);
  });

  it("答えの current に、見せ方を覚えた施設の名前と作業中の計画の版（chart_rows の version と同じ数）。計画が無ければ施設設定の施設名と null（仕事 chat-prompts-v1）", () => {
    // 計画が無い：作業画面の施設設定の施設名、版は null
    const none = call({ levelOrder: "series-first" });
    expect(none.current).toMatchObject({ facility: "【架空】見せ方の試験", planVersion: null });
    // 施設名も無ければ null（推測で埋めない）
    const blank = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
    expect(call({ theme: "light" }, blank).current).toMatchObject({ facility: null, planVersion: null });
    // 計画がある：作業中の計画の施設と版
    const p = screenPlan();
    setWorkingPlan({ ...p, facility: { ...p.facility, name: "【架空】見せ方の計画の施設" } }, "intake");
    const w = ws();
    const r = call({ lastFiscalYear: 2040 }, w);
    const version = ok(runTabTool(w, "chart_rows", { limit: 1 }, CTX)).version;
    expect(r.current).toMatchObject({ facility: "【架空】見せ方の計画の施設", planVersion: getWorkingPlan()!.revision });
    expect(r.current.planVersion).toBe(version);
    expect(TOOLS.screen_set.output.safeParse(r).success).toBe(true);
  });
});

describe("最大年度と周期の案・星取の案", () => {
  it("周期の案は最大年度（2040）まで置ける。今の星取は変えない", () => {
    setWorkingPlan(screenPlan(), "intake");
    const w = ws();
    const rule = { when: [{ field: "assetNode.name", op: "equals", values: ["架空の誘引通風機"] }], set: { field: "work.trigger", value: 5 }, reason: "架空の周期" };
    const base = getWorkingPlan()!;
    // 最大年度が無ければ、最後の実績（2022）から 5 年後は計画の最後の年度（2024）を越えるので置かない
    const none = ok(runTabTool(w, "chart_propose", { rules: [rule], basedOnVersion: base.revision, basis: "利用者が会話で言った周期", author: "ai_relayed_human" }, CTX));
    expect(none.proposals[0].skipped.noHorizon).toBe(1);
    const before = structuredClone(getWorkingPlan()!.plan.details);
    call({ lastFiscalYear: 2040 }, w);
    expect(getWorkingPlan()!.plan.details).toEqual(before);
    const r = ok(runTabTool(w, "chart_propose", { rules: [rule], basedOnVersion: getWorkingPlan()!.revision, basis: "利用者が会話で言った周期", author: "ai_relayed_human" }, CTX));
    const years = getWorkingPlan()!.plan.details.filter((d) => d.workKey === "w-D1" && d.planOrActual === "plan").map((d) => d.fiscalYear).sort();
    expect(r.proposals[0].marks).toBe(3);
    expect(years).toEqual([2027, 2032, 2037]);
    // 星取の案も、列のある 2040 年度まで置ける（その先は範囲の外）
    const add = (fy: number) => runTabTool(w, "chart_propose", { basedOnVersion: getWorkingPlan()!.revision, basis: "利用者の言葉", author: "ai_relayed_human", stars: [{ op: "add", rowRef: "w:w-K1", value: "plan", fiscalYear: fy }] }, CTX);
    expect(add(2040).ok).toBe(true);
    expect(add(2041)).toEqual({ ok: false, code: "star_out_of_range" });
  });
});

describe("Excel と版の記録", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });
  const sheetRows = async (buf: Buffer, sheet: string): Promise<string[][]> => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const out: string[][] = [];
    wb.getWorksheet(sheet)!.eachRow((row) => out.push((row.values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? "" : String(v)))));
    return out;
  };
  const firstRowOf = (rows: string[][], name: string) => rows.findIndex((r) => r.includes(name));

  it("並び順の入れ替えが、星取表と書き出しの Excel に同じ並びで出る", async () => {
    const p = screenPlan();
    const m0 = buildChart(p, catalog, labels, LEDGER);
    const feeder = m0.rows.find((r) => r.id.startsWith("m:") && r.id.includes("給じん装置"))!.id;
    const fan = m0.rows.find((r) => r.id.startsWith("m:") && r.id.includes("押込送風機"))!.id;
    const o = siblingOrder(m0, fan, feeder);
    if (typeof o === "string") throw new Error(o);
    const rowOrder = { [o.parent]: o.order };
    const m1 = buildChart(p, catalog, labels, { ...LEDGER, rowOrder });
    const ids = m1.rows.map((r) => r.id);
    expect(ids.indexOf(fan)).toBeLessThan(ids.indexOf(feeder));
    // 子（号炉の行・部位）は動かした機器と一緒に動く
    expect(ids.indexOf("n:F2")).toBeLessThan(ids.indexOf(feeder));
    const plain = await sheetRows(await planWorkbook({ plan: p, version: 1, at: "2026-11-07T00:00:00.000Z", catalog, emptyCatalog: empty }), EXPORT_TEXT.sheetLedger);
    const moved = await sheetRows(await planWorkbook({ plan: p, version: 1, at: "2026-11-07T00:00:00.000Z", catalog, emptyCatalog: empty, rowOrder }), EXPORT_TEXT.sheetLedger);
    expect(firstRowOf(plain, "架空の給じん装置")).toBeLessThan(firstRowOf(plain, "架空の押込送風機"));
    expect(firstRowOf(moved, "架空の押込送風機")).toBeLessThan(firstRowOf(moved, "架空の給じん装置"));
    expect(moved.length).toBe(plain.length);
  });

  it("階層の入れ替えは 設備 › 号炉・系統 › 機器 › 部位 の列になり、号炉の無い機器は機器の列に置き、号炉の欄に「―」", () => {
    const m = buildChart(screenPlan(), catalog, labels, { ...LEDGER, levelOrder: "series-first" });
    expect(m.levelNames).toEqual(["設備", "号炉", "機器", "部位"]);
    expect(m.seriesColumn).toBe(1);
    const k1 = m.rows.find((r) => r.id === "n:K1")!;
    expect(k1.path).toEqual(["架空の燃焼設備", null, "架空の計量機", null]);
    expect(k1.levelCells[1]).toBe("―");
    // 号炉の行の下に、その号炉の機器（上の行と同じ名前は空ける）
    expect(m.rows.find((r) => r.id === "s:n:S1|2 号炉")!.levelCells).toEqual(["", "2 号炉", "", ""]);
    expect(m.rows.find((r) => r.id === "n:P2")!.levelCells).toEqual(["", "", "架空の給じん装置", ""]);
    expect(m.rows.find((r) => r.id === "n:F2")!.levelCells).toEqual(["", "", "架空の押込送風機", ""]);
    // 既定は今どおり
    const d = buildChart(screenPlan(), catalog, labels, LEDGER);
    expect(d.levelNames).toEqual(["設備", "機器", "号炉", "部位"]);
    expect(d.seriesColumn).toBe(2);
  });

  it("見せ方は作業中の計画を変えず、確定した版の記録の計画（署名される字）も変わらない。機器の並びは Excel だけに出る", async () => {
    setWorkingPlan(screenPlan(), "intake");
    const w = ws();
    const before = JSON.stringify(getWorkingPlan()!.plan);
    bindTheme(() => {});
    const feeder = chartRowsPaths(w).find(([id]) => id.startsWith("m:") && id.includes("給じん装置"))![0];
    const fan = chartRowsPaths(w).find(([id]) => id.startsWith("m:") && id.includes("押込送風機"))![0];
    call({ theme: "light", go: "hoshitori.chart", rowOrder: { node: fan, before: feeder } }, w);
    call({ levelOrder: "series-first", lastFiscalYear: 2040 }, w);
    call({ storageRoot: "/tmp/架空の保存先" }, w);
    expect(JSON.stringify(getWorkingPlan()!.plan)).toBe(before);

    dir = mkdtempSync(join(tmpdir(), "moyai-screen-"));
    const commit = (root: string, rowOrder?: Record<string, readonly string[]>) =>
      commitPlan({
        root: join(dir, root),
        plan: getWorkingPlan()!.plan,
        reason: "見せ方の試験",
        acceptances: [],
        basedOn: null,
        signer: SIGNER,
        client: "t",
        catalogs: () => ({ catalog, empty }),
        now: new Date("2026-11-07T00:00:00.000Z"),
        ...(rowOrder ? { rowOrder } : {}),
      });
    const plain = await commit("a");
    const shown = await commit("b", { ...displayPrefs(FAC).rowOrder });
    if (!plain.ok || !shown.ok) throw new Error("確定できない");
    // 版の記録の計画は、渡した計画のまま（見せ方の並び・階層・年度は入らない）
    expect(JSON.stringify(shown.record.plan)).toBe(JSON.stringify(plain.record.plan));
    expect(JSON.stringify(plain.record.plan)).toBe(JSON.stringify({ ...JSON.parse(before), version: 1 }));
    // 版の記録は、書いたファイルのハッシュ（Excel は書くたびに中の時刻が変わる）のほかは同じ字
    const { files: _f1, ...r1 } = plain.record;
    const { files: _f2, ...r2 } = shown.record;
    expect(JSON.stringify(r2)).toBe(JSON.stringify(r1));
    // 機器の並びは Excel にだけ出る
    const xl0 = await sheetRows(readFileSync(plain.files.export!), EXPORT_TEXT.sheetLedger);
    const xl = await sheetRows(readFileSync(shown.files.export!), EXPORT_TEXT.sheetLedger);
    expect(firstRowOf(xl0, "架空の給じん装置")).toBeLessThan(firstRowOf(xl0, "架空の押込送風機"));
    expect(firstRowOf(xl, "架空の押込送風機")).toBeLessThan(firstRowOf(xl, "架空の給じん装置"));
    // 階層の並び（series-first）は Excel にも版の記録にも入らない（既定の 設備 › 機器 › 号炉 の列のまま）
    expect(xl.find((r) => r.includes("設備"))).toEqual(expect.arrayContaining(["設備", "機器", "号炉", "部位"]));
  });
});

describe("設定の「表示」の節（人が切り替える所）", () => {
  it("階層・並び・最終年度の切り替えがあり、今の見せ方を出す（docs/screens.md 3.7 の字）。作業中の計画が無ければ「作業中の計画なし」", () => {
    setDisplayPrefs(FAC, { levelOrder: "series-first", lastFiscalYear: 2040 });
    const html = renderToStaticMarkup(createElement(DisplaySettings, { plan: screenPlan() }));
    for (const id of ["display-level-order", "display-row-order", "display-last-year", "display-last-year-input", "display-last-year-reset"]) expect(html).toContain(`data-testid="${id}"`);
    // 並べ替えはここでしない（「親の行」「上へ」は置かない）
    expect(html).not.toContain('data-testid="display-row-parent"');
    expect(html).not.toContain("親の行");
    // 号炉・系統の字は Skillパックの既定の階層の名前（ごみ焼却は号炉）
    expect(html).toMatch(/aria-pressed="true"[^>]*>設備 › 号炉 › 機器</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>設備 › 機器 › 号炉</);
    expect(html).toMatch(/data-testid="display-last-year-input"[^>]*value="2040"|value="2040"[^>]*data-testid="display-last-year-input"/);
    expect(html).toContain("計画の最終年度に戻す");
    expect(renderToStaticMarkup(createElement(DisplaySettings, { plan: null }))).toContain("作業中の計画なし");
  });

  it("入れ替えられる親の行と子の並びは、AI の rowOrder と同じ関数で動く", () => {
    const p = screenPlan();
    setDisplayPrefs(FAC, { levelOrder: "series-first" });
    const parents = reorderParents(displayModel(p, displayPrefs(FAC)));
    const top = parents.find((x) => x.id === "")!;
    expect(top.children.map((c) => c.name)).toEqual(["架空の燃焼設備", "架空の通風設備"]);
    const s1 = parents.find((x) => x.id === "n:S1")!;
    expect(s1.children.map((c) => c.name)).toEqual(["1 号炉", "2 号炉", "架空の計量機"]);
    const r = siblingOrder(displayModel(p, displayPrefs(FAC)), s1.children[1]!.id, s1.children[0]!.id);
    if (typeof r === "string") throw new Error(r);
    setDisplayPrefs(FAC, { rowOrder: { [r.parent]: r.order } });
    expect(reorderParents(displayModel(p, displayPrefs(FAC))).find((x) => x.id === "n:S1")!.children.map((c) => c.name)).toEqual(["2 号炉", "1 号炉", "架空の計量機"]);
  });
});

describe("橋渡し：保存先の道は設定と同じ確かめを通し、保存はしない", () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0).reverse()) await c();
  });

  async function setup() {
    const tb = await startTestBridge({ toolTimeouts: { read: 2000, propose: 2000, start: 2000 } });
    cleanups.push(() => tb.close());
    writeSettings(tb.stateDir, { v: 1, root: "/tmp/架空の今の保存先", ledger: null, name: null });
    const t = new FakeTab(`ws://${tb.host}/ws`, tb.origin);
    await t.opened;
    t.send("tab.hello", { secret: SECRET_A, build: "test" });
    await t.next("bridge.welcome");
    const calls: { name: string; args: any }[] = [];
    t.ws.on("message", (raw) => {
      const ev = JSON.parse(raw.toString("utf8"));
      if (ev.type !== "bridge.tool_call") return;
      calls.push(ev.data);
      // 作業画面のふり：受け取った引数を screenSet と同じ形で答える
      const a = ev.data.args;
      const result = {
        ok: true,
        data: {
          changed: a.theme ? ["theme"] : [],
          refused: a.storageRoot ? [{ item: "storageRoot", reason: "root_human_save", text: "人が保存" }] : [],
          current: { theme: a.theme ?? null, go: a.storageRoot ? "settings" : null, levelOrder: "asset-first", lastFiscalYear: null, facility: "【架空】見せ方の試験", planVersion: null },
          note: "n",
        },
      };
      t.ws.send(encodeEvent("tab.tool_result", { requestId: ev.data.requestId, result: result as any }));
    });
    cleanups.push(() => t.ws.close());
    const server = createRelayServer({ stateDir: tb.stateDir });
    const [x, y] = InMemoryTransport.createLinkedPair();
    const c = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(x), c.connect(y)]);
    cleanups.push(() => c.close());
    await c.listTools();
    const run = async (args: Record<string, unknown>) => {
      const r: any = await c.callTool({ name: "screen_set", arguments: args });
      expect(r.isError, JSON.stringify(r.content)).toBeFalsy();
      return r.structuredContent;
    };
    return { tb, calls, run };
  }

  it("絶対の道でなければ作業画面へ渡さずに断り、今の保存先を添える。設定は書き換えない", async () => {
    const { tb, calls, run } = await setup();
    const r = await run({ storageRoot: "相対の道/MOYAI" });
    expect(calls).toHaveLength(0);
    expect(r.changed).toEqual([]);
    expect(r.refused).toEqual([expect.objectContaining({ item: "storageRoot", reason: "root_invalid" })]);
    expect(r.current.storageRoot).toBe("/tmp/架空の今の保存先");
    // 作業画面に聞いていないので、施設と計画の版は分からない（null）
    expect(r.current).toMatchObject({ facility: null, planVersion: null });
    expect(readSettings(tb.stateDir).root).toBe("/tmp/架空の今の保存先");
    // ほかの頼みと一緒なら、ほかは作業画面へ渡し、保存先は断ったことを足す
    const both = await run({ storageRoot: "相対の道", theme: "light" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual({ theme: "light" });
    expect(both.changed).toEqual(["theme"]);
    expect(both.current).toMatchObject({ facility: "【架空】見せ方の試験", planVersion: null });
    expect(both.refused).toEqual([expect.objectContaining({ item: "storageRoot", reason: "root_invalid" })]);
  });

  it("絶対の道は、確かめた形で作業画面へ渡す（設定の画面の欄に入れるだけ）。設定の保存先は変わらない", async () => {
    const { tb, calls, run } = await setup();
    const asked = `${join(tmpdir(), "架空の新しい保存先")}${sep}..${sep}架空の保存先`;
    const r = await run({ storageRoot: asked });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args).toEqual({ storageRoot: resolve(asked) });
    expect(calls[0]!.args.storageRoot).toBe(join(tmpdir(), "架空の保存先"));
    expect(r.refused).toEqual([expect.objectContaining({ item: "storageRoot", reason: "root_human_save" })]);
    expect(r.current.storageRoot).toBe("/tmp/架空の今の保存先");
    expect(readSettings(tb.stateDir).root).toBe("/tmp/架空の今の保存先");
  });
});
