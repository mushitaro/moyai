// EXPORT の下の帯の押せない理由（docs/screens.md 3.5・§4 の 5）。押せないボタンには、いつも「理由：」の 1 行をボタンのすぐ左に出す。
// 画面の決め方を純粋な関数にする（試験で縛るため）。順は、ブリッジ → 計画 → 版の読込 → 確定版 → 署名と鎖。

export type ExportBlock =
  | { kind: "notConnected" }
  | { kind: "noPlan" }
  | { kind: "loading" }
  | { kind: "loadError"; message: string }
  | { kind: "notConfirmed" }
  | { kind: "broken" };

export interface ExportBlockInput {
  connected: boolean;
  hasPlan: boolean;
  /** 版の一覧（plan_status）の読込 */
  load: { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };
  hasLatest: boolean;
  broken: boolean;
}

/** 標準の出力・差分の出力を止めている理由（無ければ null） */
export function exportBlockOf(i: ExportBlockInput): ExportBlock | null {
  if (!i.connected) return { kind: "notConnected" };
  if (!i.hasPlan) return { kind: "noPlan" };
  if (i.load.kind === "loading") return { kind: "loading" };
  if (i.load.kind === "error") return { kind: "loadError", message: i.load.message };
  if (!i.hasLatest) return { kind: "notConfirmed" };
  if (i.broken) return { kind: "broken" };
  return null;
}

/** 理由の字（頭に「理由：」を付ける。すでに付いていれば重ねない） */
export function withReasonHead(text: string): string {
  return text.startsWith("理由：") ? text : `理由：${text}`;
}
