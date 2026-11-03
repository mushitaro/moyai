#!/usr/bin/env node
// CI の監査の回の費用を、ops/api-spend.jsonl に写す（手元で走らせる。gh を使う）。
// 同じ回は二度足さない（runId で見分ける）。artifact に費用があればそれを、無ければ API を呼んでいない回として $0 を足す。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLedger, loadLedger } from "./api-spend.mjs";

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
const repo = JSON.parse(gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner;
const runs = JSON.parse(
  gh("run", "list", "--repo", repo, "--workflow", "audit", "--status", "completed", "--limit", "100", "--json", "databaseId,createdAt,conclusion,event"),
);
const { synced } = loadLedger();
let added = 0;
for (const run of runs.sort((a, b) => a.databaseId - b.databaseId)) {
  const runId = String(run.databaseId);
  if (synced.has(runId)) continue;
  const dir = mkdtempSync(join(tmpdir(), "moyai-audit-"));
  let row;
  try {
    execFileSync("gh", ["run", "download", runId, "--repo", repo, "-n", "audit-result", "-D", dir], { stdio: "ignore" });
    const file = readdirSync(dir).find((f) => f.endsWith(".json"));
    const r = JSON.parse(readFileSync(join(dir, file), "utf8"));
    if (String(r.runId ?? "") !== runId) {
      // その回が自分で書いた結果でなければ信じない（回の番号が無い古い形や、別の回の写し）。人が確かめるまで費用は計れない扱い
      row = { at: run.createdAt, role: "audit", where: "ci", runId, usd: null, note: "artifact の回の番号が合わない。人が確かめる" };
    } else {
      const usd = typeof r.costUsd === "number" ? r.costUsd : r.usage && Object.keys(r.usage).length ? null : 0;
      row = { at: run.createdAt, role: "audit", where: "ci", runId, base: r.base, head: r.head, usd, usage: r.usage ?? {} };
    }
  } catch {
    row = { at: run.createdAt, role: "audit", where: "ci", runId, usd: 0, note: `artifact が無い（${run.conclusion}。監査の段で API を呼んでいない）` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  appendLedger(row);
  added++;
  console.log(`写した：回 ${runId}（${run.event}、${run.conclusion}）$${row.usd === null ? "計れない" : row.usd.toFixed(4)}`);
}
console.log(`api-spend-sync: ${added} 回を写した`);
