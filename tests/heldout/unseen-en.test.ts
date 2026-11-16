// 見ていない英語の様式 en-1（グローバル対応の段 1b、2026-11-16）。tests/fixtures/unseen-en/ に置いた組の、順とハッシュと測った結果を確かめる。
// 順：読み手の commit → 組のハッシュの commit → 中身と結果の公開。測ったのは 1 回だけで、結果は測った値のまま置く（この組に合わせて読み手を直さない）。
// 書き手は新しいサブエージェントで、リポジトリを読まずに、正解の形（samples/heldout/ANSWER.md の写し）とパックの pack.json だけを見て書いた。
// 読まなかったことは仕組みでは止めきれない。証拠は時刻の順とハッシュ。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleHash } from "../../scripts/heldout/hash.mjs";

const ROOT = join(__dirname, "../..");
const SET = join(ROOT, "tests/fixtures/unseen-en/en-1");
const HASH = "tests/fixtures/unseen-en/en-1.hash.json";
const git = (...args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
/**
 * その道を最初に足した commit（無ければ null）。
 * --full-history：PR を squash でマージすると、ハッシュと中身が 1 つの commit に入る。元の commit を merge で main の歴史に戻した（#127 のあと）ので、
 * 横の枝もたどって、いちばん古く足した commit を取る
 */
function firstAdded(path: string): string | null {
  const xs = git("log", "--full-history", "--diff-filter=A", "--format=%H", "--", path).split("\n").filter(Boolean);
  return xs.length ? xs[xs.length - 1]! : null;
}
const isAncestor = (a: string, b: string) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { cwd: ROOT });
    return true;
  } catch {
    return false;
  }
};

describe("見ていない英語の様式 en-1", () => {
  const hash = JSON.parse(readFileSync(join(ROOT, HASH), "utf8"));
  const result = JSON.parse(readFileSync(join(SET, "measured", "result.json"), "utf8"));

  it("公開した中身のハッシュが、先にコミットしたハッシュと同じ", () => {
    expect(bundleHash(SET).bundle).toBe(hash.bundle);
    expect(result.bundle).toBe(hash.bundle);
  });

  it("読み手の commit → ハッシュの commit → 中身の公開の順", () => {
    const hashAt = firstAdded(HASH);
    const contentAt = firstAdded("tests/fixtures/unseen-en/en-1/measured/result.json");
    expect(hashAt, "ハッシュの commit").not.toBeNull();
    expect(contentAt, "中身の commit").not.toBeNull();
    expect(hashAt).not.toBe(contentAt);
    expect(isAncestor(hashAt!, contentAt!)).toBe(true);
    expect(result.reader.commit.startsWith(hash.reader_commit)).toBe(true);
    expect(isAncestor(result.reader.commit, hashAt!)).toBe(true);
    // 測った読み手の木に、組の中身は無い
    expect(() => git("cat-file", "-e", `${result.reader.commit}:tests/fixtures/unseen-en/en-1/README.md`)).toThrow();
  });

  it("測った結果をそのまま置いている（計画まで作れたかと、止めたもの）", () => {
    expect(result.schema).toBe("moyai.heldout.result/0");
    expect(typeof result.result.planMade).toBe("boolean");
    if (!result.result.planMade) expect(result.result.blockers.length).toBeGreaterThan(0);
  });
});
