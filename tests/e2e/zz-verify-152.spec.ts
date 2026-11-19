// 使い捨て（枝 claude/verify-152-artifact だけ。main に入れない）：わざと落ちて、CI の e2e-failures の成果物に error-context.md が入るかを見る（#152）
import { expect, test } from "@playwright/test";

test("わざと落ちる（#152 の確かめ）", async ({ page }) => {
  await page.setContent("<p data-testid='x'>【架空】確かめ</p>");
  await expect(page.getByTestId("x")).toHaveText("違う字", { timeout: 1000 });
});
