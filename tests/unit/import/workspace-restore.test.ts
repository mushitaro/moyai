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

describe("決定を置く 1 回で、資料を読み直すのは 1 回（Architect の 63）", () => {
  test("AI・人の settle と undo のあと、画面が読むときに読み直さない", async () => {
    const ws = new IntakeWorkspace(settings);
    await ws.addFiles((await file()).map((f) => ({ name: f.name, size: f.bytes.length, bytes: async () => f.bytes })));
    const q = ws.analysis().questions[0];
    const spy = vi.spyOn(IntakeSession.prototype, "analyze");
    if (q) {
      const r = ws.settle([{ questionId: q.questionId, answer: q.defaultAnswer ?? q.options[0]?.id ?? "", author: "ai", reason: "試験" }]);
      expect(r.ok).toBe(true);
      ws.analysis();
      expect(spy.mock.calls.length).toBe(1);
      ws.undo(q.questionId);
      ws.analysis();
      expect(spy.mock.calls.length).toBe(2);
    } else {
      // 質問の出ない資料なら、置く決定が無い（試験の前提が崩れたことを知らせる）
      throw new Error("質問が出なかった");
    }
  });
});
