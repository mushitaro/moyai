// 物差しの新しいサンプル v4（mushitaro/moyai#111）。サンプルは MOYAI 本体に入れず、別の公開リポジトリ mushitaro/moyai-samples に置く（運営者の判断、11-14）。
// 記録は eval/bench/waste-incineration-v4/（frozen/ が凍結の 1 回、ほかが今の記録）。freeze.json の source にサンプルのリポジトリの commit と中の道。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 記録の名前（eval/bench/<これ>/）と、サンプルのリポジトリの中のフォルダの名前 */
export const V4_BENCH = "waste-incineration-v4";
/** サンプルのリポジトリ（公開。CI は記録した commit で取る） */
export const V4_REPO = "mushitaro/moyai-samples";

export const benchDir = (name = V4_BENCH, repo = ".") => join(repo, "eval", "bench", name);

/** 凍結の記録（frozen/freeze.json）。無ければ null */
export function readFreeze(name = V4_BENCH, repo = ".") {
  const p = join(benchDir(name, repo), "frozen", "freeze.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

/** 記録の施設のうち、資料の少ない n 施設（測れなかった施設は除く。同じ数なら名前の順） */
export function smallest(record, n = 3) {
  return record.facilities
    .filter((f) => !f.error && f.files > 0)
    .sort((a, b) => a.files - b.files || (a.facility < b.facility ? -1 : a.facility > b.facility ? 1 : 0))
    .slice(0, n)
    .map((f) => f.facility);
}

/** 記録から、その施設の行だけを残す（同じ施設の行どうしを --strict で比べるため） */
export function subsetOf(record, names) {
  const keep = new Set(names);
  return { ...record, facilities: record.facilities.filter((f) => keep.has(f.facility)) };
}
