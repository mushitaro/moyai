// API の費用の台帳（足すだけ）。ops/api-spend.jsonl に 1 回 1 行で残し、累計と配分の残りを出す。
// config/models.json の budgetUsd を越える呼び出しは、呼ぶ前に止める。
import { readFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export const LEDGER = "ops/api-spend.jsonl";

/**
 * 台帳を読む。壊れた行は数えて返す（黙って捨てない）。
 * 費用を計れなかった回（usd が null）は unknown に数える。どちらも 1 件でもあれば、呼ぶ前の確かめで止める。
 */
export function readLedger(text) {
  const rows = [];
  let broken = 0;
  let unknown = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (typeof r.role !== "string") broken++;
      else if (typeof r.usd === "number" && Number.isFinite(r.usd)) rows.push(r);
      else if (r.usd === null) unknown++;
      else broken++;
    } catch {
      broken++;
    }
  }
  return { rows, broken, unknown };
}

/**
 * 台帳に入っている CI の回の鍵（「回の番号-試みの番号」）。同じ回を二度足さないため。
 * 古い行は runId だけを持つので、試み 1 と見なす。
 */
export function syncedRunIds(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    try {
      const r = JSON.parse(line);
      if (r?.runKey) keys.add(String(r.runKey));
      else if (r?.runId != null) keys.add(`${r.runId}-1`);
    } catch {
      /* 壊れた行は readLedger が数える */
    }
  }
  return keys;
}

/** 回の情報（id と run_attempt）から、試みごとの鍵の一覧を作る。再実行した回は試みの数だけ鍵がある。 */
export function runKeys(run) {
  const attempts = Math.max(1, Number(run.run_attempt ?? run.attempt ?? 1));
  return Array.from({ length: attempts }, (_, i) => `${run.id ?? run.databaseId}-${i + 1}`);
}

/**
 * まだ台帳に写していない CI の試みの費用の見込み。
 * @param {Array<{id: number|string, run_attempt?: number}>} runs 終わった CI の回
 * @param {Set<string>} synced 台帳に入っている鍵
 * @param {string|undefined} currentKey いま走っている試み（数えない）
 */
export function pendingCiEstimate(runs, synced, currentKey, perRunUsd) {
  const pending = runs.flatMap(runKeys).filter((k) => !synced.has(k) && k !== String(currentKey ?? ""));
  return { count: pending.length, usd: pending.length * perRunUsd };
}

/**
 * CI の 1 つの試みの artifact の中身から、台帳の行を作る（写す道具の判定。純粋な関数）。
 * artifact が無いか、別の試みのものなら、費用は計れない（null）として人に返す。
 * @param {{key: string, createdAt: string}} attempt
 * @param {object|null} artifact その試みが上げた結果（無ければ null）
 */
export function ledgerRowForAttempt(attempt, artifact) {
  const base = { at: attempt.createdAt, role: "audit", where: "ci", runKey: attempt.key };
  if (!artifact) return { ...base, usd: null, note: "その試みの記録（artifact）が無い。人が確かめる" };
  if (String(artifact.runKey ?? "") !== attempt.key) return { ...base, usd: null, note: "artifact の試みの鍵が合わない。人が確かめる" };
  if (artifact.called === false) return { ...base, usd: 0, note: `API を呼んでいない（${artifact.reason ?? "理由の記録なし"}）` };
  if (typeof artifact.costUsd === "number" && Number.isFinite(artifact.costUsd)) {
    return { ...base, base: artifact.base, head: artifact.head, usd: artifact.costUsd, usage: artifact.usage ?? {} };
  }
  return { ...base, base: artifact.base, head: artifact.head, usd: null, usage: artifact.usage ?? {}, note: "費用を計れない。人が確かめる" };
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
export function budgetCheck(budget, rows, role, nextEstimateUsd = 0, flaws = { broken: 0, unknown: 0 }) {
  if (flaws.broken > 0 || flaws.unknown > 0) {
    return {
      stop: true,
      reason: `台帳に、読めない行 ${flaws.broken} 件・費用を計れなかった回 ${flaws.unknown} 件がある。累計が分からないので、人が直すまで呼ばない`,
    };
  }
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
  if (!existsSync(path)) return { rows: [], broken: 0, unknown: 0, synced: new Set() };
  const text = readFileSync(path, "utf8");
  return { ...readLedger(text), synced: syncedRunIds(text) };
}

export function appendLedger(row, path = LEDGER) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const config = JSON.parse(readFileSync("config/models.json", "utf8"));
  const { rows, broken, unknown } = loadLedger();
  const t = totals(rows);
  console.log(
    `API の費用：合計 $${t.all.toFixed(4)}（${rows.length} 回${broken ? `、読めない行 ${broken}` : ""}${unknown ? `、費用を計れなかった回 ${unknown}` : ""}）。止める額 $${config.budgetUsd.stopAt}`,
  );
  for (const [role, usd] of Object.entries(t.byRole)) console.log(`  ${role}: $${usd.toFixed(4)}`);
}
