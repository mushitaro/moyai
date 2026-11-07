// 作業日報の工数の一般の書き方（ops/tasks/intake-effort-v1）：人数（職種ごとの列・人数の並び）× 作業時間の幅 ÷ 1 人・日の時間。
// 資料はどれも試験の中で組む架空のもの。どの施設の語にも依らない（職種の語は packs/_cues/cues.json の手がかり）。
import { describe, expect, test } from "vitest";
import type { IntakeSession } from "../../../src/import";
import { READING_SCHEMA } from "../../../src/import/reading";
import { lunchOverlap, parsePersons, parseTimeSpan } from "../../../src/import/text";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const enc = new TextEncoder();
const csv = (lines: string[]) => enc.encode(`${lines.join("\r\n")}\r\n`);

describe("人数と作業時間の幅の書き方を読む", () => {
  test("人数の並び：職種の語＋数・略した職種の 1 字＋数・「計 n 名（…）」は n・数だけ", () => {
    expect(parsePersons("機械工1 溶接工1 作業員2")?.n).toBe(4);
    expect(parsePersons("機械工3")?.n).toBe(3);
    expect(parsePersons("機2")?.n).toBe(2);
    expect(parsePersons("計4名（機械工3）")?.n).toBe(4);
    expect(parsePersons("計1名（作業員1）")?.n).toBe(1);
    expect(parsePersons("作業員2")?.n).toBe(2);
    expect(parsePersons("鳶工2、電工1")?.n).toBe(3);
    expect(parsePersons("保温工１名・作業員２名")?.n).toBe(3);
    expect(parsePersons("4名")?.n).toBe(4);
    expect(parsePersons(3)?.n).toBe(3);
  });

  test("職種の語に無い語・略として決まらない字・人数でない文は読まない（推し量らない）", () => {
    expect(parsePersons("塗装工2")).toBeNull();
    expect(parsePersons("職員2 業者3")).toBeNull();
    expect(parsePersons("塗2")).toBeNull();
    expect(parsePersons("機械工")).toBeNull();
    expect(parsePersons("延べ4人")).toBeNull();
    expect(parsePersons("若干名")).toBeNull();
    expect(parsePersons(1.5)).toBeNull();
  });

  test("作業時間の幅：全角・半角の波線とハイフン。昼休みは引かない。夜をまたぐ・時刻でないものは読まない", () => {
    expect(parseTimeSpan("9:00～12:00")?.hours).toBe(3);
    expect(parseTimeSpan("8:30～17:00")?.hours).toBe(8.5);
    expect(parseTimeSpan("8:30-17:00")?.hours).toBe(8.5);
    expect(parseTimeSpan("13:00～17:00")?.hours).toBe(4);
    expect(parseTimeSpan("8:30〜17:00")?.hours).toBe(8.5);
    expect(parseTimeSpan("8:30~17:00")?.hours).toBe(8.5);
    expect(parseTimeSpan("8:30－17:00")?.hours).toBe(8.5);
    expect(parseTimeSpan("８：３０ ～ １７：００")?.hours).toBe(8.5);
    expect(parseTimeSpan("22:00～6:00")).toBeNull();
    expect(parseTimeSpan("9:75～12:00")).toBeNull();
    expect(parseTimeSpan("終日")).toBeNull();
    expect(parseTimeSpan("3.0")).toBeNull();
  });

  test("昼休み（12:00 から n 時間）と幅の重なり", () => {
    const sp = (s: string) => parseTimeSpan(s)!;
    expect(lunchOverlap(sp("8:30～17:00"), 1)).toBe(1);
    expect(lunchOverlap(sp("9:00～12:00"), 1)).toBe(0);
    expect(lunchOverlap(sp("13:00～17:00"), 1)).toBe(0);
    expect(lunchOverlap(sp("12:30～17:00"), 1)).toBe(0.5);
  });
});

// 形 A：1 日 1 枚の帳票。頭書きに日付、見出しは 1 段、作業人員の欄に人数の並び
const formA = (people: string[], spans: (string | null)[], personsHeader = "作業人員") =>
  xlsxOf((ws) => {
    rows(ws, 1, [["【架空】作業日報"], ["日付", "2026/04/06"], []]);
    rows(ws, 4, [["No.", "号炉", "作業場所", "作業内容", "業者名", personsHeader, "作業時間"]]);
    rows(
      ws,
      5,
      people.map((p, i) => [i + 1, `${(i % 2) + 1}号炉`, "炉室", `【架空】機器${i + 1} 点検`, "【架空】甲社", p, spans[i] ?? null]),
    );
  }, "4月6日");

// 形 B：見出しが 2 段。上の段「職種別人員（人）」の下に職種ごとの列（空欄は 0）
const TRADES = ["鳶工", "機械工", "溶接工", "電工", "保温工", "作業員", "その他"];
const formB = (people: (number | string | null)[][], spans: (string | null)[]) =>
  xlsxOf((ws) => {
    rows(ws, 1, [["【架空】作業日報"], ["日付", "2026/04/07"], []]);
    const top = ["No.", "号炉", "系統", "No.", "設備", "機器", "作業内容", "施工業者", "職種別人員（人）", null, null, null, null, null, null, "作業時間", "備考"];
    rows(ws, 4, [top, [null, null, null, null, null, null, null, null, ...TRADES, null, null]]);
    for (const c of ["A", "B", "C", "D", "E", "F", "G", "H", "P", "Q"]) ws.mergeCells(`${c}4:${c}5`);
    ws.mergeCells("I4:O4");
    rows(
      ws,
      6,
      people.map((p, i) => [i + 1, `${(i % 2) + 1}号炉`, "燃焼", i + 1, "【架空】燃焼設備", `【架空】機器${i + 1}`, "点検", "【架空】乙社", ...TRADES.map((_, j) => p[j] ?? null), spans[i] ?? null, null]),
    );
  }, "4月7日");

const effortQs = (s: IntakeSession) => s.analyze().open.filter((q) => q.kind === "effortUnknown" || q.kind === "hoursPerManDay");
const lunchQ = (s: IntakeSession) => s.analyze().open.find((q) => q.kind === "effortUnknown" && q.options.some((o) => o.id === "noon"));
const manDaysOf = (s: IntakeSession, file: string) =>
  s
    .analyze()
    .records.events.filter((e) => e.file === file)
    .sort((a, b) => a.row - b.row)
    .map((e) => e.manDays);

describe("形 A：人数の並び × 作業時間の幅", () => {
  const people = ["機械工1 溶接工1 作業員2", "機械工3", "機2", "計4名（機械工3）", "計1名（作業員1）", "作業員2"];
  const spans = ["9:00～12:00", "8:30～17:00", "8:30-17:00", "13:00～17:00", "9:00～12:00", "8:30～17:00"];

  test("どの値も読め、工数の行ごとの問いは出ない。昼休みの問い（既定の答えなし）と 1 人・日の時間の問い（既定 8）だけが出る", async () => {
    const s = session();
    await s.add([{ name: "日報A.xlsx", bytes: await formA(people, spans) }]);
    const t = s.analyze().layouts.find((l) => l.file === "日報A.xlsx")?.tables[0];
    expect(t?.shape).toBe("events");
    expect(t?.cols.find((c) => c.header === "作業人員")?.cue).toBe("persons");
    expect(t?.cols.find((c) => c.header === "作業時間")?.role).toBe("effort");
    const qs = effortQs(s);
    expect(qs.map((q) => q.kind).sort()).toEqual(["effortUnknown", "hoursPerManDay"]);
    const lunch = lunchQ(s);
    expect(lunch?.text).toContain("作業時間の幅に昼休みを含むか");
    expect(lunch?.defaultAnswer).toBeNull();
    expect(lunch?.sameShapeRows).toBe(6);
    expect(lunch?.items[0]?.note).toBe("人数 4・幅 9:00～12:00");
    expect(qs.find((q) => q.kind === "hoursPerManDay")?.defaultAnswer).toBe("8");
    // 答えるまで工数は決めない
    expect(manDaysOf(s, "日報A.xlsx")).toEqual([null, null, null, null, null, null]);
    expect(s.analyze().records.events.every((e) => e.effortPending)).toBe(true);
  });

  test("昼休みを含まない・1 人・日 8 時間：工数＝人数 × 幅の時間 ÷ 8", async () => {
    const s = session();
    await s.add([{ name: "日報A.xlsx", bytes: await formA(people, spans) }]);
    s.settle([human(lunchQ(s)!.questionId, "no")]);
    acceptDefaults(s);
    expect(manDaysOf(s, "日報A.xlsx")).toEqual([(4 * 3) / 8, (3 * 8.5) / 8, (2 * 8.5) / 8, (4 * 4) / 8, (1 * 3) / 8, (2 * 8.5) / 8]);
    expect(effortQs(s)).toEqual([]);
  });

  test("昼休みを含む（12:00 から 1 時間）：重なる幅だけから引く。1 行 1 日と答えれば人数が人・日", async () => {
    const s = session();
    await s.add([{ name: "日報A.xlsx", bytes: await formA(people, spans) }]);
    s.settle([human(lunchQ(s)!.questionId, "noon")]);
    const hoursQ = s.analyze().open.find((q) => q.kind === "effortUnknown" && q.valueKind === "number");
    expect(hoursQ?.text).toContain("昼休みは 12:00 から何時間か");
    expect(hoursQ?.defaultAnswer).toBeNull();
    s.settle([human(hoursQ!.questionId, "1")]);
    acceptDefaults(s);
    expect(manDaysOf(s, "日報A.xlsx")).toEqual([(4 * 3) / 8, (3 * 7.5) / 8, (2 * 7.5) / 8, (4 * 4) / 8, (1 * 3) / 8, (2 * 7.5) / 8]);

    const d = session();
    await d.add([{ name: "日報A.xlsx", bytes: await formA(people, spans) }]);
    d.settle([human(lunchQ(d)!.questionId, "perDay")]);
    expect(d.analyze().open.filter((q) => q.kind === "hoursPerManDay")).toEqual([]);
    expect(manDaysOf(d, "日報A.xlsx")).toEqual([4, 3, 2, 4, 1, 2]);
  });

  test("1 人・日の時間は今の問いの答えで決まる（7.5 時間なら 7.5 で割る）", async () => {
    const s = session();
    await s.add([{ name: "日報A.xlsx", bytes: await formA(["機械工3"], ["8:30～17:00"]) }]);
    s.settle([human(lunchQ(s)!.questionId, "no")]);
    const h = s.analyze().open.find((q) => q.kind === "hoursPerManDay");
    expect(h?.text).toContain("1 人・日を何時間として人・日に直すか");
    s.settle([human(h!.questionId, "7.5")]);
    expect(manDaysOf(s, "日報A.xlsx")).toEqual([(3 * 8.5) / 7.5]);
  });

  test("1 人・日の時間と昼休みは、読み方のルール（決まった答え）でも決まる", async () => {
    const s = session();
    await s.add([{ name: "日報A.xlsx", bytes: await formA(["機械工3", "作業員2"], ["8:30～17:00", "9:00～12:00"]) }]);
    const base = { author: "human" as const, reason: "利用者が会話で決めた" };
    s.setReadings([
      {
        skill: {
          schema: READING_SCHEMA,
          name: "【架空】甲工場の読み方",
          scope: "facility",
          rules: [
            { ...base, id: "h1", text: "「1 人・日を何時間」と聞かれたら、いつも 7.5", kind: "answer", question: "hoursPerManDay", match: "人・日", answer: "7.5" },
            { ...base, id: "l1", text: "作業時間の幅は昼休みを含まないとして読む", kind: "answer", question: "effortUnknown", match: "作業時間の幅に昼休みを含むか", answer: "no" },
          ],
        },
        version: "a1b2c3d4e5f6",
        path: null,
        approved: false,
        draft: true,
      },
    ]);
    expect(effortQs(s)).toEqual([]);
    expect(manDaysOf(s, "日報A.xlsx")).toEqual([(3 * 8.5) / 7.5, (2 * 3) / 7.5]);
  });

  test("読めない書き方だけが今どおり質問に残る：人数の読めない書き方・時刻でない作業時間・人数だけで時間の無い行", async () => {
    const s = session();
    await s.add([{ name: "日報A.xlsx", bytes: await formA([...people, "塗装工2", "作業員1", "機械工2"], [...spans, "9:00～12:00", "終日", null]) }]);
    const qs = effortQs(s);
    const texts = qs.map((q) => q.text);
    // 人数の書き方が読めない行（書き方ごとに 1 問）
    expect(texts.filter((x) => x.includes("人数の書き方が読めない"))).toEqual(["「作業人員」の欄の人数の書き方が読めない（1 行、見本「塗装工2」）。人数を推し量らない"]);
    // 作業時間が時刻の幅でない行（今どおりの問い）
    expect(texts.filter((x) => x.startsWith("工数の書き方が読めない"))).toEqual(["工数の書き方が読めない（1 行）"]);
    // 人数だけで時間の無い行：人数を人・日の数としない（聞く。既定の答えなし）
    const noTime = qs.find((q) => q.text.includes("作業時間が書いていない"));
    expect(noTime?.defaultAnswer).toBeNull();
    expect(noTime?.sameShapeRows).toBe(1);
    expect(noTime?.options.map((o) => o.id)).toEqual(["perDay", "exclude"]);
    // ほかは昼休みの問いと 1 人・日の時間の問い
    expect(qs.length).toBe(5);
    expect(lunchQ(s)?.sameShapeRows).toBe(6);
    // 読めた行は答えで決まり、読めない行は答えるまで未解決
    s.settle([human(lunchQ(s)!.questionId, "no")]);
    acceptDefaults(s);
    const md = manDaysOf(s, "日報A.xlsx");
    expect(md.slice(0, 6)).toEqual([(4 * 3) / 8, (3 * 8.5) / 8, (2 * 8.5) / 8, (4 * 4) / 8, (1 * 3) / 8, (2 * 8.5) / 8]);
    expect(md.slice(6)).toEqual([null, null, null]);
    const ev = s.analyze().records.events.filter((e) => e.file === "日報A.xlsx").sort((a, b) => a.row - b.row);
    expect(ev.slice(6).map((e) => e.effortPending)).toEqual([false, false, true]);
    expect([...s.analyze().records.pending].some((k) => k.endsWith("F11"))).toBe(true);
    // 外すと答えれば、理由を残して外す
    s.settle(effortQs(s).filter((q) => q.options.some((o) => o.id === "exclude")).map((q) => human(q.questionId, "exclude")));
    expect(effortQs(s)).toEqual([]);
    const ex = s.analyze().records.excluded;
    expect([...ex.entries()].filter(([k]) => /\u0000(F11|G11|G12|F13)$/.test(k)).map(([, v]) => v).length).toBe(4);
  });
});

describe("形 B：職種ごとの列の和 × 作業時間の幅", () => {
  // 鳶工・機械工・溶接工・電工・保温工・作業員・その他
  const people = [
    [null, 1, null, null, null, 2, null],
    [2, null, 1, null, null, null, 1],
    [null, null, null, 1, null, null, null],
    [null, 2, null, null, 1, 3, null],
  ];
  const spans = ["8:30～17:00", "9:00～12:00", "8:30～17:00", "9:00～12:00"];

  test("上の段が「…人員（人）」の下の段の列を人数の列として足し、1 人・日 8 時間で人・日にする", async () => {
    const s = session();
    await s.add([{ name: "日報B.xlsx", bytes: await formB(people, spans) }]);
    const t = s.analyze().layouts.find((l) => l.file === "日報B.xlsx")?.tables[0];
    expect(t?.headerRows).toEqual([4, 5]);
    expect(t?.cols.filter((c) => c.cue === "persons").map((c) => c.headerParts[1])).toEqual(TRADES);
    const qs = effortQs(s);
    expect(qs.map((q) => q.kind).sort()).toEqual(["effortUnknown", "hoursPerManDay"]);
    expect(lunchQ(s)?.text).toContain("作業時間の幅に昼休みを含むか");
    expect(lunchQ(s)?.defaultAnswer).toBeNull();
    // 見本は幅の書き方の違う行（同じ幅の 3 行目は見本にしない）
    expect(lunchQ(s)?.items.map((it) => it.note)).toEqual(["人数 3・幅 8:30～17:00", "人数 4・幅 9:00～12:00"]);
    s.settle([human(lunchQ(s)!.questionId, "no")]);
    acceptDefaults(s);
    expect(manDaysOf(s, "日報B.xlsx")).toEqual([(3 * 8.5) / 8, (4 * 3) / 8, (1 * 8.5) / 8, (6 * 3) / 8]);
    expect(effortQs(s)).toEqual([]);
  });

  test("人数の列が空の行・数でない人数の行は読めない書き方として今どおり聞く", async () => {
    const s = session();
    await s.add([{ name: "日報B.xlsx", bytes: await formB([...people, [], [null, "応援"]], [...spans, "8:30～17:00", "9:00～12:00"]) }]);
    const texts = effortQs(s).map((q) => q.text);
    expect(texts.filter((x) => x.startsWith("工数の書き方が読めない"))).toEqual(["工数の書き方が読めない（1 行）"]);
    expect(texts.filter((x) => x.includes("人数の書き方が読めない"))).toEqual(["「職種別人員（人）」の欄の人数の書き方が読めない（1 行、見本「応援」）。人数を推し量らない"]);
    expect(lunchQ(s)?.sameShapeRows).toBe(4);
  });

  test("下の段が予定・実績の列は職種ごとの列として足さない（2 重に数えない）", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["日付", "機器", "作業内容", "作業人員（人）", null, "作業時間"], [null, null, null, "予定", "実績", null]]);
      for (const c of ["A", "B", "C", "F"]) ws.mergeCells(`${c}1:${c}2`);
      ws.mergeCells("D1:E1");
      rows(ws, 3, [["2026/04/06", "【架空】ポンプ甲", "点検", 2, 2, "9:00～12:00"]]);
    });
    const s = session();
    await s.add([{ name: "予実.xlsx", bytes }]);
    expect(lunchQ(s)).toBeUndefined();
    expect(effortQs(s).map((q) => q.text)).toEqual(["工数の書き方が読めない（1 行）"]);
  });
});

describe("工数の列が 2 つ（作業時間の幅と延べ時間）", () => {
  test("同じ行に読める工数（延べ時間）があれば、それを読む。昼休みは聞かない", async () => {
    const s = session();
    await s.add([
      {
        name: "日報.csv",
        bytes: csv(["日付,機器,作業内容,人数,作業時間,延べ時間", "2026/04/06,【架空】ポンプ甲,点検,2,9:00-15:00,12.0", "2026/04/07,【架空】ポンプ乙,点検,1,9:00-12:00,3.0"]),
      },
    ]);
    expect(lunchQ(s)).toBeUndefined();
    acceptDefaults(s);
    expect(manDaysOf(s, "日報.csv")).toEqual([12 / 8, 3 / 8]);
  });
});

describe("職種の語と「作業人員」の見出しの手がかり（packs/_cues の工数の手がかり。性質の違う 2 つの資料で、問いが減る）", () => {
  const people = ["機械工1 溶接工1 作業員2", "機2", "電工1 保温工1", "鳶工3"];
  const unlisted = ["塗装工1 配管工1 足場工2", "塗2", "配管工1 足場工1", "足場工3"];
  const spans = ["9:00～12:00", "8:30～17:00", "13:00～17:00", "8:30-17:00"];
  const flat = (ps: string[], personsHeader = "作業人員") =>
    csv([`日付,号炉,機器,作業内容,${personsHeader},作業時間`, ...ps.map((p, i) => `2026/04/0${i + 1},${(i % 2) + 1}号炉,【架空】機器${i + 1},点検,${p},${spans[i]}`)]);
  const count = async (name: string, bytes: Uint8Array) => {
    const s = session();
    await s.add([{ name, bytes }]);
    const an = s.analyze();
    return {
      effort: an.questions.filter((q) => q.kind === "effortUnknown" && !q.options.some((o) => o.id === "noon")).length,
      columnRole: an.questions.filter((q) => q.kind === "columnRole").length,
    };
  };

  test("Excel（1 日 1 枚の帳票）：職種の語が手がかりに無ければ、人数の問いが残る", async () => {
    expect((await count("A.xlsx", await formA(unlisted, spans))).effort).toBeGreaterThan(0);
    expect((await count("A.xlsx", await formA(people, spans))).effort).toBe(0);
  });

  test("CSV（日付の列のある書き出し）：職種の語が手がかりに無ければ、人数の問いが残る", async () => {
    expect((await count("a.csv", flat(unlisted))).effort).toBeGreaterThan(0);
    expect((await count("a.csv", flat(people))).effort).toBe(0);
  });

  test("「作業人員」の見出し：手がかりに無い見出しなら、列の役目と工数の問いが残る（Excel と CSV）", async () => {
    const xa = await count("A.xlsx", await formA(people, spans, "従事者"));
    const xb = await count("A.xlsx", await formA(people, spans));
    expect(xa.effort + xa.columnRole).toBeGreaterThan(xb.effort + xb.columnRole);
    const ca = await count("a.csv", flat(people, "従事者"));
    const cb = await count("a.csv", flat(people));
    expect(ca.effort + ca.columnRole).toBeGreaterThan(cb.effort + cb.columnRole);
  });
});
