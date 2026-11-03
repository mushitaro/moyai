// 状態フォルダと、橋渡しの鍵ファイル。
// Windows は %LOCALAPPDATA%\MOYAI\state\（同期されない場所）。macOS・Linux は利用者だけが読めるフォルダ。
// 試験は環境変数 MOYAI_STATE_DIR で一時のフォルダに向け、本物の状態フォルダに触れない。
// 鍵ファイルは同じ利用者のプロセスには読める（docs/security.md に書く）。
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

export const STATE_DIR_ENV = "MOYAI_STATE_DIR";
export const KEY_FILE_NAME = "bridge.json";

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const fromEnv = env[STATE_DIR_ENV];
  if (fromEnv) return fromEnv;
  if (platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "MOYAI", "state");
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "MOYAI", "state");
  return join(env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "moyai");
}

export const keyFileSchema = z.object({
  version: z.literal(1),
  port: z.number().int().min(1).max(65535),
  key: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  pid: z.number().int(),
  startedAt: z.string(),
});
export type KeyFile = z.infer<typeof keyFileSchema>;

export function writeKeyFile(stateDir: string, data: KeyFile): string {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const file = join(stateDir, KEY_FILE_NAME);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, file);
  return file;
}

/** 鍵ファイルを読む。無い・読めない・形が違うときは null（橋渡しが起きていないと見なす）。 */
export function readKeyFile(stateDir: string): KeyFile | null {
  try {
    const parsed = keyFileSchema.safeParse(JSON.parse(readFileSync(join(stateDir, KEY_FILE_NAME), "utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 自分が書いた鍵ファイルだけを消す（ほかの橋渡しのものは消さない）。 */
export function removeKeyFile(stateDir: string, key: string): void {
  const cur = readKeyFile(stateDir);
  if (cur && cur.key === key) rmSync(join(stateDir, KEY_FILE_NAME), { force: true });
}
