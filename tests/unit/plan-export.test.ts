// 書き出し（docs/plan.md §2.9・§6.1 の 6）：確定した計画を、人が見る様式の Excel にする。
// 書いた xlsx を exceljs で読み直し、入れ子（段の列）・縦の結合・アウトライン・小計の行・A3 横・ウィンドウ枠の固定・凡例・【架空】を確かめる。
// Excel で開いて見やすいかは、運営者の目で確かめる（ここで言えるのは「様式どおりに書けた」まで）。
import { SIGNER } from "../helpers/signer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { afterAll, describe, expect, it } from "vitest";
import { buildChart, catalogFromPack } from "../../src/plan/chart";
import { pendingDecisions } from "../../src/plan/diff";
import { EXPORT_TEXT, planWorkbook } from "../../src/plan/export";
import { commitPlan } from "../../src/plan/store";
import { Plan } from "../../src/shared/plan";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const work = json("packs/_kinds/work.json");
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), work);
const empty = catalogFromPack({ systems: [] }, work);
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

async function read(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

describe("書き出し：人が見る様式の星取表", () => {
  const plan = Plan.parse(truthToPlan("fictional-1"));

  it("2 つのシート、表題と作成者の欄に【架空】、凡例、年度の見出し", async () => {
    const wb = await read(await planWorkbook({ plan, version: 3, at: "2026-11-03T10:00:00.000Z", catalog, emptyCatalog: empty }));
    expect(wb.worksheets.map((w) => w.name)).toEqual([EXPORT_TEXT.sheetLedger, EXPORT_TEXT.sheetCommon]);
    expect(wb.creator).toBe("【架空】");
    const ws = wb.getWorksheet(EXPORT_TEXT.sheetLedger)!;
    expect(String(ws.getCell(1, 1).value)).toContain("【架空】");
    expect(String(ws.getCell(3, 2).value)).toContain("第 3 版");
    expect(String(ws.getCell(4, 1).value)).toContain("○ 計画");
    const model = buildChart(plan, catalog, EXPORT_TEXT.labels, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
    const head = ws.getRow(6).values as unknown[];
    expect(head.slice(1)).toEqual([...model.levelNames, ...model.periods.map((p) => `${p.fiscalYear} 年度`), "次回", "期限", "根拠", "備考"]);
  });

  it("A3 横・幅を 1 頁・見出しの行をくり返す・段の列と見出しで枠を固定・アウトラインは親が上", async () => {
    const wb = await read(await planWorkbook({ plan, version: 1, at: "2026-11-03T10:00:00.000Z", catalog, emptyCatalog: empty }));
    const ws = wb.getWorksheet(EXPORT_TEXT.sheetLedger)!;
    expect(ws.pageSetup.paperSize).toBe(8);
    expect(ws.pageSetup.orientation).toBe("landscape");
    expect(ws.pageSetup.fitToWidth).toBe(1);
    expect(ws.pageSetup.printTitlesRow).toBe("6:6");
    const nLevels = buildChart(plan, catalog, EXPORT_TEXT.labels, { mode: "ledger", period: "year", layer: "original", foldLevel: null }).levelNames.length;
    expect(ws.views[0]).toMatchObject({ state: "frozen", xSplit: nLevels, ySplit: 6 });
    expect(ws.properties.outlineProperties?.summaryBelow).toBe(false);
  });

  it("入れ子：親の名前は子の行まで縦に結合し、子の行はアウトラインの段が深い。1 段目ごとに小計の行（印のある行の数）", async () => {
    const wb = await read(await planWorkbook({ plan, version: 1, at: "2026-11-03T10:00:00.000Z", catalog, emptyCatalog: empty }));
    const ws = wb.getWorksheet(EXPORT_TEXT.sheetLedger)!;
    const merges = (ws.model as unknown as { merges: string[] }).merges;
    expect(merges.length).toBeGreaterThan(0);
    // 縦の結合だけ（列は 1 つ）
    for (const m of merges) {
      const [a, b] = m.split(":");
      expect(a!.replace(/\d+/g, "")).toBe(b!.replace(/\d+/g, ""));
    }
    const levels = new Set<number>();
    ws.eachRow((row, n) => {
      if (n > 6) levels.add(row.outlineLevel ?? 0);
    });
    expect(levels.has(0)).toBe(true);
    expect([...levels].some((l) => l >= 1)).toBe(true);
    // 小計の行：書いた印の数と、小計の数の合計が同じ
    const model = buildChart(plan, catalog, EXPORT_TEXT.labels, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
    const nLevels = model.levelNames.length;
    let marks = 0;
    let subtotal = 0;
    let subtotalRows = 0;
    ws.eachRow((row, n) => {
      if (n <= 6) return;
      const first = String(row.getCell(1).value ?? "");
      for (let i = 0; i < model.periods.length; i++) {
        const v = row.getCell(nLevels + 1 + i).value;
        if (first.startsWith("小計（")) subtotal += Number(v ?? 0);
        else if (typeof v === "string" && /[○●◎]/.test(v)) marks++;
      }
      if (first.startsWith("小計（")) subtotalRows++;
    });
    expect(subtotalRows).toBe(model.rows.filter((r) => r.level === 1).length);
    expect(marks).toBeGreaterThan(50);
    expect(subtotal).toBe(marks);
  });

  it("共通の設備項目のシート：パックの名前の表が無ければ作れないと書く（黙って空にしない）", async () => {
    const wb = await read(await planWorkbook({ plan, version: 1, at: "2026-11-03T10:00:00.000Z", catalog: null, emptyCatalog: empty }));
    expect(String(wb.getWorksheet(EXPORT_TEXT.sheetCommon)!.getCell(2, 1).value)).toBe(EXPORT_TEXT.noCatalog);
  });

  it("確定すると、版ごとに exports/<版>-plan.xlsx を足す", async () => {
    const root = mkdtempSync(join(tmpdir(), "moyai-export-"));
    dirs.push(root);
    // AI の決定は、試験の台本が人の代わりに理由を書いて受ける
    const acceptances = pendingDecisions(plan, []).map((d) => ({ id: d.id, hash: d.hash, reason: "試験の台本が押した" }));
    const r = await commitPlan({ root, plan, reason: "書き出しの試験", acceptances, basedOn: null, signer: SIGNER, client: "t", catalogs: () => ({ catalog, empty }) });
    if (!r.ok) throw new Error(r.reason);
    expect(r.files.export).toBe(join(root, "plans", plan.planId, "exports", "000001-plan.xlsx"));
    const wb = await read(readFileSync(r.files.export!));
    expect(wb.worksheets).toHaveLength(2);
  });
});
