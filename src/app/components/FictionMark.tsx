// 架空のデータを出すときの「架空」の札（タグの形の印＋朱の字）。架空のデータの画面には常に出す。
// 置いた画面の中ではなく、状態の帯の左の枠に描く（デザイン定義 §10.21）。骨組みの外ではその場に描く。
import { createPortal } from "react-dom";
import { TEXT } from "../text";
import { useFictionSlot } from "./Shell";

export function FictionMark() {
  const slot = useFictionSlot();
  const mark = (
    <span className="moyai-fiction" data-testid="fiction-mark">
      {TEXT.fictionMark}
    </span>
  );
  if (slot === undefined) return mark;
  return slot ? createPortal(mark, slot) : null;
}
