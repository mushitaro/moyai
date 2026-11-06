// 頼みと受け取りの画面（Wire の B1、docs/screens.md の 13・14）を、3 人の MOYAI（状態フォルダも鍵も別、保管先は同じ）で通す：
// 山田が承認を頼む → 下の帯「まだ開かれていません」→ 課長がリンクで受け取る → 山田の帯に受け取った人と鍵の警告
// → 佐藤が同じリンクを開くと「ほかの鍵が受け取っています」で見るだけ → 山田が頼み直す → 佐藤が古いリンクを開くと「取り下げられました」
// → 佐藤が自分の鍵で頼みを保管先に直接置く（時刻は未来）→ 効かない。山田の帯と鎖に出て、佐藤のリンクは「この頼みは効いていません」。
// 写しは暗・1440×900（Wire が照らす。日誌に残すときは MOYAI_SHOTS_DIR=docs/progress/shots/<日付>/b1 を渡す）。先に npm run build を走らせておく。
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { planDir } from "../../src/plan/paths";
import { canonicalize } from "../../src/share/jcs";
import { generateKeyPair, signBody } from "../../src/share/sign";
import { acceptDecisions, shot, sideTab, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

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
  await page.getByTestId("root-change").click();
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-change").click();
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("current-name")).toHaveText(name);
}

const at = (link: string, base: string) => link.replace(/^http:\/\/[^/]+/, base);
const noToken = (link: string) => link.replace(/&t=[A-Za-z0-9_-]+$/, "");
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** 保管先に書ける人が、橋渡しを通さずに、自分の鍵で頼みを置く（その版を作った鍵ではない）。合言葉を返す */
function plantRequest(root: string, planId: string, by: string, at: string): string {
  const pair = generateKeyPair();
  const token = randomBytes(32).toString("base64url");
  const body = { v: "moyai.request/1", planId, version: 1, contentHash: "0".repeat(64), kind: "approve", to: "me@example.jp", tokenHash: sha(token), by, pub: pair.pub, at };
  const dir = join(planDir(root, planId), "requests");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `000001-${sha(canonicalize(body)).slice(0, 16)}.json`), `${JSON.stringify({ body, sig: signBody(body, pair.privateKey) }, null, 1)}
`, "utf8");
  return token;
}

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
    await expect(pa.getByTestId("request-asked")).toContainText("承認を依頼しました　kacho@example.jp　まだ開かれていません");
    // 承認を頼んだあいだ：見出しは頼んだ版、自分では確定しない。右は「頼み直す」「版の履歴」だけ
    await expect(pa.getByTestId("merge-version")).toHaveText("第 1 版");
    await expect(pa.getByTestId("merge-state")).toHaveText("承認待ち");
    await expect(pa.getByTestId("confirm-open")).toHaveCount(0);
    // 比べる版は頼んだ版のひとつ前。第 1 版には前の版が無いので出さない
    await expect(pa.getByTestId("merge-compare")).toHaveCount(0);
    await expect(pa.getByTestId("request-renew")).toBeVisible();
    await expect(pa.getByTestId("history-open")).toBeVisible();
    await pa.screenshot({ path: shot(`b1-1-asked-unopened-${tag}`) });
  });

  await test.step("課長：Web メールのリンクを押して開き、受け取る（ほかのサイトからの移動でも開ける。台帳の中-16）", async () => {
    await settings(pb, two.base, root, B);
    // ほかのサイト（架空の Web メール）のページのリンクを押す。ブラウザは Sec-Fetch-Site: cross-site・navigate・document で開く
    await pb.route("http://mail.example/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: `<!doctype html><meta charset="utf-8"><a id="l" href="${at(link, two.base)}">承認のリンク</a>` }),
    );
    await pb.goto("http://mail.example/inbox");
    const nav = pb.waitForRequest((r) => r.url().startsWith(two.base) && r.isNavigationRequest());
    await pb.locator("#l").click();
    // 前は静的の経路が cross-site を断り、403 で止まっていた
    expect((await (await nav).response())?.status()).toBe(200);
    await expect(pb.getByTestId("approve-open")).toBeVisible();
  });

  await test.step("山田：開き直すと、下の帯に受け取った人と指紋。課長の鍵はまだ確かめていないので、鍵の警告の行", async () => {
    // 合言葉の無いリンクで開き直す（頼んだ本人は受け取らない）
    await pa.goto(`${one.base}/#/`);
    await pa.goto(noToken(at(link, one.base)));
    const asked = pa.getByTestId("request-asked");
    await expect(asked).toHaveAttribute("data-received", "true");
    await expect(asked).toContainText(`承認を依頼しました　受け取った人　${B}`);
    await expect(asked).toContainText(/[0-9A-Z]{4}(-[0-9A-Z]{4}){3}/);
    // 名前はすぐ前にあるので、警告では繰り返さない
    await expect(pa.getByTestId("key-warn")).toContainText("! この鍵：未照合");
    await expect(pa.getByTestId("approve-open")).toHaveCount(0);
    await expect(pa.getByTestId("confirm-open")).toHaveCount(0);
    await expect(pa.getByTestId("merge-version")).toHaveText("第 1 版");
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
    // 見るだけ：古い版ではないので「見るだけ」（淡い字）。主ボタンも押せない理由も出さない。頼まれた版の中身は出す
    await expect(pc.getByTestId("merge-state")).toHaveText("見るだけ");
    await expect(pc.getByTestId("merge-state")).toHaveAttribute("data-view-only", "true");
    await expect(pc.getByTestId("confirm-open")).toHaveCount(0);
    await expect(pc.getByTestId("confirm-disabled-reason")).toHaveCount(0);
    await expect(pc.locator(".ag-row").first()).toBeVisible();
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
    await expect(pa.getByTestId("request-asked")).toContainText("承認を依頼しました　bucho@example.jp　まだ開かれていません");
  });

  await test.step("佐藤：古いリンクを開くと「この頼みは取り下げられました」。見るだけ", async () => {
    await pc.goto(`${three.base}/#/`);
    await pc.goto(at(link, three.base));
    const other = pc.getByTestId("request-other");
    await expect(other).toHaveAttribute("data-state", "withdrawn");
    await expect(other).toHaveText("この頼みは取り下げられました");
    await expect(pc.getByTestId("approve-open")).toHaveCount(0);
    await expect(pc.getByTestId("merge-state")).toHaveText("見るだけ");
    await expect(pc.getByTestId("confirm-open")).toHaveCount(0);
    await expect(pc.getByTestId("confirm-disabled-reason")).toHaveCount(0);
    await expect(pc.locator(".ag-row").first()).toBeVisible();
    await pc.screenshot({ path: shot(`b1-4-withdrawn-${tag}`) });
  });

  await test.step("課長：受け取った頼みは取り下げられたので、もう承認できない", async () => {
    await pb.goto(`${two.base}/#/`);
    await pb.goto(noToken(at(link, two.base)));
    await expect(pb.getByTestId("plan-name")).toContainText("【架空】");
    await expect(pb.getByTestId("approve-open")).toHaveCount(0);
  });

  await test.step("佐藤：自分の鍵で頼みを保管先に直接置く（時刻は未来）。効かず、山田の帯と鎖に出る。佐藤のリンクは「この頼みは効いていません」", async () => {
    const planId = decodeURIComponent(/open=([^&]+)/.exec(link)?.[1] ?? "");
    const token = plantRequest(root, planId, A, "2099-01-01T00:00:00.000Z");
    // 山田：効いている頼みは部長宛てのまま。帯の後ろに「! 効かない頼みが置かれています　| 見る」、署名の切り替えに朱の !
    await pa.goto(`${one.base}/#/`);
    await pa.goto(noToken(at(renewed, one.base)));
    await expect(pa.getByTestId("request-asked")).toContainText("承認を依頼しました　bucho@example.jp　まだ開かれていません");
    await expect(pa.getByTestId("request-ignored")).toContainText("! 効かない頼みが置かれています");
    // 「| 見る」で、横の板を署名の切り替えで開く（たたんでいても開く）
    await pa.getByTestId("request-ignored-show").click();
    await expect(pa.getByTestId("side-signatures-ignored")).toHaveText("!");
    const row = pa.getByTestId("signature-ignored");
    await expect(row).toHaveCount(1);
    await expect(row).toHaveAttribute("data-why", "otherKey");
    // 名乗りは自称：版を作った山田と同じ名を名乗っても「（名乗り）」と指紋が出る
    await expect(row).toContainText("! 効かない頼み　この版を作った鍵ではありません");
    await expect(row).toContainText(`${A}（名乗り）`);
    // 時刻は年を省かない（未来の時刻で取り下げる狙いに気づけるように）
    await expect(row).toContainText("2099-01-01 09:00");
    await expect(pa.locator(".ag-row").first()).toBeVisible();
    await pa.screenshot({ path: shot(`b1-6-ignored-${tag}`) });
    // 佐藤：置いた頼みの合言葉で開いても、受け取れない。見るだけ
    const planted = `${at(renewed, three.base).replace(/&t=[A-Za-z0-9_-]+$/, "")}&t=${token}`;
    await pc.goto(`${three.base}/#/`);
    await pc.goto(planted);
    await expect(pc.getByTestId("request-other")).toHaveAttribute("data-state", "unknown");
    await expect(pc.getByTestId("request-other")).toHaveText("この頼みは効いていません");
    await expect(pc.getByTestId("merge-state")).toHaveText("見るだけ");
    await expect(pc.getByTestId("approve-open")).toHaveCount(0);
    await expect(pc.getByTestId("confirm-open")).toHaveCount(0);
    // 受け取った人（課長は取り下げで外れた）の画面の帯には出さない。鎖の行は開いた全員に出る
    await sideTab(pc, "signatures");
    await expect(pc.getByTestId("signature-ignored")).toHaveCount(1);
    await expect(pc.getByTestId("request-ignored")).toHaveCount(0);
  });
});
