// 履歴の浅い clone（git clone --depth・入れ物の既定の clone）で試験を回すときの案内（mushitaro/moyai#26）。
// 凍結のタグと履歴を見る試験（tests/heldout/heldout.test.ts など）は、履歴とタグが全部ないと落ちる。CI は fetch-depth: 0 で取る。
// 試験は飛ばさない・緩めない。落ちた理由が履歴の浅さかもしれないことを、取り方と一緒に知らせるだけ。
import { spawnSync } from "node:child_process";

/** この作業場所が浅い clone か（git が無い・リポジトリでないときは null） */
export function isShallow(cwd = process.cwd()) {
  const r = spawnSync("git", ["rev-parse", "--is-shallow-repository"], { cwd, encoding: "utf8" });
  if (r.status !== 0) return null;
  return r.stdout.trim() === "true";
}

/** 浅い clone のときの案内の文（浅くなければ null）。failed：試験が落ちたあとに出す文か */
export function shallowNote(shallow, failed = false) {
  if (shallow !== true) return null;
  const how = "git fetch --unshallow origin && git fetch origin --tags";
  return failed
    ? `run-tests: この作業場所は履歴の浅い clone です。凍結のタグと履歴を見る試験は、履歴とタグが全部ないと落ちます。落ちた試験がそれなら、先に取ってから回し直してください：${how}`
    : `run-tests: 知らせ：この作業場所は履歴の浅い clone です。凍結のタグと履歴を見る試験が落ちることがあります（取り方：${how}）。試験は飛ばさずに走らせます。`;
}
