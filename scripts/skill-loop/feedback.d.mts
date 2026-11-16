// scripts/skill-loop/feedback.mjs の型（試験が TS から読むため。使うところだけ）。
export declare function readForm(body: string): Record<string, string>;
export declare function screen(
  issue: { number?: number; title: string; body: string; labels: (string | { name: string })[] },
  candidate?: unknown[] | null,
  // 返りの形は feedback.mjs の screen の JSDoc（ok が true・false・"draft"）。試験が欄を直に読むので any にする
): any;
