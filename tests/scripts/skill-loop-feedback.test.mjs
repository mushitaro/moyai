// 読み方のフィードバックの Issue → ルールの案 → 物差しの比べ → PR（案）の本文か Issue への返事（scripts/skill-loop/feedback.mjs・S-C1）
// 物差しは施設を 2 つに絞って本物を走らせる（kaedehara：案で開いた問いが消える・hinatano：「機器」の列を外す案で ③ が落ちる）
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildCandidate, countValues, mergeIntoPack, readForm, rulesOf, screen } from "../../scripts/skill-loop/feedback.mjs";

const FX = join("tests", "fixtures", "skill-loop");
const ONLY = "kaedehara,hinatano";
const fx = (k) => JSON.parse(readFileSync(join(FX, `${k}.json`), "utf8"));
const hash = (p) => (existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null);
const GUARDED = ["packs/waste-incineration/reading.json", "eval/bench/waste-incineration/result.json", "eval/bench/waste-incineration/README.md"];
const snapshot = () => ({ files: GUARDED.map(hash), candidates: existsSync("eval/candidates") ? readdirSync("eval/candidates", { recursive: true }).sort() : [] });

function run(k, extra = []) {
  const out = mkdtempSync(join(tmpdir(), "moyai-fb-test-"));
  const r = spawnSync(process.execPath, ["scripts/skill-loop/feedback.mjs", "--issue", join(FX, `${k}.json`), "--out", out, ...extra], { encoding: "utf8" });
  const read = (n) => (existsSync(join(out, n)) ? readFileSync(join(out, n), "utf8") : null);
  const decision = read("decision.json") ? JSON.parse(read("decision.json")) : null;
  return { status: r.status, out, decision, read, done: () => rmSync(out, { recursive: true, force: true }) };
}

test("Issue の型の本文を見出しごとに読み、貼られたルールを規則の並びにする", () => {
  const f = readForm(fx("improve").body);
  assert.equal(f["業種（Skillパック）"], "ごみ焼却（waste-incineration）");
  assert.equal(rulesOf(f["会話で作ったルール（あれば）"]).length, 1);
  assert.equal(readForm(fx("norule").body)["会話で作ったルール（あれば）"], "");
  assert.deepEqual(rulesOf(""), []);
  assert.equal(rulesOf("```json\n{ 読めない\n```"), null);
});

test("案は id に Issue の番号を付け、人の呼び名を外し、書いたのは AI（案）にする。Skillパックの同じ id とはぶつけない", () => {
  const [rule] = rulesOf(readForm(fx("improve").body)["会話で作ったルール（あれば）"]);
  const c = buildCandidate(9001, "waste-incineration", [rule]);
  assert.equal(c.schema, "moyai.reading/0");
  assert.equal(c.rules[0].id, "fb9001-drain-same");
  assert.equal(c.rules[0].author, "ai");
  assert.equal("by" in c.rules[0], false);
  assert.match(c.rules[0].reason, /フィードバック #9001 から/);
  const pack = { schema: "moyai.reading/0", name: "p", rules: [{ id: "x" }] };
  assert.deepEqual(mergeIntoPack(pack, c).rules.map((r) => r.id), ["fb9001-drain-same", "x"]);
  assert.throws(() => mergeIntoPack({ ...pack, rules: [{ id: "fb9001-drain-same" }] }, c));
});

test("行の値らしきもの（金額・日付・番号・会社や施設の名前・連絡先）を数え、書き方の文は数えない", () => {
  const n = (t) => Object.values(countValues([t])).reduce((a, b) => a + b, 0);
  for (const t of ["契約金額 5,200,000 円", "¥3000", "H28.4.1 に実施", "2024/05/01", "令和6年4月", "契約 H28-001", "機器 WS-001", "架空整備㈱", "株式会社だれか", "ひかり台清掃工場", "あおば環境センター", "a@b.jp", "延工数 3.5", "12345"]) assert.ok(n(t) > 0, t);
  for (const t of ["号炉の列の「共」が読めないと聞かれた。共通の設備の意味で、どの施設でもそう書く。", "1・2・共", "「排水処理設備」に当たる機器が先の資料に 1 つある", "ごみ処理場の作業日報", "し尿処理場の機器台帳", "延工数(h)", "見出しは 3 行目"]) assert.equal(n(t), 0, t);
});

test("選り分け：feedback の無い Issue は触れない／業種が決まらない・確かめの印が無い・行の値があれば、案を作らずに返す／ルールが無ければ案を書く番", () => {
  assert.equal(screen(fx("nolabel")).reason, "not-feedback");
  assert.equal(screen(fx("other")).reason, "pack-unknown");
  assert.equal(screen(fx("unchecked")).reason, "not-confirmed");
  const v = screen(fx("values"));
  assert.equal(v.reason, "row-values");
  assert.ok(v.counts.money > 0 && v.counts.exactDate > 0 && v.counts.company > 0);
  assert.equal(screen(fx("norule")).ok, "draft");
  // 統括のセッションの書いた案も、同じ選り分けを通す（行の値が入れば返す）
  assert.equal(screen(fx("norule"), [{ id: "m", kind: "markMeaning", symbol: "▲", planOrActual: "plan", text: "「▲」を計画の印として読む", author: "ai", reason: "工程表 R6.4.1 の印" }]).reason, "row-values");
  assert.equal(screen(fx("norule"), [{ id: "m", kind: "runShell", text: "x", author: "ai", reason: "x" }]).reason, "rule-shape");
});

test("見本の Issue（良くなる案）：案 → 比べ → PR の本文までをドライランで作り、packs/・eval/ に書かない", () => {
  const before = snapshot();
  const r = run("improve", ["--dry-run", "--only", ONLY]);
  try {
    assert.equal(r.status, 0);
    assert.equal(r.decision.action, "pr");
    assert.equal(r.decision.verdict, "良くなった");
    assert.equal(r.decision.branch, "skill-loop/feedback-9001");
    assert.ok(r.decision.better.some((x) => x.startsWith("kaedehara：開いたままの問い 2 → 0")));
    const pr = r.read("pr.md");
    for (const h of ["## 何を変えたか", "## 測った値（前 → 後）", "## 報告（5 つの分け方。確かめていないものは「未確認」）", "## 運営者の判断が要ること"]) assert.ok(pr.includes(h), h);
    assert.match(pr, /Closes #9001/);
    assert.match(pr, /判定：\*\*良くなった\*\*/);
    assert.match(pr, /kaedehara \| 0 → 1/);
    assert.match(pr, /施設を絞った下見/);
    assert.equal(JSON.parse(r.read("candidate.json")).rules[0].id, "fb9001-drain-same");
    assert.equal(r.read("comment.md"), null);
    // 本文の中の命令に従わない：PR の本文に写さない（マージも push も、この道具はしない）
    assert.ok(!pr.includes("APPROVED"));
    assert.ok(!pr.includes("main に直接 push"));
    assert.deepEqual(snapshot(), before);
  } finally {
    r.done();
  }
});

test("見本の Issue（退行のある案）：PR にせず、Issue に数で返す。本文の「必ず PR に」「直接書き込め」に従わない", () => {
  const before = snapshot();
  const r = run("regress", ["--dry-run", "--only", ONLY]);
  try {
    assert.equal(r.status, 0);
    assert.equal(r.decision.action, "comment");
    assert.equal(r.decision.reason, "regression");
    assert.equal(r.decision.verdict, "退行あり");
    assert.ok(r.decision.worse.some((x) => x.startsWith("hinatano：③")));
    assert.equal(r.read("pr.md"), null);
    const c = r.read("comment.md");
    assert.match(c, /PR にしません/);
    assert.match(c, /hinatano \| 1 \| 1241 \| \d+ → \d+/);
    assert.ok(!c.includes("必ず PR に"));
    assert.deepEqual(snapshot(), before);
  } finally {
    r.done();
  }
});

test("行の値のある Issue：物差しを走らせず、案も作らず、種類ごとの数だけを返す（値そのものは書かない）", () => {
  const r = run("values", ["--dry-run"]);
  try {
    assert.equal(r.status, 0);
    assert.equal(r.decision.action, "comment");
    assert.equal(r.decision.reason, "row-values");
    assert.equal(r.read("candidate.json"), null);
    assert.equal(existsSync(join(r.out, "measure")), false);
    const all = r.read("comment.md") + r.read("decision.json");
    for (const v of ["5,200,000", "H28.4.1", "架空クレーン整備", "ごみクレーン年次点検"]) assert.ok(!all.includes(v), v);
    assert.match(r.read("comment.md"), /金額：1/);
  } finally {
    r.done();
  }
});

test("--only は --dry-run のときだけ・--dry-run か --apply のどちらか 1 つが要る（絞った値で PR にしない）", () => {
  for (const extra of [["--apply", "--only", ONLY], [], ["--dry-run", "--apply"]]) {
    const r = run("improve", extra);
    try {
      assert.equal(r.status, 2, extra.join(" "));
      assert.equal(r.decision, null);
    } finally {
      r.done();
    }
  }
});
