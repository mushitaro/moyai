#!/usr/bin/env node
// 開発のエージェント（Managed Agents）に仕事を 1 件渡す道具。
//   node scripts/agents/dispatch.mjs sync                       ops/agents/ の定義を API にそろえ、ids.json に書く
//   node scripts/agents/dispatch.mjs run <仕様.md>              呼ぶ前に配分を確かめ、上限つきのセッションで走らせ、パッチを取る
//   node scripts/agents/dispatch.mjs collect <仕様.md> <セッション>  走ったセッションの出力と費用を取り直す（台帳に無いときだけ足す）
//   node scripts/agents/dispatch.mjs verify <仕様.md> <パッチ>  一時の clone でパッチが当たるかと試験を確かめる（主の作業ツリーに触れない）
// キーは環境変数 ANTHROPIC_API_KEY から SDK が読む。表示しない、書かない。
// サンドボックスには GitHub の鍵を渡さない。公開のリポジトリを https で clone させ、成果はパッチのファイルで受け取る。
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, readdirSync, symlinkSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseTaskSpec,
  gate,
  sessionBudget,
  agentParams,
  environmentParams,
  specHash,
  recomputeUsd,
  ledgerRow,
  outputPath,
  decideToolUse,
  streamStep,
  buildKickoff,
} from "./lib.mjs";
import { loadLedger, appendLedger, LEDGER } from "../api-spend.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const AGENTS_DIR = join(ROOT, "ops", "agents");
const IDS = join(AGENTS_DIR, "ids.json");
const REPO_URL = "https://github.com/mushitaro/moyai.git";
const OUT_ROOT = process.env.MOYAI_AGENTS_OUT ?? "C:\\tmp\\moyai-agents";
const BETA = "managed-agents-2026-04-01";

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const config = () => readJson(join(ROOT, "config", "models.json"));
const ids = () => (existsSync(IDS) ? readJson(IDS) : { agents: {}, environments: {} });
const saveIds = (v) => writeFileSync(IDS, JSON.stringify(v, null, 2) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(...a);

async function client() {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY が無い（ユーザー環境変数から同じコマンドの中で入れる）");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  return new Anthropic({ maxRetries: 4, timeout: 10 * 60 * 1000 });
}

function definitions() {
  const agents = {};
  const envs = {};
  for (const f of readdirSync(AGENTS_DIR).sort()) {
    if (!f.endsWith(".json") || f === "ids.json") continue;
    const key = f.slice(0, -5);
    const def = readJson(join(AGENTS_DIR, f));
    if (key.startsWith("env-")) envs[key] = environmentParams(def);
    else {
      const system = def.system.map((s) => readFileSync(join(AGENTS_DIR, s), "utf8").trim()).join("\n\n");
      agents[key] = agentParams(def, config(), system);
    }
  }
  return { agents, envs };
}

/** 定義を API にそろえる。変わったものだけ作る・直す。消さない、しまわない。 */
async function sync(c) {
  const { agents, envs } = definitions();
  const cur = ids();
  cur.agents ??= {};
  cur.environments ??= {};
  for (const [key, params] of Object.entries(envs)) {
    const hash = specHash(params);
    const have = cur.environments[key];
    if (!have) {
      const e = await c.beta.environments.create(params);
      cur.environments[key] = { id: e.id, hash };
      log(`環境 ${key}：作った ${e.id}`);
    } else if (have.hash !== hash) {
      await c.beta.environments.update(have.id, params);
      cur.environments[key] = { id: have.id, hash };
      log(`環境 ${key}：直した ${have.id}`);
    }
    saveIds(cur);
  }
  for (const [key, params] of Object.entries(agents)) {
    const hash = specHash(params);
    const have = cur.agents[key];
    if (!have) {
      const a = await c.beta.agents.create(params);
      cur.agents[key] = { id: a.id, version: a.version, hash };
      log(`エージェント ${key}：作った ${a.id} 版 ${a.version}`);
    } else if (have.hash !== hash) {
      const a = await c.beta.agents.update(have.id, { ...params, version: have.version });
      cur.agents[key] = { id: a.id, version: a.version, hash };
      log(`エージェント ${key}：直した ${a.id} 版 ${a.version}`);
    }
    saveIds(cur);
  }
  return cur;
}

function mainSha() {
  const out = execFileSync("git", ["-c", "credential.helper=", "ls-remote", REPO_URL, "refs/heads/main"], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  const sha = out.split(/\s+/)[0];
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("公開の main の SHA が取れない");
  return sha;
}

function loadSpec(path) {
  return parseTaskSpec(readFileSync(resolve(path), "utf8"));
}

/** 流れを読み、終わるまで待つ。切れたら履歴と突き合わせてつなぎ直す。 */
async function drive(c, sessionId, kickoff, { deadlineMs, eventsLog }) {
  const seen = new Set();
  let sent = false;
  let timedOut = false;
  let lastStep = { done: false };
  const t0 = Date.now();
  const timer = setTimeout(async () => {
    timedOut = true;
    log("時間の上限に届いた。止める（user.interrupt）");
    try {
      await c.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] });
    } catch (e) {
      log(`止める合図が送れない：${e.message}`);
    }
  }, deadlineMs);
  const handle = async (ev) => {
    appendFileSync(eventsLog, JSON.stringify(ev) + "\n");
    const mmss = new Date(Date.now() - t0).toISOString().slice(11, 19);
    if (ev.type === "agent.tool_use" || ev.type === "agent.mcp_tool_use") {
      log(`[${mmss}] 道具 ${ev.name}${ev.evaluated_permission && ev.evaluated_permission !== "allow" ? `（${ev.evaluated_permission}）` : ""}`);
      if (ev.evaluated_permission === "ask") {
        const d = decideToolUse(ev);
        log(`[${mmss}]   止まった呼び出しを決めた：${d.allow ? "allow" : "deny"}`);
        await c.beta.sessions.events.send(sessionId, {
          events: [
            d.allow
              ? { type: "user.tool_confirmation", tool_use_id: ev.id, result: "allow" }
              : { type: "user.tool_confirmation", tool_use_id: ev.id, result: "deny", deny_message: d.message },
          ],
        });
      }
    } else if (ev.type === "agent.message") {
      const text = (ev.content ?? []).map((b) => b.text ?? "").join("").replace(/\s+/g, " ");
      log(`[${mmss}] 言葉 ${text.slice(0, 160)}`);
    } else if (ev.type === "session.error") {
      log(`[${mmss}] 誤り ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
    } else if (ev.type.startsWith("session.status_")) {
      log(`[${mmss}] 状態 ${ev.type}${ev.stop_reason ? ` ${ev.stop_reason.type}` : ""}`);
    }
  };
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const stream = await c.beta.sessions.events.stream(sessionId);
        if (attempt > 0) {
          for await (const ev of c.beta.sessions.events.list(sessionId)) {
            if (seen.has(ev.id)) continue;
            seen.add(ev.id);
            await handle(ev);
            if (ev.type?.startsWith("session.status_")) lastStep = streamStep(ev);
          }
          if (lastStep.done) return { ...lastStep, timedOut };
        }
        if (!sent) {
          await c.beta.sessions.events.send(sessionId, { events: [{ type: "user.message", content: [{ type: "text", text: kickoff }] }] });
          sent = true;
        }
        for await (const ev of stream) {
          if (ev.id && seen.has(ev.id)) {
            /* 重なり */
          } else {
            if (ev.id) seen.add(ev.id);
            await handle(ev);
          }
          const step = streamStep(ev);
          if (step.done) return { ...step, timedOut };
        }
        log("流れが閉じた。つなぎ直す");
      } catch (e) {
        log(`流れが切れた（${e.message}）。つなぎ直す`);
        await sleep(Math.min(30000, 2000 * (attempt + 1)));
      }
    }
    throw new Error("流れに 20 回つなぎ直しても終わらない");
  } finally {
    clearTimeout(timer);
  }
}

/** 出力を落とし、費用を台帳に足す。 */
async function finish(c, spec, sessionId, { base, wallSeconds, stopReason, note }) {
  const outDir = join(OUT_ROOT, spec.meta.id);
  mkdirSync(outDir, { recursive: true });
  let s = await c.beta.sessions.retrieve(sessionId);
  for (let i = 0; i < 10 && s.status === "running"; i++) {
    await sleep(2000);
    s = await c.beta.sessions.retrieve(sessionId);
  }
  const files = [];
  for (let i = 0; i < 5; i++) {
    for await (const f of c.beta.files.list({ scope_id: sessionId, betas: [BETA] })) files.push(f);
    if (files.length) break;
    await sleep(3000);
  }
  const saved = [];
  let skipped = 0;
  for (const f of files) {
    let p;
    try {
      p = outputPath(OUT_ROOT, spec.meta.id, f.filename);
    } catch (e) {
      skipped++;
      log(`落とさないファイル：${e.message}`);
      continue;
    }
    const resp = await c.beta.files.download(f.id);
    writeFileSync(p, Buffer.from(await resp.arrayBuffer()));
    saved.push({ path: p, bytes: f.size_bytes });
  }
  const cfg = config();
  const price = cfg.pricesUsdPerMTok[cfg.roles[spec.meta.role].model];
  const recomputed = price ? recomputeUsd(s.usage, price) : null;
  const row = ledgerRow({
    at: new Date().toISOString(),
    role: spec.meta.role,
    task: spec.meta.id,
    sessionId,
    base,
    usage: s.usage,
    wallSeconds,
    stopReason,
    recomputed,
    note,
  });
  const already = loadLedger(join(ROOT, LEDGER)).rows.some((r) => r.session === sessionId);
  if (already) log("このセッションは台帳にもうある。足さない");
  else appendLedger(row, join(ROOT, LEDGER));
  const summary = { session: sessionId, status: s.status, base, stopReason, wallSeconds, usage: s.usage, ledger: row, saved, skipped };
  writeFileSync(join(outDir, "run.json"), JSON.stringify(summary, null, 2) + "\n");
  log(`費用 $${row.usd}（数え直し $${row.recomputedUsd}）。落としたファイル ${saved.length}${skipped ? `、落とさなかった ${skipped}` : ""}。${outDir}`);
  return summary;
}

async function run(specPath, args) {
  const spec = loadSpec(specPath);
  const cfg = config();
  const { rows, broken } = loadLedger(join(ROOT, LEDGER));
  if (broken) throw new Error(`台帳に読めない行が ${broken} ある。直すまで呼ばない`);
  const g = gate(cfg, rows, spec.meta);
  if (g.stop) throw new Error(g.reason);
  log(`配分の確かめ：通る（「${g.pool}」で使った額 $${g.poolSpent.toFixed(2)}、全体 $${g.all.toFixed(2)}、この回の上限 $${spec.meta.budgetUsd}）`);
  const c = await client();
  const cur = await sync(c);
  const agent = cur.agents[spec.meta.agent];
  const env = cur.environments[spec.meta.environment];
  if (!agent || !env) throw new Error(`エージェント ${spec.meta.agent} か環境 ${spec.meta.environment} の定義が ops/agents/ に無い`);
  const base = args.sha ?? mainSha();
  const kickoff = buildKickoff({ spec, repoUrl: REPO_URL, sha: base });
  const outDir = join(OUT_ROOT, spec.meta.id);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "kickoff.md"), kickoff);
  const t0 = Date.now();
  const session = await c.beta.sessions.create({
    agent: { type: "agent", id: agent.id, version: agent.version },
    environment_id: env.id,
    title: `${spec.meta.id} @ ${base.slice(0, 7)}`,
    budget: sessionBudget(spec.meta.budgetUsd),
    metadata: { task: spec.meta.id, role: spec.meta.role, base },
  });
  log(`セッション ${session.id}（上限 $${spec.meta.budgetUsd}、main ${base.slice(0, 7)}）`);
  log(`見る所：https://platform.claude.com/workspaces/default/sessions/${session.id}（既定のワークスペースでないときは ID を差し替える）`);
  writeFileSync(join(outDir, "session.txt"), `${session.id}\n${base}\n`);
  let result = { stopReason: "error" };
  let err = null;
  try {
    result = await drive(c, session.id, kickoff, { deadlineMs: spec.meta.timeoutMin * 60 * 1000, eventsLog: join(outDir, "events.jsonl") });
  } catch (e) {
    err = e;
  }
  const wallSeconds = Math.round((Date.now() - t0) / 1000);
  const stopReason = result.timedOut ? `timeout-interrupt/${result.stopReason}` : result.stopReason;
  const summary = await finish(c, spec, session.id, { base, wallSeconds, stopReason, note: err ? `流れの誤り：${err.message}` : "" });
  if (err) throw err;
  return summary;
}

async function collect(specPath, sessionId, args) {
  const spec = loadSpec(specPath);
  const c = await client();
  const outDir = join(OUT_ROOT, spec.meta.id);
  const base = args.base ?? (existsSync(join(outDir, "session.txt")) ? readFileSync(join(outDir, "session.txt"), "utf8").split(/\r?\n/)[1] : null);
  return finish(c, spec, sessionId, { base, wallSeconds: args.wall ? Number(args.wall) : null, stopReason: "collected", note: "collect で取り直した" });
}

/** 一時の clone にパッチを当て、仕様の verify を走らせる。主の作業ツリーには触れない。 */
function verify(specPath, patchPath, args) {
  const spec = loadSpec(specPath);
  const patch = resolve(patchPath);
  const base = args.base ?? execFileSync("git", ["-C", ROOT, "rev-parse", "origin/main"], { encoding: "utf8" }).trim();
  const dir = join(OUT_ROOT, spec.meta.id, `verify-${Date.now()}`);
  const git = (...a) => spawnSync("git", a, { encoding: "utf8" });
  const r0 = git("clone", "--quiet", "--no-checkout", ROOT, dir);
  if (r0.status !== 0) throw new Error(`clone できない：${r0.stderr}`);
  git("-C", dir, "checkout", "--quiet", "--detach", base);
  const check = git("-C", dir, "apply", "--check", "--whitespace=nowarn", patch);
  const result = { base, dir, applyCheck: check.status === 0, applyStderr: check.stderr.trim(), steps: [] };
  if (result.applyCheck) {
    const am = spawnSync("git", ["-C", dir, "-c", "user.name=moyai-verify", "-c", "user.email=verify@moyai.invalid", "am", "--quiet", "--keep-cr", patch], { encoding: "utf8" });
    result.am = am.status === 0;
    if (!result.am) {
      git("-C", dir, "am", "--abort");
      result.applied = git("-C", dir, "apply", "--whitespace=nowarn", patch).status === 0;
    } else result.applied = true;
    const nm = join(ROOT, "node_modules");
    if (existsSync(nm) && !existsSync(join(dir, "node_modules"))) symlinkSync(nm, join(dir, "node_modules"), "junction");
    const py =
      process.env.MOYAI_PYTHON ??
      [join(ROOT, "samples", "factory", ".venv", "Scripts", "python.exe"), join(ROOT, "samples", "factory", ".venv", "bin", "python")].find(existsSync) ??
      "python";
    for (const cmd of spec.meta.verify) {
      const line = cmd.replaceAll("{python}", `"${py}"`);
      const t = Date.now();
      const r = spawnSync(line, { cwd: dir, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const tail = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim().split(/\r?\n/).slice(-12).join("\n");
      result.steps.push({ cmd, status: r.status, seconds: Math.round((Date.now() - t) / 1000), tail });
      log(`${r.status === 0 ? "通った" : "落ちた"}（${r.status}）：${cmd}`);
    }
  } else log(`パッチが当たらない：${check.stderr.trim().slice(0, 500)}`);
  writeFileSync(join(OUT_ROOT, spec.meta.id, "verify.json"), JSON.stringify(result, null, 2) + "\n");
  log(`確かめた結果：${join(OUT_ROOT, spec.meta.id, "verify.json")}`);
  return result;
}

function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) opt[argv[i].slice(2)] = argv[++i];
    else pos.push(argv[i]);
  }
  return { pos, opt };
}

const { pos, opt } = parseArgs(process.argv.slice(2));
const [cmd, a1, a2] = pos;
try {
  if (cmd === "sync") await sync(await client());
  else if (cmd === "run" && a1) await run(a1, opt);
  else if (cmd === "collect" && a1 && a2) await collect(a1, a2, opt);
  else if (cmd === "verify" && a1 && a2) {
    const r = verify(a1, a2, opt);
    process.exitCode = r.applyCheck && r.steps.every((s) => s.status === 0) ? 0 : 1;
  } else {
    log("使い方：dispatch.mjs sync | run <仕様.md> [--sha <sha>] | collect <仕様.md> <セッション> | verify <仕様.md> <パッチ> [--base <sha>]");
    process.exitCode = 2;
  }
} catch (e) {
  log(`止めた：${e.message}`);
  process.exitCode = 1;
}
