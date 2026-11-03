#!/usr/bin/env node
// CI の監査の試みの費用を、ops/api-spend.jsonl に写す（手元で走らせる。gh を使う）。
// 同じ試みは二度足さない（「回の番号-試みの番号」の鍵で見分ける）。判定は ledgerRowForAttempt（試験つき）。
// 取れない・合わない・計れないものは $0 にせず null で写し、次の呼び出しの前に人が確かめる。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLedger, ledgerRowForAttempt, loadLedger, runKeys } from "./api-spend.mjs";

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" });
const repo = JSON.parse(gh("repo", "view", "--json", "nameWithOwner")).nameWithOwner;
const runs = JSON.parse(
  gh("run", "list", "--repo", repo, "--workflow", "audit", "--status", "completed", "--limit", "5000", "--json", "databaseId,attempt,createdAt,conclusion,event"),
);
const { synced } = loadLedger();
let added = 0;
for (const run of runs.sort((a, b) => a.databaseId - b.databaseId)) {
  const keys = runKeys({ id: run.databaseId, run_attempt: run.attempt });
  for (const key of keys) {
    if (synced.has(key)) continue;
    // gh が取れる artifact は最後の試みのものだけ。それより前の試みは記録が無いものとして null で写す
    let artifact = null;
    if (key === keys[keys.length - 1]) {
      const dir = mkdtempSync(join(tmpdir(), "moyai-audit-"));
      try {
        execFileSync("gh", ["run", "download", String(run.databaseId), "--repo", repo, "-n", "audit-result", "-D", dir], { stdio: "ignore" });
        const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
        // 1 つの試みが上げる記録は 1 つ。2 つ以上あれば、どれが本物か分からないので記録が無い扱い
        if (files.length === 1) artifact = JSON.parse(readFileSync(join(dir, files[0]), "utf8"));
      } catch {
        artifact = null;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    const row = ledgerRowForAttempt({ key, createdAt: run.createdAt }, artifact);
    appendLedger(row);
    added++;
    console.log(`写した：${key}（${run.event}、${run.conclusion}）${row.usd === null ? "費用を計れない（人が確かめる）" : `$${row.usd.toFixed(4)}`}`);
  }
}
console.log(`api-spend-sync: ${added} 件を写した`);
