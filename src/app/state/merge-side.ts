// MERGE の横の板（docs/screens.md 3.2）：板は 1 枚で、切り替えは「決まっていない所 / 署名 / 出どころ」。
// 星取表のシートは、出どころをこの板の中へ描き（React の portal）、印を選んだら板を出どころへ切り替える。
import { createContext } from "react";

export interface MergeSide {
  /** 出どころを描く場所（板が出どころを出していないあいだも、隠して残す） */
  el: HTMLElement | null;
  /** 板を出どころへ切り替える */
  show(): void;
  /** 星取表で選んだ行（コメントを付ける先）。選んでいなければ null */
  select(row: CommentRow | null): void;
  /** コメントの付いた行（行の切り替え × 行の鍵 → 番号の字「①②」） */
  commentMarks: ReadonlyMap<string, string>;
}

/** コメントを付ける星取表の行 */
export interface CommentRow {
  mode: "ledger" | "common";
  id: string;
  label: string;
}

export const commentMarkKey = (mode: string, id: string): string => `${mode}\u0000${id}`;

export const MergeSideContext = createContext<MergeSide | null>(null);

/** 比べる版（docs/screens.md 3.2「比べる版　第 n 版」）：編集する人は保管先のいちばん新しい版、承認を頼まれた人はそのひとつ前の版 */
export interface MergeCompare {
  version: number;
  plan: import("../../shared/plan").Plan;
}

export const MergeCompareContext = createContext<MergeCompare | null>(null);

/** 似た施設を重ねるか（MERGE の見出しの「似た施設　重ねる / 外す」。既定は外す）。MERGE の外では null */
export const MergePeersContext = createContext<boolean | null>(null);
