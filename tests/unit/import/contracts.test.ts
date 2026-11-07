// 契約・発注の一覧の形を読む（仕事 reader-contracts-v1）：1 行を 1 つの契約の記録にし、作業にはしない。
// 件名の語と期間の合う作業の年度の値と結ぶ案を、まとめた 1 問で聞く。
// 資料はどれも試験の中で組む架空のもの（年度ごとのシートの発注台帳の Excel と、年度ごとの発注明細の CSV）。どの施設の資料の語にも依らない。
import { describe, expect, test } from "vitest";
import type { Analysis } from "../../../src/import";
import { CONTRACT_EXCLUDE } from "../../../src/import/records";
import { ASSETS, CSV_2023, CSV_2024, WORKS, enc, ledgerBook, orderCsv } from "./contract-fixtures";
import { acceptDefaults, human, session } from "./helpers";

const statusOf = (an: Analysis, file: string) => [...an.composition.status.entries()].filter(([k]) => k.startsWith(`${file}\u0000`)).map(([, v]) => v);
/** 質問の無い未解決のセル（資料ごと） */
const silent = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved" && !v.questionId).length;
const unresolved = (an: Analysis, file: string) => statusOf(an, file).filter((v) => v.s === "unresolved").length;
const isLink = (q: { kind: string; text: string }) => q.kind === "workJoin" && q.text.startsWith("契約の一覧の契約");
const linkQuestions = (an: Analysis) => an.questions.filter(isLink);

/** 結ぶ案の問いのほかの、開いた質問に既定の答えで答える（結ぶ案の問いが出るまで。ほかの資料の機器の問いに答えると、作業の年度の値ができて案が出る） */
function acceptOthers(s: ReturnType<typeof session>, rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    const open = s.analyze().open.filter((q) => q.defaultAnswer !== null && !q.decision && !isLink(q));
    if (!open.length) return;
    s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? "")));
  }
}

describe("契約・発注の一覧と見分ける（packs/_cues の契約の欄の語。性質の違う 2 つの資料で効く）", () => {
  test("Excel の発注台帳（年度ごとのシート）：どの表も契約の一覧。1 行が 1 契約の記録で、作業の記録を作らない。質問の無い未解決のセルが 0", async () => {
    const s = session();
    await s.add([{ name: "発注台帳.xlsx", bytes: await ledgerBook() }]);
    const an = s.analyze();
    const tables = an.layouts.flatMap((l) => l.tables);
    expect(tables.length).toBe(2);
    expect(tables.every((t) => t.shape === "contracts")).toBe(true);
    // 金額の列は費用の役目（AI に渡す見本では字を伏せる）
    expect(tables[0]?.cols.filter((c) => c.role === "cost").map((c) => c.header)).toEqual(["見積金額（円）", "発注金額（円）", "検収金額（円）"]);
    expect(an.records.events).toEqual([]);
    expect(an.records.marks).toEqual([]);
    expect(an.records.contracts.length).toBe(7);
    expect(silent(an, "発注台帳.xlsx")).toBe(0);
    expect(unresolved(an, "発注台帳.xlsx")).toBe(0);
    // 見出しに単位があるので、聞くことが無い
    expect(an.open).toEqual([]);
    const survey = s.survey(an);
    expect(survey.samples.some((x) => x.fileRef === "発注台帳.xlsx" && x.cells.includes("（費用）"))).toBe(true);
    expect(JSON.stringify(survey.samples)).not.toContain("1320000");
  });

  test("CSV の発注明細（1 行目が題と抽出の条件）：契約の一覧。金額の単位だけを聞き、答えるとどのセルも未解決に残らない", async () => {
    const s = session();
    await s.add([{ name: "発注明細_R6.csv", bytes: CSV_2024 }]);
    const an = s.analyze();
    expect(an.layouts.flatMap((l) => l.tables).map((t) => t.shape)).toEqual(["contracts"]);
    expect(an.records.contracts.length).toBe(2);
    expect(an.records.events).toEqual([]);
    // 見出しに単位の無い金額の欄（発注金額・検収金額）は、推し量らずに 1 問で聞く。待つセルには、その問いが付く
    expect(silent(an, "発注明細_R6.csv")).toBe(0);
    const unit = an.open.filter((q) => q.kind === "costUnit");
    expect(unit.length).toBe(1);
    expect(unit[0]?.text).toContain("「発注金額」「検収金額」");
    expect(unit[0]?.defaultAnswer).toBeNull();
    s.settle([human(unit[0]!.questionId, "1")]);
    acceptDefaults(s);
    const after = s.analyze();
    expect(unresolved(after, "発注明細_R6.csv")).toBe(0);
    const c = after.records.contracts[0]!;
    expect(c.amounts.map((a) => [a.field, a.cost.yen])).toEqual([
      ["orderAmount", 1_500_000],
      ["inspectAmount", 1_500_000],
    ]);
  });

  test("契約の欄の語があっても、機器・作業の内容・工数の列のある表は作業の表のまま（行が作業そのもの）", async () => {
    const s = session();
    await s.add([
      {
        name: "修繕の履歴.csv",
        bytes: enc(["機器,作業内容,実施日,業者名,契約方法,契約金額（円）,支払日", "ごみクレーン,年次点検,2024/07/08,【架空】乙社,随意契約,1500000,2024/09/30"]),
      },
    ]);
    const an = s.analyze();
    expect(an.layouts.flatMap((l) => l.tables).map((t) => t.shape)).toEqual(["events"]);
    expect(an.records.contracts).toEqual([]);
  });
});

describe("契約の記録の形と、セルの行き先", () => {
  test("件名・業者・金額・工期・検収日・区分・契約方法を持つ。担当と備考は理由つきで外す", async () => {
    const s = session();
    await s.add([{ name: "発注台帳.xlsx", bytes: await ledgerBook() }]);
    const an = s.analyze();
    const c = an.records.contracts.find((x) => x.title === "【架空】ごみクレーン・灰クレーン年次点検業務委託")!;
    expect(c).toBeTruthy();
    expect([c.number, c.category, c.method, c.vendor]).toEqual(["【架空】K2023-002", "委託", "指名競争入札", "【架空】乙社"]);
    expect(c.period).toEqual({ start: { y: 2023, m: 7, d: 1 }, end: { y: 2023, m: 9, d: 30 } });
    expect(c.fiscalYear).toBe(2023);
    expect(c.dates.find((d) => d.field === "inspectDate")?.date).toEqual({ y: 2023, m: 9, d: 30 });
    expect(c.amounts.map((a) => a.field)).toEqual(["estimateAmount", "orderAmount", "inspectAmount"]);
    expect(c.amounts.find((a) => a.field === "orderAmount")?.cost.yen).toBe(2_750_000);
    // 単価契約の印
    expect(an.records.contracts.filter((x) => x.unitPrice).map((x) => x.fiscalYear)).toEqual([2023, 2024]);
    // 行き先：契約の行のセルは、データか、理由つきで外したもの
    const st = statusOf(an, "発注台帳.xlsx");
    const reasons = new Map<string, number>();
    for (const v of st) if (v.s === "excluded") reasons.set(v.reason, (reasons.get(v.reason) ?? 0) + 1);
    expect(reasons.get(CONTRACT_EXCLUDE.staff)).toBe(7);
    expect(reasons.get(CONTRACT_EXCLUDE.remark)).toBe(1);
    expect(st.filter((v) => v.s === "data").length).toBe(7 * 16);
  });

  test("読めない日付は、同じ様式のシートをまとめて 1 問で聞く（既定は置かない）。答えると未解決が 0", async () => {
    const s = session();
    await s.add([{ name: "発注台帳.xlsx", bytes: await ledgerBook({ badDate: true }) }]);
    const an = s.analyze();
    const qs = an.open.filter((q) => q.kind === "dateUnknown");
    // 2 枚のシートの問いが、様式で 1 問にまとまる
    expect(qs.length).toBe(1);
    expect(qs[0]?.sameShapeRows).toBe(2);
    expect(qs[0]?.text).toContain("2 問をまとめた");
    expect(silent(an, "発注台帳.xlsx")).toBe(0);
    acceptDefaults(s);
    const after = s.analyze();
    expect(unresolved(after, "発注台帳.xlsx")).toBe(0);
    const why = statusOf(after, "発注台帳.xlsx").filter((v) => v.s === "excluded" && v.reason === CONTRACT_EXCLUDE.badDate);
    expect(why.length).toBe(2);
  });

  test("年度ごとの CSV（同じ見出しの並び）は 1 つの様式：金額の単位の問いが 1 問にまとまる", async () => {
    const s = session();
    await s.add([
      { name: "発注明細_R5.csv", bytes: CSV_2023 },
      { name: "発注明細_R6.csv", bytes: CSV_2024 },
    ]);
    const an = s.analyze();
    const unit = an.open.filter((q) => q.kind === "costUnit");
    expect(unit.length).toBe(1);
    expect(unit[0]?.sameShapeRows).toBe(4);
    expect(unit[0]?.items.map((i) => i.file).sort()).toEqual(["発注明細_R5.csv", "発注明細_R6.csv"]);
    for (const f of ["発注明細_R5.csv", "発注明細_R6.csv"]) expect(silent(an, f)).toBe(0);
    s.settle([human(unit[0]!.questionId, "1")]);
    const after = s.analyze();
    for (const f of ["発注明細_R5.csv", "発注明細_R6.csv"]) expect(unresolved(after, f)).toBe(0);
  });

  test("契約の一覧だけでは、空の計画を作らない", async () => {
    const s = session();
    await s.add([{ name: "発注台帳.xlsx", bytes: await ledgerBook() }]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("・")).toContain("計画に使う資料が無い");
    // 行の数え直しは合う（契約の行は取り込んだ行に数える）
    const fc = c.counts.find((x) => x.file === "発注台帳.xlsx")!;
    expect(fc.holds).toBe(true);
    expect(fc.importedRows).toBe(7);
    expect(fc.unresolvedRows).toBe(0);
  });
});

describe("作業にしない・件名と期間で作業と結ぶ案をまとめた 1 問で聞く", () => {
  async function withWorks(contracts: boolean) {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ASSETS },
      { name: "作業の履歴.csv", bytes: WORKS },
      ...(contracts
        ? [
            { name: "発注台帳.xlsx", bytes: await ledgerBook() },
            { name: "発注明細_R5.csv", bytes: CSV_2023 },
            { name: "発注明細_R6.csv", bytes: CSV_2024 },
          ]
        : []),
    ]);
    return s;
  }

  test("契約の一覧を足しても、計画の機器・作業・明細は増えない。結ぶ案は 1 問で、結ぶと 1 つずつ合う明細にだけ金額を置く", async () => {
    const base = await withWorks(false);
    acceptDefaults(base);
    const p0 = base.compose().plan!;
    expect(p0).not.toBeNull();
    expect(p0.details.every((d) => d.cost === null)).toBe(true);

    const s = await withWorks(true);
    const unit = s.analyze().open.find((q) => q.kind === "costUnit")!;
    s.settle([human(unit.questionId, "1")]);
    acceptOthers(s);
    const an = s.analyze();
    // 件名と期間の合う案は、資料（Excel の 2 枚のシートと 2 本の CSV）をまたいで 1 問にまとまる
    const links = linkQuestions(an);
    expect(links.length).toBe(1);
    const q = links[0]!;
    expect(q.defaultAnswer).toBe("yes");
    expect(q.options.map((o) => o.id)).toEqual(["yes", "no"]);
    // 案のある契約：DCS（R5）・ごみクレーンと灰クレーン（R5）・誘引送風機（R6）・ごみクレーン（R6 の CSV）・受入ホッパ（R5 の CSV）
    expect(q.sameShapeRows).toBe(5);
    expect(q.text).toContain("推す：結ぶ");
    expect(new Set(q.items.map((i) => i.file))).toEqual(new Set(["発注台帳.xlsx", "発注明細_R6.csv", "発注明細_R5.csv"]));
    expect(q.items.every((i) => (i.target ?? []).length > 0)).toBe(true);
    // 案の無い契約（単価契約の薬剤・運転管理・清掃・R6 の DCS）も記録に残る
    expect(an.records.contracts.length).toBe(11);
    for (const f of ["発注台帳.xlsx", "発注明細_R5.csv", "発注明細_R6.csv"]) expect(silent(an, f)).toBe(0);

    s.settle([human(q.questionId, "yes")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    const p1 = c.plan!;
    expect(p1.assets.length).toBe(p0.assets.length);
    expect(p1.works.length).toBe(p0.works.length);
    expect(p1.details.length).toBe(p0.details.length);
    expect(p1.details.map((d) => d.detailKey).sort()).toEqual(p0.details.map((d) => d.detailKey).sort());
    // 金額を置いたのは、契約と作業が 1 つずつ合う明細だけ（2 基をまとめた契約は割らない）。費用は検収の金額
    const kindOf = new Map(p1.works.map((w) => [w.workKey, w.kind]));
    const nameOf = new Map(p1.assets.map((a) => [a.nodeKey, a.name]));
    const costs = p1.details
      .filter((d) => d.cost !== null)
      .map((d) => {
        const w = p1.works.find((x) => x.workKey === d.workKey)!;
        return `${nameOf.get(w.targets[0] ?? "")}|${kindOf.get(d.workKey)}|${d.fiscalYear}|${d.cost}|${d.costSource?.file}`;
      })
      .sort();
    expect(costs).toEqual(
      [
        "DCS|保守点検|2023|1320000|発注台帳.xlsx",
        "誘引送風機|分解整備|2024|5060000|発注台帳.xlsx",
        "ごみクレーン|年次点検|2024|1500000|発注明細_R6.csv",
        "受入ホッパ|補修|2023|880000|発注明細_R5.csv",
      ].sort(),
    );
    const linked = c.contracts.filter((x) => x.linked);
    expect(linked.length).toBe(5);
    expect(c.contracts.filter((x) => x.costTo !== null).length).toBe(4);
    // どのセルも未解決に残らない。契約の行は取り込んだ行に数え、行の数え直しが合う
    for (const f of ["発注台帳.xlsx", "発注明細_R5.csv", "発注明細_R6.csv"]) {
      const fc = c.counts.find((x) => x.file === f)!;
      expect(fc.unresolvedCells).toBe(0);
      expect(fc.holds).toBe(true);
    }
    // 版の記録：結ぶ案の答えは読み方の決定の 1 つ
    expect(p1.readingDecisions?.some((x) => x.questionId === q.questionId && x.answer.startsWith("結ぶ"))).toBe(true);
  });

  test("結ばないと答えると、計画は契約の一覧の無いときと同じ（費用も置かない）。取り消すとまた聞く", async () => {
    const base = await withWorks(false);
    acceptDefaults(base);
    const p0 = base.compose().plan!;

    const s = await withWorks(true);
    const unit = s.analyze().open.find((q) => q.kind === "costUnit")!;
    s.settle([human(unit.questionId, "1")]);
    acceptOthers(s);
    const q = linkQuestions(s.analyze())[0]!;
    s.settle([human(q.questionId, "no")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    const p1 = c.plan!;
    expect(p1.details.map((d) => [d.detailKey, d.cost])).toEqual(p0.details.map((d) => [d.detailKey, d.cost]));
    expect(c.contracts.some((x) => x.linked)).toBe(false);
    expect(c.contracts.length).toBe(11);
    s.undo(q.questionId);
    const back = s.takeAfter()!;
    expect(back.open.map((x) => x.questionId)).toContain(q.questionId);
    expect(back.composition.plan).toBeNull();
  });
});

describe("変更契約の行と単価契約（Skillパックの「資料とデータの名前」の決まり）", () => {
  test("「〃（第1回変更）」の行は上の契約の変更として記録に残し、結ぶ案にしない。変更のある契約と、支払・検収の金額の無い単価契約は、結んでも費用を置かない", async () => {
    const csv = orderCsv(2024, [
      ["【架空】W24-11", "【架空】ごみクレーン年次点検業務委託", "委託", "随意契約", "【架空】乙社", "2024/06/10", "1500000", "2024/07/01", "2024/08/31", "2024/09/05", "1500000", "2024/09/30", "【架空】施設課", ""],
      ["【架空】W24-11-1", "〃（第1回変更）", "委託", "随意契約", "〃", "2024/08/01", "1600000", "2024/07/01", "2024/08/31", "2024/09/05", "1600000", "2024/09/30", "【架空】施設課", ""],
      ["【架空】W24-12", "【架空】誘引送風機分解整備（単価契約）", "工事", "単価契約", "【架空】丙社", "2024/05/20", "5000000", "2024/06/01", "2024/07/31", "", "", "", "【架空】施設課", ""],
    ]);
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ASSETS },
      { name: "作業の履歴.csv", bytes: WORKS },
      { name: "発注明細_R6.csv", bytes: csv },
    ]);
    const unit = s.analyze().open.find((q) => q.kind === "costUnit")!;
    s.settle([human(unit.questionId, "1")]);
    acceptOthers(s);
    const an = s.analyze();
    const [first, change, unitPrice] = an.records.contracts;
    expect(change?.changeOf).toBe(first?.id);
    expect(change?.title).toBe(first?.title);
    expect(change?.vendor).toBe("【架空】乙社");
    expect(unitPrice?.unitPrice).toBe(true);
    const q = linkQuestions(an);
    expect(q.length).toBe(1);
    // 案は、変更の元の契約と単価契約の 2 件（変更の行は案にしない）
    expect(q[0]?.sameShapeRows).toBe(2);
    expect(silent(an, "発注明細_R6.csv")).toBe(0);
    s.settle([human(q[0]!.questionId, "yes")]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    expect(c.plan?.details.every((d) => d.cost === null)).toBe(true);
    expect(c.contracts.filter((x) => x.linked).length).toBe(2);
    expect(c.contracts.every((x) => x.costTo === null)).toBe(true);
    expect(c.counts.find((x) => x.file === "発注明細_R6.csv")?.unresolvedCells).toBe(0);
  });
});
