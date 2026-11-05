// scripts/acceptance.mjs：docs/plan.md §5.1 の表を試験の報告から作る。緑でないものを緑と書かない。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAP, REPO, STATUS, fromNode, fromPlaywright, fromVitest, judge, loadMap, planNames, render } from "../../scripts/acceptance.mjs";

const plan = readFileSync(join(REPO, "docs", "plan.md"), "utf8");
const map = loadMap(readFileSync(join(REPO, MAP), "utf8"));

test("§5.1 の表の名前と、対応表の名前が 1 つずつ合う（足りない・余分が無い）", () => {
  const names = planNames(plan);
  assert.ok(names.length > 0, "§5.1 の表から名前を読めない");
  assert.ok(names.includes("verify demo-ring"));
  assert.deepEqual([...map.rows.map((r) => r.name)].sort(), [...names].sort());
});

test("対応表の試験のファイルと道具は、どれもリポジトリにある", () => {
  for (const r of map.rows)
    for (const s of r.sources) {
      assert.ok(["vitest", "node", "playwright", "command"].includes(s.runner), `${r.name}：知らない runner ${s.runner}`);
      assert.ok(existsSync(join(REPO, s.file)), `${r.name}：${s.file} が無い`);
    }
});

const M = {
  rows: [
    { name: "a", sources: [{ runner: "vitest", file: "tests/a.test.ts" }] },
    { name: "b", sources: [{ runner: "vitest", file: "tests/b.test.ts" }, { runner: "node", file: "tests/b.test.mjs" }] },
    { name: "c", sources: [] },
    { name: "d", sources: [{ runner: "playwright", file: "tests/e2e/d.spec.ts" }] },
    { name: "e", sources: [{ runner: "vitest", file: "tests/e.test.ts", title: "e.only" }] },
    { name: "f", sources: [{ runner: "command", file: "scripts/x.mjs" }] },
  ],
};
const vitest = fromVitest(
  {
    testResults: [
      { name: join(REPO, "tests", "a.test.ts"), assertionResults: [{ fullName: "a 1", status: "passed" }, { fullName: "a 2", status: "skipped" }] },
      { name: join(REPO, "tests", "b.test.ts"), assertionResults: [{ fullName: "b 1", status: "passed" }] },
      { name: join(REPO, "tests", "e.test.ts"), assertionResults: [{ fullName: "e.only 1", status: "passed" }, { fullName: "other", status: "failed" }] },
    ],
  },
  REPO,
);
const node = fromNode({ tests: [{ file: join(REPO, "tests", "b.test.mjs"), name: "b n", status: "failed" }] }, REPO);

test("通った・落ちた・試験が無い・測っていない を分ける。名前で絞れる", () => {
  const rows = judge(["a", "b", "c", "d", "e", "f", "g"], M, { vitest, node, playwright: null }, { "scripts/x.mjs": 0 });
  const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
  assert.equal(by.a, STATUS.pass); // 飛ばした試験は数えない
  assert.equal(by.b, STATUS.fail); // 1 つでも落ちれば落ちた
  assert.equal(by.c, STATUS.none); // 対応する試験が無い
  assert.equal(by.d, STATUS.unmeasured); // Playwright の報告が無い
  assert.equal(by.e, STATUS.pass); // 「e.only」の試験だけを数える
  assert.equal(by.f, STATUS.pass); // 道具の終了コード 0
  assert.equal(by.g, STATUS.none); // 対応表に無い名前も「無い」
  assert.equal(rows.find((r) => r.name === "g").scope, "対応表に名前が無い");
});

test("報告に無いファイル・全部飛ばした・道具が落ちた・走らせていない", () => {
  const v = fromVitest({ testResults: [{ name: join(REPO, "tests", "a.test.ts"), assertionResults: [{ fullName: "a", status: "skipped" }] }] }, REPO);
  const rows = judge(["a", "b", "f"], M, { vitest: v, node: [], playwright: null }, { "scripts/x.mjs": 1 });
  const by = Object.fromEntries(rows.map((r) => [r.name, r.status]));
  assert.equal(by.a, STATUS.unmeasured);
  assert.equal(by.b, STATUS.unmeasured);
  assert.equal(by.f, STATUS.fail);
  assert.equal(judge(["f"], M, { vitest: v, node: [], playwright: null }, {})[0].status, STATUS.unmeasured);
});

test("Playwright の報告：ブラウザの組ごとに数え、やり直して通った（flaky）は落ちたに数える", () => {
  const pw = fromPlaywright({
    suites: [
      {
        title: "d.spec.ts",
        file: "d.spec.ts",
        specs: [
          {
            title: "縦の 1 本",
            file: "d.spec.ts",
            tests: [
              { projectName: "chrome", status: "expected" },
              { projectName: "msedge", status: "flaky" },
            ],
          },
        ],
      },
    ],
  });
  assert.equal(pw.length, 2);
  const r = judge(["d"], M, { vitest: [], node: [], playwright: pw })[0];
  assert.equal(r.status, STATUS.fail);
  const ok = judge(["d"], M, { vitest: [], node: [], playwright: pw.map((t) => ({ ...t, status: "passed" })) })[0];
  assert.equal(ok.status, STATUS.pass);
});

test("表には 4 つの結果の数と、試験が無い名前の一覧が出る", () => {
  const rows = judge(["a", "c", "d"], M, { vitest, node, playwright: null });
  const md = render(rows, { date: "2026-11-05", time: "12:00", commit: "abc1234", dirty: false, counts: { node: 1, vitest: 5, playwright: null } });
  assert.match(md, /通った 1・落ちた 0・試験が無い 1・測っていない 1（全 3）/);
  assert.match(md, /Playwright 渡していない（測っていない）/);
  assert.match(md, /試験が無い名前：`c`。/);
  assert.match(md, /\| `a` \| 通った \|/);
});
