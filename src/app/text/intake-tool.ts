// 取り込みの要約（intake_survey の結果。AI に渡る）の注記。AI が読む文なので訳さない（英語の画面でも同じ字。text/index.ts の intake.ai）。
export const INTAKE_TOOL_TEXT = {
  /** 要約の注記（AI に渡す）：資料の読込の途中に要約を読んだとき */
  readingNote: (done: number, total: number) => `資料の読込の途中（${done}/${total}）。まだ読んでいない資料は、この要約に入っていない`,
};
