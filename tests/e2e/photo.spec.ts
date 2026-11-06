// 端から端まで（写真。docs/plan.md §2.3・§2.12・§2.13）：ビルドした橋渡し（dist/cli.js start）と、この PC の Chrome・Edge の作業画面のタブと、
// 本物の中継（dist/cli.js mcp。標準入出力の MCP）を、MCP のクライアントでつなぐ。
// 人が工場の資料と写真を画面に落とす → 許す前は AI が受け取れない → 人が［AI クライアントに渡して読む］で許す（試験の台本が押した）
// → AI が receive で画像（MCP の画像の中身）を 1 枚受け取る → AI が読んだ格子を place で置く → 画面に「要確認」→ 要確認のうちは計画を作らない
// → 人が画像と並べて一言の理由で確かめる（試験の台本が押した）→ 計画を作れる。
// この試験では AI が画像を読まない：place の格子は、試験が正解（photos.truth.json）から書いたもので AI の代わりをする（tests/helpers/photo.ts）。
// 画像を本当に読む AI クライアント（Claude Code・Claude Desktop）は、この試験では確かめていない。先に npm run build を走らせておく。
import { expect, test } from "@playwright/test";
import { FICTIONAL_1, callTool as call, mcpClient, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { PHOTO_FILE, PHOTO_NAME, jpegSize, truthReading } from "../helpers/photo";

let bridge: StartedBridge;
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-photo-");
});
test.afterAll(() => bridge?.stop());

const SCRIPT = "試験の台本が押した";

test("写真：人が許した 1 枚だけを AI が受け取り、読んだ格子は人が確かめるまで要確認で、確かめると計画を作れる", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const c = await mcpClient(bridge.stateDir, ["photo_transcribe", "intake_survey", "intake_settle", "intake_compose"]);
  const photo = page.locator(`[data-testid="photo-item"][data-photo="${PHOTO_NAME}"]`);
  try {
    await test.step("人が工場の資料と写真を画面に落とす（写真は読まずに並ぶ）", async () => {
      await openIntakeAndDrop(page, bridge.base, "【架空】第一清掃工場（写真）", { dir: FICTIONAL_1.dir, files: [...FICTIONAL_1.files, PHOTO_FILE] });
      await expect(photo).toHaveAttribute("data-state", "unread");
      await expect(page.getByTestId("compose-disabled-reason")).toContainText("読んでいない写真 1");
    });

    await test.step("許す前は、AI は写真を受け取れない（画像は渡らない）", async () => {
      const r: any = await c.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
      expect(r.isError).toBe(true);
      expect(r.content).toHaveLength(1);
      expect(r.content[0].type).toBe("text");
      expect(r.content[0].text).toContain("許していません");
    });

    let size = { width: 0, height: 0 };
    await test.step(`人が［AI クライアントに渡して読む］を押し、渡す画像を見て許す（${SCRIPT}）`, async () => {
      await photo.getByTestId("photo-allow").click();
      await expect(page.getByTestId("photo-allow-preview")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByTestId("photo-allow-shape")).toContainText("JPEG");
      await page.screenshot({ path: shot(`photo-allow-${tag}`) });
      await page.getByTestId("photo-allow-submit").click();
      await expect(photo).toHaveAttribute("data-state", "allowed");
      await expect(photo.getByTestId("photo-allowed")).toBeVisible();
    });

    await test.step("AI が receive で画像を 1 枚受け取る（MCP の画像の中身。長辺 1,568〜2,000 px・100 KB 以下の JPEG）。許しは 1 回で使い終わる", async () => {
      const r: any = await c.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
      expect(r.isError, JSON.stringify(r.content?.[0])).toBeFalsy();
      expect(r.content).toHaveLength(2);
      expect(r.content[1].type).toBe("image");
      expect(r.content[1].mimeType).toBe("image/jpeg");
      const bytes = new Uint8Array(Buffer.from(r.content[1].data, "base64"));
      const got = jpegSize(bytes);
      expect(got).not.toBeNull();
      size = got!;
      const long = Math.max(size.width, size.height);
      expect(long).toBeGreaterThanOrEqual(1568);
      expect(long).toBeLessThanOrEqual(2000);
      expect(bytes.length).toBeLessThanOrEqual(100 * 1024);
      expect(r.structuredContent).toMatchObject({ mode: "receive", imageRef: PHOTO_NAME, needsReview: true, image: { width: size.width, height: size.height, bytes: bytes.length } });
      console.log(`[${tag}] AI に渡した画像：${size.width} × ${size.height} 画素・${bytes.length} バイト（元は 1800 × 655 画素・96,496 バイト）`);
      await expect(photo).toHaveAttribute("data-state", "sent");
      const again: any = await c.callTool({ name: "photo_transcribe", arguments: { mode: "receive" } });
      expect(again.isError).toBe(true);
      expect(again.content[0].text).toContain("許していません");
    });

    await test.step("型から外れた格子・画像の外の位置は、直さずに断られ、何も置かれない", async () => {
      const bad: any = await c.callTool({
        name: "photo_transcribe",
        arguments: { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [{ row: 0, col: 0, text: "x", box: { x: 0, y: 0, w: 1, h: 1 }, confidence: 2 }] } },
      });
      expect(bad.isError).toBe(true);
      const outside: any = await c.callTool({
        name: "photo_transcribe",
        arguments: { mode: "place", grid: { imageRef: PHOTO_NAME, cells: [{ row: 0, col: 0, text: "x", box: { x: size.width - 1, y: 0, w: 10, h: 10 }, confidence: 1 }] } },
      });
      expect(outside.isError).toBe(true);
      expect(outside.content[0].text).toContain("画像の外");
      await expect(photo).toHaveAttribute("data-state", "sent");
    });

    let cells = 0;
    await test.step("AI が読んだ格子を置く（ここでは試験が正解から書いた格子で AI の代わりをする）", async () => {
      const grid = truthReading(size);
      cells = grid.cells.length;
      const r = await call(c, "photo_transcribe", { mode: "place", grid });
      expect(r).toMatchObject({ mode: "place", imageRef: PHOTO_NAME, placedCells: cells, needsReview: true, image: null });
      await expect(photo).toHaveAttribute("data-state", "read");
      await expect(photo.getByTestId("photo-review-count")).toContainText("要確認");
      await expect(photo.getByTestId("photo-box")).toHaveCount(cells);
      // 表のセルを押すと、画像の上のその位置の枠が選ばれる
      await photo.getByTestId("photo-cell").filter({ hasText: "ストーカ（STK-1）" }).click();
      await expect(photo.locator('[data-testid="photo-box"][data-sel="true"]')).toHaveCount(1);
      await expect(photo.getByTestId("photo-cell-info")).toContainText("確からしさ 1.00");
      // 写真の行は、ほかの資料の質問に答えるまで記録にならない。それでも確かめていない写真があるうちは止める
      await expect(page.getByTestId("compose-disabled-reason")).toContainText("確かめていない写真 1");
      await page.screenshot({ path: shot(`photo-review-${tag}`), fullPage: true });
    });

    let reviewText = "";
    await test.step("AI が質問に答えて計画を作り始めても、要確認があるうちは作らない", async () => {
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        const decisions = s.questions.map((q: any) =>
          q.defaultAnswer !== null
            ? { questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" }
            : { questionId: q.questionId, answer: q.options[0].id, author: "ai", reason: "既定の答えが無いので、最初の選択肢を案として置いた" },
        );
        await call(c, "intake_settle", { decisions });
      }
      await expect(page.getByTestId("compose-disabled-reason")).toContainText(/要確認 \d+/);
      await expect(photo.getByTestId("photo-review-count")).toContainText("この写真から作った記録");
      reviewText = (await photo.getByTestId("photo-review-count").textContent()) ?? "";
      const started = await call(c, "intake_compose");
      expect(started.started).toBe(true);
      let state = "running";
      let message: string | null = null;
      for (let i = 0; i < 50 && state === "running"; i++) {
        const s = await call(c, "intake_survey", { part: "compose" });
        state = s.compose.state;
        message = s.compose.message;
        if (state === "running") await page.waitForTimeout(100);
      }
      expect(state).toBe("failed");
      expect(message).toContain("要確認");
      await expect(page.getByTestId("compose-failed")).toContainText("要確認");
      console.log(`[${tag}] 確かめる前：${reviewText}・計画を作らなかった理由「${message}」`);
    });

    await test.step(`人がセルの文字を直すと作者は人になり、AI が読んだ文字に戻すと AI（読み取り）に戻る（${SCRIPT}）`, async () => {
      await photo.getByTestId("photo-cell").filter({ hasText: "ストーカ（STK-1）" }).click();
      await photo.getByTestId("photo-fix-text").fill("ストーカ（STK-1）直した");
      await photo.getByTestId("photo-fix").click();
      await expect(photo.locator('[data-testid="photo-cell"][data-human="true"]')).toHaveText("ストーカ（STK-1）直した");
      await expect(photo.getByTestId("photo-cell-info")).toContainText("AI が読んだ文字：「ストーカ（STK-1）」");
      await photo.getByTestId("photo-fix-text").fill("ストーカ（STK-1）");
      await photo.getByTestId("photo-fix").click();
      await expect(photo.locator('[data-testid="photo-cell"][data-human="true"]')).toHaveCount(0);
    });

    await test.step(`人が画像と並べて、一言の理由で確かめる（${SCRIPT}）`, async () => {
      await expect(photo.getByTestId("photo-confirm")).toBeDisabled();
      await photo.getByTestId("photo-confirm-reason").fill(`${SCRIPT}：正解から書いた格子なので、画像の表と合っている`);
      await photo.getByTestId("photo-confirm").click();
      await expect(photo).toHaveAttribute("data-state", "confirmed");
      await expect(photo.getByTestId("photo-confirmed")).toContainText("人が");
      await expect(page.getByTestId("compose-disabled-reason")).toHaveCount(0);
    });

    await test.step("確かめたあとは、計画を作れる", async () => {
      // 人が触った写真には、AI は置き直せない
      const re: any = await c.callTool({ name: "photo_transcribe", arguments: { mode: "place", grid: truthReading(size) } });
      expect(re.isError).toBe(true);
      const started = await call(c, "intake_compose");
      expect(started.started).toBe(true);
      let state = "running";
      let message: string | null = null;
      for (let i = 0; i < 50 && state === "running"; i++) {
        const s = await call(c, "intake_survey", { part: "compose" });
        state = s.compose.state;
        message = s.compose.message;
        if (state === "running") await page.waitForTimeout(100);
      }
      expect(state, String(message)).toBe("done");
      // 知らせの箱は出さない（docs/screens.md 3.3）。つくったことと作った人は資料のシートの印で見る
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done");
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose-by", "ai");
      console.log(`[${tag}] 確かめたあと：${message}`);
      await page.screenshot({ path: shot(`photo-composed-${tag}`), fullPage: true });
    });
  } finally {
    await c.close();
  }
});
