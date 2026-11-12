// 施設ごとの作業中（mushitaro/moyai#82）：資料を入れ、答え、星取表を作り、確定のシートに未確定が残ったままタブを閉じる →
// 開き直すと MOYAI のトップに「作業中　未確定 n」が出て、「続きから開く」で資料ごと戻る。保存のボタンは押さない（無い）。
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { basename } from "node:path";
import { type Page } from "@playwright/test";
import { FICTIONAL_1, callTool, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

/** 資料のシートを開き、施設の名前を入れ、資料を受け口に落とす（Skillパックは選ばない。#67 で画面から外した） */
async function dropFiles(page: Page, base: string, facilityName: string): Promise<void> {
  await page.goto(`${base}/#/intake`);
  await expect(page.getByTestId("intake-page")).toBeVisible();
  await page.getByTestId("facility-name").fill(facilityName);
  const files = FICTIONAL_1.files.map((name) => ({ name: basename(name), b64: readFileSync(join(FICTIONAL_1.dir, name)).toString("base64") }));
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    return d;
  }, files);
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", String(FICTIONAL_1.files.length), { timeout: 20_000 });
}

/** 【架空】の写真（日常点検表） */
const PHOTO = "samples/waste-incineration/shirakabano/files/【架空】しらかば野CC_日常点検表_ボイラ・タービン_20250602.jpg";

let bridge: StartedBridge;
let work = "";
test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-work-"));
  bridge = await startBuiltBridge("moyai-e2e-work-state-");
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
});

/** 保管先の作業中（試験のための一時の置き場所。状態フォルダではない） */
function savedWork(root: string): { open: number; files: unknown[]; plan: unknown } | null {
  const plans = join(root, "plans");
  if (!existsSync(plans)) return null;
  for (const id of readdirSync(plans)) {
    const f = join(plans, id, "work", "state.json");
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  return null;
}

test("作業中のまま閉じても、トップの「作業中　未確定 n」から資料ごと戻る", async ({ page, context }, info) => {
  const tag = info.project.name;
  test.setTimeout(300_000);
  const root = join(work, tag, "置き場所");

  await test.step("人：保管先を決める", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("root-change").click();
    await page.getByTestId("root-input").fill(root);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("settings-save")).toBeDisabled();
  });

  await test.step("資料を落とし、質問に答えて、星取表を作る（確定はしない）", async () => {
    await dropFiles(page, bridge.base, "【架空】第一清掃工場（作業中）");
    // 計画を作る前でも、資料は保管先の作業中に残る
    await expect.poll(() => savedWork(root)?.files.length ?? 0, { timeout: 20_000 }).toBe(FICTIONAL_1.files.length);
    // 既定の答えのある質問は Claude が置く（作者は ai。確定のシートで人が受けるまで未確定）。既定の無い質問は人が画面で答える
    const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose"]);
    try {
      for (let i = 0; i < 60; i++) {
        const q = await callTool(c, "intake_survey", { part: "questions" });
        if (!q.questions.length) break;
        const withDefault = q.questions.filter((x: any) => x.defaultAnswer !== null);
        if (withDefault.length) {
          await callTool(c, "intake_settle", { decisions: withDefault.map((x: any) => ({ questionId: x.questionId, answer: x.defaultAnswer, author: "ai", reason: "既定の答えを置いた（試験の台本）" })) });
          continue;
        }
        const first = page.getByTestId("question").first();
        await first.scrollIntoViewIfNeeded();
        await first.getByRole("radio").first().check();
        await first.getByTestId("answer").click();
        await expect(page.getByTestId("intake-page")).not.toHaveAttribute("data-busy", "true");
      }
      expect((await callTool(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 60_000 });
    } finally {
      await c.close();
    }
    await expect.poll(() => (savedWork(root)?.plan ? savedWork(root)!.open : -1), { timeout: 60_000 }).toBeGreaterThan(0);
  });

  await test.step("写真も入れる（作業中に写す。読み取りの格子は写さない）", async () => {
    const dt = await page.evaluateHandle((f) => {
      const d = new DataTransfer();
      d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: "image/jpeg" }));
      return d;
    }, { name: basename(PHOTO), b64: readFileSync(PHOTO).toString("base64") });
    // 星取表を作ったあとは HOSHITORI（画面に落とす）
    await expect(page.getByTestId("merge-page")).toBeVisible();
    await page.getByTestId("merge-page").dispatchEvent("drop", { dataTransfer: dt });
    await expect.poll(() => savedWork(root)?.files.length ?? 0, { timeout: 20_000 }).toBe(FICTIONAL_1.files.length + 1);
  });

  const open = savedWork(root)!.open;
  await test.step("タブを閉じ、開き直すと、トップに「作業中　未確定 n」", async () => {
    await page.close();
    const again = await context.newPage();
    await again.goto(`${bridge.base}/#/`);
    const label = again.getByTestId("moyai-work");
    await expect(label).toHaveText(`作業中　未確定 ${open}`, { timeout: 20_000 });
    await again.screenshot({ path: shot(`work-top-${tag}`) });
    await label.click();
    await expect(again.getByTestId("moyai-work-menu")).toBeVisible();
    await again.getByTestId("work-resume").click();
    await expect(again.getByTestId("merge-page")).toBeVisible();
    // 資料ごと戻る（資料の数）と、作業中の計画（施設の名前）
    await expect(again.getByTestId("source-picker")).toHaveAttribute("data-count", String(FICTIONAL_1.files.length), { timeout: 30_000 });
    await expect(again.getByTestId("plan-name")).toContainText("第一清掃工場（作業中）");
    await again.screenshot({ path: shot(`work-resumed-${tag}`) });
    // 写真も資料として戻る。読み取りの格子は戻らないので、今の未読の写真と同じ状態
    await again.goto(`${bridge.base}/#/intake`);
    await expect(again.getByTestId("photo-item")).toHaveCount(1, { timeout: 20_000 });
    await expect(again.getByTestId("photo-item")).toHaveAttribute("data-state", "unread");
    await expect(again.getByTestId("photo-item")).toHaveAttribute("data-photo", basename(PHOTO));

    // 消すのは人だけ：トップの「作業中」→「作業中を消す」。保管先の作業中が無くなり、行も消える（署名した版は無いので）
    await again.goto(`${bridge.base}/#/`);
    await again.getByTestId("moyai-work").click();
    await again.getByTestId("work-discard").click();
    await expect(again.getByTestId("moyai-work")).toHaveCount(0);
    expect(savedWork(root)).toBeNull();
  });
});
