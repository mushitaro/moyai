// デモの通し（運営者に見せる台本。docs/plan.md §6.1・docs/screens.md 3）：新しい画面の段 MOYAI › MERGE › EXPORT › SHARE を、端から端まで 1 本で流す。
// 山田（1 人目）と課長（2 人目）は、状態フォルダも鍵も別の 2 つの MOYAI で、保管先は同じ。Claude の役は試験の台本が MCP の SDK で代わる（本物の Claude の会話ではない）。
// 人の操作（受ける・署名する・承認する・落とす・送る）は画面のボタンだけで、試験の台本が人の代わりに押す。
//   1 トップ（施設が無い）→「＋ 新しい施設」→ MERGE の資料のシートに資料を落とす
//   2 Claude が取り込みを最後まで動かす（質問に既定の答え・計画を作る）→ 当てはめの規則の案 → 人が規則ごとに受ける
//   3 星取表（共通の設備項目 × 作業の属性）→ Claude が公開の台帳を読み、周期の案（朱の破線の円）→ 人が決定のシートで受ける
//   4 検査のシート → 署名して承認を頼み、渡すメールの文 → 課長がリンクで開き、承認して署名する
//   5 トップに ● →「＋ 次の版」で開く → EXPORT で Excel を落とす → SHARE の検問所 → 合言葉で署名して輪に置き、✓
// 使い方：npm run build のあと、MOYAI_SHOTS_DIR=docs/progress/shots/<日付>/demo npx playwright test -c playwright.demo.config.ts tests/demo/walkthrough.spec.ts
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { f1Rules } from "../fixtures/crosswalk/rules";
import { FICTIONAL_1, callTool as call, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】みどり台クリーンセンター";
const A = { name: "【架空】山田", pass: "架空の合言葉 山田の鍵 デモ" };
const B = { name: "【架空】課長", pass: "架空の合言葉 課長の鍵 デモ" };
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
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-input").fill(name);
  if (ledgerRepo) await page.getByTestId("ledger-input").fill(ledgerRepo);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("current-name")).toHaveText(name);
}

test("デモの通し：トップ → MERGE（取り込み・当てはめ・台帳の案・検査）→ 承認 → EXPORT → SHARE", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const root = join(work, "共有の保管先");
  const ringRoot = join(work, "輪のフォルダ");
  const pa = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
  const c = await mcpClient(one.stateDir, ["intake_survey", "intake_settle", "intake_compose", "crosswalk_propose", "peer_reference", "chart_propose"]);
  let link = "";
  try {
    await test.step("山田：設定で保管先・呼び名・台帳の clone。輪を作って鍵を合言葉で包む", async () => {
      await settings(pa, one.base, root, A.name, ledger);
      await pa.getByTestId("ring-create-open").click();
      await pa.getByTestId("ring-folder").fill(ringRoot);
      await pa.getByTestId("ring-pack").selectOption("waste-incineration");
      await pa.getByTestId("ring-pass").fill(A.pass);
      await pa.getByTestId("ring-pass2").fill(A.pass);
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
      await pa.getByRole("option", { name: /^waste-incineration/ }).click();
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
      await pa.getByTestId("rows-mode").getByText("共通の設備項目 × 作業の属性").click();
      await expect(pa.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
      await expect(pa.locator(".ag-row").first()).toBeVisible();
      await pa.screenshot({ path: shot("demo-06-chart-common") });
    });

    let proposalId = "";
    await test.step("3 Claude：人が比べを開かずに公開の台帳を読み、似た施設の間隔の帯から周期の案を置く", async () => {
      const r = await call(c, "peer_reference", { place: "ledger", answers: { facility: PROFILE, inNationalTable: true } });
      expect(r).toMatchObject({ mode: "ledger", reason: null });
      // 帯の出た塊を順に試し、計画に当たった最初の 1 つを案にする（当たらなければ印は引かれない）
      const shown = r.aggregates.filter((a: any) => a.interval.shown === "median" || a.interval.shown === "range");
      expect(shown.length, "台帳に帯の出た塊がある").toBeGreaterThan(0);
      for (const a of shown) {
        const band = a.interval.shown === "median" ? a.interval.median : a.interval.range;
        const years = Number(/\d+/.exec(String(band))?.[0] ?? "0");
        if (!(years >= 1)) continue;
        const version = (await call(c, "intake_survey", { part: "crosswalk" })).crosswalk.version;
        const basis = `公開の台帳${r.ledgerVersion ? `（版 ${r.ledgerVersion}）` : ""}・似た施設 ${a.interval.n} の間隔の帯 ${band}`;
        const rules = [{ when: [{ field: "assetNode.commonItem", op: "equals", values: [a.commonItem] }, { field: "work.attribute", op: "equals", values: [a.work] }], set: { field: "work.trigger", value: years }, reason: "似た施設の間隔の帯から" }];
        const p = await call(c, "chart_propose", { rules, basedOnVersion: version, basis });
        if (p.matched > 0) {
          proposalId = p.proposals[0].id;
          break;
        }
      }
      expect(proposalId, "計画に当たる台帳の案がある").not.toBe("");
      // 案は、自分の台帳の段の行で見る（共通の行では、ほかの機器の実施と同じセルにまとまる）
      await pa.getByTestId("rows-mode").getByText("自分の台帳の段").click();
      await expect(pa.getByTestId("legend-proposal")).toBeVisible();
      const prop = pa.getByTestId("chart-grid").locator(".moyai-mark-proposal");
      if ((await prop.count()) === 0) {
        await pa.locator(".ag-body-horizontal-scroll-viewport").evaluate((el) => (el.scrollLeft = el.scrollWidth));
        await pa.waitForTimeout(300);
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
      await pa.getByTestId("decisions-bulk-accept").click();
      await expect(pa.locator('[data-testid="pending-row"][data-accepted="false"]')).toHaveCount(0);
      await pa.getByTestId("sheet-chart").click();
      await expect(pa.getByTestId("legend-proposal")).toHaveCount(0);
    });

    await test.step("4 検査のシート：自己点検。外れは朱の ×、満たすは ✓", async () => {
      await pa.getByTestId("sheet-check").click();
      await expect(pa.getByTestId("review-notice")).toContainText("自己点検であって、審査の判断ではない");
      await expect(pa.getByTestId("check").first()).toBeVisible();
      await pa.screenshot({ path: shot("demo-09-check"), fullPage: true });
    });

    await test.step("4 署名して承認を頼む：一言の理由・宛先・合言葉 → 渡すメールの文（版の場所とハッシュだけ）", async () => {
      await pa.getByTestId("confirm-open").click();
      await pa.getByTestId("confirm-reason").fill("取り込みと当てはめ、台帳の周期の案を入れた第 1 版。承認をお願いします");
      await pa.getByTestId("ask-approve").check();
      await pa.getByTestId("sign-passphrase").fill(A.pass);
      await pa.getByTestId("sign-passphrase-again").fill(A.pass);
      await pa.getByTestId("ask-to").fill("kacho@example.jp");
      // ラジオの切り替えの動きが終わってから撮る
      await pa.waitForTimeout(400);
      await pa.screenshot({ path: shot("demo-10-sign") });
      await pa.getByTestId("confirm-submit").click();
      await expect(pa.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
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
      await settings(pb, two.base, root, B.name);
      await pb.goto(link.replace(/^http:\/\/[^/]+/, two.base));
      await expect(pb.getByTestId("merge-version")).toHaveText("第 1 版");
      await pb.getByTestId("side-signatures").click();
      await pb.screenshot({ path: shot("demo-13-approver") });
      await pb.getByTestId("approve-open").click();
      await pb.getByTestId("sign-dialog-passphrase").fill(B.pass);
      await pb.getByTestId("sign-dialog-passphrase-again").fill(B.pass);
      await pb.getByTestId("sign-submit").click();
      await expect(pb.getByTestId("merge-turn")).toHaveAttribute("data-state", "approved");
      await pb.screenshot({ path: shot("demo-14-approved") });
      await pb.context().close();
    });

    await test.step("5 山田のトップ：承認された版は ●。「＋ 次の版」で、その版を MERGE で開く（署名と鎖を確かめてから）", async () => {
      await pa.reload();
      await expect(pa.getByTestId("moyai-mark")).toHaveText("●");
      await pa.screenshot({ path: shot("demo-15-top-approved") });
      await pa.getByTestId("moyai-next").click();
      await expect(pa.getByTestId("merge-version")).toHaveText("第 2 版");
      await expect(pa.getByTestId("merge-turn")).toHaveAttribute("data-state", "approved");
    });

    await test.step("5 EXPORT：確定した版の Excel を、人が落とす", async () => {
      await pa.goto(`${one.base}/#/export`);
      await expect(pa.getByTestId("export-excel")).toBeEnabled();
      const [download] = await Promise.all([pa.waitForEvent("download"), pa.getByTestId("export-excel").click()]);
      await download.saveAs(shot("demo-16-export").replace(/\.png$/, ".xlsx"));
      await pa.screenshot({ path: shot("demo-16-export") });
    });

    await test.step("5 SHARE：検問所で相手から見たあなたを確かめ、合言葉で署名して輪に置く → ✓", async () => {
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
      await pa.getByTestId("passphrase").fill(A.pass);
      await pa.getByTestId("send").click();
      await expect(pa.getByTestId("sent")).toContainText("束を輪に置きました");
      await expect(pa.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
      await pa.screenshot({ path: shot("demo-18-sent"), fullPage: true });
    });

    await test.step("保管先：版 1 に、山田の渡す署名と課長の承認の署名", async () => {
      const plans = readdirSync(join(root, "plans"));
      expect(plans).toHaveLength(1);
      const sigs = readdirSync(join(root, "plans", plans[0]!, "signatures")).map((n) => n.split("-")[1]).sort();
      expect(sigs).toEqual(["approve", "edit"]);
    });
  } finally {
    await c.close();
  }
});
