// シナリオテスト D1（docs/scenarios.md）：確定した計画で、出力も共有も、選ぶ・入れることなしに主ボタン 1 つで終わる。
// 出力のシートと共有のシートの「押せるもの」を数える：選び・入力の欄が 0、主ボタンが 1。ほかの押せるもの（副）は下の一覧のものだけ（増えれば落ちる。引き算の見張り）。
// Skillパックあり・なし（初めて読む施設。mushitaro/moyai#67）の両方で数える。パックなしの計画には共有のシートが無い（輪も台帳もパックごと）。
// 共有は、初めての人の通し（S-0 の 6）と同じ「共有フォルダ」だけがある形。見え方の答えは Claude が会話で聞いて share_preview の answers で置く（画面では選ばない）。
// 人の操作（保存先・呼び名・共有フォルダを作る・受ける・署名する）は、試験の台本が人の代わりに画面で押す。数えるのは確定したあとの出力・共有のシートだけ。
// 先に npm run build を走らせておく。置き場所・共有フォルダは一時のフォルダ。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { acceptDecisions, callTool, chooseRootAndCreateRing, mcpClient, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

/** Claude が会話で聞いた見え方の答え（架空の施設） */
const ANSWERS = { facility: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };

type Pressable = { kind: "field" | "primary" | "secondary"; testid: string; text: string };

/**
 * root の中の、見えている押せるものを数える。
 * - 欄（field）：入力（input・textarea・contenteditable）、選び（select・role の textbox/combobox/listbox/option/radio/checkbox/switch・押した状態を持つボタン aria-pressed／aria-checked／aria-selected）
 * - 主ボタン（primary）：Mantine の Button（この画面の主ボタンの部品）
 * - 副（secondary）：ほかのボタン・リンク
 */
async function pressables(root: Locator): Promise<Pressable[]> {
  return root.evaluate((el) => {
    const visible = (e: Element) => {
      const h = e as HTMLElement;
      if (h.closest("[aria-hidden=true]")) return false;
      // たたんだ <details> の中身は、いまの Chrome では content-visibility で隠すだけで箱は残る。checkVisibility はそれも見ない
      if (!h.checkVisibility({ visibilityProperty: true })) return false;
      return h.getClientRects().length > 0;
    };
    const sel =
      "a[href], button, input:not([type=hidden]), select, textarea, [contenteditable=''], [contenteditable=true], [role=button], [role=link], [role=tab], [role=textbox], [role=combobox], [role=listbox], [role=option], [role=radio], [role=checkbox], [role=switch], [role=menuitem], summary";
    const fieldRoles = new Set(["textbox", "combobox", "listbox", "option", "radio", "checkbox", "switch", "tab"]);
    const out: { kind: "field" | "primary" | "secondary"; testid: string; text: string }[] = [];
    for (const e of Array.from(el.querySelectorAll(sel))) {
      if (!visible(e)) continue;
      const tag = e.tagName.toLowerCase();
      const role = e.getAttribute("role") ?? "";
      const testid = (e.closest("[data-testid]") as HTMLElement | null)?.dataset.testid ?? "";
      const text = (e.textContent ?? "").trim().slice(0, 40);
      const field =
        tag === "input" ||
        tag === "select" ||
        tag === "textarea" ||
        e.hasAttribute("contenteditable") ||
        fieldRoles.has(role) ||
        e.hasAttribute("aria-pressed") ||
        e.hasAttribute("aria-checked") ||
        e.hasAttribute("aria-selected");
      const kind = field ? "field" : e.classList.contains("mantine-Button-root") ? "primary" : "secondary";
      out.push({ kind, testid, text });
    }
    return out;
  });
}

async function count(page: Page, root: Locator, name: string, primary: string, secondary: readonly string[]): Promise<void> {
  const ps = await pressables(root);
  // 写し（数えた形のまま）
  await page.screenshot({ path: shot(`one-button-${name}`), fullPage: true });
  const fields = ps.filter((p) => p.kind === "field");
  const primaries = ps.filter((p) => p.kind === "primary");
  const others = ps.filter((p) => p.kind === "secondary");
  expect(fields, `${name}：選び・入力の欄 ${JSON.stringify(fields)}`).toEqual([]);
  expect(primaries.map((p) => p.testid), `${name}：主ボタン ${JSON.stringify(primaries)}`).toEqual([primary]);
  // 副の押せるものは、名指したものだけ（名の無いものや、新しく増えたものがあれば落ちる）
  expect(others.map((p) => p.testid).sort(), `${name}：副 ${JSON.stringify(others)}`).toEqual([...secondary].sort());
}

const PACKS = [
  { name: "Skillパックあり", packId: "waste-incineration" },
  { name: "Skillパックなし（初めて読む施設。mushitaro/moyai#67）", packId: "" },
] as const;

for (const pk of PACKS) {
  test.describe(pk.name, () => {
    let bridge: StartedBridge;
    let work = "";
    test.beforeAll(async () => {
      bridge = await startBuiltBridge("moyai-e2e-one-button-");
      work = mkdtempSync(join(tmpdir(), "moyai-e2e-one-button-"));
    });
    test.afterAll(() => {
      bridge?.stop();
      if (work) rmSync(work, { recursive: true, force: true });
    });

    test(`確定した計画で、出力も共有も、選び・入力の欄が 0、主ボタンが 1。押すと終わる（${pk.packId || "パックなし"}）`, async ({ page }) => {
      test.setTimeout(240_000);
      const tag = pk.packId || "no-pack";
      const root = join(work, "置き場所");
      const ringRoot = join(work, "共有", "共有フォルダ");

      await test.step("人：保存先・呼び名・共有フォルダ（設定の画面）。見本の計画を受けて第 1 版に署名する", async () => {
        await chooseRootAndCreateRing(page, bridge.base, root, ringRoot);
        const body = JSON.stringify({ ...DEV_PLANS["fictional-1"](), packId: pk.packId });
        await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
        await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
        await expect(page.locator(".ag-row").first()).toBeVisible();
        await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
        await page.getByTestId("confirm-open").click();
        await page.getByTestId("confirm-reason").fill("主ボタン 1 つの試験の第 1 版（e2e）");
        await signInDialog(page);
        await page.getByTestId("confirm-submit").click();
        await expect(page.getByTestId("confirm-done")).toContainText(/第 1 版）を確定しました。/);
        await page.keyboard.press("Escape");
      });

      await test.step("出力：選び・入力の欄 0、主ボタン「Excel を出力」1。押すと落ちる", async () => {
        await page.getByTestId("sheet-export").click();
        await expect(page).toHaveURL(/#\/merge\/export$/);
        const sheet = page.getByTestId("export-page");
        await expect(page.getByTestId("export-excel")).toBeEnabled();
        await expect(page.getByTestId("export-sample")).toBeVisible();
        // 副：様式を足す（押さなくても終わる。Claude が会話で入れることもできる）
        await count(page, sheet, `export-${tag}`, "export-excel", ["template-pick"]);
        const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-excel").click()]);
        expect(download).toBeTruthy();
        await expect(page.getByTestId("export-saved")).toHaveText(/^✓ 出力　.+_第1版_星取表\.xlsx$/);
        await count(page, sheet, `export-after-${tag}`, "export-excel", ["template-pick"]);
      });

      if (!pk.packId) {
        // パックなし：共有のシートは並ばない（輪も台帳もパックごとなので、共有するものが無い。PR #68、mushitaro/moyai#67）
        await test.step("共有：パックなしの計画には、共有のシートが無い", async () => {
          await expect(page.getByTestId("sheet-export")).toBeVisible();
          await expect(page.getByTestId("sheet-share")).toHaveCount(0);
        });
        return;
      }

      await test.step("共有：Claude が見え方の答えを置く → 選び・入力の欄 0、主ボタン「署名して共有フォルダへ送信」1。押すと送る", async () => {
        const c = await mcpClient(bridge.stateDir, ["share_preview"]);
        try {
          await page.getByTestId("sheet-share").click();
          await expect(page).toHaveURL(/#\/merge\/share$/);
          await expect(page.getByTestId("checkpoint-page")).toBeVisible();
          expect((await callTool(c, "share_preview", { answers: ANSWERS })).blocked).toEqual([]);
          await expect(page.getByTestId("send")).toBeEnabled();
          await expect(page.getByTestId("dest-name")).toHaveText("共有フォルダ");
          const sheet = page.getByTestId("checkpoint-page");
          // 副：受信した共有ファイルの 1 行（押すと表を開く）と、共有ファイルの中身（たたんだ証拠を開く）。docs/screens.md 3.6
          await count(page, sheet, `share-${tag}`, "send", ["received-summary", "share-contents"]);
          await page.getByTestId("send").click();
          await expect(page.getByTestId("sent")).toHaveText(/^✓ 送信　共有ファイル 1　/);
          await expect(page.getByTestId("send-reason")).toHaveText("理由：送信済み");
        } finally {
          await c.close();
        }
      });
    });
  });
}
