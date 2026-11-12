#!/usr/bin/env node
// Skill の文の採点の記録を確かめる（柱 C・S-C4。運営者の判断 #23 の 2、2026-11-12）。CI は Claude を動かせないので、記録だけを見る。
// 使い方：node scripts/skill-scores/check.mjs [--base <git の ref>]
//   eval/skill-scores/<パック>/ のあるパック（記録を置いたパック）ごとに、今の文（1 段目 skills/moyai/SKILL.md ＋ packs/<パック>/SKILL.md。
//   src/eval/score.ts と同じつなぎ方）の指紋を出し、次を確かめる：
//   確かめるパックは、問題の組（eval/<組>/suite.json の pack）のあるパックと、記録を置いたパック（eval/skill-scores/<パック>/）の両方（2026-11-12。
//   前は記録のフォルダの無いパックを黙って飛ばしていて、し尿処理の文が一度も採点されていなかった）。
//   1. どのパックも、今の文の指紋の記録（<指紋の頭 16 字>.json）が要る（文と問題の組が --base と同じでも。無ければ落ちる）
//   2. 記録は今の文の指紋の記録（<指紋の頭 16 字>.json）があり、指紋と問題の組の指紋（suiteSha）が今と合う（無い・古い → 落ちる）
//   3. 記録の形：正解を見ていない別々の解く役 2 つ以上の採点（runs）があり、合格の数がどれも記録の合格の数と同じ（違う・足りない → 落ちる）
//   4. --base の文の記録が --base にあれば、合格の数が下がっていない（下がった → 落ちる）。--base に記録が無ければ、比べずに通す（最初の記録）
// 判定はコードがする（AI に判定させない）。API を呼ばない。
// 終了コード：通る 0・落ちる 1・道具の失敗 2
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const lf = (s) => s.replace(/\r\n/g, "\n");
export const skillPathsOf = (pack) => ["skills/moyai/SKILL.md", `packs/${pack}/SKILL.md`];
export const joinSkills = (texts) => texts.map((t) => lf(t).trim()).join("\n\n");
export const MIN_SOLVERS = 2;

/** 記録の形の誤り（無ければ null） */
export function recordShapeProblem(rec) {
  if (!Array.isArray(rec.runs) || rec.runs.length < MIN_SOLVERS) return `解く役の採点が ${Array.isArray(rec.runs) ? rec.runs.length : 0}（${MIN_SOLVERS} つ以上が要る）`;
  const names = rec.runs.map((r) => (typeof r?.solver === "string" ? r.solver.trim() : ""));
  if (names.some((n) => !n) || new Set(names).size !== names.length) return "解く役の呼び名が空か重なっている";
  if (rec.runs.some((r) => r.pass !== rec.pass)) return `解く役によって合格の数が違う（${rec.runs.map((r) => r.pass).join("・")}）か、記録の合格の数（${rec.pass}）と合わない`;
  return null;
}

export const suiteSha = (read, name) => sha([read(`eval/${name}/suite.json`), read(`eval/${name}/cases/train.jsonl`), read(`eval/${name}/cases/test.jsonl`)].map((x) => lf(x ?? "")).join("\n\u0000\n"));

/**
 * 1 つのパックを確かめる（純な関数。read は今の木、readBase は --base の木の読み方。無いファイルは null）
 * @returns {{ ok: boolean, note: string }}
 */
export function checkPack(pack, read, readBase) {
  const texts = skillPathsOf(pack).map(read);
  if (texts.some((t) => t === null)) return { ok: false, note: `${pack}：Skill の文が無い` };
  const now = sha(joinSkills(texts));
  // 文も問題の組も base と同じか（同じなら、記録があることだけを見て、前の記録とは比べない）
  const unchanged = (() => {
    if (!readBase) return false;
    const bt = skillPathsOf(pack).map(readBase);
    return bt.every((t) => t !== null) && sha(joinSkills(bt)) === now && suiteSha(readBase, pack) === suiteSha(read, pack);
  })();
  const recText = read(`eval/skill-scores/${pack}/${now.slice(0, 16)}.json`);
  if (recText === null) return { ok: false, note: `${pack}：今の文（指紋 ${now.slice(0, 16)}）の採点の記録が無い。docs/autonomy.md の「Skill の文を変える PR」の手順で採点して記録を置く` };
  const rec = JSON.parse(recText);
  if (rec.skillSha !== now) return { ok: false, note: `${pack}：記録の文の指紋が今の文と合わない（古い記録）` };
  const shape = recordShapeProblem(rec);
  if (shape) return { ok: false, note: `${pack}：記録の形が違う（${shape}）。docs/autonomy.md の手順で、別々の解く役 2 つで採点し直す` };
  const suite = rec.suite;
  if (rec.suiteSha !== suiteSha(read, suite)) return { ok: false, note: `${pack}：記録の問題の組（${suite}）の指紋が今と合わない（問題の組が変わった。採点し直す）` };
  if (!readBase) return { ok: true, note: `${pack}：記録あり（${rec.pass}/${rec.cases}）。比べる相手を指していない` };
  if (unchanged) return { ok: true, note: `${pack}：文も問題の組も変わっていない。記録あり（${rec.pass}/${rec.cases}）` };
  const bt = skillPathsOf(pack).map(readBase);
  const baseSha = bt.every((t) => t !== null) ? sha(joinSkills(bt)) : null;
  const baseRecText = baseSha ? readBase(`eval/skill-scores/${pack}/${baseSha.slice(0, 16)}.json`) : null;
  if (baseRecText === null) return { ok: true, note: `${pack}：記録あり（${rec.pass}/${rec.cases}）。比べる前の記録が無い（最初の記録）` };
  // 文が同じで問題の組だけが変わった：前の記録は同じ道の古い記録で、今の記録が置き換える（比べる相手にしない）
  if (baseSha === now) return { ok: true, note: `${pack}：文は同じ。問題の組が変わったので記録を作り直した（${rec.pass}/${rec.cases}）` };
  const base = JSON.parse(baseRecText);
  if (base.suiteSha !== rec.suiteSha) return { ok: false, note: `${pack}：前の記録と問題の組が違うので比べられない（前の文も今の問題の組で採点し直す）` };
  if (rec.pass < base.pass) return { ok: false, note: `${pack}：合格の数が下がった（${base.pass}/${base.cases} → ${rec.pass}/${rec.cases}）` };
  return { ok: true, note: `${pack}：${base.pass}/${base.cases} → ${rec.pass}/${rec.cases}（下がっていない）` };
}

/** 確かめるパック：問題の組（eval/<組>/suite.json の pack）と、記録を置いたパック（eval/skill-scores/<パック>/）の両方 */
export function packsToCheck(root) {
  const out = new Set();
  const evalDir = join(root, "eval");
  if (existsSync(evalDir))
    for (const d of readdirSync(evalDir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const f = join(evalDir, d.name, "suite.json");
      if (!existsSync(f)) continue;
      const pack = JSON.parse(readFileSync(f, "utf8")).pack;
      if (typeof pack === "string" && /^[a-z0-9-]+$/.test(pack)) out.add(pack);
    }
  const scores = join(evalDir, "skill-scores");
  if (existsSync(scores)) for (const d of readdirSync(scores, { withFileTypes: true })) if (d.isDirectory()) out.add(d.name);
  return [...out].sort();
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const bi = args.indexOf("--base");
  const base = bi >= 0 ? args[bi + 1] : null;
  const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : null);
  const readBase = base
    ? (p) => {
        try {
          return execFileSync("git", ["show", `${base}:${p}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
        } catch {
          return null;
        }
      }
    : null;
  const packs = packsToCheck(".");
  if (!packs.length) {
    console.error("skill-scores: 問題の組も記録も無い（確かめることは無い）");
    process.exit(0);
  }
  let bad = false;
  for (const pack of packs) {
    let r;
    try {
      r = checkPack(pack, read, readBase);
    } catch (e) {
      console.error(`skill-scores: ${pack}：記録が読めない（${e instanceof Error ? e.message : String(e)}）`);
      process.exit(2);
    }
    console.error(`skill-scores: ${r.ok ? "✓" : "✗"} ${r.note}`);
    if (!r.ok) bad = true;
  }
  process.exit(bad ? 1 : 0);
}
