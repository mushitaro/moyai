// SHARE の送信経路（docs/screens.md §3.6「送信経路」、Wire 11-07）：GitHub［名］か MOYAI 経由か。画面の決め方を純粋な関数にする（試験で縛るため）。
// - MOYAI 経由は、受け口の URL が決まっているときだけ選べる。
// - 既定は、GitHub につないでいれば GitHub［名］、いなければ MOYAI 経由。人が選んだ経路は施設（計画）ごとに覚え、つないでいるあいだはそれを使う。
// - MOYAI 経由では、GitHub に未接続（noKey）を押せない理由にしない。

export type ShareRoute = "github" | "intake";

export interface RouteInput {
  /** GitHub につないだアカウント名（つないでいなければ null） */
  login: string | null;
  /** MOYAI 経由（受け口）があるか */
  intake: boolean;
  /** 人が前に選んだ経路（施設ごとに覚えたもの。無ければ null） */
  chosen: ShareRoute | null;
}

/** いま効いている送信経路 */
export function shareRouteOf(i: RouteInput): ShareRoute {
  if (!i.intake) return "github";
  if (!i.login) return "intake";
  return i.chosen ?? "github";
}

/** 経路ごとの押せない理由（MOYAI 経由では GitHub の未接続を数えない） */
export function routeBlockers(route: ShareRoute, blockers: readonly string[]): string[] {
  return route === "intake" ? blockers.filter((b) => b !== "noKey") : [...blockers];
}

/** 道の最後の名前（末尾の区切りは除く。Windows と POSIX の両方の区切り） */
export function lastSegment(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/**
 * 共有フォルダの選びに出す名前：設定で選んだフォルダ（root）の最後の名前。共有フォルダの型に名前の欄は無いので、内部の ID は出さない。
 * 同じ名前が 2 つ以上あれば、ID の頭 4 字を括弧で添えて分ける（選びの値は ID のまま）
 */
export function ringLabels(rings: readonly { ringId: string; root: string }[]): Map<string, string> {
  const count = new Map<string, number>();
  for (const r of rings) count.set(lastSegment(r.root), (count.get(lastSegment(r.root)) ?? 0) + 1);
  return new Map(rings.map((r) => [r.ringId, (count.get(lastSegment(r.root)) ?? 0) > 1 ? `${lastSegment(r.root)}（${r.ringId.slice(0, 4)}）` : lastSegment(r.root)]));
}
