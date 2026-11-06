// 縦の 1 本の人だけの半分を、この PC の Chrome と Edge で通す：
// 設定（Documents と OneDrive の知らせ・置き場所を一時のフォルダに・輪と鍵を作る）→ 星取表の試しの計画（架空）を確定（人が受けていない決定を理由つきで受ける）
// → 検問所（見え方を選ぶ・相手から見たあなた・数がすべて 0・［送る］）→ 署名して輪に置く → 受け手と同じ関数で ✓ → CLI の verify ring でも ✓。
// 人だけの CLI（keys create）は、標準入力が端末でなければ断る。置き場所と輪は一時のフォルダに作り、この PC の Documents には書かない。
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions } from "../helpers/e2e";
import { envelopeText, makeMemberBody } from "../../src/share/bundle";
import { generateKeyPair, keyIdOf, signBody, toPlainKey } from "../../src/share/sign";

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
    // 保存先は 1 行（道・既定・同期フォルダ・「| 変更」）。Documents の行・同期の知らせ・入力は「変更」を押したときだけ（Wire、11-06）
    await expect(page.getByTestId("current-root")).toBeVisible();
    await expect(page.getByTestId("documents-path")).toHaveCount(0);
    await expect(page.getByTestId("root-input")).toHaveCount(0);
    await expect(page.getByTestId("settings-save")).toBeDisabled();
    await expect(page.getByTestId("settings-save-reason")).toHaveText("理由：変更なし");
    await page.screenshot({ path: shot(`settings-${tag}`), fullPage: true });
    // 下の節（Skillパック・AI への提供範囲・Skill の採点・開発の道具）も写しに入れる
    await page.getByTestId("dev-setting").scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot(`settings-bottom-${tag}`) });
    await page.getByTestId("root-change").click();
    await expect(page.getByTestId("documents-path")).toBeVisible();
    // この PC の Documents は OneDrive の下にある（docs/plan.md §2.9）。そうでない PC では知らせが出ない
    const docs = (await page.getByTestId("documents-path").textContent()) ?? "";
    if (/onedrive/i.test(docs)) await expect(page.getByTestId("root-synced").first()).toBeVisible();
    await page.getByTestId("root-input").fill(root);
    // 版の署名に出す呼び名（架空）
    await page.getByTestId("name-change").click();
    await page.getByTestId("name-input").fill("【架空】試験の台本");
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save")).toBeDisabled();
    await expect(page.getByTestId("current-root")).toHaveText(root);
    await expect(page.getByTestId("current-name")).toHaveText("【架空】試験の台本");
  });

  await test.step("輪を作り、この輪の鍵を作る（合言葉は打たない）。指紋は 4 文字 × 4 組", async () => {
    await page.getByTestId("ring-create-open").click();
    await page.getByTestId("ring-folder").fill(ringRoot);
    await page.getByTestId("ring-pack").selectOption("waste-incineration");
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
    await expect(page.getByTestId("confirm-disabled-reason")).toContainText("未確定 ");
    const n = await acceptDecisions(page, "台帳の名前と表Ⅱ-4 を見て、人が受けた");
    expect(n).toBeGreaterThan(0);
    await expect(page.getByTestId("confirm-open")).toBeEnabled();
    await page.getByTestId("confirm-open").click();
    await expect(page.getByTestId("diff-summary")).toBeVisible();
    // 署名のダイアログに保管先の生のパスは出さない
    await expect(page.getByTestId("confirm-root")).toHaveCount(0);
    await expect(page.getByTestId("pending")).toContainText(`確定のシートで確定した決定 ${n} 件`);
    // 理由が空なら確定できない
    await expect(page.getByTestId("confirm-submit")).toBeDisabled();
    await expect(page.getByTestId("confirm-submit-reason")).toContainText("理由：理由が未入力");
    await page.getByTestId("confirm-reason").fill("試しの計画を確定する（e2e）");
    // 署名：合言葉は打たない。この PC にまだ鍵が無いので、鍵を作ってから署名すると 1 行で知らせる
    await expect(page.getByTestId("sign-as")).toContainText("「【架空】試験の台本」として");
    await expect(page.getByTestId("sign-as")).toContainText("署名の鍵を作ります");
    await expect(page.getByTestId("confirm-submit")).toBeEnabled();
    await page.screenshot({ path: shot(`confirm-${tag}`) });
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
    const versions = join(root, "plans", "fixture-fictional-1", "versions");
    expect(readdirSync(versions)).toEqual(["000001.json"]);
    expect(readdirSync(join(root, "plans", "fixture-fictional-1", "reports"))).toEqual(["000001-diff.xlsx"]);
    await page.getByTestId("confirm-close").click();
    await page.getByTestId("tab-share").click();
  });

  await test.step("検問所：見え方を選ぶと、相手から見たあなた・3 つの欄・数がすべて 0", async () => {
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
    await expect(page.getByTestId("q-furnace")).toBeVisible();
    // 送る前は押せない（見え方が決まっていない）
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
    // 相手から見たあなた：見え方の 1 行と、塊ごとの周期・工数・日数の帯（委託先は伏せる）
    await expect(page.getByTestId("you-profile")).toBeVisible();
    await expect(page.getByTestId("plain-chunk").first()).toBeVisible();
    await expect(page.getByTestId("plain-chunk").first().locator(".moyai-redact")).toHaveCount(1);
    // 出元：束の鎖（初めて出すので 束 1）
    await expect(page.getByTestId("share-chain")).toHaveText("共有ファイル 1");
    // 出ていくバイト列・原本・相手の星取表は「中身を見る」にたたんである
    await expect(page.getByTestId("their-chart")).toBeHidden();
    await page.getByTestId("share-contents").locator("summary").click();
    await expect(page.getByTestId("their-chart")).toBeVisible();
    // 合言葉の欄は無い（運営者の決定 2026-11-04）。主ボタンは 1 つ
    await expect(page.getByTestId("passphrase")).toHaveCount(0);
    await expect(page.getByTestId("send")).toBeEnabled();
    await page.screenshot({ path: shot(`checkpoint-${tag}`), fullPage: true });
  });

  await test.step("人が主ボタンを押すと、署名して輪に置き、受け手と同じ関数で ✓", async () => {
    // 受け取った束（SHARE の下の節）：置く前は、輪の決まりと自分の仲間の行だけ（束はまだ無い）
    await expect(page.getByTestId("received")).toContainText("受信した共有ファイル");
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-kind="bundle"]')).toHaveCount(0);
    await page.getByTestId("send").click();
    await expect(page.getByTestId("sent")).toContainText("共有ファイルを共有フォルダに置きました");
    await expect(page.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
    await expect(page.locator('[data-testid="verify-line"][data-status="ng"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="verify-line"][data-kind="bundle"][data-status="ok"]')).toHaveCount(1);
    await page.screenshot({ path: shot(`checkpoint-sent-${tag}`), fullPage: true });
    await page.getByTestId("received").scrollIntoViewIfNeeded();
    await page.getByTestId("received").screenshot({ path: shot(`checkpoint-received-${tag}`) });
    // 束の行は「束 1　第 1 版　年-月-日」（自分の束）
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-kind="bundle"]')).toContainText(/共有ファイル 1　第 1 版　\d{4}-\d{2}-\d{2}/);
    // 束の形をしていないファイルを自分のフォルダに置く（試験の台本が置いた）と、✗ の行と数が出る
    const ringDirs = readdirSync(ringRoot).filter((d) => /^[0-9a-f]{16}$/.test(d));
    const keyDirs = readdirSync(join(ringRoot, ringDirs[0]!, "bundles"));
    writeFileSync(join(ringRoot, ringDirs[0]!, "bundles", keyDirs[0]!, "メモ.txt"), "【架空】試験のメモ");
    await page.getByTestId("received-again").click();
    // ✗ は 2 行：置いたファイルの行と、そのフォルダの仲間の行（理由はどちらも「束の形でない名前」）
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-status="ng"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-kind="bundle"][data-status="ng"]')).toContainText("共有ファイルの形でないファイル");
    // 仲間の行の理由は「束でないファイルが混じっています」、ファイルの行は「束の名前の形ではありません」
    // 仲間の行は 2 つ（輪を作った人の鍵と、束に署名した施設の鍵）。✗ はファイルを置いたフォルダの仲間の行だけ
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-kind="member"]')).toHaveCount(2);
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-kind="member"][data-status="ng"]')).toContainText("共有ファイルでないファイルが混じっています");
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-kind="bundle"][data-status="ng"]')).toContainText("共有ファイルの名前の形ではありません");
    await page.getByTestId("received").screenshot({ path: shot(`checkpoint-received-ng-${tag}`) });
    // 置いたファイルを消すと、また ✓ だけ（次の CLI の確かめのため）
    rmSync(join(ringRoot, ringDirs[0]!, "bundles", keyDirs[0]!, "メモ.txt"));
    await page.getByTestId("received-again").click();
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-status="ng"]')).toHaveCount(0);
  });

  await test.step("まだ確かめていない仲間：受け取った束の行に「まだ確かめていません」。指紋を読み合わせると ✓（監査 D1、Share.dc.html Version 46）", async () => {
    // 試験の台本が、ほかの拠点の仲間のファイルを輪に置いた
    const peer = generateKeyPair();
    const ringId = readdirSync(ringRoot).find((d) => /^[0-9a-f]{16}$/.test(d))!;
    const body = makeMemberBody(ringId, keyIdOf(peer.pub), peer.pub, "2026-11");
    writeFileSync(join(ringRoot, ringId, "members", `${keyIdOf(peer.pub)}.json`), envelopeText(body, signBody(body, peer.privateKey)));
    await page.getByTestId("received-again").click();
    const row = page.locator('[data-testid="verify-line"][data-state="unconfirmed"]');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("未照合");
    await page.getByTestId("received").screenshot({ path: shot(`checkpoint-member-unconfirmed-${tag}`) });
    // 人が仲間に電話で読み上げてもらい、16 文字が合った（試験の台本が押した）
    await row.getByTestId("member-check").click();
    await expect(page.getByText("メンバーの鍵番号")).toBeVisible();
    await page.getByTestId("key-check-matched").click();
    await expect(page.locator('[data-testid="verify-line"][data-state="unconfirmed"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="received"] [data-testid="verify-line"][data-status="ng"]')).toHaveCount(0);
  });

  await test.step("施設の署名鍵が 2 つ（同期の衝突の写し）：送れない理由の右に「署名鍵を再発行」。再発行すると、旧鍵に失効の印を置き、新しい鍵で送れる（docs/plan.md §2.19 の 5）", async () => {
    // 試験の台本が、2 台目の PC が作った鍵（同期の衝突の写し）を計画のフォルダに置いた
    const ringId = readdirSync(ringRoot).find((d) => /^[0-9a-f]{16}$/.test(d))!;
    const keysDir = join(root, "plans", "fixture-fictional-1", "share", "keys");
    writeFileSync(join(keysDir, `${ringId}-PC2.json`), JSON.stringify(toPlainKey(generateKeyPair())));
    // 送った知らせを閉じるため、共有先を切り替えて戻す（戻すと出ていくものを作り直す）
    const destSwitch = page.locator('[role="group"]').filter({ has: page.locator("button", { hasText: "共有フォルダ" }) }).first();
    await destSwitch.locator("button").nth(1).click();
    await destSwitch.locator("button").nth(0).click();
    await expect(page.getByTestId("send-reason")).toHaveText(/^理由：署名鍵の重複/);
    await expect(page.getByTestId("send")).toBeDisabled();
    await page.getByTestId("rotate-open").click();
    await expect(page.getByTestId("rotate-run")).toBeVisible();
    // 失効する鍵は鍵番号（4 字 × 4 組）で出し、鍵 ID は出さない（Wire）
    await expect(page.getByTestId("rotate-key").first()).toHaveText(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}/);
    await page.screenshot({ path: shot(`checkpoint-rotate-${tag}`) });
    await page.getByTestId("rotate-run").click();
    await expect(page.getByTestId("rotate-done")).toHaveText("失効 2　次回の送信から新しい鍵");
    // 引退の印は輪の members/ に、鍵ごとに 1 つ。鍵のファイルは keys/retired/ へ移す（消さない）
    expect(readdirSync(join(ringRoot, ringId, "members")).filter((n) => n.endsWith(".retired.json"))).toHaveLength(2);
    expect(readdirSync(keysDir)).toEqual(["retired"]);
    // 受信の一覧：失効した鍵の仲間の行は ✓ を付けず、薄い字で「失効」
    await page.getByTestId("received-again").click();
    await expect(page.locator('[data-testid="verify-line"][data-state="retired"][data-kind="member"]').first()).toContainText("失効");
    // 新しい鍵で送れる（連番 1 から）
    await page.getByTestId("received-again").click();
    await expect(page.getByTestId("share-chain")).toHaveText("共有ファイル 1");
    await expect(page.getByTestId("send")).toBeEnabled();
  });

  await test.step("CLI：verify ring でも ✓。人だけの CLI は端末でなければ断る", async () => {
    const v = spawnSync(process.execPath, ["dist/cli.js", "verify", "ring", ringRoot], { env: { ...process.env, MOYAI_STATE_DIR: stateDir }, encoding: "utf8" });
    expect(v.status, v.stderr).toBe(0);
    expect(v.stderr).toContain("✓ 共有ファイル bundles/");
    expect(v.stderr).toContain("すべて ✓ です。");
    const k = spawnSync(process.execPath, ["dist/cli.js", "keys", "create", "--root", ringRoot, "--pack", "waste-incineration"], {
      env: { ...process.env, MOYAI_STATE_DIR: stateDir },
      encoding: "utf8",
      input: "",
    });
    expect(k.status).toBe(3);
    expect(k.stderr).toContain("標準入力が端末ではない");
    const s = spawnSync(process.execPath, ["dist/cli.js", "send"], { env: { ...process.env, MOYAI_STATE_DIR: stateDir }, encoding: "utf8", input: "" });
    expect(s.status).toBe(3);
  });
});
