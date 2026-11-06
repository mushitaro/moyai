// Skillパックの demo/（運営者の決定 11-06「チャットだけで入れる・デモする・消す」）：
// packs/waste-incineration/demo/ に、サンプルの fictional-1 の 3 つの資料（どれも【架空】）を写してあること、
// README.md にチャットでのデモの進め方があること、Skillパックの SKILL.md の「デモ」の節が README を指すこと。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { zipTextEntries } from "../../scripts/check-publish.mjs";

const PACK = "packs/waste-incineration";
const DEMO = join(PACK, "demo");
const SAMPLE = "samples/out/waste-incineration/fictional-1";
const FILES = ["daily-report.csv", "equipment-ledger.xlsx", "plan-hoshitori.xlsx"];

test("demo/ に 3 つの資料があり、サンプルの fictional-1 と同じバイト列", () => {
  assert.deepEqual(readdirSync(DEMO).sort(), [...FILES, "README.md", "demo.json"].sort());
  for (const f of FILES) assert.ok(readFileSync(join(DEMO, f)).equals(readFileSync(join(SAMPLE, f))), `${f} がサンプルと違う`);
});

test("どの資料にも【架空】と書いてある（実在の施設として読ませない）", () => {
  const csv = new TextDecoder("shift_jis").decode(readFileSync(join(DEMO, "daily-report.csv")));
  assert.ok(csv.includes("【架空】"), "daily-report.csv に【架空】が無い");
  for (const f of FILES.filter((x) => x.endsWith(".xlsx"))) {
    const text = zipTextEntries(readFileSync(join(DEMO, f)))
      .map((e) => e.text)
      .join("\n");
    assert.ok(text.includes("【架空】"), `${f} に【架空】が無い`);
  }
  const manifest = JSON.parse(readFileSync(join(DEMO, "demo.json"), "utf8"));
  assert.match(manifest.facilityName, /^【架空】/);
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

test("Skillパックの SKILL.md に「デモ」の節があり、demo/README.md を指す", () => {
  const md = readFileSync(join(PACK, "SKILL.md"), "utf8");
  const at = md.indexOf("\n## デモ\n");
  assert.ok(at > 0, "SKILL.md に「## デモ」の節が無い");
  const section = md.slice(at, md.indexOf("\n## ", at + 1) > 0 ? md.indexOf("\n## ", at + 1) : undefined);
  assert.ok(section.includes("demo/README.md"));
  assert.ok(section.includes("intake_add_files"));
  assert.ok(existsSync(join(DEMO, "README.md")));
});
