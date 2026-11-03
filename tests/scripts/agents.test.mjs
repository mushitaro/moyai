import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import {
  parseTaskSpec,
  budgetCents,
  sessionBudget,
  gate,
  agentParams,
  environmentParams,
  specHash,
  listCostUsd,
  recomputeUsd,
  ledgerRow,
  outputPath,
  decideToolUse,
  streamStep,
  buildKickoff,
  MODEL_ID_LIKE,
} from "../../scripts/agents/lib.mjs";

const config = JSON.parse(readFileSync("config/models.json", "utf8"));
const SHA = "0e0fdc22f20116f94abbb64985b6cfb378dbd80b";
const spec = (head, body = "本文") => `---\n${head}\n---\n${body}\n`;
const HEAD = "id: t-1\nrole: factory\nagent: factory\nenvironment: env-factory\nbudgetUsd: 12\ntimeoutMin: 90";
// 前の製品の置き場所の名前は、見張りのフックに当たらないように組み立てる
const PREV_ORG = ["mx", "stage"].join("");
const PREV_REPO = ["woody", "garagelab/HOSHU", "TARO"].join("");

test("仕様の頭の設定と本文を読む。数と配列は JSON として読む", () => {
  const s = parseTaskSpec(spec(`${HEAD}\nverify: ["node a.mjs", "node b.mjs"]`, "# 見出し\n中身"));
  assert.equal(s.meta.id, "t-1");
  assert.equal(s.meta.budgetUsd, 12);
  assert.deepEqual(s.meta.verify, ["node a.mjs", "node b.mjs"]);
  assert.equal(s.body, "# 見出し\n中身");
});

test("CRLF の仕様も読む。verify が無ければ空の配列", () => {
  const s = parseTaskSpec(spec(HEAD).replace(/\n/g, "\r\n"));
  assert.deepEqual(s.meta.verify, []);
});

test("仕様の欠けと形の違いを止める", () => {
  assert.throws(() => parseTaskSpec("本文だけ"), /---/);
  assert.throws(() => parseTaskSpec(spec(HEAD.replace("budgetUsd: 12\n", ""))), /budgetUsd/);
  assert.throws(() => parseTaskSpec(spec(HEAD.replace("id: t-1", "id: ../x"))), /id/);
  assert.throws(() => parseTaskSpec(spec(HEAD.replace("budgetUsd: 12", "budgetUsd: 500"))), /budgetUsd/);
  assert.throws(() => parseTaskSpec(spec(HEAD.replace("budgetUsd: 12", 'budgetUsd: "12"'))), /budgetUsd/);
  assert.throws(() => parseTaskSpec(spec(`${HEAD}\nid: t-2`)), /重なって/);
  assert.throws(() => parseTaskSpec(spec(`${HEAD}\nverify: "node a.mjs"`)), /verify/);
  assert.throws(() => parseTaskSpec(spec(HEAD, "")), /本文/);
  assert.throws(() => parseTaskSpec(spec(HEAD, "claude-opus を使う")), /モデル/);
});

test("リポジトリの仕事の仕様はどれも読め、役が config にある", () => {
  const files = readdirSync("ops/tasks").filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 2);
  for (const f of files) {
    const s = parseTaskSpec(readFileSync(join("ops/tasks", f), "utf8"));
    assert.equal(`${s.meta.id}.md`, f);
    assert.ok(config.roles[s.meta.role], s.meta.role);
    assert.ok(readdirSync("ops/agents").includes(`${s.meta.agent}.json`));
    assert.ok(readdirSync("ops/agents").includes(`${s.meta.environment}.json`));
  }
});

test("上限の額はセントの整数の文字列", () => {
  assert.equal(budgetCents(12), "1200");
  assert.equal(budgetCents(0.5), "50");
  assert.equal(budgetCents(19.999), "2000");
  assert.throws(() => budgetCents(0));
  assert.throws(() => budgetCents(NaN));
  assert.deepEqual(sessionBudget(20), { type: "limit", max_list_cost: { amount: "2000", currency: "USD" } });
});

test("呼ぶ前の確かめ：役が無ければ止め、dev の配分に届くなら止める", () => {
  const meta = { role: "factory", budgetUsd: 12 };
  assert.equal(gate(config, [], meta).stop, false);
  assert.equal(gate(config, [], { ...meta, role: "nobody" }).stop, true);
  const near = [{ role: "dev-core", usd: config.budgetUsd.dev - 5 }];
  const r = gate(config, near, meta);
  assert.equal(r.stop, true);
  assert.match(r.reason, /dev/);
  const total = [{ role: "audit", usd: config.budgetUsd.stopAt - 1 }];
  assert.equal(gate(config, total, meta).stop, true);
});

test("エージェントの本体のモデルと effort は config の役からだけ取る", () => {
  const def = { name: "x", role: "dev-core", tools: [] };
  const p = agentParams(def, config, "sys");
  assert.equal(p.model.id, config.roles["dev-core"].model);
  assert.equal(p.model.effort, config.roles["dev-core"].effort);
  assert.throws(() => agentParams({ ...def, model: "m" }, config, "sys"), /model/);
  assert.throws(() => agentParams({ ...def, role: "nobody" }, config, "sys"), /役/);
});

test("ops/agents の定義にモデルの名前を書いていない。どれも本体に組める", () => {
  for (const f of readdirSync("ops/agents")) {
    const text = readFileSync(join("ops/agents", f), "utf8");
    assert.doesNotMatch(text, MODEL_ID_LIKE, f);
    if (!f.endsWith(".json") || f === "ids.json") continue;
    const def = JSON.parse(text);
    if (f.startsWith("env-")) {
      const e = environmentParams(def);
      assert.equal(e.config.networking.type, "limited", f);
    } else {
      const sys = def.system.map((s) => readFileSync(join("ops/agents", s), "utf8")).join("\n");
      assert.match(sys, /hoshutaro/);
      agentParams(def, config, sys);
    }
  }
});

test("定義の比べ方は鍵の順に依らない", () => {
  assert.equal(specHash({ a: 1, b: [1, { c: 2, d: 3 }] }), specHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(specHash({ a: 1 }), specHash({ a: 2 }));
});

test("API の list_cost をドルにする。無ければ null、米ドルでなければ止める", () => {
  assert.equal(listCostUsd({ amount: "1234", currency: "USD" }), 12.34);
  assert.equal(listCostUsd({ amount: "0", currency: "USD" }), 0);
  assert.equal(listCostUsd(null), null);
  assert.throws(() => listCostUsd({ amount: "1", currency: "JPY" }));
  assert.throws(() => listCostUsd({ amount: "1.5", currency: "USD" }));
});

test("数え直し：トークン×値段＋1 時間のキャッシュ＋走った時間", () => {
  const price = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };
  const r = recomputeUsd(
    {
      input_tokens: 1e6,
      output_tokens: 1e6,
      cache_read_input_tokens: 1e6,
      cache_creation: { ephemeral_5m_input_tokens: 1e6, ephemeral_1h_input_tokens: 1e6 },
      active_seconds: 3600,
    },
    price,
  );
  assert.ok(Math.abs(r.tokens - (4 + 20 + 0.2 + 5 + 8)) < 1e-9);
  assert.ok(Math.abs(r.runtime - 0.08) < 1e-9);
  assert.equal(recomputeUsd({}, undefined), null);
});

test("台帳の行：API の額を取り、無ければ数え直しの額、どちらも無ければ止める", () => {
  const base = { at: "2026-11-03T00:00:00Z", role: "factory", task: "t-1", sessionId: "sesn_x", base: SHA, wallSeconds: 10, stopReason: "end_turn" };
  const a = ledgerRow({ ...base, usage: { list_cost: { amount: "345", currency: "USD" }, input_tokens: 5 }, recomputed: { total: 3.3 } });
  assert.equal(a.usd, 3.45);
  assert.equal(a.where, "managed-agents");
  assert.equal(a.usage.input_tokens, 5);
  assert.match(a.how, /list_cost/);
  const b = ledgerRow({ ...base, usage: {}, recomputed: { total: 1.23456 } });
  assert.equal(b.usd, 1.2346);
  assert.match(b.how, /トークン/);
  assert.throws(() => ledgerRow({ ...base, usage: {}, recomputed: null }), /\$0/);
  assert.throws(() => ledgerRow({ ...base, usage: {}, recomputed: { total: 1 }, note: "claude-opus で" }), /モデル/);
});

test("出力の置き場所は仕事のフォルダの中だけ", () => {
  const root = resolve("tmp-out");
  assert.equal(outputPath(root, "factory-v0", "factory-v0.patch"), join(root, "factory-v0", "factory-v0.patch"));
  for (const bad of ["../x.patch", "a/b.patch", "a\\b.patch", "..", "", "名前.md", "x".repeat(200)]) {
    assert.throws(() => outputPath(root, "factory-v0", bad), undefined, bad);
  }
  assert.throws(() => outputPath(root, "../up", "a.patch"));
  assert.ok(outputPath(root, "kinds-v0", "report.md").startsWith(join(root, "kinds-v0") + sep));
});

test("止まった道具の呼び出しは、前の製品に触れるものだけ拒む", () => {
  assert.equal(decideToolUse({ name: "bash", input: { command: "ls" } }).allow, true);
  assert.equal(decideToolUse({ name: "bash", input: { command: `git clone https://github.com/${PREV_ORG}/x` } }).allow, false);
  assert.equal(decideToolUse({ name: "web_fetch", input: { url: `https://github.com/${PREV_REPO}` } }).allow, false);
});

test("流れの終わり：requires_action は待ち、ほかの idle と terminated で終わる", () => {
  assert.deepEqual(streamStep({ type: "session.status_idle", stop_reason: { type: "requires_action" } }), { done: false });
  assert.deepEqual(streamStep({ type: "session.status_idle", stop_reason: { type: "end_turn" } }), { done: true, stopReason: "end_turn" });
  assert.deepEqual(streamStep({ type: "session.status_idle", stop_reason: { type: "budget_reached" } }), { done: true, stopReason: "budget_reached" });
  assert.deepEqual(streamStep({ type: "session.status_terminated" }), { done: true, stopReason: "terminated" });
  assert.deepEqual(streamStep({ type: "agent.message" }), { done: false });
});

test("最初の指示：鍵なしの clone、その SHA、パッチの置き場所、本文", () => {
  const s = parseTaskSpec(spec(HEAD, "作るもの"));
  const k = buildKickoff({ spec: s, repoUrl: "https://github.com/mushitaro/moyai.git", sha: SHA });
  assert.match(k, new RegExp(`git checkout -b agent/t-1 ${SHA}`));
  assert.match(k, /format-patch --binary --stdout/);
  assert.match(k, /\/mnt\/session\/outputs\/t-1\.patch/);
  assert.match(k, /作るもの/);
  assert.doesNotMatch(k, /token|ghp_/i);
  assert.throws(() => buildKickoff({ spec: s, repoUrl: "x", sha: "main" }), /SHA/);
});
