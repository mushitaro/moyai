// アプリの困りごとを、GitHub のアカウントなしで受け口から Issue にする（運営者 2026-11-18「作ってください」。絵は Wire Frame の AppFeedback）：
// 置き場所を選ぶ → 設定の「困りごと」に一言を書く → 送る全文（一言と、版・画面・OS・言語だけ）がそのまま出る → 人が「送る」を押す
// → 受け口（services/ledger-intake のハンドラそのもの）が、メモリの GitHub の Issues（tests/helpers/feedback-github.ts）にラベル feedback:app の Issue を 1 つ出す。
// その PC の語・行の値に当たれば「送る」を押せない。Claude（MCP の screen_set）は文の案を欄に置くまでで、送れない（送る道具が無い）。
// 受け口は試験の台として手元で動かす（本物の受け口・本物の GitHub では確かめていない）。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { handleRequest } from "../../services/ledger-intake/src/handler";
import { packOf } from "../../services/ledger-intake/src/packs";
import { readAppIssue } from "../../scripts/skill-loop/app-feedback.mjs";
import { E2E_NAME, callTool as call, chooseRoot, mcpClient, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { fakeIssuesGitHub, type FakeIssuesGitHub } from "../helpers/feedback-github";
import { memoryKv } from "../helpers/intake-github";

/** 試験だけのトークン（本物ではない） */
const TOKEN = `github_pat_${"E2eAppFb".repeat(3)}_${"w".repeat(40)}`;

let bridge: StartedBridge;
let gh: FakeIssuesGitHub;
let server: Server | null = null;
let work = "";
const received: string[] = [];

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-app-feedback-"));
  gh = fakeIssuesGitHub({ token: TOKEN });
  const env = { GITHUB_TOKEN: TOKEN, FEEDBACK_REPO: `${gh.owner}/${gh.name}`, INTAKE_KV: memoryKv() };
  const read = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
  // 受け口：送り手の IP は、Cloudflare の入口が付ける見出しの代わりに試験が付ける
  server = createServer(async (req, res) => {
    const body = await read(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    received.push(`${req.url} ${body.toString("utf8")}`);
    const r = await handleRequest(
      new Request(`https://intake.example${req.url ?? "/"}`, { method: req.method ?? "GET", headers: { ...headers, "cf-connecting-ip": "203.0.113.10" }, ...(req.method === "GET" ? {} : { body: body.toString("utf8") }) }),
      env,
      { fetch: gh.fetch, now: () => Date.now(), packOf },
    );
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const intakeBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  bridge = await startBuiltBridge("moyai-e2e-app-feedback-state-", { MOYAI_LEDGER_INTAKE_URL: intakeBase });
});
test.afterAll(async () => {
  bridge?.stop();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (work) rmSync(work, { recursive: true, force: true });
});

test("設定の「困りごと」：全文を見せ、人が「送る」を押したときだけ受け口が公開の Issue（feedback:app）を 1 つ出す。網に当たれば送らない。Claude は案を置くだけ", async ({ page }, info) => {
  test.setTimeout(180_000);
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  received.length = 0;
  gh.issues.length = 0;
  const c = await mcpClient(bridge.stateDir, ["screen_set"]);
  try {
    await test.step("人：置き場所と呼び名を選ぶ。設定に「困りごと」の 1 行（文の欄と「送る」）", async () => {
      await chooseRoot(page, bridge.base, root);
      await expect(page.getByTestId("app-feedback-setting")).toBeVisible();
      await expect(page.getByTestId("app-feedback-send")).toHaveCount(1);
      await expect(page.getByTestId("app-feedback-send")).toBeDisabled();
      await expect(page.getByTestId("app-feedback-preview")).toHaveCount(0);
    });

    await test.step("その PC の語（呼び名）や行の値に当たれば、「送る」を押せず理由の 1 行だけ。受け口には何も届かない", async () => {
      await page.getByTestId("app-feedback-note").fill(`${E2E_NAME}として署名できない`);
      await expect(page.getByTestId("app-feedback-blocked")).toHaveText("理由：施設の名前か行の値に当たる字がある");
      await expect(page.getByTestId("app-feedback-send")).toBeDisabled();
      await page.getByTestId("app-feedback-note").fill("株式会社ほげの資料で 120,000 円が読めない");
      await expect(page.getByTestId("app-feedback-send")).toBeDisabled();
      await expect(page.getByTestId("app-feedback-blocked")).toBeVisible();
      expect(received).toHaveLength(0);
    });

    await test.step("Claude：screen_set の feedbackDraft で文の案を欄に置く（送らない。送る道具は無い）", async () => {
      const { tools } = await c.listTools();
      expect(tools.map((t) => t.name).filter((n) => /send|feedback/i.test(n))).toEqual([]);
      const r = await call(c, "screen_set", { feedbackDraft: "取り込んだ資料を消せない。入れ間違えた資料を外したい" });
      expect(r.refused).toEqual([expect.objectContaining({ item: "feedbackDraft", reason: "feedback_human_send" })]);
      await expect(page.getByTestId("app-feedback-note")).toHaveValue("取り込んだ資料を消せない。入れ間違えた資料を外したい");
      await expect(page.getByTestId("app-feedback-claude")).toHaveText("- Claude の入力");
      // 送る全文が、そのまま出る（一言と決まった付き物だけ）
      const full = JSON.parse((await page.getByTestId("app-feedback-text").textContent()) ?? "");
      expect(Object.keys(full)).toEqual(["schema", "note", "version", "screen", "os", "lang"]);
      expect(full).toMatchObject({ schema: "moyai.app-feedback/0", note: "取り込んだ資料を消せない。入れ間違えた資料を外したい", screen: "settings", lang: "ja" });
      expect(["windows", "mac", "linux", "other"]).toContain(full.os);
      await expect(page.getByTestId("app-feedback-send")).toBeEnabled();
      await expect(page.getByTestId("app-feedback-send-note")).toHaveText("公開の Issue になる。送ったあとは消せない。");
      // Claude が置いただけでは、何も送られない
      expect(received).toHaveLength(0);
      expect(gh.issues).toHaveLength(0);
      await page.screenshot({ path: shot(`app-feedback-before-${tag}`), fullPage: true });
    });

    await test.step("人が「送る」を押すと、見せた全文だけが受け口に届き、ラベル feedback:app の Issue が 1 つできる", async () => {
      const shown = (await page.getByTestId("app-feedback-text").textContent()) ?? "";
      await page.getByTestId("app-feedback-send").click();
      await expect(page.getByTestId("app-feedback-sent")).toHaveText("✓ 送信　Issue #1");
      await expect(page.getByTestId("app-feedback-send")).toBeDisabled();
      await expect(page.getByTestId("app-feedback-sent-reason")).toHaveText("理由：送信済み");
      await page.screenshot({ path: shot(`app-feedback-sent-${tag}`), fullPage: true });
      expect(received).toEqual([`/app-feedback ${shown}`]);
      // 呼び名・置き場所の道は受け口に届かない
      expect(received[0]).not.toContain(E2E_NAME);
      expect(received[0]).not.toContain(root);
      expect(gh.issues).toHaveLength(1);
      const issue = gh.issues[0]!;
      expect(issue.labels).toEqual(["feedback:app"]);
      // 毎日の回しが、そのまま拾える形
      expect(readAppIssue({ number: 1, title: issue.title, body: issue.body, labels: issue.labels })).toMatchObject({ action: "fix", note: "取り込んだ資料を消せない。入れ間違えた資料を外したい", fromIntake: true });
    });
  } finally {
    await c.close();
  }
});
