// ヘッダの「Claude と並べる」（docs/screens.md §1）の、橋渡しとタブの間の答えの形。
// 道は ROUTES.tabWindowArrange（POST、体は無し）。答えは { ok: true } か { ok: false, reason }。

export const WINDOW_ARRANGE_REASONS = ["no_claude_window", "not_windows", "failed"] as const;
export type WindowArrangeReason = (typeof WINDOW_ARRANGE_REASONS)[number];
export type WindowArrangeResult = { ok: true } | { ok: false; reason: WindowArrangeReason };

/** 橋渡しの答えの体を読む。形が違えば null（読めない答えを、並べたことにしない）。 */
export function readWindowArrangeBody(body: unknown): WindowArrangeResult | null {
  if (body === null || typeof body !== "object") return null;
  const b = body as { ok?: unknown; reason?: unknown };
  if (b.ok === true) return { ok: true };
  if (b.ok === false && typeof b.reason === "string" && (WINDOW_ARRANGE_REASONS as readonly string[]).includes(b.reason)) {
    return { ok: false, reason: b.reason as WindowArrangeReason };
  }
  return null;
}
