// 書類の一般の形の試験（docs/plan.md §2.6：直してよいのは一般の手がかりと一般の質問の形だけ）。
// 見ていない様式の 1 回目（heldout-1）で詰まった形を、架空の小さな資料で 1 つずつ確かめる。どの資料の語にも依らない。
import { describe, expect, test } from "vitest";
import { cue } from "../../../src/import/cues";
import { fiscalYearInText, parseDateRange, parseMonthDay, withFiscalYear } from "../../../src/import/era";
import { assetFromTitle, cycleHeaderUnit, parseCycle, parseUnit, splitFlatWork } from "../../../src/import/text";
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

describe("見ていない様式の 2 回目（heldout-2）で詰まった形", () => {
  const ledger = csv(["名称,系列,機器番号", "ポンプ,1号,P-1", "ブロワ,1号,B-1", "計量器,共通,SCL"]);

  test("CSV の囲みの中の改行で表が分かれない。頭書きに見出しの語がまじっても、見出しの語のいちばん多い行が見出し。件数の行は行の数と照らす", async () => {
    const wo = csv([
      "【架空】作業の書き出し",
      "出力日時,2026/10/01 09:15,工数の単位,時間（h:mm）",
      "WO番号,状態,設備コード,設備名称,作業件名,着手日,完了日,工期(日),予定工数,実績工数,備考",
      'W-1,完了,P-1,ポンプ,点検,2022/04/06,2022/04/08,3,,24:00,"1 行目',
      '2 行目"',
      "W-2,完了,B-1,ブロワ,点検,2022/05/06,2022/05/06,1,,7:30,",
      "件数,2",
    ]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "書き出し.csv", bytes: wo },
    ]);
    const an = s.analyze();
    const lay = an.layouts.find((l) => l.file === "書き出し.csv");
    expect(lay?.tables.length).toBe(1);
    const t = lay?.tables[0];
    expect(t?.headerRows).toEqual([3]);
    expect(t?.cols.map((c) => c.role)).toEqual(["number", "planActual", "tag", "assetRef", "workName", "date", "end", "days", "effort", "effort", "remark"]);
    acceptDefaults(s);
    const hours = s.analyze().open.find((q) => q.kind === "hoursPerManDay");
    if (hours) s.settle([human(hours.questionId, "8")]);
    acceptDefaults(s);
    const ev = s.analyze().records.events.filter((e) => e.file === "書き出し.csv");
    // 予定工数が空の行は実績工数（h:mm）。7:30 は 7.5 時間
    expect(ev.map((e) => e.manDays)).toEqual([3, 7.5 / 8]);
    const count = s.compose().checks.find((x) => x.file === "書き出し.csv");
    expect(count?.mismatches).toEqual([]);
  });

  test("作業の表の区分の見出しの行（「〈甲設備〉」）は注記。名前の前の号と〔番号〕を分ける。延人員の見出しは人・日", async () => {
    const rep = csv([
      "No.,設備／機器〔番号〕,作業内容,実施期間,日数,延人員(人)",
      ",〈甲設備〉,,,,",
      "1,1号炉ポンプ〔P-1〕,点検,R5.8.31～R5.9.2,3,6",
      "2,1号炉ブロワ〔B-1〕,点検,R5.8.31～R5.9.2,3,9",
      ",,延人員 計,,,15",
    ]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "報告.csv", bytes: rep },
    ]);
    const an = s.analyze();
    const t = an.layouts.find((l) => l.file === "報告.csv")?.tables[0];
    expect(t?.cols[1]?.role).toBe("assetRef");
    expect(t?.rows.find((r) => r.r === 2)?.role).toBe("note");
    expect(t?.rows.find((r) => r.r === 5)?.role).toBe("total");
    const ev = an.records.events.filter((e) => e.file === "報告.csv");
    expect(ev.map((e) => [e.assetNames[0], e.unit?.kind === "number" ? e.unit.n : null, e.manDays])).toEqual([
      ["ポンプ〔P-1〕", 1, 6],
      ["ブロワ〔B-1〕", 1, 9],
    ]);
  });

  test("工程表：見出しの上の段・単位の段・日の数と曜日の段は見出し。日付の列が無ければ、表の外に書いた工期を使うか聞く", async () => {
    const gantt = csv([
      "【架空】実施工程表（予定）,,,,,,,",
      "予定工期：令和8年10月5日（月）～ 令和8年10月7日（水） 3日間,,,,,,,",
      ",,,人員,,延人員,,,,",
      "No.,機器名称〔番号〕,作業内容,,日数,,,,,備考",
      ",,,(人/日),,(人),5,6,7,",
      ",,,,,,月,火,水,",
      "1,ポンプ〔P-1〕,点検,2,3,6,,,,",
    ]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "工程表.csv", bytes: gantt },
    ]);
    const an = s.analyze();
    const lay = an.layouts.find((l) => l.file === "工程表.csv");
    expect(lay?.contextPeriod?.start).toEqual({ y: 2026, m: 10, d: 5 });
    const t = lay?.tables[0];
    expect(t?.shape).toBe("events");
    expect(t?.headerRows).toEqual([3, 4, 5, 6]);
    const q = an.open.find((x) => x.kind === "dateUnknown");
    expect(q?.options.map((o) => o.id)).toEqual(["heading", "exclude"]);
    s.settle([human(q?.questionId ?? "", "heading")]);
    const ev = s.analyze().records.events.find((e) => e.file === "工程表.csv");
    expect([ev?.date?.d, ev?.end?.d]).toEqual([5, 7]);
  });

  test("短い字の印（「点」「（点）」「整・精」）と、注記の行の凡例（「凡例　点＝点検　整＝整備」）の星取表。まとまりの見出しの行は親", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["凡例　点＝点検　整＝整備　精＝精密"]]);
      rows(ws, 3, [["設備・機器名称", "号炉", "R5", "R6", "R7"]]);
      rows(ws, 4, [
        ["甲設備", null, null, null, null],
        ["ポンプ", "1号炉", "点", "整・精", "（点）"],
        ["ブロワ", "1号炉", null, "点", null],
      ]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.shape).toBe("grid");
    expect(t?.legend.map((e) => `${e.symbol}=${e.meaning}`)).toEqual(["点=点検", "整=整備", "精=精密"]);
    const assets = an.records.assets;
    const pump = assets.find((a) => a.name === "ポンプ");
    expect(pump?.level).toBe(2);
    expect(assets.find((a) => a.id === pump?.parentId)?.name).toBe("甲設備");
  });
});

describe("見ていない様式の 3 回目（heldout-3）で詰まった形", () => {
  const ledger = csv(["名称,号炉,機器番号", "ポンプ,1号,1-PMP", "ブロワ,1号,1-BLW", "計量器,共通,0-SCL"]);
  const kinds = (s: ReturnType<typeof session>) => s.analyze().questions.map((q) => q.kind).sort();

  test("数の並びだけの日付（yyyymmdd）：CSV の文字でも xlsx の数でも日付の列。8 桁の管理番号は日付にしない", async () => {
    const daily = csv(["作業日,炉,機器,作業,時間(h)", "20240406,1,ポンプ,点検,16", "20240407,1,ブロワ,点検,8"]);
    const xlsx = await xlsxOf((ws) => {
      rows(ws, 1, [["管理No", "実施日", "機器", "作業内容", "工数(人日)"]]);
      rows(ws, 2, [
        [20240001, 20240510, "ポンプ", "整備", 2],
        [20240002, 20240511, "ブロワ", "整備", 1],
        [20240003, 20240512, "計量器", "整備", 1],
      ]);
    });
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: daily },
      { name: "実績.xlsx", bytes: xlsx },
    ]);
    const an = s.analyze();
    expect(an.layouts.find((l) => l.file === "日報.csv")?.tables[0]?.cols[0]?.role).toBe("date");
    // 「実施日」は見出しが日付の語で、中身が正しい年月日。「管理No」（20240001 は月が 00）は番号の列のまま
    expect(an.layouts.find((l) => l.file === "実績.xlsx")?.tables[0]?.cols.map((c) => c.role).slice(0, 2)).toEqual(["number", "date"]);
    expect(an.open.filter((q) => q.kind === "columnRole" || q.kind === "dateUnknown")).toEqual([]);
    expect(an.records.events.filter((e) => e.file === "日報.csv").map((e) => `${e.date?.y}-${e.date?.m}-${e.date?.d}`)).toEqual(["2024-4-6", "2024-4-7"]);
    expect(an.records.events.filter((e) => e.file === "実績.xlsx").map((e) => e.date?.d ?? null)).toEqual([10, 11, 12]);
  });

  test("右の年を省いた期間（「2023/9/14～9/27」「令和5年12月25日～1月5日」）は始まりの年から読み、工期の列は日付の列", async () => {
    expect(parseDateRange("2023/9/14～9/27")).toEqual({ start: { y: 2023, m: 9, d: 14 }, end: { y: 2023, m: 9, d: 27 } });
    expect(parseDateRange("令和5年12月25日～1月5日")).toEqual({ start: { y: 2023, m: 12, d: 25 }, end: { y: 2024, m: 1, d: 5 } });
    expect(parseDateRange("9/14～9/27")).toBeNull();
    const rep = csv(["区分,作業項目,対象機器,工期,日数,人工(人日)", "甲,分解整備,ポンプ,2023/9/14～9/27,14,56", "甲,点検,ブロワ,2023/9/14～9/20,7,14"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "集計.csv", bytes: rep },
    ]);
    const an = s.analyze();
    expect(an.layouts.find((l) => l.file === "集計.csv")?.tables[0]?.cols.find((c) => c.header === "工期")?.role).toBe("date");
    expect(an.open.some((q) => q.kind === "columnRole")).toBe(false);
    expect(an.records.events.filter((e) => e.file === "集計.csv").map((e) => e.end?.d)).toEqual([27, 20]);
  });

  test("行が「機器 × 作業」の星取表：作業の列はその行の作業、少ない値をくり返す列（施工）は属性。作業だけを書いた行は上の行の機器か聞く", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["【架空】長期保全計画表"]]);
      rows(ws, 2, [["凡例　▲：実施済　△：計画　（令和8年9月末現在）"]]);
      rows(ws, 3, [["設備区分", "機器名称", "機器番号", "作業項目", "受注", "2024", "2025"]]);
      rows(ws, 4, [
        ["甲設備", "ポンプ", "1-PMP", "分解整備", "委託", "▲", "△"],
        [null, null, null, "精密検査", "委託", "▲", null],
        [null, "ブロワ", "1-BLW", "点検", "直営", null, "△"],
        [null, null, null, "取替", "委託", null, "△"],
      ]);
      ws.mergeCells("A4:A7");
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.shape).toBe("grid");
    expect(t?.cols.slice(0, 5).map((c) => c.role)).toEqual(["hier", "hier", "tag", "workName", "spec"]);
    // 題と表のあいだの「凡例　▲：実施済　△：計画」の行も凡例（後ろの括弧の注記は記号にしない）
    expect(t?.legend.map((e) => `${e.symbol}=${e.planOrActual}`)).toEqual(["▲=actual", "△=plan"]);
    const blank = an.open.find((q) => q.kind === "blankSameAsAbove");
    expect(blank?.options.map((o) => o.label)).toEqual(["上の行と同じ機器（別の作業）", "機器は無い"]);
    acceptDefaults(s);
    const an2 = s.analyze();
    const name = (id: string | null) => an2.records.assets.find((a) => a.id === id)?.name;
    expect(an2.records.marks.map((m) => `${m.ref}:${name(m.assetId)}:${m.workName}`).sort()).toEqual([
      "F4:ポンプ:分解整備",
      "F5:ポンプ:精密検査",
      "G4:ポンプ:分解整備",
      "G6:ブロワ:点検",
      "G7:ブロワ:取替",
    ]);
    expect(an2.records.assets.filter((a) => a.name === "委託" || a.name === "分解整備")).toEqual([]);
    const comp = s.compose();
    expect(comp.blockers).toEqual([]);
    // 作業の名前のセルは、印の記録の出どころ
    expect(comp.plan?.details.some((d) => d.sources.some((x) => x.cell === "D5"))).toBe(true);
  });

  test("PDF の題を位置で切り分けた行・表の下の署名の欄は、表にしない（見出しの列に中身が並ばない小さな塊）", async () => {
    const rep = csv([
      ",,【架空】令和6年度,2号炉定期整備,作業実績報告書,,",
      "",
      "番号,機器名称,作業項目,着手,完了,日数,延時間(h)",
      "1,ポンプ,点検,2024/10/5,2024/10/16,12,384",
      "2,ブロワ,点検,2024/10/5,2024/10/16,12,288",
      "",
      ",,,,,上記のとおり報告します。,",
      ",,,,,【架空】甲社,,現場代理人,（記名省略）",
    ]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "報告.csv", bytes: rep },
    ]);
    const lay = s.analyze().layouts.find((l) => l.file === "報告.csv");
    expect(lay?.tables.map((t) => [t.shape, t.top])).toEqual([["events", 3]]);
    expect([...(lay?.notes.map((n) => n.r) ?? [])].sort((a, b) => a - b)).toEqual([1, 7, 8]);
    expect(s.analyze().open.some((q) => q.kind === "columnRole" || q.kind === "assetUnmatched")).toBe(false);
  });

  test("機器番号が同じ機器は、段や親の書き方が資料で違っても結ぶ案にする。番号の列の数で始まる番号（「1-PMP」）でも日報の行を機器に当てる", async () => {
    const star = await xlsxOf((ws) => {
      rows(ws, 1, [["【架空】星取表"]]);
      rows(ws, 2, [["凡例　●：実績　○：予定"]]);
      rows(ws, 3, [["設備", "機器名称", "機器番号", "R5", "R6"]]);
      rows(ws, 4, [
        ["甲設備", "ポンプ", "1-PMP", "●", "○"],
        [null, "ブロワ", "1-BLW", "●", null],
      ]);
      ws.mergeCells("A4:A5");
    });
    const daily = csv(["日付,機器番号,機器名称,作業,工数(人日)", "2023/5/1,1-PMP,ポンプ,点検,2", "2023/5/2,0-SCL,計量器,点検,1"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "星取表.xlsx", bytes: star },
      { name: "日報.csv", bytes: daily },
    ]);
    const link = s.analyze().open.find((q) => q.kind === "assetLink");
    expect(link?.text).toContain("機器番号と名前が同じ");
    acceptDefaults(s);
    const an2 = s.analyze();
    const pump = an2.linked.clusters.find((c) => c.tag === "1-PMP");
    expect(pump?.recs.map((r) => r.file).sort()).toEqual(["台帳.csv", "星取表.xlsx"]);
    // 日報の行は、番号の列の番号で機器に当たる（「名前の同じ機器が無い」とは聞かない）
    expect(an2.questions.some((q) => q.kind === "eventAssetOne" && q.text.includes("名前の同じ機器が無い"))).toBe(false);
    expect(s.compose().blockers).toEqual([]);
  });

  test("「この機器か」の問い（はい・外す）は、行ごとに候補の機器の出どころを添える", async () => {
    const daily = csv(["日付,機器,作業,工数(人日)", "2023/5/1,ポンプ,点検,2", "2023/5/2,ポンプ,整備,1"]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: csv(["名称,機器番号", "ポンプ,PMP", "ブロワ,BLW"]) },
      { name: "日報.csv", bytes: daily },
    ]);
    const g = s.analyze().open.find((q) => q.kind === "eventAsset");
    s.settle([human(g?.questionId ?? "", "split")]);
    const one = s.analyze().open.find((q) => q.kind === "eventAssetOne");
    expect(one?.items.length).toBeGreaterThan(0);
    expect(one?.items.every((it) => it.target?.[0]?.file === "台帳.csv" && it.target[0].cells[0] === "A2")).toBe(true);
  });

  test("表の上の頭書きの「設備名｜X」（設備ごとに 1 シートの台帳）は、表の機器の親のまとまり", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["【架空】機器台帳"]]);
      rows(ws, 2, [["施設名", "【架空】甲工場", null, "整理番号", "01"]]);
      rows(ws, 3, [["設備名", "甲設備", null, "作成", "R8.3.31"]]);
      rows(ws, 5, [["号炉", "機器名称", "機器番号", "仕様", "設置年"]]);
      rows(ws, 6, [
        ["1号炉", "ポンプ", "1-PMP", "30 kW", "2002"],
        ["1号炉", "ブロワ", "1-BLW", "15 kW", "2002"],
      ]);
    }, "01甲");
    const s = session();
    await s.add([{ name: "台帳.xlsx", bytes }]);
    const an = s.analyze();
    const group = an.records.assets.find((a) => a.name === "甲設備");
    expect(group?.level).toBe(1);
    expect(an.records.assets.filter((a) => a.parentId === group?.id).map((a) => [a.name, a.level])).toEqual([
      ["ポンプ", 2],
      ["ブロワ", 2],
    ]);
    // 「施設名」は名前の項目ではない（まとまりにしない）
    expect(an.records.assets.some((a) => a.name === "【架空】甲工場")).toBe(false);
  });

  test("数を数える字（「1基」「2台」）と数量の見出しの列は号にしない：台帳（xlsx）でも日報（CSV）でも、数量の列の無い資料と同じ質問の数", async () => {
    expect(parseUnit("1基")).toBeNull();
    expect(parseUnit("2台")).toBeNull();
    expect(parseUnit("1系")).toEqual({ kind: "number", n: 1, spelling: "{n}系" });
    const ledgerOf = (qty: boolean) =>
      xlsxOf((ws) => {
        rows(ws, 1, [["名称", ...(qty ? ["数量"] : []), "型式"]]);
        rows(ws, 2, [
          ["1号炉ポンプ", ...(qty ? ["1基"] : []), "渦巻"],
          ["2号炉ポンプ", ...(qty ? ["1基"] : []), "渦巻"],
          ["計量器", ...(qty ? ["2台"] : []), "ロードセル"],
        ]);
      });
    const dailyOf = (qty: boolean) =>
      csv([`日付,${qty ? "数量," : ""}号炉,機器,作業,工数(人日)`, `2024/4/6,${qty ? "2台," : ""}1,ポンプ,点検,2`, `2024/4/7,${qty ? "1台," : ""}2,ポンプ,点検,2`]);
    const run = async (qtyLedger: boolean, qtyDaily: boolean) => {
      const s = session();
      await s.add([
        { name: "台帳.xlsx", bytes: await ledgerOf(qtyLedger) },
        { name: "日報.csv", bytes: dailyOf(qtyDaily) },
      ]);
      acceptDefaults(s);
      return s;
    };
    const base = await run(false, false);
    const withLedgerQty = await run(true, false);
    const withDailyQty = await run(false, true);
    expect(kinds(withLedgerQty)).toEqual(kinds(base));
    expect(kinds(withDailyQty)).toEqual(kinds(base));
    // 名前の前の号（「2号炉ポンプ」）が、数量の「1基」で上書きされない
    expect(withLedgerQty.analyze().records.assets.filter((a) => a.name === "ポンプ").map((a) => (a.series as { n?: number } | null)?.n)).toEqual([1, 2]);
    expect(withDailyQty.analyze().records.events.map((e) => (e.unit as { n?: number } | null)?.n)).toEqual([1, 2]);
  });

  test("名前の前の号は、空白なしで漢字の名前が続いても 1 字まで（「1号炉焼却炉本体」）。番号を分けた名前からも分ける。件名の頭の号はその行の号", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: csv(["名称,型式", "1号炉焼却炉本体（FNC-1）,甲", "2号炉焼却炉本体（FNC-2）,甲"]) },
      { name: "実績.csv", bytes: csv(["工事件名,対象機器,着工日,竣工日", "1号炉 定期整備工事,焼却炉本体,2023/4/6,2023/4/17", "1号炉・2号炉 点検,焼却炉本体,2023/5/6,2023/5/7"]) },
    ]);
    acceptDefaults(s);
    const an = s.analyze();
    expect(an.records.assets.map((a) => [a.name, (a.series as { n?: number } | null)?.n, a.tag])).toEqual([
      ["焼却炉本体", 1, "FNC-1"],
      ["焼却炉本体", 2, "FNC-2"],
    ]);
    expect(an.records.events.map((e) => (e.unit as { n?: number } | null)?.n ?? null)).toEqual([1, null]);
  });

  test("機器の表の「管理番号」の列で、中身が英字まじりの符号で行ごとに違えば機器番号。作業の表の管理番号は行を指すだけ", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["【架空】星取表"]]);
      rows(ws, 2, [["凡例　点＝点検"]]);
      rows(ws, 3, [["No.", "設備・機器名称", "管理番号", "R5", "R6"]]);
      rows(ws, 4, [
        [1, "ポンプ", "PMP-1", "点", null],
        [2, "ブロワ", "BLW-1", null, "点"],
        [3, "計量器", "SCL", "点", "点"],
      ]);
    });
    const s = session();
    await s.add([
      { name: "星取表.xlsx", bytes },
      { name: "実績.csv", bytes: csv(["管理No,日付,機器,作業", "R4-001,2022/4/6,ポンプ,点検", "R4-002,2022/4/7,ブロワ,点検", "R4-003,2022/4/8,計量器,点検"]) },
    ]);
    const an = s.analyze();
    expect(an.layouts.find((l) => l.file === "星取表.xlsx")?.tables[0]?.cols[2]?.role).toBe("tag");
    expect(an.records.assets.find((a) => a.name === "ポンプ")?.tag).toBe("PMP-1");
    expect(an.layouts.find((l) => l.file === "実績.csv")?.tables[0]?.cols[0]?.role).toBe("number");
  });

  test("表紙のシート：1 セルだけの文の並び（「記入の決まり」）は表にしない。列の役目の問いは、日付・機器番号・工数などの役目でも答えられる", async () => {
    const cover = await xlsxOf((ws) => {
      rows(ws, 1, [["【架空】機器台帳"]]);
      rows(ws, 3, [["記入の決まり"], ["・設備ごとに 1 シート。"], ["・区分の「機」は機器。"], ["・機器番号の先頭は号炉。"], ["・設置年は和暦の略号。"], ["・取消線は撤去済み。"]]);
    }, "表紙");
    const s = session();
    await s.add([
      { name: "表紙.xlsx", bytes: cover },
      { name: "日報.csv", bytes: csv(["日付,実施区分あ,機器,作業,工数(人日)", "2024/4/6,あ,ポンプ,点検,2", "2024/4/7,い,ブロワ,点検,1"]) },
    ]);
    const an = s.analyze();
    expect(an.layouts.find((l) => l.file === "表紙.xlsx")?.tables).toEqual([]);
    expect(an.records.assets.filter((a) => a.file === "表紙.xlsx")).toEqual([]);
    const q = an.open.find((x) => x.kind === "columnRole");
    expect(q?.options.map((o) => o.id)).toEqual(["remark", "workName", "assetRef", "tag", "date", "end", "days", "effort", "exclude"]);
  });
});

describe("帳票（1 日 1 枚・1 件 1 枚）と、heldout-4 で詰まった形", () => {
  const day = (k: number) => new Date(Date.UTC(2021, 3, 1 + k));

  test("改ページで頁に分けた日報（月のシートに 1 日 1 枚）：頭書きの日付をその頁の行に付け、番号だけの行と表の下の記入欄は記録にしない", async () => {
    const bytes = await xlsxOf((ws) => {
      for (let k = 0; k < 3; k++) {
        const top = 1 + k * 12;
        rows(ws, top, [
          ["日付", null, null, "天候", "晴", null, "【架空】甲工場　作業日報"],
          [`No. R3-00${k + 1}`, null, null, "記入者", "甲"],
        ]);
        ws.getCell(top, 2).value = day(k);
        ws.getCell(top, 2).numFmt = "yyyy/m/d";
        rows(ws, top + 3, [["No.", "機器", "作業内容", "業者", "人工"], ["1", "ポンプ", "点検", "【架空】甲社", 2], ["2", "ブロワ", "給油", "【架空】甲社", 1], ["3"], ["4"], ["特記事項", null, "KY 活動実施。"]]);
        ws.getRow(top + 11).addPageBreak();
      }
    }, "4月");
    const s = session();
    await s.add([{ name: "日報.xlsx", bytes }]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "dateUnknown")).toBe(false);
    const lay = an.layouts[0];
    expect(lay?.tables.filter((t) => t.shape === "events").length).toBe(3);
    expect(an.records.events.filter((e) => !e.excluded).map((e) => `${e.date?.m}/${e.date?.d} ${e.assetNames[0]}`)).toEqual(["4/1 ポンプ", "4/1 ブロワ", "4/2 ポンプ", "4/2 ブロワ", "4/3 ポンプ", "4/3 ブロワ"]);
    expect(lay?.tables[0]?.rows.filter((r) => r.role === "data").length).toBe(2);
    expect([...(lay?.rowReasons.values() ?? [])]).toContain("表の下の記入欄（項目と文）");
    // 台帳も星取表も無い：日報の機器の名前のまま新しい機器にするかを 1 回聞く。入れると、頁をまたいだ同じ名前は 1 つの機器
    // ほかの問い（業者の列の役目・工数の単位）は既定か最初の選択肢で答える
    for (let i = 0; i < 4; i++) for (const x of s.analyze().open.filter((o) => !o.options.some((k) => k.id === "new"))) s.settle([human(x.questionId, x.defaultAnswer ?? x.options[0]?.id ?? "")]);
    const q = s.analyze().open.find((x) => x.kind === "eventAsset" && x.options.some((o) => o.id === "new"));
    expect(q).toBeTruthy();
    s.settle([human(q?.questionId ?? "", "new")]);
    acceptDefaults(s);
    for (const x of s.analyze().open) s.settle([human(x.questionId, x.options[0]?.id ?? "")]);
    expect(s.compose().plan?.assets.map((a) => a.name).sort()).toEqual(["ブロワ", "ポンプ"]);
  });

  test("改ページの無い 1 件 1 枚の報告書：頁は頭書きつきでくり返す見出しで切り、頭書きの「設備名」「機器番号」を、機器の欄の無い表の行に付ける", async () => {
    const page = (name: string, tag: string): (string | number | null)[][] => [
      ["【架空】修繕報告書"],
      ["報告No.", "修-1", null, "報告日", "R7.5.17"],
      ["設備名", name, null, "機器番号", tag],
      [],
      ["No.", "作業日", "作業内容", "業者", "工数（人工）"],
      ["1", "R7.5.14", "分解", "【架空】甲社", 1],
      ["2", "R7.5.16", "組立", "【架空】甲社", 1.5],
    ];
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, page("ポンプ No.2", "P-2"));
      rows(ws, 10, page("ブロワ", "B-1"));
    });
    const s = session();
    await s.add([{ name: "報告書.xlsx", bytes }]);
    const an = s.analyze();
    expect(an.layouts[0]?.tables.length).toBe(2);
    expect(an.records.events.map((e) => [e.assetNames[0], e.tag, e.date?.d])).toEqual([
      ["ポンプ No.2", "P-2", 14],
      ["ポンプ No.2", "P-2", 16],
      ["ブロワ", "B-1", 14],
      ["ブロワ", "B-1", 16],
    ]);
  });

  test("号炉・機器・作業を 1 つのセルに書いた列（見出し「号炉・機器・作業内容」）：空白か括弧で分け、号機の書き方をそろえる。分けられないセルは聞く", async () => {
    expect(splitFlatWork("1号 No.2 BFP 分解整備")).toEqual({ unit: { kind: "number", n: 1, spelling: "{n}号" }, asset: "BFP No.2", work: "分解整備" });
    expect(splitFlatWork("—投入扉　3号機　動作確認")).toEqual({ unit: { kind: "common" }, asset: "投入扉 No.3", work: "動作確認" });
    expect(splitFlatWork("給じん装置（１号炉）点検整備")).toEqual({ unit: { kind: "number", n: 1, spelling: "{n}号炉" }, asset: "給じん装置", work: "点検整備" });
    expect(splitFlatWork("ﾄｳﾆｭｳﾄﾋﾞﾗ（共B号機）動作確認")).toEqual({ unit: { kind: "common" }, asset: "トウニュウトビラ B号機", work: "動作確認" });
    expect(splitFlatWork("ST 開放点検（定期検査）（部品交換）")?.work).toBe("開放点検(定期検査)(部品交換)");
    expect(splitFlatWork("活性炭供給ロータリーバルブ清掃")).toBeNull();
    const s = session();
    await s.add([{ name: "日報.csv", bytes: csv(["日付,号炉・機器・作業内容,人工", "2024/4/6,1号 No.2 ポンプ 分解整備,2", "2024/4/7,ブロワ（#2）給油,1", "2024/4/8,活性炭清掃,1"]) }]);
    const an = s.analyze();
    expect(an.records.events.slice(0, 2).map((e) => [e.assetNames[0], e.unit?.kind === "number" ? e.unit.n : null, e.workName])).toEqual([
      ["ポンプ No.2", 1, "分解整備"],
      ["ブロワ", 2, "給油"],
    ]);
    const q = an.open.find((x) => x.kind === "eventAsset" && x.options.length === 1);
    expect(q?.text).toContain("分けられない");
  });

  test("規則が読み手の読み方を止めたとき・同じ列に 2 つの役目の規則があるときは、要約の注記に出す（効かなかった規則は効いたセルに数えない）", async () => {
    const s = session();
    const rule = (id: string, role: "assetRef" | "workName") => ({ id, text: `「号炉・機器・作業内容」を${role}`, kind: "columnRole" as const, author: "ai" as const, reason: "試験", column: "号炉・機器・作業内容", role });
    s.setReadings([{ skill: { schema: "moyai.reading/0", name: "【架空】試験の読み方", scope: "facility", rules: [rule("a", "assetRef"), rule("w", "workName")] }, version: "draft", path: null, approved: false, draft: true }]);
    await s.add([{ name: "日報.csv", bytes: csv(["日付,号炉・機器・作業内容,人工", "2024/4/6,1号 No.2 ポンプ 分解整備,2", "2024/4/7,ブロワ（#2）給油,1"]) }]);
    const sv = s.survey();
    expect(sv.notes.some((n) => n.includes("分けて読んでいない") && n.includes("規則「a」"))).toBe(true);
    expect(sv.notes.some((n) => n.includes("規則「w」（workName）は効いていない"))).toBe(true);
    const an = s.analyze();
    expect(an.ruleHits.count("a")).toBeGreaterThan(0);
    expect(an.ruleHits.count("w")).toBe(0);
  });

  test("同じ機器の規則は、3 つ以上の呼び名を 1 つにまとめられる（どれも並びの最後の名前の機器。全角と半角の違いは書かなくてよい）", async () => {
    const s = session();
    s.setReadings([
      {
        skill: {
          schema: "moyai.reading/0",
          name: "【架空】試験の読み方",
          scope: "facility",
          rules: [{ id: "bfp", text: "「給水P」「BFP」「ボイラ給水ポンプ」は同じ機器", kind: "sameAsset", author: "human", by: "担当者", reason: "試験", names: ["給水P", "BFP", "ボイラ給水ポンプ"] }],
        },
        version: "draft",
        path: null,
        approved: false,
        draft: true,
      },
    ]);
    await s.add([{ name: "日報.csv", bytes: csv(["日付,機器,作業,工数(人日)", "2024/4/6,給水P,点検,1", "2024/4/7,BFP,給油,1", "2024/4/8,ﾎﾞｲﾗ給水ﾎﾟﾝﾌﾟ,点検,1", "2024/4/9,ブロワ,点検,1"]) }]);
    for (let i = 0; i < 4; i++) for (const x of s.analyze().open) s.settle([human(x.questionId, x.defaultAnswer ?? x.options.find((o) => o.id === "new")?.id ?? x.options[0]?.id ?? "")]);
    const c = s.compose();
    expect(c.plan?.assets.length).toBe(2);
    expect(s.analyze().ruleHits.count("bfp")).toBe(2);
  });

  test("日付の書き方の規則（月/日）は、日付の型のセルを壊さない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["点検日", "機器", "作業", "工数(人日)"]]);
      for (let k = 0; k < 2; k++) {
        ws.getCell(2 + k, 1).value = day(k);
        ws.getCell(2 + k, 1).numFmt = "m/d";
        rows(ws, 2 + k, [[null, "ポンプ", "点検", 1]]);
      }
    });
    const s = session();
    s.setReadings([
      {
        skill: { schema: "moyai.reading/0", name: "【架空】試験の読み方", scope: "facility", rules: [{ id: "d", text: "「点検日」は月/日", kind: "dateFormat", author: "ai", reason: "試験", column: "点検日", format: "md" }] },
        version: "draft",
        path: null,
        approved: false,
        draft: true,
      },
    ]);
    await s.add([{ name: "点検.xlsx", bytes }]);
    const an = s.analyze();
    expect(an.records.events.map((e) => (e.date ? `${e.date.y}-${e.date.m}-${e.date.d}` : null))).toEqual(["2021-4-1", "2021-4-2"]);
    expect(an.open.some((q) => q.kind === "dateUnknown")).toBe(false);
  });

  test("元号と年の数を 2 段に分けた年度の見出し（「令和」の段と「元・2・3」の段）の星取表。表に付けた凡例は要約に出る", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["No.", "機器名称", "実施年度"], [null, null, "令　和"], [null, null, "元", 2, 3], ["1", "ポンプ", "●", "●", "○"], ["2", "ブロワ", null, "●", "○"], [], [null, "凡例　○：計画　●：実施済"]]);
      ws.mergeCells("A1:A3");
      ws.mergeCells("B1:B3");
      ws.mergeCells("C1:E1");
      ws.mergeCells("C2:E2");
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const t = s.analyze().layouts[0]?.tables[0];
    expect(t?.shape).toBe("grid");
    expect(t?.cols.filter((c) => c.role === "mark").map((c) => c.fiscalYear)).toEqual([2019, 2020, 2021]);
    expect(s.survey().legends.map((l) => l.mark).sort()).toEqual(["○", "●"]);
  });

  test("機器の欄の無い台帳の件名から機器の名前を取る（発注台帳の xlsx と工事の一覧の CSV）：見本を添えて 1 回聞き、取ると未解決が無くなる", async () => {
    expect(assetFromTitle("R3年度 中央監視装置保守点検業務委託")).toEqual({ asset: "中央監視装置", work: "保守点検業務委託" });
    expect(assetFromTitle("計量機更新工事（R5年度）")).toEqual({ asset: "計量機", work: "更新工事" });
    expect(assetFromTitle("精密機能検査")?.asset).toBe("精密機能");
    expect(assetFromTitle("排ガスの測定について")).toBeNull();
    const ledger = await xlsxOf((ws) => {
      rows(ws, 1, [["番号", "件名", "契約日", "工期（自）", "工期（至）"], ["1", "R3年度 中央監視装置保守点検業務委託", "R3.4.1", "R3.4.1", "R4.3.31"], ["2", "1号炉 誘引送風機修繕工事", "R3.6.1", "R3.6.7", "R3.7.2"]]);
    });
    const works = csv(["工事名,着手,完了", "計量機更新工事（R5年度）,2023/9/1,2023/9/30", "ごみクレーン年次点検,2023/10/2,2023/10/3"]);
    for (const [name, bytes, want] of [
      ["台帳.xlsx", ledger, ["中央監視装置", "誘引送風機"]],
      ["工事.csv", works, ["計量機", "ごみクレーン"]],
    ] as const) {
      const s = session();
      await s.add([{ name, bytes }]);
      const before = [...s.compose().status.values()].filter((x) => x.s === "unresolved").length;
      const q = s.analyze().open.find((x) => x.kind === "eventAsset" && x.options.some((o) => o.id === "title"));
      expect(q?.text).toContain("→");
      s.settle([human(q?.questionId ?? "", "title")]);
      expect(s.analyze().records.events.map((e) => e.assetNames[0])).toEqual([...want]);
      const nw = s.analyze().open.find((x) => x.options.some((o) => o.id === "new"));
      if (nw) s.settle([human(nw.questionId, "new")]);
      acceptDefaults(s);
      const after = [...s.compose().status.values()].filter((x) => x.s === "unresolved").length;
      expect(before).toBeGreaterThan(0);
      expect(after).toBe(0);
    }
  });
});

describe("周期の列と費用の列（重-8b：作業ごとのきっかけを取り込みが置く）", () => {
  test("周期の書き方：年・月・年 N 回・数だけ（見出しの単位）。読めない書き方は null", () => {
    expect(parseCycle("1年", null)).toEqual({ years: 1 });
    expect(parseCycle("3Y", null)).toEqual({ years: 3 });
    expect(parseCycle("6か月", null)).toEqual({ months: 6 });
    expect(parseCycle("130M", null)).toEqual({ months: 130 });
    expect(parseCycle("24ヶ月", null)).toEqual({ years: 2 });
    expect(parseCycle("年4回", null)).toEqual({ months: 3 });
    expect(parseCycle("3", "years")).toEqual({ years: 3 });
    expect(parseCycle("0.5", "years")).toEqual({ months: 6 });
    expect(parseCycle("3", null)).toBeNull();
    expect(parseCycle("毎回", "years")).toBeNull();
    expect(parseCycle("年5回", null)).toBeNull();
    expect(cycleHeaderUnit("周期\n(年)")).toBe("years");
    expect(cycleHeaderUnit("周期（か月）")).toBe("months");
    expect(cycleHeaderUnit("周期")).toBeNull();
  });

  test("星取表（xlsx）：「周期(年)」は段にも号にもせず、その行の作業の暦のきっかけ。「概算費用」は段にせず作業明細の費用の欄に読む", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [
        ["機器", "作業内容", "周期\n(年)", "概算費用\n(千円/回)", "2024年度", "2025年度", "2026年度"],
        ["ポンプ", "分解整備", "3", "1200", "●", null, null],
        ["ブロワ", "定期点検", "1年", "300", "●", "●", "○"],
        [],
        [null, "凡例　○：計画　●：実施済"],
      ]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.cols.find((c) => c.header.startsWith("周期"))?.role).toBe("cycle");
    // 費用の列は作業明細の費用の欄に読む（運営者の決定 A 案、2026-11-06）。単位は見出し（千円）から。税の扱いは見出しに無いので聞く（既定は「資料に書いていない」）
    expect(t?.cols.find((c) => c.header.startsWith("概算費用"))?.role).toBe("cost");
    expect(an.open.some((q) => q.kind === "levelSplit")).toBe(false);
    expect(an.open.filter((q) => q.kind === "unitMissing").map((q) => q.defaultAnswer)).toEqual(["unknown"]);
    acceptDefaults(s);
    const c = s.compose();
    const trig = (asset: string) => {
      const a = c.plan?.assets.find((x) => x.name === asset);
      return c.plan?.works.find((w) => w.targets.includes(a?.nodeKey ?? ""))?.trigger;
    };
    expect(trig("ポンプ")).toEqual({ branches: [{ kind: "calendar", years: 3 }], combine: "earliest" });
    expect(trig("ブロワ")).toEqual({ branches: [{ kind: "calendar", years: 1 }], combine: "earliest" });
    // 費用は 1 回あたり（千円）を円にして、その行の印の作業明細に入れる
    const pumpKey = c.plan?.assets.find((x) => x.name === "ポンプ")?.nodeKey ?? "";
    const pumpWork = c.plan?.works.find((w) => w.targets.includes(pumpKey))?.workKey;
    expect(c.plan?.details.filter((d) => d.workKey === pumpWork).map((d) => d.cost)).toEqual([1_200_000]);
    expect([...c.status.values()].some((x) => x.s === "excluded" && x.reason.startsWith("費用の列"))).toBe(false);
  });

  test("作業の名前の見出し（「点検・整備内容」「点検・検査」「点検項目」）：星取表（xlsx）では機器の段でなくその行の作業、作業の一覧（CSV）では列の役目を聞かない", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["機器", "点検・整備内容", "周期\n(年)", "2024年度", "2025年度"], ["ポンプ", "分解整備", "3", "●", null], ["〃", "定期点検", "1", "●", "●"], [], [null, "凡例　○：計画　●：実施済"]]);
    });
    const s = session();
    await s.add([{ name: "星取表.xlsx", bytes }]);
    const t = s.analyze().layouts[0]?.tables[0];
    expect(t?.cols.find((c) => c.header === "点検・整備内容")?.role).toBe("workName");
    acceptDefaults(s);
    const c = s.compose();
    const pump = c.plan?.assets.find((a) => a.name === "ポンプ");
    expect(c.plan?.assets.map((a) => a.name)).toEqual(["ポンプ"]);
    expect(c.plan?.works.filter((w) => w.targets.includes(pump?.nodeKey ?? "")).map((w) => [w.kind, (w.trigger as { branches: unknown[] } | null)?.branches[0]])).toEqual([
      ["分解整備", { kind: "calendar", years: 3 }],
      ["定期点検", { kind: "calendar", years: 1 }],
    ]);
    for (const head of ["点検・検査", "点検項目"]) {
      const s2 = session();
      await s2.add([{ name: "一覧.csv", bytes: csv([`機器,${head},実施日,工数(人日)`, "ポンプ,分解整備,2024/4/6,1", "ブロワ,定期点検,2024/4/7,1"]) }]);
      const an = s2.analyze();
      expect(an.open.some((q) => q.kind === "columnRole")).toBe(false);
      expect(an.records.events.map((e) => e.workName)).toEqual(["分解整備", "定期点検"]);
    }
  });

  test("作業の記録（CSV）：「周期」の列の行の周期も作業のきっかけ。「毎回」は推し量らず聞き、置かないと答えたら周期なしで入れる", async () => {
    const s = session();
    await s.add([{ name: "点検.csv", bytes: csv(["機器,作業,周期,実施日,工数(人日),契約金額", "ポンプ,点検,年4回,2024/4/6,1,50000", "ブロワ,点検,毎回,2024/4/7,1,30000"]) }]);
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "columnRole")).toBe(false);
    const q = an.open.find((x) => x.kind === "yearUnknown" && x.text.includes("周期"));
    expect(q?.text).toContain("「毎回」");
    s.settle([human(q?.questionId ?? "", "none")]);
    for (let i = 0; i < 4; i++) for (const x of s.analyze().open) s.settle([human(x.questionId, x.defaultAnswer ?? x.options.find((o) => o.id === "new")?.id ?? x.options[0]?.id ?? "")]);
    const c = s.compose();
    expect(c.plan).not.toBeNull();
    const byAsset = (name: string) => c.plan?.works.find((w) => w.targets.includes(c.plan?.assets.find((a) => a.name === name)?.nodeKey ?? ""));
    expect(byAsset("ポンプ")?.trigger).toEqual({ branches: [{ kind: "calendar", months: 3 }], combine: "earliest" });
    expect(byAsset("ブロワ")?.trigger).toBeNull();
  });
});
