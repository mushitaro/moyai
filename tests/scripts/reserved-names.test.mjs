import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

// 使わない名前の一覧（運営者が渡したもの。名前だけ）。
const reserved = readFileSync("tests/fixtures/reserved-names.txt", "utf8")
  .split(/\r?\n/)
  .map((s) => s.trim())
  .filter((s) => s && !s.startsWith("#"));

test("使わない名前の一覧が読める", () => {
  assert.ok(reserved.length >= 30, `一覧が短すぎる: ${reserved.length}`);
});

// MOYAI の MCP のツール名は src/shared/tool-names.json に 1 か所で置く（ツール定義ができたら、そこから作る）。
test("MOYAI のツール名が使わない名前と 1 つも一致しない", (t) => {
  const file = "src/shared/tool-names.json";
  if (!existsSync(file)) {
    t.skip("ツールの定義がまだ無い（未実装）");
    return;
  }
  const names = JSON.parse(readFileSync(file, "utf8"));
  const hits = names.filter((n) => reserved.includes(n));
  assert.deepEqual(hits, []);
  assert.ok(names.length <= 12, `ツールは 12 以下: ${names.length}`);
});
