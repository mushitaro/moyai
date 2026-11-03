// check_results（docs/plan.md §2.13 の 8）：タブの受け手が、作業中の計画に画面の基準日でパックの検査を走らせ、出力の型どおりに返す。
// 読むだけで、計画も基準日も変えない。AI のツールから基準日を変える道・検査を直す道が無いことも見る。
// 業種の語（パックの語彙・1 段目の項目・検査が選ぶ作業の名前・尺度の名前）が、検査のコードと画面の言葉に無いことも見る。
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan, getWorkingPlan } from "../../../src/app/state/plan-store";
import { checkResultsOf, getReferenceDate, reviewOf, setReferenceDate, todayJst } from "../../../src/app/state/review";
import { BRIDGE_TOOL_RECEIVERS } from "../../../src/bridge/tools";
import { TOOLS } from "../../../src/shared/tools";
import { CTX, PACK, composeFictional1, ok } from "./compose";

let ws: IntakeWorkspace;
beforeAll(async () => {
  ws = await composeFictional1("【架空】検査のツール");
}, 60_000);
afterAll(() => clearWorkingPlan());

describe("check_results：検査の結果を読む", () => {
  test("受け手は作業画面（tab）。入力は検査の ID だけで、基準日や結果を変える欄は無い", () => {
    expect(BRIDGE_TOOL_RECEIVERS.check_results).toBe("tab");
    expect(Object.keys(TOOLS.check_results.input.shape)).toEqual(["checkId"]);
    expect(TOOLS.check_results.kind).toBe("read");
    const src = readFileSync("src/app/intake/tab-tools.ts", "utf8");
    expect(src).not.toContain("setReferenceDate");
    expect(src).not.toMatch(/approv/i);
  });

  test("出力の型どおりで、いつも「自己点検であって、審査の判断ではない」。数字は画面と同じ関数の結果のまま", () => {
    expect(setReferenceDate("2026-10-01")).toBe(true);
    const before = getWorkingPlan()!;
    const r = ok(runTabTool(ws, "check_results", {}, CTX));
    expect(TOOLS.check_results.output.safeParse(r).success).toBe(true);
    expect(r.notice).toBe("自己点検であって、審査の判断ではない");
    expect(r).toMatchObject({ packId: PACK, packChecks: "loaded", referenceDate: "2026-10-01", referenceFiscalYear: 2026, planVersion: before.revision });
    expect(r.checks.length).toBeGreaterThanOrEqual(5);
    expect(r.notImplemented.length).toBeGreaterThan(0);
    // 計画は変わらない（読むだけ）
    expect(getWorkingPlan()!.revision).toBe(before.revision);
    expect(getWorkingPlan()!.plan).toBe(before.plan);

    // 画面と同じ純粋な関数の結果と、件数・結果・例の年度が一致する
    const review = reviewOf(before.plan, "2026-10-01");
    expect(review.kind).toBe("ok");
    if (review.kind !== "ok") return;
    expect(r.checks.map((c: any) => [c.checkId, c.result, c.count])).toEqual(review.run.results.map((c) => [c.checkId, c.result, c.count]));
    for (const [i, c] of review.run.results.entries()) {
      const t = r.checks[i];
      expect(t.examples.map((e: any) => e.fiscalYears)).toEqual(c.examples.map((e) => e.fiscalYears));
      expect(t.examples.length).toBeLessThanOrEqual(10);
      expect(t.level).toBe(c.level);
      expect(t.thresholdOrigin).toBe(c.thresholdOrigin);
      expect(t.verification).toBe(c.verification);
    }

    // 精密機能検査の間隔：推奨・出典（課長通知の第三の 11）・原典照合済。例は段の道と年度の文
    const interval = r.checks.find((c: any) => c.kind === "interval_max");
    expect(interval).toMatchObject({ result: "notMet", count: 2, level: "recommendation", thresholdOrigin: "source", verification: "原典照合済" });
    expect(interval.source).toMatchObject({ url: "https://www.env.go.jp/hourei/11/000510.html" });
    expect(interval.source.clause).toContain("第三の 11");
    expect(interval.numbers["閾値の年数"]).toBe(3);
    expect(interval.numbers["延長の上限の年数"]).toBe("定め無し（延長しない）");
    expect(interval.examples[0].path).toContain("焼却炉本体");
    expect(interval.examples[0].rowRef).toMatch(/^n:/);
    expect(interval.examples.map((e: any) => e.text)).toEqual(["2019 年度 → 2025 年度：間が 6 年度（閾値 3 年）", "2020 年度 → 2026 年度：間が 6 年度（閾値 3 年）"]);
    // 出典の無いアプリの目安は、出典も確かめた度合いも null
    const done = r.checks.find((c: any) => c.kind === "next_due");
    expect(done).toMatchObject({ level: "app", thresholdOrigin: "app", source: null, verification: null });
    // 判定の値の無い検査は、当てはまらない理由を言う
    expect(r.checks.find((c: any) => c.kind === "scale_valid")).toMatchObject({ result: "notApplicable", notApplicableReason: "判定の値のある記録が無い" });
    // 内部の名前（数字の欄の鍵）は出さず、画面の言葉で出す
    for (const c of r.checks) for (const k of Object.keys(c.numbers)) expect(k, k).not.toMatch(/^[a-z]/);
  });

  test("検査の ID を渡すと、その検査だけ。無い ID なら空の一覧", () => {
    const one = ok(runTabTool(ws, "check_results", { checkId: "WI-PLAN-HORIZON" }, CTX));
    expect(one.checks.map((c: any) => c.checkId)).toEqual(["WI-PLAN-HORIZON"]);
    expect(ok(runTabTool(ws, "check_results", { checkId: "NOPE" }, CTX)).checks).toEqual([]);
  });

  test("基準日は画面と同じ。人が画面で変えた日で走る。日付でない値は受けない", () => {
    expect(setReferenceDate("2027-04-01")).toBe(true);
    const r = ok(runTabTool(ws, "check_results", {}, CTX));
    expect(r).toMatchObject({ referenceDate: "2027-04-01", referenceFiscalYear: 2027 });
    // 年度が進むと、2026 年度の日付の無い予定が「過ぎた予定」になる
    expect(r.checks.find((c: any) => c.checkId === "WI-PLAN-DONE").count).toBeGreaterThan(2);
    expect(setReferenceDate("2026-02-31")).toBe(false);
    expect(setReferenceDate("2026/10/01")).toBe(false);
    expect(getReferenceDate()).toBe("2027-04-01");
    expect(todayJst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("作業中の計画が無ければ「作業中の計画が無い」。パックに検査が無ければ none", () => {
    const p = getWorkingPlan()!.plan;
    expect(checkResultsOf({ ...p, packId: "night-soil" }, 1, "2026-10-01")).toMatchObject({ packChecks: "none", checks: [], notice: "自己点検であって、審査の判断ではない" });
    expect(TOOLS.check_results.output.safeParse(checkResultsOf({ ...p, packId: "night-soil" }, 1, "2026-10-01")).success).toBe(true);
    clearWorkingPlan();
    expect(runTabTool(ws, "check_results", {}, CTX)).toEqual({ ok: false, code: "no_working_plan" });
  });
});

describe("業種の語は検査のコードと画面の言葉に無い（パックに置く）", () => {
  test("ごみ焼却のパックの語彙・1 段目の項目・検査が選ぶ作業の名前・尺度の名前（2 文字以上、NFKC）が、どれも出ない", () => {
    const words = new Set<string>();
    const add = (s: unknown) => {
      if (typeof s !== "string") return;
      const t = s.normalize("NFKC").trim();
      if (t.length >= 2 && !/^[\x00-\x7f]+$/.test(t)) words.add(t);
    };
    const walk = (n: unknown, keys: string[]) => {
      if (Array.isArray(n)) n.forEach((x) => walk(x, keys));
      else if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) (keys.includes(k) && typeof v === "string" ? add(v) : walk(v, keys));
    };
    walk(JSON.parse(readFileSync(`packs/${PACK}/common.json`, "utf8")), ["name"]);
    const checks = JSON.parse(readFileSync(`packs/${PACK}/checks.json`, "utf8"));
    for (const c of checks.checks) {
      for (const w of c.params.works ?? []) for (const v of w.values) add(v);
      add(c.params.scale);
    }
    expect(words.size).toBeGreaterThan(30);
    const files = ["src/review/spec.ts", "src/review/checks.ts", "src/app/state/review.ts", "src/app/text/review.ts", "src/app/pages/Review.tsx"];
    for (const f of files) {
      const text = readFileSync(f, "utf8").normalize("NFKC");
      for (const w of words) expect(text.includes(w), `${f} に「${w}」`).toBe(false);
    }
  });
});
