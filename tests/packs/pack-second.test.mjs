// pack.second の前半（docs/plan.md §2.7・§5.1）：し尿処理のパックを足したコミットに、src/ の変更が無い。
// パックを足すときにコードを足さないことを、履歴で確かめる（CI は履歴を全部取る。取れなければ失敗にする）。
// 後半（そのパックで取り込み → 当てはめ → 星取表が通る）は tests/unit/packs/night-soil-slice.test.ts。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

test("履歴が全部ある（浅い clone では、この試験は確かめられない）", () => {
  assert.equal(git("rev-parse", "--is-shallow-repository").trim(), "false", "CI の checkout は fetch-depth: 0 にする");
});

// 例外（名指しする。増やすときは理由と、night-soil で変えたファイルを書く）：
// - bc611a4（2026-11-06）：Skillパックの言葉の置き換え（段→階層。Wire の答え）を、同じコミットで src/cli/setup.ts と一緒に入れた。
//   night-soil で変えたのは SKILL.md の言葉だけで、パックを足すためのコードではない。下で、night-soil の変更が SKILL.md だけであることを確かめる
const EXEMPT = new Map([["bc611a4", ["packs/night-soil/SKILL.md"]]]);

test("packs/night-soil/ に触れたコミットは、どれも src/ に触れていない", () => {
  const commits = git("log", "--format=%H", "--no-merges", "--", "packs/night-soil/").split("\n").filter(Boolean);
  assert.ok(commits.length > 0, "packs/night-soil/ に触れたコミットが見つからない");
  for (const c of commits) {
    const exempt = EXEMPT.get(c.slice(0, 7));
    if (exempt) {
      const ns = git("show", "--name-only", "--format=", c).split("\n").filter((f) => f.startsWith("packs/night-soil/"));
      assert.deepEqual(ns, exempt, `${c.slice(0, 7)} は例外だが、night-soil で変えたファイルが例外の理由と違う`);
      continue;
    }
    const files = git("show", "--name-only", "--format=", c).split("\n").filter(Boolean);
    const src = files.filter((f) => f.startsWith("src/"));
    assert.deepEqual(src, [], `${c.slice(0, 7)} が src/ にも触れている`);
  }
});
