// API の費用の台帳（足すだけ）。ops/api-spend.jsonl に 1 回 1 行で残し、累計と配分の残りを出す。
// config/models.json の budgetUsd を越える呼び出しは、呼ぶ前に止める。
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const LEDGER = "ops/api-spend.jsonl";

/** 台帳を読む。壊れた行は数えて返す（黙って捨てない）。 */
export function readLedger(text) {
  const rows = [];
  let broken = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.usd === "number" && typeof r.role === "string") rows.push(r);
      else broken++;
    } catch {
      broken++;
    }
  }
  return { rows, broken };
}

/** 役ごとの合計と全体の合計。 */
export function totals(rows) {
  const byRole = {};
  let all = 0;
  for (const r of rows) {
    byRole[r.role] = (byRole[r.role] ?? 0) + r.usd;
    all += r.usd;
  }
  return { byRole, all };
}

/**
 * 呼ぶ前の確かめ。止めるなら理由を返す。
 * 配分の名前は役の名前と同じ（audit・dev・f3）。dev-core と factory は dev の配分から使う。
 */
export function budgetCheck(budget, rows, role, nextEstimateUsd = 0) {
  const t = totals(rows);
  const pool = role === "dev-core" || role === "factory" ? "dev" : role === "eval" ? "f3" : role;
  const poolSpent = Object.entries(t.byRole)
    .filter(([r]) => (r === "dev-core" || r === "factory" ? "dev" : r === "eval" ? "f3" : r) === pool)
    .reduce((a, [, v]) => a + v, 0);
  if (t.all + nextEstimateUsd >= budget.stopAt) {
    return { stop: true, reason: `API の費用の合計が止める額（$${budget.stopAt}）に届く（いま $${t.all.toFixed(2)}）。運営者に聞くまで呼ばない` };
  }
  const cap = budget[pool];
  if (typeof cap === "number" && poolSpent + nextEstimateUsd >= cap) {
    return { stop: true, reason: `「${pool}」の配分（$${cap}）に届く（いま $${poolSpent.toFixed(2)}）。運営者に聞くまで呼ばない` };
  }
  return { stop: false, all: t.all, poolSpent, pool };
}

export function loadLedger(path = LEDGER) {
  return existsSync(path) ? readLedger(readFileSync(path, "utf8")) : { rows: [], broken: 0 };
}

export function appendLedger(row, path = LEDGER) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const config = JSON.parse(readFileSync("config/models.json", "utf8"));
  const { rows, broken } = loadLedger();
  const t = totals(rows);
  console.log(`API の費用：合計 $${t.all.toFixed(4)}（${rows.length} 回${broken ? `、読めない行 ${broken}` : ""}）。止める額 $${config.budgetUsd.stopAt}`);
  for (const [role, usd] of Object.entries(t.byRole)) console.log(`  ${role}: $${usd.toFixed(4)}`);
}
