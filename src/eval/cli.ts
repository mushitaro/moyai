// `moyai eval`（F3 Skill の採点。docs/plan.md §2.10）。
// - gen：正解の世界から問題を作り、eval/<suite>/ に置く（suite.json、cases/{train,test}.jsonl）
// - run：Messages API で 1 問 3 回走らせ、eval/runs/<runId>/ に manifest.json・outbound.txt・results.jsonl・report.json・report.html を置く
// - report：results.jsonl から report.json と表を作り直す（--base で前の版と比べる）
// 人への知らせは標準エラーへ出す。API キーは、あるかどうかだけを見る（値は出さない）。保存と昇格のコマンドは無い（人だけがする）。
import Anthropic from "@anthropic-ai/sdk";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { appendLedger, budgetCheck, loadLedger } from "../../scripts/api-spend.mjs";
import { generateSuite } from "./gen";
import { countEvalProperNouns, leakedTestCases, sha256, systemText, userText } from "./prompt";
import { buildReport, compareReports, pct, renderHtml, type Report } from "./report";
import { callOnce, planTasks, runTasks, type CallConfig, type Price } from "./run";
import { MANIFEST_SCHEMA, type EvalCase, type Manifest, type ResultRow, type Split, type Suite } from "./types";
import { WorldFormatError, contentPackIds, loadPack, loadWorld, properNounTerms } from "./world";

const say = (m: string): void => {
  process.stderr.write(`${m}\n`);
};

export const EVAL_HELP = `使い方：
  moyai eval gen --pack <パック> --world <正解の世界のフォルダ> [--suite <名前>] [--seed <数>]
        問題を作り、eval/<名前>/ に置く（規則 10 × 10 問。期間で学習用と試験用に分ける）
        世界の形は見分ける：world.json と *.truth.json（今の工場）か、answer/world.json（指示書 §5 の形）
  moyai eval run --suite <名前> --max-usd <米ドル> [--skill <SKILL.md>] [--label <版の名前>] [--author <作者>]
        [--split all|train|test] [--rules R01,R02] [--per-rule <数>] [--limit <数>] [--repeat 3] [--concurrency 4]
        [--per-call-usd <測った 1 回の費用>] [--base <前の版の回>] [--dry-run]
        送る文の全文を書き出し、固有名詞と試験用の問題の混入を数え、費用の見込みを出してから走らせる
  moyai eval report --run <回> [--base <前の版の回>]
        results.jsonl から report.json と表（report.html）を作り直す`;

function flags(argv: string[]): Map<string, string> | null {
  const m = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (!a.startsWith("--")) return null;
    const k = a.slice(2);
    if (k === "dry-run") {
      m.set(k, "1");
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) return null;
    m.set(k, v);
    i++;
  }
  return m;
}

const readJsonl = <T>(p: string): T[] =>
  existsSync(p)
    ? readFileSync(p, "utf8")
        .split(/\r?\n/)
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as T)
    : [];
const writeJsonl = (p: string, xs: unknown[]): void => writeFileSync(p, xs.map((x) => JSON.stringify(x)).join("\n") + "\n");
const writeJson = (p: string, x: unknown): void => writeFileSync(p, `${JSON.stringify(x, null, 2)}\n`);

interface Paths {
  root: string;
  evalDir: string;
  packsDir: string;
  modelsFile: string;
}
const pathsOf = (root: string): Paths => ({
  root,
  evalDir: join(root, "eval"),
  packsDir: join(root, "packs"),
  modelsFile: join(root, "config", "models.json"),
});

function cmdGen(f: Map<string, string>, p: Paths): number {
  const packId = f.get("pack");
  const worldDir = f.get("world");
  if (!packId || !worldDir) return usage();
  const name = f.get("suite") ?? packId;
  // 出典の問い（R03）は、すべてのパックの検査を並べ、このパックに無い検査は「パックに無い」を正解にする
  const allPacks = contentPackIds(p.packsDir);
  const pack = loadPack(p.packsDir, packId);
  let world;
  try {
    world = loadWorld(resolve(p.root, worldDir), { fiscalYearStartMonth: pack.fiscalYearStartMonth });
  } catch (e) {
    if (e instanceof WorldFormatError) {
      say(`eval gen：${e.message}`);
      return 1;
    }
    throw e;
  }
  const out = generateSuite({
    name,
    worldDir: relative(p.root, resolve(p.root, worldDir)),
    world,
    pack,
    allPacks: allPacks.map((id) => loadPack(p.packsDir, id)),
    ...(f.has("seed") ? { seed: Number(f.get("seed")) } : {}),
  });
  if (out.suite.properNounHits !== 0) {
    say(`eval gen：問題の文に固有名詞が ${out.suite.properNounHits} 回出た。作らずに止めます`);
    return 1;
  }
  const dir = join(p.evalDir, name);
  mkdirSync(join(dir, "cases"), { recursive: true });
  writeJson(join(dir, "suite.json"), out.suite);
  writeJsonl(join(dir, "cases", "train.jsonl"), out.train);
  writeJsonl(join(dir, "cases", "test.jsonl"), out.test);
  say(`eval gen：${name} — 学習用 ${out.train.length}・試験用 ${out.test.length}（近い重複を除いた数 ${out.suite.counts.duplicatesRemoved}、固有名詞の当たり 0）`);
  // 作れなかった問いは suite.json の missing に残す（黙って捨てない）
  for (const m of out.missing) say(`  作れなかった問い：${m.rule} の ${m.index}（${m.reason}）`);
  return 0;
}

function loadSuite(p: Paths, name: string): { suite: Suite; train: EvalCase[]; test: EvalCase[] } | null {
  const dir = join(p.evalDir, name);
  if (!existsSync(join(dir, "suite.json"))) return null;
  return {
    suite: JSON.parse(readFileSync(join(dir, "suite.json"), "utf8")),
    train: readJsonl<EvalCase>(join(dir, "cases", "train.jsonl")),
    test: readJsonl<EvalCase>(join(dir, "cases", "test.jsonl")),
  };
}

const runIdOf = (d: Date, suite: string, skillSha: string): string => `${d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}_${suite}_${skillSha.slice(0, 8)}`;

/** 測っていない見込み：日本語は 1 文字およそ 1 トークン、出力は 1 回 4,000 トークンと置く。測った 1 回の費用があればそれを使う。 */
export function roughPerCallUsd(systemChars: number, avgUserChars: number, price: Price): number {
  return (avgUserChars * price.input + 4000 * price.output + systemChars * price.cacheRead) / 1_000_000;
}

async function cmdRun(f: Map<string, string>, p: Paths): Promise<number> {
  const name = f.get("suite");
  if (!name) return usage();
  const loaded = loadSuite(p, name);
  if (!loaded) {
    say(`eval run：問題の組 ${name} がありません（先に moyai eval gen）`);
    return 1;
  }
  const { suite, train, test } = loaded;
  const split = (f.get("split") ?? "all") as Split | "all";
  if (!["all", "train", "test"].includes(split)) return usage();
  const rules = f.get("rules")?.split(",").filter(Boolean) ?? null;
  let cases = split === "train" ? train : split === "test" ? test : [...train, ...test];
  if (rules) cases = cases.filter((c) => rules.includes(c.rule));
  // 費用を測るときは、規則ごとに先頭の n 問だけを取る
  if (f.has("per-rule")) {
    const n = Number(f.get("per-rule"));
    cases = cases.filter((c, i) => cases.slice(0, i).filter((x) => x.rule === c.rule).length < n);
  }
  const limit = f.has("limit") ? Number(f.get("limit")) : null;
  if (limit !== null) cases = cases.slice(0, limit);
  const repeat = Number(f.get("repeat") ?? 3);
  const concurrency = Number(f.get("concurrency") ?? 4);
  if (!cases.length || !(repeat >= 1) || !(concurrency >= 1)) return usage();

  const skillPath = f.get("skill") ?? join("packs", suite.pack, "SKILL.md");
  const skill = readFileSync(resolve(p.root, skillPath), "utf8");
  const skillSha = sha256(skill);

  // 1. 試験用の問題が、調整する側の入力（Skill の文）に入っていないか
  const leaked = leakedTestCases(skill, test);
  if (leaked.length) {
    say(`eval run：試験用の問題 ${leaked.length} 件の記録が Skill の文に入っています（${leaked.slice(0, 5).join(" ")}）。走らせずに止めます`);
    return 1;
  }
  // 2. 送る文の全文と、固有名詞の当たり
  const system = systemText(skill);
  const users = cases.map((c) => userText(c));
  const outbound = [`=== system ===\n${system}`, ...cases.map((c, i) => `=== ${c.id} ===\n${users[i]}`)].join("\n\n") + "\n";
  const terms = properNounTerms(loadWorld(resolve(p.root, suite.world), { fiscalYearStartMonth: suite.fiscalYearStartMonth }));
  const pn = countEvalProperNouns(outbound, terms);
  if (pn.hits !== 0) {
    say(`eval run：送る文に固有名詞が ${pn.hits} 回出ます。走らせずに止めます`);
    return 1;
  }
  // 3. 条件（config/models.json の項目だけを使う）と見込み
  const models = JSON.parse(readFileSync(p.modelsFile, "utf8"));
  const role = "eval";
  const rc = models.roles?.[role];
  const price: Price | undefined = rc ? models.pricesUsdPerMTok?.[rc.model] : undefined;
  if (!rc || !price) {
    say("eval run：config/models.json に eval の項目か、その値段がありません");
    return 1;
  }
  const maxTokens = 16000;
  const calls = cases.length * repeat;
  const measured = f.has("per-call-usd") ? Number(f.get("per-call-usd")) : null;
  const perCall = measured ?? roughPerCallUsd(system.length, users.reduce((a, u) => a + u.length, 0) / users.length, price);
  const estimate = perCall * calls + (system.length * price.cacheWrite) / 1_000_000;
  const maxUsd = f.has("max-usd") ? Number(f.get("max-usd")) : null;

  const now = new Date();
  const runId = runIdOf(now, name, skillSha);
  const runDir = join(p.evalDir, "runs", runId);
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "outbound.txt"), outbound);
  const manifest: Manifest = {
    schema: MANIFEST_SCHEMA,
    runId,
    createdAt: now.toISOString(),
    finishedAt: null,
    status: f.has("dry-run") ? "dry-run" : "running",
    stopNote: null,
    suite: name,
    suiteHash: sha256(readFileSync(join(p.evalDir, name, "suite.json"))),
    split,
    rules,
    perRule: f.has("per-rule") ? Number(f.get("per-rule")) : null,
    limit,
    repeat,
    cases: cases.length,
    calls,
    skill: { path: skillPath.replace(/\\/g, "/"), sha256: skillSha, label: f.get("label") ?? null, author: f.get("author") ?? null },
    modelRole: role,
    modelRoleHash: sha256(JSON.stringify({ model: rc.model, effort: rc.effort })),
    effort: rc.effort,
    maxTokens,
    systemHash: sha256(system),
    answerFormatHash: suite.answerFormatHash,
    outbound: { chars: outbound.length, properNounHits: pn.hits, file: "outbound.txt" },
    estimateUsd: estimate,
    maxUsd,
    costUsd: 0,
    base: f.get("base") ?? null,
  };
  writeJson(join(runDir, "manifest.json"), manifest);
  say(`eval run：${runId}`);
  say(`  問題 ${cases.length}・1 問 ${repeat} 回・呼び出し ${calls}。送る文 ${outbound.length} 文字（全文は ${relative(p.root, join(runDir, "outbound.txt"))}）、固有名詞の当たり 0（語 ${pn.terms}）、試験用の問題の混入 0`);
  say(`  費用の見込み $${estimate.toFixed(2)}（1 回 $${perCall.toFixed(4)}、${measured === null ? "測っていない目安" : "測った 1 回の費用から"}）`);
  if (f.has("dry-run")) return 0;

  if (maxUsd === null || !(maxUsd > 0)) {
    say("eval run：--max-usd（この回で使ってよい上限）を付けてください");
    return 2;
  }
  if (estimate > maxUsd) {
    say(`eval run：見込み $${estimate.toFixed(2)} が上限 $${maxUsd} を越えます。走らせずに止めます`);
    return finish(p, runDir, manifest, [], "stopped", "見込みが上限を越えた");
  }
  const ledger = loadLedger(join(p.root, "ops", "api-spend.jsonl"));
  const gate = budgetCheck(models.budgetUsd, ledger.rows, role, Math.min(estimate, maxUsd), ledger);
  if (gate.stop) {
    say(`eval run：${gate.reason}`);
    return finish(p, runDir, manifest, [], "stopped", gate.reason);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    say("eval run：環境変数 ANTHROPIC_API_KEY がありません。走らせずに止めます（キーは node scripts/with-api-key.mjs node dist/cli.js eval run … の形で、このコマンドにだけ渡す）");
    return finish(p, runDir, manifest, [], "stopped", "API キーの環境変数が無い");
  }

  const client = new Anthropic({ maxRetries: 0 });
  const cfg: CallConfig = { model: rc.model, effort: rc.effort, maxTokens, system };
  const rows: ResultRow[] = [];
  const resultsPath = join(runDir, "results.jsonl");
  writeFileSync(resultsPath, "");
  const byCase = new Map(cases.map((c, i) => [c.id, users[i] as string]));
  const res = await runTasks({
    runId,
    tasks: planTasks(cases, repeat),
    userTextOf: (c) => byCase.get(c.id) as string,
    call: (u) => callOnce(client, cfg, u),
    price,
    packUrls: suite.packSourceUrls,
    concurrency,
    maxUsd,
    perCallEstimateUsd: perCall,
    onResult: (r) => {
      rows.push(r);
      appendFileSync(resultsPath, `${JSON.stringify(r)}\n`);
      if (rows.length % 10 === 0) say(`  ${rows.length}/${calls}（$${rows.reduce((a, x) => a + x.costUsd, 0).toFixed(2)}）`);
    },
  });
  const tokens = rows.reduce(
    (a, r) => ({
      input_tokens: a.input_tokens + r.usage.input_tokens,
      output_tokens: a.output_tokens + r.usage.output_tokens,
      cache_read_input_tokens: a.cache_read_input_tokens + r.usage.cache_read_input_tokens,
      cache_creation_input_tokens: a.cache_creation_input_tokens + r.usage.cache_creation_input_tokens,
    }),
    { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  );
  appendLedger({ at: new Date().toISOString(), role, where: "local", runId, usd: res.spentUsd, usage: tokens }, join(p.root, "ops", "api-spend.jsonl"));
  return finish(p, runDir, manifest, rows, res.stopped ? "stopped" : "done", res.stopped ? "上限に届きそうなので、残りの呼び出しを始めなかった" : null);
}

function finish(p: Paths, runDir: string, m: Manifest, rows: ResultRow[], status: Manifest["status"], note: string | null): number {
  m.status = status;
  m.stopNote = note;
  m.finishedAt = new Date().toISOString();
  m.costUsd = rows.reduce((a, r) => a + r.costUsd, 0);
  writeJson(join(runDir, "manifest.json"), m);
  if (!rows.length) return 1;
  return writeReport(p, m.runId, m.base);
}

function writeReport(p: Paths, runId: string, base: string | null): number {
  const runDir = join(p.evalDir, "runs", runId);
  if (!existsSync(join(runDir, "manifest.json"))) {
    say(`eval report：回 ${runId} がありません`);
    return 1;
  }
  const m: Manifest = JSON.parse(readFileSync(join(runDir, "manifest.json"), "utf8"));
  const loaded = loadSuite(p, m.suite);
  if (!loaded) return 1;
  const rows = readJsonl<ResultRow>(join(runDir, "results.jsonl"));
  const rep: Report = { ...buildReport(m, rows, loaded.suite.rules), comparison: null };
  if (base) {
    const bDir = join(p.evalDir, "runs", base);
    const bm: Manifest = JSON.parse(readFileSync(join(bDir, "manifest.json"), "utf8"));
    // 前の版の合格率と揺れの幅は、両方で走らせた問題だけで数える（試験用だけで比べるときに、全問の値と比べないため）
    const ids = new Set(rows.map((r) => r.caseId));
    const baseRows = readJsonl<ResultRow>(join(bDir, "results.jsonl")).filter((r) => ids.has(r.caseId));
    rep.comparison = compareReports(buildReport(bm, baseRows, loaded.suite.rules), rep);
  }
  writeJson(join(runDir, "report.json"), rep);
  writeFileSync(join(runDir, "report.html"), renderHtml(rep));
  say(`eval report：${runId}`);
  say(`  合格率 ${pct(rep.passRate)}（回ごと ${rep.perAttempt.map((x) => pct(x.passRate)).join(" / ")}、揺れの幅 ${pct(rep.band)}）。数えた回 ${rep.counted}/${rep.calls}、外した回 ${Object.entries(rep.excluded).map(([k, v]) => `${k} ${v}`).join("・")}。費用 $${rep.cost.usd.toFixed(4)}`);
  say(`  過半の回で落ちた問題 ${rep.failingCases.length}：${rep.failingCases.join(" ") || "なし"}`);
  if (rep.comparison) say(`  見立て（決めるのは人）：${rep.comparison.verdict} — ${rep.comparison.reason}`);
  return 0;
}

function usage(): number {
  say(EVAL_HELP);
  return 2;
}

export async function evalCli(argv: string[], root = process.cwd()): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === undefined || sub === "--help" || sub === "-h") return usage();
  const f = flags(rest);
  if (!f) return usage();
  const p = pathsOf(resolve(root));
  if (sub === "gen") return cmdGen(f, p);
  if (sub === "run") return cmdRun(f, p);
  if (sub === "report") {
    const run = f.get("run");
    return run ? writeReport(p, run, f.get("base") ?? null) : usage();
  }
  return usage();
}
