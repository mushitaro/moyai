// 日報・工程表の行ごとの予定・実績（「状態｜完了・予定」）：予定の行は実績にしない（Architect の 53）。
// 予定の行だけの作業の年度の値は計画、作業明細（lines）は実績の行だけ。予定の行は次回の起点にならない。
// 作業明細には、その行の備考と作業量を残す（Architect の 54。当施設の画面だけに出す）
import { describe, expect, test } from "vitest";
import { workDue } from "../../../src/plan/next";
import { human, session } from "./helpers";

const enc = new TextEncoder();
const CSV = [
  "日付,機器,作業内容,状態,数量,工数(人日),備考",
  "2022-05-10,押込送風機,分解整備,完了,1式,3,軸受を替えた",
  "2022-05-11,押込送風機,分解整備,完了,1式,2,",
  "2026-12-01,押込送風機,分解整備,予定,1式,4,見積のとおり",
].join("\r\n");

describe("行ごとの予定・実績", () => {
  test("予定の行は計画の年度の値になり、作業明細と次回の起点に入らない。実績の行の作業明細に備考と作業量が残る", async () => {
    const s = session();
    await s.add([{ name: "日報.csv", bytes: enc.encode(CSV) }]);
    // 開いた質問に、既定か選択肢の最初の答えで答える（試験の台本）
    for (let i = 0; i < 10; i++) {
      const open = s.analyze().open.filter((q) => !q.decision);
      if (!open.length) break;
      s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? q.options[0]?.id ?? "")));
    }
    const plan = s.compose().plan;
    expect(plan, JSON.stringify(s.analyze().open.map((q) => [q.kind, q.text]))).not.toBeNull();
    const ds = plan!.details;
    const actual = ds.filter((d) => d.planOrActual === "actual");
    const planned = ds.filter((d) => d.planOrActual === "plan");
    expect(actual.map((d) => d.fiscalYear)).toEqual([2022]);
    expect(planned.map((d) => d.fiscalYear)).toEqual([2026]);
    // 作業明細は実績の行だけ
    const lines = ds.flatMap((d) => d.lines ?? []);
    expect(lines.map((l) => l.date)).toEqual(["2022-05-10", "2022-05-11"]);
    expect(lines[0]).toMatchObject({ remark: "軸受を替えた", quantity: "1式" });
    expect(lines[1]!.remark).toBeUndefined();
    // 予定の行は次回の起点にならない（きっかけを置いて確かめる）
    const w = { ...plan!.works[0]!, trigger: { branches: [{ kind: "calendar", years: 5 }], combine: "earliest" } };
    const due = workDue({ ...plan!, works: [w] }, w, "2027-06-01");
    expect(due.status === "due" && due.origin).toBe("2022-05-10");
  });
});

describe("作業明細の備考と作業量は共有しない（Architect の 54）", () => {
  test("見張りの字を備考と作業量に入れても、共有の束に出ない", async () => {
    const { previewBundle } = await import("../../../src/share/seal");
    const { asset, detail, makeMember, makeRing, plan, sendInput, work } = await import("../share/fixtures");
    const SENTINEL = "見張り備考４２７";
    const ring = makeRing();
    const m = makeMember(ring);
    const line = { date: "2022-05-10", content: "分解整備", quantity: SENTINEL, manDays: 3, days: 1, source: { file: "日報.csv", sheet: null, page: null, cell: "A2", box: null }, remark: SENTINEL };
    const p = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2019, { lines: [line] }), detail("d2", "w1", 2022, { lines: [line] })] });
    const pv = previewBundle(sendInput(ring, m, p));
    if (!pv.ok) throw new Error("束が作れない");
    expect(JSON.stringify(pv.body).includes(SENTINEL)).toBe(false);
  });
});

describe("予定・実績の列の読めない値（Architect の 62）", () => {
  // 予定・実績の列は 9 割が読める字（完了）のときに列の役目になる。そのうえで読めない字（延期）が混じる
  const done = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027].map((y) => `${y}-05-10,押込送風機,分解整備,完了,3`);
  const CSV2 = ["日付,機器,作業内容,状態,工数(人日)", ...done, "2028-05-10,押込送風機,分解整備,延期,3", "2029-05-10,押込送風機,分解整備,延期,3"].join("\r\n");
  test("「延期」は推し量らず、同じ字ごとに 1 回聞く。答えるまで計画を作らない", async () => {
    const s = session();
    await s.add([{ name: "日報.csv", bytes: enc.encode(CSV2) }]);
    const qs = s.analyze().open.filter((q) => q.kind === "planActualUnknown");
    expect(qs).toHaveLength(1);
    expect(qs[0]!.text).toContain("「延期」（2 行）");
    expect(qs[0]!.defaultAnswer).toBeNull();
    // ほかの質問に答えても、これに答えるまでは作らない
    for (let i = 0; i < 10; i++) {
      const open = s.analyze().open.filter((q) => !q.decision && q.kind !== "planActualUnknown");
      if (!open.length) break;
      s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? q.options[0]?.id ?? "")));
    }
    expect(s.compose().plan).toBeNull();
    s.settle([human(qs[0]!.questionId, "plan")]);
    for (let i = 0; i < 10; i++) {
      const open = s.analyze().open.filter((q) => !q.decision);
      if (!open.length) break;
      s.settle(open.map((q) => human(q.questionId, q.defaultAnswer ?? q.options[0]?.id ?? "")));
    }
    const p = s.compose().plan;
    expect(p?.details.filter((d) => d.fiscalYear >= 2027).map((d) => [d.fiscalYear, d.planOrActual]).sort()).toEqual([[2027, "actual"], [2028, "plan"], [2029, "plan"]]);
  });
});

describe("1 つのセルに号炉・機器・作業を書いた列（Architect の 64(b)・Wire）", () => {
  const CSV3 = ["日付,号炉・機器・作業内容,工数(人日)", "2022-05-10,1号 No.2 BFP 分解整備,3", "2022-05-11,2号 押込送風機 点検,2", "2022-05-12,給じん装置（1号炉）点検整備,1"].join("\r\n");
  test("読み手が分けた行は「分けて読む（n 行）」を既定にして 1 回聞く。「その行を外す」なら外す", async () => {
    for (const answer of ["split", "exclude"]) {
      const s = session();
      await s.add([{ name: "日報.csv", bytes: enc.encode(CSV3) }]);
      const q = s.analyze().open.find((x) => x.kind === "flatSplit");
      expect(q?.defaultAnswer).toBe("split");
      expect(q?.options.map((o) => o.label)).toEqual(["空白・括弧で分けて読む（3 行）", "その行を外す"]);
      s.settle([human(q!.questionId, answer)]);
      for (let i = 0; i < 10; i++) {
        const open = s.analyze().open.filter((x) => !x.decision);
        if (!open.length) break;
        s.settle(open.map((x) => human(x.questionId, x.defaultAnswer ?? x.options.find((o) => o.id === "new")?.id ?? x.options[0]?.id ?? "")));
      }
      const p = s.compose().plan;
      if (answer === "split") expect(p?.details.length, answer).toBe(3);
      else expect(p?.details.length ?? 0, answer).toBe(0);
    }
  });
});
