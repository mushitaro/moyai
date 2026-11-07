// 発注明細（1 行が 1 品目・1 作業の明細、金額つき）の形を読む（仕事 reader-orderlines-v1）。
// 見出しの語で発注明細と見分け、1 行目の題と抽出の条件の行を、金額の単位と年度の手がかりとして読む。品名・仕様の「／」の並びから号炉・機器・作業を取り出し、
// ほかの資料の機器と同じ鍵（名前と号炉）のときだけ、その機器の作業の年度の値と費用にする案を 1 問で聞く。取り出せない行（一式・諸経費・運搬）は作業にしない。
// 資料はどれも試験の中で組む架空のもの（Shift_JIS の年度ごとの CSV と、Excel の発注明細）。どの施設の資料の語にも依らない。
import { describe, expect, test } from "vitest";
import type { Analysis } from "../../../src/import";
import { ORDER_LINE_EXCLUDE } from "../../../src/import/records";
import { CONDITION_ROW_REASON } from "../../../src/import/structure";
import { splitOrderItem } from "../../../src/import/text";
import { ASSET_LIST, CSV_2019, CSV_2020, ROWS_2019, orderLinesBook, orderLinesCsv, sjis, type OrderRow } from "./orderline-fixtures";
import { acceptDefaults, human, session } from "./helpers";

const statusOf = (an: Analysis, file: string) => [...an.composition.status.entries()].filter(([k]) => k.startsWith(`${file}\u0000`)).map(([, v]) => v);
/** 質問の無い未解決のセル（資料ごと） */
const silent = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved" && !v.questionId).length;
const unresolved = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved").length;
const isLink = (q: { kind: string; text: string }) => q.kind === "workJoin" && q.text.startsWith("発注明細の");
const linkQuestions = (an: Analysis) => an.questions.filter(isLink);
const reasonsOf = (an: Analysis, file: string) => {
  const m = new Map<string, number>();
  for (const v of statusOf(an, file)) if (v.s === "excluded") m.set(v.reason, (m.get(v.reason) ?? 0) + 1);
  return m;
};

/** 結ぶ案の問いのほかの、開いた質問に既定の答えで答える（ほかの資料の機器の問いに答えると、機器の節ができて案が出る） */
function acceptOthers(s: ReturnType<typeof session>, rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    const open = s.analyze().open.filter((q) => q.defaultAnswer !== null && !q.decision && !isLink(q));
    if (!open.length) return;
    s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? "")));
  }
}

describe("発注明細と見分ける（packs/_cues の orderLine の語。性質の違う 2 つの資料で効く）", () => {
  test("Shift_JIS の CSV：1 行目の題と条件の行は見出しにせず、金額の単位（円・税抜）と年度（工事年度）を読む。質問が無く、どのセルも未解決に残らない", async () => {
    const s = session();
    await s.add([{ name: "発注明細_2019.csv", bytes: CSV_2019 }]);
    const an = s.analyze();
    expect(an.sources[0]?.ledger.map((e) => e.detail).join("\n")).toContain("Shift_JIS");
    const tables = an.layouts.flatMap((l) => l.tables);
    expect(tables.map((t) => t.shape)).toEqual(["orderLines"]);
    const t = tables[0]!;
    // 見出しは 2 行目だけ。1 行目は題と抽出の条件
    expect(t.headerRows).toEqual([2]);
    expect(t.cols.map((c) => c.header)).toContain("明細番号");
    expect(t.conditions?.map((c) => [c.label, c.value])).toEqual([
      ["工事年度", "2019"],
      ["金額", "円・税抜"],
    ]);
    // 金額の列は費用の役目（AI に渡す見本では字を伏せる）
    expect(t.cols.filter((c) => c.role === "cost").map((c) => c.header)).toEqual(["単価", "初回発注額", "発注額", "検収累計額", "未検収残額"]);
    expect(an.records.events).toEqual([]);
    expect(an.records.marks).toEqual([]);
    expect(an.records.assets).toEqual([]);
    // 題の行の金額の項目で単位が決まるので、金額の単位を聞かない
    expect(an.open).toEqual([]);
    // 改訂 0 の行は外し、ほかの 8 行が記録。年度はどれも題の行の工事年度
    expect(an.records.contracts.length).toBe(ROWS_2019.length - 1);
    expect(new Set(an.records.contracts.map((c) => c.fiscalYear))).toEqual(new Set([2019]));
    const first = an.records.contracts[0]!;
    expect(first.amounts.find((a) => a.field === "inspectAmount")?.cost).toMatchObject({ yen: 1_200_000, tax: "excl" });
    expect(first.vendor).toBe("【架空】甲社");
    expect(silent(an, "発注明細_2019.csv")).toBe(0);
    expect(unresolved(an, "発注明細_2019.csv")).toBe(0);
    // 1 行目の 9 セルは、理由つきで外す（金額の単位と年度の手がかりに使い、記録の値には使わない）
    expect(reasonsOf(an, "発注明細_2019.csv").get(CONDITION_ROW_REASON)).toBe(9);
    const survey = s.survey(an);
    expect(survey.samples.some((x) => x.fileRef === "発注明細_2019.csv" && x.cells.includes("（費用）"))).toBe(true);
    expect(JSON.stringify(survey.samples)).not.toContain("1200000");
    expect(survey.notes.some((n) => n.startsWith("発注明細_2019.csv：発注明細として読んだ（明細 8 行"))).toBe(true);
  });

  test("Excel の発注明細（題の行が無く、見出しに単位。明細 No. と検収日・検収額）：同じ語で発注明細と見分け、質問が無い", async () => {
    const s = session();
    await s.add([{ name: "明細.xlsx", bytes: await orderLinesBook() }]);
    const an = s.analyze();
    expect(an.layouts.flatMap((l) => l.tables).map((t) => t.shape)).toEqual(["orderLines"]);
    expect(an.open).toEqual([]);
    const [a, b] = an.records.contracts;
    expect(a?.line?.target).toEqual({ unit: 2, asset: "誘引送風機", work: "分解整備" });
    expect(a?.line?.planOrActual).toBe("actual");
    // 題の行の年度が無いので、検収の日の年度（4 月始まり）
    expect(a?.fiscalYear).toBe(2021);
    expect(b?.line?.target).toBeNull();
    expect(silent(an, "明細.xlsx")).toBe(0);
    expect(unresolved(an, "明細.xlsx")).toBe(0);
  });

  test("品名・数量・単価・金額があっても、明細の番号も検収の欄も無い表（部品の価格表）と、機器・作業の内容の列のある表は、発注明細にしない", async () => {
    const s = session();
    await s.add([
      { name: "価格表.csv", bytes: new TextEncoder().encode("品名,型式,数量,単価,金額\r\n【架空】軸受,A-1,2,1000,2000\r\n【架空】パッキン,B-2,4,500,2000\r\n") },
      {
        name: "修繕の明細.csv",
        bytes: new TextEncoder().encode("機器,作業内容,品名,数量,単価,金額,検収日\r\nごみクレーン,年次点検,【架空】部品,1,1000,1000,2024/07/10\r\n"),
      },
    ]);
    const an = s.analyze();
    const shapes = (f: string) => an.layouts.filter((l) => l.file === f).flatMap((l) => l.tables.map((t) => t.shape));
    expect(shapes("価格表.csv")).not.toContain("orderLines");
    expect(shapes("修繕の明細.csv")).toEqual(["events"]);
    expect(an.records.contracts).toEqual([]);
  });
});

describe("題の行の金額の単位と年度", () => {
  test("題の行に金額の項目が無い年度ごとの CSV（同じ様式）は、金額の単位を 1 問で聞く。答えると未解決が 0", async () => {
    const s = session();
    await s.add([
      { name: "発注明細_2019.csv", bytes: orderLinesCsv(2019, ROWS_2019, { noUnit: true }) },
      { name: "発注明細_2020.csv", bytes: orderLinesCsv(2020, ROWS_2019.slice(0, 2), { noUnit: true }) },
    ]);
    const an = s.analyze();
    const unit = an.open.filter((q) => q.kind === "costUnit");
    expect(unit.length).toBe(1);
    expect(unit[0]?.text).toContain("発注明細の金額の欄");
    expect(unit[0]?.items.map((i) => i.file).sort()).toEqual(["発注明細_2019.csv", "発注明細_2020.csv"]);
    expect(unit[0]?.defaultAnswer).toBeNull();
    for (const f of ["発注明細_2019.csv", "発注明細_2020.csv"]) expect(silent(an, f)).toBe(0);
    s.settle([human(unit[0]!.questionId, "1")]);
    const after = s.analyze();
    for (const f of ["発注明細_2019.csv", "発注明細_2020.csv"]) expect(unresolved(after, f)).toBe(0);
    // 年度は題の行の工事年度（2020 年度の CSV の行は 2019 年度の日付でも 2020）
    expect(new Set(after.records.contracts.filter((c) => c.file === "発注明細_2020.csv").map((c) => c.fiscalYear))).toEqual(new Set([2020]));
  });

  test("題の行の「金額：千円・税込」は、見出しに単位の無い金額の欄を千円と税込で読む", async () => {
    const s = session();
    await s.add([{ name: "発注明細_2019.csv", bytes: orderLinesCsv(2019, [{ order: "【架空】P-1", line: 1, item: "1号炉 給じん装置", spec: "点検", kind: "【架空】労務費", amount: 1200, inspected: 1200 }], { unitText: "千円・税込" }) }]);
    const an = s.analyze();
    expect(an.open).toEqual([]);
    const c = an.records.contracts[0]!;
    expect(c.line?.cost).toMatchObject({ yen: 1_200_000, tax: "incl" });
  });
});

describe("品名・仕様の分け方（「／」の並びから号炉・機器・作業）", () => {
  test("号炉と機器・班・作業の並びを分ける。品名と仕様に同じ区切りがあれば 1 つにする", () => {
    expect(splitOrderItem(["1号炉 給じん装置", "1号炉 給じん装置／機械班／撤去・整備・復旧"])).toEqual({ unit: 1, asset: "給じん装置", work: "撤去・整備・復旧" });
    expect(splitOrderItem(["1号炉 給じん装置／1号炉 給じん装置／機械班／撤去・整備・復旧"])).toEqual({ unit: 1, asset: "給じん装置", work: "撤去・整備・復旧" });
    expect(splitOrderItem(["1号炉／給じん装置／点検"])).toEqual({ unit: 1, asset: "給じん装置", work: "点検" });
    expect(splitOrderItem(["給じん装置", "点検"])).toEqual({ unit: null, asset: "給じん装置", work: "点検" });
    expect(splitOrderItem(["2号炉 誘引送風機", "電気班/分解整備", null])).toEqual({ unit: 2, asset: "誘引送風機", work: "分解整備" });
  });

  test("取り出せない行（一式・諸経費・運搬・作業の語が無い・号炉が 2 つ）は null", () => {
    expect(splitOrderItem(["諸経費", "一式"])).toBeNull();
    expect(splitOrderItem(["資材運搬", "一式"])).toBeNull();
    expect(splitOrderItem(["1号炉 定期整備工事", "一式"])).toBeNull();
    expect(splitOrderItem(["1号炉 給じん装置／整備工事一式"])).toBeNull();
    expect(splitOrderItem(["1号炉 給じん装置／機械班"])).toBeNull();
    expect(splitOrderItem(["1号炉 給じん装置／2号炉 給じん装置／点検"])).toBeNull();
    expect(splitOrderItem(["1号炉 給じん装置 点検"])).toBeNull();
  });
});

describe("改訂番号：同じ明細番号の最後の改訂だけを数える", () => {
  test("前の改訂の行は、行ごと理由つきで外し、記録にしない。最後の改訂の金額を使う", () => {
    const s = session();
    return s.add([{ name: "発注明細_2019.csv", bytes: CSV_2019 }]).then(() => {
      const an = s.analyze();
      const line3 = an.records.contracts.filter((c) => c.line?.texts.lineNo === "3" && c.line.texts.orderNo === "【架空】P19-001");
      expect(line3.length).toBe(1);
      expect(line3[0]?.line?.texts.revision).toBe("1");
      expect(line3[0]?.line?.cost?.yen).toBe(900_000);
      // 改訂 0 の行（CSV の 5 行目）のセルは、どれも前の改訂の理由で外す
      const row5 = [...an.composition.status.entries()].filter(([k]) => k.startsWith("発注明細_2019.csv\u0000") && /^[A-Z]+5$/.test(k.split("\u0000")[2] ?? "")).map(([, v]) => v);
      expect(row5.length).toBeGreaterThan(10);
      expect(row5.every((v) => v.s === "excluded" && v.reason === ORDER_LINE_EXCLUDE.superseded)).toBe(true);
      const fc = s.compose().counts.find((x) => x.file === "発注明細_2019.csv")!;
      expect(fc.excludedRows[ORDER_LINE_EXCLUDE.superseded]).toBe(1);
      expect(fc.holds).toBe(true);
    });
  });

  test("改訂番号が数でない明細は、順を推し量らず、どの行も記録に残して結ぶ案にしない", async () => {
    const rows: OrderRow[] = [
      { order: "【架空】P-1", line: 1, rev: 0, item: "1号炉 給じん装置", spec: "点検", kind: "【架空】労務費", amount: 100_000, inspected: 0 },
      { order: "【架空】P-1", line: 1, rev: 1, item: "1号炉 給じん装置", spec: "点検", kind: "【架空】労務費", amount: 120_000, inspected: 120_000 },
    ];
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ASSET_LIST },
      { name: "発注明細_2019.csv", bytes: orderLinesCsv(2019, rows, { revText: (r) => `【架空】版${"AB"[r]}` }) },
    ]);
    acceptOthers(s);
    const an = s.analyze();
    expect(an.records.contracts.length).toBe(2);
    expect(an.records.contracts.every((c) => c.line?.revisionUnknown)).toBe(true);
    expect(linkQuestions(an)).toEqual([]);
    expect(unresolved(an, "発注明細_2019.csv")).toBe(0);
  });
});

describe("ほかの資料の機器と同じ鍵のときだけ結ぶ。結ぶ案は 1 問。取り出せない行は作業にしない", () => {
  async function withLedger(orders: boolean) {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ASSET_LIST },
      ...(orders
        ? [
            { name: "発注明細_2019.csv", bytes: CSV_2019 },
            { name: "発注明細_2020.csv", bytes: CSV_2020 },
          ]
        : []),
    ]);
    return s;
  }

  test("年度ごとの 2 本の CSV の結ぶ案は 1 問（既定は結ぶ）。結ぶと、機器の作業の年度の値（検収ありは実績・無しは予定）と金額の和の費用になる。機器は増えない", async () => {
    const base = await withLedger(false);
    acceptDefaults(base);
    const p0 = base.compose().plan!;
    expect(p0).not.toBeNull();
    expect(p0.details).toEqual([]);

    const s = await withLedger(true);
    acceptOthers(s);
    const an = s.analyze();
    const links = linkQuestions(an);
    expect(links.length).toBe(1);
    const q = links[0]!;
    expect(q.defaultAnswer).toBe("yes");
    expect(q.options.map((o) => o.id)).toEqual(["yes", "no"]);
    expect(q.text).toContain("推す：結ぶ");
    // 案の行：1 号炉 給じん装置（2 行）・2 号炉 給じん装置（改訂 1 の 1 行）・1 号炉 誘引送風機（予定）・2020 年度の 1 号炉 給じん装置（1 行）
    expect(q.sameShapeRows).toBe(5);
    expect(new Set(q.items.map((i) => i.file))).toEqual(new Set(["発注明細_2019.csv", "発注明細_2020.csv"]));
    expect(q.items.every((i) => (i.target ?? []).length > 0)).toBe(true);
    for (const f of ["発注明細_2019.csv", "発注明細_2020.csv"]) expect(silent(an, f)).toBe(0);

    s.settle([human(q.questionId, "yes")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    const p1 = c.plan!;
    expect(p1.assets.map((a) => a.nodeKey).sort()).toEqual(p0.assets.map((a) => a.nodeKey).sort());
    const nameOf = new Map(p1.assets.map((a) => [a.nodeKey, `${a.series}号炉 ${a.name}`]));
    const got = p1.details
      .map((d) => {
        const w = p1.works.find((x) => x.workKey === d.workKey)!;
        return `${nameOf.get(w.targets[0] ?? "")}|${w.kind}|${d.fiscalYear}|${d.planOrActual}|${d.cost}|${d.costSource?.tax}`;
      })
      .sort();
    expect(got).toEqual(
      [
        "1号炉 給じん装置|撤去・整備・復旧|2019|actual|1500000|excl",
        "2号炉 給じん装置|撤去・整備・復旧|2019|actual|900000|excl",
        "1号炉 誘引送風機|点検|2019|plan|500000|excl",
        "1号炉 給じん装置|点検|2020|actual|250000|excl",
      ].sort(),
    );
    // 発注の日・納期は作業の期間にしない。発注明細の行は作業明細（日報の行）にしない
    expect(p1.details.every((d) => d.startDate === null && d.endDate === null && d.lines === undefined)).toBe(true);
    // 一式・諸経費・運搬の行と、台帳に無い機器（投入扉）の行は、作業にしない（記録に残る）
    expect(p1.works.some((w) => /定期整備工事|諸経費|運搬|投入扉/u.test(w.kind))).toBe(false);
    expect(c.contracts.length).toBe(10);
    expect(c.contracts.filter((x) => x.linked).length).toBe(5);
    expect(c.contracts.filter((x) => x.contract.line?.target === null).every((x) => !x.linked && x.proposed.length === 0)).toBe(true);
    // どのセルも未解決に残らない。明細の行は取り込んだ行に数え、行の数え直しが合う
    for (const f of ["発注明細_2019.csv", "発注明細_2020.csv"]) {
      const fc = c.counts.find((x) => x.file === f)!;
      expect(fc.unresolvedCells).toBe(0);
      expect(fc.holds).toBe(true);
    }
    // 版の記録：結ぶ案の答えは読み方の決定の 1 つ
    expect(p1.readingDecisions?.some((x) => x.questionId === q.questionId && x.answer.startsWith("結ぶ"))).toBe(true);
  });

  test("結ばないと答えると、計画は発注明細の無いときと同じ。取り消すとまた聞く", async () => {
    const base = await withLedger(false);
    acceptDefaults(base);
    const p0 = base.compose().plan!;

    const s = await withLedger(true);
    acceptOthers(s);
    const q = linkQuestions(s.analyze())[0]!;
    s.settle([human(q.questionId, "no")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    expect(c.plan?.details).toEqual(p0.details);
    expect(c.plan?.works).toEqual(p0.works);
    expect(c.contracts.some((x) => x.linked)).toBe(false);
    s.undo(q.questionId);
    const back = s.takeAfter()!;
    expect(back.open.map((x) => x.questionId)).toContain(q.questionId);
    expect(back.composition.plan).toBeNull();
  });

  test("号炉の違う機器（台帳に号炉が無い）とは結ばない。発注明細だけでは計画を作らず、質問の無い未解決も残さない", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: new TextEncoder().encode("名称,備考\r\n給じん装置,【架空】\r\n誘引送風機,【架空】\r\n") },
      { name: "発注明細_2019.csv", bytes: CSV_2019 },
    ]);
    acceptOthers(s);
    expect(linkQuestions(s.analyze())).toEqual([]);

    const only = session();
    await only.add([{ name: "発注明細_2019.csv", bytes: CSV_2019 }]);
    acceptDefaults(only);
    const an = only.analyze();
    expect(linkQuestions(an)).toEqual([]);
    expect(silent(an, "発注明細_2019.csv")).toBe(0);
    const c = only.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("・")).toContain("計画に使う資料が無い");
    const fc = c.counts.find((x) => x.file === "発注明細_2019.csv")!;
    expect(fc.holds).toBe(true);
    expect(fc.unresolvedRows).toBe(0);
  });

  test("検収が無く、最後の改訂の発注額が 0 の明細（取り消した明細）は、予定にもしない", async () => {
    const rows: OrderRow[] = [
      { order: "【架空】P-9", line: 1, rev: 0, item: "1号炉 給じん装置", spec: "点検", kind: "【架空】労務費", amount: 200_000, inspected: 0 },
      { order: "【架空】P-9", line: 1, rev: 1, item: "1号炉 給じん装置", spec: "点検", kind: "【架空】労務費", amount: 0, first: 200_000, inspected: 0 },
    ];
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ASSET_LIST },
      { name: "発注明細_2019.csv", bytes: orderLinesCsv(2019, rows) },
    ]);
    acceptOthers(s);
    const an = s.analyze();
    expect(an.records.contracts.length).toBe(1);
    expect(linkQuestions(an)).toEqual([]);
    expect(unresolved(an, "発注明細_2019.csv")).toBe(0);
  });
});

test("試験の Shift_JIS の書き手：TextDecoder で読み戻すと同じ字", () => {
  const text = "【架空】発注明細一覧（最新状態）,1号炉 給じん装置／機械班／撤去・整備・復旧,ｶﾅ";
  expect(new TextDecoder("shift_jis").decode(sjis(text))).toBe(text);
});
