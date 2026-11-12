#!/usr/bin/env node
// シナリオテスト（docs/scenarios.md）の自動の印を走らせ、eval/scenario/result.md に書く。
// 新しい試験は作らない：今ある物差し（scripts/bench/）・e2e（tests/e2e・tests/demo）・試験（vitest）を呼び、その結果を marks.mjs が判定する。
//
//   npm run scenario                         この PC で全部（物差し・台帳の試験・e2e と walkthrough〔Chrome〕）。D3・E2 は GH_TOKEN か GITHUB_TOKEN があるときだけ
//   npm run scenario -- --part e2e --out-json <f>   e2e と walkthrough だけを走らせ、ファイルごとの数を <f> に書く（CI の e2e の仕事）。落ちた試験があれば終了コード 1
//   npm run scenario -- --ci --e2e-dir <d>   CI の scenario の仕事：同じ回の仕事の結果（環境変数 MOYAI_CI_*）と、e2e の仕事が書いた <d>/*.json を読む
//   --out <md>    書く先（既定は eval/scenario/result.md）
//   --strict      不合格が 1 つでもあれば終了コード 1（既定は、ランナーが走りきれば 0。表の字が合否）
//
// 判定はコードがする（AI に決めさせない）。試験は一時のフォルダで走る（e2e の helpers・物差しの --out）。
// 行の値・鍵・施設の名前は表に書かない（数と台本の名前だけ）。127.0.0.1 へはランナー自身は何も送らない（e2e の台本が自分で起こした橋渡しに送るだけ）。
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compare } from "../bench/compare.mjs";
import {
  D1_SPEC,
  FAIL,
  MARKS,
  UNKNOWN,
  judgeA1,
  judgeA3,
  judgeB1,
  judgeB2,
  judgeC1,
  judgeC3,
  judgeD1,
  judgeD2,
  judgeD3,
  judgeE2,
  judgeE2FromCi,
  judgeWaiting,
  fileRow,
  renderResult,
  summarizePlaywright,
} from "./marks.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
process.chdir(ROOT);

const args = process.argv.slice(2);
const flag = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
};
const take = (f) => {
  const i = args.indexOf(f);
  if (i < 0) return null;
  const v = args[i + 1];
  if (!v || v.startsWith("--")) {
    console.error(`scenario: ${f} の値が無い`);
    process.exit(2);
  }
  args.splice(i, 2);
  return v;
};
const part = take("--part");
const outJson = take("--out-json");
const e2eDir = take("--e2e-dir");
const outMd = resolve(take("--out") ?? join("eval", "scenario", "result.md"));
const ci = flag("--ci");
const strict = flag("--strict");
if (args.length) {
  console.error(`scenario: 知らない引数 ${args.join(" ")}`);
  process.exit(2);
}

const say = (s) => console.error(`scenario: ${s}`);
const OS = process.platform === "win32" ? "windows" : process.platform === "linux" ? "ubuntu" : process.platform;
const node = (argv, env = {}) => spawnSync(process.execPath, argv, { stdio: ["ignore", "inherit", "inherit"], env: { ...process.env, ...env } });
const work = mkdtempSync(join(tmpdir(), "moyai-scenario-"));

// ---- e2e（tests/e2e を Chrome で 1 回、tests/demo/walkthrough.spec.ts を demo の設定で画面を出さずに 1 回）----

function runE2e() {
  const pw = join("node_modules", "@playwright", "test", "cli.js");
  if (!existsSync(join("dist", "cli.js"))) {
    say("dist/cli.js が無い。先に npm run build");
    return null;
  }
  const shots = join(work, "shots");
  mkdirSync(shots, { recursive: true });
  const runs = [
    { name: "e2e", argv: [pw, "test", "--project=chrome", "--trace", "off", "--reporter=list,json"], env: {} },
    {
      name: "walkthrough",
      argv: [pw, "test", "-c", "playwright.demo.config.ts", "tests/demo/walkthrough.spec.ts", "--trace", "off", "--reporter=list,json"],
      env: { MOYAI_DEMO_HEADLESS: "1", MOYAI_DEMO_SLOWMO: "0" },
    },
  ];
  const files = {};
  let ok = true;
  for (const x of runs) {
    const json = join(work, `${x.name}.json`);
    say(`${x.name} を走らせる`);
    // MOYAI_SHOTS_DIR：写しだけの台本（shots-export-share.spec）も飛ばさずに走らせ、写しは一時のフォルダに置く
    const res = node(x.argv, { ...x.env, PLAYWRIGHT_JSON_OUTPUT_FILE: json, MOYAI_SHOTS_DIR: shots });
    let report = null;
    try {
      report = JSON.parse(readFileSync(json, "utf8"));
    } catch {
      say(`${x.name} の報告を読めない`);
      ok = false;
      continue;
    }
    Object.assign(files, summarizePlaywright(report));
    if (res.status !== 0) ok = false;
  }
  return { os: OS, ok, files };
}

const toMap = (files) => new Map(Object.entries(files ?? {}));

if (part === "e2e") {
  const e = runE2e();
  if (!e) process.exit(2);
  if (outJson) {
    mkdirSync(dirname(resolve(outJson)), { recursive: true });
    writeFileSync(resolve(outJson), JSON.stringify(e, null, 2) + "\n", "utf8");
  }
  rmSync(work, { recursive: true, force: true });
  const bad = Object.values(e.files).reduce((a, r) => a + r.unexpected + r.flaky, 0);
  say(`e2e（${OS}）：落ちた ${bad}`);
  process.exit(e.ok && bad === 0 ? 0 : 1);
} else if (part) {
  console.error(`scenario: --part は e2e だけ`);
  process.exit(2);
}

// ---- 版と日時 ----
const git = (a) => spawnSync("git", a, { encoding: "utf8" }).stdout?.trim() ?? "";
const commit = git(["rev-parse", "--short=7", "HEAD"]) || "不明";
const dirty = git(["status", "--porcelain", "--untracked-files=no"]).length > 0;
const at = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "short" }).format(new Date()) + " JST";

// ---- GitHub（読むだけ。トークンがあるときだけ）----
const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const repo = process.env.GITHUB_REPOSITORY || "mushitaro/moyai";
async function gh(path) {
  if (!token) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "moyai-scenario" },
      redirect: "error",
    });
    if (!res.ok) {
      say(`GitHub ${path.split("?")[0]}：${res.status}`);
      return null;
    }
    return await res.json();
  } catch {
    say(`GitHub ${path.split("?")[0]} に届かない`);
    return null;
  }
}
const issueOf = async (n) => {
  const j = await gh(`/issues/${n}`);
  return j ? { number: n, state: j.state } : null;
};

const results = {};

// ---- A1・A3：物差し（Skillパックあり・初めて読む） ----
/** 測って記録と比べる。CI では pack-bench の仕事が両方を --strict で比べているので、その結果と記録した表を使う */
function bench(label, recorded, extra) {
  const base = JSON.parse(readFileSync(recorded, "utf8"));
  if (ci) {
    const v = process.env.MOYAI_CI_PACK_BENCH ?? "";
    const same = v === "success" ? true : v === "failure" ? false : null;
    return { result: base, strict: { same, detail: same === true ? "pack-bench の仕事で数の差なし（--strict）" : `pack-bench の仕事：${v || "不明"}` } };
  }
  say(`物差しを測る（${label}）`);
  const out = join(work, `bench-${label}`);
  node(["scripts/bench/pack-bench.mjs", "waste-incineration", ...extra, "--out", out]);
  let head = null;
  try {
    head = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
  } catch {
    /* 測れなかった */
  }
  if (!head) return null;
  const c = compare(base, head);
  const detail = c.changed ? `数の差あり（${c.verdict}：${[...c.worse, ...c.better].slice(0, 3).join("、")}）` : "数の差なし（--strict）";
  return { result: head, strict: { same: !c.changed, detail } };
}
{
  const a1 = bench("waste-incineration", join("eval", "bench", "waste-incineration", "result.json"), []);
  results.A1 = a1 ? judgeA1(a1.result, a1.strict) : { status: FAIL, evidence: "物差しを測れなかった" };
  const a3 = bench("first-read", join("eval", "bench", "waste-incineration", "first-read", "result.json"), ["--first-read"]);
  results.A3 = a3 ? judgeA3(a3.result, a3.strict) : { status: FAIL, evidence: "初めて読む物差しを測れなかった" };
}

// ---- C1・C3：Skill の進化の台本と書き出しの芯の試験。C4 は運営者の判断待ち ----
function nodeTests(files) {
  const json = join(work, `node-${Date.now()}.json`);
  node(["--test", "--test-reporter=spec", "--test-reporter-destination=stderr", "--test-reporter=./scripts/node-test-json-reporter.mjs", `--test-reporter-destination=${json}`, ...files]);
  try {
    return JSON.parse(readFileSync(json, "utf8")).tests;
  } catch {
    return null;
  }
}
{
  const c1 = existsSync("tests/scripts/skill-loop-feedback.test.mjs") ? nodeTests(["tests/scripts/skill-loop-feedback.test.mjs"]) : null;
  results.C1 = c1 ? judgeC1(c1) : judgeWaiting("#22：フィードバック → ルールの案 → 物差し → PR の台本の試験が無い", await issueOf(22));
}
results.C4 = judgeWaiting("#23 の 2：運営者の判断（Skill の文の採点を、どの段で誰が走らせるか）", await issueOf(23));

// ---- 台帳と受け口の単体の試験（vitest。B1・B2）----
function vitest(files) {
  const json = join(work, `vitest-${Date.now()}.json`);
  node([join("node_modules", "vitest", "vitest.mjs"), "run", ...files, "--reporter=default", "--reporter=json", `--outputFile.json=${json}`]);
  try {
    const j = JSON.parse(readFileSync(json, "utf8"));
    const tests = (j.testResults ?? []).flatMap((f) => (f.assertionResults ?? []).map((a) => ({ title: a.title, status: a.status, file: f.name })));
    return tests;
  } catch {
    return null;
  }
}
const walk = (dir, re, acc = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, re, acc);
    else if (re.test(e.name)) acc.push(p.replace(/\\/g, "/"));
  }
  return acc;
};
const ledgerUnit = walk("tests", /ledger.*\.test\.tsx?$/i).sort();
say(`台帳の試験を走らせる（${ledgerUnit.length} ファイル）`);
const unit = vitest(ledgerUnit);

// ---- e2e ----
let e2eHere = null;
let e2eOther = null;
if (ci) {
  if (e2eDir && existsSync(e2eDir)) {
    for (const f of walk(e2eDir, /\.json$/)) {
      try {
        const j = JSON.parse(readFileSync(f, "utf8"));
        if (j.os === "ubuntu") e2eHere = j;
        else if (j.os === "windows") e2eOther = j;
      } catch {
        /* 読めない報告は無いものとする */
      }
    }
  }
} else {
  e2eHere = runE2e();
}
const hereMap = e2eHere ? toMap(e2eHere.files) : null;
const otherResult = (() => {
  if (!e2eOther) return null;
  const bad = Object.values(e2eOther.files).reduce((a, r) => a + r.unexpected + r.flaky, 0);
  const skipped = Object.values(e2eOther.files).reduce((a, r) => a + r.skipped, 0);
  return bad ? "failure" : skipped ? `success（飛ばした ${skipped}）` : "success";
})();

// B1：台帳の置き場所と、台帳に関わる試験（vitest と e2e の ledger-*.spec）
{
  let config = null;
  try {
    config = JSON.parse(readFileSync(join("config", "ledger.json"), "utf8"));
  } catch {
    /* 読めない */
  }
  let tests = null;
  if (unit) {
    const u = unit.filter((t) => t.status !== "skipped" && t.status !== "pending" && t.status !== "todo");
    tests = { total: u.length, passed: u.filter((t) => t.status === "passed").length, failed: u.filter((t) => t.status !== "passed").length };
    if (hereMap) {
      for (const [file, row] of hereMap) {
        if (!/(^|\/)ledger-[^/]*\.spec\.ts$/.test(file)) continue;
        tests.total += row.expected + row.unexpected + row.flaky + row.skipped;
        tests.passed += row.expected;
        tests.failed += row.unexpected + row.flaky + row.skipped;
      }
    }
  }
  results.B1 = judgeB1(config, tests);
}

// B2：受け口の e2e と単体の試験
{
  const row = hereMap ? fileRow(hereMap, "ledger-intake.spec.ts") : null;
  const e2e = row ? { ok: row.unexpected + row.flaky + row.skipped === 0 && row.expected > 0, total: row.expected + row.unexpected + row.flaky + row.skipped } : null;
  const u = unit ? unit.filter((t) => /ledger-intake\.test\.ts$/.test(t.file.replace(/\\/g, "/"))) : null;
  results.B2 = judgeB2(e2e, u);
}

// C3：書き出しの芯（vitest）と、アプリから使う経路
{
  const files = ["tests/unit/share/reading-feedback.test.ts"].filter((f) => existsSync(f));
  const t = files.length ? vitest(files) : null;
  const tests = t ? { total: t.filter((x) => x.status !== "skipped").length, passed: t.filter((x) => x.status === "passed").length } : null;
  const wired = [...walk("src/app", /\.tsx?$/), ...walk("src/bridge", /\.ts$/)].some((f) => /reading-feedback/.test(readFileSync(f, "utf8")));
  results.C3 = files.length ? judgeC3(tests, wired) : judgeWaiting("#23 の 1：アプリからの書き出しがまだ無い", await issueOf(23));
}

// D1・D2
{
  results.D1 = judgeD1(hereMap, null);
  const otherOs = OS === "windows" ? "ubuntu" : "windows";
  const d2 = judgeD2(hereMap, { os: OS, other: { os: otherOs, result: otherResult } });
  // windows の側にも落ちた・飛ばした台本があれば、根拠に足す
  if (e2eOther && d2.status !== FAIL) {
    const m = toMap(e2eOther.files);
    const sk = [...m].flatMap(([f, r]) => r.skippedTitles.map((t) => `${f.split("/").pop()}「${t.slice(0, 30)}」`));
    if (sk.length) {
      d2.evidence += `。windows で飛ばしたもの：${sk.join("、")}`;
      d2.status = UNKNOWN;
    }
  }
  results.D2 = d2;
  if (e2eOther && results.D1.status !== FAIL) {
    const row = fileRow(toMap(e2eOther.files), D1_SPEC);
    if (!row || row.unexpected + row.flaky > 0 || row.expected === 0) results.D1 = { status: FAIL, evidence: `windows：${D1_SPEC} が通っていない` };
    else results.D1.evidence += `（${OS}・windows）`;
  }
}

// D3：開いている area:ux の Issue（PR は数えない）
{
  const j = await gh(`/issues?state=open&labels=${encodeURIComponent("area:ux")}&per_page=100`);
  results.D3 = judgeD3(j ? j.filter((i) => !i.pull_request).map((i) => ({ number: i.number })) : null);
}

// E2：main の CI
if (ci) {
  results.E2 = judgeE2FromCi(process.env.GITHUB_REF ?? "", {
    "test (ubuntu・windows)": process.env.MOYAI_CI_TEST ?? "不明",
    "pack-bench": process.env.MOYAI_CI_PACK_BENCH ?? "不明",
    "e2e (ubuntu・windows)": process.env.MOYAI_CI_E2E ?? "不明",
  });
} else {
  const runs = await gh(`/actions/workflows/ci.yml/runs?branch=main&event=push&status=completed&per_page=1`);
  const run = runs?.workflow_runs?.[0];
  if (!run) results.E2 = judgeE2(null);
  else {
    const jobs = await gh(`/actions/runs/${run.id}/jobs?per_page=100`);
    results.E2 = judgeE2(jobs ? { sha: run.head_sha, conclusion: run.conclusion, jobs: jobs.jobs.map((j) => ({ name: j.name, conclusion: j.conclusion })) } : null);
  }
}

// ---- 書く ----
const prev = existsSync(outMd) ? readFileSync(outMd, "utf8") : null;
const md = renderResult(results, { commit, dirty, at, os: OS, ci }, prev);
mkdirSync(dirname(outMd), { recursive: true });
writeFileSync(outMd, md, "utf8");
if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, md, { flag: "a" });
rmSync(work, { recursive: true, force: true });
for (const m of MARKS.filter((x) => x.auto)) say(`${m.id} ${results[m.id]?.status ?? UNKNOWN}`);
say(`書いた：${outMd}`);
const failed = MARKS.some((m) => m.auto && results[m.id]?.status === FAIL);
process.exit(strict && failed ? 1 : 0);
