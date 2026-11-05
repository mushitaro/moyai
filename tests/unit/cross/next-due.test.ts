// 層をまたぐ試験 cross-layer（docs/plan.md §5.1「取り込んだ実績で、きっかけの次回が動く」。台帳の重-8b）：
// 取り込み（星取表の「周期(年)」の列 → 作業の暦のきっかけ、● → 実績）→ 計画 → 星取表の行の次回の字 → Excel の次回の列。
// 実績の年度が 1 年ずれた資料では、次回も 1 年ずれる
import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildChart, catalogFromPack } from "../../../src/plan/chart";
import { planDueViews, rowDue } from "../../../src/plan/due-view";
import { EXPORT_TEXT, planWorkbook } from "../../../src/plan/export";
import type { Plan } from "../../../src/shared/plan";
import { acceptDefaults, rows, session, xlsxOf } from "../import/helpers";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const workKinds = json("packs/_kinds/work.json");
const empty = catalogFromPack({ systems: [] }, workKinds);
const labels = { levelFallback: (n: number) => `第 ${n} 階層`, commonLevels: ["a", "b", "c"] as [string, string, string], unmapped: "未", series: (s: string) => s };

async function imported(pumpDone: "2024" | "2025"): Promise<Plan> {
  const bytes = await xlsxOf((ws) => {
    rows(ws, 1, [
      ["機器", "作業内容", "周期\n(年)", "2024年度", "2025年度", "2026年度"],
      ["ポンプ", "分解整備", "3", pumpDone === "2024" ? "●" : null, pumpDone === "2025" ? "●" : null, null],
      ["ブロワ", "定期点検", "1年", "●", "●", "○"],
      [],
      [null, "凡例　○：計画　●：実施済"],
    ]);
  });
  const s = session();
  await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
  s.analyze();
  acceptDefaults(s);
  const c = s.compose();
  if (!c.plan) throw new Error("計画ができない");
  return c.plan;
}

function nextOf(plan: Plan, today: string): Map<string, string> {
  const due = planDueViews(plan, today);
  const m = buildChart(plan, empty, labels, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
  const out = new Map<string, string>();
  for (const r of m.rows) {
    const v = r.kind === "node" ? rowDue(r.works, due) : null;
    if (v) out.set(r.path.filter(Boolean).join("›"), v.text);
  }
  return out;
}

describe("取り込んだ実績で、きっかけの次回が動く", () => {
  it("年度だけの ● は年度単位の起点。ずれた実績の資料では次回もずれる。周期が無い行は「―」にならず、作業のきっかけどおり", async () => {
    const a = nextOf(await imported("2024"), "2026-11-06");
    const b = nextOf(await imported("2025"), "2026-11-06");
    const key = (m: Map<string, string>, name: string) => [...m.entries()].find(([k]) => k.includes(name))?.[1];
    expect(key(a, "ポンプ")).toBe("2027 年度");
    expect(key(b, "ポンプ")).toBe("2028 年度");
    // ブロワは 1 年ごと、最後の ● は 2025 年度（○ の計画は起点にしない）
    expect(key(a, "ブロワ")).toBe("2026 年度");
  });

  it("Excel の次回の列にも同じ字が出る", async () => {
    const plan = await imported("2025");
    const buf = await planWorkbook({ plan, version: 1, at: "2026-11-06T00:00:00.000Z", catalog: null, emptyCatalog: empty });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.getWorksheet(EXPORT_TEXT.sheetLedger)!;
    const head = Array.from((ws.getRow(6).values as unknown[]).slice(1), (x) => String(x ?? ""));
    const at = head.indexOf("次回");
    const found: string[] = [];
    ws.eachRow((r, n) => {
      if (n <= 6) return;
      const v = Array.from((r.values as unknown[]).slice(1), (x) => String(x ?? ""));
      // 小計の行（「小計（ポンプ）」）は次回の列を持たない
      if (v.some((x) => x.includes("ポンプ")) && !v[0]!.startsWith("小計")) found.push(v[at]!, v[at + 2]!);
    });
    expect(found).toEqual(["2028 年度", "暦"]);
  });
});
