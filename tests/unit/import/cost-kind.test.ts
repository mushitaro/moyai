// 費用の列が予定・概算・見積・予算だけのとき（Architect の 45）：実績の費用にしない。計画（予算）としてだけ読むかを 1 回聞く（既定は計画としてだけ）
import { describe, expect, test } from "vitest";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const book = (header: string) =>
  xlsxOf((ws) => {
    rows(ws, 1, [
      ["機器", "作業内容", "周期\n(年)", header, "2024年度", "2025年度"],
      ["ポンプ", "分解整備", "3", 1200, "●", "○"],
      [],
      [null, "凡例　○：計画　●：実施済"],
    ]);
  });

describe("予定・見積の列だけの費用", () => {
  test("既定では計画の年度の値にだけ置き、実績の年度の値には置かない", async () => {
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes: await book("予定価格（千円・税込）") }]);
    const q = s.analyze().open.find((x) => x.text.includes("予定価格") && x.text.includes("実績の費用ではない"));
    expect(q?.defaultAnswer).toBe("plan");
    acceptDefaults(s);
    const p = s.compose().plan;
    expect(p).not.toBeNull();
    const by = new Map(p!.details.map((d) => [d.planOrActual, d.cost]));
    expect(by.get("plan")).toBe(1_200_000);
    expect(by.get("actual")).toBeNull();
  });

  test("「実績の費用としても読む」と答えれば両方に置き、「読まない」なら置かない", async () => {
    for (const [answer, want] of [["actual", 1_200_000], ["none", null]] as const) {
      const s = session();
      await s.add([{ name: "【架空】星取表.xlsx", bytes: await book("見積額（千円・税込）") }]);
      const q = s.analyze().open.find((x) => x.text.includes("実績の費用ではない"))!;
      s.settle([human(q.questionId, answer)]);
      acceptDefaults(s);
      const p = s.compose().plan!;
      expect(p.details.find((d) => d.planOrActual === "actual")?.cost ?? null, answer).toBe(want);
    }
  });

  test("支払・契約の列なら聞かない", async () => {
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes: await book("契約金額（千円・税込）") }]);
    expect(s.analyze().open.some((x) => x.text.includes("実績の費用ではない"))).toBe(false);
  });
});

describe("役目の決まらない列を費用にする（Architect の 46）", () => {
  const enc = new TextEncoder();
  const CSV = ["日付,機器,作業内容,工数(人日),工事代", "2022-05-10,押込送風機,分解整備,3,12345円", "2022-05-11,押込送風機,分解整備,2,"].join("\r\n");

  test("金額らしい列の質問は見本の字を伏せ、「費用」と答えれば費用に読む", async () => {
    const s = session();
    await s.add([{ name: "日報.csv", bytes: enc.encode(CSV) }]);
    const q = s.analyze().open.find((x) => x.kind === "columnRole" && x.text.includes("工事代"));
    expect(q, JSON.stringify(s.analyze().open.map((x) => x.text))).toBeDefined();
    expect(q!.text).toContain("（費用）");
    expect(q!.text.includes("12345")).toBe(false);
    expect(q!.options.some((o) => o.id === "cost")).toBe(true);
    s.settle([human(q!.questionId, "cost")]);
    // 費用の見本も伏せる
    expect(JSON.stringify(s.survey().samples).includes("12345")).toBe(false);
    for (let i = 0; i < 10; i++) {
      const open = s.analyze().open.filter((x) => !x.decision);
      if (!open.length) break;
      s.settle(open.map((x) => human(x.questionId, x.defaultAnswer ?? (x.options.some((o) => o.id === "1") ? "1" : x.options[0]?.id ?? ""))));
    }
    const p = s.compose().plan;
    expect(p?.details.find((d) => d.fiscalYear === 2022)?.cost).toBe(12345);
  });
});
