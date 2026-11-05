#!/usr/bin/env node
// docs/acceptance.md（docs/plan.md §5.1 の表）を、試験の実行から作る（§5.2 の 4）。手で書かない。
// 試験の名前と試験のファイルの対応は tests/acceptance-map.json の 1 か所。名前の並びは docs/plan.md §5.1 の表から読む。
// 結果は 4 つだけ：通った／落ちた／試験が無い／測っていない。緑でないものを緑と書かない：
//   - 対応する試験が無い名前は「試験が無い」（作らない）。
//   - 試験はあるが、この実行の報告に無い（Playwright を走らせていない、ファイルが走らなかった、全部飛ばした）なら「測っていない」。
//   - 1 つでも落ちれば「落ちた」。
//
// 使い方：
//   node scripts/acceptance.mjs                         scripts/run-tests.mjs を走らせ、その報告から作る
//   node scripts/acceptance.mjs --reports <フォルダ>    前に書いた報告（node.json・vitest.json）から作る（試験を走らせない）
//   どちらにも --playwright <JSON の報告> を足せる。作り方：
//     PLAYWRIGHT_JSON_OUTPUT_NAME=.cache/playwright-report.json npx playwright test --reporter=json
//   --out <道>（既定 docs/acceptance.md）
// scripts/trend.mjs も、試験を走らせたあとにこれで docs/acceptance.md を作る。
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const MAP = "tests/acceptance-map.json";
export const OUT = "docs/acceptance.md";
export const STATUS = { pass: "通った", fail: "落ちた", none: "試験が無い", unmeasured: "測っていない" };

/** docs/plan.md §5.1 の表の、試験の名前の並び */
export function planNames(planText) {
  const start = planText.indexOf("### 5.1 ");
  if (start < 0) throw new Error("docs/plan.md に §5.1 が無い");
  const end = planText.indexOf("\n### ", start + 1);
  const names = [];
  for (const line of planText.slice(start, end < 0 ? undefined : end).split("\n")) {
    const m = /^\| `([^`]+)` \|/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

export function loadMap(text) {
  const m = JSON.parse(text);
  if (!Array.isArray(m.rows)) throw new Error("対応表の形でない");
  return m;
}

const rel = (p, root = REPO) => (isAbsolute(p) ? relative(root, p) : p).replace(/\\/g, "/");

/** vitest の JSON の報告 → 試験の一覧 */
export function fromVitest(j, root = REPO) {
  const out = [];
  for (const f of j.testResults ?? []) {
    const file = rel(f.name, root);
    for (const a of f.assertionResults ?? []) {
      const status = a.status === "passed" ? "passed" : a.status === "failed" ? "failed" : "skipped";
      out.push({ file, name: a.fullName ?? a.title, status });
    }
    // ファイルごと落ちた（読み込めなかった）ときは、試験の無い落ちとして数える
    if ((f.assertionResults ?? []).length === 0 && f.status === "failed") out.push({ file, name: "（ファイルを読み込めなかった）", status: "failed" });
  }
  return out;
}

/** scripts/node-test-json-reporter.mjs の報告 → 試験の一覧 */
export function fromNode(j, root = REPO) {
  return (j.tests ?? []).map((t) => ({ file: t.file ? rel(t.file, root) : "", name: t.name, status: t.status === "passed" ? "passed" : t.status === "failed" ? "failed" : "skipped" }));
}

/** Playwright の JSON の報告 → 試験の一覧（ブラウザの組ごとに 1 つ）。flaky（やり直して通った）は落ちたに数える */
export function fromPlaywright(j) {
  const out = [];
  const walk = (s, file) => {
    const f = s.file ?? file;
    for (const sp of s.specs ?? []) {
      for (const t of sp.tests ?? []) {
        const status = t.status === "expected" ? "passed" : t.status === "skipped" ? "skipped" : "failed";
        out.push({ file: (sp.file ?? f ?? "").replace(/\\/g, "/"), name: `${t.projectName ?? ""} ${sp.title}`.trim(), status });
      }
    }
    for (const c of s.suites ?? []) walk(c, f);
  };
  for (const s of j.suites ?? []) walk(s, undefined);
  return out;
}

/** 試験のファイルの道と、報告の道が同じか（Playwright の報告は testDir からの道） */
function sameFile(source, reported, runner) {
  if (runner === "playwright") return source === reported || source.endsWith(`/${reported}`);
  return source === reported;
}

/**
 * 名前ごとに結果を決める。
 * reports：{ vitest, node, playwright } それぞれ試験の一覧か null（報告が無い）。commands：{ <道>: 終了コード } か無し。
 */
export function judge(names, map, reports, commands = {}) {
  const byName = new Map(map.rows.map((r) => [r.name, r]));
  const rows = [];
  for (const name of names) {
    const row = byName.get(name);
    const sources = row?.sources ?? [];
    if (sources.length === 0) {
      rows.push({ name, status: STATUS.none, passed: 0, failed: 0, skipped: 0, sources: [], scope: row?.scope ?? (row ? null : "対応表に名前が無い") });
      continue;
    }
    let passed = 0;
    let failed = 0;
    let skipped = 0;
    let unmeasured = false;
    const srcOut = [];
    for (const s of sources) {
      if (s.runner === "command") {
        const code = commands[s.file];
        if (code === undefined) {
          unmeasured = true;
          srcOut.push({ ...s, mark: "走らせていない" });
        } else if (code === 0) {
          passed++;
          srcOut.push({ ...s, mark: "当たり 0（終了コード 0）" });
        } else {
          failed++;
          srcOut.push({ ...s, mark: `終了コード ${code}` });
        }
        continue;
      }
      const list = reports[s.runner];
      if (!list) {
        unmeasured = true;
        srcOut.push({ ...s, mark: "報告が無い" });
        continue;
      }
      const hit = list.filter((t) => sameFile(s.file, t.file, s.runner) && (!s.title || t.name.includes(s.title)));
      const p = hit.filter((t) => t.status === "passed").length;
      const f = hit.filter((t) => t.status === "failed").length;
      const k = hit.filter((t) => t.status === "skipped").length;
      passed += p;
      failed += f;
      skipped += k;
      if (p + f === 0) unmeasured = true;
      srcOut.push({ ...s, mark: p + f + k === 0 ? "報告に無い" : `通った ${p}・落ちた ${f}${k ? `・飛ばした ${k}` : ""}` });
    }
    const status = failed > 0 ? STATUS.fail : unmeasured || passed === 0 ? STATUS.unmeasured : STATUS.pass;
    rows.push({ name, status, passed, failed, skipped, sources: srcOut, scope: row.scope ?? null });
  }
  return rows;
}

const cell = (s) => String(s).replace(/\|/g, "\\|").replace(/\n/g, " ");

/** docs/acceptance.md の本文 */
export function render(rows, meta) {
  const L = [];
  const count = (st) => rows.filter((r) => r.status === st).length;
  L.push("# 受け入れの試験（docs/plan.md §5.1）");
  L.push("");
  L.push(
    "`node scripts/acceptance.mjs`（または `node scripts/trend.mjs`）が、試験の実行の報告から作ります。手で直さないでください。試験の名前と試験のファイルの対応は `tests/acceptance-map.json` の 1 か所で、名前の並びと合格の条件は `docs/plan.md` §5.1 の表です。",
  );
  L.push("");
  L.push("結果は 4 つです：通った（対応する試験がすべて通った）／落ちた（1 つでも落ちた）／試験が無い（対応する試験を作っていない）／測っていない（試験はあるが、この実行で走っていない）。「通った」は、対応する試験が通ったことで、§5.1 の合格の条件をすべて確かめたとは限りません（範囲の注を見てください）。");
  L.push("");
  L.push(`- 作った時刻：${meta.date} ${meta.time} JST・コミット \`${meta.commit}\`${meta.dirty ? "（コミットしていない変更あり）" : ""}`);
  L.push(`- 報告：node:test ${meta.counts.node ?? "無し"}・vitest ${meta.counts.vitest ?? "無し"}・Playwright ${meta.counts.playwright ?? "渡していない（測っていない）"}`);
  L.push(`- ${STATUS.pass} ${count(STATUS.pass)}・${STATUS.fail} ${count(STATUS.fail)}・${STATUS.none} ${count(STATUS.none)}・${STATUS.unmeasured} ${count(STATUS.unmeasured)}（全 ${rows.length}）`);
  L.push("");
  L.push("| 試験の名前 | 結果 | 通った・落ちた | 対応する試験 | 範囲の注 |");
  L.push("|---|---|---|---|---|");
  for (const r of rows) {
    const n = r.sources.length ? `${r.passed}・${r.failed}${r.skipped ? `（飛ばした ${r.skipped}）` : ""}` : "—";
    const src = r.sources.length ? r.sources.map((s) => `\`${s.file}\`${s.title ? `（「${s.title}」）` : ""}：${s.mark}`).join("<br>") : "—";
    L.push(`| \`${r.name}\` | ${r.status} | ${n} | ${cell(src)} | ${cell(r.scope ?? "")} |`);
  }
  L.push("");
  const none = rows.filter((r) => r.status === STATUS.none).map((r) => `\`${r.name}\``);
  L.push(`試験が無い名前：${none.length ? none.join("・") : "無し"}。`);
  L.push("");
  return L.join("\n");
}

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

/** 報告のフォルダ（node.json・vitest.json）と Playwright の報告から、試験の一覧を読む */
export function readReports(dir, playwright = null) {
  const at = (n) => (dir && existsSync(join(dir, n)) ? join(dir, n) : null);
  const v = at("vitest.json");
  const n = at("node.json");
  const p = playwright ?? at("playwright.json");
  return {
    vitest: v ? fromVitest(readJson(v)) : null,
    node: n ? fromNode(readJson(n)) : null,
    playwright: p && existsSync(p) ? fromPlaywright(readJson(p)) : null,
  };
}

/** 対応表の command を走らせて、終了コードを集める */
export function runCommands(map) {
  const out = {};
  for (const r of map.rows)
    for (const s of r.sources ?? [])
      if (s.runner === "command" && out[s.file] === undefined) {
        const x = spawnSync(process.execPath, [s.file], { cwd: REPO, encoding: "utf8" });
        out[s.file] = x.status ?? 1;
      }
  return out;
}

function jst(d) {
  const t = new Date(d.getTime() + 9 * 3600_000).toISOString();
  return { date: t.slice(0, 10), time: t.slice(11, 16) };
}

/** 報告から docs/acceptance.md を書く（trend.mjs からも呼ぶ）。戻り値は行の一覧 */
export function writeAcceptance({ reports, out = OUT, now = new Date() }) {
  const map = loadMap(readFileSync(join(REPO, MAP), "utf8"));
  const names = planNames(readFileSync(join(REPO, "docs", "plan.md"), "utf8"));
  const rows = judge(names, map, reports, runCommands(map));
  const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "src", "tests", "packs", "samples", "scripts", "demo-ring"], { cwd: REPO, encoding: "utf8" }).trim() !== "";
  const counts = { node: reports.node?.length ?? null, vitest: reports.vitest?.length ?? null, playwright: reports.playwright?.length ?? null };
  writeFileSync(resolve(REPO, out), render(rows, { ...jst(now), commit, dirty, counts }));
  return rows;
}

function parseArgs(argv) {
  const a = { reports: null, playwright: null, out: OUT };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i];
    const v = argv[i + 1];
    if (v === undefined) return null;
    if (k === "--reports") a.reports = resolve(v);
    else if (k === "--playwright") a.playwright = resolve(v);
    else if (k === "--out") a.out = v;
    else return null;
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  if (!a) {
    console.error("使い方：node scripts/acceptance.mjs [--reports <フォルダ>] [--playwright <JSON>] [--out <道>]");
    process.exit(2);
  }
  let dir = a.reports;
  let tmp = null;
  if (!dir) {
    tmp = mkdtempSync(join(tmpdir(), "moyai-acceptance-"));
    dir = tmp;
    spawnSync(process.execPath, ["scripts/run-tests.mjs"], { cwd: REPO, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, MOYAI_REPORT_DIR: dir } });
  }
  const reports = readReports(dir, a.playwright);
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  const rows = writeAcceptance({ reports, out: a.out });
  const c = (st) => rows.filter((r) => r.status === st).length;
  console.log(`acceptance: ${STATUS.pass} ${c(STATUS.pass)}・${STATUS.fail} ${c(STATUS.fail)}・${STATUS.none} ${c(STATUS.none)}・${STATUS.unmeasured} ${c(STATUS.unmeasured)} → ${a.out}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
