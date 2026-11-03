// 書類の一般の形の試験（docs/plan.md §2.6：直してよいのは一般の手がかりと一般の質問の形だけ）。
// 見ていない様式の 1 回目（heldout-1）で詰まった形を、架空の小さな資料で 1 つずつ確かめる。どの資料の語にも依らない。
import { describe, expect, test } from "vitest";
import { cue } from "../../../src/import/cues";
import { fiscalYearInText, parseMonthDay, withFiscalYear } from "../../../src/import/era";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);

describe("見出しの語と日付の小さな決まり", () => {
  test("見出しの末尾の括弧（単位）を除いて比べ、単位を読む。年や日付そのものは見出しの語にしない", () => {
    expect(cue.column("工数(人日)")).toBe("effort");
    expect(cue.column("延工数（h）")).toBe("effort");
    expect(cue.column("機器番号")).toBe("tag");
    expect(cue.column("完了日")).toBe("end");
    expect(cue.column("令和8年度")).toBeNull();
    expect(cue.column("2026/10/01")).toBeNull();
    expect(cue.headerUnit("工数(人日)")).toBe("manDays");
    expect(cue.headerUnit("延工数(h)")).toBe("hours");
    expect(cue.headerUnit("作業時間")).toBe("hours");
    expect(cue.headerUnit("工数")).toBeNull();
  });

  test("年の無い日付は、文に書いた年度がただ 1 つのときだけ年を付ける（年度の始まりより前の月は次の年）", () => {
    expect(parseMonthDay("4/6(月)")).toEqual({ m: 4, d: 6 });
    expect(parseMonthDay("1月9日（金）")).toEqual({ m: 1, d: 9 });
    expect(parseMonthDay("昭和63年度末")).toBeNull();
    expect(withFiscalYear({ m: 1, d: 9 }, 2026, 4)).toEqual({ y: 2027, m: 1, d: 9 });
    expect(fiscalYearInText(["【架空】作業日報", "令和8年度（2026年度）"])).toBe(2026);
    expect(fiscalYearInText(["令和4年度～令和7年度"])).toBeNull();
    expect(fiscalYearInText(["作業日報"])).toBeNull();
  });
});

describe("作業の記録の表", () => {
  // 機器の台帳（号の列あり）と、作業日報：題の下に項目と値の行（頭書き）、見出しの単位、年の無い日付、
  // 同じ日の 2 行目から日付を書かない、日ごとの計の行、号の列の数だけの書き方と「-」
  const ledger = csv(["名称,系列", "ポンプ,1号", "ブロワ,1号", "計量器,共通"]);
  const daily = csv([
    "【架空】作業日報,,,,",
    "受託者,【架空】甲社,年度,令和8年度（2026年度）",
    "日付,炉,機器,作業,時間(h)",
    "4/6(月),1,ポンプ,点検,16",
    ",1,ブロワ,点検,8",
    ",,,日計,24",
    "1/9(金),-,計量器,点検,8",
  ]);

  test("頭書きの行を表にせず、見出しの行を見つけ、作業の行として読む", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const lay = s.analyze().layouts.find((l) => l.file === "日報.csv");
    expect(lay?.contextFiscalYear).toBe(2026);
    const t = lay?.tables[0];
    expect(t?.shape).toBe("events");
    expect(t?.headerRows).toEqual([3]);
    expect(t?.cols.map((c) => c.role)).toEqual(["date", "unit", "assetRef", "workName", "effort"]);
    expect(lay?.notes.map((n) => n.r)).toContain(2);
  });

  test("空欄の日付は「上と同じ」か聞き、答えると上の行の日付。時間は 1 人・日の時間で直し、日計は時間の和で検算する", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
    ]);
    const blank = s.analyze().open.find((q) => q.kind === "blankSameAsAbove");
    expect(blank?.defaultAnswer).toBe("same");
    acceptDefaults(s);
    const hours = s.analyze().open.find((q) => q.kind === "hoursPerManDay");
    if (hours) s.settle([human(hours.questionId, "8")]);
    acceptDefaults(s);
    const an = s.analyze();
    const ev = an.records.events.filter((e) => e.file === "日報.csv");
    expect(ev.map((e) => `${e.date?.y}-${e.date?.m}-${e.date?.d}`)).toEqual(["2026-4-6", "2026-4-6", "2027-1-9"]);
    expect(ev.map((e) => e.manDays)).toEqual([2, 1, 1]);
    // 「-」は号なし（読めない号として聞かない）
    expect(ev[2]?.unit).toBeNull();
    expect(an.open.some((q) => q.kind === "unitMissing")).toBe(false);
    const c = s.compose();
    const day = c.checks.find((x) => x.file === "日報.csv" && x.row === 6);
    expect(day?.kind).toBe("subtotal");
    expect(day?.mismatches).toEqual([]);
  });

  test("着手と完了を別の列に書く表は、2 つの日付で期間。〃 は上の行と同じ。管理番号の列は行を指すだけ", async () => {
    const list = csv([
      "管理No,着手日,完了日,号炉,機器名称,作業内容,工数(人日)",
      "K-01,2022/4/6,2022/4/17,1号炉,ポンプ,分解整備,24",
      "K-02,〃,〃,1号炉,ブロワ,分解整備,12",
    ]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "一覧.csv", bytes: list },
    ]);
    const an = s.analyze();
    const t = an.layouts.find((l) => l.file === "一覧.csv")?.tables[0];
    expect(t?.cols.map((c) => c.role)).toEqual(["number", "date", "end", "unit", "assetRef", "workName", "effort"]);
    expect(an.open.some((q) => q.kind === "columnRole")).toBe(false);
    const ev = an.records.events.filter((e) => e.file === "一覧.csv");
    expect(ev.map((e) => [e.date?.d, e.end?.d, e.manDays])).toEqual([
      [6, 17, 24],
      [6, 17, 12],
    ]);
  });

  test("機器番号の列に書いた番号で、名前の書き方が違っても機器に当てる", async () => {
    const tagged = csv(["名称,機器番号", "誘引通風機,IDF-1", "押込送風機,FDF-1"]);
    const rep = csv(["No.,機器名称,機器番号,作業内容,着手,完了,工数(人日)", "1,誘引送風機,IDF-1,点検,2023/9/1,2023/9/3,6"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: tagged },
      { name: "報告.csv", bytes: rep },
    ]);
    const an = s.analyze();
    expect(an.records.assets.find((a) => a.name === "誘引通風機")?.tag).toBe("IDF-1");
    const q = an.open.find((x) => x.kind === "eventAsset");
    expect(q?.text).toContain("機器番号");
    acceptDefaults(s);
    const plan = s.compose().plan;
    const idf = plan?.assets.find((a) => a.name === "誘引通風機");
    expect(plan?.works.some((w) => w.targets.includes(idf?.nodeKey ?? "?"))).toBe(true);
  });

  test("「まとまり 一式（A・B）」は括弧の中の名前で当てる。名前の同じ機器が無ければ、同じ号の機器から選ばせる", async () => {
    const list = csv(["日付,号炉,機器,作業内容,工数", "2022/5/1,1号炉,排ガス設備 一式（ポンプ・ブロワ）,点検,延べ6人", "2022/5/2,1号炉,ポンプ類,点検,延べ2人"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "一覧.csv", bytes: list },
    ]);
    const an = s.analyze();
    const bundle = an.records.events.find((e) => e.row === 2);
    expect(bundle?.bundle).toBe(true);
    const one = an.open.find((q) => q.kind === "eventAssetOne" && q.text.includes("ポンプ類"));
    expect(one?.text).toContain("名前の同じ機器が無い");
    expect(one?.options.map((o) => o.label)).toEqual(expect.arrayContaining([expect.stringContaining("ポンプ"), expect.stringContaining("ブロワ"), expect.stringContaining("計量器")]));
    // 選択肢の i 番目の候補の出どころが、items の i 番目にある
    expect(one?.items.length).toBe(one!.options.length - 1);
    expect(an.open.some((q) => q.kind === "eventAssetOne" && (q.text.includes("「ポンプ」") || q.text.includes("「ブロワ」")))).toBe(false);
  });
});

describe("台帳と星取表の形", () => {
  test("見出し「名称」の下の 設備・機器・部位 の列に段ごとに名前を書く台帳：列の位置が段。通し番号は段の票にしない。〃 の設置年は上と同じ", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["No.", "名称", null, null, "機器番号", "設置年"]]);
      rows(ws, 2, [[null, "設備", "機器", "部位", null, null]]);
      ws.mergeCells("B1:D1");
      ws.mergeCells("A1:A2");
      ws.mergeCells("E1:E2");
      ws.mergeCells("F1:F2");
      rows(ws, 3, [
        [null, "甲設備", null, null, null, null],
        [1, null, "ポンプ", null, "P-1", "平成14年"],
        [null, null, null, "羽根車", null, null],
        [2, null, "ブロワ", null, "B-1", "〃"],
      ]);
    });
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.cols.filter((c) => c.role === "name").map((c) => c.hierLevel)).toEqual([1, 2, 3]);
    expect(an.open.filter((q) => q.kind === "levelSplit" || q.kind === "stray" || q.kind === "yearUnknown")).toEqual([]);
    acceptDefaults(s);
    const plan = s.compose().plan;
    const by = (n: string) => plan?.assets.find((a) => a.name === n);
    expect([by("甲設備")?.level, by("ポンプ")?.level, by("羽根車")?.level]).toEqual([1, 2, 3]);
    expect(by("羽根車")?.parentKey).toBe(by("ポンプ")?.nodeKey);
    expect(by("ポンプ")?.tag).toBe("P-1");
    expect(by("ブロワ")?.installedOn).toBe("2002");
  });

  test("年の見出しが帯の下の段、予定と実績を行に分けて書く星取表：行の予定・実績で読み、名前の無い 2 段目は上の機器。名前の後ろの号は号", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["設備", "機器名称", "区分", "実施済", null, "計画期間"]]);
      rows(ws, 2, [[null, null, null, "R5", "R6", "R7"]]);
      ws.mergeCells("D1:E1");
      ws.mergeCells("A1:A2");
      ws.mergeCells("B1:B2");
      ws.mergeCells("C1:C2");
      rows(ws, 3, [
        ["甲設備", "ポンプ\n(1号炉)", "予定", null, null, "○"],
        [null, null, "実績", "●", null, "●"],
        [null, "ポンプ\n(2号炉)", "予定", "○", null, null],
        [null, null, "実績", null, "●", null],
      ]);
      ws.mergeCells("A3:A6");
      rows(ws, 8, [["凡例：○予定　●実績"]]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.shape).toBe("grid");
    expect(t?.cols.find((c) => c.c === 3)?.role).toBe("planActual");
    expect(t?.cols.filter((c) => c.role === "mark").map((c) => [c.fiscalYear, c.planOrActual])).toEqual([
      [2023, "actual"],
      [2024, "actual"],
      [2025, "plan"],
    ]);
    acceptDefaults(s);
    const an2 = s.analyze();
    const marks = an2.records.marks.map((m) => `${m.ref}:${m.planOrActual}:${an2.records.assets.find((a) => a.id === m.assetId)?.name}${(an2.records.assets.find((a) => a.id === m.assetId)?.series as { n?: number } | null)?.n ?? ""}`);
    // 「計画期間」の列の F4 の ● は、行の「実績」で読む（帯より行が細かい）
    expect(marks.sort()).toEqual(["D4:actual:ポンプ1", "D5:plan:ポンプ2", "E6:actual:ポンプ2", "F3:plan:ポンプ1", "F4:actual:ポンプ1"]);
    expect(an2.open.some((q) => q.kind === "planActualConflict")).toBe(false);
  });

  test("表の上の「項目と値」だけの塊（帳票の頭書き）は表にしない。値が数だけの 2 列の小さな表は表のまま", async () => {
    const report = csv([
      "【架空】工事報告書,,,,,",
      "",
      "工事名,【架空】定期整備工事,,,,",
      "工期,R5.8.31～R5.10.13,,,,",
      "受注者,【架空】甲社,,,,",
      "",
      "No.,機器名称,作業内容,着手,完了,工数(人日)",
      "1,ポンプ,点検,R5.8.31,R5.9.2,6",
    ]);
    const s = session();
    await s.add([{ name: "報告.csv", bytes: report }]);
    const lay = s.analyze().layouts[0];
    expect(lay?.tables.map((t) => t.shape)).toEqual(["events"]);
    expect(lay?.notes.map((n) => n.r)).toEqual(expect.arrayContaining([3, 4, 5]));
  });
});
