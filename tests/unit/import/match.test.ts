// 突き合せ（src/import/match.ts）：工場の資料（機器台帳・星取表・作業日報）を読んで結んだ作業を、資料ごとに並べる。
// 作者を「人」にするのは、試験の台本が人の操作の代わりに押すため（tests/unit/import/ の台本と同じ）。
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { IntakeSession } from "../../../src/import";
import { matchRows } from "../../../src/import/match";
import { loadTruth, runScript } from "./truth";

const PACK = "waste-incineration";
const FACILITY = "fictional-1";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];

async function linked() {
  const t = loadTruth(PACK, FACILITY);
  const s = new IntakeSession({
    planId: `plan-${FACILITY}`,
    displayName: t.world.facility.name,
    packId: PACK,
    facility: { facilityKey: FACILITY, name: t.world.facility.name, fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
  });
  const dir = `samples/out/${PACK}/${FACILITY}/`;
  await s.add(FILES.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(dir + n)) })));
  runScript(s, t);
  return s.analyze().linked;
}

describe("突き合せ", () => {
  test("結んだ作業を資料ごとに並べ、一致・片方だけ・食い違いに分ける", async () => {
    const l = await linked();
    const m = matchRows(l, "記録あり");
    expect(m.rows.length).toBeGreaterThan(0);
    // 数は結果ごとの行の数と合う
    expect(m.counts.ok + m.counts.one + m.counts.diff).toBe(m.rows.length);
    // 星取表と作業日報の両方に出る作業がある（資料をまたいで結べた）
    expect(m.files).toEqual(expect.arrayContaining(["daily-report.csv", "plan-hoshitori.xlsx"]));
    expect(m.counts.ok).toBeGreaterThan(0);
    for (const r of m.rows) {
      const names = Object.keys(r.cells);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(m.files).toContain(n);
      if (r.result === "one") expect(r.onlyIn).toBe(names[0]);
      else expect(names.length).toBeGreaterThanOrEqual(2);
      // 食い違いは、星取表が計画のまま（○）で、日報に実施があるもの
      if (r.result === "diff") expect(r.cells["plan-hoshitori.xlsx"]).toBe("○");
    }
    // 結ぶかどうかの答えを待っているもの・外したものは並べない
    const shown = new Set(m.rows.map((r) => r.id));
    for (const x of l.links.filter((k) => k.mode === "pending" || k.mode === "excluded")) expect(shown.has(x.job.id)).toBe(false);
  });

  test("日付は月/日、期間は始まり〜終わり、日付が無ければ渡した言葉", () => {
    const unit = (file: string, start: string | null, end: string | null) => ({ file, start, end, workName: "点検" });
    const job = (id: string, units: ReturnType<typeof unit>[]) => ({ id, fiscalYear: 2025, units });
    const cluster = { name: "焼却炉" };
    const fake = {
      links: [
        { mode: "eventOnly", cluster, mark: null, job: job("j1", [unit("日報.csv", "2025-04-12", "2025-04-12")]) },
        { mode: "eventOnly", cluster, mark: null, job: job("j2", [unit("報告書.pdf", "2025-06-01", "2025-06-20"), unit("日報.csv", null, null)]) },
        { mode: "mark", cluster, mark: { file: "星取表.xlsx", symbol: "○", planOrActual: "plan" }, job: job("j3", [unit("日報.csv", "2025-09-03", null)]) },
        { mode: "pending", cluster, mark: null, job: job("j4", [unit("日報.csv", "2025-10-01", null)]) },
      ],
    } as unknown as Parameters<typeof matchRows>[0];
    const m = matchRows(fake, "記録あり");
    const by = new Map(m.rows.map((r) => [r.id, r]));
    expect(by.get("j1")).toMatchObject({ result: "one", onlyIn: "日報.csv", cells: { "日報.csv": "4/12" } });
    expect(by.get("j2")).toMatchObject({ result: "ok", cells: { "報告書.pdf": "6/1〜6/20", "日報.csv": "記録あり" } });
    expect(by.get("j3")).toMatchObject({ result: "diff", cells: { "星取表.xlsx": "○", "日報.csv": "9/3" } });
    expect(by.has("j4")).toBe(false);
    expect(m.counts).toEqual({ ok: 1, one: 1, diff: 1 });
  });
});
