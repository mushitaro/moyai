// 星取表のその行・期を開く頼み（確定のシートの台帳案の「| 星取表で見る」。docs/screens.md 3.2、Wire、11-06）。
// 頼みを置いてから星取表のシートへ移り、星取表は描いたときに頼みを受け取って、その行・期を見える所へ送って選ぶ（1 回だけ）。
// 行は、畳んでいて見えなければ親の行で開く（rowIds の前から、見えている最初の行）。

export interface ChartJump {
  mode: "ledger" | "common";
  /** 開く行の鍵（前ほど細かい。見えている最初の行で開く） */
  rowIds: string[];
  /** 期の鍵（fy2026 など）。無ければ行だけ */
  periodKey: string | null;
}

let pending: ChartJump | null = null;

export function requestChartJump(j: ChartJump): void {
  pending = j;
}

export function takeChartJump(): ChartJump | null {
  const j = pending;
  pending = null;
  return j;
}
