// 読み方のフィードバックを、GitHub のアカウントなしで受け口から Issue にする（運営者 2026-11-16「早く利用者が使える状態に」。絵は Wire Frame の ReadingOutSend）：
// 置き場所を選ぶ → 資料を落とす → AI が計画を作り、読み方の案を 1 つ置く → ルールのシートで人が「ルールを書き出す」→「保存する」→「送る」
// → 受け口（services/ledger-intake のハンドラそのもの）が、メモリの GitHub の Issues（tests/helpers/feedback-github.ts）にラベル feedback の Issue を 1 つ出す。
// 受け口は試験の台として手元で動かす（本物の受け口・本物の GitHub では確かめていない）。主ボタンは 1 つのまま（書き出す → 保存する → 送る）。先に npm run build を走らせておく。
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { handleRequest } from "../../services/ledger-intake/src/handler";
import { packOf } from "../../services/ledger-intake/src/packs";
import { readForm, screen } from "../../scripts/skill-loop/feedback.mjs";
import { callTool as call, chooseRoot, mcpClient, openIntakeAndDrop, shot, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { fakeIssuesGitHub, type FakeIssuesGitHub } from "../helpers/feedback-github";
import { memoryKv } from "../helpers/intake-github";

const FACILITY = "【架空】読み方を送る試験";
/** 試験だけのトークン（本物ではない） */
const TOKEN = `github_pat_${"E2eFeedbk".repeat(3)}_${"w".repeat(40)}`;

let bridge: StartedBridge;
let gh: FakeIssuesGitHub;
let server: Server | null = null;
let work = "";
const received: string[] = [];

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-feedback-send-"));
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
    if (req.url === "/feedback") received.push(body.toString("utf8"));
    const r = await handleRequest(
      new Request(`https://intake.example${req.url ?? "/"}`, { method: req.method ?? "GET", headers: { ...headers, "cf-connecting-ip": "203.0.113.9" }, ...(req.method === "GET" ? {} : { body: body.toString("utf8") }) }),
      env,
      { fetch: gh.fetch, now: () => Date.now(), packOf },
    );
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const intakeBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  bridge = await startBuiltBridge("moyai-e2e-feedback-send-state-", { MOYAI_LEDGER_INTAKE_URL: intakeBase });
});
test.afterAll(async () => {
  bridge?.stop();
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  if (work) rmSync(work, { recursive: true, force: true });
});

test("ルールのシートで、保存のあと主ボタンが「送る」に替わり、押すと受け口が公開の Issue を 1 つ出す", async ({ page }, info) => {
  test.setTimeout(300_000);
  const tag = info.project.name;
  const root = join(work, tag, "置き場所");
  const c = await mcpClient(bridge.stateDir, ["intake_survey", "intake_settle", "intake_compose", "reading_rules_propose"]);
  try {
    await test.step("人：置き場所を選び、資料を落とす。AI：既定の答えを置いて計画を作る", async () => {
      await chooseRoot(page, bridge.base, root);
      await openIntakeAndDrop(page, bridge.base, FACILITY, undefined, undefined, root);
      for (let round = 0; ; round++) {
        expect(round).toBeLessThan(15);
        const s = await call(c, "intake_survey", { part: "questions" });
        if (!s.questions.length) break;
        await call(c, "intake_settle", {
          decisions: s.questions.map((q: any) => ({ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "利用者がチャットで、既定の答えでよいと答えた" })),
        });
      }
      expect((await call(c, "intake_compose")).started).toBe(true);
      await expect(page.getByTestId("intake-page")).toHaveAttribute("data-compose", "done", { timeout: 60_000 });
    });

    await test.step("AI：読み方の案を 1 つ置く（会話で決めた形）。人がルールのシートを開く", async () => {
      await call(c, "reading_rules_propose", {
        name: "【架空】送る試験の読み方",
        scope: "facility",
        rules: [{ id: "s1", author: "ai", reason: "利用者が会話で決めた（試験の台本）", text: "「ブロワー」と「ブロワ」は同じ機器", kind: "sameAsset", names: ["ブロワー", "ブロワ"] }],
      });
      await expect(async () => {
        await page.getByTestId("sheet-readings").click();
        await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "readings", { timeout: 2000 });
      }).toPass({ timeout: 30_000 });
    });

    await test.step("人：書き出す → 保存する。保存のあと主ボタンは「送る」、その左に結果の 1 行だけ", async () => {
      // 主ボタンは 1 つ
      await expect(page.getByTestId("reading-out")).toHaveCount(1);
      await expect(page.getByTestId("reading-out")).toHaveText("ルールを書き出す");
      await page.getByTestId("reading-out").click();
      await expect(page.getByTestId("reading-out-text")).toContainText('"schema": "moyai.reading-feedback/0"');
      await expect(page.getByTestId("reading-out")).toHaveText("保存する");
      await page.getByTestId("reading-out").click();
      await expect(page.getByTestId("reading-out-saved")).toContainText(/保存済み　ルール_\d{4}-\d{2}-\d{2}_[0-9a-f]{8}\.json/);
      await expect(page.getByTestId("reading-out")).toHaveText("送る");
      await expect(page.getByTestId("reading-out")).toBeEnabled();
      await expect(page.getByTestId("reading-out-send-note")).toHaveText("公開の Issue になる。送ったあとは消せない。");
      expect(received).toHaveLength(0);
      await page.screenshot({ path: shot(`reading-feedback-send-before-${tag}`), fullPage: true });
    });

    await test.step("人が「送る」を押すと、保存した全文だけが受け口に届き、ラベル feedback の Issue が 1 つできる", async () => {
      await page.getByTestId("reading-out").click();
      await expect(page.getByTestId("reading-out-sent")).toHaveText("✓ 送信　Issue #1");
      await expect(page.getByTestId("reading-out")).toBeDisabled();
      await expect(page.getByTestId("reading-out-send-reason")).toHaveText("理由：送信済み");
      await page.screenshot({ path: shot(`reading-feedback-send-sent-${tag}`), fullPage: true });
      expect(received).toHaveLength(1);
      expect(JSON.parse(received[0]!).schema).toBe("moyai.reading-feedback/0");
      // 施設の名前（その PC の語）は受け口に届かない
      expect(received[0]).not.toContain("読み方を送る試験");
      expect(gh.issues).toHaveLength(1);
      const issue = gh.issues[0]!;
      expect(issue.labels).toEqual(["feedback", "area:skill-loop"]);
      // 毎日の回しが、そのまま拾える形
      expect(Object.keys(readForm(issue.body))).toContain("会話で作ったルール（あれば）");
      expect(screen({ number: 1, title: issue.title, body: issue.body, labels: issue.labels }).ok).toBe(true);
    });
  } finally {
    await c.close();
  }
});
