// scripts/skill-loop/app-feedback.mjs の型（試験と受け口の TS から読むため）。
export declare const APP_LABEL: string;
export declare const OPERATOR_LABEL: string;
export declare const APP_HEAD: { note: string; facts: string };
export declare const REPLY_MAX: number;
export declare function noteOf(body: string): string | null;
export declare function factsOf(body: string): { version: string | null; screen: string | null; os: string | null; lang: string | null };
export declare function readAppIssue(issue: { number?: number; title?: string; body?: string; labels?: (string | { name: string })[] }): any;
export declare function replyText(fixed: string, pr: number): string | null;
export declare function main(argv: string[]): number;
