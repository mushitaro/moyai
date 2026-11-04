// 作業画面が当てる読み方：下書きと会社・担当者の読み方と、今の施設の読み方だけ（ほかの施設の承認済みの読み方は当てない。Db の重-5）。
// 確定に渡す読み方も同じ（ほかの施設の読み方を今の施設の下へ写し直さない）。施設を替えると、当てる読み方も替わる。
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { getCurrentReadings } from "../../../src/app/state/readings";
import { READING_SCHEMA, type LoadedReading, type ReadingScope } from "../../../src/import/reading";
import { clearWorkingPlan } from "../../../src/app/state/plan-store";

afterEach(() => clearWorkingPlan());

const loaded = (name: string, scope: ReadingScope, owner: string | null): LoadedReading => ({
  skill: { schema: READING_SCHEMA, name, scope, rules: [] },
  version: `v-${name}`,
  path: `x/${name}`,
  approved: true,
  draft: false,
  owner,
});

describe("作業画面が当てる読み方", () => {
  test("今の施設の読み方と会社・担当者の読み方だけを当てる。施設を替えると替わる", async () => {
    const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】甲工場", fiscalYearStartMonth: 4, fictional: true });
    const here = ws.facilityKey();
    ws.setApprovedReadings([loaded("会社", "company", null), loaded("癖", "person", null), loaded("ここ", "facility", here), loaded("よそ", "facility", "f-other")]);
    expect(ws.currentReadings().map((r) => r.skill.name)).toEqual(["会社", "癖", "ここ"]);
    expect(getCurrentReadings().readings.map((r) => r.skill.name)).toEqual(["会社", "癖", "ここ"]);
    await ws.configure({ ...(ws as unknown as { settings: Parameters<IntakeWorkspace["configure"]>[0] }).settings, facilityName: "【架空】乙工場" });
    expect(ws.facilityKey()).not.toBe(here);
    expect(ws.currentReadings().map((r) => r.skill.name)).toEqual(["会社", "癖"]);
    expect(getCurrentReadings().readings.map((r) => r.skill.name)).toEqual(["会社", "癖"]);
  });
});
