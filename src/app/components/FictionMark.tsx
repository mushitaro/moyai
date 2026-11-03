// 架空のデータを出すときの「【架空】」の印。架空のデータの画面には常に出す。
import { TEXT } from "../text";

export function FictionMark() {
  return (
    <span className="moyai-fiction" data-testid="fiction-mark">
      {TEXT.fictionMark}
    </span>
  );
}
