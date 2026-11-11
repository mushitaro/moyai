// 右下のビルドの印。日時とコミットはビルドのときに埋める（vite.config.ts）。
// 橋渡しのビルド（bridge.welcome の build）が画面のビルドと違えば、印を朱にするだけ（説明の文は置かない。引き算。#43）。
// 橋渡しが版を送らない（前の版の橋渡し）ときと、つながっていないときは、今の色のまま。
import { TEXT } from "../text";

/** 橋渡しと画面のビルドが違うか。どちらかの版が分からなければ違うと言わない */
export function buildsDiffer(screen: string, bridge: string | undefined): boolean {
  if (!bridge || !screen || screen === "unknown" || bridge === "unknown") return false;
  return screen !== bridge;
}

export function BuildStamp({ bridgeBuild }: { bridgeBuild?: string | undefined } = {}) {
  const differ = buildsDiffer(__MOYAI_BUILD__.commit, bridgeBuild);
  return (
    <div className="moyai-build-stamp" data-testid="build-stamp" data-differ={differ ? "true" : undefined}>
      {TEXT.buildStamp(__MOYAI_BUILD__.time, __MOYAI_BUILD__.commit)}
    </div>
  );
}
