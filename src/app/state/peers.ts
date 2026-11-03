// 人が星取表で開いた、似た施設との比べ（受け手の側。§2.8 受け取りと 3 つの立場）。作業中の計画と同じく、このタブのメモリにだけ置く。
// AI のツール（peer_reference）は、人が画面で開いたこの比べだけを読む。どの場を、どの見え方で比べるかを AI に選ばせない。
import type { Comparison } from "../../share/receive";

export interface PeerView {
  comparison: Comparison;
  /** 比べたときのパック */
  packId: string;
}

let current: PeerView | null = null;
const listeners = new Set<() => void>();

export function setPeerView(v: PeerView | null): void {
  current = v;
  for (const l of listeners) l();
}

export function getPeerView(): PeerView | null {
  return current;
}

export function subscribePeerView(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
