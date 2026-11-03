// 右下のビルドの印。日時とコミットはビルドのときに埋める（vite.config.ts）。
import { TEXT } from "../text";

export function BuildStamp() {
  return (
    <div className="moyai-build-stamp" data-testid="build-stamp">
      {TEXT.buildStamp(__MOYAI_BUILD__.time, __MOYAI_BUILD__.commit)}
    </div>
  );
}
