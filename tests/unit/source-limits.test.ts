// 資料の上限（台帳の新-6）：版を組んだ資料の 1 つの上限は、取り込みの 1 ファイルの上限と同じ。
// 人だけの経路 plan_source_put は、その大きさの base64 を受けられる。合計の上限は 1 つの上限より大きい
import { expect, test } from "vitest";
import { MAX_FILE_BYTES } from "../../src/app/intake/workspace";
import { SOURCE_MAX_BYTES, SOURCES_TOTAL_MAX_BYTES } from "../../src/bridge/sources";
import { ROUTES } from "../../src/shared/routes";

test("資料の上限は取り込みとそろい、経路の大きさは base64 の分を受けられる", () => {
  expect(SOURCE_MAX_BYTES).toBe(MAX_FILE_BYTES);
  expect(SOURCES_TOTAL_MAX_BYTES).toBeGreaterThanOrEqual(SOURCE_MAX_BYTES * 4);
  expect(ROUTES.planSourcePut.maxBody).toBeGreaterThan(Math.ceil((SOURCE_MAX_BYTES * 4) / 3) + 1024);
});
