// MERGE の横の板（docs/screens.md 3.2）：板は 1 枚で、切り替えは「決まっていない所 / 署名 / 出どころ」。
// 星取表のシートは、出どころをこの板の中へ描き（React の portal）、印を選んだら板を出どころへ切り替える。
import { createContext } from "react";

export interface MergeSide {
  /** 出どころを描く場所（板が出どころを出していないあいだも、隠して残す） */
  el: HTMLElement | null;
  /** 板を出どころへ切り替える */
  show(): void;
}

export const MergeSideContext = createContext<MergeSide | null>(null);
