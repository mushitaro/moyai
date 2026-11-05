// import.heldout（docs/plan.md §2.6・§5.1）：見ていない様式。
// 1. 走らせる（MOYAI_HELDOUT_DIR があるとき）：凍結のタグを取り出した worktree の中で、組を読み、物差しを測って MOYAI_HELDOUT_OUT に書く。
//    読み手（src/ と packs/）の木のハッシュと commit も書く。src/ と packs/ に commit していない変更があれば測らない。
// 2. 確かめる（いつも）：samples/heldout/hashes/<組>.json ごとに、
//    凍結のタグ → ハッシュのコミット → 中身の公開 の順になっていること（タグの木に組の中身が無いこと）、
//    公開した中身のハッシュが先にコミットしたハッシュと同じこと、結果を測った読み手の src/ と packs/ がタグと同じ木であること。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleHash } from "../../scripts/heldout/hash.mjs";
import { runAnswerSet } from "./answer";
import { loadSet } from "./contract";
import { runSet, type SetResult } from "./harness";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const gitOk = (...args: string[]) => {
  try {
    git(...args);
    return true;
  } catch {
    return false;
  }
};

const HASHES = "samples/heldout/hashes";

export interface HashRecord {
  schema: "moyai.heldout.hash/0";
  set: string;
  /** 組のハッシュ（scripts/heldout/hash.mjs） */
  bundle: string;
  files: number;
  /** 読み手を凍結したタグ */
  freeze_tag: string;
}

export interface HeldoutResult {
  schema: "moyai.heldout.result/0";
  set: string;
  bundle: string;
  reader: { tag: string | null; commit: string; src: string; packs: string };
  measuredAt: string;
  result: SetResult;
  /** 指示書 §5 の形の組（施設ごとのフォルダ）：施設ごとの結果。result はそのまとめ */
  facilities?: { key: string; industry: string; result: SetResult; unmapped: string[] }[];
}

/** その道を最初に足した commit（無ければ null。commit していない作業中の道も null） */
function addedIn(path: string): string | null {
  const out = gitOk("rev-parse", "--is-inside-work-tree") ? git("log", "--diff-filter=A", "--format=%H", "--", path) : "";
  const xs = out.split("\n").filter(Boolean);
  return xs.length ? xs[xs.length - 1]! : null;
}

describe("import.heldout：見ていない様式", () => {
  const dir = process.env.MOYAI_HELDOUT_DIR;
  it.runIf(!!dir)("組を、今の読み手で読んで測る（凍結のタグの worktree で走らせる）", async () => {
    const out = process.env.MOYAI_HELDOUT_OUT;
    expect(out, "MOYAI_HELDOUT_OUT（結果を書く道）").toBeTruthy();
    // 読み手に commit していない変更があれば測らない（タグと同じ src/ で測ったと言えなくなるため）
    expect(git("status", "--porcelain", "--", "src", "packs"), "src/ と packs/ の commit していない変更").toBe("");
    const factsDir = join(dir!, "measured", "facts");
    const factsOf = (prefix: string, files: string[]) => {
      const facts: Record<string, unknown> = {};
      if (existsSync(factsDir)) for (const f of files) {
        const p = join(factsDir, `${prefix}${f.replace(/\//g, "__")}.facts.json`);
        if (existsSync(p)) facts[f] = JSON.parse(readFileSync(p, "utf8"));
      }
      return facts;
    };
    // truth.json の組（場所の形）か、施設ごとのフォルダに answer/ を持つ組（指示書 §5 の形。samples/heldout/ANSWER.md）
    let result: SetResult;
    let facilities: HeldoutResult["facilities"];
    let setName: string;
    if (existsSync(join(dir!, "truth.json"))) {
      const set = loadSet(dir!);
      setName = set.truth.set;
      result = (await runSet(set, { facts: factsOf("", set.truth.files.map((f) => f.file)) })).result;
    } else {
      const names = (key: string) => (existsSync(join(dir!, key, "answer", "files")) ? readdirSync(join(dir!, key, "answer", "files")).map((n) => JSON.parse(readFileSync(join(dir!, key, "answer", "files", n), "utf8")).file as string) : []);
      const r = await runAnswerSet(dir!, (key) => factsOf(`${key}__`, names(key)));
      result = r.result;
      facilities = r.facilities;
      setName = r.result.set;
    }
    const head = git("rev-parse", "HEAD");
    const tag = gitOk("describe", "--tags", "--exact-match", "HEAD") ? git("describe", "--tags", "--exact-match", "HEAD") : null;
    const rec: HeldoutResult = {
      schema: "moyai.heldout.result/0",
      set: setName,
      bundle: bundleHash(dir!).bundle,
      reader: { tag, commit: head, src: git("rev-parse", "HEAD:src"), packs: git("rev-parse", "HEAD:packs") },
      measuredAt: new Date().toISOString(),
      result,
      ...(facilities ? { facilities } : {}),
    };
    mkdirSync(dirname(out!), { recursive: true });
    writeFileSync(out!, `${JSON.stringify(rec, null, 1)}\n`, "utf8");
    console.log(`見ていない様式 ${setName}：${result.files.map((f) => `${f.file} ①${f.leak ?? "—"} ②${f.unresolved ?? "—"} ③${f.accuracy ? `${f.accuracy.correct}/${f.accuracy.total}` : "—"}`).join("、")}・⑤ ${result.asked}・計画 ${result.planMade ? "作った" : `作らなかった（${result.blockers.join("・")}）`}`);
  }, 600_000);

  it("組のハッシュは、measured/ を除くファイルの道の順の一覧から決まる", () => {
    const d = mkdtempSync(join(tmpdir(), "moyai-heldout-hash-"));
    try {
      mkdirSync(join(d, "files", "b"), { recursive: true });
      mkdirSync(join(d, "measured"), { recursive: true });
      writeFileSync(join(d, "files", "b", "x.csv"), "a,b\r\n");
      writeFileSync(join(d, "truth.json"), "{}");
      const h1 = bundleHash(d);
      expect(h1.files.map((f: { path: string }) => f.path)).toEqual(["files/b/x.csv", "truth.json"]);
      writeFileSync(join(d, "measured", "result.json"), "{}");
      expect(bundleHash(d).bundle).toBe(h1.bundle);
      writeFileSync(join(d, "files", "b", "x.csv"), "a,b\n");
      expect(bundleHash(d).bundle).not.toBe(h1.bundle);
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });

  const records = existsSync(HASHES) ? readdirSync(HASHES).filter((f) => f.endsWith(".json")) : [];
  for (const name of records) {
    it(`${name}：凍結 → ハッシュ → 公開 の順、ハッシュ、測った読み手`, () => {
      const h = JSON.parse(readFileSync(join(HASHES, name), "utf8")) as HashRecord;
      expect(h.schema).toBe("moyai.heldout.hash/0");
      expect(name).toBe(`${h.set}.json`);
      expect(h.bundle).toMatch(/^[0-9a-f]{64}$/);
      // 凍結のタグがあり、タグの木に組の中身が無い（読み手を凍結したとき、組はまだ無かった）
      expect(gitOk("rev-parse", "--verify", `refs/tags/${h.freeze_tag}`), `タグ ${h.freeze_tag}`).toBe(true);
      expect(git("ls-tree", "-r", "--name-only", h.freeze_tag, "--", `samples/heldout/${h.set}`)).toBe("");
      // タグ → ハッシュのコミット
      const hashCommit = addedIn(join(HASHES, name).replace(/\\/g, "/"));
      if (hashCommit) expect(gitOk("merge-base", "--is-ancestor", h.freeze_tag, hashCommit), "タグがハッシュのコミットより前").toBe(true);
      const setDir = `samples/heldout/${h.set}`;
      if (!existsSync(setDir)) return;
      // 公開した中身のハッシュが同じ
      expect(bundleHash(setDir).bundle, "公開した組のハッシュ").toBe(h.bundle);
      const pubCommit = addedIn(`${setDir}/truth.json`);
      if (hashCommit && pubCommit) {
        expect(pubCommit, "ハッシュと中身を同じコミットで足していない").not.toBe(hashCommit);
        expect(gitOk("merge-base", "--is-ancestor", hashCommit, pubCommit), "ハッシュのコミットが公開より前").toBe(true);
      }
      // 結果：凍結のタグと同じ src/ と packs/ の木で測った
      const resultPath = `${setDir}/measured/result.json`;
      if (!existsSync(resultPath)) return;
      const r = JSON.parse(readFileSync(resultPath, "utf8")) as HeldoutResult;
      expect(r.bundle).toBe(h.bundle);
      expect(r.reader.src, "測った読み手の src/ がタグと同じ").toBe(git("rev-parse", `${h.freeze_tag}:src`));
      expect(r.reader.packs, "測った読み手の packs/ がタグと同じ").toBe(git("rev-parse", `${h.freeze_tag}:packs`));
    });
  }
});
