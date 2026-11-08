// 公開の台帳へ PR を出す（docs/plan.md §2.8・§2.12。運営者の決定、2026-11-04「MOYAI が出す」）を、この PC の Chrome と Edge で画面から通す：
// 設定で置き場所・呼び名・台帳の clone を選ぶ → 見本の計画を確定する → SHARE で出す先を「公開の台帳」にする → 誰からも見えるあなた →
// 「GitHub につなぐ」でコードを出す → 人が github.com でコードを入れる（試験の台本が押した）→ つながる →
// 人が「署名して公開の台帳へ出す」を押す → PR #1 → 出した束の行方（審査中）。
// GitHub は、試験の中だけで動く代わり（tests/helpers/github-stub.ts）。本物の GitHub では確かめていない。先に npm run build を走らせておく。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { readLedgerDir, verifyLedgerFiles } from "../../src/share/ledger";
import { loadSharePack } from "../../src/share/pack";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, acceptDecisions, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { startGitHubStub, type GitHubStub } from "../helpers/github-stub";


let bridge: StartedBridge;
let stub: GitHubStub;
let work = "";
let repo = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-ledger-pr-"));
  repo = join(work, "台帳の clone");
  buildLedgerDemo({ repo: process.cwd(), out: repo, state: join(work, "demo-state"), month: "2026-11" });
  // 台帳の clone の出どころ（MOYAI は git を走らせず、.git/config の origin の URL だけを読む）
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/ledger-owner/moyai.git\n');
  stub = await startGitHubStub();
  bridge = await startBuiltBridge("moyai-e2e-ledger-pr-state-", { MOYAI_GITHUB_WEB: stub.web, MOYAI_GITHUB_API: stub.api, MOYAI_GITHUB_CLIENT_ID: stub.clientId });
});
test.afterAll(async () => {
  bridge?.stop();
  await stub?.close();
  if (work) rmSync(work, { recursive: true, force: true });
});

test("SHARE で GitHub につなぎ、署名して、公開の台帳に PR を出す", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");

  await test.step("人：設定で置き場所・呼び名・台帳の clone を選ぶ。GitHub はまだつないでいない", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("root-change").click();
    await page.getByTestId("root-input").fill(root);
    await page.getByTestId("name-change").click();
    await page.getByTestId("name-input").fill(E2E_NAME);
    await page.getByTestId("ledger-change").click();
    await page.getByTestId("ledger-input").fill(repo);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("current-ledger")).toHaveText(repo);
    await expect(page.getByTestId("settings-github")).toHaveText("未接続");
  });

  await test.step("見本の計画を開き、決定を受けて、署名して確定する", async () => {
    const body = JSON.stringify(DEV_PLANS["fictional-1"]());
    await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
    await expect(page.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("confirm-reason").fill("公開の台帳へ出す前の確定（e2e）");
    await signInDialog(page);
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 1 版）を確定しました。/);
    await page.getByTestId("confirm-close").click();
    await page.getByTestId("tab-share").click();
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
  });

  await test.step("SHARE：出す先を公開の台帳にする。見え方を選ぶと、誰からも見えるあなた。つなぐまでは出せない", async () => {
    await page.getByTestId("share-dest").getByText("公開台帳").click();
    await expect(page.getByTestId("github-login")).toHaveText("GitHub　未接続");
    await page.getByTestId("q-national").selectOption("yes");
    await page.getByTestId("q-furnace").selectOption("STOKER");
    await page.getByTestId("q-capacity_t_per_day").selectOption("C100_200");
    await page.getByTestId("q-turbine").selectOption("YES");
    await page.getByTestId("q-ash").selectOption("OUT");
    await page.getByTestId("q-contract").selectOption("SINGLE");
    await expect(page.getByText("公開時の表示")).toBeVisible();
    await expect(page.getByTestId("you-steps")).toContainText("全国の 844 施設のどれか");
    await expect(page.getByTestId("send")).toHaveText("署名して公開台帳へ送信");
    await expect(page.getByTestId("send-reason")).toHaveText("理由：GitHub　未接続");
    await expect(page.getByTestId("ledger-bottom")).toHaveText("GitHub に PR を送信。掲載後の複製は残ります。");
  });

  await test.step("GitHub につなぐ：コードを出す → 人が github.com でコードを入れる（試験の台本が押した）→ つながる", async () => {
    await page.getByTestId("github-open").click();
    await page.getByTestId("github-start").click();
    await expect(page.getByTestId("github-user-code")).toHaveText("WDJB-MJHT");
    await expect(page.getByTestId("github-state")).toHaveAttribute("data-state", "waiting");
    await page.screenshot({ path: shot(`ledger-pr-connect-${tag}`) });
    stub.approve();
    await expect(page.getByTestId("github-state")).toHaveAttribute("data-state", "ok", { timeout: 20_000 });
    await expect(page.getByTestId("github-state")).toHaveText("つながりました：moyai-test");
    await page.getByTestId("github-close").click();
    await expect(page.getByTestId("github-login")).toHaveText("GitHub　moyai-test");
    await expect(page.getByTestId("account-seen")).toHaveText("PR の GitHub アカウント　moyai-test");
    await expect(page.getByTestId("counts")).toHaveText("形 0｜固有名詞 0｜金額 0｜自由記述 0｜正確な日付 0");
    await expect(page.getByTestId("share-chain")).toHaveText("共有ファイル 1");
  });

  await test.step("人が主ボタンを押すと署名して、MOYAI が PR を 1 つ出す（合言葉の欄は無い）。行方は審査中", async () => {
    await expect(page.getByTestId("passphrase")).toHaveCount(0);
    expect(stub.prs).toHaveLength(0);
    await page.getByTestId("send").click();
    await expect(page.getByTestId("ledger-sent")).toContainText("PR #1 を出しました");
    await expect(page.locator('[data-testid="ledger-pr"][data-state="open"]')).toHaveCount(1);
    await expect(page.getByTestId("ledger-pr").first()).toContainText("審査中");
    await expect(page.getByTestId("ledger-pr-bundle").first()).toHaveText(/^共有ファイル 1　第 1 版　\d{4}-\d{2}-\d{2}$/);
    // 出したあと：止め札は「前に出した束が、まだ台帳に載っていません」の 1 つ。主ボタンは押せない
    await expect(page.getByTestId("send-reason")).toHaveText("理由：前に出した共有ファイルが、まだ台帳に載っていません");
    await expect(page.getByTestId("send")).toBeDisabled();
    await page.screenshot({ path: shot(`ledger-pr-sent-${tag}`), fullPage: true });

    // 届いた束：台帳の木に足して、受け手と同じ関数で ✓（台帳の Actions の検証と同じ関数）
    expect(stub.prs).toHaveLength(1);
    const files = Object.entries(stub.prs[0]!.files);
    expect(files).toHaveLength(1);
    const [path, bytes] = files[0]!;
    // 台帳は moyai の ledger/ に取り込んだ（中の ledger/ はそのまま）。束の道はリポジトリの根から ledger/ledger/bundles/…
    expect(path).toMatch(/^ledger\/ledger\/bundles\/[0-9a-f]{16}\/000001-[0-9a-f]{16}\.json$/);
    const pack = loadSharePack(join(process.cwd(), "packs"), "waste-incineration");
    if (!pack.ok) throw new Error(pack.reason);
    const dir = await readLedgerDir(repo);
    if (!dir.ok) throw new Error(dir.reason);
    const read = verifyLedgerFiles([...dir.files, { path, kind: "file", bytes: new Uint8Array(bytes) }], pack.pack);
    expect(read.bundles.find((b) => b.path === path)?.status).toBe("ok");
    // PR の本文に、施設の名前を書かない
    expect(stub.prs[0]!.body).not.toContain(DEV_PLANS["fictional-1"]().displayName);
  });

  await test.step("設定：GitHub との接続を切る", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await expect(page.getByTestId("settings-github")).toHaveText("moyai-test");
    await page.getByTestId("github-disconnect").click();
    await expect(page.getByTestId("settings-github")).toHaveText("未接続");
  });
});
