// 見ていない様式の組のハッシュ（docs/plan.md §2.6）：組のフォルダの、measured/ を除くすべてのファイルの SHA-256 を、
// 道（/ で区切った相対の道）の順に「<SHA-256>  <道>\n」と並べ、その並びの SHA-256 を組のハッシュにする。
// 中身を公開する前に、このハッシュだけをコミットする（samples/heldout/hashes/<組>.json）。公開したあと、試験が同じハッシュになることを確かめる。
//
// 使い方：node scripts/heldout/hash.mjs <組のフォルダ> [<出す JSON>]
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** 組のフォルダの中の、measured/ を除くファイルの相対の道（/ 区切り、並べた順） */
export function bundleFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      const rel = relative(dir, p).split(sep).join("/");
      if (rel === "measured" || rel.startsWith("measured/")) continue;
      if (e.isSymbolicLink()) throw new Error(`${rel} は symlink（組に入れない）`);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(rel);
    }
  };
  walk(dir);
  // 道の順はコードの単位で比べる（言語の並べ方に依らない）
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export function bundleHash(dir) {
  const files = bundleFiles(dir).map((path) => ({ path, sha256: createHash("sha256").update(readFileSync(join(dir, path))).digest("hex"), bytes: statSync(join(dir, path)).size }));
  const list = files.map((f) => `${f.sha256}  ${f.path}\n`).join("");
  return { bundle: createHash("sha256").update(list, "utf8").digest("hex"), files };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  const [, , dir, out] = process.argv;
  if (!dir) {
    console.error("使い方：node scripts/heldout/hash.mjs <組のフォルダ> [<出す JSON>]");
    process.exit(2);
  }
  const h = bundleHash(dir);
  const text = `${JSON.stringify(h, null, 1)}\n`;
  if (out) writeFileSync(out, text, "utf8");
  else process.stdout.write(text);
  console.error(`組のハッシュ ${h.bundle}（ファイル ${h.files.length}）`);
}
