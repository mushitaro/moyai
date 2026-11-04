// 縦の 1 本の人だけの半分を、この PC の Chrome と Edge で通す：
// 設定（Documents と OneDrive の知らせ・置き場所を一時のフォルダに・輪と鍵を作る）→ 星取表の試しの計画（架空）を確定（人が受けていない決定を理由つきで受ける）
// → 検問所（見え方を選ぶ・相手から見たあなた・数がすべて 0・合言葉の右の［送る］）→ 署名して輪に置く → 受け手と同じ関数で ✓ → CLI の verify ring でも ✓。
// 人だけの CLI（keys create）は、標準入力が端末でなければ断る。置き場所と輪は一時のフォルダに作り、この PC の Documents には書かない。
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions } from "../helpers/e2e";

const jst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const SHOTS = process.env.MOYAI_SHOTS_DIR ?? `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/moyai-shots/${jst}`;

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
let work = "";
let stateDir = "";
const rings: string[] = [];
const PASS = "架空の合言葉 e2e です";

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-checkpoint-"));
  stateDir = join(work, "state");
  const port = await freePort();
  child = spawn(process.execPath, ["dist/cli.js", "start", "--port", String(port), "--no-open"], {
    env: { ...process.env, MOYAI_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`起動しない: ${out}`)), 15_000);
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      const m = /橋渡しを起こしました：(\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        base = (m[1] as string).replace(/\/$/, "");
        resolve();
      }
    });
    child.once("exit", (c) => reject(new Error(`止まった ${c}: ${out}`)));
  });
});

test.afterAll(async () => {
  child?.kill();
  rmSync(work, { recursive: true, force: true });
  for (const r of rings) rmSync(r, { recursive: true, force: true });
});

async function openPlan(page: Page, name: "fictional-1") {
  const body = JSON.stringify(DEV_PLANS[name]());
  await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  await page.goto(`${base}/?plan=${name}#/chart`);
  await expect(page.getByTestId("chart-page")).toBeVisible();
  await expect(page.locator(".ag-row").first()).toBeVisible();
}

test("確定 → 検問所 → 署名して輪に置く → 受け手と同じ関数で ✓", async ({ page }, info) => {
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  // 輪のフォルダの道も固有名詞の照らす相手なので、乱数の文字（計画の語と偶然重なる）を入れない名前にする
  const ringRoot = join(tmpdir(), `moyai-e2e-ring-${tag}-${Date.now()}`, "輪のフォルダ");
  rings.push(join(ringRoot, ".."));

  await test.step("設定：Documents の場所と同期の知らせ。置き場所を選んで保存", async () => {
    await page.goto(`${base}/#/settings`);
    await expect(page.getByTestId("settings-page")).toBeVisible();
    await expect(page.getByTestId("documents-path")).toBeVisible();
    // この PC の Documents は OneDrive の下にある（docs/plan.md §2.9）。そうでない PC では知らせが出ない
    const docs = (await page.getByTestId("documents-path").textContent()) ?? "";
    if (/onedrive/i.test(docs)) await expect(page.getByTestId("root-synced").first()).toBeVisible();
    await expect(page.getByTestId("settings-save")).toBeDisabled();
    await page.screenshot({ path: shot(`settings-${tag}`), fullPage: true });
    await page.getByTestId("root-input").fill(root);
    // 版の署名に出す呼び名（架空）
    await page.getByTestId("name-input").fill("【架空】試験の台本");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-saved")).toBeVisible();
    await expect(page.getByTestId("current-root")).toHaveText(root);
    await expect(page.getByTestId("current-name")).toHaveText("【架空】試験の台本");
  });

  await test.step("輪を作り、この輪の鍵を合言葉で包む。指紋は 4 文字 × 4 組", async () => {
    await page.getByTestId("ring-create-open").click();
    await page.getByTestId("ring-folder").fill(ringRoot);
    await page.getByTestId("ring-pack").selectOption("waste-incineration");
    await page.getByTestId("ring-pass").fill(PASS);
    await page.getByTestId("ring-pass2").fill(PASS);
    await page.getByTestId("ring-create-submit").click();
    await expect(page.getByTestId("ring-created")).toBeVisible();
    await expect(page.getByTestId("ring-created").getByTestId("fingerprint")).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    await page.screenshot({ path: shot(`ring-created-${tag}`) });
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("rings-table")).toBeVisible();
  });

  await test.step("確定：差分の要約、人が受けていない決定を理由つきで受け、一言の理由で確定する", async () => {
    await openPlan(page, "fictional-1");
    // 受けていない決定があるうちは、署名のダイアログを開けない。決定のシートで 1 行ずつ理由を書いて受ける
    await expect(page.getByTestId("confirm-open")).toBeDisabled();
    await expect(page.getByTestId("confirm-disabled-reason")).toContainText("受けていない決定が");
    const n = await acceptDecisions(page, "台帳の名前と表Ⅱ-4 を見て、人が受けた");
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId("confirm-open")).toBeEnabled();
    await page.getByTestId("confirm-open").click();
    await expect(page.getByTestId("diff-summary")).toBeVisible();
    // 署名のダイアログに保管先の生のパスは出さない
    await expect(page.getByTestId("confirm-root")).toHaveCount(0);
    await expect(page.getByTestId("pending")).toContainText(`決定のシートで受けた決定 ${n} 件`);
    // 理由が空なら確定できない
    await expect(page.getByTestId("confirm-submit")).toBeDisabled();
    await expect(page.getByTestId("confirm-submit-reason")).toContainText("理由を書くと確定できます");
    await page.getByTestId("confirm-reason").fill("試しの計画を確定する（e2e）");
    // 署名：合言葉が無いうちは確定できない。この PC にまだ鍵が無いので、合言葉を 2 回入れて鍵を作ってから署名する
    await expect(page.getByTestId("confirm-submit")).toBeDisabled();
    await page.getByTestId("sign-passphrase").fill(PASS);
    await page.getByTestId("sign-passphrase-again").fill(`${PASS}x`);
    await expect(page.getByTestId("confirm-submit-reason")).toContainText("2 つの合言葉が違います");
    await page.getByTestId("sign-passphrase-again").fill(PASS);
    await expect(page.getByTestId("confirm-submit")).toBeEnabled();
    await page.screenshot({ path: shot(`confirm-${tag}`) });
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    const versions = join(root, "plans", "fixture-fictional-1", "versions");
    expect(readdirSync(versions)).toEqual(["000001.json"]);
    expect(readdirSync(join(root, "plans", "fixture-fictional-1", "reports"))).toEqual(["000001-diff.xlsx"]);
    await page.getByTestId("to-checkpoint").click();
  });

  await test.step("検問所：見え方を選ぶと、相手から見たあなた・3 つの欄・数がすべて 0", async () => {
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    await expect(page.getByTestId("q-furnace")).toBeVisible();
    // 送る前は押せない（見え方が決まっていない・合言葉が無い）
    await expect(page.getByTestId("send")).toBeDisabled();
    await page.getByTestId("q-national").selectOption("yes");
    await page.getByTestId("q-furnace").selectOption("STOKER");
    await page.getByTestId("q-capacity_t_per_day").selectOption("C100_200");
    await page.getByTestId("q-turbine").selectOption("YES");
    await page.getByTestId("q-ash").selectOption("OUT");
    await page.getByTestId("q-contract").selectOption("SINGLE");
    await expect(page.getByTestId("you-steps")).toContainText("全国の 844 施設のどれか");
    const k = Number(await page.getByTestId("you-k").getAttribute("data-k"));
    expect(k).toBeGreaterThanOrEqual(5);
    await expect(page.getByTestId("counts")).toHaveText("形 0｜固有名詞 0｜金額 0｜自由記述 0｜正確な日付 0");
    await expect(page.getByTestId("body-hash")).toHaveText(/^[0-9a-f]{64}$/);
    const bodyText = (await page.getByTestId("body-text").textContent()) ?? "";
    expect(bodyText).toContain('"v":"moyai.bundle/0"');
    expect(bodyText).not.toMatch(/[^\x20-\x7e]/);
    // 経過年はどこにも出さない（2026-11-03）。帯と束の型の版は bands-2
    expect(bodyText).toContain('"bands":"bands-2"');
    expect(bodyText).not.toContain("ageAtWork");
    await expect(page.getByTestId("plain-chunk").first()).toBeVisible();
    await expect(page.getByTestId("their-chart")).toBeVisible();
    // ［送る］は合言葉の欄のすぐ右
    const pass = await page.getByTestId("passphrase").boundingBox();
    const send = await page.getByTestId("send").boundingBox();
    expect(pass && send && send.x > pass.x + pass.width - 1 && send.x - (pass.x + pass.width) < 40).toBe(true);
    await page.screenshot({ path: shot(`checkpoint-${tag}`), fullPage: true });
  });

  await test.step("合言葉が違えば送らない。合えば署名して輪に置き、受け手と同じ関数で ✓", async () => {
    await page.getByTestId("passphrase").fill("違う合言葉です");
    await page.getByTestId("send").click();
    await expect(page.getByTestId("send-error")).toContainText("合言葉が鍵を開きませんでした");
    await page.getByTestId("passphrase").fill(PASS);
    await page.getByTestId("send").click();
    await expect(page.getByTestId("sent")).toContainText("束を輪に置きました");
    await expect(page.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
    await expect(page.locator('[data-testid="verify-line"][data-status="ng"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="verify-line"][data-kind="bundle"][data-status="ok"]')).toHaveCount(1);
    await page.screenshot({ path: shot(`checkpoint-sent-${tag}`), fullPage: true });
  });

  await test.step("CLI：verify ring でも ✓。人だけの CLI は端末でなければ断る", async () => {
    const v = spawnSync(process.execPath, ["dist/cli.js", "verify", "ring", ringRoot], { env: { ...process.env, MOYAI_STATE_DIR: stateDir }, encoding: "utf8" });
    expect(v.status, v.stderr).toBe(0);
    expect(v.stderr).toContain("✓ 束 bundles/");
    expect(v.stderr).toContain("すべて ✓ です。");
    const k = spawnSync(process.execPath, ["dist/cli.js", "keys", "create", "--root", ringRoot, "--pack", "waste-incineration"], {
      env: { ...process.env, MOYAI_STATE_DIR: stateDir },
      encoding: "utf8",
      input: `${PASS}\n${PASS}\n`,
    });
    expect(k.status).toBe(3);
    expect(k.stderr).toContain("標準入力が端末ではない");
    const s = spawnSync(process.execPath, ["dist/cli.js", "send"], { env: { ...process.env, MOYAI_STATE_DIR: stateDir }, encoding: "utf8", input: "" });
    expect(s.status).toBe(3);
  });
});
