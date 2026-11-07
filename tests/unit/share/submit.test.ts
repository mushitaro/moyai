// ledger submit（人だけの CLI。docs/plan.md §2.8 場 2・§2.12）：標準入力が端末でなければ断る。署名済みの束を、台帳の既定のブランチの木に
// 足したときに受け手と同じ関数で ✓ かを確かめ、作業の木と索引を変えずに枝を作り、push と gh のコマンドを出す（走らせない）。
// 支度した枝は validate-pr でも ✓。一時のフォルダの本物の git のリポジトリで試す。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { submitCli, validatePrCli } from "../../../src/cli/ledger";
import { SPEC, TABLE_TEXT, VOCAB_TEXT, smallPlan } from "./fixtures";
import { makeLedger, makeSigner, sealLedger, sealRetired, type Sealed } from "./ledger-fixtures";

const L = makeLedger();
const A = makeSigner();
let a1: Sealed;
let a2: Sealed;
let a3: Sealed;
let tmp = "";
let repo = "";
let packsDir = "";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]}：${r.stderr}`);
  return r.stdout.trim();
}
function put(dir: string, rel: string, text: string): void {
  mkdirSync(join(dir, ...rel.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(join(dir, ...rel.split("/")), text);
}

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-submit-"));
  a1 = sealLedger(L, A, smallPlan());
  a2 = sealLedger(L, A, smallPlan(), { seq: 2, prev: a1.hash });
  a3 = sealLedger(L, A, smallPlan(), { seq: 3, prev: a2.hash });
  packsDir = join(tmp, "packs");
  const pdir = join(packsDir, "waste-incineration");
  mkdirSync(join(pdir, "national"), { recursive: true });
  writeFileSync(join(pdir, "national", "table.json"), TABLE_TEXT);
  writeFileSync(join(pdir, "vocab.json"), VOCAB_TEXT);
  writeFileSync(join(pdir, "pack.json"), JSON.stringify({ id: "waste-incineration", name: "架空", profile: SPEC }));
  repo = join(tmp, "台帳の clone");
  mkdirSync(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "moyai-test");
  git(repo, "config", "user.email", "test@example.invalid");
  put(repo, "ledger/ledger/ledger.json", L.text);
  put(repo, "ledger/ledger/TERMS.md", "【架空】試験の利用条件\n");
  put(repo, a1.path, a1.text);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  for (const s of [a2, a3]) writeFileSync(join(tmp, `${s.fileName}`), s.text);
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const TTY = { isTTY: true };
const file = (s: Sealed) => join(tmp, s.fileName);

describe("ledger submit", () => {
  it("標準入力が端末でなければ断る（3）。引数が違えば 2", async () => {
    expect(await submitCli(["--bundle", file(a2), "--repo", repo], { packsDir, stdin: { isTTY: false } })).toBe(3);
    expect(await submitCli(["--bundle", file(a2), "--repo", repo], { packsDir, stdin: {} })).toBe(3);
    expect(await submitCli(["--bundle", file(a2)], { packsDir, stdin: TTY })).toBe(2);
    expect(await submitCli(["--bundle", file(a2), "--repo", repo, "--base", "--evil"], { packsDir, stdin: TTY })).toBe(2);
  });

  it("鎖が台帳とつながらない束（連番の飛び）は支度せず 1", async () => {
    expect(await submitCli(["--bundle", file(a3), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
    expect(git(repo, "branch", "--list", "moyai/*")).toBe("");
  });

  it("✓ の束：作業の木と索引を変えずに枝を作り、push と gh のコマンドを出す（走らせない）。支度した枝は validate-pr でも ✓", async () => {
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((s: string | Uint8Array) => {
      lines.push(String(s));
      return true;
    });
    let code: number;
    try {
      code = await submitCli(["--bundle", file(a2), "--repo", repo], { packsDir, stdin: TTY });
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(0);
    const out = lines.join("");
    const branch = `moyai/bundle-${A.key}-000002`;
    expect(out).toContain("誰にでも見えます");
    expect(out).toContain(`git -C "${repo}" push origin ${branch}`);
    expect(out).toContain(`gh pr create --repo <台帳のリポジトリ> --base main --head ${branch}`);
    // 作業の木と索引は変わらない
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(repo, "show", `${branch}:${a2.path}`)).toBe(a2.text);
    // PR の本文は一時のフォルダ。鍵と道はあり、施設の名前は無い
    const bodyFile = /--body-file "([^"]+)"/.exec(out)![1]!;
    const body = readFileSync(bodyFile, "utf8");
    rmSync(bodyFile, { force: true });
    expect(body).toContain(A.key);
    expect(body).toContain(a2.path);
    expect(body).not.toContain("【架空】試験の施設");
    // 支度した枝は、Actions と同じ validate-pr でも ✓
    const head = git(repo, "rev-parse", branch);
    const base = git(repo, "rev-parse", "main");
    expect(await validatePrCli(["--base", base, "--head", head, "--repo", repo], { packsDir })).toBe(0);
    // もう一度は、枝がもうあるので 1
    expect(await submitCli(["--bundle", file(a2), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
  });

  it("台帳にもうある束・読めない束は 1", async () => {
    writeFileSync(join(tmp, "a1.json"), a1.text);
    expect(await submitCli(["--bundle", join(tmp, "a1.json"), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
    writeFileSync(join(tmp, "bad.json"), "{");
    expect(await submitCli(["--bundle", join(tmp, "bad.json"), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
    expect(await submitCli(["--bundle", join(tmp, "無い.json"), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
  });

  it("取り下げの印（retired.json）も出せる：その鍵自身の署名なら枝を支度し、validate-pr でも ✓。他人の鍵の署名・載った束より小さい最後の連番は 1", async () => {
    const own = sealRetired(L, A, 1);
    writeFileSync(join(tmp, "retired-own.json"), own.text);
    const forged = sealRetired(L, A, 1, { by: makeSigner() });
    writeFileSync(join(tmp, "retired-forged.json"), forged.text);
    const below = sealRetired(L, A, 0);
    writeFileSync(join(tmp, "retired-below.json"), below.text);
    expect(await submitCli(["--bundle", join(tmp, "retired-forged.json"), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
    expect(await submitCli(["--bundle", join(tmp, "retired-below.json"), "--repo", repo], { packsDir, stdin: TTY })).toBe(1);
    expect(git(repo, "branch", "--list", "moyai/retired-*")).toBe("");
    const lines: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((x: string | Uint8Array) => {
      lines.push(String(x));
      return true;
    });
    let code: number;
    try {
      code = await submitCli(["--bundle", join(tmp, "retired-own.json"), "--repo", repo], { packsDir, stdin: TTY });
    } finally {
      spy.mockRestore();
    }
    expect(code).toBe(0);
    const branch = `moyai/retired-${A.key}`;
    const out = lines.join("");
    expect(out).toContain(`git -C "${repo}" push origin ${branch}`);
    expect(git(repo, "status", "--porcelain")).toBe("");
    expect(git(repo, "show", `${branch}:${own.path}`)).toBe(own.text);
    expect(own.path).toBe(`ledger/ledger/bundles/${A.key}/retired.json`);
    const bodyFile = /--body-file "([^"]+)"/.exec(out)![1]!;
    const body = readFileSync(bodyFile, "utf8");
    rmSync(bodyFile, { force: true });
    expect(body).toContain(A.key);
    expect(body).toContain(L.id);
    const head = git(repo, "rev-parse", branch);
    const base = git(repo, "rev-parse", "main");
    expect(await validatePrCli(["--base", base, "--head", head, "--repo", repo], { packsDir })).toBe(0);
  });
});
