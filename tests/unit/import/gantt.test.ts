// 工程表（ガント）の施工の期間を読む（仕事 reader-gantt-v1）。
// 形 1：日の列の上に、施工の期間を線の図形で引く（描画の XML を zip に足して組む）。頁ごとのシートが何枚もある。
// 形 2：週の列のセルに、その週に施工した日数を数で書く。年度ごとのシート（「R3」「R4」）。号炉の見出しの行は週ごとの和、運転状況の行は塗りだけ。
// 資料はどれも試験の中で組む架空のもの。どの施設の資料の語にも依らない（語は packs/_cues/cues.json を変えていない）。
import { describe, expect, test } from "vitest";
import type { Analysis } from "../../../src/import";
import { datesOfTimes, hoursPerManDayInText, timeRun, GANTT_REASON } from "../../../src/import/gantt";
import type { GridCell } from "../../../src/import/grid";
import { DAY_FROM, DAY_TO, EFFORT_COL, PAGE_1, PAGE_2, R3, WEEKS, WEEK_FROM, lineBook, weekBook } from "./gantt-fixtures";
import { acceptDefaults, human, session } from "./helpers";

const LINE = "工程表_線.xlsx";
const WEEK = "工程表_週.xlsx";

const statusOf = (an: Analysis, file: string) => [...an.composition.status.entries()].filter(([k]) => k.startsWith(`${file}\u0000`)).map(([, v]) => v);
const unresolved = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved").length;
/** 質問の無い未解決のセル */
const silent = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved" && !v.questionId).length;
const reasons = (an: Analysis, file: string) => {
  const m = new Map<string, number>();
  for (const v of statusOf(an, file)) if (v.s === "excluded") m.set(v.reason, (m.get(v.reason) ?? 0) + 1);
  return m;
};
const statusAt = (an: Analysis, file: string, sheetIndex: number, ref: string) => an.composition.status.get(`${file}\u0000${sheetIndex}\u0000${ref}`);
const ganttTables = (an: Analysis) => an.layouts.flatMap((l) => l.tables).filter((t) => !!t.gantt);

async function opened(name: string, bytes: Uint8Array) {
  const s = session();
  await s.add([{ name, bytes }]);
  return s;
}

/** 頁の作業の行の数（形 1） */
const lineRows = (p: typeof PAGE_1) => p.groups.flatMap((g) => g.assets.flatMap((a) => a.works));

describe("層 1：描画の線の図形を格子の横に持つ", () => {
  test("線（cxnSp の prst=line）と字のある四角を、anchor の from・to のまま持つ。画像は持たない。セルの数は図形の無い同じ Excel と同じ", async () => {
    const withShapes = (await opened(LINE, await lineBook({ extraShapes: true }))).analyze();
    const without = (await opened(LINE, await lineBook({ noDrawing: true }))).analyze();
    const sheet = withShapes.sources[0]!.sheets[0]!;
    const shapes = sheet.shapes ?? [];
    const works = lineRows(PAGE_1);
    expect(shapes.filter((s) => s.kind === "line")).toHaveLength(works.length);
    // 線は同じ行の上（from と to の row が同じ）。名前は図形の名前
    const first = shapes.find((s) => s.name === "WorkLine_10")!;
    expect(first.kind).toBe("line");
    expect(first.from).toMatchObject({ col: DAY_FROM - 1, row: 9 });
    expect(first.to).toMatchObject({ col: DAY_FROM + 2, row: 9, colOff: 0 });
    // 字のある四角は字ごと持つ。画像は持たない
    const rect = shapes.find((s) => s.kind === "rect")!;
    expect(rect.text).toBe("【架空】メモ");
    expect(shapes.some((s) => s.name === "Logo")).toBe(false);
    const ledger = withShapes.sources[0]!.ledger;
    expect(ledger.find((e) => e.what === "drawnShape" && e.sheet === PAGE_1.sheet)?.detail).toContain(`描画の図形 ${works.length + 1}（線 ${works.length}）`);
    expect(ledger.find((e) => e.what === "picture" && e.sheet === PAGE_1.sheet)?.count).toBe(1);
    // 図形はセルではない：セルの数と中身は、図形の無い同じ Excel と同じ
    const cellsOf = (a: Analysis) => a.sources[0]!.sheets.map((g) => g.cells.map((c: GridCell) => `${c.ref}=${c.text}`));
    expect(cellsOf(withShapes)).toEqual(cellsOf(without));
    expect(statusOf(withShapes, LINE).length).toBe(statusOf(without, LINE).length);
  });

  test("図形の無い Excel は shapes を持たず、台帳に図形を書かない。線の無い作業の行の期間は推し量らず、2 枚をまとめた 1 問で聞く", async () => {
    const an = (await opened(LINE, await lineBook({ noDrawing: true }))).analyze();
    for (const g of an.sources[0]!.sheets) expect(g.shapes).toBeUndefined();
    expect(an.sources[0]!.ledger.some((e) => e.what === "drawnShape")).toBe(false);
    expect(an.records.events.filter((e) => e.date !== null)).toEqual([]);
    const qs = an.open.filter((q) => q.kind === "dateUnknown");
    expect(qs).toHaveLength(1);
    expect(qs[0]?.text).toContain(`施工の期間（行の上の線の図形・時の列の数）の無い作業の行がある（${lineRows(PAGE_1).length + lineRows(PAGE_2).length} 行）`);
    expect(silent(an, LINE)).toBe(0);
  });

  test("施工の期間の書き方（時の列の数・線）の無い表は、工程表として読まない（今までどおり）", async () => {
    // 時の列に字の印（■）だけを書いた表：印の意味を推し量らない
    const bytes = await weekBook();
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    for (const ws of wb.worksheets)
      ws.eachRow((row) =>
        row.eachCell((cell, c) => {
          if (c >= WEEK_FROM && typeof cell.value === "number") cell.value = "■";
        }),
      );
    const marked = new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
    const an = (await opened(WEEK, marked)).analyze();
    expect(ganttTables(an)).toEqual([]);
  });
});

describe("時の列を見分ける", () => {
  test("日付の並び：通し番号の日付が 1 日の間で並ぶ列は日の列。年の無い月/日が 7 日の間で並ぶ列は週の列。並ばない・短い並びは時の列にしない", () => {
    const cell = (c: number, value: number | string, numFmt = "General"): GridCell => ({ r: 1, c, ref: `X${c}`, value, text: String(value), type: typeof value === "number" ? "number" : "string", numFmt, formula: null, formulaNoCache: false, error: null, bold: false, indent: 0, leadingSpaces: 0, note: null });
    const days = Array.from({ length: 7 }, (_, i) => cell(5 + i, 33150 + i, "yyyy-mm-dd"));
    expect(timeRun([cell(1, "号炉"), ...days], false)?.step).toBe(1);
    expect(timeRun(days, false)?.times[0]?.ymd).toEqual({ y: 1990, m: 10, d: 4 });
    const weeks = ["3/29", "4/5", "4/12", "4/19", "4/26", "5/3"].map((t, i) => cell(9 + i, t));
    const w = timeRun(weeks, false);
    expect(w?.step).toBe(7);
    expect(w?.times.map((x) => x.ymd)).toEqual(weeks.map(() => null));
    // 年をまたぐ週（12/27 → 1/3）も 7 日の間
    expect(timeRun(["12/13", "12/20", "12/27", "1/3", "1/10"].map((t, i) => cell(9 + i, t)), false)?.step).toBe(7);
    // 間の違う並び・4 つまでの並びは時の列にしない
    expect(timeRun(["4/1", "4/5", "4/12", "4/19", "4/26"].map((t, i) => cell(9 + i, t)), false)).toBeNull();
    expect(timeRun(["4/5", "4/12", "4/19", "4/26"].map((t, i) => cell(9 + i, t)), false)).toBeNull();
  });

  test("年の無い月/日の年：年度と年度の始まりの月から補う（年度の始まりの前の週も、並びで同じ年）", () => {
    const times = ["3/29", "4/5", "4/12", "12/27", "1/3"].map((t, i) => {
      const [m, d] = t.split("/").map(Number);
      return { c: i + 1, ref: `A${i + 1}`, ymd: null, md: { m: m!, d: d! } };
    });
    // 並びが等しい間でないものは時の列にしないので、試験のために 7 日の並びを作る
    const seq = Array.from({ length: 6 }, (_, i) => {
      const dt = new Date(Date.UTC(2021, 2, 29 + 7 * i));
      return { c: i + 1, ref: `A${i + 1}`, ymd: null, md: { m: dt.getUTCMonth() + 1, d: dt.getUTCDate() } };
    });
    expect(datesOfTimes(seq, 2021, 4)?.[0]).toEqual({ y: 2021, m: 3, d: 29 });
    expect(datesOfTimes(seq, 2021, 4)?.[1]).toEqual({ y: 2021, m: 4, d: 5 });
    expect(datesOfTimes(times, 2021, 4)).toBeNull();
  });

  test("形 1：見出しの行の 1990-10-04〜1990-10-24 は日の列（21）。形 2：5 行目の「3/29」「4/5」… は週の列（53）、4 行目の月の見出しは上の段。年はシートの名前「R3」「R4」から補う", async () => {
    const line = (await opened(LINE, await lineBook())).analyze();
    const lt = ganttTables(line);
    expect(lt.map((t) => t.sheet)).toEqual([PAGE_1.sheet, PAGE_2.sheet]);
    const g1 = lt[0]!.gantt!;
    expect(g1.step).toBe(1);
    expect(g1.times.map((x) => x.c)).toEqual(Array.from({ length: DAY_TO - DAY_FROM + 1 }, (_, i) => DAY_FROM + i));
    expect(g1.times[0]?.ymd).toEqual({ y: 1990, m: 10, d: 4 });
    expect(lt[0]!.headerRows).toEqual([6]);
    expect(g1.hoursPerManDay?.hours).toBe(8);

    const week = (await opened(WEEK, await weekBook())).analyze();
    const wt = ganttTables(week);
    expect(wt.map((t) => t.sheet)).toEqual(["R3", "R4"]);
    const g2 = wt[0]!.gantt!;
    expect(g2.step).toBe(7);
    expect(g2.times).toHaveLength(WEEKS);
    expect(g2.times[0]).toMatchObject({ c: WEEK_FROM, ymd: null, md: { m: 3, d: 29 } });
    expect(g2.yearHint).toMatchObject({ fiscalYear: 2021, from: "sheet" });
    expect(wt[1]!.gantt!.yearHint).toMatchObject({ fiscalYear: 2022, from: "sheet" });
    expect(wt[0]!.headerRows).toEqual([4, 5]);
    expect(g2.monthRow).toBe(4);
    // 月の見出しの段は理由つきで外す（時の列の上の段）
    const months = g2.monthRefs.length + wt[1]!.gantt!.monthRefs.length;
    expect(months).toBeGreaterThanOrEqual(24);
    expect(reasons(week, WEEK).get(GANTT_REASON.month)).toBe(months);
    // 年を補った日：最初の週は 2021-03-29（年度の始まりの前の週）、施工の期間はその日から
    const first = week.records.events.filter((e) => e.sheet === "R3").map((e) => e.date);
    expect(first.every((d) => d && d.y === 2021)).toBe(true);
  });

  test("日の列の下の曜日の段は見出しの段（記録にしない）", async () => {
    const s = await opened(LINE, await lineBook({ weekdays: true }));
    const an0 = s.analyze();
    expect(ganttTables(an0).map((t) => t.headerRows)).toEqual([
      [6, 7],
      [6, 7],
    ]);
    acceptDefaults(s);
    const an = s.analyze();
    expect(unresolved(an, LINE)).toBe(0);
    expect(statusAt(an, LINE, 0, "E7")).toEqual({ s: "excluded", reason: "見出し（読み方に使った）" });
    expect(an.composition.plan?.details.length).toBe(lineRows(PAGE_1).length + lineRows(PAGE_2).length);
  });

  test("シートの名前にも題にも年度が無い年の無い月/日は、年度を 1 問（表ごと）で聞く。答えると年が決まり、未解決が残らない", async () => {
    const s = await opened(WEEK, await weekBook({ noYear: true }));
    const an = s.analyze();
    const qs = an.open.filter((q) => q.kind === "yearUnknown");
    expect(qs).toHaveLength(2);
    expect(qs[0]?.defaultAnswer).toBeNull();
    expect(silent(an, WEEK)).toBe(0);
    s.settle([human(qs[0]!.questionId, "2021"), human(qs[1]!.questionId, "2022")]);
    acceptDefaults(s);
    const after = s.analyze();
    expect(unresolved(after, WEEK)).toBe(0);
    expect(after.records.events.filter((e) => e.sheet?.endsWith("1")).every((e) => e.fiscalYear === 2021)).toBe(true);
  });
});

describe("施工の期間・実績・工数", () => {
  test("形 1：作業の行の上の線の from の列から to の列までの日が施工の期間。人工計は人・日（題の注記「人工＝8時間」は 1 人・日の時間）。年度の値は実績", async () => {
    const s = await opened(LINE, await lineBook());
    acceptDefaults(s);
    const an = s.analyze();
    const ev = an.records.events.filter((e) => e.sheet === PAGE_1.sheet);
    expect(ev).toHaveLength(lineRows(PAGE_1).length);
    const day = (c: number) => ({ y: 1990, m: 10, d: 4 + (c - DAY_FROM) });
    lineRows(PAGE_1).forEach((w, i) => {
      const e = ev[i]!;
      expect(e.workName).toBe(w.work);
      expect(e.date).toEqual(day(w.from));
      expect(e.end).toEqual(day(w.to));
      expect(e.days).toBe(w.to - w.from + 1);
      expect(e.manDays).toBe(w.effort);
      expect(e.fiscalYear).toBe(1990);
      expect(e.planOrActual).toBeUndefined();
      expect(e.assetId).toBeTruthy();
    });
    // 機器の名前の行の作業の番号（E9）は、その機器の下の作業の行の備考
    expect(ev[0]?.lineRemark).toBe("W1990-00005");
    const plan = an.composition.plan!;
    const d = plan.details.find((x) => x.lines?.some((l) => l.content === "初期状態確認"))!;
    expect(d.planOrActual).toBe("actual");
    expect([d.startDate, d.endDate, d.manDays, d.days]).toEqual(["1990-10-04", "1990-10-06", 6, 3]);
    // 機器は「1号炉 廃熱ボイラ」→ 系列 1 の「廃熱ボイラ」。上の段は設備「ボイラ・給水」（号炉の見出しは系列の手がかり）
    const target = plan.works.find((w) => w.workKey === d.workKey)?.targets[0];
    const asset = plan.assets.find((a) => a.nodeKey === target)!;
    expect([asset.name, asset.series, asset.level]).toEqual(["廃熱ボイラ", "1", 2]);
    expect(plan.assets.find((a) => a.nodeKey === asset.parentKey)?.name).toBe("ボイラ・給水");
  });

  test("形 2：週の列の数のある列の続く並びを 1 つの期間にし、飛んだ週は別の期間。終わりは週の終わり、数は期間の中の施工の日数。延べ人工は人・日", async () => {
    const s = await opened(WEEK, await weekBook());
    acceptDefaults(s);
    const an = s.analyze();
    // G-203：週 8・9（続く）と週 38（飛ぶ）
    const ev = an.records.events.filter((e) => e.sheet === "R3" && e.tag === "G-203");
    expect(ev.map((e) => [e.date, e.end, e.days])).toEqual([
      [{ y: 2021, m: 5, d: 24 }, { y: 2021, m: 6, d: 6 }, 3],
      [{ y: 2021, m: 12, d: 20 }, { y: 2021, m: 12, d: 26 }, 1],
    ]);
    // 行の工数は最初の期間に置き、期間に割り振らない
    expect(ev.map((e) => e.manDays)).toEqual([19, null]);
    expect(ev.every((e) => e.fiscalYear === 2021 && e.planOrActual === undefined)).toBe(true);
    const plan = an.composition.plan!;
    const g203 = plan.assets.find((a) => a.tag === "G-203")!;
    const w = plan.works.find((x) => x.targets.includes(g203.nodeKey))!;
    const d = plan.details.find((x) => x.workKey === w.workKey && x.fiscalYear === 2021)!;
    expect([d.planOrActual, d.startDate, d.endDate, d.manDays, d.days]).toEqual(["actual", "2021-05-24", "2021-12-26", 19, 4]);
    expect(d.lines?.map((l) => [l.date, l.days, l.manDays])).toEqual([
      ["2021-05-24", 3, 19],
      ["2021-12-20", 1, null],
    ]);
    // 業者の列は作業明細の備考。号炉は見出しの「■ 1号炉」と号炉の記載の列から系列 1
    expect(d.lines?.[0]?.remark).toContain("業者：【架空】架空プラント工業㈱");
    expect(g203.series).toBe("1");
    // 2 号炉の給じん装置は別の機器（系列 2）
    expect(plan.assets.filter((a) => a.name === "給じん装置").map((a) => a.series).sort()).toEqual(["1", "2"]);
  });

  test("工数を時間で書いた工程表（「延べ時間」）は、題・注記の「1人工＝8時間」で人・日に直す。1 人・日の時間を聞かない", async () => {
    expect(hoursPerManDayInText("人工＝8時間。協力会社作業と現場管理監督を別計。")).toBe(8);
    expect(hoursPerManDayInText("1人日=7.5h")).toBe(7.5);
    expect(hoursPerManDayInText("8時間")).toBeNull();
    const s = await opened(WEEK, await weekBook({ hours: true }));
    const an = s.analyze();
    expect(an.open.some((q) => q.kind === "hoursPerManDay")).toBe(false);
    acceptDefaults(s);
    const after = s.analyze();
    const byTag = (tag: string) => after.records.events.find((e) => e.sheet === "R3" && e.tag === tag);
    expect(byTag("H-203")?.manDays).toBe(R3.units[0]!.rows[0]!.effort);
    expect(byTag("F-221")?.manDays).toBe(24);
    expect(unresolved(after, WEEK)).toBe(0);
  });
});

describe("合計の行・月の見出し・運転状況の行を、理由つきで外す", () => {
  test("形 1：下に並べた「本頁 協力会社計」「本頁 現場管理計」は、日ごとの人工（作業の行の人工を施工の日に割り振った和）と人工計が並んだ行の和と合うので外す", async () => {
    const an = (await opened(LINE, await lineBook())).analyze();
    const per = DAY_TO - DAY_FROM + 1 + 2; // 日の列＋人工計＋名前
    expect(reasons(an, LINE).get(GANTT_REASON.subtotal)).toBe(per * 2 * 2);
    const sumRows = ganttTables(an)[0]!.gantt!.rows.filter((x) => x.kind === "sum").map((x) => x.r);
    expect(sumRows).toHaveLength(2);
    expect(statusAt(an, LINE, 0, `Z${sumRows[0]}`)).toEqual({ s: "excluded", reason: GANTT_REASON.subtotal });
    expect(an.open.some((q) => q.kind === "subtotalMismatch")).toBe(false);
  });

  test("形 1：日ごとの数が合わなければ、今の小計の食い違いの問い（subtotalMismatch）。外すと答えると、理由つきで外れる", async () => {
    const s = await opened(LINE, await lineBook({ mismatch: true }));
    const an = s.analyze();
    const qs = an.open.filter((q) => q.kind === "subtotalMismatch");
    expect(qs).toHaveLength(2);
    expect(qs[0]?.text).toContain("1 列が、表の中身から数えた値と合わない");
    // 頁 1 の「本頁 協力会社計」は 20 行目、頁 2 は 12 行目。合わないのは最初の日の列（E）
    expect(qs.map((q) => q.items[0]?.cells)).toEqual([["E20"], ["E12"]]);
    expect(silent(an, LINE)).toBe(0);
    s.settle(qs.map((q) => human(q.questionId, "exclude")));
    acceptDefaults(s);
    const after = s.analyze();
    expect(unresolved(after, LINE)).toBe(0);
    expect(reasons(after, LINE).get(GANTT_REASON.subtotalMismatch)).toBe((DAY_TO - DAY_FROM + 1 + 2) * 2 * 2);
  });

  test("形 2：号炉の見出しの行の数（日数・延べ人工・週ごとの日数）は下の機器の行の和と合うので外し、見出しの字は号炉の手がかり（機器の出どころ）。運転状況の行は停止の期間の帯", async () => {
    const an = (await opened(WEEK, await weekBook())).analyze();
    const g = ganttTables(an)[0]!.gantt!;
    const head = g.rows.find((x) => x.kind === "unit")!;
    expect(head.r).toBe(6);
    expect(statusAt(an, WEEK, 0, "H6")).toEqual({ s: "excluded", reason: GANTT_REASON.subtotal });
    expect(statusAt(an, WEEK, 0, "G6")).toEqual({ s: "excluded", reason: GANTT_REASON.subtotal });
    expect(statusAt(an, WEEK, 0, "P6")).toEqual({ s: "excluded", reason: GANTT_REASON.subtotal });
    expect(g.rows.filter((x) => x.kind === "band").map((x) => x.r)).toEqual([7, 13]);
    expect(statusAt(an, WEEK, 0, "A7")).toEqual({ s: "excluded", reason: GANTT_REASON.band });
    expect(reasons(an, WEEK).get(GANTT_REASON.band)).toBe(3);
    // 見出しの字は、答えたあとの計画で機器の出どころ（データ）
    const s = await opened(WEEK, await weekBook());
    acceptDefaults(s);
    expect(statusAt(s.analyze(), WEEK, 0, "A6")?.s).toBe("data");
  });

  test("形 2：見出しの行の延べ人工が下の行の和と合わなければ、小計の食い違いの問い", async () => {
    const an = (await opened(WEEK, await weekBook({ mismatch: true }))).analyze();
    const qs = an.open.filter((q) => q.kind === "subtotalMismatch");
    expect(qs.length).toBe(3);
    expect(qs.every((q) => q.items[0]?.cells.every((c) => c.startsWith("H")))).toBe(true);
    expect(silent(an, WEEK)).toBe(0);
  });
});

describe("頁のシートを 1 つの様式として聞く", () => {
  test("同じ見出しの頁のシートは同じ様式。題の「予定」の語の確かめは、2 枚をまとめた 1 問（既定は予定）。答えると年度の値は予定で、作業明細にしない", async () => {
    const s = await opened(LINE, await lineBook({ plan: true }));
    const an = s.analyze();
    const tables = ganttTables(an);
    expect(new Set(tables.map((t) => an.records.formOf.get(t.id)?.key)).size).toBe(1);
    const qs = an.open.filter((q) => q.kind === "planActualUnknown");
    expect(qs).toHaveLength(1);
    expect(qs[0]?.defaultAnswer).toBe("plan");
    expect(qs[0]?.text).toContain("「予定」");
    expect(new Set(qs[0]?.items.map((i) => i.sheet))).toEqual(new Set([PAGE_1.sheet, PAGE_2.sheet]));
    expect(silent(an, LINE)).toBe(0);
    acceptDefaults(s);
    const plan = s.analyze().composition.plan!;
    expect(plan.details.length).toBe(lineRows(PAGE_1).length + lineRows(PAGE_2).length);
    expect(plan.details.every((d) => d.planOrActual === "plan" && !d.lines)).toBe(true);
  });
});

describe("1 冊で計画まで作る", () => {
  test.each([
    [LINE, () => lineBook()],
    [WEEK, () => weekBook()],
  ])("%s：質問の無い未解決のセルが無く、既定の答えのあと未解決が 0。機器・作業・作業の年度の値・作業明細ができる", async (name, make) => {
    const s = await opened(name, await make());
    const an0 = s.analyze();
    expect(silent(an0, name)).toBe(0);
    acceptDefaults(s);
    const an = s.analyze();
    expect(unresolved(an, name)).toBe(0);
    expect(an.composition.blockers).toEqual([]);
    const plan = an.composition.plan!;
    expect(plan).not.toBeNull();
    expect(plan.assets.length).toBeGreaterThan(0);
    expect(plan.works.length).toBeGreaterThan(0);
    expect(plan.details.length).toBeGreaterThan(0);
    expect(plan.details.every((d) => (d.lines?.length ?? 0) > 0)).toBe(true);
    // 入れた行＝取り込んだ数＋外した数
    expect(an.composition.counts.find((c) => c.file === name)?.holds).toBe(true);
    // 要約の注記：工程表として読んだ（値は渡さない）
    const notes = s.survey(an).notes.filter((n) => n.includes("工程表として読んだ"));
    expect(notes.length).toBe(2);
    expect(JSON.stringify(notes)).not.toContain("架空プラント");
  });

  test("同じ冊の 2 列の対応表のシートは今どおりに読み（工程表にしない）、計画を止めない", async () => {
    const s = await opened(WEEK, await weekBook({ mapSheet: true }));
    const an0 = s.analyze();
    expect(an0.layouts.find((l) => l.sheet === "読替")?.tables.some((t) => !!t.gantt)).toBe(false);
    expect(silent(an0, WEEK)).toBe(0);
    acceptDefaults(s);
    const an = s.analyze();
    expect(unresolved(an, WEEK)).toBe(0);
    expect(an.composition.plan).not.toBeNull();
  });

  test("形 2 の数：作業の年度の値は、機器の行（週に数のある行）ごとに 1 つ。工数と日数は行の延べ人工と週の数の和", async () => {
    const s = await opened(WEEK, await weekBook());
    acceptDefaults(s);
    const plan = s.analyze().composition.plan!;
    const r3 = plan.details.filter((d) => d.fiscalYear === 2021);
    const rows = R3.units.flatMap((u) => u.rows);
    expect(r3).toHaveLength(rows.length);
    expect(r3.reduce((a, d) => a + (d.manDays ?? 0), 0)).toBe(rows.reduce((a, x) => a + x.effort, 0));
    expect(r3.reduce((a, d) => a + (d.days ?? 0), 0)).toBe(rows.reduce((a, x) => a + Object.values(x.weeks).reduce((p, q) => p + q, 0), 0));
  });

  test("形 1 の人工計の列：作業の行の人工の和が、頁の合計と同じ（工数を落とさない）", async () => {
    const s = await opened(LINE, await lineBook());
    acceptDefaults(s);
    const plan = s.analyze().composition.plan!;
    const all = [...lineRows(PAGE_1), ...lineRows(PAGE_2)];
    expect(plan.details.reduce((a, d) => a + (d.manDays ?? 0), 0)).toBe(all.reduce((a, w) => a + w.effort, 0));
    expect(EFFORT_COL).toBe(DAY_TO + 1);
  });
});
