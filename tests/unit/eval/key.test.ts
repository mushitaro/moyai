// API のキーを読むのは採点の CLI（src/eval/）だけ（docs/security.md）。src/ のほかのコードは ANTHROPIC_API_KEY を読まず、API の SDK も読み込まない。
// 採点の CLI も、キーはあるかどうかだけを見て、値を記録やログに出さない。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const files = readdirSync("src", { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && /\.(ts|tsx|mjs|js)$/.test(d.name))
  .map((d) => join(d.parentPath, d.name).replace(/\\/g, "/"));

test("キーを読むコード（環境変数の ANTHROPIC_API_KEY・API の SDK）は src/eval/ だけ", () => {
  expect(files.length).toBeGreaterThan(50);
  // docs/security.md の文を作る src/shared/security.ts は、キーの名前を文として持つだけなので、読むコードの形だけを数える
  const reads = /env(\.|\[["'])ANTHROPIC_API_KEY|@anthropic-ai\/sdk/;
  const hits = files.filter((f) => reads.test(readFileSync(f, "utf8")));
  expect(hits.length).toBeGreaterThan(0);
  for (const f of hits) expect(f.startsWith("src/eval/"), f).toBe(true);
});

test("採点の CLI はキーの有無だけを見る（値を書き出す所が無い）", () => {
  const text = readFileSync("src/eval/cli.ts", "utf8");
  const uses = [...text.matchAll(/process\.env\.ANTHROPIC_API_KEY[^\n]*/g)].map((m) => m[0]);
  expect(uses).toEqual(["process.env.ANTHROPIC_API_KEY) {"]);
  for (const f of files.filter((x) => x.startsWith("src/eval/"))) expect(readFileSync(f, "utf8")).not.toMatch(/apiKey\s*:/);
});

test("docs/security.md にキーを読む所が書いてある", () => {
  const doc = readFileSync("docs/security.md", "utf8");
  expect(doc).toContain("`src/eval/`");
  expect(doc).toContain("写真の読み取りと MCP のツールはキーを読みません");
});
