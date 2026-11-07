#!/usr/bin/env node
// 受け口（Workers）に入れるパックの部品を、packs/ から作る：services/ledger-intake/src/packs.gen.ts。
// 公開語彙と全国の表は、文字列のバイト列のハッシュで台帳の決まりと照らすので、ファイルの中身をそのまま文字列で持つ。
// 共有を切っていて（sharing: "off"）、公開語彙か全国の表の無いパックは入れない。
// packs/ を変えたら走らせる：node services/ledger-intake/scripts/gen-packs.mjs（同じかどうかは試験が確かめる）。
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", "..");
const packsDir = join(root, "packs");
const out = join(here, "..", "src", "packs.gen.ts");

const texts = {};
for (const id of readdirSync(packsDir).sort()) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(id)) continue;
  const packFile = join(packsDir, id, "pack.json");
  if (!existsSync(packFile)) continue;
  const pack = JSON.parse(readFileSync(packFile, "utf8"));
  if (pack.sharing === "off") continue;
  const vocabRel = typeof pack.vocab === "string" ? pack.vocab : "vocab.json";
  const tableRel = typeof pack.national?.table === "string" ? pack.national.table : "national/table.json";
  if (vocabRel.includes("..") || tableRel.includes("..")) continue;
  const vocabPath = join(packsDir, id, vocabRel);
  const tablePath = join(packsDir, id, tableRel);
  if (!existsSync(vocabPath) || !existsSync(tablePath)) continue;
  texts[id] = { vocab: readFileSync(vocabPath, "utf8"), table: readFileSync(tablePath, "utf8") };
}

const lines = [
  "// 作ったファイル（手で直さない）。services/ledger-intake/scripts/gen-packs.mjs が packs/ から作る。",
  "// 受け口が台帳の検証に使う公開語彙と全国の表。ハッシュは文字列のバイト列で決まるので、ファイルの中身をそのまま持つ。",
  "export const PACK_TEXTS: Record<string, { vocab: string; table: string }> = {",
  ...Object.entries(texts).map(([id, t]) => `  ${JSON.stringify(id)}: {\n    vocab: ${JSON.stringify(t.vocab)},\n    table: ${JSON.stringify(t.table)},\n  },`),
  "};",
  "",
];
writeFileSync(out, lines.join("\n"));
process.stderr.write(`gen-packs: ${Object.keys(texts).length} パック\n`);
