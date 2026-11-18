// scripts/skill-loop/values.mjs の型（受け口の TS から読むため）。
export declare const VALUE_KINDS: Record<string, string>;
export declare function countValues(texts: readonly unknown[]): Record<string, number>;
export declare function ruleTexts(rule: unknown): string[];
export declare function countableRuleBlock(text: unknown): string;
export declare const NOTE_KINDS: Record<string, string>;
export declare function countNote(text: unknown): Record<string, number>;
