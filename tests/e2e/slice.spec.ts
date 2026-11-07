// 縦の 1 本を端から端まで（docs/plan.md §6.1 の 1 → 2 → 4 → 5 の輪まで）。この PC の Chrome と Edge で通す：
// 取り込み（人が資料を落とし、AI が MCP で intake_survey → intake_settle → intake_compose）
// → 当てはめ（AI が crosswalk_propose で規則の案を置き、試験の台本が人の代わりに画面で規則ごとに受ける・違う規則は断る）
// → 星取表（共通の設備項目 × 作業の属性の行と、未当てはめの行）→ 確定（人だけ）→ 検問所（k ≥ 5 の塊・数がすべて 0）
// → 人が押して署名し、輪に置く → 受け手と同じ関数で ✓、CLI の verify ring でも ✓。
// AI は本物の中継（dist/cli.js mcp）を MCP の SDK のクライアントでつなぐ。人の操作（受ける・確定・送る）は画面のボタンだけで、
// AI のツールには無い。先に npm run build を走らせておく。置き場所と輪は一時のフォルダに作り、この PC の Documents には書かない。
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { attr, f1Rules } from "../fixtures/crosswalk/rules";
import { acceptDecisions, acceptRules, callTool as call, chooseFirstSource, chooseRootAndCreateRing, mcpClient, openIntakeAndDrop, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】縦の一本（AI と人）";
const HUMAN = "試験の台本が押した（台帳の名前とパックの項目を見て合っている）";
const REJECT = "試験の台本が押した（送風機は分解整備と取替が混ざるので、まとめて取替にはしない）";

let bridge: StartedBridge;
let work = "";
const rings: string[] = [];
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-slice-");
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-slice-work-"));
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
  for (const r of rings) rmSync(r, { recursive: true, force: true });
});

test("取り込み → 当てはめ → 星取表 → 確定 → 検問所 → 署名 → 輪で検証", async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  // 輪のフォルダの道も固有名詞の照らす相手なので、乱数の文字（計画の語と偶然重なる）を入れない名前にする
  const ringRoot = join(tmpdir(), `moyai-e2e-slice-ring-${tag}-${Date.now()}`, "輪のフォルダ");
  rings.push(join(ringRoot, ".."));
  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "crosswalk_propose", "reading_rules_propose"]);
  try {
    await test.step("人：設定で置き場所を選び、輪を作って鍵を作る", async () => {
      await chooseRootAndCreateRing(page, bridge.base, root, ringRoot);
    });

    await test.step("人：資料を取り込みの画面に落とす", async () => {
      await openIntakeAndDrop(page, bridge.base, FACILITY);
    });

    await test.step("AI：要約を読み、利用者がチャットで答えた既定の答えを置き、計画を作る", async () => {
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
        if (state === "running") await page.waitForTimeout(100);
      }
      expect(state).toBe("done");
      // 知らせの箱は出さない（docs/screens.md 3.3）。つくったことと作った人は資料のシートの印で見る
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done");
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose-by", "ai");
      // 取り込んだばかりの計画は、どの当てはめも無い（決定のシートの当てはめの案の欄に、未当てはめの行に全部の記録と出る）
      await page.getByTestId("sheet-decisions").click();
      await expect(page.getByTestId("crosswalk-none")).toBeVisible();
    });

    let version = 0;
    await test.step("AI：当てはめの要約（パックの項目・欄ごとの多い値・版）と星取表の階層を読む。パックに無いコードは断られる", async () => {
      const s = await call(c, "intake_survey", { part: "crosswalk" });
      const cw = s.crosswalk;
      expect(cw.packId).toBe("waste-incineration");
      expect(cw.items.length).toBe(35); // 表Ⅱ-4 の機器（炉の型・溶融の有無で分かれるものも）
      expect(cw.attributes.map((a: any) => a.code)).toEqual(["INSPECT", "OVERHAUL", "REPLACE", "UPGRADE"]);
      expect(cw.fields.find((f: any) => f.field === "work.kind").top.length).toBeLessThanOrEqual(20);
      expect(cw.unmapped.records).toBeGreaterThan(100);
      const rows = await call(c, "chart_rows", { limit: 200 });
      expect(rows.version).toBe(cw.version);
      expect(rows.rows.some((r: any) => String(r.cells["階層"]).includes("計量機"))).toBe(true);
      version = cw.version;
      const bad: any = await c.callTool({
        name: "crosswalk_propose",
        arguments: { rules: [{ when: [{ field: "assetNode.name", op: "equals", values: ["計量機"] }], set: { field: "assetNode.commonItem", value: "WI.RECV.NOPE" }, reason: "パックに無い" }], basedOnVersion: version },
      });
      expect(bad.isError).toBe(true);
      expect(JSON.stringify(bad.content)).toContain("パックの一覧にありません");
      const notAttr: any = await c.callTool({
        name: "crosswalk_propose",
        arguments: { rules: [{ when: [{ field: "work.kind", op: "equals", values: ["x"] }], set: { field: "work.attribute", value: "REPAIR" }, reason: "4 つの外" }], basedOnVersion: version },
      });
      expect(notAttr.isError).toBe(true);
    });

    let wrongRule = "";
    let ruleCount = 0;
    await test.step("AI：規則で案を置く。返るのは数と行の参照だけで、画面に規則が並ぶ（どれも案）", async () => {
      const { nodes, works } = f1Rules();
      // 最後の 1 つは、AI がわざと粗く置いた規則（人が断る）
      const wrong = attr(
        [
          { field: "work.kind", op: "equals", values: [""] },
          { field: "assetNode.name", op: "in", values: ["押込送風機", "誘引通風機"] },
        ],
        "REPLACE",
        "取替の記録があるので、送風機の印は取替と見た",
      );
      const rules = [...nodes, ...works, wrong];
      ruleCount = rules.length;
      const r = await call(c, "crosswalk_propose", { rules, basedOnVersion: version });
      expect(r.rules).toHaveLength(rules.length);
      expect(r.conflicts).toBe(0);
      expect(r.matched).toBeGreaterThan(80);
      expect(r.unmappedNodes).toBe(0);
      // 星取表の印に点検と分解整備・取替が混ざる補機（44 行）は、利用者が答えられないので、名前の無い作業の属性を置かない
      expect(r.unmappedWorks).toBe(44);
      expect(r.version).toBe(version + 1);
      for (const e of r.examples) expect(e.rowRef).toMatch(/^[nw]:[a-z0-9-]+$/);
      wrongRule = r.rules[r.rules.length - 1].ruleId;
      // 当てはめの案は、MERGE の決定のシートに 1 規則 1 行で並ぶ
      await page.getByTestId("sheet-decisions").click();
      await expect(page.getByTestId("crosswalk-rule")).toHaveCount(rules.length);
      await expect(page.locator('[data-testid="crosswalk-rule"][data-state="proposed"]')).toHaveCount(rules.length);
      // 案は人が受けるまで決まらない：受けた当てはめは 0
      await expect(page.getByTestId("crosswalk-accepted")).toHaveAttribute("data-nodes", "0");
      await expect(page.getByTestId("crosswalk-accepted")).toHaveAttribute("data-works", "0");
      await page.screenshot({ path: shot(`slice-crosswalk-proposed-${tag}`), fullPage: true });
    });

    await test.step("人（試験の台本が押した）：画面で規則ごとに一言の理由を書いて受ける。粗い規則は確かめのダイアログを通して断る", async () => {
      // 理由が空なら押せない（理由の欄は上に 1 つ）
      await expect(page.getByTestId("crosswalk-accept").first()).toBeDisabled();
      await expect(page.getByTestId("crosswalk-reject").first()).toBeDisabled();
      expect(await acceptRules(page, HUMAN, { ruleId: wrongRule, reason: REJECT })).toBe(ruleCount);
      await expect(page.locator('[data-testid="crosswalk-rule"][data-state="proposed"]')).toHaveCount(0);
      // 未当てはめ：断った規則の作業（送風機の名前の無い作業 4）と、印の混ざる補機の作業（44）が残り、件数が出る
      const un = page.getByTestId("crosswalk-unmapped");
      await expect(un).toHaveAttribute("data-nodes", "0");
      await expect(un).toHaveAttribute("data-works", "48");
      expect(Number(await un.getAttribute("data-records"))).toBeGreaterThan(0);
      await expect(page.getByTestId("crosswalk-accepted")).toHaveAttribute("data-nodes", "217");
      await page.screenshot({ path: shot(`slice-crosswalk-accepted-${tag}`), fullPage: true });
      // AI からも、受けた・断ったが見える（変えることはできない）
      const s = await call(c, "intake_survey", { part: "crosswalk" });
      expect(s.crosswalk.proposals.filter((p: any) => p.state === "accepted")).toHaveLength(ruleCount - 1);
      expect(s.crosswalk.proposals.find((p: any) => p.ruleId === wrongRule).state).toBe("rejected");
      expect(s.crosswalk.unmapped.works).toBe(48);
    });

    let unmappedRecords = 0;
    await test.step("星取表：共通の設備項目 × 作業の属性の行に受けた当てはめが並び、未当てはめの行に件数", async () => {
      unmappedRecords = Number(await page.getByTestId("crosswalk-unmapped").getAttribute("data-records"));
      await page.getByTestId("sheet-chart").click();
      await expect(page.getByTestId("plan-name")).toHaveText(FACILITY);
      await page.getByTestId("rows-mode").getByText("共通台帳").click();
      await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
      await expect(page.locator(".ag-row").first()).toBeVisible();
      expect(Number(await page.getByTestId("chart-rows-count").getAttribute("data-total"))).toBeGreaterThan(30);
      await page.screenshot({ path: shot(`slice-chart-common-${tag}`) });
      // 未当てはめの行は最後。表の下まで送って見る（案のまま・断った・当てていない記録の数）
      await page.locator(".ag-grid-viewport").evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect(page.locator(".moyai-row-unmapped [col-id='lv1']")).toHaveText(`未紐付け（${unmappedRecords} 件）`);
      await page.screenshot({ path: shot(`slice-chart-common-unmapped-${tag}`) });
    });

    await test.step("確定（人だけ）：AI が置いた決定を決定のシートで理由つきで受け、一言の理由を書いて署名して確定する", async () => {
      // 当てはめは当てはめの欄で人が受けたので、残るのは AI がチャットの答えで置いた取り込みの決定だけ。
      // 1 つの決定は 1 行（質問の文 → 答え。件数はその答えで決まった行の数「n 行」、効く所。Wire、11-07）
      await page.getByTestId("sheet-decisions").click();
      await expect(page.locator('[data-testid="pending-row"]').first()).toBeVisible();
      await expect(page.getByTestId("pending-where").first()).toBeVisible();
      await expect(page.locator('[data-testid="pending-row"][data-decision-kind="reading"] [data-testid="pending-count"]').first()).toHaveText(/^[\d,]+ 行$/);
      await page.screenshot({ path: shot(`slice-decisions-${tag}`), fullPage: true });
      await acceptDecisions(page, "試験の台本が押した（チャットの答えを画面で受けた）");
      await page.getByTestId("confirm-open").click();
      await expect(page.getByTestId("diff-summary")).toBeVisible();
      // 署名のダイアログに保管先の生のパスは出さない
    await expect(page.getByTestId("confirm-root")).toHaveCount(0);
      await page.getByTestId("confirm-reason").fill("縦の 1 本：取り込みと当てはめを確定する（e2e）");
      // 署名：この PC にまだ鍵が無いので、鍵を作ってから署名する（合言葉は打たない）
      await signInDialog(page);
      await expect(page.getByTestId("confirm-submit")).toBeEnabled();
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 1 版）を確定しました。/);
      const plans = readdirSync(join(root, "plans"));
      expect(plans).toHaveLength(1);
      const versions = join(root, "plans", plans[0]!, "versions");
      expect(readdirSync(versions)).toEqual(["000001.json"]);
      // 確定した版に、人が受けた当てはめが残る（作者は AI のまま、根拠に人の理由）
      const rec = JSON.parse(readFileSync(join(versions, "000001.json"), "utf8"));
      const accepted = rec.plan.assets.filter((a: any) => a.commonItemAccepted);
      expect(accepted).toHaveLength(217);
      expect(accepted.every((a: any) => a.commonItemAuthor === "ai" && String(a.commonItemBasis).includes(HUMAN))).toBe(true);
      expect(rec.plan.works.filter((w: any) => w.attribute !== null && !w.attributeAccepted)).toEqual([]);
      // 属性の無い作業：断った規則の送風機 4 と、印の混ざる補機 44
      expect(rec.plan.works.filter((w: any) => w.attribute === null)).toHaveLength(48);
      // 確定すると、人が見る様式の Excel と差分レポートが版ごとに足される。撮った画面の隣に写して残す（Excel で開いて見るため）
      const planDir = join(root, "plans", plans[0]!);
      expect(readdirSync(join(planDir, "exports"))).toEqual(["000001-plan.xlsx"]);
      expect(readdirSync(join(planDir, "reports"))).toEqual(["000001-diff.xlsx"]);
      copyFileSync(join(planDir, "exports", "000001-plan.xlsx"), shot(`slice-export-${tag}`).replace(/\.png$/, ".xlsx"));
      copyFileSync(join(planDir, "reports", "000001-diff.xlsx"), shot(`slice-diff-${tag}`).replace(/\.png$/, ".xlsx"));
      await page.screenshot({ path: shot(`slice-confirmed-${tag}`) });
      await page.getByTestId("confirm-close").click();
      await page.getByTestId("tab-share").click();
    });

    await test.step("検問所：見え方を選ぶと、k ≥ 5 の段で塊が出て、数がすべて 0", async () => {
      await expect(page.getByTestId("checkpoint-page")).toBeVisible();
      await expect(page.getByTestId("send")).toBeDisabled();
      await page.getByTestId("q-national").selectOption("yes");
      await page.getByTestId("q-furnace").selectOption("STOKER");
      await page.getByTestId("q-capacity_t_per_day").selectOption("C100_200");
      await page.getByTestId("q-turbine").selectOption("YES");
      await page.getByTestId("q-ash").selectOption("OUT");
      await page.getByTestId("q-contract").selectOption("SINGLE");
      await expect(page.getByTestId("you-steps")).toContainText("全国の 844 施設のどれか");
      await expect(page.getByTestId("you-k")).not.toHaveAttribute("data-k", "");
      const k = Number(await page.getByTestId("you-k").getAttribute("data-k"));
      expect(k).toBeGreaterThanOrEqual(5);
      await expect(page.getByTestId("counts")).toHaveText("形 0｜固有名詞 0｜金額 0｜自由記述 0｜正確な日付 0");
      expect(await page.getByTestId("plain-chunk").count()).toBeGreaterThan(0);
      const body = (await page.getByTestId("body-text").textContent()) ?? "";
      expect(body).toContain('"v":"moyai.bundle/0"');
      expect(body).toContain('"work":"INSPECT"');
      expect(body).not.toMatch(/[^\x20-\x7e]/);
      await page.screenshot({ path: shot(`slice-checkpoint-${tag}`), fullPage: true });
    });

    await test.step("人が押して署名し、輪に置き、受け手と同じ関数で ✓。CLI の verify ring でも ✓", async () => {
      await page.getByTestId("send").click();
      await expect(page.getByTestId("sent")).toContainText("共有ファイルを共有フォルダに置きました");
      await expect(page.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
      await expect(page.locator('[data-testid="verify-line"][data-status="ng"]')).toHaveCount(0);
      await expect(page.locator('[data-testid="verify-line"][data-kind="bundle"][data-status="ok"]')).toHaveCount(1);
      await page.screenshot({ path: shot(`slice-sent-${tag}`), fullPage: true });
      const v = spawnSync(process.execPath, ["dist/cli.js", "verify", "ring", ringRoot], { env: { ...process.env, MOYAI_STATE_DIR: bridge.stateDir }, encoding: "utf8" });
      expect(v.status, v.stderr).toBe(0);
      expect(v.stderr).toContain("✓ 共有ファイル bundles/");
      expect(v.stderr).toContain("すべて ✓ です。");
    });

    await test.step("次の版（1C・重-2）：トップの「＋ 次の版」で第 1 版を組んだ資料と決定が戻り、作り直すと第 1 版の当てはめが「第 1 版と同じ」の案として並ぶ", async () => {
      // 版の記録に資料の SHA-256 が入り、資料は中身のアドレスに置かれている
      const plans = readdirSync(join(root, "plans"));
      const rec = JSON.parse(readFileSync(join(root, "plans", plans[0]!, "versions", "000001.json"), "utf8"));
      expect(rec.sources.map((x: { name: string }) => x.name).sort()).toEqual(["daily-report.csv", "equipment-ledger.xlsx", "plan-hoshitori.xlsx"]);
      expect(readdirSync(join(root, "plans", plans[0]!, "sources")).sort()).toEqual(rec.sources.map((x: { sha256: string }) => x.sha256).sort());
      expect(rec.crosswalk.length).toBeGreaterThan(0);
      await page.evaluate(() => (location.hash = "#/"));
      await page.getByTestId("moyai-next").first().click();
      // 第 1 版の資料と決定が戻るのを待つ。質問は戻した決定で残らない
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-restored-from", "1", { timeout: 60_000 });
      await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", "3");
      await chooseFirstSource(page);
      await expect(page.getByTestId("source-tab")).toBeVisible();
      // 戻した直後は第 1 版に入っていない変更が無いので、人の「| 資料を重ねて第 2 版をつくる」は出さない（docs/screens.md 3.3 の末尾「写しの照らし」）。
      // 作り直しは AI の intake_compose で
      await expect(page.getByTestId("compose")).toHaveCount(0);
      expect((await call(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 60_000 });
      await page.getByTestId("sheet-decisions").click();
      const kinds = page.getByTestId("decisions-kind");
      await expect(kinds).toContainText("第 1 版と同じ");
      await kinds.locator("button", { hasText: "第 1 版と同じ" }).click();
      // 黙って引き継がない：どの規則も案で、人が 1 回押すまで決まらない
      await expect(page.locator('[data-testid="crosswalk-rule"][data-same="1"][data-state="proposed"]').first()).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("decisions-reason")).toHaveValue("第 1 版で受けた当てはめと同じ");
      await page.screenshot({ path: shot(`slice-carry-${tag}`), fullPage: true });
      await expect(page.getByTestId("decisions-bulk-accept")).toContainText("第 1 版と同じ");
      await page.getByTestId("decisions-bulk-accept").click();
      await expect(page.locator('[data-testid="crosswalk-rule"][data-same="1"][data-state="proposed"]')).toHaveCount(0);
      // 写し（Wire の確かめ）：下書きの読み方を 2 つ置いた読み方のシート、資料のタブ、横の板をたたんだ星取表（共通の設備項目の 1 列の見出し）
      const base = { author: "ai", reason: "利用者が会話で決めた（試験の台本）" };
      await call(c, "reading_rules_propose", { name: "【架空】縦の一本の読み方", scope: "facility", rules: [{ ...base, id: "s1", text: "「ブロワー」と「ブロワ」は同じ機器", kind: "sameAsset", names: ["ブロワー", "ブロワ"] }] });
      await call(c, "reading_rules_propose", { name: "【架空】日報の書き方", scope: "facility", rules: [{ ...base, id: "m1", text: "▲ は実績", kind: "markMeaning", symbol: "▲", planOrActual: "actual" }] });
      // 案を置いた直後は描き直しが続くので、シートが切り替わるまで押し直す
      await expect(async () => {
        await page.getByTestId("sheet-readings").click();
        await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "readings", { timeout: 2000 });
      }).toPass({ timeout: 30_000 });
      await page.screenshot({ path: shot(`slice-readings-${tag}`), fullPage: true });
      await expect(async () => {
        // 資料の選びの一覧を開き（開いていれば開いたまま）、名前順の最初の資料を選ぶ
        if (!(await page.getByTestId("source-list").isVisible())) await page.getByTestId("source-picker").click();
        await page.locator('[data-testid="source-row"][data-state="ready"]').first().click({ timeout: 2000 });
        await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files", { timeout: 2000 });
      }).toPass({ timeout: 30_000 });
      await page.screenshot({ path: shot(`slice-files-${tag}`), fullPage: true });
      await page.getByTestId("sheet-chart").click();
      await expect(page.locator(".ag-row").first()).toBeVisible();
      // 横の板は既定でたたむ（Wire、11-06）。開いていれば（選んだ・未回答があった）たたむ
      if (await page.getByTestId("side-fold").isVisible()) await page.getByTestId("side-fold").click();
      await expect(page.getByTestId("merge-side-band")).toBeVisible();
      await page.getByTestId("rows-mode").getByText("共通台帳").click();
      await expect(page.getByTestId("chart-grid")).toHaveAttribute("data-mode", "common");
      await expect(page.locator(".ag-row").first()).toBeVisible();
      await page.screenshot({ path: shot(`slice-chart-folded-${tag}`), fullPage: true });
      // キー ］ で開き直す（覚えた開け閉めを次の試験に残さない）
      await page.keyboard.press("]");
      await expect(page.getByTestId("merge-side")).toBeVisible();
    });

    await test.step("同じタブで第 2 版を確定して作り直すと、案は「第 2 版と同じ」になる（台帳の新-9）", async () => {
      // 写しのために読み方の下書きを置いたので、作り直すまで署名できない（台帳の中-6）。作り直してから受ける
      await chooseFirstSource(page);
      await expect(page.getByTestId("compose")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("compose").click();
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 60_000 });
      await acceptDecisions(page, "試験の台本が押した（第 2 版の決定を受けた）");
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("縦の 1 本：第 1 版の資料と当てはめを重ねた第 2 版（e2e）");
      await expect(page.getByTestId("confirm-submit")).toBeEnabled();
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 2 版）を確定しました。/);
      await page.getByTestId("confirm-close").click();
      await chooseFirstSource(page);
      await expect(page.getByTestId("source-tab")).toBeVisible();
      // 確定した直後は第 2 版に入っていない変更が無いので、人のボタンは出さない。作り直しは AI の intake_compose で
      await expect(page.getByTestId("compose")).toHaveCount(0);
      expect((await call(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 60_000 });
      await page.getByTestId("sheet-decisions").click();
      await expect(page.getByTestId("decisions-kind")).toContainText("第 2 版と同じ", { timeout: 60_000 });
      await expect(page.getByTestId("decisions-kind")).not.toContainText("第 1 版と同じ");
    });

    await test.step("古い版の署名と適用 Skill、ルールの詳細の適用先（docs/screens.md 3.2、Wire、11-07 夜。仕事 lineage-screens-v1）", async () => {
      // 第 2 版はルールの下書き 2 つを載せて確定した。第 3 版を確定して、第 2 版を古い版にする
      await expect(page.getByTestId("decisions-bulk-accept")).toContainText("第 2 版と同じ");
      await page.getByTestId("decisions-bulk-accept").click();
      await expect(page.locator('[data-testid="crosswalk-rule"][data-same="1"][data-state="proposed"]')).toHaveCount(0);
      await acceptDecisions(page, "試験の台本が押した（第 3 版の決定を受けた）");
      await expect(page.getByTestId("confirm-open")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("confirm-open").click();
      await page.getByTestId("confirm-reason").fill("第 2 版を古い版にする第 3 版（e2e）");
      await expect(page.getByTestId("confirm-submit")).toBeEnabled();
      await page.getByTestId("confirm-submit").click();
      await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 3 版）を確定しました。/);
      await page.getByTestId("confirm-close").click();
      // トップの版の印のメニューで第 2 版を「開く」（見るだけ）
      await page.goto(`${bridge.base}/#/`);
      await page.locator('[data-testid="moyai-mark"][data-version="2"]').click();
      await page.getByTestId("mark-open").click();
      await expect(page.getByTestId("merge-state")).toHaveText("古い版（見るだけ）");
      // 横の板の「署名 n」は第 2 版の署名（いちばん新しい第 3 版のものは出さない）と、第 2 版をつくったときの適用 Skill
      if (await page.getByTestId("side-band-signatures").isVisible()) await page.getByTestId("side-band-signatures").click();
      else await page.getByTestId("side-signatures").click();
      const panel = page.getByTestId("signatures-panel");
      await expect(panel).toHaveAttribute("data-old", "true");
      await expect(panel).toHaveAttribute("data-version", "2");
      await expect(page.getByTestId("signatures-version")).toHaveText(/令和 \d+ 年度版（第 2 版）/);
      await expect(panel).toContainText("適用 Skill");
      const rules = panel.locator('[data-testid="applied-skill"][data-tier="rule"]');
      await expect(rules.first()).toBeVisible();
      expect(await rules.count()).toBeGreaterThan(0);
      await page.screenshot({ path: shot(`lineage-signatures-${tag}`) });
      // ルールの行を押すと、ルールのシートでそのルールを選んで開く。古い版のルールのシートは見るだけ（切り替えを出さない）
      await rules.first().click();
      await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "readings");
      await expect(page.getByTestId("readings-sheet")).toHaveAttribute("data-old", "true");
      await expect(page.getByTestId("readings-filter")).toHaveCount(0);
      await expect(page.getByTestId("reading-skill-status").first()).toHaveText("第 2 版で適用");
      // 詳細にルールの来歴：適用先（MOYAI が読める版だけ、新しい順。第 2 版と第 3 版）と「| 開く」、ルールの版ごとの行
      const lineage = page.getByTestId("rule-lineage");
      await expect(lineage).toBeVisible();
      await expect(page.getByTestId("rule-applied-count")).toHaveAttribute("data-count", /^[1-9]\d*$/);
      const versions = await lineage.getByTestId("rule-applied").evaluateAll((els) => els.map((e) => Number(e.getAttribute("data-version"))));
      expect(versions).toEqual([...versions].sort((a, b) => b - a));
      await expect(lineage.getByTestId("rule-applied-open").first()).toBeVisible();
      await expect(lineage.getByTestId("rule-version").first()).toBeVisible();
      await page.screenshot({ path: shot(`lineage-rule-detail-${tag}`) });
    });
  } finally {
    await c.close();
  }
});
