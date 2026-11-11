// 右下のビルドの印。日時とコミットはビルドのときに埋める（vite.config.ts）。
// 橋渡しのビルド（bridge.welcome の build）が画面のビルドと違えば、印を朱にするだけ（説明の文は置かない。引き算。#43）。
// 入っている MOYAI の次の版が用意できた（bridge.next。#65）ときも、朱にするだけ。切り替えは次の起動。
// 橋渡しが版を送らない（前の版の橋渡し）ときと、つながっていないときは、今の色のまま。
import { TEXT } from "../text";

/** 橋渡しと画面のビルドが違うか。どちらかの版が分からなければ違うと言わない */
export function buildsDiffer(screen: string, bridge: string | undefined): boolean {
  if (!bridge || !screen || screen === "unknown" || bridge === "unknown") return false;
  return screen !== bridge;
}

/** 入っている MOYAI の次の版が用意できたか（#65。切り替えは次の起動）。今のビルドと同じ版なら言わない */
export function nextReady(screen: string, next: string | undefined): boolean {
  if (!next) return false;
  const s = screen.replace(/\+$/, "");
  return !(s && s !== "unknown" && (next.startsWith(s) || s.startsWith(next)));
}

export function BuildStamp({ bridgeBuild, bridgeNext }: { bridgeBuild?: string | undefined; bridgeNext?: string | undefined } = {}) {
  const differ = buildsDiffer(__MOYAI_BUILD__.commit, bridgeBuild) || nextReady(__MOYAI_BUILD__.commit, bridgeNext);
  return (
    <div className="moyai-build-stamp" data-testid="build-stamp" data-differ={differ ? "true" : undefined}>
      {TEXT.buildStamp(__MOYAI_BUILD__.time, __MOYAI_BUILD__.commit)}
    </div>
  );
}
