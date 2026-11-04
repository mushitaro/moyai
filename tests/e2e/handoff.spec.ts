// 人をまたいで版を重ねる（docs/plan.md §2.18.2・docs/screens.md 3.4）を、この PC の Chrome と Edge で、2 人の MOYAI（状態フォルダも鍵も別、保管先は同じ）で通す：
// 山田（1 人目）が版に署名して「承認を頼む」→ 渡すメールの文（版の場所とハッシュだけ）→ 課長（2 人目）がメールのリンクで開くと、保管先の版の署名と鎖を確かめてから見せる
// → 課長は「承認して署名する」（自分の版ではないので押せる）→ 編集の番は承認済み。山田の側では、自分の版を承認する道は出ない。リンクのハッシュが違えば開かない。
// AI は使わない（メールは人が自分のメーラーで開く道。Claude が送る道は intake_survey の handoff）。先に npm run build を走らせておく。
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const A = { name: "【架空】山田", pass: "架空の合言葉 山田の鍵" };
const B = { name: "【架空】課長", pass: "架空の合言葉 課長の鍵" };

let one: StartedBridge;
let two: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-handoff-"));
  one = await startBuiltBridge("moyai-e2e-handoff-a-");
  two = await startBuiltBridge("moyai-e2e-handoff-b-");
});
test.afterAll(() => {
  one?.stop();
  two?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function settings(page: Page, base: string, root: string, name: string) {
  await page.goto(`${base}/#/settings`);
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-input").fill(name);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("current-name")).toHaveText(name);
}

test("山田が承認を頼んで渡し、課長がメールのリンクで開いて承認して署名する", async ({ browser }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "共有の保管先");
  const pa = await (await browser.newContext()).newPage();
  const pb = await (await browser.newContext()).newPage();
  let link = "";

  await test.step("山田：設定で保管先と呼び名。見本の計画を MERGE で開き、決定を受け、承認を頼んで署名して渡す", async () => {
    await settings(pa, one.base, root, A.name);
    const body = JSON.stringify(DEV_PLANS["fictional-1"]());
    await pa.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await pa.goto(`${one.base}/?plan=fictional-1#/merge/chart`);
    await expect(pa.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(pa, "試験の台本が押した（山田が見て受けた）");
    await pa.getByTestId("confirm-open").click();
    await pa.getByTestId("confirm-reason").fill("11 月の点検を入れた。承認をお願いする（e2e）");
    await pa.getByTestId("ask-approve").check();
    await expect(pa.getByTestId("confirm-submit")).toHaveText("署名して渡す");
    // 宛先が無ければ押せない
    await pa.getByTestId("sign-passphrase").fill(A.pass);
    await pa.getByTestId("sign-passphrase-again").fill(A.pass);
    await expect(pa.getByTestId("confirm-submit")).toBeDisabled();
    await pa.getByTestId("ask-to").fill("kacho@example.jp");
    await pa.getByTestId("ask-note").fill("11 月の点検の結果を入れました");
    await expect(pa.getByTestId("confirm-submit")).toBeEnabled();
    await pa.getByTestId("confirm-submit").click();
    await expect(pa.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    const mailBody = (await pa.getByTestId("handoff-body").textContent()) ?? "";
    expect(mailBody).toContain("この版の承認をお願いします。");
    expect(mailBody).toContain("計画の中身は運びません");
    expect(await pa.getByTestId("handoff-mailto").getAttribute("href")).toMatch(/^mailto:kacho%40example\.jp\?subject=/);
    link = /http:\/\/[^\s]+#\/merge\?open=[^\s]+/.exec(mailBody)?.[0] ?? "";
    expect(link).toContain("&v=1&h=");
    await pa.screenshot({ path: shot(`handoff-mail-${tag}`), fullPage: true });
    await pa.keyboard.press("Escape");
    // 山田の側：承認を頼んだ版は、自分では承認できない（承認の道は出ない）
    await expect(pa.getByTestId("merge-turn")).toHaveAttribute("data-state", "awaitingApproval");
    await expect(pa.getByTestId("approve-open")).toHaveCount(0);
    // トップのもやいの星取表：施設の行に「第 1 版」と朱の「承認待ち」、今月の列に朱の ○（渡して承認待ちの版）
    await pa.goto(`${one.base}/#/`);
    const row = pa.getByTestId("moyai-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("第 1 版");
    await expect(row.getByTestId("moyai-state")).toHaveText("承認待ち");
    await expect(row.getByTestId("moyai-mark")).toHaveText("○");
    await pa.screenshot({ path: shot(`handoff-top-awaiting-${tag}`) });
  });

  await test.step("課長：別の MOYAI で同じ保管先を開き、リンクのハッシュが違えば開かない。正しいリンクなら署名を確かめてから見せる", async () => {
    await settings(pb, two.base, root, B.name);
    const theirs = link.replace(/^http:\/\/[^/]+/, two.base);
    await pb.goto(theirs.replace(/h=[0-9a-f]+/, "h=0000000000000000"));
    await expect(pb.getByTestId("merge-notice")).toContainText("ハッシュが合いません");
    await pb.goto(`${two.base}/#/`);
    await pb.goto(theirs);
    await expect(pb.getByTestId("plan-name")).toContainText("【架空】");
    await expect(pb.getByTestId("merge-turn")).toHaveAttribute("data-state", "awaitingApproval");
    await expect(pb.getByTestId("approve-open")).toBeVisible();
    // 見出しの版は、承認を頼まれた版（第 1 版）
    await expect(pb.getByTestId("merge-version")).toHaveText("第 1 版");
    // 横の板の署名：山田の渡す署名は、課長の PC ではまだ確認していない鍵（! 未確認）。版の中身のハッシュは 4 文字 × 2 組を 4 つ
    await pb.getByTestId("side-signatures").click();
    await expect(pb.locator('[data-testid="signature"][data-role="edit"]')).toHaveAttribute("data-trust", "unconfirmed");
    await expect(pb.getByTestId("signatures-hash")).toHaveText(/^([0-9a-f]{4} [0-9a-f]{4}  ){3}[0-9a-f]{4} [0-9a-f]{4}$/);
    await pb.screenshot({ path: shot(`handoff-approver-${tag}`) });
  });

  await test.step("課長：承認して署名する。この PC にまだ鍵が無いので、合言葉を 2 回入れて鍵を作ってから署名する", async () => {
    await pb.getByTestId("approve-open").click();
    await pb.getByTestId("sign-dialog-passphrase").fill(B.pass);
    await expect(pb.getByTestId("sign-submit")).toBeDisabled();
    await pb.getByTestId("sign-dialog-passphrase-again").fill(B.pass);
    await pb.getByTestId("sign-submit").click();
    await expect(pb.getByTestId("merge-notice")).toContainText("第 1 版を承認しました");
    await expect(pb.getByTestId("merge-turn")).toHaveAttribute("data-state", "approved");
    await expect(pb.getByTestId("approve-open")).toHaveCount(0);
    // 承認の署名は、課長の PC の鍵（own）
    await pb.getByTestId("side-signatures").click();
    await expect(pb.locator('[data-testid="signature"][data-role="approve"]')).toHaveAttribute("data-trust", "own");
    await pb.screenshot({ path: shot(`handoff-approved-${tag}`) });
  });

  await test.step("山田のトップ：承認された版は ●、状態は出ない。「＋ 次の版」で、その版を MERGE で開く", async () => {
    await pa.reload();
    const row = pa.getByTestId("moyai-row");
    await expect(row.getByTestId("moyai-mark")).toHaveText("●");
    await expect(row.getByTestId("moyai-state")).toHaveCount(0);
    const next = row.getByTestId("moyai-next");
    await expect(next).toHaveAttribute("href", /^#\/merge\?open=[^&]+&v=1&h=[0-9a-f]{16}$/);
    await pa.screenshot({ path: shot(`handoff-top-approved-${tag}`) });
    await next.click();
    await expect(pa.getByTestId("merge-version")).toHaveText("第 1 版");
    await expect(pa.getByTestId("merge-turn")).toHaveAttribute("data-state", "approved");
  });

  await test.step("保管先：版 1 に、山田の渡す署名（edit）と課長の承認の署名（approve）。版の履歴で確かめられる", async () => {
    const plans = readdirSync(join(root, "plans"));
    expect(plans).toHaveLength(1);
    const sigs = readdirSync(join(root, "plans", plans[0]!, "signatures")).sort();
    expect(sigs.map((n) => n.split("-")[1])).toEqual(["approve", "edit"]);
    expect(readdirSync(join(root, "people"))).toHaveLength(2);
  });
});
