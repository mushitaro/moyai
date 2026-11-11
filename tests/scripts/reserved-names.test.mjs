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
  // docs/plan.md §2.13 の 12 と、§2.17 の読み方の 3（reading_rules_propose・reading_skill_register・reading_skills_list）と、
  // 運営者の決定 11-06「チャットだけで入れる・デモする・消す」の資料を作業画面に入れる 1（intake_add_files）と、
  // 運営者の決定 11-07「利用者の想定のプロンプトで、アプリがチャットだけで動く」の作業画面の見せ方を変える 1（screen_set）と、
  // mushitaro/moyai#65「入っている MOYAI を最新にする」の 1（moyai_update）
  assert.ok(names.length <= 18, `ツールは 18 以下: ${names.length}`);
});
