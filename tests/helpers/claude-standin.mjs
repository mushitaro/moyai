#!/usr/bin/env node
// 試験だけの道具：Claude Code（claude -p）の代わり。本物の Claude を呼ばない（使用量も API のキーも使わない）CI で、tests/e2e/claude-code.spec.ts の道を通す。
// 本物と同じ引数を受け、同じ --mcp-config（リポジトリの .mcp.json）の moyai を、本物の中継（dist/cli.js mcp。標準入出力の MCP）として起こしてつなぐ。
// --allowedTools に無いツールは呼ばない（呼ぼうとしたら止まる）。出力は本物と同じ stream-json（assistant の tool_use と、最後の result）。
// AI の判断（どの答え・どの規則）は試験の台本が決める：質問は既定の答え、規則は MOYAI_STANDIN_RULES の JSON（tests/fixtures/crosswalk/rules.ts の f1Rules）。
// 本物の Claude Code での通しは MOYAI_CLAUDE_E2E=1（M-PC3 などの手元。CI ではしない）。
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const args = process.argv.slice(2);
const val = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};
const prompt = val("-p");
const mcpConfig = val("--mcp-config");
const allowed = new Set((val("--allowedTools") ?? "").split(",").filter(Boolean));
if (!prompt || !mcpConfig || val("--output-format") !== "stream-json") {
  process.stderr.write("claude-standin：-p・--mcp-config・--output-format stream-json が要る\n");
  process.exit(2);
}
const rulesFile = process.env.MOYAI_STANDIN_RULES;
if (!rulesFile) {
  process.stderr.write("claude-standin：MOYAI_STANDIN_RULES が無い\n");
  process.exit(2);
}
const rules = JSON.parse(readFileSync(rulesFile, "utf8"));

const server = JSON.parse(readFileSync(resolve(mcpConfig), "utf8")).mcpServers?.moyai;
if (!server || server.type !== "stdio") {
  process.stderr.write("claude-standin：--mcp-config に stdio の moyai が無い\n");
  process.exit(2);
}
const emit = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);
const client = new Client({ name: "claude-standin", version: "0" });
// 本物の Claude Code と同じく、MCP の中継は MOYAI の環境（MOYAI_STATE_DIR など）を受け継いで起こす
await client.connect(new StdioClientTransport({ command: server.command, args: server.args ?? [], env: { ...process.env }, stderr: "pipe" }));
const { tools } = await client.listTools();
const have = new Set(tools.map((t) => `mcp__moyai__${t.name}`));

async function call(name, a = {}) {
  const full = `mcp__moyai__${name}`;
  if (!allowed.has(full) || !have.has(full)) throw new Error(`許されていないか無いツール：${full}`);
  emit({ type: "assistant", message: { content: [{ type: "tool_use", name: full, input: a }] } });
  const r = await client.callTool({ name, arguments: a });
  if (r.isError) throw new Error(`${name}：${JSON.stringify(r.content).slice(0, 300)}`);
  return r.structuredContent;
}

let code = 0;
try {
  // 1) 既定の答えがある質問に、その答えを置く。質問が無くなるまで
  let settled = 0;
  for (let round = 0; round < 20; round++) {
    const s = await call("intake_survey", { part: "questions" });
    const qs = (s.questions ?? []).filter((q) => q.defaultAnswer != null);
    if (!qs.length) break;
    for (let i = 0; i < qs.length; i += 50) {
      const decisions = qs.slice(i, i + 50).map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai", reason: "既定の答えを置いた（Claude Code の通し）" }));
      await call("intake_settle", { decisions });
      settled += decisions.length;
    }
  }
  // 2) 計画を作り、compose が done になるまで待つ
  await call("intake_compose");
  let state = "running";
  for (let i = 0; i < 300 && state === "running"; i++) {
    state = (await call("intake_survey", { part: "compose" })).compose?.state ?? "running";
    if (state === "running") await new Promise((r) => setTimeout(r, 200));
  }
  if (state !== "done") throw new Error(`計画を作れなかった（${state}）`);
  // 3) 紐付けの版を読み、4) 当てはめの規則を置く
  const version = (await call("intake_survey", { part: "crosswalk" })).crosswalk.version;
  const r = await call("crosswalk_propose", { rules, basedOnVersion: version });
  emit({ type: "result", result: `代わりの台本：既定の答え ${settled} 件・規則 ${rules.length} 件を置いた。${JSON.stringify(r?.unmapped ?? null).slice(0, 200)}` });
} catch (e) {
  emit({ type: "result", result: `代わりの台本が止まった：${e instanceof Error ? e.message : String(e)}` });
  code = 1;
} finally {
  await client.close();
}
process.exit(code);
