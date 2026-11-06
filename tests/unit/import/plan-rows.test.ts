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
