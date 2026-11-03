// 最小の画面を、この PC の Chrome と Edge で開く：ビルドの印、つながり、2 つ目のタブ、確定の試し、Ed25519 の試験。
// 結果のスクリーンショットを docs/progress/shots/2026-11-03/ に残す。
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const SHOTS = "docs/progress/shots/2026-11-03";

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

  // Windows では入っている BIZ UDPゴシック を使い、書体のファイルを読まない
  const fontRequests: string[] = [];
  page.on("request", (r) => {
    if (r.resourceType() === "font") fontRequests.push(r.url());
  });

  await test.step("画面が開き、ビルドの印が出て、橋渡しとつながる", async () => {
    await page.goto(base);
    await expect(page.getByTestId("build-stamp")).toHaveText(/^MOYAI · build \d{4}-\d{2}-\d{2} \d{2}:\d{2} JST · [0-9a-f]{7}\+?$/);
    await expect(page.getByTestId("connection")).toHaveAttribute("data-state", "open");
    await page.screenshot({ path: `${SHOTS}/start-${tag}.png` });
    if (process.platform === "win32") expect(fontRequests).toEqual([]);
  });

  await test.step("2 つ目のタブは断られ、理由が出る", async () => {
    const second = await context.newPage();
    await second.goto(base);
    await expect(second.getByTestId("refused")).toBeVisible();
    await expect(second.getByTestId("connection")).toHaveAttribute("data-state", "refused");
    await second.screenshot({ path: `${SHOTS}/second-tab-${tag}.png` });
    await second.close();
  });

  await test.step("確定の試し：印を受け取り、人だけの経路を通る（何も変えない）", async () => {
    await page.bringToFront();
    await page.getByTestId("trial-open").click();
    await expect(page.getByTestId("trial-token")).toBeVisible();
    await page.getByTestId("trial-confirm").click();
    await expect(page.getByTestId("trial-done")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/commit-trial-${tag}.png` });
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
    await page.screenshot({ path: `${SHOTS}/ed25519-${tag}.png` });
  });
});
