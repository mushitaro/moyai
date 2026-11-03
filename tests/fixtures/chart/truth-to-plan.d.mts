// truth-to-plan.mjs の型（試験だけの道具）
import type { Plan } from "../../../src/shared/plan";
export declare const FIXTURES: Record<"fictional-1" | "fictional-2", { levelNames: string[]; pending: string[] }>;
export declare function truthToPlan(id: "fictional-1" | "fictional-2", opts?: { scale?: number }): Plan;
export declare const DEV_PLANS: Record<"fictional-1" | "fictional-2" | "fictional-1-x40", () => Plan>;
export declare const DEV_PLAN_DIR: string;
