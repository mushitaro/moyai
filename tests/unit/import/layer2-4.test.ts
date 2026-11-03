// 層 2〜4 の性質の試験：段の票が割れたら疑い、空欄の「上と同じ」、行の役割を黙って変えない、
// 備考の文の中の数を値にしない、日付に見えない書き方を日付と決めつけない、検算、止める決まり、取り消し、AI に渡す形。
import { describe, expect, test } from "vitest";
import { TOOLS } from "../../../src/shared/tools";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

describe("層 2 構造", () => {
  test("字下げと番号で段の票が割れた行は疑いにし、質問にする。決めたら効き、取り消せる", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["名称", "番号", "仕様"]]);
      rows(ws, 2, [
        ["甲設備", "1", null],
        ["機器A", "1-1", "仕様の文"],
        ["部品a", "1-1-1", null],
        ["機器B", "1-2", null],
      ]);
      ws.getCell("A3").alignment = { indent: 1 };
      ws.getCell("A4").alignment = { indent: 1 }; // 番号は 3 段目、字下げは 2 段目
      ws.getCell("A5").alignment = { indent: 1 };
    });
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "levelSplit");
    expect(q?.defaultAnswer).toBe("level:3");
    expect(q?.text).toContain("字下げ");
    expect(s.compose().plan).toBeNull();
    s.settle([human(q?.questionId ?? "", "level:3")]);
    acceptDefaults(s);
    const plan = s.compose().plan;
    expect(plan).not.toBeNull();
    const a = plan?.assets.find((x) => x.name === "部品a");
    expect(a?.level).toBe(3);
    expect(plan?.assets.find((x) => x.nodeKey === a?.parentKey)?.name).toBe("機器A");
    // 取り消すと、また未解決に戻る
    const back = s.undo(q?.questionId ?? "");
    expect(back.unresolved).toBeGreaterThan(0);
    expect(s.compose().plan).toBeNull();
  });

  test("星取表の形：段の列の空欄（結合でない）は「上と同じ」か聞き、1 段の見出しの年は凡例で予定と実績を決める", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["【架空】試験の星取表"]]);
      rows(ws, 3, [["設備", "機器", "号機", "令和6年度", "R7年度", "2026年度"]]);
      rows(ws, 4, [
        ["甲設備", "機器A", "1号機", "●", "○", null],
        [null, "機器B", "2号機", "●", null, "○"],
        ["乙設備", "機器C", "共通", null, "●", null],
      ]);
      rows(ws, 8, [["凡例：○予定　●実績"]]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.shape).toBe("grid");
    expect(t?.cols.filter((c) => c.role === "mark").map((c) => c.fiscalYear)).toEqual([2024, 2025, 2026]);
    expect(t?.legend.map((e) => `${e.symbol}${e.planOrActual}`)).toEqual(["○plan", "●actual"]);
    const blank = an.open.find((q) => q.kind === "blankSameAsAbove");
    expect(blank?.defaultAnswer).toBe("same");
    expect(an.open.some((q) => q.kind === "commonMeaning")).toBe(true);
    acceptDefaults(s);
    const plan = s.compose().plan;
    expect(plan).not.toBeNull();
    const b = plan?.assets.find((x) => x.name === "機器B");
    expect(plan?.assets.find((x) => x.nodeKey === b?.parentKey)?.name).toBe("甲設備");
    expect(b?.series).toBe("2");
    const d = plan?.details.find((x) => x.sources.some((src) => src.cell === "F5"));
    expect(d).toMatchObject({ planOrActual: "plan", fiscalYear: 2026 });
    expect(plan?.levelNames).toEqual(["設備", "機器"]);
  });

  test("上に置いた合計は合計のまま（データにも小計にもしない）、※ の行は注記のまま", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設備", "機器", "2024年度", "2025年度"]]);
      rows(ws, 2, [
        ["合計", null, 2, 1],
        ["甲設備", "機器A", "●", "●"],
        ["乙設備", "機器B", "●", null],
        ["※ 印は実施した年度", null, null, null],
      ]);
      rows(ws, 7, [["凡例"], [null, "●", "実績"]]);
    });
    const s = session();
    await s.add([{ name: "表.xlsx", bytes }]);
    const t = s.analyze().layouts[0]?.tables[0];
    expect(t?.rows.find((r) => r.r === 2)?.role).toBe("total");
    expect(t?.rows.find((r) => r.r === 5)?.role).toBe("note");
    acceptDefaults(s);
    const c = s.compose();
    expect(c.plan).not.toBeNull();
    expect(c.checks[0]).toMatchObject({ kind: "total", columns: 2, matched: 2 });
    const reasons = [...c.status.values()].filter((x) => x.s === "excluded").map((x) => (x.s === "excluded" ? x.reason : ""));
    expect(reasons).toContain("合計（検算して合った）");
    expect(c.plan?.details.length).toBe(3);
  });

  test("合わない小計は質問にし、答えるまで計画を作らない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設備", "機器", "2024年度"]]);
      rows(ws, 2, [
        ["甲設備", "機器A", "●"],
        ["乙設備", "機器B", "●"],
        ["小計", null, 3],
      ]);
      rows(ws, 6, [["凡例"], [null, "●", "実績"]]);
    });
    const s = session();
    await s.add([{ name: "表.xlsx", bytes }]);
    acceptDefaults(s);
    const q = s.analyze().open.find((x) => x.kind === "subtotalMismatch");
    expect(q).toBeDefined();
    expect(s.compose().plan).toBeNull();
    s.settle([human(q?.questionId ?? "", "exclude")]);
    const c = s.compose();
    expect(c.plan).not.toBeNull();
    expect(c.checks[0]?.mismatches[0]).toMatchObject({ written: 3, counted: 2 });
  });
});

describe("層 3 意味づけ：推測で埋めない", () => {
  test("備考の文の中の数を値にしない（「次回は 3 年後」の 3 を周期にしない）。年度末の書き方は年にしない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["名称", "設置年", "備考"]]);
      rows(ws, 2, [
        ["機器A", 2002, "次回は 3 年後"],
        ["機器B", "昭和63年度末", null],
      ]);
    });
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "yearUnknown");
    expect(q?.text).toContain("昭和63年度末");
    acceptDefaults(s);
    const plan = s.compose().plan;
    const a = plan?.assets.find((x) => x.name === "機器A");
    expect(a?.installedOn).toBe("2002");
    expect(a?.specs).toContainEqual({ key: "備考", value: "次回は 3 年後" });
    expect(plan?.works).toEqual([]);
    const b = plan?.assets.find((x) => x.name === "機器B");
    expect(b?.installedOn).toBeNull();
    expect(b?.specs).toContainEqual({ key: "設置年", value: "昭和63年度末" });
  });

  test("凡例に無い記号は質問にし、外すと決めたら理由つきで外す", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設備", "機器", "2024年度"]]);
      rows(ws, 2, [
        ["甲設備", "機器A", "●"],
        ["乙設備", "機器B", "▲"],
      ]);
      rows(ws, 5, [["凡例"], [null, "●", "実績"]]);
    });
    const s = session();
    await s.add([{ name: "表.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "unknownSymbol");
    expect(q?.text).toContain("▲");
    expect(q?.defaultAnswer).toBeNull(); // 列の見出しに予定・実績が無いので、既定の答えも無い
    s.settle([human(q?.questionId ?? "", "exclude")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.plan?.details.length).toBe(1);
    expect([...c.status.values()].some((x) => x.s === "excluded" && x.reason.includes("印ではない記号"))).toBe(true);
  });

  test("当てはまらない決定は計画を止める", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["名称", "設置年"]]);
      rows(ws, 2, [["機器A", "昭和63年度末"]]);
    });
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "yearUnknown");
    s.settle([human(q?.questionId ?? "", "たぶん1988")]);
    const c = s.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("")).toContain("当てはまらない決定");
  });

  test("隠した列に中身があれば、取り込むか聞く", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設備", "機器", "2023年度", "2024年度"]]);
      rows(ws, 2, [["甲設備", "機器A", "●", "●"]]);
      rows(ws, 4, [["凡例"], [null, "●", "実績"]]);
      ws.getColumn(3).hidden = true;
    });
    const s = session();
    await s.add([{ name: "表.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "hiddenData");
    expect(q?.defaultAnswer).toBe("include");
    s.settle([human(q?.questionId ?? "", "exclude")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.plan?.details.map((d) => d.fiscalYear)).toEqual([2024]);
  });
});

describe("AI に渡す要約と、決定の数", () => {
  test("要約は intake_survey の型を通り、見本は 20 行まで。決定は効いたセルの数を返す", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["名称", "設置年"]]);
      for (let i = 0; i < 30; i++) rows(ws, 2 + i, [[`機器${i}`, i === 0 ? "昭和63年度末" : 2000 + i]]);
    });
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const sv = s.survey();
    expect(TOOLS.intake_survey.output.safeParse(sv).success).toBe(true);
    expect(sv.samples.length).toBeLessThanOrEqual(20);
    expect(sv.questions.length).toBe(1);
    const r = s.settle([human(sv.questions[0]?.questionId ?? "", "spec")]);
    expect(TOOLS.intake_settle.output.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ cellsAffected: 1, rowsAffected: 1, unresolved: 0 });
  });
});
