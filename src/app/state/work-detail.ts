// 整備の詳細を、ほかのシート（費用の「差異の上位」）から開く頼み（docs/screens.md 3.8・3.9）。
// 頼みを置いてから星取表のシートへ移り、星取表は描いたときに頼みを受け取って整備の詳細を開く（1 回だけ）
let pending: string | null = null;

export function requestWorkDetail(workKey: string): void {
  pending = workKey;
}

export function takeWorkDetailRequest(): string | null {
  const w = pending;
  pending = null;
  return w;
}
