// 計画のSkillパックの印（Plan.packId）：印の形か、空（パックなし。mushitaro/moyai#67）だけ。道の区切り・`..`・長すぎる字は断る
import { describe, expect, it } from "vitest";
import { Plan } from "../../src/shared/plan";
import { plan } from "./share/fixtures";

describe("計画のSkillパックの印", () => {
  const p = plan({ assets: [], works: [], details: [] });
  it("印の形と空（パックなし）は通す", () => {
    for (const packId of ["waste-incineration", "night-soil", "a", "", "a".repeat(64)]) expect(Plan.safeParse({ ...p, packId }).success, packId).toBe(true);
  });
  it("道の区切り・`..`・長すぎる字・大文字・空白・数字で始まる印は断る", () => {
    for (const packId of ["../x", "a/b", "a\\b", "..", ".", "a".repeat(65), "Waste", "a b", " a", "1pack", "-a", "a\u0000"]) {
      expect(Plan.safeParse({ ...p, packId }).success, JSON.stringify(packId)).toBe(false);
    }
  });
});
