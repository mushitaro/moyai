// PDF の表の、何行にも折り返した 1 つの記録を 1 つに読む（reader-pdf-blocks-v1）。
// 資料は試験の中で組む架空の PDF（工事報告書と整備総括の 2 つの形。pdf-block-fixtures.ts）。字は列の途中で切れ、見出しの字も切れる。
import { describe, expect, test } from "vitest";
import { readSource } from "../../../src/import";
import { ATTRS_REASON, PAGE_REASON, PARAGRAPH_REASON, REPEAT_HEADER_REASON, SECTION_REASON, monthDayRange, parseBlockName, parseEffortLine } from "../../../src/import/blocks";
import { cellKey } from "../../../src/import/records";
import { layoutFile } from "../../../src/import/structure";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";
import { REPORT_RECORDS, reportPdf, summaryPdf } from "./pdf-block-fixtures";

async function layouts(name: string, bytes: Uint8Array) {
  const r = await readSource({ name, bytes });
  if (!r.source) throw new Error(r.rejected?.reason ?? "読めない");
  return { source: r.source, lays: layoutFile(r.source) };
}

async function analyzed(files: { name: string; bytes: Uint8Array }[]) {
  const s = session();
  await s.add(files);
  return { s, an: s.analyze() };
}

/** 行の字（セルの字を位置の順に空白でつないだもの） */
const rowTextOf = (lay: Awaited<ReturnType<typeof layouts>>["lays"][number], r: number) =>
  lay.grid.cells
    .filter((c) => c.r === r)
    .map((c) => c.text)
    .join(" ");

describe("PDF の表の、何行にも折り返した記録", () => {
  test("記録の塊が 1 つになり、名前の欄の折り返しがつながる（頁をまたいでも、見出しをくり返しても 1 つの表）", async () => {
    const { lays } = await layouts("report.pdf", reportPdf());
    const tables = lays[0]?.tables ?? [];
    expect(tables).toHaveLength(1);
    const bt = tables[0]?.blocks;
    expect(bt?.records.map((b) => b.name.map((l) => l.text))).toEqual(REPORT_RECORDS.flat().map((r) => r.name));
    // 1 つ目の記録は、名前の欄の 3 行と、名前の欄の空いた行（期間・注記・施工量…）をまとめた塊
    const first = bt?.records[0];
    expect(first?.rows.length).toBe(8);
    expect(bt?.strays).toEqual([]);
    expect(parseBlockName(first?.name.map((l) => l.text) ?? [])).toEqual({ unit: { kind: "number", n: 1, spelling: "{n}号炉" }, path: ["焼却炉本体", "炉壁局部損耗域(24 m2)"], unitLevel: 0 });
    // 名前の欄の折り返し（「炉下落じんコン」＋「ベヤ／1号炉 炉下落じ」＋「んコンベヤ」）：設備と部位が同じ名前なら 1 つの段
    expect(parseBlockName(bt?.records[1]?.name.map((l) => l.text) ?? [])?.path).toEqual(["炉下落じんコンベヤ"]);
    // 機器の階層：設備 › 部位。号炉は設備の段に付く
    const { s } = await analyzed([{ name: "report.pdf", bytes: reportPdf() }]);
    const plan = s.compose().plan;
    const byName = new Map((plan?.assets ?? []).map((a) => [a.name, a]));
    expect(byName.get("焼却炉本体")?.level).toBe(1);
    expect(byName.get("焼却炉本体")?.series).not.toBeNull();
    expect(byName.get("炉壁局部損耗域(24 m2)")?.parentKey).toBe(byName.get("焼却炉本体")?.nodeKey);
    expect(byName.get("移送ポンプ")?.parentKey).toBe(byName.get("排水処理設備")?.nodeKey);
    expect(plan?.assets).toHaveLength(7);
  });

  test("切れた見出しと切れた字が、見出しの列の幅で 1 つの列にまとまる（Excel の表には効かせない）", async () => {
    const { lays } = await layouts("report.pdf", reportPdf());
    const t = lays[0]?.tables[0];
    expect(t?.cols.map((c) => c.header)).toEqual(["設備・機器／部位", "整備内容・期間", "状態・結果／申し送り"]);
    const first = t?.blocks?.records[0];
    const state = first?.items.get(t?.blocks?.stateCol ?? -1)?.map((x) => x.text);
    expect(state).toEqual([
      "実施済",
      // 4 つ・5 つのセルに切れた字の行を、行ごとにつなぎ、折り返した行を 1 つにする
      "炉壁局部の有効残厚 72.7 mm。次停止時予測 炉壁局部の有効残厚 59.7 mmが補修管理値を越えるため、今回停止内で対象部を整備。",
      "根拠：OBS-0052-C1-2020",
      "判断：損耗域の範囲・残厚確認",
      "施工量 24.0 m2／耐火 22人工",
      "備考：当該炉停止・隔離。部材は既往診断から選定。",
    ]);
    // 作業の内容の欄の行は、折り返しでなければ別々のまとまり
    expect(first?.items.get(t?.blocks?.workCol ?? -1)?.map((x) => x.text)).toEqual(["炉壁局部24 m2の打替補修", "2020-06-04 ～ 2020-06-08", "当該炉停止・隔離", "施工記録 W-0052-C1-2020"]);
    // 同じ形の格子を Excel に書いても、塊にはしない（今までどおり、名前の欄が空の行を聞く）
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [
        [null, "設備・機器／部", "位", "整備内容・期間", "状態・結果／申", "し送り"],
        [],
        [null, "焼却炉本体", null, "炉壁局部の打替補修", "実施済"],
        [null, "1号炉 焼却炉本体／炉", null, "2020-06-04 ～ 2020-06-08", "炉壁局部の有効", "残厚 72.7 mm"],
        [null, null, null, "当該炉停止・隔離", "施工量 24.0 m2／", "耐火 22人工"],
      ]);
    });
    const x = await layouts("same.xlsx", bytes);
    expect(x.lays[0]?.tables.some((tb) => tb.blocks)).toBe(false);
    const { an } = await analyzed([{ name: "same.xlsx", bytes }]);
    expect(an.questions.some((q) => q.kind === "stray" && q.text.startsWith("名前の欄が空で"))).toBe(true);
  });

  test("期間・実績と予定・施工量と人工を取り出す（年の無い月-日は、資料の題の年度から年を補う）", async () => {
    const { s } = await analyzed([{ name: "report.pdf", bytes: reportPdf() }]);
    const plan = s.compose().plan;
    const works = new Map((plan?.works ?? []).map((w) => [w.workKey, w.kind]));
    const d = (kind: string) => plan?.details.find((x) => works.get(x.workKey) === kind);
    const wall = d("炉壁局部24 m2の打替補修");
    expect([wall?.startDate, wall?.endDate, wall?.fiscalYear, wall?.planOrActual, wall?.manDays]).toEqual(["2020-06-04", "2020-06-08", 2020, "actual", 22]);
    expect(wall?.lines?.[0]?.quantity).toBe("施工量 24.0 m2");
    // 職種と人工・根拠・判断・備考・施工記録は、作業明細の備考（記録の注記）に残る
    for (const w of ["耐火 22人工", "根拠：OBS-0052-C1-2020", "判断：損耗域の範囲・残厚確認", "備考：当該炉停止・隔離。", "施工記録 W-0052-C1-2020", "当該炉停止・隔離"]) expect(wall?.lines?.[0]?.remark).toContain(w);
    // 「予定」の記録は予定の年度の値（作業明細の行にしない）
    const liner = d("押出板ライナ取替");
    expect([liner?.planOrActual, liner?.manDays, liner?.startDate]).toEqual(["plan", 8, "2020-06-10"]);
    expect(d("損耗チェーン・スプロケット部取替")?.manDays).toBe(12);
    expect(d("移送ポンプ分解整備")?.lines?.[0]?.quantity).toBe("施工量 1.0 台");
    // 整備総括：「05-14～05-18」の年は題の「令和3年度」から。「施工量 24.0 m2／」と「耐火 22.0 人工」が列をまたいで切れていても読む
    const sm = await analyzed([{ name: "summary.pdf", bytes: summaryPdf() }]);
    const p2 = sm.s.compose().plan;
    const w2 = new Map((p2?.works ?? []).map((w) => [w.workKey, w.kind]));
    const wall2 = p2?.details.find((x) => w2.get(x.workKey) === "炉壁局部の打替補修");
    expect([wall2?.startDate, wall2?.endDate, wall2?.fiscalYear, wall2?.manDays, wall2?.lines?.[0]?.quantity]).toEqual(["2021-05-14", "2021-05-18", 2021, 22, "施工量 24.0 m2"]);
    expect(p2?.details.map((x) => x.startDate).sort()).toEqual(["2021-05-14", "2021-05-20", "2021-06-01"]);
  });

  test("年の無い月-日は、題に年度が無ければ項目と内容の表の工期から補い、どちらも無ければ年度を 1 問で聞く", async () => {
    // 工期（2020-04-10 ～ 2020-06-18）から
    const r = await analyzed([{ name: "md.pdf", bytes: reportPdf({ monthDay: true, yearInTitle: false }) }]);
    expect(r.an.open).toEqual([]);
    expect(
      r.s
        .compose()
        .plan?.details.map((x) => x.startDate)
        .sort(),
    ).toEqual(["2020-05-17", "2020-05-25", "2020-06-04", "2020-06-10"]);
    // 題にも工期にも年が無い：1 問（数の答え）。答えると全部の記録に当たる
    const s = session();
    await s.add([{ name: "noyear.pdf", bytes: summaryPdf({ yearInTitle: false }) }]);
    const an = s.analyze();
    const qs = an.open.filter((q) => q.kind === "dateUnknown");
    expect(qs).toHaveLength(1);
    expect(qs[0]?.valueKind).toBe("number");
    expect(qs[0]?.sameShapeRows).toBe(3);
    expect(an.open).toHaveLength(1);
    expect(s.compose().plan).toBeNull();
    s.settle([human(qs[0]?.questionId ?? "", "2021")]);
    const after = s.analyze();
    expect(after.open).toEqual([]);
    expect(
      s
        .compose()
        .plan?.details.map((x) => x.startDate)
        .sort(),
    ).toEqual(["2021-05-14", "2021-05-20", "2021-06-01"]);
  });

  test("頁の頭書き・頁の足・節の題・文の段落・項目と内容の表は、理由つきで外れる", async () => {
    const { source, lays } = await layouts("report.pdf", reportPdf());
    const lay = lays[0];
    if (!lay) throw new Error("表が無い");
    const { an } = await analyzed([{ name: "report.pdf", bytes: reportPdf() }]);
    const reasonOfRow = (r: number) => {
      const xs = lay.grid.cells.filter((c) => c.r === r).map((c) => an.composition.status.get(cellKey({ file: "report.pdf", sheetIndex: 0, ref: c.ref })));
      return [...new Set(xs.map((x) => (x?.s === "excluded" ? x.reason : x?.s)))];
    };
    const rowsWhere = (f: (t: string) => boolean) => [...new Set(lay.grid.cells.map((c) => c.r))].filter((r) => f(rowTextOf(lay, r)));
    // 頁の頭書き（3 頁とも同じ 3 行）と頁の足（「【架空】若葉環境センター WK-2020-03 WK-2020-03-n / 3」）
    const heads = rowsWhere((t) => t.startsWith("【架空】若葉環境センター") || t.startsWith("令和2年度") || t.startsWith("契約番号"));
    expect(heads).toHaveLength(12);
    expect(rowsWhere((t) => /\d \/ 3$/u.test(t))).toHaveLength(3);
    for (const r of heads) expect(reasonOfRow(r)).toEqual([PAGE_REASON]);
    // 節の題と文の段落
    for (const r of rowsWhere((t) => /^\d．/u.test(t))) expect(reasonOfRow(r)).toEqual([SECTION_REASON]);
    const prose = rowsWhere((t) => t.startsWith("燃焼設備") || t.startsWith("、損耗") || t.startsWith("本報告") || t.startsWith("健全性"));
    expect(prose).toHaveLength(4);
    for (const r of prose) expect(reasonOfRow(r)).toEqual([PARAGRAPH_REASON]);
    // 項目と内容の表：資料の属性（号炉と工期）
    for (const r of rowsWhere((t) => /^(項目|対象設備|工期|施工区分) /u.test(t))) expect(reasonOfRow(r)).toEqual([ATTRS_REASON]);
    expect(lay.tables[0]?.blocks?.attrs).toEqual({ unit: 1, period: { start: { y: 2020, m: 4, d: 10 }, end: { y: 2020, m: 6, d: 18 } } });
    // くり返す見出し（2・3 頁目）と、資料の題・表の題
    const headers = rowsWhere((t) => t.startsWith("設備・機器／部"));
    expect(headers.map(reasonOfRow)).toEqual([["見出し（読み方に使った）"], [REPEAT_HEADER_REASON], [REPEAT_HEADER_REASON]]);
    for (const r of rowsWhere((t) => t.startsWith("工事報告書") || t.startsWith("機器 別の整備"))) expect(reasonOfRow(r)).toEqual(["題"]);
    // どのセルも行き先がある（読めたものか、理由つきで外したもの）
    const all = source.sheets[0]?.cells ?? [];
    const sts = all.map((c) => an.composition.status.get(cellKey({ file: "report.pdf", sheetIndex: 0, ref: c.ref }))?.s);
    expect(sts.every((x) => x === "data" || x === "excluded")).toBe(true);
    // 整備総括：「作成：」の行も頁ごとにくり返す頭書き、「n / m」は頁の足、表の下の「2．所見」と文は節の題と文の段落
    const sm = await layouts("summary.pdf", summaryPdf());
    const sl = sm.lays[0];
    if (!sl) throw new Error("表が無い");
    const r2 = await analyzed([{ name: "summary.pdf", bytes: summaryPdf() }]);
    const why2 = (f: (t: string) => boolean) =>
      [
        ...new Set(
          sl.grid.cells
            .filter((c) => f(rowTextOf(sl, c.r)))
            .map((c) => r2.an.composition.status.get(cellKey({ file: "summary.pdf", sheetIndex: 0, ref: c.ref })))
            .map((x) => (x?.s === "excluded" ? x.reason : x?.s)),
        ),
      ];
    expect(why2((t) => t.startsWith("作成："))).toEqual([PAGE_REASON]);
    expect(why2((t) => / \/ \d$/u.test(t))).toEqual([PAGE_REASON]);
    expect(why2((t) => t.startsWith("2．所見"))).toEqual([SECTION_REASON]);
    expect(why2((t) => t.startsWith("各機器の") || t === "以上")).toEqual([PARAGRAPH_REASON]);
  });

  test("「名前の欄が空の行」の問いも、質問の無い未解決も残らず、1 冊で計画まで作れる", async () => {
    for (const [name, bytes] of [
      ["report.pdf", reportPdf()],
      ["summary.pdf", summaryPdf()],
    ] as const) {
      const { s, an } = await analyzed([{ name, bytes }]);
      expect(an.questions.filter((q) => q.kind === "stray")).toEqual([]);
      expect(an.open).toEqual([]);
      const st = [...an.composition.status.values()];
      expect(st.filter((x) => x.s === "unresolved")).toEqual([]);
      const comp = s.compose();
      expect(comp.blockers).toEqual([]);
      expect(comp.plan?.details.length).toBe(name === "report.pdf" ? 4 : 3);
    }
  });

  test("塊にできなかった行だけが「名前の欄が空の行」に残り、同じ様式の資料の同じ形の問いは 1 問にまとまる", async () => {
    const files = [
      { name: "report-a.pdf", bytes: reportPdf({ orphan: true }) },
      { name: "report-b.pdf", bytes: reportPdf({ orphan: true }) },
    ];
    const s = session();
    await s.add(files);
    const an = s.analyze();
    const strays = an.open.filter((q) => q.kind === "stray");
    expect(strays).toHaveLength(1);
    expect(strays[0]?.sameShapeRows).toBe(2);
    expect(strays[0]?.options.map((o) => o.id)).toEqual(["exclude"]);
    // 答えると、その行のセルだけが理由つきで外れる（記録の塊は読めたまま）
    s.settle([human(strays[0]?.questionId ?? "", "exclude")]);
    const after = s.analyze();
    expect(after.open.filter((q) => q.kind === "stray")).toEqual([]);
    const excludedRefs = [...after.composition.status.entries()].filter(([, x]) => x.s === "excluded" && x.reason.startsWith("名前の欄が空の行")).map(([k]) => k);
    const orphanCells = after.layouts.flatMap((l) => l.grid.cells.filter((c) => l.grid.cells.some((x) => x.r === c.r && x.text.startsWith("前回から"))).map((c) => cellKey({ file: l.file, sheetIndex: l.sheetIndex, ref: c.ref })));
    expect(orphanCells.length).toBeGreaterThan(2);
    expect(excludedRefs.sort()).toEqual(orphanCells.sort());
    // 2 冊の同じ機器を結ぶ問い（既定の答えのあるもの）に答えると、未解決は残らない
    acceptDefaults(s);
    expect([...s.analyze().composition.status.values()].filter((x) => x.s === "unresolved")).toEqual([]);
    // 1 冊ずつ入れても同じ（1 冊に 1 問）
    const one = await analyzed([{ name: "report-a.pdf", bytes: reportPdf({ orphan: true }) }]);
    expect(one.an.open.filter((q) => q.kind === "stray")).toHaveLength(1);
    expect(one.an.open.filter((q) => q.kind === "stray")[0]?.sameShapeRows).toBe(1);
  });
});

describe("記録の中身を読む小さな決まり", () => {
  test("名前の欄の並び：設備の短い名前・号炉・設備／部位", () => {
    expect(parseBlockName(["灰押出装置", "1号炉 灰押出装置／押", "出板ライナ"])).toMatchObject({ path: ["灰押出装置", "押出板ライナ"], unitLevel: 0 });
    expect(parseBlockName(["排水処理設備", "共通 排水処理設備／移", "送ポンプ"])).toMatchObject({ unit: { kind: "common" }, path: ["排水処理設備", "移送ポンプ"] });
    // 1 行に並べた「設備 号炉 設備／部位」
    expect(parseBlockName(["落じんコンベヤ 1号炉 炉下落じんコンベヤ／チェーン"])).toMatchObject({ unit: { kind: "number", n: 1 }, path: ["炉下落じんコンベヤ", "チェーン"] });
    // 短い名前が下の名前と別の名前なら、上の段
    expect(parseBlockName(["燃焼設備", "1号炉 焼却炉本体／炉壁"])).toMatchObject({ path: ["燃焼設備", "焼却炉本体", "炉壁"], unitLevel: 1 });
    // 号炉の無い名前・号炉が 2 つ（読めない）
    expect(parseBlockName(["給水ポンプ"])).toEqual({ unit: null, path: ["給水ポンプ"], unitLevel: null });
    expect(parseBlockName(["1号炉 送風機／2号炉 軸受"])).toBeNull();
  });

  test("施工量と工数：人・日に読める工数のある行だけ。時間・人数だけは人・日にしない", () => {
    expect(parseEffortLine("施工量 24.0 m2／耐火 22人工")).toEqual({ quantity: ["施工量 24.0 m2"], manDays: 22, trades: ["耐火 22人工"] });
    expect(parseEffortLine("施工量 24.0 m2／ 耐火 22.0 人工")).toEqual({ quantity: ["施工量 24.0 m2"], manDays: 22, trades: ["耐火 22.0 人工"] });
    expect(parseEffortLine("機械 8人工／電気 4人日")).toMatchObject({ manDays: 12, quantity: [] });
    expect(parseEffortLine("施工量 6.0 m2／機械 16時間")).toBeNull();
    expect(parseEffortLine("有効残厚 59.7 mm")).toBeNull();
    expect(parseEffortLine("根拠：OBS-0052-C1-2020")).toBeNull();
  });

  test("年の無い月-日の期間", () => {
    expect(monthDayRange("05-14～05-18")).toEqual({ start: { m: 5, d: 14 }, end: { m: 5, d: 18 } });
    expect(monthDayRange("5/14〜5/18")).toEqual({ start: { m: 5, d: 14 }, end: { m: 5, d: 18 } });
    expect(monthDayRange("5月14日～5月18日")).toEqual({ start: { m: 5, d: 14 }, end: { m: 5, d: 18 } });
    expect(monthDayRange("13-01～13-02")).toBeNull();
    expect(monthDayRange("2020-06-04 ～ 2020-06-08")).toBeNull();
  });
});
