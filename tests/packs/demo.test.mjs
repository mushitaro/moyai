// Skillパックの demo/（運営者の決定 11-06「チャットだけで入れる・デモする・消す」）：
// packs/waste-incineration/demo/ に、サンプルのリポジトリ mushitaro/moyai-samples の v4 の 1 施設の資料（どれも【架空】）を写してあること、
// README.md に写した元（commit・道・git の blob・SHA-256）と、チャットでのデモの進め方があること、Skillパックの SKILL.md の「デモ」の節が README を指すこと。
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { zipTextEntries } from "../../scripts/check-publish.mjs";

const PACK = "packs/waste-incineration";
const DEMO = join(PACK, "demo");
const FILES = [
  "【架空】さくら坂焼却場_中長期整備計画_廃止までの整備計画R5改訂R8実績追記_l2様式.xlsx",
  "【架空】さくら坂焼却場_作業日報_令和7年度定期整備業務委託_清書様式.xlsx",
  "【架空】さくら坂焼却場_発注台帳_令和7年度_財務会計CSV.csv",
];
/** 写した元のサンプルのリポジトリの commit（README.md に書いたもの） */
const SAMPLES_COMMIT = "336455bd00604a366981463ecd3fce09f48b44ab";
/** MOYAI に同梱して配るので、資料は合わせて 3 MB まで */
const MAX_BYTES = 3 * 1024 * 1024;

const readme = () => readFileSync(join(DEMO, "README.md"), "utf8");

test("demo/ に 3 つの資料があり、README.md の表の SHA-256 と git の blob がバイト列と合う（中身を書き換えていない）", () => {
  assert.deepEqual(readdirSync(DEMO).sort(), [...FILES, "README.md", "demo.json"].sort());
  const md = readme();
  assert.ok(md.includes(SAMPLES_COMMIT), "README.md に写した元の commit が無い");
  assert.ok(md.includes("mushitaro/moyai-samples"));
  for (const f of FILES) {
    const bytes = readFileSync(join(DEMO, f));
    const row = md.split("\n").find((l) => l.startsWith(`| \`${f}\``));
    assert.ok(row, `README.md の表に ${f} の行が無い`);
    const sha = createHash("sha256").update(bytes).digest("hex");
    const blob = createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
    assert.ok(row.includes(sha), `${f} の SHA-256 が README.md と違う`);
    assert.ok(row.includes(blob), `${f} の git の blob が README.md と違う`);
  }
});

test("資料は合わせて 3 MB まで（MOYAI に同梱して配る）", () => {
  const total = FILES.reduce((a, f) => a + statSync(join(DEMO, f)).size, 0);
  assert.ok(total <= MAX_BYTES, `資料が ${total} バイトある`);
});

test("どの資料にも【架空】と書いてある（実在の施設として読ませない）", () => {
  for (const f of FILES) assert.ok(f.startsWith("【架空】"), `${f} の名前に【架空】が無い`);
  for (const f of FILES.filter((x) => x.endsWith(".csv"))) {
    const csv = new TextDecoder("shift_jis").decode(readFileSync(join(DEMO, f)));
    assert.ok(csv.includes("【架空】"), `${f} に【架空】が無い`);
  }
  for (const f of FILES.filter((x) => x.endsWith(".xlsx"))) {
    const text = zipTextEntries(readFileSync(join(DEMO, f)))
      .map((e) => e.text)
      .join("\n");
    assert.ok(text.includes("【架空】"), `${f} に【架空】が無い`);
  }
  const manifest = JSON.parse(readFileSync(join(DEMO, "demo.json"), "utf8"));
  assert.equal(manifest.facilityName, "【架空】さくら坂焼却場");
  assert.ok(manifest.facilityName.length <= 80);
});

test("README.md に、チャットでのデモの進め方（ツールの順と、確定は人が画面で）がある", () => {
  const md = readFileSync(join(DEMO, "README.md"), "utf8");
  const order = ["intake_add_files", "intake_survey", "intake_settle", "intake_compose", "chart_rows", "確定は人が画面でする"];
  let at = -1;
  for (const w of order) {
    const i = md.indexOf(w, at + 1);
    assert.ok(i > at, `README.md に「${w}」が順に無い`);
    at = i;
  }
  assert.ok(md.includes("source: demo"));
  assert.ok(md.includes("【架空】"));
  for (const old of ["決定のシート", "印", "束", "輪"]) assert.ok(!md.includes(old), `README.md に使わない言葉「${old}」がある`);
});

test("Skillパックの SKILL.md に「デモ」（Demo）の節があり、demo/README.md を指す", () => {
  const md = readFileSync(join(PACK, "SKILL.md"), "utf8");
  const at = md.indexOf("\n## Demo\n");
  assert.ok(at > 0, "SKILL.md に「## Demo」の節が無い");
  const section = md.slice(at, md.indexOf("\n## ", at + 1) > 0 ? md.indexOf("\n## ", at + 1) : undefined);
  assert.ok(section.includes("demo/README.md"));
  assert.ok(section.includes("intake_add_files"));
  assert.ok(existsSync(join(DEMO, "README.md")));
});
