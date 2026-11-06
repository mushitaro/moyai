// 欄の名前の一覧（src/shared/fields.ts）が、計画の型（src/shared/plan.ts の zod）と同じ欄を持つか（Architect の 47）。
// 規則の欄（FIELD_REFS）は Claude が規則に書くので、型に無い欄（前の「workDetail.hours」など）を書けないようにする
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ENTITIES, FIELD_REFS } from "../../src/shared/fields";
import { AssetNode, Facility, Plan, Work, WorkDetail } from "../../src/shared/plan";

const shapeKeys = (s: z.ZodTypeAny): string[] => {
  let t: z.ZodTypeAny = s;
  for (;;) {
    const def = (t as unknown as { _def?: { innerType?: z.ZodTypeAny; type?: unknown } })._def;
    if (t instanceof z.ZodObject) return Object.keys(t.shape);
    if (t instanceof z.ZodArray) t = t.element as z.ZodTypeAny;
    else if (def?.innerType) t = def.innerType;
    else throw new Error("形が読めない");
  }
};

const SCHEMAS = {
  facility: Facility,
  assetNode: AssetNode,
  work: Work,
  workDetail: WorkDetail,
  meter: (Plan as unknown as z.ZodObject<Record<string, z.ZodTypeAny>>).shape.meters!,
} as const;

describe("欄の名前と計画の型", () => {
  for (const [e, schema] of Object.entries(SCHEMAS)) {
    it(e, () => {
      const fields = Object.keys(ENTITIES[e as keyof typeof ENTITIES].fields).sort();
      expect(fields).toEqual(shapeKeys(schema as z.ZodTypeAny).sort());
    });
  }
  it("規則の欄に、組や一覧の欄（作業明細・元の資料・費用の元の資料・要確認）は入らない", () => {
    for (const r of ["workDetail.lines", "workDetail.sources", "workDetail.costSource", "workDetail.needsReview", "workDetail.hours"]) expect(FIELD_REFS as readonly string[]).not.toContain(r);
    expect(FIELD_REFS as readonly string[]).toContain("workDetail.manDays");
  });
});
