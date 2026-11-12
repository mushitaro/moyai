// シナリオ S-B2（docs/scenarios.md）：GitHub のアカウントが無い人の共有ファイル → 受け口 → PR → ledger-validate ✓ を、手元で 1 本通す。
// - 共有ファイル：架空の施設の世界から、本物の写し取りと封（scripts/ledger/demo-core.ts。アプリと同じ previewBundle・sealBundle）で作る。
// - 送る：アプリの送り（src/bridge/ledger-intake.ts の sendToIntake）が、受け口のハンドラ（services/ledger-intake）をそのまま呼ぶ。網は使わない（fetch を関数で差し替える）。
// - GitHub：メモリの代わり（tests/helpers/intake-github.ts）。リポジトリの名前は config/ledger.json の台帳（LEDGER_REPO）。
// - ledger-validate：台帳のリポジトリのワークフローが走らせるのと同じ `ledger validate-pr`（validatePrCli）を、一時の git のリポジトリの base と、PR のファイルを足した head に走らせる。
// - 断る：数の上限（同じ IP から 1 時間の件数）・転送（GitHub の 3xx をたどらない／アプリは受け口の転送をたどらない）・鍵の取り違え（ほかの鍵で署名した共有ファイル）。
// 本物の Cloudflare と GitHub では確かめていない（それは B3。手順は docs/ledger-deploy.md）。
// 呼び方：npm run scenario:b2（この 1 ファイルだけを走らせる。npm test にも入る）
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildLedgerDemo, type DemoResult } from "../../scripts/ledger/demo-core";
import { handleRequest, INTAKE_LIMITS, type IntakeDeps, type IntakeEnv } from "../../services/ledger-intake/src/handler";
import { packOf } from "../../services/ledger-intake/src/packs";
import { sendToIntake, type IntakeIo } from "../../src/bridge/ledger-intake";
import { validatePrCli, type ValidateOutput } from "../../src/cli/ledger";
import { envelopeText } from "../../src/share/bundle";
import { LEDGER_BUNDLE_PATH, LEDGER_DIR, LEDGER_REPO } from "../../src/share/ledger";
import { generateKeyPair, signBody } from "../../src/share/sign";
import { fakeLedgerGitHub, memoryKv, type FakeLedgerGitHub } from "../helpers/intake-github";

/** 試験だけのトークン（fine-grained の形。本物ではない） */
const TOKEN = `github_pat_${"ScenB2".repeat(4)}_${"y".repeat(40)}`;
/** 文書のための IP（RFC 5737） */
const IP = "203.0.113.42";
const IP_OTHER = "198.51.100.42";
const [OWNER, NAME] = LEDGER_REPO.split("/") as [string, string];

let work = "";
let repo = "";
let demo: DemoResult;
/** 台帳の main に載っている木（道 → 中身） */
let onMain: Record<string, Buffer> = {};
/** アカウントの無い人の共有ファイル（main にはまだ無い、架空の施設の 1 つ） */
let theirs: { path: string; text: string };
let baseSha = "";

function git(...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=moyai-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd: repo, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]}：${r.stderr}`);
  return r.stdout.trim();
}

function writeTree(files: Record<string, Buffer | string>): void {
  for (const [p, b] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, ...p.split("/"))), { recursive: true });
    writeFileSync(join(repo, ...p.split("/")), b);
  }
}

/** 受け口のハンドラと、その GitHub の代わり。送り手の IP は Cloudflare の入口が付ける見出しの代わりに試験が付ける */
function intake(o: { ip?: string; wrapGitHub?: (f: FakeLedgerGitHub["fetch"]) => IntakeDeps["fetch"] } = {}) {
  const gh = fakeLedgerGitHub({ token: TOKEN, owner: OWNER, name: NAME, files: onMain });
  let now = Date.UTC(2026, 10, 12, 3, 0, 0);
  const env: IntakeEnv = { GITHUB_TOKEN: TOKEN, LEDGER_REPO, INTAKE_KV: memoryKv() };
  const deps: IntakeDeps = { fetch: o.wrapGitHub ? o.wrapGitHub(gh.fetch) : gh.fetch, now: () => now, packOf };
  const io = (ip = o.ip ?? IP): IntakeIo => ({
    url: "https://intake.example",
    fetch: async (u, i) => {
      const r = await handleRequest(new Request(u, { method: i.method, headers: { ...i.headers, "cf-connecting-ip": ip }, body: i.body }), env, deps);
      return { status: r.status, json: () => r.json() };
    },
  });
  const writes = () => gh.calls.filter((c) => c.method !== "GET");
  return { gh, env, deps, io, writes, tick: (ms: number) => (now += ms) };
}

/** PR の head を、base に PR のファイルを足した commit にして、台帳のワークフローと同じ validate-pr を走らせる */
async function validate(branch: string, files: Record<string, Buffer>): Promise<{ code: number; out: ValidateOutput }> {
  git("checkout", "-q", "-B", branch, baseSha);
  writeTree(files);
  git("add", "-A");
  git("commit", "-q", "-m", `PR ${branch}`);
  const head = git("rev-parse", "HEAD");
  git("checkout", "-q", "--detach", baseSha);
  const json = join(work, `${branch.replace(/\W/g, "-")}.json`);
  const md = join(work, `${branch.replace(/\W/g, "-")}.md`);
  // validate-pr は結果の行を標準エラーに書く（試験の出力を汚さない）
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const code = await validatePrCli(["--base", baseSha, "--head", head, "--repo", repo, "--json", json, "--markdown", md]);
  vi.restoreAllMocks();
  return { code, out: JSON.parse(readFileSync(json, "utf8")) as ValidateOutput };
}

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "moyai-scenario-b2-"));
  const full = join(work, "台帳の全部");
  demo = buildLedgerDemo({ repo: process.cwd(), out: full, state: join(work, "demo-state"), month: "2026-11" });
  // 架空の 10 施設のうち 1 つを「アカウントの無い人」の共有ファイルにし、残りを台帳の main に載せる
  const last = demo.facilities.at(-1)!;
  const all = Object.fromEntries(demo.read.bundles.map((b) => [b.path, readFileSync(join(full, ...b.path.split("/")))]));
  theirs = { path: last.path, text: all[last.path]!.toString("utf8") };
  onMain = { [`${LEDGER_DIR}/ledger.json`]: readFileSync(join(full, LEDGER_DIR, "ledger.json")) };
  for (const [p, b] of Object.entries(all)) if (p !== last.path) onMain[p] = b;
  repo = join(work, "台帳のリポジトリ");
  mkdirSync(repo);
  git("init", "-q", "-b", "main");
  writeTree(onMain);
  git("add", "-A");
  git("commit", "-q", "-m", "台帳の main（架空の 9 施設）");
  baseSha = git("rev-parse", "HEAD");
});

afterAll(() => {
  vi.restoreAllMocks();
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("S-B2：アカウントの無い人の共有ファイル → 受け口 → PR → ledger-validate ✓", () => {
  it("下ごしらえ：台帳の main は ✓（validate-pr の base = head）、共有ファイルは台帳の道の形", async () => {
    expect(Object.keys(onMain).filter((p) => LEDGER_BUNDLE_PATH.test(p))).toHaveLength(demo.facilities.length - 1);
    expect(LEDGER_BUNDLE_PATH.test(theirs.path)).toBe(true);
    const json = join(work, "main.json");
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const code = await validatePrCli(["--base", baseSha, "--head", baseSha, "--repo", repo, "--json", json]);
    vi.restoreAllMocks();
    expect(code).toBe(0);
  });

  it("アプリの送りで受け口に出すと、台帳のリポジトリに PR が 1 つでき、その PR を ledger-validate（validate-pr）が ✓ にする", async () => {
    const s = intake();
    const sent = await sendToIntake(s.io(), theirs.text);
    expect(sent).toEqual({ ok: true, number: 1, url: `https://github.com/${LEDGER_REPO}/pull/1`, repo: { owner: OWNER, name: NAME } });
    expect(s.gh.prs).toHaveLength(1);
    const pr = s.gh.prs[0]!;
    expect(pr.state).toBe("open");
    expect(pr.body.split("\n")[0]).toBe("受け口から（GitHub のアカウントなし）");
    // PR の中身は、その共有ファイル 1 つだけ（道も中身も送ったまま）
    expect(Object.keys(pr.files)).toEqual([theirs.path]);
    expect(pr.files[theirs.path]!.toString("utf8")).toBe(theirs.text);
    // GitHub に書いたのは、台帳のリポジトリへの 枝・ファイル・PR の 3 つだけ。トークンは authorization の見出しにだけ
    expect(s.writes().map((c) => `${c.method} ${new URL(c.url).pathname.split("/").slice(4, 6).join("/")}`)).toEqual(["POST git/refs", `PUT contents/${LEDGER_DIR.split("/")[0]}`, "POST pulls"]);
    expect(s.gh.calls.every((c) => c.url.startsWith("https://api.github.com/") && /^\/repos\/([^/]+)\/([^/]+)(\/|$)/.exec(new URL(c.url).pathname)?.slice(1, 3).join("/") === LEDGER_REPO)).toBe(true);
    expect(s.gh.calls.every((c) => c.auth === `Bearer ${TOKEN}` && !(c.body ?? "").includes(TOKEN))).toBe(true);

    const v = await validate("intake-pr-1", pr.files);
    expect(v.code).toBe(0);
    expect(v.out.ok).toBe(true);
    expect(v.out.mode).toBe("pr");
    expect(v.out.files.map((f) => [f.path, f.status])).toEqual([[theirs.path, "ok"]]);
  });

  it("同じ共有ファイルをもう一度送っても、PR は増えない（前の PR を返す）", async () => {
    const s = intake();
    const first = await sendToIntake(s.io(), theirs.text);
    const again = await sendToIntake(s.io(), theirs.text);
    expect(again).toEqual(first);
    expect(s.gh.prs).toHaveLength(1);
  });
});

describe("S-B2：断る", () => {
  it(`数の上限：同じ IP から 1 時間に ${INTAKE_LIMITS.perHour} 件を越えると 429（アプリは rateLimited）。GitHub には書かない。ほかの IP は通る`, async () => {
    const s = intake();
    for (let i = 0; i < INTAKE_LIMITS.perHour; i++) expect((await sendToIntake(s.io(), "x")).ok).toBe(false);
    const writesBefore = s.writes().length;
    const over = await sendToIntake(s.io(), theirs.text);
    expect(over).toMatchObject({ ok: false, reason: "rateLimited" });
    expect(s.writes().length).toBe(writesBefore);
    expect(s.gh.prs).toHaveLength(0);
    // ほかの IP（ほかの網）からは受ける
    expect(await sendToIntake(s.io(IP_OTHER), theirs.text)).toMatchObject({ ok: true, number: 1 });
    // 1 時間たてば、もとの IP も数え直す（同じ中身なので前の PR を返す）
    s.tick(60 * 60 * 1000 + 1);
    expect(await sendToIntake(s.io(), theirs.text)).toMatchObject({ ok: true, number: 1 });
  });

  it("転送：GitHub が 3xx を返しても、受け口はたどらない（redirect: manual）。PR は出さず、転送先にトークンは届かない", async () => {
    const outside: string[] = [];
    const redirects: (string | undefined)[] = [];
    const s = intake({
      wrapGitHub: (f) => async (u, i) => {
        redirects.push(i.redirect);
        if (!u.startsWith("https://api.github.com/")) outside.push(u);
        // 最初の読み（台帳のリポジトリの情報）を、外の host へ転送する答えにする
        if (i.method === "GET" && new URL(u).pathname === `/repos/${OWNER}/${NAME}`) return new Response(null, { status: 302, headers: { location: "https://evil.example/steal" } });
        return f(u, i);
      },
    });
    const r = await sendToIntake(s.io(), theirs.text);
    expect(r.ok).toBe(false);
    expect(s.gh.prs).toHaveLength(0);
    expect(s.writes()).toHaveLength(0);
    expect(outside).toEqual([]);
    expect(redirects.length).toBeGreaterThan(0);
    expect(redirects.every((x) => x === "manual")).toBe(true);
    // アプリの送りも、受け口からの転送をたどらない（redirect: error）
    const app: (string | undefined)[] = [];
    await sendToIntake({ url: "https://intake.example", fetch: async (_u, i) => (app.push(i.redirect), { status: 503, json: async () => ({}) }) }, theirs.text);
    expect(app).toEqual(["error"]);
  });

  it("鍵の取り違え：その鍵のフォルダの共有ファイルを、ほかの鍵で署名したもの → 受け口は 400 chain.badSignature で GitHub に書かない。PR にしても ledger-validate は ✗", async () => {
    const env = JSON.parse(theirs.text) as { body: Record<string, unknown> };
    const other = generateKeyPair();
    const mixed = envelopeText(env.body, signBody(env.body, other.privateKey));
    const s = intake();
    const r = await sendToIntake(s.io(), mixed);
    expect(r).toMatchObject({ ok: false, reason: "refused" });
    expect(r.ok === false && r.reasons).toContain("chain.badSignature");
    expect(s.writes()).toHaveLength(0);
    expect(s.gh.prs).toHaveLength(0);
    // 受け口を通らずに（GitHub のアカウントで）同じファイルを PR にしても、台帳のワークフローの検証が ✗ にする
    const v = await validate("mixed-key", { [theirs.path]: Buffer.from(mixed, "utf8") });
    expect(v.code).toBe(1);
    expect(v.out.ok).toBe(false);
    expect(v.out.files.find((f) => f.path === theirs.path)?.status).not.toBe("ok");
  });
});
