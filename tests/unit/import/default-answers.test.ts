// 既定の答えの無い問いを減らす（11-07 の想定のプロンプトの試験「このフォルダの資料を入れて」）：
// 資料から確かに決まるものだけを既定の答えにし、決まらない同じ形の問いは 1 つにまとめ、intake_survey では既定の答えの無い問いを先に並べる。
// 資料は形の説明から組んだ架空のもの。
import type ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { cue } from "../../../src/import/cues";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const LEGEND = "凡例　○：計画　●：実施　◎：計画どおり実施";

/** 星取表の形：題・凡例・見出し（設備・機器名称｜作業｜周期｜費用｜年度…）・機器の行 */
function hoshitori(ws: ExcelJS.Worksheet, opts: { cycleHeader?: string; body: (string | number | null)[][]; years?: string[] }) {
  const years = opts.years ?? ["2024年度", "2025年度", "2026年度"];
  rows(ws, 1, [["【架空】星取表"], [LEGEND], [], ["設備・機器名称", "点検・整備内容", opts.cycleHeader ?? "周期(年)", "概算費用(千円)", ...years]]);
  rows(ws, 5, opts.body);
}

describe("凡例の文が計画と実績の語を両方含む記号（「◎：計画どおり実施」）", () => {
  test("文の終わりの語（述語）を読む：計画どおり実施 → 実績、実施予定 → 計画、どちらでもなければ決めない", () => {
    expect(cue.planActualHead("計画どおり実施")).toBe("actual");
    expect(cue.planActualHead("実施予定")).toBe("plan");
    expect(cue.planActualHead("計画どおり実施。")).toBe("actual");
    expect(cue.planActualHead("一部実施")).toBe("actual");
    expect(cue.planActualHead("延期")).toBeNull();
  });

  test("既定の答えは「実績の星取」。選択肢は計画の星取・実績の星取・星取ではない（外す）。2 枚のシートの同じ記号は 1 問", async () => {
    const bytes = await xlsxOf((ws, wb) => {
      hoshitori(ws, { body: [["【架空】ポンプ", "分解整備", 3, 1200, "◎", "○", null]] });
      const ws2 = wb.addWorksheet("電気");
      rows(ws2, 1, [["【架空】星取表（電気）"], [LEGEND], [], ["機器・装置名", "点検・整備内容", "周期(年)", "費用（千円）", "2024年度", "2025年度", "2026年度"]]);
      rows(ws2, 5, [["【架空】受電盤", "年次点検", 1, 2800, "◎", "◎", "○"]]);
    }, "機械");
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
    const qs = s.analyze().open.filter((q) => q.kind === "planActualConflict");
    expect(qs.map((q) => q.text)).toHaveLength(1);
    const q = qs[0]!;
    expect(q.defaultAnswer).toBe("actual");
    expect(q.options.map((o) => o.label)).toEqual(["計画の星取", "実績の星取", "星取ではない（外す）"]);
    expect(q.sameShapeRows).toBe(3);
    s.settle([human(q.questionId, "actual")]);
    acceptDefaults(s);
    const p = s.compose().plan;
    expect(p, s.compose().blockers.join("・")).not.toBeNull();
    expect(p!.details.filter((d) => d.planOrActual === "actual")).toHaveLength(3);
  });
});

describe("周期の欄の読めない書き方", () => {
  test("どれも「—」なら、既定の答えは「周期を置かない」", async () => {
    const bytes = await xlsxOf((ws) =>
      hoshitori(ws, {
        body: [
          ["【架空】ポンプ", "分解整備", 3, 1200, "●", "○", null],
          ["【架空】送風機", "補修（事後）", "—", null, "●", null, null],
        ],
      }),
    );
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "cycleText");
    expect(q?.defaultAnswer).toBe("none");
  });

  test("見出しに単位の無い「周期」の数だけの書き方は、既定の答えにしない。年として読む・月として読むを選べ、年と答えれば年で読む", async () => {
    const bytes = await xlsxOf((ws) =>
      hoshitori(ws, {
        cycleHeader: "周期",
        body: [
          ["【架空】ポンプ", "分解整備", 3, 1200, "●", "○", null],
          ["【架空】盤", "精密点検", 6, 6500, null, "○", null],
        ],
      }),
    );
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "cycleText")!;
    expect(q.defaultAnswer).toBeNull();
    expect(q.text).toContain("見出しに年か月かが書いていない");
    expect(q.options.map((o) => o.id)).toEqual(["years", "months", "none"]);
    s.settle([human(q.questionId, "years")]);
    acceptDefaults(s);
    expect(s.analyze().open.some((x) => x.kind === "cycleText")).toBe(false);
    const p = s.compose().plan;
    expect(p, s.compose().blockers.join("・")).not.toBeNull();
    expect(p!.works.map((w) => JSON.stringify(w.trigger)).join(" ")).toMatch(/6/);
  });
});

describe("号の列の、号として読めない書き方", () => {
  const book = (third: string) =>
    xlsxOf((ws) => {
      rows(ws, 1, [["【架空】機器台帳"], [LEGEND], [], ["設備", "機器", "号炉", "作業", "2024年度", "2025年度"]]);
      rows(ws, 5, [
        ["【架空】燃焼設備", "【架空】給じん装置", "1号炉", "点検", "●", "○"],
        ["【架空】燃焼設備", "【架空】給じん装置", "2号炉", "点検", "●", "○"],
        ["【架空】燃焼設備", "【架空】火格子", third, "点検", "○", "●"],
      ]);
    });

  test("数の書いていないセル（「炉全体」。頭の節の番号は除く）だけなら、既定の答えは「号なしとして読む」", async () => {
    for (const third of ["炉全体", "0.炉全体・施設全体"]) {
      const s = session();
      await s.add([{ name: "【架空】台帳.xlsx", bytes: await book(third) }]);
      const q = s.analyze().open.find((x) => x.kind === "unitMissing");
      expect(q?.defaultAnswer, third).toBe("none");
    }
  });

  test("数の書いてあるセル（「1号減温塔」）があれば、既定の答えにしない（号を黙って落とさない）", async () => {
    const s = session();
    await s.add([{ name: "【架空】台帳.xlsx", bytes: await book("1号減温塔") }]);
    const q = s.analyze().open.find((x) => x.kind === "unitMissing");
    expect(q?.defaultAnswer).toBeNull();
  });
});

describe("年度の欄の合計の行", () => {
  test("末尾に単位の括弧を添えた「計（千円）」も合計の行。年度の欄の金額は記号として聞かず、検算せずに外す", async () => {
    const bytes = await xlsxOf((ws) =>
      hoshitori(ws, {
        body: [
          ["【架空】ポンプ", "分解整備", 3, 1200, "●", "○", null],
          ["【架空】送風機", "整備", 2, 700, null, "○", "○"],
          ["年度別概算費用　計（千円）", null, null, null, 1200, 1900, 700],
        ],
      }),
    );
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
    const an = s.analyze();
    expect(an.open.filter((q) => q.kind === "unknownSymbol").map((q) => q.text)).toEqual([]);
    expect(an.open.filter((q) => q.kind === "subtotalMismatch").map((q) => q.text)).toEqual([]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.plan, c.blockers.join("・")).not.toBeNull();
    expect(c.plan!.details).toHaveLength(4);
  });
});

describe("同じ形の問いを 1 つに", () => {
  test("同じ表の合わない小計の行は 1 問。答えると全部の行に当たり、取り消すと全部戻る", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設備", "機器", "2024年度"]]);
      rows(ws, 2, [
        ["甲設備", "機器A", "●"],
        ["小計", null, 3],
        ["乙設備", "機器B", "●"],
        ["小計", null, 2],
      ]);
      rows(ws, 7, [["凡例"], [null, "●", "実績"]]);
    });
    const s = session();
    await s.add([{ name: "表.xlsx", bytes }]);
    acceptDefaults(s);
    const qs = s.analyze().open.filter((x) => x.kind === "subtotalMismatch");
    expect(qs).toHaveLength(1);
    expect(qs[0]!.sameShapeRows).toBe(2);
    expect(qs[0]!.text).toContain("（2 行）");
    s.settle([human(qs[0]!.questionId, "exclude")]);
    expect(s.compose().plan).not.toBeNull();
    s.undo(qs[0]!.questionId);
    expect(s.analyze().open.filter((x) => x.kind === "subtotalMismatch")).toHaveLength(1);
    expect(s.compose().plan).toBeNull();
  });

  test("昼休みの問いは、様式の違う日報をまたいで 1 問", async () => {
    const daily = (title: string, headers: string[], body: (string | number | null)[][]) =>
      xlsxOf((ws) => {
        rows(ws, 1, [[title], ["日付", "2026/04/06"], []]);
        rows(ws, 4, [headers]);
        rows(ws, 5, body);
      }, "4月6日");
    const a = await daily("【架空】作業日報", ["No.", "号炉", "作業場所", "作業内容", "業者名", "作業人員", "作業時間"], [
      [1, "1号炉", "炉室", "【架空】機器1 点検", "【架空】甲社", "機械工2", "8:30～17:00"],
      [2, "2号炉", "炉室", "【架空】機器2 点検", "【架空】甲社", "機械工1", "9:00～12:00"],
    ]);
    const b = await daily("【架空】作業日報（新）", ["No.", "号炉", "設備・機器", "作業内容", "施工業者", "人数", "作業時間", "備考"], [
      [1, "1号炉", "【架空】機器3", "点検", "【架空】乙社", 2, "8:00～17:00", null],
      [2, "2号炉", "【架空】機器4", "補修", "【架空】乙社", 1, "13:00～17:00", null],
    ]);
    const s = session();
    await s.add([
      { name: "【架空】日報_R3.xlsx", bytes: a },
      { name: "【架空】日報_R5.xlsx", bytes: b },
    ]);
    const lunch = s.analyze().open.filter((q) => q.kind === "effortUnknown" && q.options.some((o) => o.id === "noon"));
    expect(lunch.map((q) => q.text)).toHaveLength(1);
    expect(lunch[0]!.defaultAnswer).toBeNull();
    expect(lunch[0]!.sameShapeRows).toBe(4);
    s.settle([human(lunch[0]!.questionId, "no")]);
    expect(s.analyze().open.some((q) => q.kind === "effortUnknown" && q.options.some((o) => o.id === "noon"))).toBe(false);
  });
});

describe("intake_survey の質問の並び", () => {
  test("既定の答えの無い質問を先に並べる（同じ組の中は出てきた順）", async () => {
    const bytes = await xlsxOf((ws) =>
      hoshitori(ws, {
        cycleHeader: "周期",
        body: [
          ["【架空】ポンプ", "分解整備", 3, 1200, "◎", "○", null],
          ["【架空】盤", "精密点検", 6, 6500, null, "△", null],
        ],
      }),
    );
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
    const qs = s.survey().questions;
    const firstWithDefault = qs.findIndex((q) => q.defaultAnswer !== null);
    const lastWithout = qs.map((q) => q.defaultAnswer === null).lastIndexOf(true);
    expect(qs.some((q) => q.defaultAnswer === null)).toBe(true);
    expect(qs.some((q) => q.defaultAnswer !== null)).toBe(true);
    expect(lastWithout).toBeLessThan(firstWithDefault);
  });
});

describe("資料ごとの表の形の覚え（読み取りの速さ）", () => {
  const summary = (s: ReturnType<typeof session>) => {
    const an = s.analyze();
    const st = [...an.composition.status.values()];
    return { open: an.open.map((q) => q.questionId).sort(), unresolved: st.filter((x) => x.s === "unresolved").length, data: st.filter((x) => x.s === "data").length };
  };

  test("決定で書き換わる欄（列の役目・階層）は、覚えた形を使っても、新しく読んだときと同じになる。取り消すと戻る", async () => {
    // 見出しが手がかりの語でない列（内容・間隔・資材・状況・金）を持つ、架空の作業の一覧（Excel。覚えるのは Excel と PDF の資料）
    const bytes = await xlsxOf((ws) =>
      rows(ws, 1, [
        ["日付", "機器", "内容", "間隔", "資材", "状況", "金"],
        ["2024/5/10", "送水ポンプ", "分解整備", "年4回", "ボルト10本", "実績", "12345円"],
        ["2025/6/11", "送水ポンプ", "分解整備", "年4回", "ボルト8本", "予定", "9876円"],
        ["2024/7/12", "配水ポンプ", "点検", "年2回", "－", "－", "3210円"],
      ]),
    );
    const s = session();
    await s.add([{ name: "【架空】星取表.xlsx", bytes }]);
    const before = summary(s);
    const q = s.analyze().open.find((x) => x.kind === "columnRole");
    expect(q, JSON.stringify(s.analyze().open.map((x) => x.text))).toBeDefined();
    const other = q!.options.find((o) => o.id !== q!.defaultAnswer && o.id !== "exclude")!.id;
    s.settle([human(q!.questionId, other)]);
    const fresh = session();
    await fresh.add([{ name: "【架空】星取表.xlsx", bytes }]);
    fresh.settle([human(q!.questionId, other)]);
    expect(summary(s)).toEqual(summary(fresh));
    s.undo(q!.questionId);
    expect(summary(s)).toEqual(before);
  });
});
