// Playwright の試験の道具（取り込みの画面と MCP の通し）：ビルドした dist/cli.js start を空きのポートで起こし、
// 一時の状態フォルダに向ける。工場の資料を、画面の受け口へ File API の「落とす」で渡す。
// MCP のクライアント（本物の中継 dist/cli.js mcp を標準入出力でつなぐ）と、設定の画面で置き場所と輪を作る人の操作も置く。
// スクリーンショットは一時のフォルダの moyai-shots/<走らせた日（日本時間）>/（日誌に残すときは MOYAI_SHOTS_DIR=docs/progress/shots/<日付> を渡す）。前の画像は上書きしない。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

export async function startBuiltBridge(prefix: string): Promise<StartedBridge> {
  const stateDir = mkdtempSync(join(tmpdir(), prefix));
  const port = await freePort();
  const child: ChildProcess = spawn(process.execPath, ["dist/cli.js", "start", "--port", String(port), "--no-open"], {
    env: { ...process.env, MOYAI_STATE_DIR: stateDir },
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
 * 取り込みの画面を開き、パックと施設の名前を入れ、資料を受け口に落とす。
 * 資料はフォルダの下の道で書いてよい（落とすファイルの名前は最後の部分）。写真はセルの行き先ではなく写真の欄に並ぶ。
 */
export async function openIntakeAndDrop(page: Page, base: string, facilityName: string, set = FICTIONAL_1): Promise<void> {
  await page.goto(`${base}/#/intake`);
  await expect(page.getByTestId("intake-page")).toBeVisible();
  await expect(page.getByTestId("compose")).toBeDisabled();
  await page.getByTestId("pack").click();
  await page.getByRole("option", { name: /^waste-incineration/ }).click();
  await page.getByTestId("facility-name").fill(facilityName);
  const photos = set.files.filter((n) => PHOTO_EXT.test(n)).length;
  const files = set.files.map((name) => ({ name: basename(name), b64: readFileSync(join(set.dir, name)).toString("base64") }));
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    return d;
  }, files);
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("dest-file")).toHaveCount(set.files.length - photos, { timeout: 20_000 });
  if (photos) await expect(page.getByTestId("photo-item")).toHaveCount(photos);
}

/** 本物の中継（dist/cli.js mcp）に MCP のクライアントでつなぎ、ツールの一覧（出力の型）を先に読む */
export async function mcpClient(stateDir: string, expectTools: string[] = []): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "mcp"],
    env: { ...(process.env as Record<string, string>), MOYAI_STATE_DIR: stateDir },
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

/** 人が設定の画面で、置き場所を選んで保存し、輪を作ってこの輪の鍵を合言葉で包む */
export async function chooseRootAndCreateRing(page: Page, base: string, root: string, ringRoot: string, passphrase: string): Promise<void> {
  await page.goto(`${base}/#/settings`);
  await expect(page.getByTestId("settings-page")).toBeVisible();
  await page.getByTestId("root-input").fill(root);
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await expect(page.getByTestId("current-root")).toHaveText(root);
  await page.getByTestId("ring-create-open").click();
  await page.getByTestId("ring-folder").fill(ringRoot);
  await page.getByTestId("ring-pack").selectOption("waste-incineration");
  await page.getByTestId("ring-pass").fill(passphrase);
  await page.getByTestId("ring-pass2").fill(passphrase);
  await page.getByTestId("ring-create-submit").click();
  await expect(page.getByTestId("ring-created")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("rings-table")).toBeVisible();
}
