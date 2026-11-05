// 版を戻す・施設の設定を変えるとき、決定はまとめて 1 回で置く（決定の数だけ資料を読み直さない）。
// 1 つずつ置くと、厚い施設ではタブが 45 秒を越えて固まり、橋渡しが「切れた」と見なした（2026-11-06、縦の 1 本の試験の揺れの元）
import { afterEach, describe, expect, test, vi } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { clearWorkingPlan } from "../../../src/app/state/plan-store";
import { IntakeSession } from "../../../src/import/session";
import type { Decision } from "../../../src/import/questions";
import { rows, xlsxOf } from "./helpers";

afterEach(() => {
  clearWorkingPlan();
  vi.restoreAllMocks();
});

const decisions = (n: number): Decision[] => Array.from({ length: n }, (_, i) => ({ questionId: `q${i}`, answer: "a", author: "human", reason: "試験の台本が押した" }));

async function file() {
  const bytes = await xlsxOf((ws) => rows(ws, 1, [["機器", "作業内容", "2024年度"], ["ポンプ", "点検", "●"]]));
  return [{ name: "【架空】星取表.xlsx", bytes }];
}

const settings = { packId: "waste-incineration", facilityName: "【架空】甲工場", fiscalYearStartMonth: 4, fictional: true };

describe("決定をまとめて置く", () => {
  test("版を戻すとき、資料の読み直しの回数は決定の数によらない", async () => {
    const count = async (n: number) => {
      const ws = new IntakeWorkspace(settings);
      const spy = vi.spyOn(IntakeSession.prototype, "analyze");
      await ws.restoreVersion(1, await file(), decisions(n));
      const c = spy.mock.calls.length;
      spy.mockRestore();
      return c;
    };
    const one = await count(1);
    expect(await count(20)).toBe(one);
    expect(one).toBeLessThanOrEqual(2);
  });

  test("施設の設定を変えるときも同じ", async () => {
    const count = async (n: number) => {
      const ws = new IntakeWorkspace(settings);
      await ws.restoreVersion(1, await file(), decisions(n));
      const spy = vi.spyOn(IntakeSession.prototype, "analyze");
      await ws.configure({ ...settings, facilityName: "【架空】乙工場" });
      const c = spy.mock.calls.length;
      spy.mockRestore();
      return c;
    };
    const one = await count(1);
    expect(await count(20)).toBe(one);
  });
});
