// Skill の文の採点の記録の確かめ（scripts/skill-scores/check.mjs・S-C4）：判定はコード。記録が無い・古い・下がったら落ちる
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { checkPack, joinSkills, suiteSha } from "../../scripts/skill-scores/check.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const files = (skill1, skill2, extra = {}) => ({ "skills/moyai/SKILL.md": skill1, "packs/p/SKILL.md": skill2, "eval/p/suite.json": "{}", "eval/p/cases/train.jsonl": "a", "eval/p/cases/test.jsonl": "b", ...extra });
const reader = (m) => (p) => (p in m ? m[p] : null);
const recFor = (m, pass, over = {}) => {
  const s = sha(joinSkills([m["skills/moyai/SKILL.md"], m["packs/p/SKILL.md"]]));
  return [`eval/skill-scores/p/${s.slice(0, 16)}.json`, JSON.stringify({ skillSha: s, suite: "p", suiteSha: suiteSha(reader(m), "p"), pass, cases: 100, runs: [{ solver: "a", pass, failing: [] }, { solver: "b", pass, failing: [] }], ...over })];
};

test("文が base と同じなら通る（記録が無くても）", () => {
  const m = files("一", "二");
  assert.equal(checkPack("p", reader(m), reader(m)).ok, true);
});

test("文を変えて記録が無い・古い（指紋が違う）・問題の組が変わった → 落ちる", () => {
  const base = files("一", "二");
  const now = files("一", "二を直した");
  assert.match(checkPack("p", reader(now), reader(base)).note, /記録が無い/);
  const [k, v] = recFor(now, 80);
  const stale = JSON.parse(v);
  stale.skillSha = "0".repeat(64);
  assert.equal(checkPack("p", reader({ ...now, [k]: JSON.stringify(stale) }), reader(base)).ok, false);
  const wrongSuite = JSON.parse(v);
  wrongSuite.suiteSha = "1".repeat(64);
  assert.match(checkPack("p", reader({ ...now, [k]: JSON.stringify(wrongSuite) }), reader(base)).note, /問題の組/);
});

test("base の記録より合格の数が下がれば落ち、同じか上がれば通る。base に記録が無ければ最初の記録として通る", () => {
  const base = files("一", "二");
  const [bk, bv] = recFor(base, 80);
  const baseWith = { ...base, [bk]: bv };
  const now = files("一を直した", "二");
  const [k, low] = recFor(now, 79);
  assert.match(checkPack("p", reader({ ...now, [k]: low }), reader(baseWith)).note, /下がった/);
  const [, same] = recFor(now, 80);
  assert.equal(checkPack("p", reader({ ...now, [k]: same }), reader(baseWith)).ok, true);
  assert.match(checkPack("p", reader({ ...now, [k]: same }), reader(base)).note, /最初の記録/);
});

test("1 段目の文だけを変えても、指紋が変わって記録を求める", () => {
  const base = files("一", "二");
  assert.equal(checkPack("p", reader(files("一を直した", "二")), reader(base)).ok, false);
});

test("記録の形：別々の解く役 2 つ以上の採点が無い・呼び名が重なる・点が割れている → 落ちる", () => {
  const base = files("一", "二");
  const now = files("一", "二を直した");
  const runs = (xs) => xs.map(([solver, pass]) => ({ solver, pass, failing: [] }));
  for (const [over, re] of [
    [{ runs: runs([["a", 80]]) }, /2 つ以上/],
    [{ runs: undefined }, /2 つ以上/],
    [{ runs: runs([["a", 80], ["a", 80]]) }, /重なって/],
    [{ runs: runs([["a", 80], ["b", 90]]) }, /違う/],
  ]) {
    const [k, v] = recFor(now, 80, over);
    const r = checkPack("p", reader({ ...now, [k]: v }), reader(base));
    assert.equal(r.ok, false);
    assert.match(r.note, re);
  }
});

test("文が同じでも、問題の組が変われば記録を求める", () => {
  const base = files("一", "二");
  const now = files("一", "二", { "eval/p/cases/test.jsonl": "c" });
  assert.match(checkPack("p", reader(now), reader(base)).note, /記録が無い/);
});

test("文が同じで問題の組だけが変わったら、作り直した記録があれば通る（前の記録とは比べない）", () => {
  const base = files("一", "二");
  const [bk, bv] = recFor(base, 100);
  const now = files("一", "二", { "eval/p/cases/test.jsonl": "c" });
  const [k, v] = recFor(now, 90);
  assert.equal(k, bk);
  const r = checkPack("p", reader({ ...now, [k]: v }), reader({ ...base, [bk]: bv }));
  assert.equal(r.ok, true);
  assert.match(r.note, /作り直した/);
});
