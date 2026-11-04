// scripts/api-spend.mjs の型（F3 の `moyai eval` が TS から読むため）。
export declare const LEDGER: string;
export type LedgerRow = { at: string; role: string; usd: number; [k: string]: unknown };
export declare function loadLedger(path?: string): { rows: LedgerRow[]; broken: number; unknown: number; synced: Set<string> };
export declare function appendLedger(row: Record<string, unknown>, path?: string): void;
export declare function budgetCheck(
  budget: Record<string, number>,
  rows: LedgerRow[],
  role: string,
  nextEstimateUsd?: number,
  flaws?: { broken: number; unknown: number },
): { stop: true; reason: string } | { stop: false; all: number; poolSpent: number; pool: string };
