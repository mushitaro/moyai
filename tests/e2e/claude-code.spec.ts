// 縦の 1 本を、Claude Code を AI クライアントにして通す（docs/plan.md §5.2 の 1）。走らせるときだけ：MOYAI_CLAUDE_E2E=1。
// AI の仕事（要約を読む・決定を置く・計画を作る・当てはめの規則を自分で書いて置く）は、`claude -p` がリポジトリの .mcp.json の
// moyai だけをつないで行う。人の操作（資料を落とす・当てはめを受ける・確定・送る）は、試験の台本が画面のボタンで押す。
// Claude Code は利用者の契約の中で動く（API のキーは使わない）。先に npm run build を走らせておく。
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { acceptDecisions, acceptRules, chooseRootAndCreateRing, openIntakeAndDrop, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";

const FACILITY = "【架空】縦の一本（Claude Code）";
const HUMAN = "試験の台本が押した（Claude Code の案を画面で受けた）";
const TOOLS = ["intake_survey", "intake_settle", "intake_compose", "chart_rows", "crosswalk_propose"];

const PROMPT = [
  "MOYAI の作業画面に、架空のごみ焼却施設の資料が入っています。moyai の MCP のツールだけを使い、ファイルは読まないでください。",
  "1) intake_survey で質問を見て、既定の答えがある質問には、その既定の答えを intake_settle で置く（作者は ai、理由は「既定の答えを置いた（Claude Code の通し）」）。質問が無くなるまで繰り返す。",
  "2) intake_compose で計画を作り、intake_survey の compose で done になるまで待つ。",
  "3) intake_survey の crosswalk でパックの項目・作業の属性・欄ごとの多い値・版を読み、必要なら chart_rows で段の道を読む。",
  "4) crosswalk_propose で当てはめの規則を置く：資産の節 → パックの 1 段目の項目、作業 → 4 つの属性。確かな規則だけを置き、決められないものは置かずに残す。basedOnVersion は読んだ版。断られたら理由を読んで直す。",
  "最後に、置いた規則の数、当たった数、残った未当てはめの数を日本語で短く報告する。確定・送信・人が受けることは、あなたにはできない（ツールも無い）。",
].join("\n");

let bridge: StartedBridge;
let work = "";
const rings: string[] = [];
test.beforeAll(async () => {
  bridge = await startBuiltBridge("moyai-e2e-cc-");
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-cc-work-"));
});
test.afterAll(() => {
  bridge?.stop();
  if (work) rmSync(work, { recursive: true, force: true });
  for (const r of rings) rmSync(r, { recursive: true, force: true });
});

/** claude -p を走らせ、ツールの呼び出しの名前と最後の報告を返す */
function runClaude(stateDir: string, log: string): Promise<{ status: number | null; calls: string[]; result: string }> {
  return new Promise((resolve) => {
    const allowed = TOOLS.map((t) => `mcp__moyai__${t}`).join(",");
    const child = spawn(
      "claude",
      ["-p", PROMPT, "--mcp-config", ".mcp.json", "--strict-mcp-config", "--allowedTools", allowed, "--output-format", "stream-json", "--verbose"],
      // シェルを通さない（改行や引用符を含む指示がそのまま渡るように）
      { env: { ...process.env, MOYAI_STATE_DIR: stateDir } },
    );
    let out = "";
    child.stdout.on("data", (b) => (out += b.toString("utf8")));
    child.stderr.on("data", () => {});
    child.on("close", (status) => {
      writeFileSync(log, out);
      const lines = out.split("\n").flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
      const calls: string[] = [];
      let result = "";
      for (const x of lines) {
        if (x.type === "assistant") for (const c of x.message?.content ?? []) if (c.type === "tool_use") calls.push(c.name);
        if (x.type === "result") result = String(x.result ?? "");
      }
      resolve({ status, calls, result });
    });
  });
}

test("Claude Code が取り込みと当てはめの案を置き、人が受けて確定し、輪で ✓", async ({ page }, info) => {
  test.skip(process.env.MOYAI_CLAUDE_E2E !== "1", "MOYAI_CLAUDE_E2E=1 のときだけ走らせる（Claude Code の使用量を使うため）");
  test.skip(info.project.name !== "chrome", "Chrome の 1 回だけ");
  test.setTimeout(1_200_000);
  const tag = info.project.name;
  const root = join(work, "置き場所");
  const ringRoot = join(tmpdir(), `moyai-e2e-cc-ring-${Date.now()}`, "輪のフォルダ");
  rings.push(join(ringRoot, ".."));

  await chooseRootAndCreateRing(page, bridge.base, root, ringRoot);
  await openIntakeAndDrop(page, bridge.base, FACILITY);

  const cc = await test.step("AI（Claude Code）：取り込み → 計画 → 当てはめの規則", () => runClaude(bridge.stateDir, join(work, "claude.jsonl")));
  console.log(`Claude Code の報告：\n${cc.result}`);
  expect(cc.status).toBe(0);
  for (const t of ["intake_settle", "intake_compose", "crosswalk_propose"]) expect(cc.calls).toContain(`mcp__moyai__${t}`);
  await expect(page.getByTestId("composed")).toBeVisible();
  // 当てはめの案は、MERGE の決定のシートに 1 規則 1 行で並ぶ
  await page.getByTestId("sheet-decisions").click();
  expect(await page.getByTestId("crosswalk-rule").count()).toBeGreaterThan(0);
  await page.screenshot({ path: shot(`cc-crosswalk-proposed-${tag}`), fullPage: true });

  // 人（試験の台本）：Claude Code の規則を、上の欄の一言の理由で 1 規則ずつ受ける
  expect(await acceptRules(page, HUMAN)).toBeGreaterThan(0);
  const accepted = Number(await page.getByTestId("crosswalk-accepted").getAttribute("data-nodes"));
  expect(accepted).toBeGreaterThan(0);
  const un = page.getByTestId("crosswalk-unmapped");
  console.log(`受けた節 ${accepted}、未当てはめ：節 ${await un.getAttribute("data-nodes")}・作業 ${await un.getAttribute("data-works")}・記録 ${await un.getAttribute("data-records")}`);
  await page.screenshot({ path: shot(`cc-crosswalk-accepted-${tag}`), fullPage: true });

  // 確定（人だけ）：AI の決定を決定のシートで受けてから、署名のダイアログを開く
  await acceptDecisions(page, "試験の台本が押した（AI の決定を画面で受けた）");
  await page.getByTestId("confirm-open").click();
  await page.getByTestId("confirm-reason").fill("Claude Code の通し：取り込みと当てはめを確定する（e2e）");
  await signInDialog(page);
  await page.getByTestId("confirm-submit").click();
  await expect(page.getByTestId("confirm-done")).toContainText("第 1 版に署名しました");
  const plans = readdirSync(join(root, "plans"));
  const rec = JSON.parse(readFileSync(join(root, "plans", plans[0]!, "versions", "000001.json"), "utf8"));
  expect(rec.plan.assets.filter((a: any) => a.commonItemAccepted).length).toBe(accepted);
  await page.getByTestId("to-checkpoint").click();

  // 検問所 → 署名 → 輪
  await expect(page.getByTestId("checkpoint-page")).toBeVisible();
  await page.getByTestId("q-national").selectOption("yes");
  await page.getByTestId("q-furnace").selectOption("STOKER");
  await page.getByTestId("q-capacity_t_per_day").selectOption("C100_200");
  await page.getByTestId("q-turbine").selectOption("YES");
  await page.getByTestId("q-ash").selectOption("OUT");
  await page.getByTestId("q-contract").selectOption("SINGLE");
  await expect(page.getByTestId("you-k")).not.toHaveAttribute("data-k", "");
  expect(Number(await page.getByTestId("you-k").getAttribute("data-k"))).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("counts")).toHaveText("形 0｜固有名詞 0｜金額 0｜自由記述 0｜正確な日付 0");
  expect(await page.getByTestId("plain-chunk").count()).toBeGreaterThan(0);
  await page.screenshot({ path: shot(`cc-checkpoint-${tag}`), fullPage: true });
  await page.getByTestId("send").click();
  await expect(page.getByTestId("verify-table")).toHaveAttribute("data-ok", "true");
  const v = spawnSync(process.execPath, ["dist/cli.js", "verify", "ring", ringRoot], { env: { ...process.env, MOYAI_STATE_DIR: bridge.stateDir }, encoding: "utf8" });
  expect(v.status, v.stderr).toBe(0);
  expect(v.stderr).toContain("すべて ✓ です。");
});
