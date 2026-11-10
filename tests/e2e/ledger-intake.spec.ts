// 公開の台帳へ GitHub のアカウントなしで出す（運営者の決定 2026-11-07）を、この PC の Chrome と Edge で画面から通す：
// 設定で置き場所・呼び名・台帳の clone を選ぶ → 見本の計画（施設の見え方は答えてある）を確定する → SHARE は共有フォルダが無いので公開台帳 → GitHub は未接続のまま →
// 人が送信経路 MOYAI 経由で「署名して公開台帳へ送信」を押す → 受け口が台帳の検証と同じ関数で確かめ、運営者のアカウントで PR #1 → 行方（審査中・アカウントなし）。
// 受け口は services/ledger-intake のハンドラそのものを 127.0.0.1 で動かす。GitHub はメモリの代わり（tests/helpers/intake-github.ts）を 127.0.0.1 で見せる。
// 本物の Cloudflare と GitHub では確かめていない。先に npm run build を走らせておく。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";
import { handleRequest } from "../../services/ledger-intake/src/handler";
import { packOf } from "../../services/ledger-intake/src/packs";
import { readLedgerDir, verifyLedgerFiles, type LedgerFile } from "../../src/share/ledger";
import { DEV_PLANS } from "../fixtures/chart/truth-to-plan.mjs";
import { E2E_NAME, PROFILE_ANSWERED, acceptDecisions, shot, signInDialog, startBuiltBridge, type StartedBridge } from "../helpers/e2e";
import { fakeLedgerGitHub, memoryKv, type FakeLedgerGitHub } from "../helpers/intake-github";

/** 試験だけのトークン（本物ではない） */
const TOKEN = `github_pat_${"E2eIntake".repeat(3)}_${"z".repeat(40)}`;

let bridge: StartedBridge;
let gh: FakeLedgerGitHub;
let servers: Server[] = [];
let work = "";
let repo = "";
let clone: LedgerFile[] = [];

/** 127.0.0.1 で、要求を Fetch の Request に直して handler に渡し、答えを返す */
async function serve(handler: (method: string, path: string, headers: Record<string, string>, body: string | undefined) => Promise<Response>): Promise<string> {
  const read = (req: IncomingMessage) =>
    new Promise<Buffer>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
    });
  const server = createServer(async (req, res) => {
    const body = await read(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers[k] = v;
    const r = await handler(req.method ?? "GET", req.url ?? "/", headers, req.method === "GET" ? undefined : body.toString("utf8"));
    res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

test.beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "moyai-e2e-ledger-intake-"));
  repo = join(work, "台帳の clone");
  buildLedgerDemo({ repo: process.cwd(), out: repo, state: join(work, "demo-state"), month: "2026-11" });
  mkdirSync(join(repo, ".git"), { recursive: true });
  writeFileSync(join(repo, ".git", "config"), '[remote "origin"]\n\turl = https://github.com/ledger-owner/moyai.git\n');
  const dir = await readLedgerDir(repo);
  if (!dir.ok) throw new Error(dir.reason);
  clone = dir.files;
  gh = fakeLedgerGitHub({ token: TOKEN, files: Object.fromEntries(clone.filter((f) => f.kind === "file" && f.bytes).map((f) => [f.path, f.bytes!])) });
  const env = { GITHUB_TOKEN: TOKEN, LEDGER_REPO: "ledger-owner/moyai", INTAKE_KV: memoryKv() };
  // 受け口：送り手の IP は、Cloudflare の入口が付ける見出しの代わりに試験が付ける
  const intakeBase = await serve((method, path, headers, body) =>
    handleRequest(new Request(`https://intake.example${path}`, { method, headers: { ...headers, "cf-connecting-ip": "203.0.113.9" }, ...(body !== undefined ? { body } : {}) }), env, {
      fetch: gh.fetch,
      now: () => Date.now(),
      packOf,
    }),
  );
  // アプリが PR の行方を読む先（公開の PR をトークン無しで読む）。中身は受け口が PR を出したのと同じメモリの台
  const ghBase = await serve((method, path, headers, body) =>
    gh.fetch(`https://api.github.com${path}`, { method, headers: headers.authorization ? { authorization: headers.authorization } : {}, ...(body !== undefined ? { body } : {}) }),
  );
  bridge = await startBuiltBridge("moyai-e2e-ledger-intake-state-", { MOYAI_LEDGER_INTAKE_URL: intakeBase, MOYAI_GITHUB_WEB: ghBase, MOYAI_GITHUB_API: ghBase });
});
test.afterAll(async () => {
  bridge?.stop();
  await Promise.all(servers.map((s) => new Promise<void>((r) => s.close(() => r()))));
  servers = [];
  if (work) rmSync(work, { recursive: true, force: true });
});

test("SHARE で GitHub につながずに、署名して、受け口から公開の台帳に PR を出す", async ({ page }, info) => {
  const tag = info.project.name;
  test.setTimeout(180_000);
  const root = join(work, tag, "置き場所");

  await test.step("人：設定で置き場所・呼び名・台帳の clone を選ぶ。GitHub はつながない", async () => {
    await page.goto(`${bridge.base}/#/settings`);
    await page.getByTestId("root-change").click();
    await page.getByTestId("root-input").fill(root);
    await page.getByTestId("name-change").click();
    await page.getByTestId("name-input").fill(E2E_NAME);
    await page.getByTestId("ledger-change").click();
    await page.getByTestId("ledger-input").fill(repo);
    await page.getByTestId("settings-save").click();
    await expect(page.getByTestId("current-ledger")).toHaveText(repo);
    await expect(page.getByTestId("settings-github")).toHaveText("未接続");
  });

  await test.step("見本の計画を開き、決定を受けて、署名して確定する", async () => {
    const body = JSON.stringify(PROFILE_ANSWERED(DEV_PLANS["fictional-1"]()));
    await page.route("**/assets/dev-plans/*.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
    await page.goto(`${bridge.base}/?plan=fictional-1#/merge/chart`);
    await expect(page.locator(".ag-row").first()).toBeVisible();
    await acceptDecisions(page, "試験の台本が押した（見本の計画の決定を受けた）");
    await page.getByTestId("confirm-open").click();
    await page.getByTestId("confirm-reason").fill("公開の台帳へ出す前の確定（e2e）");
    await signInDialog(page);
    await page.getByTestId("confirm-submit").click();
    await expect(page.getByTestId("confirm-done")).toContainText(/令和 \d+ 年度版（第 1 版）を確定しました。/);
    await page.getByTestId("confirm-close").click();
    await page.getByTestId("sheet-share").click();
    await expect(page.getByTestId("checkpoint-page")).toBeVisible();
  });

  await test.step("SHARE：共有先は公開台帳（字で）。GitHub に未接続なので、送信経路は MOYAI 経由（字で。切り替えは無い）で押せる", async () => {
    await expect(page.getByTestId("dest-name")).toHaveText("公開台帳");
    await expect(page.getByTestId("share-dest")).toHaveCount(0);
    await expect(page.getByTestId("github-login")).toHaveText("MOYAI 経由");
    await expect(page.getByTestId("route-switch")).toHaveCount(0);
    await expect(page.getByTestId("github-open")).toHaveCount(0);
    await expect(page.getByTestId("intake-ip")).toHaveText("送信元の IP は上限の判定のみ・保存なし");
    await expect(page.locator('[data-testid^="q-"]')).toHaveCount(0);
    await expect(page.getByText("公開時の表示")).toBeVisible();
    await expect(page.getByTestId("counts")).toHaveCount(0);
    await expect(page.getByTestId("counts-all")).toHaveText("形 0｜固有名詞 0｜金額 0｜自由記述 0｜正確な日付 0");
    await expect(page.getByTestId("send")).toHaveText("署名して公開台帳へ送信");
    await expect(page.getByTestId("send")).toBeEnabled();
    await expect(page.getByTestId("send")).toHaveAttribute("data-route", "intake");
    await expect(page.getByTestId("send-reason")).toHaveCount(0);
    await expect(page.getByTestId("share-note")).toHaveText("公開。掲載後の複製は残ります。");
    await expect(page.getByTestId("account-seen")).toHaveText("PR の GitHub アカウント　tsunagi（MOYAI の運営）");
    await page.screenshot({ path: shot(`ledger-intake-before-${tag}`), fullPage: true });
  });

  await test.step("人が送信経路 MOYAI 経由で「署名して公開台帳へ送信」を押すと署名して、受け口が PR を 1 つ出す。行方は審査中", async () => {
    expect(gh.prs).toHaveLength(0);
    await page.getByTestId("send").click();
    await expect(page.getByTestId("ledger-sent")).toHaveText("✓ 送信　共有ファイル 1　PR #1");
    await expect(page.locator('[data-testid="ledger-pr"][data-state="open"]')).toHaveCount(1);
    await expect(page.getByTestId("ledger-pr").first()).toContainText("審査中");
    await expect(page.getByTestId("ledger-pr-intake").first()).toHaveText("MOYAI 経由");
    await expect(page.getByTestId("ledger-pr-bundle").first()).toHaveText(/^共有ファイル 1　第 1 版　\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByTestId("send-reason")).toHaveText("理由：送信済み");
    await expect(page.getByTestId("send")).toBeDisabled();
    await page.screenshot({ path: shot(`ledger-intake-sent-${tag}`), fullPage: true });
    // 開き直すと：止め札は「前に出した共有ファイルが、まだ台帳に載っていません」
    await page.getByTestId("tab-merge").click();
    await page.getByTestId("sheet-share").click();
    await expect(page.getByTestId("send-reason")).toHaveText("理由：前に出した共有ファイルが、まだ台帳に載っていません");
    await expect(page.getByTestId("send")).toBeDisabled();

    // 届いた束：台帳の木に足して、受け手と同じ関数で ✓。本文の頭は「受け口から（GitHub のアカウントなし）」
    expect(gh.prs).toHaveLength(1);
    const pr = gh.prs[0]!;
    const files = Object.entries(pr.files);
    expect(files).toHaveLength(1);
    const [path, bytes] = files[0]!;
    expect(path).toMatch(/^ledger\/ledger\/bundles\/[0-9a-f]{16}\/000001-[0-9a-f]{16}\.json$/);
    const read = verifyLedgerFiles([...clone, { path, kind: "file", bytes: new Uint8Array(bytes) }], packOf("waste-incineration")!);
    expect(read.bundles.find((b) => b.path === path)?.status).toBe("ok");
    expect(pr.body.split("\n")[0]).toBe("受け口から（GitHub のアカウントなし）");
    expect(pr.body).not.toContain(DEV_PLANS["fictional-1"]().displayName);
  });
});
