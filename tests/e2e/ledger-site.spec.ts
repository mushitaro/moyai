// 公開の台帳を端から端まで、この PC の Chrome と Edge で通す（docs/plan.md §2.8 場 2・§5.1 ledger）：
// 架空の 10 施設の束を本物の写し取りと署名で作る（scripts/ledger/build-bundles.mjs）→ dist/cli.js verify ledger で ✓
// → ledger site で 1 枚の HTML → ブラウザで開き、外への要求が無いこと・CSP の違反が無いこと・【架空】と統計の行を確かめる
// → わざと外れた束を足すと verify ledger と validate-pr（本物の git。head を checkout しない）が理由つきで ✗。
// どれも一時のフォルダで行い、GitHub には何も送らない。
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const jst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const SHOTS = process.env.MOYAI_SHOTS_DIR ?? `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/moyai-shots/${jst}`;
function shot(name: string): string {
  mkdirSync(SHOTS, { recursive: true });
  const p = `${SHOTS}/${name}.png`;
  if (!existsSync(p)) return p;
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(new Date()).replace(/:/g, "");
  return `${SHOTS}/${name}-${t}.png`;
}

function run(args: string[], cwd = process.cwd()) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8" });
  return { code: r.status, err: r.stderr ?? "" };
}
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", ["-c", "user.name=moyai-test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args[0]}：${r.stderr}`);
  return r.stdout.trim();
}

let work = "";
test.beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-ledger-"));
  const b = run(["scripts/ledger/build-bundles.mjs", "--out", join(work, "repo"), "--rejects", join(work, "rejects"), "--state", join(work, "state")]);
  expect(b.code, b.err).toBe(0);
});
test.afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

test("架空の台帳：verify ledger で ✓ → site → ブラウザで外への要求なしに描ける", async ({ page }, info) => {
  const v = run(["dist/cli.js", "verify", "ledger", join(work, "repo")]);
  expect(v.code, v.err).toBe(0);
  expect(v.err).toContain("すべて ✓ です（束 10 件）");
  const site = join(work, `site-${info.project.name}`);
  const s = run(["dist/cli.js", "ledger", "site", join(work, "repo"), site]);
  expect(s.code, s.err).toBe(0);
  expect(readdirSync(site)).toEqual(["index.html"]);

  const url = pathToFileURL(join(site, "index.html")).href;
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  page.on("console", (m) => {
    if (m.type() === "error" || /Content Security Policy/i.test(m.text())) errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("【架空】MOYAI 公開の台帳");
  await expect(page.locator(".fiction")).toContainText("【架空】");
  await expect(page.getByText("✓ 10 件")).toBeVisible();
  await expect(page.getByText("似た施設 7", { exact: true })).toBeVisible();
  const statCells = await page.locator("tr.stat td.band").allTextContents();
  expect(statCells.some((t) => t.startsWith("中央 "))).toBe(true);
  expect(statCells.some((t) => t.startsWith("幅 "))).toBe(true);
  expect(statCells.some((t) => t === "x")).toBe(true);
  // スタイルは CSP のハッシュで許され、効いている（効かなければ表の線が無い）
  const border = await page.locator("table").first().locator("th").first().evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(border).toBe("solid");
  const font = await page.locator("body").evaluate((el) => getComputedStyle(el).fontFamily);
  expect(font).toContain("BIZ UDPGothic");
  const nums = await page.locator("td.fy").first().evaluate((el) => getComputedStyle(el).fontVariantNumeric);
  expect(nums).toContain("tabular-nums");
  expect(requests.filter((r) => r !== url)).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: shot(`ledger-site-${info.project.name}`), fullPage: true });
  await page.locator("section").first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot(`ledger-site-section-${info.project.name}`) });
});

test("わざと外れた束を足すと、verify ledger と validate-pr が理由つきで ✗", async ({}, info) => {
  const cases: [string, string][] = [
    ["kBelow5", "同区分の施設数が下限に届かない"],
    ["costField", "金額の形"],
    ["facilityName", "自由記述"],
  ];
  // 本物の git の台帳のリポジトリ（main に 10 施設）
  const repo = join(work, `git-${info.project.name}`);
  cpSync(join(work, "repo"), repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "【架空】10 施設");
  const base = git(repo, "rev-parse", "HEAD");
  const same = run(["dist/cli.js", "ledger", "validate-pr", "--base", base, "--head", base, "--repo", repo, "--json", join(repo, "..", `out-${info.project.name}`, "same.json")]);
  expect(same.code, same.err).toBe(0);

  for (const [c, text] of cases) {
    const dir = join(work, "rejects", c);
    // verify ledger：台帳の写しに足す
    const copy = join(work, `copy-${c}-${info.project.name}`);
    cpSync(join(work, "repo"), copy, { recursive: true });
    cpSync(join(dir, "ledger"), join(copy, "ledger"), { recursive: true });
    const v = run(["dist/cli.js", "verify", "ledger", copy]);
    expect([c, v.code]).toEqual([c, 1]);
    expect(v.err).toContain(text);
    expect(readFileSync(join(dir, "PR.md"), "utf8")).toContain("【架空】");

    // validate-pr：枝で足し、head を checkout せずに照らす
    git(repo, "checkout", "-q", "-b", c, base);
    cpSync(join(dir, "ledger"), join(repo, "ledger"), { recursive: true });
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", c);
    const head = git(repo, "rev-parse", "HEAD");
    git(repo, "checkout", "-q", "main");
    const out = join(work, `out-${c}-${info.project.name}`);
    const p = run(["dist/cli.js", "ledger", "validate-pr", "--base", base, "--head", head, "--repo", repo, "--json", join(out, "result.json"), "--markdown", join(out, "summary.md")]);
    expect([c, p.code]).toEqual([c, 1]);
    const md = readFileSync(join(out, "summary.md"), "utf8");
    expect(md).toContain("✗ 通りません");
    expect(md).toContain(text);
    const json = JSON.parse(readFileSync(join(out, "result.json"), "utf8"));
    expect(json).toMatchObject({ v: "moyai.ledger-validate/0", mode: "pr", ok: false, counts: { files: 1, ok: 0, ng: 1 } });
  }
});
