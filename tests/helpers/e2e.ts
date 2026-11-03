// Playwright の試験の道具（取り込みの画面と MCP の通し）：ビルドした dist/cli.js start を空きのポートで起こし、
// 一時の状態フォルダに向ける。工場の資料を、画面の受け口へ File API の「落とす」で渡す。
// スクリーンショットは一時のフォルダの moyai-shots/<走らせた日（日本時間）>/（日誌に残すときは MOYAI_SHOTS_DIR=docs/progress/shots/<日付> を渡す）。前の画像は上書きしない。
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** 取り込みの画面を開き、パックと施設の名前を入れ、資料を受け口に落とす */
export async function openIntakeAndDrop(page: Page, base: string, facilityName: string, set = FICTIONAL_1): Promise<void> {
  await page.goto(`${base}/#/intake`);
  await expect(page.getByTestId("intake-page")).toBeVisible();
  await expect(page.getByTestId("compose")).toBeDisabled();
  await page.getByTestId("pack").click();
  await page.getByRole("option", { name: /^waste-incineration/ }).click();
  await page.getByTestId("facility-name").fill(facilityName);
  const files = set.files.map((name) => ({ name, b64: readFileSync(join(set.dir, name)).toString("base64") }));
  const dt = await page.evaluateHandle((fs) => {
    const d = new DataTransfer();
    for (const f of fs) d.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    return d;
  }, files);
  await page.getByTestId("drop").dispatchEvent("drop", { dataTransfer: dt });
  await expect(page.getByTestId("dest-file")).toHaveCount(set.files.length, { timeout: 20_000 });
}
