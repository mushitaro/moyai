// exceljs が書いた xlsx の sheetPr の子を、表計算の決まりの順（tabColor → outlinePr → pageSetUpPr）に直す。
// 逆の順のままだと、Excel はシートを空で開く（exceljs で読み直しても気づかない）。書き出しと差分レポートの両方を確かめる。
import { SIGNER } from "../helpers/signer";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { catalogFromPack } from "../../src/plan/chart";
import { pendingDecisions } from "../../src/plan/diff";
import { commitPlan } from "../../src/plan/store";
import { orderSheetPr } from "../../src/plan/xlsx-fix";
import { Plan } from "../../src/shared/plan";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";

const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const work = json("packs/_kinds/work.json");
const catalog = catalogFromPack(json("packs/waste-incineration/common.json"), work);
const empty = catalogFromPack({ systems: [] }, work);

const ORDER = ["tabColor", "outlinePr", "pageSetUpPr"];
async function sheetPrOrders(buf: Buffer): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buf);
  const out: string[][] = [];
  for (const n of Object.keys(zip.files).filter((x) => /^xl\/worksheets\/sheet\d+\.xml$/.test(x))) {
    const inner = /<sheetPr[^>]*>([\s\S]*?)<\/sheetPr>/.exec(await zip.file(n)!.async("string"))?.[1] ?? "";
    out.push([...inner.matchAll(/<(\w+)/g)].map((m) => m[1]!));
  }
  return out;
}

describe("xlsx の sheetPr の順", () => {
  it("逆の順を決まりの順に直し、ほかは変えない。知らない子があれば触らない", () => {
    const bad = '<a/><sheetPr filterMode="0"><pageSetUpPr fitToPage="1"/><outlinePr summaryBelow="0"/></sheetPr><b/>';
    expect(orderSheetPr(bad)).toBe('<a/><sheetPr filterMode="0"><outlinePr summaryBelow="0"/><pageSetUpPr fitToPage="1"/></sheetPr><b/>');
    const unknown = "<sheetPr><pageSetUpPr/><x/><outlinePr/></sheetPr>";
    expect(orderSheetPr(unknown)).toBe(unknown);
    expect(orderSheetPr("<worksheet/>")).toBe("<worksheet/>");
  });

  it("確定で書く 2 つ（人が見る様式・差分レポート）の、どのシートも決まりの順", async () => {
    const plan = Plan.parse(truthToPlan("fictional-1"));
    const root = mkdtempSync(join(tmpdir(), "moyai-xlsx-fix-"));
    try {
      const acceptances = pendingDecisions(plan, []).map((d) => ({ id: d.id, hash: d.hash, reason: "試験の台本が押した" }));
      const r = await commitPlan({ root, plan, reason: "順の試験", acceptances, basedOn: null, signer: SIGNER, client: "t", catalogs: () => ({ catalog, empty }) });
      if (!r.ok) throw new Error(r.reason);
      for (const f of [r.files.export!, join(root, "plans", plan.planId, "reports", "000001-diff.xlsx")]) {
        const orders = await sheetPrOrders(readFileSync(f));
        expect(orders.length, f).toBeGreaterThan(0);
        for (const kids of orders) expect(kids, f).toEqual([...kids].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)));
      }
      // 星取表のシートは、印刷の合わせ方とアウトラインの両方を持つ（逆の順で Excel が空で開いた組み合わせ）
      expect((await sheetPrOrders(readFileSync(r.files.export!)))[0]).toEqual(["outlinePr", "pageSetUpPr"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
