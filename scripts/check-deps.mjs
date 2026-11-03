#!/usr/bin/env node
// 依存の検査：package-lock.json に、使わない依存（AG Grid の Enterprise）が 1 つも無いことを確かめる。
// npm ls の終了コードの癖に頼らず、固定した依存の一覧を直接読む。
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const FORBIDDEN_DEPS = [/(^|\/)ag-grid-enterprise$/, /(^|\/)@ag-grid-enterprise\//];

/** package-lock.json（lockfileVersion 3）の packages から、禁じた依存を探す。 */
export function findForbidden(lock) {
  const names = Object.keys(lock.packages ?? {}).map((k) => k.replace(/^.*node_modules\//, ""));
  return names.filter((n) => FORBIDDEN_DEPS.some((re) => re.test(n)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const hits = findForbidden(lock);
  console.log(`check-deps: 固定した依存 ${Object.keys(lock.packages ?? {}).length - 1} 件を見た`);
  if (hits.length) {
    console.log(`check-deps: 使わない依存が入っている：${hits.join(", ")}`);
    process.exit(1);
  }
  console.log("check-deps: ag-grid-enterprise は無い");
}
