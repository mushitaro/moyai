// 取り込みの層 1〜4（docs/plan.md §2.3）。入口は IntakeSession。
export { IntakeSession, type Analysis, type IntakeOptions, type Survey } from "./session";
export { readSource, type InputFile, type ReadOutcome } from "./read";
export type { Decision, Question, QuestionState, QuestionKind, QuestionItem } from "./questions";
export type { Composition, FileCounts, CellStatus, CheckResult } from "./compose";
export type { SourceFile, SheetGrid, GridCell, LedgerEntry, RejectedFile, PageInfo } from "./grid";
export { renderPdfPage, type PageImage } from "./pdf";
export { PhotoBook, scannedPageInput, photoState, type PhotoEntry, type PhotoInput, type PhotoReading, type PhotoState } from "./photo";
