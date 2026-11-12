// 新しいサンプルの凍結の測り（mushitaro/moyai#111・scripts/bench/freeze.mjs）を確かめる。heldout.test.ts の凍結の確かめと同じ形。
// eval/bench/<名前>/frozen/freeze.json ごとに：凍結のタグがあり、タグの木にサンプルが無い（凍結したとき、サンプルはまだ無かった）、
// タグ → サンプルを足したコミット → 凍結の記録のコミット の順、サンプルのハッシュが同じ、測った読み手の src/・packs/ がタグと同じ木。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleHash } from "../../scripts/heldout/hash.mjs";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (...args: string[]) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};
/** その道を最初に足した commit（無ければ null） */
function addedIn(path: string): string | null {
  const out = gitOk("rev-parse", "--is-inside-work-tree") ? git("log", "--diff-filter=A", "--format=%H", "--", path) : "";
  const xs = out.split("\n").filter(Boolean);
  return xs.length ? xs[xs.length - 1]! : null;
}

interface FreezeRecord {
  schema: "moyai.bench.freeze/0";
  samples: string;
  pack: string;
  tag: string;
  commit: string;
  reader: { src: string; packs: string };
  bundle: string;
  files: number;
  measuredAt: string;
}

const BENCH = join("eval", "bench");
const frozen = existsSync(BENCH) ? readdirSync(BENCH).filter((n) => existsSync(join(BENCH, n, "frozen", "freeze.json"))) : [];

describe("物差しの新しいサンプル：凍結の測り", () => {
  it("凍結の記録が無ければ確かめることは無い（新しいサンプルの承認待ち）", () => {
    expect(Array.isArray(frozen)).toBe(true);
  });
  for (const name of frozen) {
    it(`${name}：凍結 → サンプル → 測り の順、ハッシュ、測った読み手`, () => {
      const dir = join(BENCH, name, "frozen");
      const f = JSON.parse(readFileSync(join(dir, "freeze.json"), "utf8")) as FreezeRecord;
      expect(f.schema).toBe("moyai.bench.freeze/0");
      expect(f.samples.split("/").pop()).toBe(name);
      expect(f.bundle).toMatch(/^[0-9a-f]{64}$/);
      expect(gitOk("rev-parse", "--verify", `refs/tags/${f.tag}`), `タグ ${f.tag}`).toBe(true);
      expect(git("ls-tree", "-r", "--name-only", f.tag, "--", f.samples), "タグの木にサンプルが無い").toBe("");
      expect(git("rev-parse", `${f.tag}^{commit}`)).toBe(f.commit);
      expect(f.reader.src).toBe(git("rev-parse", `${f.tag}:src`));
      expect(f.reader.packs).toBe(git("rev-parse", `${f.tag}:packs`));
      const recCommit = addedIn(`${dir.replace(/\\/g, "/")}/freeze.json`);
      if (recCommit) expect(gitOk("merge-base", "--is-ancestor", f.tag, recCommit), "タグが凍結の記録より前").toBe(true);
      const samplesCommit = addedIn(f.samples);
      if (samplesCommit) {
        expect(gitOk("merge-base", "--is-ancestor", f.tag, samplesCommit), "タグがサンプルを足したコミットより前").toBe(true);
        if (recCommit) expect(gitOk("merge-base", "--is-ancestor", samplesCommit, recCommit), "サンプルを足したあとで測った").toBe(true);
      }
      for (const sub of ["result.json", "first-read/result.json"]) {
        const r = JSON.parse(readFileSync(join(dir, sub), "utf8")) as { samples?: string; reader: { src: string; packs: string; dirty: boolean } };
        expect(r.samples, sub).toBe(name);
        expect(r.reader.src, `${sub}：測った読み手の src/ がタグと同じ`).toBe(f.reader.src);
        expect(r.reader.packs, `${sub}：測った読み手の packs/ がタグと同じ`).toBe(f.reader.packs);
        expect(r.reader.dirty, sub).toBe(false);
      }
      if (!existsSync(f.samples)) return;
      expect(bundleHash(f.samples).bundle, "サンプルのハッシュが凍結の測りのときと同じ").toBe(f.bundle);
    });
  }
});
