// Playwright の試験の道具（取り込みの画面と MCP の通し）：ビルドした dist/cli.js start を空きのポートで起こし、
// 一時の状態フォルダに向ける。工場の資料を、画面の受け口へ File API の「落とす」で渡す。
// MCP のクライアント（本物の中継 dist/cli.js mcp を標準入出力でつなぐ）と、設定の画面で置き場所と輪を作る人の操作も置く。
// スクリーンショットは一時のフォルダの moyai-shots/<走らせた日（日本時間）>/（日誌に残すときは MOYAI_SHOTS_DIR=docs/progress/shots/<日付> を渡す）。前の画像は上書きしない。
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { expect, type Page } from "@playwright/test";

const jst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const SHOTS = process.env.MOYAI_SHOTS_DIR ?? `${process.env.TEMP ?? process.env.TMPDIR ?? "/tmp"}/moyai-shots/${jst}`;

export function shot(name: string): string {
  mkdirSync(SHOTS, { recursive: true });
  const p = `${SHOTS}/${name}.png`;
  if (!existsSync(p)) return p;
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date())
    .replace(/:/g, "");
  return `${SHOTS}/${name}-${t}.png`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const port = typeof a === "object" && a ? a.port : 0;
      s.close(() => resolve(port));
    });
  });
}

export interface StartedBridge {
  base: string;
  stateDir: string;
  stop(): void;
}

export async function startBuiltBridge(prefix: string, env: Record<string, string> = {}): Promise<StartedBridge> {
  const stateDir = mkdtempSync(join(tmpdir(), prefix));
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["dist/cli.js", "start", "--port", String(port), "--no-open"], {
    env: { ...process.env, ...env, MOYAI_STATE_DIR: stateDir },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`起動しない: ${out}`)), 15_000);
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString("utf8");
      const m = /橋渡しを起こしました：(\S+)/.exec(out);
      if (m) {
        clearTimeout(timer);
        resolve((m[1] as string).replace(/\/$/, ""));
      }
    });
    child.once("exit", (c) => reject(new Error(`止まった ${c}: ${out}`)));
  });
  // 橋渡しのログ（MOYAI_E2E_BRIDGE_LOG に道を渡したときだけ、そのファイルに足す。落ちた試験の調べに使う）
  const logTo = process.env.MOYAI_E2E_BRIDGE_LOG;
  if (logTo) {
    appendFileSync(logTo, out);
    child.stderr?.on("data", (d: Buffer) => appendFileSync(logTo, `${new Date().toISOString()} ${d.toString("utf8")}`));
  }
  return {
    base,
    stateDir,
    stop: () => {
      child.kill();
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

export const FICTIONAL_1 = {
  dir: "samples/out/waste-incineration/fictional-1",
  files: ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"],
};

/** 写真（読まずに並べるもの）の拡張子 */
const PHOTO_EXT = /\.(jpe?g|png)$/i;

/**
 * 資料のシート（白紙）を開き、パックと施設の名前を入れ、資料を受け口に落とす。
 * 資料はフォルダの下の道で書いてよい（落とすファイルの名前は最後の部分）。写真は資料のタブではなく写真の欄に並ぶ。
 */
/** パックの欄に出る日本語の名前（packs/<パック>/pack.json の name。画面は内部の ID を出さない） */
export function packName(packId: string): string {
  return (JSON.parse(readFileSync(join("packs", packId, "pack.json"), "utf8")) as { name: string }).name;
}

export async function openIntakeAndDrop(page: Page, base: string, facilityName: string, set = FICTIONAL_1, packId = "waste-incineration"): Promise<void> {
  await page.goto(`${base}/#/intake`);
  await expect(page.getByTestId("intake-page")).toBeVisible();
  await expect(page.getByTestId("compose")).toBeDisabled();
  await page.getByTestId("pack").click();
  await page.getByRole("option", { name: packName(packId), exact: true }).click();
  await page.getByTestId("facility-name").fill(facilityName);
  const photos = set.files.filter((n) => PHOTO_EXT.test(n)).length;
  const files = set.files.map((name) => ({ name: basename(name), b64: readFileSync(join(set.dir, name)).toString("base64") }));
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    return d;
  }, files);
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
  // 資料の選び（白紙でも同じ。資料ごとのタブは並べない。docs/screens.md 3.2「資料の選び」・3.3）。写真は読むまで資料の数に入らない
  await expect(page.getByTestId("source-picker")).toHaveAttribute("data-count", String(set.files.length - photos), { timeout: 20_000 });
  if (photos) await expect(page.getByTestId("photo-item")).toHaveCount(photos);
}

/**
 * 資料の選び（シートのタブの行。docs/screens.md 3.2「資料の選び」）：一覧を開き、その名前の行を選ぶ。
 * 資料のシートで、その資料が開くまで待つ
 */
export async function chooseSource(page: Page, name: string): Promise<void> {
  await page.getByTestId("source-picker").click();
  await page.locator(`[data-testid="source-row"][data-file="${name}"]`).click();
  await expect(page.getByTestId("source-list")).toHaveCount(0);
  await expect(page.getByTestId("source-picker")).toHaveAttribute("data-file", name);
  await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
}

/** 資料の選びで、名前順の最初の資料を開く（どの資料でもよいとき） */
export async function chooseFirstSource(page: Page): Promise<string> {
  await page.getByTestId("source-picker").click();
  const row = page.locator('[data-testid="source-row"][data-state="ready"]').first();
  const name = (await row.getAttribute("data-file")) ?? "";
  await row.click();
  await expect(page.getByTestId("source-picker")).toHaveAttribute("data-file", name);
  await expect(page.getByTestId("merge-page")).toHaveAttribute("data-sheet", "files");
  return name;
}

/** 本物の中継（dist/cli.js mcp）に MCP のクライアントでつなぎ、ツールの一覧（出力の型）を先に読む */
export async function mcpClient(stateDir: string, expectTools: string[] = []): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "mcp"],
    // 試験の橋渡しは試験が起こす。中継に本物の橋渡し（既定のポート）を起こさせない
    env: { ...(process.env as Record<string, string>), MOYAI_STATE_DIR: stateDir, MOYAI_NO_BRIDGE_LAUNCH: "1" },
    stderr: "pipe",
  });
  const client = new Client({ name: "moyai-e2e", version: "0" });
  await client.connect(transport);
  // 本物のクライアントと同じく、ツールの一覧（出力の型）を先に読む。以後の結果は SDK が出力の型で確かめる
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(expectTools));
  return client;
}

/** ツールを呼び、誤りでないことと、型どおりの結果があることを確かめて返す */
export async function callTool(c: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const r: any = await c.callTool({ name, arguments: args });
  expect(r.isError, `${name}: ${JSON.stringify(r.content)}`).toBeFalsy();
  expect(r.structuredContent, name).toBeTruthy();
  return r.structuredContent;
}

/** 人が設定の画面で、置き場所を選んで保存し、輪を作ってこの輪の鍵を作る */
/**
 * 施設の見え方を答えてある計画（全国の表に載る・炉の形式など。SHARE の画面に見え方の選びは無いので、計画の施設の答えで渡す。2026-11-10）。
 * 答えはどれも架空の施設のもの
 */
export function PROFILE_ANSWERED<P extends { facility: Record<string, unknown> }>(plan: P): P {
  return {
    ...plan,
    facility: { ...plan.facility, inNationalTable: true, profile: { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" } },
  };
}

/** 試験の台本が版に署名するときの呼び名（架空） */
export const E2E_NAME = "【架空】試験の台本";

/** 確定のダイアログで署名する：合言葉は打たない（運営者の決定 2026-11-04）。誰として署名するかの 1 行が出ていることだけを確かめる */
export async function signInDialog(page: Page): Promise<void> {
  await expect(page.getByTestId("sign-as")).toBeVisible();
}

/**
 * 設定の画面で保存先と呼び名を選んで保存する（試験の台本が人の代わりに押す）。
 * 既定の保存先は Documents の下なので、Documents の無い入れ物（Linux の CI など）では保存先が無く、確定のシートが受けた決定を読めない（mushitaro/moyai#36）。
 * 保存先に関わる段のある台本は、Documents の有る無しに頼らず、一時のフォルダをここで選ぶ
 */
export async function chooseRoot(page: Page, base: string, root: string): Promise<void> {
  await page.goto(`${base}/#/settings`);
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await page.getByTestId("root-change").click();
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("name-change").click();
  await page.getByTestId("name-input").fill(E2E_NAME);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-save")).toBeDisabled();
  await expect(page.getByTestId("current-root")).toHaveText(root);
}

export async function chooseRootAndCreateRing(page: Page, base: string, root: string, ringRoot: string): Promise<void> {
  await chooseRoot(page, base, root);
  await page.getByTestId("ring-create-open").click();
  await page.getByTestId("ring-folder").fill(ringRoot);
  await page.getByTestId("ring-pack").selectOption("waste-incineration");
  await page.getByTestId("ring-create-submit").click();
  await expect(page.getByTestId("ring-created")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rings-table")).toBeVisible();
}

/**
 * MERGE の決定のシートで、受けていない決定を、上の理由の欄に理由を書いて受ける（試験の台本が人の代わりに押す）。受けた数を返す。
 * 種類の切り替えごとに「見えている n 件をまとめて受ける」で受ける（工場の資料を計画 §2.5 の厚さにしてから、決定が数百ある）。
 * 当てはめの規則の種類（第 n 版と同じ・当てはめの案）は受けない（acceptRules で受ける）
 */
/** MERGE の横の板の切り替えを開く（既定はたたんだ縦の帯。たたんでいれば帯の名前を押す。docs/screens.md 3.2、Wire、11-06） */
export async function sideTab(page: Page, k: "signatures" | "comments" | "source" | "open"): Promise<void> {
  const band = page.getByTestId(`side-band-${k}`);
  const tab = page.getByTestId(`side-${k}`);
  // 版を読み終えるまで、どちらも出ていないことがある。どちらかが出るまで待つ
  await expect(band.or(tab).first()).toBeVisible();
  if (await band.isVisible()) await band.click({ timeout: 15_000 });
  else await tab.click({ timeout: 15_000 });
  await expect(page.getByTestId("merge-side")).toBeVisible();
  await expect(page.getByTestId(`side-${k}`)).toHaveAttribute("aria-selected", "true");
}

/**
 * 確定のシートの「判断の理由」の欄に書く。種類で「会話の回答」を選んでいるときは欄が無い（理由なしで受ける。docs/screens.md 3.2
 * 「会話の回答の受け方」、Wire、11-07）ので書かない
 */
export async function fillDecisionReason(page: Page, reason: string): Promise<void> {
  if ((await page.getByTestId("decisions-sheet").getAttribute("data-kind")) === "relayed") {
    await expect(page.getByTestId("decisions-reason")).toHaveCount(0);
    return;
  }
  await page.getByTestId("decisions-reason").fill(reason);
}

export async function acceptDecisions(page: Page, reason: string): Promise<number> {
  await page.getByTestId("sheet-decisions").click();
  await expect(page.getByTestId("decisions-sheet")).toBeVisible();
  // 版の履歴を読んで、受けていない決定が並ぶ（無ければ「ありません」）まで待つ
  await expect(page.locator('[data-testid="pending-row"], [data-testid="crosswalk-rule"], [data-testid="decisions-none"]').filter({ visible: true }).first()).toBeVisible();
  await fillDecisionReason(page, reason);
  // 種類の切り替え（第 n 版と同じ・当てはめの案・台帳からの案・会話から写した答え・Claude の決定）ごとに、見えている種類をまとめて受ける。
  // 当てはめの規則（第 n 版と同じ・当てはめの案）は受けない（acceptRules で 1 規則ずつ受ける）。受け終えた種類は切り替えから消える
  const rows = page.locator('[data-testid="pending-row"][data-accepted="false"]');
  const kinds = page.getByTestId("decisions-kind").locator("button").filter({ hasNotText: /^(紐付け案|第 \d+ 版と同じ)/ });
  let n = 0;
  for (let i = 0; i < 20; i++) {
    if ((await kinds.count()) > 0) await kinds.first().click();
    const open = await rows.count();
    if (open === 0) break;
    n += open;
    // 受けると計画が描き直され、理由の欄が空に戻ることがあるので、種類ごとに書き直す（会話の回答は欄が無く、理由なしで受ける）
    await fillDecisionReason(page, reason);
    const kindText = () => page.getByTestId("decisions-kind").textContent({ timeout: 500 }).catch(() => "");
    const before = await kindText();
    await page.getByTestId("decisions-bulk-accept").click();
    // 受けた種類は切り替えから消え、次の種類が見える（最後の種類なら切り替えごと消える）
    await expect.poll(kindText).not.toBe(before);
  }
  return n;
}

/**
 * MERGE の決定のシートで、当てはめの案（Claude が置いた規則）を 1 規則ずつ受ける。理由は上の欄に書く。
 * reject に挙げた規則は、その理由で、確かめのダイアログを通して断る。受けた・断った数を返す
 */
export async function acceptRules(page: Page, reason: string, reject: { ruleId: string; reason: string } | null = null): Promise<number> {
  await page.getByTestId("sheet-decisions").click();
  await expect(page.getByTestId("decisions-sheet")).toBeVisible();
  const open = page.locator('[data-testid="crosswalk-rule"][data-state="proposed"]');
  const field = page.getByTestId("decisions-reason");
  let n = 0;
  for (; n < 1_000 && (await open.count()) > 0; n++) {
    const row = open.first();
    const id = (await row.getAttribute("data-rule")) ?? "";
    const done = page.locator(`[data-testid="crosswalk-rule"][data-rule="${id}"]`);
    if (reject && id === reject.ruleId) {
      await field.fill(reject.reason);
      await row.getByTestId("crosswalk-reject").click();
      await page.getByTestId("crosswalk-reject-confirm").click();
      await expect(done).toHaveAttribute("data-state", "rejected");
    } else {
      if ((await field.inputValue()) !== reason) await field.fill(reason);
      await row.getByTestId("crosswalk-accept").click();
      await expect(done).toHaveAttribute("data-state", "accepted");
    }
  }
  await expect(open).toHaveCount(0);
  return n;
}
