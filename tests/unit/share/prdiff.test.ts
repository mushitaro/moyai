// 台帳の PR の照らし（docs/plan.md §2.8 台帳の守り方・§5.1 ledger）。純粋な関数を、作った diff の出力で試し、
// CLI（validate-pr）を一時のフォルダの本物の git のリポジトリで試す（head を checkout しない）。
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LEDGER_JSON_PATH, LEDGER_LIMITS, type LedgerFile } from "../../../src/share/ledger";
import { PR_LIMITS, displayablePath, entryIssues, foldPath, parseRawDiff, validateAll, validatePr } from "../../../src/share/prdiff";
import { sha256Hex } from "../../../src/share/sign";
import { validateMarkdown, validateOutputOf, validatePrCli, type ValidateOutput } from "../../../src/cli/ledger";
import { SPEC, TABLE_TEXT, VOCAB_TEXT, smallPlan, table, vocab } from "./fixtures";
import { forge, makeLedger, makeSigner, sealLedger, type Sealed } from "./ledger-fixtures";

const pack = { table, vocab };
const L = makeLedger();
const A = makeSigner();
const B = makeSigner();
let a1: Sealed;
let a2: Sealed;
let b1: Sealed;
let tmp = "";

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-prdiff-"));
  a1 = sealLedger(L, A, smallPlan());
  a2 = sealLedger(L, A, smallPlan(), { seq: 2, prev: a1.hash });
  b1 = sealLedger(L, B, smallPlan());
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

const ZERO = "0".repeat(40);
const blobSha = (s: string | Uint8Array) => sha256Hex(s).slice(0, 40);
/** `git diff --raw -z` の 1 件 */
function rec(status: string, path: string | Buffer, o: { src?: string; dst?: string; srcMode?: string; dstMode?: string; path2?: string } = {}): Buffer {
  const head = `:${o.srcMode ?? (status === "A" ? "000000" : "100644")} ${o.dstMode ?? (status === "D" ? "000000" : "100644")} ${o.src ?? ZERO} ${o.dst ?? ZERO} ${status}${status === "R" || status === "C" ? "100" : ""}`;
  const parts = [Buffer.from(head, "latin1"), Buffer.from([0]), typeof path === "string" ? Buffer.from(path, "utf8") : path, Buffer.from([0])];
  if (o.path2 !== undefined) parts.push(Buffer.from(o.path2, "utf8"), Buffer.from([0]));
  return Buffer.concat(parts);
}
const baseFiles = (bundles: readonly Sealed[] = []): LedgerFile[] => [
  { path: LEDGER_JSON_PATH, kind: "file", bytes: Buffer.from(L.text) },
  { path: "ledger/TERMS.md", kind: "file", bytes: Buffer.from("【架空】") },
  ...bundles.map((b) => ({ path: b.path, kind: "file" as const, bytes: Buffer.from(b.text) })),
];
function run(entries: Buffer[], blobs: Record<string, string | Uint8Array>, base: Sealed[] = [], basePaths?: string[]) {
  const files = baseFiles(base);
  return validatePr({
    raw: Buffer.concat(entries),
    base: files,
    basePaths: basePaths ?? files.map((f) => f.path),
    readBlob: (sha) => (blobs[sha] === undefined ? null : typeof blobs[sha] === "string" ? Buffer.from(blobs[sha] as string) : (blobs[sha] as Uint8Array)),
    pack,
  });
}
const add = (s: Sealed) => rec("A", s.path, { dst: blobSha(s.text) });
const blobsOf = (...ss: Sealed[]) => Object.fromEntries(ss.map((s) => [blobSha(s.text), s.text]));
const reasonsOf = (r: ReturnType<typeof run>, path: string) => r.files.find((f) => f.path === path)!.reasons;

describe("PR の照らし（純粋な関数）", () => {
  it("正しい束を足すだけの PR は ✓。base の束の続きの連番も ✓", () => {
    const r = run([add(a1), add(b1)], blobsOf(a1, b1));
    expect(r.ok).toBe(true);
    expect(r.files.map((f) => [f.path, f.status])).toEqual([
      [a1.path, "ok"],
      [b1.path, "ok"],
    ]);
    const next = run([add(a2)], blobsOf(a2), [a1]);
    expect(next.ok).toBe(true);
  });

  it("鎖が base とつながらない束（連番の飛び・同じ連番の別の束）は ✗", () => {
    expect(reasonsOf(run([add(a2)], blobsOf(a2)), a2.path)).toContain("chain.gap");
    const p = smallPlan();
    p.details.push({ ...p.details[0]!, detailKey: "d9", fiscalYear: 2021 });
    const other1 = sealLedger(L, A, p);
    expect(reasonsOf(run([add(other1)], blobsOf(other1), [a1]), other1.path)).toContain("chain.duplicateSeq");
  });

  it("削除・書き換え・改名・写し・型の変更は ✗", () => {
    const r = run(
      [
        rec("D", a1.path, { src: blobSha(a1.text) }),
        rec("M", "ledger/TERMS.md", { src: ZERO, dst: blobSha("x") }),
        rec("R", a1.path, { src: blobSha(a1.text), dst: blobSha(a1.text), path2: `ledger/bundles/${A.key}/000001-ffffffffffffffff.json` }),
        rec("C", a1.path, { src: blobSha(a1.text), dst: blobSha(a1.text), path2: `ledger/bundles/${B.key}/000001-ffffffffffffffff.json` }),
        rec("T", b1.path, { srcMode: "100644", dstMode: "120000" }),
      ],
      {},
      [a1, b1],
    );
    expect(r.ok).toBe(false);
    expect(r.files.map((f) => f.reasons.find((x) => x.startsWith("diff.")))).toEqual(["diff.deleted", "diff.modified", "diff.renamed", "diff.copied", "diff.typeChanged"]);
    // 改名と写しは、行き先の道で照らす（2 つ目の道）
    expect(r.files[2]!.path).toBe(`ledger/bundles/${A.key}/000001-ffffffffffffffff.json`);
    expect(reasonsOf(r, "ledger/TERMS.md")).toContain("path.notAllowed");
  });

  it("symlink（120000）・submodule（160000）・実行の印（100755）は ✗", () => {
    const r = run(
      [
        rec("A", a1.path, { dstMode: "120000", dst: blobSha(a1.text) }),
        rec("A", b1.path, { dstMode: "160000", dst: blobSha(b1.text) }),
        rec("A", `ledger/bundles/${A.key}/000002-0000000000000000.json`, { dstMode: "100755", dst: blobSha(a2.text) }),
      ],
      blobsOf(a1, b1, a2),
    );
    expect(r.files.map((f) => f.reasons)).toEqual([["diff.symlink"], ["diff.submodule"], ["diff.executable"]]);
  });

  it(".github/ に触れるもの（大文字小文字・全角も）は ✗", () => {
    for (const p of [".github/workflows/x.yml", ".GitHub/workflows/x.yml", "．ｇｉｔｈｕｂ/x.yml", ".github"]) {
      const e = parseRawDiff(rec("A", p, { dst: blobSha("x") }));
      expect(e.ok && entryIssues(e.entries[0]!)).toContain("path.github");
    }
    const r = run([add(a1), rec("A", ".github/workflows/evil.yml", { dst: blobSha("x") })], { ...blobsOf(a1), [blobSha("x")]: "x" });
    expect(r.ok).toBe(false);
    expect(r.files[0]!.status).toBe("ok");
    expect(r.files[1]!.reasons).toEqual(expect.arrayContaining(["path.github", "path.notAllowed"]));
  });

  it("大文字小文字だけ・NFC と NFD だけが違う道は ✗", () => {
    const upper = a1.path.replace(A.key, A.key.toUpperCase());
    const cap = a1.path.replace("ledger/", "Ledger/");
    const r = run([rec("A", upper, { dst: blobSha(a1.text) }), rec("A", cap, { dst: blobSha(a1.text) })], blobsOf(a1));
    expect(r.files.map((f) => f.reasons)).toEqual([
      expect.arrayContaining(["path.caseOrNormalization"]),
      expect.arrayContaining(["path.caseOrNormalization"]),
    ]);
    // base にある道と、大文字小文字だけが違う
    const r2 = run([rec("A", upper, { dst: blobSha(a1.text) })], blobsOf(a1), [], [...baseFiles().map((f) => f.path), a1.path]);
    expect(r2.files[0]!.reasons).toContain("path.collides");
    // NFC と NFD だけが違う 2 つの道（どちらも ASCII の外）
    const nfc = `ledger/bundles/${A.key}/caf\u00e9.json`;
    const nfd = `ledger/bundles/${A.key}/cafe\u0301.json`;
    expect(foldPath(nfc)).toBe(foldPath(nfd));
    const r3 = run([rec("A", nfd, { dst: blobSha("x") })], { [blobSha("x")]: "x" }, [], [...baseFiles().map((f) => f.path), nfc]);
    expect(r3.files[0]!.reasons).toEqual(expect.arrayContaining(["path.notAscii", "path.collides"]));
    const r4 = run([rec("A", nfc, { dst: blobSha("x") }), rec("A", nfd, { dst: blobSha("x") })], { [blobSha("x")]: "x" });
    expect(r4.files.every((f) => f.reasons.includes("path.collides"))).toBe(true);
  });

  it("道の形：深すぎる・長すぎる・ASCII の外・UTF-8 でない", () => {
    const deep = `ledger/bundles/${A.key}/x/000001-0000000000000000.json`;
    const long = `ledger/bundles/${A.key}/${"a".repeat(220)}.json`;
    const bad = Buffer.from([0x6c, 0x65, 0x64, 0x67, 0x65, 0x72, 0x2f, 0xff, 0xfe]);
    const r = run([rec("A", deep), rec("A", long), rec("A", bad)], {});
    expect(r.files[0]!.reasons).toEqual(expect.arrayContaining(["path.tooDeep", "path.notAllowed"]));
    expect(r.files[1]!.reasons).toContain("path.tooLong");
    expect(r.files[2]).toMatchObject({ path: null, reasons: ["path.notUtf8"] });
    expect(displayablePath(r.files[2]!.path)).toBe(false);
  });

  it("__proto__ のキー・知らないキーの JSON は ✗", () => {
    const proto = { ...a1, text: a1.text.replace('{"body":{', '{"body":{"__proto__":{},') };
    const r = run([rec("A", a1.path, { dst: blobSha(proto.text) })], { [blobSha(proto.text)]: proto.text });
    expect(r.files[0]!.reasons).toEqual(expect.arrayContaining(["shape.protoKey"]));
    const unknown = forge(a1, A, (body) => {
      body.extra = "FY2016";
    });
    const r2 = run([add(unknown)], blobsOf(unknown));
    expect(r2.files[0]!.reasons).toContain("shape.type");
  });

  it("大きすぎるファイル・多すぎる変更・読めない diff", () => {
    const big = new Uint8Array(LEDGER_LIMITS.fileBytes + 1).fill(0x20);
    const r = run([rec("A", a1.path, { dst: blobSha(big) })], { [blobSha(big)]: big });
    expect(r.files[0]!.reasons).toEqual(["file.tooLarge"]);
    const many = Array.from({ length: PR_LIMITS.entries + 1 }, (_, i) => rec("A", `ledger/bundles/${A.key}/${String(i + 1).padStart(6, "0")}-0000000000000000.json`));
    expect(run(many, {})).toMatchObject({ ok: false, files: [], inputReason: "diff.tooMany" });
    expect(parseRawDiff(Buffer.from(":100644 100644 x y M\0a"))).toEqual({ ok: false, reason: "diff.malformed" });
    expect(parseRawDiff(Buffer.from("garbage\0"))).toEqual({ ok: false, reason: "diff.malformed" });
    expect(parseRawDiff(new Uint8Array(PR_LIMITS.rawBytes + 1))).toEqual({ ok: false, reason: "diff.tooLarge" });
    expect(run([], {})).toMatchObject({ ok: false, inputReason: "diff.empty" });
  });

  it("中身の外れ：署名の鍵が他人のフォルダ・k < 5・施設名・費用・UPGRADE・OUTSIDE", () => {
    const moved = { ...b1, path: `ledger/bundles/${A.key}/${b1.fileName}`, key: A.key };
    const lowK = forge(a1, A, (body) => {
      (body.profile as Record<string, unknown>).axes = { furnace: "OTHER", capacity_t_per_day: "C400P", turbine: "YES", ash: "MELT", contract: "OM" };
    });
    const name = forge(a1, A, (body) => {
      body.facility = "【架空】みどり台クリーンセンター";
    });
    const cost = forge(a1, A, (body) => {
      (body.chunks as Record<string, unknown>[])[0]!.cost = "1,200,000円";
    });
    const upg = forge(a1, A, (body) => {
      (body.chunks as Record<string, unknown>[]).push({ class: "T.RESIDUE", work: "UPGRADE", years: ["FY2020"], observed: "N1" });
    });
    const out = forge(a1, A, (body) => {
      (body.profile as Record<string, unknown>).group = "OUTSIDE";
    });
    const want: [Sealed, string][] = [
      [moved, "file.otherFolder"],
      [lowK, "k.belowMin"],
      [name, "freeText"],
      [cost, "money"],
      [upg, "ledger.upgrade"],
      [out, "ledger.groupNotNational"],
    ];
    for (const [s, reason] of want) {
      const r = run([rec("A", s.path, { dst: blobSha(s.text) })], { [blobSha(s.text)]: s.text });
      expect([s.path, r.files[0]!.reasons]).toEqual([s.path, expect.arrayContaining([reason])]);
      expect(r.ok).toBe(false);
    }
  });

  it("変更なし（base と head が同じ）：既定のブランチの全部の束を確かめる", () => {
    const r = validateAll(baseFiles([a1, a2, b1]), pack);
    expect(r).toMatchObject({ mode: "all", ok: true });
    expect(r.files).toHaveLength(3);
  });
});

describe("PR のコメントと JSON", () => {
  it("表示できない道は名前を出さず、ファイル名はコードの枠に入れる", () => {
    const evil = "ledger/bundles/`@someone`<img src=x>|.json";
    const r = run([add(a1), rec("A", evil, { dst: blobSha("x") })], { ...blobsOf(a1), [blobSha("x")]: "x" });
    const o = validateOutputOf(r, "a".repeat(40), "b".repeat(40), null);
    const md = validateMarkdown(o);
    expect(md).toContain(`\`${a1.path}\``);
    expect(md).not.toContain("@someone");
    expect(md).not.toContain("<img");
    expect(md).toContain("名前を表示しない道");
    expect(md).toContain("✗ 通りません");
    expect(o.files[1]!.display).toBe(false);
    // JSON には道をそのまま（JSON の逃がし方で）入れ、理由はコードと日本語の両方
    const j = JSON.parse(JSON.stringify(o)) as ValidateOutput;
    expect(j.files[1]!.path).toBe(evil);
    expect(j.files[1]!.reasonsText.length).toBeGreaterThan(0);
    expect(j.counts).toEqual({ files: 2, ok: 1, ng: 1 });
  });
});

// ─── CLI：本物の git のリポジトリ ─────────────────────────────────

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=moyai-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]}：${r.stderr}`);
  return r.stdout.trim();
}
function put(repo: string, rel: string, text: string): void {
  mkdirSync(join(repo, ...rel.split("/").slice(0, -1)), { recursive: true });
  writeFileSync(join(repo, ...rel.split("/")), text);
}

describe("CLI：ledger validate-pr（本物の git。head を checkout しない）", () => {
  let repo = "";
  let packsDir = "";
  let base = "";
  beforeAll(() => {
    packsDir = join(tmp, "packs");
    const pdir = join(packsDir, "waste-incineration");
    mkdirSync(join(pdir, "national"), { recursive: true });
    writeFileSync(join(pdir, "national", "table.json"), TABLE_TEXT);
    writeFileSync(join(pdir, "vocab.json"), VOCAB_TEXT);
    writeFileSync(join(pdir, "pack.json"), JSON.stringify({ id: "waste-incineration", name: "架空", profile: SPEC }));
    repo = join(tmp, "台帳 repo");
    mkdirSync(repo);
    git(repo, "init", "-q", "-b", "main");
    put(repo, "ledger/ledger.json", L.text);
    put(repo, "ledger/TERMS.md", "【架空】試験の利用条件\n");
    put(repo, a1.path, a1.text);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "base");
    base = git(repo, "rev-parse", "HEAD");
  });

  /** base から枝を作り、変えて commit し、head の SHA を返す（作業の木は main に戻す） */
  function branch(name: string, change: () => void, indexOnly = false): string {
    git(repo, "checkout", "-q", "-b", name, base);
    change();
    // symlink と submodule は作業の木に置かず、索引にだけ書く（add -A をすると消える）
    if (!indexOnly) git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", name);
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", "main");
    return head;
  }
  async function validate(head: string, b = base) {
    const out = join(tmp, "out", head.slice(0, 8));
    const code = await validatePrCli(["--base", b, "--head", head, "--repo", repo, "--json", join(out, "result.json"), "--markdown", join(out, "summary.md")], { packsDir });
    return { code, json: JSON.parse(readFileSync(join(out, "result.json"), "utf8")) as ValidateOutput, md: readFileSync(join(out, "summary.md"), "utf8") };
  }

  it("正しい束を足す PR は 0、結果の JSON と markdown を書く", async () => {
    const head = branch("good", () => {
      put(repo, a2.path, a2.text);
      put(repo, b1.path, b1.text);
    });
    const v = await validate(head);
    expect(v.code).toBe(0);
    expect(v.json).toMatchObject({ v: "moyai.ledger-validate/0", mode: "pr", ok: true, counts: { files: 2, ok: 2, ng: 0 }, ledger: { id: L.id, status: "ok" } });
    expect(v.md).toContain("✓ 通りました");
    expect(v.md).toContain(`\`${a2.path}\``);
  });

  it("外れた PR は 1：書き換え・削除・symlink・submodule・.github・k < 5", async () => {
    const lowK = forge(a2, A, (body) => {
      (body.profile as Record<string, unknown>).axes = { furnace: "OTHER", capacity_t_per_day: "C400P", turbine: "YES", ash: "MELT", contract: "OM" };
    });
    const cases: [string, () => void, string, boolean?][] = [
      ["modify", () => put(repo, a1.path, a1.text.replace("FY2016", "FY2015")), "diff.modified"],
      ["delete", () => rmSync(join(repo, ...a1.path.split("/"))), "diff.deleted"],
      ["github", () => put(repo, ".github/workflows/evil.yml", "on: push\n"), "path.github"],
      ["lowk", () => put(repo, lowK.path, lowK.text), "k.belowMin"],
      [
        "symlink",
        () => {
          const sha = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo, input: a1.path, encoding: "utf8" }).stdout.trim();
          git(repo, "update-index", "--add", "--cacheinfo", `120000,${sha},${a2.path}`);
        },
        "diff.symlink",
        true,
      ],
      ["submodule", () => git(repo, "update-index", "--add", "--cacheinfo", `160000,${base},${b1.path}`), "diff.submodule", true],
    ];
    for (const [name, change, reason, indexOnly] of cases) {
      const head = branch(name, change, indexOnly);
      const v = await validate(head);
      expect([name, v.code]).toEqual([name, 1]);
      expect(v.json.ok).toBe(false);
      expect(v.json.files.flatMap((f) => f.reasons)).toContain(reason);
      expect(v.md).toContain("✗ 通りません");
    }
  });

  it("base と head が同じなら「変更なし」で、全部の束を確かめる", async () => {
    const v = await validate(base, base);
    expect(v.code).toBe(0);
    expect(v.json.mode).toBe("all");
    expect(v.md).toContain("変更なし");
  });

  it("入力や道具の誤りは 2：SHA の形でない引数・無い commit・決まりの無い base", async () => {
    expect(await validatePrCli(["--base", "main", "--head", base, "--repo", repo], { packsDir })).toBe(2);
    expect(await validatePrCli(["--base", base], { packsDir })).toBe(2);
    expect(await validatePrCli(["--base", base, "--head", "f".repeat(40), "--repo", repo], { packsDir })).toBe(2);
    const empty = join(tmp, "空の repo");
    mkdirSync(empty);
    git(empty, "init", "-q", "-b", "main");
    put(empty, "README.md", "【架空】");
    git(empty, "add", "-A");
    git(empty, "commit", "-q", "-m", "x");
    const c = git(empty, "rev-parse", "HEAD");
    const out = join(tmp, "out-empty");
    expect(await validatePrCli(["--base", c, "--head", c, "--repo", empty, "--json", join(out, "r.json"), "--markdown", join(out, "s.md")], { packsDir })).toBe(2);
    expect(readFileSync(join(out, "s.md"), "utf8")).toContain("確かめられませんでした");
    expect(JSON.parse(readFileSync(join(out, "r.json"), "utf8"))).toMatchObject({ ok: false, errorKind: "tool" });
  });
});
