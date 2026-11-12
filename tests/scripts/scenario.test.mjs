// シナリオテストのランナーの判定（scripts/scenario/marks.mjs）。合格の条件を甘くしていないことを確かめる。
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  B2_REFUSALS,
  FAIL,
  MARKS,
  PASS,
  UNKNOWN,
  WAIT,
  judgeA1,
  judgeA3,
  judgeB1,
  judgeB2,
  judgeC1,
  judgeC3,
  C1_REQUIRED,
  judgeD1,
  judgeD2,
  judgeD3,
  judgeE2,
  judgeE2FromCi,
  judgeWaiting,
  readManual,
  renderResult,
  summarizePlaywright,
} from "../../scripts/scenario/marks.mjs";

const fac = (planMade, open, error = null) => ({ facility: "x", planMade, open, error });

describe("A1：物差し", () => {
  it("全施設で計画・開いた問い 0・記録と同じなら合格。1 つでも欠ければ不合格", () => {
    const all = { facilities: [fac(true, 0), fac(true, 0)] };
    assert.equal(judgeA1(all, { same: true, detail: "" }).status, PASS);
    assert.equal(judgeA1({ facilities: [fac(true, 0), fac(false, 0)] }, { same: true, detail: "" }).status, FAIL);
    assert.equal(judgeA1({ facilities: [fac(true, 0), fac(true, 1)] }, { same: true, detail: "" }).status, FAIL);
    assert.equal(judgeA1({ facilities: [fac(true, 0, "boom")] }, { same: true, detail: "" }).status, FAIL);
    assert.equal(judgeA1(all, { same: false, detail: "" }).status, FAIL);
    assert.equal(judgeA1(all, { same: null, detail: "" }).status, UNKNOWN);
    assert.equal(judgeA1({ facilities: [] }, { same: true, detail: "" }).status, FAIL);
    assert.match(judgeA1({ facilities: [fac(true, 0), fac(false, 3)] }, { same: true, detail: "d" }).evidence, /計画 1\/2 施設・開いたままの問い 3/);
  });
});

describe("A3：初めて読む物差し", () => {
  const f = (planMade, firstAsked, restAsked, restYears) => ({ facility: "x", planMade, error: null, firstRead: { firstAsked, restAsked, restYears } });
  it("測った施設すべてで計画ができ、残りの 1 年あたりの問いが 1 年目の 1 割以下のときだけ合格", () => {
    const ok = { same: true, detail: "" };
    assert.equal(judgeA3({ facilities: [f(true, 100, 30, 3)] }, ok).status, PASS);
    assert.equal(judgeA3({ facilities: [f(true, 100, 31, 3)] }, ok).status, FAIL);
    assert.equal(judgeA3({ facilities: [f(false, 100, 3, 3)] }, ok).status, FAIL);
    assert.equal(judgeA3({ facilities: [f(true, 100, 0, 0)] }, ok).status, FAIL);
    assert.equal(judgeA3({ facilities: [f(true, 100, 30, 3)] }, { same: false, detail: "" }).status, FAIL);
    assert.equal(judgeA3({ facilities: [f(true, 100, 30, 3)] }, { same: null, detail: "" }).status, UNKNOWN);
    // 年度ごとの資料の無い施設（firstRead が無い）は数えない。測った施設が 0 なら不合格
    assert.equal(judgeA3({ facilities: [{ facility: "y", planMade: false }] }, ok).status, FAIL);
    assert.equal(judgeA3({ facilities: [{ facility: "y", planMade: false }, f(true, 100, 3, 3)] }, ok).status, PASS);
  });
});

describe("待ち・B1・B2", () => {
  it("作られていない印は待ち。Issue が閉じたのに道が無ければ未確認（合格にしない）", () => {
    assert.equal(judgeWaiting("x", null).status, WAIT);
    assert.equal(judgeWaiting("x", { number: 22, state: "open" }).status, WAIT);
    assert.equal(judgeWaiting("x", { number: 22, state: "closed" }).status, UNKNOWN);
  });
  it("B1：台帳が moyai-ledger でなければ待ち。試験が落ちれば不合格。両方そろって合格", () => {
    const ok = { total: 3, passed: 3, failed: 0 };
    assert.equal(judgeB1({ repo: "o/moyai" }, ok).status, WAIT);
    assert.equal(judgeB1({ repo: "o/moyai-ledger" }, ok).status, PASS);
    assert.equal(judgeB1({ repo: "o/moyai-ledger" }, { total: 3, passed: 2, failed: 1 }).status, FAIL);
    assert.equal(judgeB1({ repo: "o/moyai-ledger" }, { total: 0, passed: 0, failed: 0 }).status, FAIL);
    assert.equal(judgeB1({ repo: "o/moyai-ledger" }, null).status, UNKNOWN);
  });
  it("B2：断る試験（数の上限・転送・鍵の取り違え）が無くなれば不合格", () => {
    const unit = B2_REFUSALS.map((x) => ({ title: `…${x.title}…`, status: "passed" }));
    assert.equal(judgeB2({ ok: true, total: 1 }, unit).status, PASS);
    assert.equal(judgeB2({ ok: true, total: 1 }, unit.slice(1)).status, FAIL);
    assert.equal(judgeB2({ ok: true, total: 1 }, [...unit.slice(1), { ...unit[0], status: "failed" }]).status, FAIL);
    assert.equal(judgeB2({ ok: false, total: 1 }, unit).status, FAIL);
    assert.equal(judgeB2(null, unit).status, UNKNOWN);
  });
});

describe("C1・C3：Skill の進化", () => {
  it("C1：名指しの試験（良くなる案・退行のある案・行の値）が全部通ったときだけ合格", () => {
    const all = [...C1_REQUIRED.map((h) => ({ name: `${h}：…`, status: "passed" })), { name: "ほか", status: "passed" }];
    assert.equal(judgeC1(all).status, PASS);
    assert.equal(judgeC1(all.slice(1)).status, FAIL);
    assert.equal(judgeC1([...all, { name: "x", status: "failed" }]).status, FAIL);
    assert.equal(judgeC1([]).status, FAIL);
    assert.equal(judgeC1(null).status, UNKNOWN);
  });
  it("C3：芯の試験が通っても、アプリの経路が無ければ待ち。経路があっても、ランナーに通しの試験が無いうちは未確認（合格にしない）", () => {
    assert.equal(judgeC3({ passed: 4, total: 4 }, false).status, WAIT);
    assert.equal(judgeC3({ passed: 3, total: 4 }, false).status, FAIL);
    assert.equal(judgeC3({ passed: 4, total: 4 }, true).status, UNKNOWN);
  });
});

const report = (rows) => ({
  suites: rows.map(([file, status, title = "t"]) => ({ file, specs: [{ title, file, tests: [{ status }] }], suites: [] })),
});

describe("D1・D2：e2e の報告", () => {
  it("ファイルごとに、通った・落ちた・飛ばしたを数える", () => {
    const m = summarizePlaywright(report([["a.spec.ts", "expected"], ["a.spec.ts", "unexpected"], ["b.spec.ts", "skipped", "写し"]]));
    assert.deepEqual(m["a.spec.ts"], { expected: 1, unexpected: 1, flaky: 0, skipped: 0, skippedTitles: [] });
    assert.deepEqual(m["b.spec.ts"].skippedTitles, ["写し"]);
  });
  it("D1：数える台本が無い・落ちた・飛ばしたなら不合格", () => {
    const by = (s) => new Map(Object.entries(summarizePlaywright(report([["one-button.spec.ts", s]]))));
    assert.equal(judgeD1(by("expected"), null).status, PASS);
    assert.equal(judgeD1(by("unexpected"), null).status, FAIL);
    assert.equal(judgeD1(by("skipped"), null).status, FAIL);
    assert.equal(judgeD1(new Map(), null).status, FAIL);
    assert.equal(judgeD1(null, null).status, UNKNOWN);
  });
  it("D2：落ちたものがあれば不合格。飛ばしたもの・名指しの台本の欠け・もう一方の OS の未確認があれば未確認。全部そろって合格", () => {
    const files = [["demo/walkthrough.spec.ts", "expected"], ["mcp.spec.ts", "expected"], ["claude-code.spec.ts", "expected"]];
    const all = new Map(Object.entries(summarizePlaywright(report(files))));
    assert.equal(judgeD2(all, { os: "ubuntu", other: { os: "windows", result: "success" } }).status, PASS);
    assert.equal(judgeD2(all, { os: "ubuntu", other: { os: "windows", result: null } }).status, UNKNOWN);
    assert.equal(judgeD2(all, { os: "ubuntu", other: { os: "windows", result: "failure" } }).status, FAIL);
    const skipped = new Map(Object.entries(summarizePlaywright(report([...files.slice(0, 2), ["claude-code.spec.ts", "skipped"]]))));
    const r = judgeD2(skipped, { os: "ubuntu", other: { os: "windows", result: "success" } });
    assert.equal(r.status, UNKNOWN);
    assert.match(r.evidence, /claude-code\.spec\.ts/);
    const bad = new Map(Object.entries(summarizePlaywright(report([...files, ["x.spec.ts", "unexpected"]]))));
    assert.equal(judgeD2(bad, { os: "ubuntu", other: { os: "windows", result: "success" } }).status, FAIL);
    assert.equal(judgeD2(null, { os: "ubuntu", other: { os: "windows", result: "success" } }).status, UNKNOWN);
  });
});

describe("D3・E2：GitHub", () => {
  it("D3：開いた area:ux が 1 つでもあれば不合格。読めなければ未確認", () => {
    assert.equal(judgeD3([]).status, PASS);
    assert.equal(judgeD3([{ number: 1 }]).status, FAIL);
    assert.equal(judgeD3(null).status, UNKNOWN);
  });
  it("E2：名指しの仕事が全部 success のときだけ合格。scenario の仕事が無ければ不合格", () => {
    const jobs = ["test (ubuntu-latest)", "test (windows-latest)", "pack-bench（Skillパックの物差し）", "scenario", "e2e (ubuntu-latest)"].map((name) => ({ name, conclusion: "success" }));
    assert.equal(judgeE2({ sha: "abcdef0", conclusion: "success", jobs }).status, PASS);
    assert.equal(judgeE2({ sha: "abcdef0", conclusion: "success", jobs: jobs.filter((j) => j.name !== "scenario") }).status, FAIL);
    assert.equal(judgeE2({ sha: "abcdef0", conclusion: "failure", jobs: jobs.map((j, i) => (i === 4 ? { ...j, conclusion: "failure" } : j)) }).status, FAIL);
    assert.equal(judgeE2(null).status, UNKNOWN);
    assert.equal(judgeE2FromCi("refs/pull/1/merge", { a: "success" }).status, UNKNOWN);
    assert.equal(judgeE2FromCi("refs/heads/main", { a: "success", b: "success" }).status, PASS);
    assert.equal(judgeE2FromCi("refs/heads/main", { a: "success", b: "failure" }).status, FAIL);
  });
});

describe("結果の表", () => {
  it("版と日時を書き、全部の印を並べ、実機の列は前の表の字を残す", () => {
    const results = Object.fromEntries(MARKS.filter((m) => m.auto).map((m) => [m.id, { status: WAIT, evidence: "e" }]));
    const first = renderResult(results, { commit: "abc1234", dirty: false, at: "2026-11-12 10:00 JST", os: "ubuntu", ci: false }, null);
    assert.match(first, /版：abc1234/);
    assert.match(first, /日時：2026-11-12 10:00 JST/);
    for (const m of MARKS) assert.match(first, new RegExp(`^\\| ${m.id} \\|`, "m"));
    const withManual = first.replace(/^(\| A4 \|.*\|)\s*\|$/m, "$1 合格（2026-11-13・abc1234）|");
    assert.equal(readManual(withManual).get("A4"), "合格（2026-11-13・abc1234）");
    const second = renderResult(results, { commit: "def5678", dirty: true, at: "x", os: "ubuntu", ci: false }, withManual);
    assert.match(second, /^\| A4 \|.*\| 合格（2026-11-13・abc1234） \|$/m);
    assert.match(second, /作業ツリーに変更あり/);
  });
});
