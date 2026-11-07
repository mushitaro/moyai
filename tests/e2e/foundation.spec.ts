// 最小の画面を、この PC の Chrome と Edge で開く：ビルドの印、つながり、2 つ目のタブ、確定の試し、Ed25519 の試験。
// 結果のスクリーンショットを一時のフォルダの moyai-shots/<走らせた日（日本時間）>/ に残す（日誌に残すときは MOYAI_SHOTS_DIR を渡す）。前の日の画像は上書きしない。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const jst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
// 確かめるだけの走りでは MOYAI_SHOTS_DIR で一時のフォルダに向ける
const SHOTS = process.env.MOYAI_SHOTS_DIR ?? `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/moyai-shots/${jst}`;

/** 撮る先。同じ名前がもうあれば、時刻を足した名前にして上書きしない。 */
function shot(name: string): string {
  mkdirSync(SHOTS, { recursive: true });
  const p = `${SHOTS}/${name}.png`;
  if (!existsSync(p)) return p;
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date())
    .replace(/:/g, "");
  return `${SHOTS}/${name}-${t}.png`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

let child: ChildProcess;
let base = "";
let stateDir = "";

test.beforeAll(async () => {
  stateDir = mkdtempSync(join(tmpdir(), "moyai-e2e-"));
  const port = await freePort();
  child = spawn(process.execPath, ["dist/cli.js", "start", "--port", String(port), "--no-open"], {
    env: { ...process.env, MOYAI_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout?.on("data", (d) => (out += `[stdout] ${d}`));
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`起動しない: ${out}`)), 15_000);
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      const m = /橋渡しを起こしました：(\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        base = m[1] as string;
        resolve();
      }
    });
    child.once("exit", (c) => reject(new Error(`止まった ${c}: ${out}`)));
  });
  // start は標準出力に何も書かない（標準出力は MCP だけに使う）
  expect(out).not.toContain("[stdout]");
});

test.afterAll(async () => {
  child?.kill();
  rmSync(stateDir, { recursive: true, force: true });
});

test("作業画面・2 つ目のタブ・確定の試し・Ed25519", async ({ page, context, browserName }, info) => {
  const tag = info.project.name;
  void browserName;

  // 書体は同梱のファイルを橋渡しから読む。外のサーバー（Google Fonts など）からは読まない
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font") fontRequests.push(r.url());
  });

  await test.step("画面が開き、ビルドの印が出て、橋渡しとつながる", async () => {
    await page.goto(base);
    await expect(page.getByTestId("build-stamp")).toHaveText(/^MOYAI · build \d{4}-\d{2}-\d{2} \d{2}:\d{2} JST · [0-9a-f]{7}\+?$/);
    await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
    await page.screenshot({ path: shot(`start-${tag}`) });
    expect(fontRequests.filter((u) => !u.startsWith(base))).toEqual([]);
  });

  await test.step("あとから開いたタブが引き継ぎ、前のタブには「ほかのタブに移りました」が出る", async () => {
    const second = await context.newPage();
    await second.goto(base);
    await expect(second.getByTestId("connection")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("refused")).toBeVisible();
    await expect(page.getByTestId("refused")).toHaveAttribute("data-code", "tab_taken_over");
    await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "refused");
    // 前のタブでは、確定の試しは押せない
    await page.goto(`${base}#/settings`);
    await expect(page.getByTestId("trial-open")).toBeDisabled();
    await expect(page.getByTestId("trial-disabled-reason")).toBeVisible();
    await page.screenshot({ path: shot(`second-tab-${tag}`) });
    await second.close();
    // 前のタブを読み込み直すと、またこのタブが作業画面になる
    await page.reload();
    await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
  });

  await test.step("確定の試し：印を受け取り、人だけの経路を通る（何も変えない）", async () => {
    await page.bringToFront();
    await page.goto(`${base}#/settings`);
    await page.getByTestId("trial-open").click();
    await expect(page.getByTestId("trial-token")).toBeVisible();
    await page.getByTestId("trial-confirm").click();
    await expect(page.getByTestId("trial-done")).toBeVisible();
    await page.screenshot({ path: shot(`commit-trial-${tag}`) });
  });

  await test.step("Ed25519：Node の署名をブラウザの WebCrypto で検証する", async () => {
    await page.goto(`${base}#/selftest`);
    const result = page.getByTestId("selftest-result");
    await expect(result).toBeVisible();
    await expect(page.getByTestId("valid")).toHaveText("通った");
    await expect(page.getByTestId("tampered")).toHaveText("通らなかった");
    await expect(result).toHaveAttribute("data-pass", "true");
    const ua = await page.getByTestId("browser").textContent();
    info.annotations.push({ type: "browser", description: String(ua) });
    console.log(`[${tag}] ${ua} → Ed25519 合格`);
    await page.screenshot({ path: shot(`ed25519-${tag}`) });
  });
});
