// 人をまたいで版を重ねる（docs/plan.md §2.18.2・docs/screens.md 3.4）を、この PC の Chrome と Edge で、2 人の MOYAI（状態フォルダも鍵も別、保管先は同じ）で通す：
// 山田（1 人目）が版に署名して「承認を頼む」→ 渡すメールの文（版の場所とハッシュだけ）→ 課長（2 人目）がメールのリンクで開くと、保管先の版の署名と鎖を確かめてから見せる
// → 開いただけでは受け取らない（見るだけ）。課長が「受け取る」を押すと受け取りに署名する（Security の点検 11-08 の中6）
// → 課長は「承認して署名する」（自分の版ではないので押せる）→ 編集の番は承認済み。山田の側では、自分の版を承認する道は出ない。リンクのハッシュが違えば・空なら開かない。
// AI は使わない（メールは人が自分のメーラーで開く道。Claude が送る道は intake_survey の handoff）。先に npm run build を走らせておく。
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions, shot, sideTab, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const A = { name: "【架空】山田" };
const B = { name: "【架空】課長" };

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
  await page.getByTestId("root-change").click();
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-change").click();
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
    // 下の帯から開いた既定は「渡さずに自分で確定する」：題と主ボタンは「確定する」。承認を頼むと「渡す」に替わる（docs/screens.md §3.4 の末尾）
    await expect(pa.getByRole("dialog", { name: "第 1 版に署名して確定する" })).toBeVisible();
    await expect(pa.getByTestId("confirm-submit")).toHaveText("署名して確定する");
    await pa.getByTestId("confirm-reason").fill("11 月の点検を入れた。承認をお願いする（e2e）");
    await pa.getByTestId("ask-approve").check();
    await expect(pa.getByRole("dialog", { name: "第 1 版に署名して渡す" })).toBeVisible();
    await expect(pa.getByTestId("confirm-submit")).toHaveText("署名して渡す");
    // 宛先が無ければ押せない
    await expect(pa.getByTestId("confirm-submit")).toBeDisabled();
    await pa.getByTestId("ask-to").fill("kacho@example.jp");
    await expect(pa.getByTestId("confirm-submit")).toBeEnabled();
    await pa.getByTestId("confirm-submit").click();
    // 渡したときの結果は 1 文：メールは MOYAI が用意し、送るのは利用者のメーラーか Claude
    await expect(pa.getByTestId("confirm-done")).toHaveText(/^第 1 版に署名して、.+へのメールを用意しました。$/);
    const mailBody = (await pa.getByTestId("handoff-body").textContent()) ?? "";
    expect(mailBody).toContain("この版の承認をお願いします。");
    expect(mailBody).toContain("計画の中身は運びません");
    expect(await pa.getByTestId("handoff-mailto").getAttribute("href")).toMatch(/^mailto:kacho%40example\.jp\?subject=/);
    link = /http:\/\/[^\s]+#\/merge\?open=[^\s]+/.exec(mailBody)?.[0] ?? "";
    expect(link).toContain("&v=1&h=");
    // リンクにだけ、使い捨ての合言葉が入る（監査 B1。最初に「受け取る」を押した鍵が受け取りに署名する）
    expect(link).toMatch(/&t=[A-Za-z0-9_-]{43}$/);
    await pa.screenshot({ path: shot(`handoff-mail-${tag}`), fullPage: true });
    await pa.keyboard.press("Escape");
    // 山田の側：承認を頼んだ版は、自分では承認できない（承認の道は出ない）
    // 下の帯の左：まだ誰も開いていない頼み（Wire の B1）。右に「頼み直す」
    await expect(pa.getByTestId("request-asked")).toHaveAttribute("data-received", "false");
    await expect(pa.getByTestId("request-asked")).toContainText("承認を依頼しました　kacho@example.jp　まだ開かれていません");
    await expect(pa.getByTestId("request-renew")).toBeVisible();
    await expect(pa.getByTestId("approve-open")).toHaveCount(0);
    // トップのもやいの星取表：施設の行に「第 1 版」と朱の「承認待ち」、今月の列に朱の ○（渡して承認待ちの版）
    await pa.goto(`${one.base}/#/`);
    const row = pa.getByTestId("moyai-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("第 1 版");
    // 承認待ちの版はまだ確定していないので、年度を付けない
    await expect(row.getByTestId("moyai-version")).toHaveText("第 1 版");
    await expect(row.getByTestId("moyai-state")).toHaveText("承認待ち");
    await expect(row.getByTestId("moyai-mark")).toHaveText("○");
    await pa.screenshot({ path: shot(`handoff-top-awaiting-${tag}`) });
  });

  await test.step("課長：別の MOYAI で同じ保管先を開き、リンクのハッシュが違えば・空なら・短ければ開かない。正しいリンクなら署名を確かめてから見るだけで見せ、「受け取る」を押すと受け取る", async () => {
    await settings(pb, two.base, root, B.name);
    const theirs = link.replace(/^http:\/\/[^/]+/, two.base);
    const receipts = () => {
      const plans = readdirSync(join(root, "plans"));
      const dir = join(root, "plans", plans[0]!, "receipts");
      return existsSync(dir) ? readdirSync(dir).length : 0;
    };
    const head = /h=([0-9a-f]+)/.exec(theirs)?.[1] ?? "";
    expect(head).toHaveLength(16);
    // 違うハッシュ・空の h・16 字に満たない h（頭は合っていても）は、どれも開かない。受け取りの道も出ない
    for (const h of ["0000000000000000", "", head.slice(0, 8)]) {
      await pb.goto(`${two.base}/#/`);
      await pb.goto(theirs.replace(/h=[0-9a-f]+/, `h=${h}`));
      await expect(pb.getByTestId("merge-notice")).toContainText("ハッシュが合いません");
      await expect(pb.getByTestId("request-receive")).toHaveCount(0);
    }
    await pb.goto(`${two.base}/#/`);
    await pb.goto(theirs);
    await expect(pb.getByTestId("plan-name")).toContainText("【架空】");
    // 開いただけでは受け取らない：見るだけ。下の帯の右は「受け取る」（承認と差戻しの前の段階）。受け取りの署名は置かれない
    await expect(pb.getByTestId("request-receive")).toHaveText("受け取る");
    await expect(pb.getByTestId("merge-state")).toHaveText("見るだけ");
    await expect(pb.getByTestId("merge-state")).toHaveAttribute("data-view-only", "true");
    await expect(pb.getByTestId("approve-open")).toHaveCount(0);
    await expect(pb.getByTestId("return-open")).toHaveCount(0);
    await expect(pb.getByTestId("confirm-open")).toHaveCount(0);
    await expect(pb.getByTestId("confirm-disabled-reason")).toHaveCount(0);
    await expect(pb.getByTestId("merge-version")).toHaveText("第 1 版");
    // この PC にはまだ鍵が無い（開いただけでは作らない）。押したときに作ることを、ボタンの左に出す
    await expect(pb.getByTestId("request-receive-new-key")).toHaveText("はじめての署名なので、この PC にあなたの署名の鍵を作ります。");
    expect(receipts()).toBe(0);
    await pb.screenshot({ path: shot(`handoff-receive-${tag}`) });
    // 押すと、鍵を作って受け取りに署名する。承認と差戻しへ進める
    await pb.getByTestId("request-receive").click();
    await expect(pb.getByTestId("approve-open")).toBeVisible();
    await expect(pb.getByTestId("return-open")).toBeVisible();
    await expect(pb.getByTestId("request-receive")).toHaveCount(0);
    await expect(pb.getByTestId("request-receive-new-key")).toHaveCount(0);
    expect(receipts()).toBe(1);
    await expect(pb.getByTestId("merge-turn")).toHaveAttribute("data-state", "awaitingApproval");
    // 承認を頼まれた人は編集しないので、下の帯には頼まれていることだけ
    await expect(pb.getByTestId("merge-turn")).toHaveText("承認を頼まれています");
    await expect(pb.getByTestId("approve-open")).toBeVisible();
    // 山田の鍵は、課長の PC ではまだ確かめていない：下の帯の「承認を頼まれています」の右に 1 行（止めない。KeyWarn.dc.html の 1）
    await expect(pb.getByTestId("key-warn")).toContainText(`! ${A.name}の鍵：未照合`);
    await expect(pb.getByTestId("key-warn")).toHaveAttribute("data-trust", "unconfirmed");
    await expect(pb.getByTestId("approve-open")).toBeEnabled();
    // 見出しの版は、承認を頼まれた版（第 1 版）
    await expect(pb.getByTestId("merge-version")).toHaveText("第 1 版");
    // 横の板の署名：山田の渡す署名は、課長の PC ではまだ確認していない鍵（! 未確認）。版の中身のハッシュは 4 文字 × 2 組を 4 つ
    await sideTab(pb, "signatures");
    await expect(pb.locator('[data-testid="signature"][data-role="edit"]')).toHaveAttribute("data-trust", "unconfirmed");
    await expect(pb.locator('[data-testid="signature"][data-role="edit"]').getByTestId("signature-check")).toBeVisible();
    await expect(pb.getByTestId("signatures-hash")).toHaveText(/^([0-9a-f]{4} [0-9a-f]{4}  ){3}[0-9a-f]{4} [0-9a-f]{4}$/);
    await pb.screenshot({ path: shot(`handoff-approver-${tag}`) });
  });

  await test.step("課長：星取表の行を選んでコメントを付ける。横の板に ① と、行の名前の右に ①", async () => {
    await pb.locator('.ag-row [col-id="lv2"]').filter({ hasText: "計量機" }).first().click();
    await sideTab(pb, "comments");
    await expect(pb.getByTestId("comment-to")).toHaveText("付ける行：受入供給設備 › 計量機");
    await expect(pb.getByTestId("comment-add")).toBeDisabled();
    await pb.getByTestId("comment-text").fill("計量機の 2027 年度の点検は、ほかの工事と重なりませんか。");
    await pb.getByTestId("comment-add").click();
    await expect(pb.getByTestId("comment")).toHaveCount(1);
    await expect(pb.getByTestId("comment").first()).toContainText("① 受入供給設備 › 計量機");
    await expect(pb.getByTestId("comment").first()).toContainText(B.name);
    await expect(pb.getByTestId("side-comments")).toHaveText("コメント 1");
    await expect(pb.locator('.ag-row [col-id="lv2"]').filter({ hasText: "計量機　①" })).toHaveCount(1);
    await pb.screenshot({ path: shot(`handoff-comment-${tag}`) });
  });

  await test.step("課長：承認して署名する（鍵は「受け取る」を押したときに作った。合言葉は打たない）", async () => {
    await pb.getByTestId("approve-open").click();
    // 合言葉の欄は無い。鍵は「受け取る」を押したとき（受け取りに署名したとき）にもう作ってある
    await expect(pb.getByTestId("sign-dialog-new-key")).toHaveCount(0);
    // 承認のダイアログでも、主ボタンのすぐ上に同じ 1 行。指紋を読み合わせると確認済みになり、1 行は消える（試験の台本が押した）
    const warn = pb.getByTestId("sign-dialog").getByTestId("key-warn");
    await expect(warn).toContainText(`! ${A.name}の鍵：未照合`);
    await warn.getByTestId("key-warn-check").click();
    await expect(pb.getByText(`${A.name}の鍵番号`)).toBeVisible();
    await expect(pb.getByTestId("key-check-fingerprint")).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/);
    await pb.getByTestId("key-check-matched").click();
    await expect(pb.getByTestId("key-check-fingerprint")).toHaveCount(0);
    await expect(pb.getByTestId("key-warn")).toHaveCount(0);
    await expect(pb.getByTestId("sign-submit")).toBeEnabled();
    await pb.getByTestId("sign-submit").click();
    await expect(pb.getByTestId("merge-notice")).toContainText(/令和 \d+ 年度版（第 1 版）を承認しました。/);
    // 承認したあとは編集の番が空き、次の版を編集できる（見出しの通知に「令和 n 年度版（第 1 版）を承認しました。」。承認した版は年度で呼ぶ）
    await expect(pb.getByTestId("merge-turn")).toHaveAttribute("data-state", "editing");
    await expect(pb.getByTestId("approve-open")).toHaveCount(0);
    // 承認の署名は、課長の PC の鍵（own）
    await sideTab(pb, "signatures");
    await expect(pb.locator('[data-testid="signature"][data-role="approve"]')).toHaveAttribute("data-trust", "own");
    await pb.screenshot({ path: shot(`handoff-approved-${tag}`) });
  });

  await test.step("山田：トップの「＋ 次の版」で開くと、課長のコメントが横の板に出る（保管先から読む）", async () => {
    await pa.goto(`${one.base}/#/`);
    await pa.getByTestId("moyai-next").click();
    await sideTab(pa, "comments");
    await expect(pa.getByTestId("side-comments")).toHaveText("コメント 1");
    await expect(pa.getByTestId("comment").first()).toContainText("計量機の 2027 年度の点検");
  });

  await test.step("山田のトップ：承認された版は ●、状態は出ない。「＋ 次の版」で、その版を MERGE で開く", async () => {
    await pa.goto(`${one.base}/#/`);
    const row = pa.getByTestId("moyai-row");
    await expect(row.getByTestId("moyai-mark")).toHaveText("●");
    // 承認された版は、承認の署名の日の年度で呼ぶ（docs/screens.md §3.4 の末尾）
    await expect(row.getByTestId("moyai-version")).toHaveText(/^令和 \d+ 年度版（第 1 版）$/);
    await expect(row.getByTestId("moyai-state")).toHaveCount(0);
    const next = row.getByTestId("moyai-next");
    await expect(next).toHaveAttribute("href", /^#\/merge\?open=[^&]+&v=1&h=[0-9a-f]{16}$/);
    await pa.screenshot({ path: shot(`handoff-top-approved-${tag}`) });
    await next.click();
    await expect(pa.getByTestId("merge-version")).toHaveText("第 2 版");
    await expect(pa.getByTestId("merge-turn")).toHaveAttribute("data-state", "editing");
  });

  await test.step("保管先：版 1 に、山田の渡す署名（edit）と課長の承認の署名（approve）。版の履歴で確かめられる", async () => {
    const plans = readdirSync(join(root, "plans"));
    expect(plans).toHaveLength(1);
    const sigs = readdirSync(join(root, "plans", plans[0]!, "signatures")).sort();
    expect(sigs.map((n) => n.split("-")[1])).toEqual(["approve", "edit"]);
    expect(readdirSync(join(root, "people"))).toHaveLength(2);
  });
});
