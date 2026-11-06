// 費用の列（運営者の決定 A 案、2026-11-06。Architect の注文 1〜3）：取り込みで作業明細の費用の欄に円の整数で読み、元のセルと元の字を残す。
// 見張りの値（ほかに出てこない値）を費用の列に入れ、計画には入るが、MCP のどのツールの結果にも、共有の束にも、その字が出ないことを 1 本で確かめる。
// 単位が見出しで決まらなければ推し量らず聞く（件数を添えて）
import { describe, expect, it } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { costHeaderTax, costHeaderUnit, parseCost } from "../../../src/import/text";
import { previewBundle } from "../../../src/share/seal";
import { acceptDefaults, rows, session, xlsxOf } from "../import/helpers";
import { asset, detail, makeMember, makeRing, plan, sendInput, work } from "../share/fixtures";

const SENTINEL = "987654";
const CTX = { conversation: "c-cost", rowsRemaining: 2000 };

async function book(header: string, value: string | number) {
  return xlsxOf((ws) => {
    rows(ws, 1, [
      ["機器", "作業内容", "周期\n(年)", header, "2024年度", "2025年度"],
      ["ポンプ", "分解整備", "3", value, "●", "○"],
      ["ブロワ", "定期点検", "1年", 300, "●", "●"],
      [],
      [null, "凡例　○：計画　●：実施済"],
    ]);
  });
}

describe("費用の字の読み方", () => {
  it("見出しの単位と税、セルの書き方", () => {
    expect(costHeaderUnit("概算費用\n(千円/回)")).toBe(1000);
    expect(costHeaderUnit("契約金額（円）")).toBe(1);
    expect(costHeaderUnit("修繕費")).toBeNull();
    expect(costHeaderTax("契約金額（税込）")).toBe("incl");
    expect(costHeaderTax("費用(税抜)")).toBe("excl");
    expect(costHeaderTax("費用")).toBeNull();
    expect(parseCost("1,200", 1200, 1000)).toBe(1_200_000);
    expect(parseCost("¥1,200", null, 1)).toBe(1200);
    expect(parseCost("1200千円", null, null)).toBe(1_200_000);
    expect(parseCost("1200", null, null)).toBeNull();
    expect(parseCost("未定", null, 1000)).toBeNull();
  });
});

describe("費用の列：計画に入り、AI と共有には出ない（見張りの値）", () => {
  it("作業明細の費用は円の整数で、元のセルと元の字と税の扱いを残す。要約・質問・星取表の行・束のどこにも見張りの値の字が出ない", async () => {
    try {
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】費用の試験", fiscalYearStartMonth: 4, fictional: true });
      const bytes = await book("概算費用\n(千円/回)", Number(SENTINEL));
      await ws.addFiles([{ name: "【架空】星取表.xlsx", size: bytes.length, bytes: async () => bytes }]);
      const seen: string[] = [];
      const call = (name: Parameters<typeof runTabTool>[1], args: Record<string, unknown>) => {
        const r = runTabTool(ws, name, args, CTX);
        seen.push(JSON.stringify(r));
        return r;
      };
      // 質問に既定の答えで答える（税の扱いは「資料に書いていない」が既定）
      for (let i = 0; i < 10; i++) {
        const s = call("intake_survey", {});
        const qs = s.ok ? ((s.data as { questions: { questionId: string; defaultAnswer: string | null }[] }).questions ?? []) : [];
        if (!qs.length) break;
        expect(qs.every((q) => q.defaultAnswer !== null)).toBe(true);
        call("intake_settle", { decisions: qs.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "試験の台本" })) });
      }
      call("intake_compose", {});
      await ws.whenComposed();
      call("intake_survey", { part: "compose" });
      call("chart_rows", { view: "adjusted", offset: 0, limit: 200 });
      const p = getWorkingPlan()!.plan;
      const pump = p.details.find((d) => d.cost === Number(SENTINEL) * 1000);
      expect(pump).toBeDefined();
      expect(pump!.costSource).toMatchObject({ file: "【架空】星取表.xlsx", text: SENTINEL, tax: "unknown" });
      // AI に渡ったどの結果にも、見張りの値の字が無い（見本の費用のセルは「（費用）」に伏せる）
      for (const t of seen) expect(t.includes(SENTINEL), t.slice(0, 200)).toBe(false);
      expect(seen.some((t) => t.includes("（費用）"))).toBe(true);
    } finally {
      clearWorkingPlan();
    }
  });

  it("共有の束にも、費用の値は出ない（写し取りの許可の一覧に費用は無い）", () => {
    const ring = makeRing();
    const m = makeMember(ring);
    const p = plan({
      assets: [asset("a1", "T.FEED.LIFT")],
      works: [work("w1", "OVERHAUL", ["a1"])],
      details: [detail("d1", "w1", 2019, { cost: Number(SENTINEL) * 1000 }), detail("d2", "w1", 2022, { cost: Number(SENTINEL) })],
    });
    const pv = previewBundle(sendInput(ring, m, p));
    if (!pv.ok) throw new Error("束が作れない");
    expect(JSON.stringify(pv.body).includes(SENTINEL)).toBe(false);
  });

  it("単位が見出しで決まらなければ、推し量らず件数を添えて聞く（既定の答えは無い）", async () => {
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes: await book("修繕費", 1200) }]);
    const q = s.analyze().open.find((x) => x.text.includes("修繕費") && x.text.includes("単位"));
    expect(q).toBeDefined();
    expect(q!.defaultAnswer).toBeNull();
    expect(q!.text).toContain("2 行");
    expect(q!.text.includes("1200")).toBe(false);
    acceptDefaults(s);
    expect(s.compose().plan).toBeNull();
  });
});

describe("見出しの言い方を変えても伏せる（Architect の注文）", () => {
  for (const header of ["契約金額（円）", "工事費(千円)", "修繕費（千円/回）", "契約額(千円)", "請負額(円)", "概算額(千円)"]) {
    it(header, async () => {
      const s = session();
      await s.add([{ name: "【架空】星取表.xlsx", bytes: await book(header, Number(SENTINEL)) }]);
      s.analyze();
      const t = JSON.stringify({ survey: s.survey(), open: s.analyze().open.map((q) => q.text) });
      expect(t.includes(SENTINEL)).toBe(false);
    });
  }
  it("見分けられない言い方（「見込額」）は費用の列にならない（docs/security.md の保証できないことの 11）", async () => {
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes: await book("見込額(千円)", Number(SENTINEL)) }]);
    const t = s.analyze().layouts[0]?.tables[0];
    expect(t?.cols.find((c) => c.header.startsWith("見込額"))?.role).not.toBe("cost");
  });
});
