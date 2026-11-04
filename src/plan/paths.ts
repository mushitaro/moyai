// 保管先の計画のフォルダの道（docs/plan.md §2.9）。Excel の部品を読まない軽いモジュールに分けた
// （share/facility.ts から使う。試験の道具の読み込みで、計画の保管の重い依存を引かないため）。
import { join } from "node:path";

export const PLAN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function planDir(root: string, planId: string): string {
  if (!PLAN_ID.test(planId)) throw new Error("計画 ID の形でない");
  return join(root, "plans", planId);
}
