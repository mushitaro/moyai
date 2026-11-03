// ビルドした画面のファイルを返す。道は許可の一覧（/ と /assets/）だけで、フォルダの外へは出ない。
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** 返すファイルの中身と形。無い・外へ出る・知らない形なら null。 */
export async function loadStatic(root: string, pathname: string): Promise<{ body: Buffer; type: string; immutable: boolean } | null> {
  const rel = pathname === "/" ? "index.html" : pathname.slice(1);
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const base = resolve(root);
  const abs = resolve(base, decoded);
  if (abs !== base && !abs.startsWith(base + sep)) return null;
  const type = TYPES[extname(abs).toLowerCase()];
  if (!type) return null;
  try {
    return { body: await readFile(abs), type, immutable: pathname.startsWith("/assets/") };
  } catch {
    return null;
  }
}
