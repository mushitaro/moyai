// 頼みと受け取りの画面（Wire の B1、docs/screens.md の 13・14）を、3 人の MOYAI（状態フォルダも鍵も別、保管先は同じ）で通す：
// 山田が承認を頼む → 下の帯「まだ開かれていません」→ 課長がリンクで受け取る → 山田の帯に受け取った人と鍵の警告
// → 佐藤が同じリンクを開くと「ほかの鍵が受け取っています」で見るだけ → 山田が頼み直す → 佐藤が古いリンクを開くと「取り下げられました」。
// 写しは暗・1440×900（Wire が照らす。日誌に残すときは MOYAI_SHOTS_DIR=docs/progress/shots/<日付>/b1 を渡す）。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const A = "【架空】山田";
const B = "【架空】課長";
const C = "【架空】佐藤";

let one: StartedBridge;
let two: StartedBridge;
let three: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-request-"));
  one = await startBuiltBridge("moyai-e2e-request-a-");
  two = await startBuiltBridge("moyai-e2e-request-b-");
  three = await startBuiltBridge("moyai-e2e-request-c-");
});
test.afterAll(() => {
  one?.stop();
  two?.stop();
  three?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function open(browser: Browser): Promise<Page> {
  return (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" })).newPage();
}

async function settings(page: Page, base: string, root: string, name: string) {
  await page.goto(`${base}/#/settings`);
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("current-name")).toHaveText(name);
}

const at = (link: string, base: string) => link.replace(/^http:\/\/[^/]+/, base);
const noToken = (link: string) => link.replace(/&t=[A-Za-z0-9_-]+$/, "");

test("頼んだ人の帯・後から開いた人・頼み直す・取り下げられたリンク", async ({ browser }, info) => {
  const tag = info.project.name;
  test.setTimeout(240_000);
  const root = join(work, tag, "共有の保管先");
  const pa = await open(browser);
  const pb = await open(browser);
  const pc = await open(browser);
  let link = "";

  await test.step("山田：承認を頼んで渡す。下の帯は「まだ開かれていません」", async () => {
    await settings(pa, one.base, root, A);
    const body = JSON.stringify(DEV_PLANS["fictional-1"]());
    await pa.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await pa.goto(`${one.base}/?plan=fictional-1#/merge/chart`);
    await expect(pa.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(pa, "試験の台本が押した（山田が見て受けた）");
    await pa.getByTestId("confirm-open").click();
    await pa.getByTestId("confirm-reason").fill("11 月の点検を入れた。承認をお願いする（e2e）");
    await pa.getByTestId("ask-approve").check();
    await pa.getByTestId("ask-to").fill("kacho@example.jp");
    await pa.getByTestId("confirm-submit").click();
    const mailBody = (await pa.getByTestId("handoff-body").textContent()) ?? "";
    link = /http:\/\/[^\s]+#\/merge\?open=[^\s]+/.exec(mailBody)?.[0] ?? "";
    expect(link).toMatch(/&t=[A-Za-z0-9_-]{43}$/);
    await pa.keyboard.press("Escape");
    await expect(pa.getByTestId("request-asked")).toHaveAttribute("data-received", "false");
    await expect(pa.getByTestId("request-asked")).toContainText("承認を頼みました　kacho@example.jp　まだ開かれていません");
    await pa.screenshot({ path: shot(`b1-1-asked-unopened-${tag}`) });
  });

  await test.step("課長：リンクを開いて受け取る（承認の道が出る）", async () => {
    await settings(pb, two.base, root, B);
    await pb.goto(at(link, two.base));
    await expect(pb.getByTestId("approve-open")).toBeVisible();
  });

  await test.step("山田：開き直すと、下の帯に受け取った人と指紋。課長の鍵はまだ確かめていないので、鍵の警告の行", async () => {
    // 合言葉の無いリンクで開き直す（頼んだ本人は受け取らない）
    await pa.goto(`${one.base}/#/`);
    await pa.goto(noToken(at(link, one.base)));
    const asked = pa.getByTestId("request-asked");
    await expect(asked).toHaveAttribute("data-received", "true");
    await expect(asked).toContainText(`承認を頼みました　受け取った人　${B}`);
    await expect(asked).toContainText(/[0-9A-Z]{4}(-[0-9A-Z]{4}){3}/);
    await expect(pa.getByTestId("key-warn")).toContainText(`! ${B}の鍵を、まだ確かめていません`);
    await expect(pa.getByTestId("approve-open")).toHaveCount(0);
    await expect(pa.locator(".ag-row").first()).toBeVisible();
    await pa.screenshot({ path: shot(`b1-2-asked-received-${tag}`) });
  });

  await test.step("佐藤：同じリンクを開くと、ほかの鍵が受け取っている。見るだけで、承認の道は出ない", async () => {
    await settings(pc, three.base, root, C);
    await pc.goto(at(link, three.base));
    const other = pc.getByTestId("request-other");
    await expect(other).toHaveAttribute("data-state", "takenByOther");
    await expect(other).toContainText(`この頼みは、ほかの鍵が受け取っています　${B}`);
    await expect(pc.getByTestId("request-notify")).toHaveText(`${A} に知らせる`);
    expect(await pc.getByTestId("request-notify").getAttribute("href")).toMatch(/^mailto:\?subject=/);
    await expect(pc.getByTestId("approve-open")).toHaveCount(0);
    await pc.screenshot({ path: shot(`b1-3-taken-by-other-${tag}`) });
  });

  let renewed = "";
  await test.step("山田：頼み直す。ダイアログの主ボタンのすぐ上に「前のリンクは使えなくなります。」", async () => {
    await pa.getByTestId("request-renew").click();
    const dlg = pa.getByTestId("renew-dialog");
    await expect(dlg).toContainText("第 1 版を頼み直す");
    await expect(pa.getByTestId("renew-to")).toHaveValue("kacho@example.jp");
    await expect(dlg).toContainText("前のリンクは使えなくなります。");
    await pa.getByTestId("renew-to").fill("bucho@example.jp");
    await pa.getByTestId("renew-note").fill("課長が出張のため、部長にお願いします（e2e）");
    await pa.screenshot({ path: shot(`b1-5-renew-dialog-${tag}`) });
    await pa.getByTestId("renew-submit").click();
    const mail = (await pa.getByTestId("renew-mail").textContent()) ?? "";
    expect(mail).toContain("bucho@example.jp");
    renewed = /http:\/\/[^\s]+#\/merge\?open=[^\s]+&t=[A-Za-z0-9_-]{43}/.exec(mail)?.[0] ?? "";
    expect(renewed).not.toBe("");
    expect(renewed).not.toBe(link);
    await pa.keyboard.press("Escape");
    await expect(pa.getByTestId("request-asked")).toContainText("承認を頼みました　bucho@example.jp　まだ開かれていません");
  });

  await test.step("佐藤：古いリンクを開くと「この頼みは取り下げられました」。見るだけ", async () => {
    await pc.goto(`${three.base}/#/`);
    await pc.goto(at(link, three.base));
    const other = pc.getByTestId("request-other");
    await expect(other).toHaveAttribute("data-state", "withdrawn");
    await expect(other).toHaveText("この頼みは取り下げられました");
    await expect(pc.getByTestId("approve-open")).toHaveCount(0);
    await pc.screenshot({ path: shot(`b1-4-withdrawn-${tag}`) });
  });

  await test.step("課長：受け取った頼みは取り下げられたので、もう承認できない", async () => {
    await pb.goto(`${two.base}/#/`);
    await pb.goto(noToken(at(link, two.base)));
    await expect(pb.getByTestId("plan-name")).toContainText("【架空】");
    await expect(pb.getByTestId("approve-open")).toHaveCount(0);
  });
});
