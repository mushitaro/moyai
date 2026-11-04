// 派生（docs/screens.md 3.1「この版から別の施設をつくる」）：トップで元の版を選んで作った、新しい施設の作業中の計画。
// 第 1 版に署名するとき、署名のダイアログがここから元の計画・版・中身のハッシュを読んで送る（橋渡しが確かめて版の記録に書く）。
// このタブのメモリだけに持つ（第 1 版に署名したら消す）。

export interface PendingDerive {
  /** 新しい施設の計画の ID */
  planId: string;
  from: { planId: string; version: number; contentHash: string };
}

let pending: PendingDerive | null = null;

export function setPendingDerive(p: PendingDerive | null): void {
  pending = p;
}

/** この計画が派生の第 1 版を待っていれば、その元 */
export function pendingDeriveFor(planId: string): PendingDerive["from"] | null {
  return pending && pending.planId === planId ? pending.from : null;
}
