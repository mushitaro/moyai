// デモの通し（運営者に見せる台本。docs/plan.md §6.1・docs/screens.md 3）：新しい画面の段 MOYAI › MERGE › EXPORT › SHARE を、端から端まで 1 本で流す。
// 山田（1 人目）と課長（2 人目）は、状態フォルダも鍵も別の 2 つの MOYAI で、保管先は同じ。Claude の役は試験の台本が MCP の SDK で代わる（本物の Claude の会話ではない）。
// 人の操作（受ける・署名する・承認する・落とす・送る）は画面のボタンだけで、試験の台本が人の代わりに押す。
//   1 トップ（施設が無い）→「＋ 新しい施設」→ MERGE の資料のシートに資料を落とす
//   2 Claude が取り込みを最後まで動かす（質問に既定の答え・計画を作る）→ 当てはめの規則の案 → 人が規則ごとに受ける
//   3 星取表（共通の設備項目 × 作業の属性）→ 突き合せ → Claude が公開の台帳を読み、周期の案（朱の破線の円）→ 人が決定のシートで受ける
//   4 検査のシート → 署名して承認を頼み、渡すメールの文 → 課長がリンクで開き、承認して署名する
//   5 トップに ● →「＋ 次の版」で開く → EXPORT で Excel を落とす → SHARE の検問所 → 人が押して署名し、輪に置き、✓
//   6〜10 版どうしの差・古い版から次の版・似た施設の重ね・コメント・派生・様式に写す
//   11 SHARE の公開の台帳：誰からも見えるあなた。GitHub にはつないでいない（MOYAI の OAuth App の登録待ち。PR を出す流れは tests/e2e/ledger-pr.spec.ts）
// 使い方：npm run build のあと、MOYAI_SHOTS_DIR=docs/progress/shots/<日付>/demo npx playwright test -c playwright.demo.config.ts tests/demo/walkthrough.spec.ts
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { f1Rules } from "../fixtures/crosswalk/rules";
import { packName, FICTIONAL_1, callTool as call, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】みどり台クリーンセンター";
const A = { name: "【架空】山田" };
const B = { name: "【架空】課長" };
const HUMAN = "試験の台本が押した（台帳の名前とパックの項目を見て合っている）";
// 見え方（利用者がチャットで答えたことにする。架空の施設）
const PROFILE = { furnace: "STOKER", capacity_t_per_day: "C200_400", turbine: "YES", ash: "OUT", contract: "SINGLE" } as const;

let one: StartedBridge;
let two: StartedBridge;
let work = "";
let ledger = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-demo-"));
  ledger = join(work, "台帳の clone");
  buildLedgerDemo({ repo: process.cwd(), out: ledger, state: join(work, "demo-state"), month: "2026-11" });
  // clone の版（git の HEAD）を読めるよう、.git の形を置く（台帳を根拠にした周期の案は、橋渡しが根拠の版を今の版と照らす。Architect の 65）
  mkdirSync(join(ledger, ".git", "refs", "heads"), { recursive: true });
  writeFileSync(join(ledger, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(ledger, ".git", "refs", "heads", "main"), `${"c0ffee123456".padEnd(40, "0")}\n`);
  one = await startBuiltBridge("moyai-demo-a-");
  two = await startBuiltBridge("moyai-demo-b-");
});
test.afterAll(() => {
  one?.stop();
  two?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

async function settings(page: Page, base: string, root: string, name: string, ledgerRepo?: string) {
  await page.goto(`${base}/#/settings`);
  await page.getByTestId("root-change").click();
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-change").click();
  await page.getByTestId("name-input").fill(name);
  if (ledgerRepo) {
    await page.getByTestId("ledger-change").click();
    await page.getByTestId("ledger-input").fill(ledgerRepo);
  }
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("current-name")).toHaveText(name);
}

/** 動画の素材を撮るときは MOYAI_DEMO_VIDEO_DIR：Chrome の画面の流れ（CDP の screencast）を、時刻を名前にした JPEG で <dir>/<who>/ に置く。MP4 にするのは別の手順 */
async function record(page: Page, who: string) {
  const dir = process.env.MOYAI_DEMO_VIDEO_DIR;
  if (!dir) return;
  mkdirSync(join(dir, who), { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  cdp.on("Page.screencastFrame", (f) => {
    writeFileSync(join(dir, who, `${Math.round((f.metadata.timestamp ?? Date.now() / 1000) * 1000)}.jpg`), Buffer.from(f.data, "base64"));
    void cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
}

test("デモの通し：トップ → MERGE（取り込み・当てはめ・台帳の案・検査）→ 承認 → EXPORT → SHARE", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const root = join(work, "共有の保管先");
  const ringRoot = join(work, "輪のフォルダ");
  const pa = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  await record(pa, "a");
  const c = await mcpClient(one.stateDir, ["intake_survey", "intake_settle", "intake_compose", "crosswalk_propose", "peer_reference", "chart_propose"]);
  let link = "";
  try {
    await test.step("山田：設定で保管先・呼び名・台帳の clone。輪を作って鍵を作る", async () => {
      await settings(pa, one.base, root, A.name, ledger);
      await pa.getByTestId("ring-create-open").click();
      await pa.getByTestId("ring-folder").fill(ringRoot);
      await pa.getByTestId("ring-pack").selectOption("waste-incineration");
      await pa.getByTestId("ring-create-submit").click();
      await expect(pa.getByTestId("ring-created")).toBeVisible();
      await pa.keyboard.press("Escape");
    });

    await test.step("1 トップ：保管先にまだ施設が無い。「＋ 新しい施設」で MERGE の白紙へ", async () => {
      await pa.goto(`${one.base}/#/`);
      // 施設が無いときは「＋ 新しい施設」だけ（docs/screens.md 3.1）
      await expect(pa.getByTestId("moyai-new")).toBeVisible();
      await expect(pa.getByTestId("moyai-table")).toHaveCount(0);
      await pa.screenshot({ path: shot("demo-01-top-empty") });
      await pa.getByTestId("moyai-new").click();
      await expect(pa.getByTestId("drop")).toBeVisible();
    });

    await test.step("1 MERGE の資料のシート：パックと施設の名前を選び、資料を 3 つ落とす", async () => {
      await pa.getByTestId("pack").click();
      await pa.getByRole("option", { name: packName("waste-incineration"), exact: true }).click();
      await pa.getByTestId("facility-name").fill(FACILITY);
      const files = FICTIONAL_1.files.map((n) => ({ name: basename(n), b64: readFileSync(join(FICTIONAL_1.dir, n)).toString("base64") }));
      const dt = await pa.evaluateHandle((fs) => {
        const d = new DataTransfer();
        for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (x) => x.charCodeAt(0))], f.name));
        return d;
      }, files);
      await pa.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
      await expect(pa.getByTestId("dest-file")).toHaveCount(files.length, { timeout: 20_000 });
      await pa.screenshot({ path: shot("demo-02-files") });
    });

    await test.step("2 Claude：要約を読み、利用者がチャットで答えた既定の答えを置き、計画を作る", async () => {
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        await call(c, "intake_settle", {
          decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" })),
        });
      }
      expect((await call(c, "intake_compose")).started).toBe(true);
      let state = "running";
      for (let i = 0; i < 50 && state === "running"; i++) {
        state = (await call(c, "intake_survey", { part: "compose" })).compose.state;
        if (state === "running") await pa.waitForTimeout(200);
      }
      expect(state).toBe("done");
      await expect(pa.getByTestId("composed")).toContainText("AI が作りました");
      await pa.screenshot({ path: shot("demo-03-composed") });
    });

    await test.step("2 Claude：当てはめの規則の案を置く → 人が決定のシートで規則ごとに理由を書いて受ける", async () => {
      const version = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk.version;
      const { nodes, works } = f1Rules();
      const r = await call(c, "crosswalk_propose", { rules: [...nodes, ...works], basedOnVersion: version });
      expect(r.conflicts).toBe(0);
      await pa.getByTestId("sheet-decisions").click();
      await expect(pa.getByTestId("crosswalk-rule")).toHaveCount(nodes.length + works.length);
      await pa.screenshot({ path: shot("demo-04-crosswalk-proposed") });
      // 人：上の欄に理由を書いて、規則をまとめて受ける
      await pa.getByTestId("decisions-reason").fill(HUMAN);
      await pa.getByTestId("decisions-bulk-accept").click();
      await expect(pa.locator('[data-testid="crosswalk-rule"][data-state="proposed"]')).toHaveCount(0);
      await pa.screenshot({ path: shot("demo-05-crosswalk-accepted") });
    });

    await test.step("3 星取表：共通の設備項目 × 作業の属性の行", async () => {
      await pa.getByTestId("sheet-chart").click();
      await pa.getByTestId("rows-mode").getByText("共通台帳").click();
      await expect(pa.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
      await expect(pa.locator(".ag-row").first()).toBeVisible();
      await pa.screenshot({ path: shot("demo-06-chart-common") });
    });

    await test.step("3 突き合せ：資料をまたいで結んだ作業を、資料ごとの書き方で並べる（一致・片方だけ・食い違い）", async () => {
      await pa.getByTestId("sheet-match").click();
      await expect(pa.getByTestId("match-sheet")).toBeVisible();
      await pa.getByTestId("match-filter").getByText(/^全件 \d+$/).click();
      await expect(pa.getByTestId("match-row").first()).toBeVisible();
      await pa.screenshot({ path: shot("demo-06b-match") });
      await pa.getByTestId("sheet-chart").click();
    });

    let proposalId = "";
    let ledgerShown: any[] = [];
    let ledgerVersion: string | null = null;
    const usedPairs = new Set<string>();
    /** 台帳の帯の出た塊を順に試し、まだ使っていない塊で計画に当たった最初の 1 つを案にする（当たらなければ印は引かれない） */
    const proposeFromLedger = async (): Promise<string> => {
      for (const a of ledgerShown) {
        const pair = `${a.commonItem}|${a.work}`;
        if (usedPairs.has(pair)) continue;
        // 年数は中央の帯の下の数（中央の帯は四分位の帯の内にある。作業画面は四分位の帯の外の年数を断る。Architect の 52・65）
        const years = Number(/\d+/.exec(String(a.interval.median))?.[0] ?? "0");
        if (!(years >= 1) || !ledgerVersion) continue;
        const version = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk.version;
        // 根拠の文は人の言葉だけ（数と帯は MOYAI が照らして根拠の行に書く。Architect の 55）
        const basis = "公開の台帳の似た施設の間隔の中央の帯から";
        const rules = [{ when: [{ field: "assetNode.commonItem", op: "equals", values: [a.commonItem] }, { field: "work.attribute", op: "equals", values: [a.work] }], set: { field: "work.trigger", value: years }, reason: "似た施設の間隔の中央の帯から" }];
        const p = await call(c, "chart_propose", { rules, basedOnVersion: version, basis, ledger: { ledgerVersion, commonItem: a.commonItem, work: a.work } });
        usedPairs.add(pair);
        if (p.matched > 0) return p.proposals[0].id as string;
      }
      return "";
    };
    await test.step("3 Claude：人が比べを開かずに公開の台帳を読み、似た施設の間隔の帯から周期の案を置く", async () => {
      const r = await call(c, "peer_reference", { place: "ledger", answers: { facility: PROFILE, inNationalTable: true } });
      expect(r).toMatchObject({ mode: "ledger", reason: null });
      // 台帳を根拠にできるのは中央の帯（似た施設 5 以上）の塊だけ（橋渡しが照らす。Architect の 65）
      ledgerShown = r.aggregates.filter((a: any) => a.place === "ledger" && a.interval.shown === "median" && (a.interval.n ?? 0) >= 5);
      ledgerVersion = r.ledgerVersion ?? null;
      expect(ledgerShown.length, "台帳に帯の出た塊がある").toBeGreaterThan(0);
      proposalId = await proposeFromLedger();
      expect(proposalId, "計画に当たる台帳の案がある").not.toBe("");
      // 案は、自分の台帳の段の行で見る（共通の行では、ほかの機器の実施と同じセルにまとまる）
      await pa.getByTestId("rows-mode").getByText("施設台帳").click();
      await expect(pa.getByTestId("legend-proposal")).toBeVisible();
      const prop = pa.getByTestId("chart-grid").locator(".moyai-mark-proposal");
      if ((await prop.count()) === 0) {
        await pa.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => (el.scrollLeft = el.scrollWidth));
        await pa.waitForTimeout(300);
      }
      // 厚い計画では、案の行が表の下の方にある（表は見えている行だけを描く）。人がスクロールして探すように、下へ送る
      for (let i = 0; i < 120 && (await prop.count()) === 0; i++) {
        await pa.locator(".ag-grid-viewport").evaluate((el) => (el.scrollTop += el.clientHeight * 0.8), undefined, { timeout: 5000 });
        await pa.waitForTimeout(120);
      }
      await expect(prop.first()).toBeVisible();
      await pa.getByTestId("chart-grid").locator(".moyai-mark-proposal").first().click();
      await expect(pa.getByTestId("source-proposal")).toBeVisible();
      await pa.screenshot({ path: shot("demo-07-ledger-proposal") });
    });

    await test.step("3 決定のシート：台帳からの案が 1 行。人が理由を書いて受ける（ほかの決定も）", async () => {
      await pa.getByTestId("sheet-decisions").click();
      const row = pa.locator('[data-testid="pending-row"][data-kind="ledger"]');
      await expect(row).toHaveCount(1);
      await expect(row).toContainText(`周期の案 ${proposalId}`);
      await pa.screenshot({ path: shot("demo-08-decisions") });
      // 人：上の欄に理由を書いて、まとめて受ける
      await pa.getByTestId("decisions-reason").fill("試験の台本が押した（似た施設の帯と、チャットの答えを見て受けた）");
      // 一括確定は表示中の種類の行だけ（docs/screens.md 3.2）。種類ごとに、残りが無くなるまで押す
      const left = pa.locator('[data-testid="pending-row"][data-accepted="false"]');
      for (let i = 0; i < 6 && (await left.count()) > 0; i++) {
        await pa.getByTestId("decisions-bulk-accept").click();
        await pa.waitForTimeout(300);
      }
      await expect(left).toHaveCount(0);
      await pa.getByTestId("sheet-chart").click();
      await expect(pa.getByTestId("legend-proposal")).toHaveCount(0);
    });

    await test.step("4 検査のシート：自己点検。外れは朱の ×、満たすは ✓", async () => {
      await pa.getByTestId("sheet-check").click();
      // 「自己点検であって…」は画面に出さない（AI のツールの結果にだけ添える）
      await expect(pa.getByTestId("review-notice")).toHaveCount(0);
      await expect(pa.getByTestId("check-table")).toBeVisible();
      await pa.screenshot({ path: shot("demo-09-check"), fullPage: true });
    });

    await test.step("4 署名して承認を頼む：一言の理由・宛先 → 渡すメールの文（版の場所とハッシュだけ）", async () => {
      await pa.getByTestId("confirm-open").click();
      await pa.getByTestId("confirm-reason").fill("取り込みと当てはめ、台帳の周期の案を入れた第 1 版。承認をお願いします");
      await pa.getByTestId("ask-approve").check();
      await pa.getByTestId("ask-to").fill("kacho@example.jp");
      // ラジオの切り替えの動きが終わってから撮る
      await pa.waitForTimeout(400);
      await pa.screenshot({ path: shot("demo-10-sign") });
      await pa.getByTestId("confirm-submit").click();
      await expect(pa.getByTestId("confirm-done")).toHaveText(/^第 1 版に署名して、.+へのメールを用意しました。$/);
      const mail = (await pa.getByTestId("handoff-body").textContent()) ?? "";
      link = /http:\/\/[^\s]+#\/merge\?open=[^\s]+/.exec(mail)?.[0] ?? "";
      expect(link).toContain("&v=1&h=");
      await pa.screenshot({ path: shot("demo-11-mail") });
      await pa.keyboard.press("Escape");
      await pa.goto(`${one.base}/#/`);
      await expect(pa.getByTestId("moyai-state")).toHaveText("承認待ち");
      await pa.screenshot({ path: shot("demo-12-top-awaiting") });
    });

    await test.step("4 課長：別の MOYAI で同じ保管先。メールのリンクで開くと、署名と鎖を確かめてから見せる → 承認して署名する", async () => {
      const pb = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
      await record(pb, "b");
      await settings(pb, two.base, root, B.name);
      await pb.goto(link.replace(/^http:\/\/[^/]+/, two.base));
      await expect(pb.getByTestId("merge-version")).toHaveText("第 1 版");
      await pb.getByTestId("side-signatures").click();
      await pb.screenshot({ path: shot("demo-13-approver") });
      await pb.getByTestId("approve-open").click();
      await pb.getByTestId("sign-submit").click();
      await expect(pb.getByTestId("merge-turn")).toHaveAttribute("data-state", "editing");
      await pb.screenshot({ path: shot("demo-14-approved") });
      await pb.context().close();
    });

    await test.step("5 山田のトップ：承認された版は ●。「＋ 次の版」で、その版を MERGE で開く（署名と鎖を確かめてから）", async () => {
      await pa.reload();
      await expect(pa.getByTestId("moyai-mark")).toHaveText("●");
      await pa.screenshot({ path: shot("demo-15-top-approved") });
      await pa.getByTestId("moyai-next").click();
      await expect(pa.getByTestId("merge-version")).toHaveText("第 2 版");
      await expect(pa.getByTestId("merge-turn")).toHaveAttribute("data-state", "editing");
    });

    await test.step("5 EXPORT：確定した版の Excel を、人が落とす", async () => {
      await pa.goto(`${one.base}/#/export`);
      await expect(pa.getByTestId("export-excel")).toBeEnabled();
      const [download] = await Promise.all([pa.waitForEvent("download"), pa.getByTestId("export-excel").click()]);
      await download.saveAs(shot("demo-16-export").replace(/\.png$/, ".xlsx"));
      await pa.screenshot({ path: shot("demo-16-export") });
    });

    await test.step("5 SHARE：検問所で相手から見たあなたを確かめ、押して署名し、輪に置く → ✓", async () => {
      await pa.goto(`${one.base}/#/share`);
      await expect(pa.getByTestId("checkpoint-page")).toBeVisible();
      await pa.getByTestId("q-national").selectOption("yes");
      await pa.getByTestId("q-furnace").selectOption(PROFILE.furnace);
      await pa.getByTestId("q-capacity_t_per_day").selectOption(PROFILE.capacity_t_per_day);
      await pa.getByTestId("q-turbine").selectOption(PROFILE.turbine);
      await pa.getByTestId("q-ash").selectOption(PROFILE.ash);
      await pa.getByTestId("q-contract").selectOption(PROFILE.contract);
      await expect(pa.getByTestId("counts")).toHaveText("形 0｜固有名詞 0｜金額 0｜自由記述 0｜正確な日付 0");
      await pa.screenshot({ path: shot("demo-17-checkpoint"), fullPage: true });
      await pa.getByTestId("send").click();
      await expect(pa.getByTestId("sent")).toContainText("共有ファイルを共有フォルダに置きました");
      await expect(pa.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
      await pa.screenshot({ path: shot("demo-18-sent"), fullPage: true });
    });

    await test.step("保管先：版 1 に、山田の渡す署名と課長の承認の署名", async () => {
      const plans = readdirSync(join(root, "plans"));
      expect(plans).toHaveLength(1);
      const sigs = readdirSync(join(root, "plans", plans[0]!, "signatures")).map((n) => n.split("-")[1]).sort();
      expect(sigs).toEqual(["approve", "edit"]);
    });

    await test.step("6 版どうしの差：「＋ 次の版」で第 2 版をつくる。Claude が台帳から別の周期の案を置くと、第 1 版から変わった印が朱になる", async () => {
      await pa.goto(`${one.base}/#/`);
      await pa.getByTestId("moyai-next").click();
      await expect(pa.getByTestId("merge-version")).toHaveText("第 2 版");
      await expect(pa.getByTestId("merge-compare")).toContainText("元の版　第 1 版");
      expect(await proposeFromLedger(), "まだ使っていない台帳の塊で、計画に当たる案がある").not.toBe("");
      await pa.getByTestId("rows-mode").getByText("施設台帳").click();
      await expect(pa.getByTestId("legend-changed-from")).toBeVisible();
      const changed = pa.getByTestId("chart-grid").locator(".moyai-mark-vchg");
      if ((await changed.count()) === 0) {
        await pa.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => (el.scrollLeft = el.scrollWidth));
        await pa.waitForTimeout(300);
      }
      await expect(changed.first()).toBeVisible();
      await pa.screenshot({ path: shot("demo-19-version-diff") });
      // 人：まとめて受けて、第 2 版に自分で署名して確定する
      await pa.getByTestId("sheet-decisions").click();
      await pa.getByTestId("decisions-reason").fill("試験の台本が押した（似た施設の帯を見て、もう 1 つの周期の案も受けた）");
      const left2 = pa.locator('[data-testid="pending-row"][data-accepted="false"]');
      for (let i = 0; i < 6 && (i === 0 || (await left2.count()) > 0); i++) {
        await pa.getByTestId("decisions-bulk-accept").click();
        await pa.waitForTimeout(300);
      }
      await pa.getByTestId("confirm-open").click();
      await pa.getByTestId("ask-self").check();
      await pa.getByTestId("confirm-reason").fill("台帳の周期の案をもう 1 つ入れた第 2 版");
      await pa.getByTestId("confirm-submit").click();
      await expect(pa.getByTestId("confirm-done")).toContainText("第 2 版に署名しました");
      await pa.keyboard.press("Escape");
    });

    await test.step("6 古い版から次の版：トップで第 1 版の印のメニュー →「この版から次の版」。第 2 版から変わった所が朱になる", async () => {
      await pa.goto(`${one.base}/#/`);
      await expect(pa.getByTestId("moyai-mark")).toHaveCount(2);
      await pa.locator('[data-testid="moyai-mark"][data-version="1"]').click();
      await expect(pa.getByTestId("moyai-mark-menu")).toContainText("第 1 版");
      await pa.screenshot({ path: shot("demo-20-mark-menu") });
      await pa.getByTestId("mark-next").click();
      await expect(pa.getByTestId("merge-version")).toHaveText("第 3 版");
      await expect(pa.getByTestId("merge-compare")).toContainText("元の版　第 2 版");
      // 第 2 版で足した計画の印が、第 1 版の中身では無くなる。この工場の資料は最後の年度まで実施があるので、
      // 案の印は実施と同じセル（◎）に入り、第 1 版の中身では ● に戻る（＝第 2 版から変わった、朱）。
      // 印がまるごと無くなるセルなら、淡い破線の「第 2 版の印」で残る（tests/e2e/version-diff.spec.ts で確かめている）
      await pa.getByTestId("rows-mode").getByText("施設台帳").click();
      await expect(pa.getByTestId("legend-changed-from")).toContainText("第 2 版から変更");
      await pa.screenshot({ path: shot("demo-21-from-old") });
    });

    await test.step("7 似た施設を重ねる：見出しの「似た施設　重ねる」。共通の行の下に「似た施設　帯 …」の 1 行", async () => {
      await pa.getByTestId("merge-peers").getByRole("button", { name: "比較" }).click();
      await expect(pa.getByTestId("peer-panel")).toBeVisible();
      // 見え方の答えは施設の設定で（星取表の上では答えない）
      await pa.getByTestId("peer-fix").click();
      await pa.getByTestId("facility-national").selectOption("yes");
      await pa.getByTestId("facility-furnace").selectOption(PROFILE.furnace);
      await pa.getByTestId("facility-capacity_t_per_day").selectOption(PROFILE.capacity_t_per_day);
      await pa.getByTestId("facility-turbine").selectOption(PROFILE.turbine);
      await pa.getByTestId("facility-ash").selectOption(PROFILE.ash);
      await pa.getByTestId("facility-contract").selectOption(PROFILE.contract);
      await pa.getByTestId("facility-save").click();
      await expect(pa.locator(".ag-row.moyai-row-stat").first()).toBeVisible();
      await pa.screenshot({ path: shot("demo-22-peers") });
      await pa.getByTestId("merge-peers").getByRole("button", { name: "戻す" }).click();
      await expect(pa.locator(".ag-row.moyai-row-stat")).toHaveCount(0);
    });

    await test.step("8 コメント：星取表の行を選んで書くと、その行に ① が付き、横の板に並ぶ", async () => {
      await pa.getByTestId("rows-mode").getByText("施設台帳").click();
      await pa.locator('.ag-row [col-id="lv2"]').filter({ hasText: /\S/ }).first().click();
      await pa.getByTestId("side-comments").click();
      await pa.getByTestId("comment-text").fill("この機器の点検は、来年度の全休止に合わせられますか。");
      await pa.getByTestId("comment-add").click();
      await expect(pa.getByTestId("comment")).toHaveCount(1);
      await expect(pa.getByTestId("side-comments")).toHaveText("コメント 1");
      await pa.screenshot({ path: shot("demo-23-comment") });
    });

    await test.step("9 派生：トップで第 2 版の印のメニュー →「この版から別の施設をつくる」。第 1 版に署名すると、元の施設の下に線でつながる", async () => {
      await pa.goto(`${one.base}/#/`);
      await pa.locator('[data-testid="moyai-mark"][data-version="2"]').click();
      await pa.getByTestId("mark-derive").click();
      await pa.getByTestId("derive-name").fill("東山クリーンセンター");
      await pa.screenshot({ path: shot("demo-24-derive") });
      await pa.getByTestId("derive-submit").click();
      await expect(pa.getByTestId("plan-name")).toHaveText("【架空】東山クリーンセンター");
      await pa.getByTestId("sheet-decisions").click();
      // 決定のシートが版の履歴を読み終えて、行か「ありません」が出るまで待ってから数える（早く数えると 0 と数えて受けずに進む）
      await expect(pa.locator('[data-testid="pending-row"], [data-testid="decisions-none"]').first()).toBeVisible();
      const open = pa.locator('[data-testid="pending-row"][data-accepted="false"]');
      if ((await open.count()) > 0) {
        await pa.getByTestId("decisions-reason").fill("試験の台本が押した（元の施設で受けた決定を、派生した施設でも受けた）");
        // 一括確定は表示中の種類の行だけ。種類ごとに、残りが無くなるまで押す
        for (let i = 0; i < 6 && (await open.count()) > 0; i++) {
          await pa.getByTestId("decisions-bulk-accept").click();
          await pa.waitForTimeout(300);
        }
        await expect(open).toHaveCount(0);
      }
      await pa.getByTestId("confirm-open").click();
      await pa.getByTestId("ask-self").check();
      await pa.getByTestId("confirm-reason").fill("みどり台の第 2 版から作った、東山の第 1 版");
      await pa.getByTestId("confirm-submit").click();
      await expect(pa.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
      await pa.keyboard.press("Escape");
      await pa.goto(`${one.base}/#/`);
      await expect(pa.getByTestId("moyai-row")).toHaveCount(2);
      await expect(pa.getByTestId("moyai-branch")).toHaveCount(1);
      await pa.screenshot({ path: shot("demo-25-top-derived") });
    });

    await test.step("10 様式に写す：EXPORT で「別の様式を落とす」。見出しから列ごとに写すものが出て、「この様式で落とす」", async () => {
      // 架空の様式（題と見出し：設備名・作業区分・周期・R3〜R5・備考）を、別のプロセスの exceljs で作る
      const tpl = join(work, "長寿命化計画_様式3.xlsx");
      const cells: Record<string, string> = { A1: "【架空】長寿命化計画 様式 3" };
      ["設備名", "作業区分", "周期（年）", "R3", "R4", "R5", "備考"].forEach((h, i) => (cells[`${String.fromCharCode(65 + i)}3`] = h));
      const w = spawnSync(process.execPath, ["tests/helpers/xlsx-cli.mjs", "write", tpl, JSON.stringify({ sheet: "様式3", cells })], { encoding: "utf8" });
      expect(w.status, w.stderr).toBe(0);
      await pa.locator('[data-testid="moyai-row"]').first().getByTestId("moyai-next").click();
      await expect(pa.getByTestId("merge-version")).toBeVisible();
      await pa.goto(`${one.base}/#/export`);
      const chooser = pa.waitForEvent("filechooser");
      await pa.getByTestId("template-pick").click();
      await (await chooser).setFiles(tpl);
      await expect(pa.getByTestId("template-role")).toHaveCount(7);
      await pa.screenshot({ path: shot("demo-26-template") });
      // 様式で出すときは、列の写し方を承認して署名してから落とす（docs/screens.md 3.5。e2e の template.spec と同じ流れ）
      await pa.getByTestId("export-sign").click();
      await expect(pa.getByTestId("export-sign-dialog")).toContainText("で出力");
      await pa.getByTestId("export-sign-submit").click();
      await expect(pa.getByTestId("export-signed")).toBeVisible();
      await pa.screenshot({ path: shot("demo-26b-template-signed") });
      const [download] = await Promise.all([pa.waitForEvent("download"), pa.getByTestId("export-excel").click()]);
      await download.saveAs(shot("demo-26-template").replace(/\.png$/, ".xlsx"));
    });

    await test.step("11 SHARE の公開の台帳：誰からも見えるあなた・PR を出すアカウントの行・下の帯。GitHub にはまだつないでいない", async () => {
      await pa.goto(`${one.base}/#/share`);
      await expect(pa.getByTestId("checkpoint-page")).toBeVisible();
      await pa.getByTestId("share-dest").getByText("公開台帳").click();
      await pa.getByTestId("q-national").selectOption("yes");
      await pa.getByTestId("q-furnace").selectOption(PROFILE.furnace);
      await pa.getByTestId("q-capacity_t_per_day").selectOption(PROFILE.capacity_t_per_day);
      await pa.getByTestId("q-turbine").selectOption(PROFILE.turbine);
      await pa.getByTestId("q-ash").selectOption(PROFILE.ash);
      await pa.getByTestId("q-contract").selectOption(PROFILE.contract);
      await expect(pa.getByText("公開時の表示")).toBeVisible();
      await expect(pa.getByTestId("you-steps")).toContainText("全国の");
      await expect(pa.getByTestId("github-login")).toHaveText("未接続");
      await expect(pa.getByTestId("send")).toHaveText("署名して公開台帳へ送信");
      await expect(pa.getByTestId("send-reason")).toHaveText("理由：GitHub　未接続");
      await expect(pa.getByTestId("ledger-bottom")).toBeVisible();
      await pa.screenshot({ path: shot("demo-27-share-ledger") });
    });
  } finally {
    await c.close();
  }
});
