#!/usr/bin/env node
// 公開の前の検査。src/・packs/・skills/・samples/・services/ に前の製品の名前が出たら落とす（README と docs/ は名指しのために除く）。
// テキストと、xlsx などの zip の中の XML を見る。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { inflateRawSync } from "node:zlib";
import { pathToFileURL } from "node:url";

export const SCANNED_DIRS = ["src", "packs", "skills", "samples", "services"];
export const FORBIDDEN = /mxstage|hoshutaro|mx stage|maximo/i;
const ZIP_EXT = new Set([".xlsx", ".xlsm", ".docx", ".pptx"]);
const BINARY_EXT = new Set([".png", ".jpg", ".jpeg", ".pdf", ".woff", ".woff2", ".ico", ".gif", ".webp", ".xls"]);

/** zip の中の .xml と .rels を、名前と文字列の組で返す（最小の読み手。暗号化と zip64 は扱わない）。 */
export function zipTextEntries(buf) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip の終わりの印が見つからない");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("zip の中央の目録が壊れている");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;
    if (!/\.(xml|rels)$/i.test(name)) continue;
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const data = buf.subarray(start, start + csize);
    const raw = method === 0 ? data : method === 8 ? inflateRawSync(data) : null;
    if (raw === null) throw new Error(`扱えない圧縮の形 ${method}: ${name}`);
    out.push({ name, text: raw.toString("utf8") });
  }
  return out;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".venv" || e.name === "__pycache__") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

/** 検査する。戻り値は当たりの一覧と、見たファイルの数。 */
export function checkPublish(root) {
  const hits = [];
  let files = 0;
  for (const d of SCANNED_DIRS) {
    const abs = join(root, d);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    for (const f of walk(abs)) {
      const rel = relative(root, f).replace(/\\/g, "/");
      const ext = extname(f).toLowerCase();
      files++;
      if (FORBIDDEN.test(rel)) hits.push({ file: rel, where: "ファイル名" });
      if (BINARY_EXT.has(ext)) continue;
      const buf = readFileSync(f);
      if (ZIP_EXT.has(ext)) {
        for (const ent of zipTextEntries(buf)) {
          if (FORBIDDEN.test(ent.text)) hits.push({ file: rel, where: ent.name });
        }
        continue;
      }
      if (FORBIDDEN.test(buf.toString("utf8"))) hits.push({ file: rel, where: "本文" });
    }
  }
  return { hits, files };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const root = process.argv[2] ?? process.cwd();
  const { hits, files } = checkPublish(root);
  console.log(`check-publish: ${SCANNED_DIRS.join("・")} の ${files} ファイルを見た`);
  console.log("check-publish: 未実装の検査 — 全国の表の施設名の一覧、【架空】の印（工場ができたら足す）");
  if (hits.length) {
    for (const h of hits) console.log(`  当たり: ${h.file}（${h.where}）`);
    console.log(`check-publish: 当たり ${hits.length} 件`);
    process.exit(1);
  }
  console.log("check-publish: 当たり 0 件");
}
