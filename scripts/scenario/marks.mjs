// シナリオテスト（docs/scenarios.md）の印ごとの合否を決める関数と、結果の表（eval/scenario/result.md）の書き方。
// 判定はコードがする（AI に決めさせない）。ここは走らせない：走らせるのは scripts/scenario/run.mjs。
// 合格の条件は docs/scenarios.md のとおり。甘くしない：分からないものは「未確認」、作られていないものは「待ち」。

export const PASS = "合格";
export const FAIL = "不合格";
export const UNKNOWN = "未確認";
export const WAIT = "待ち";

/** 表に並べる印（docs/scenarios.md の順）。auto は npm run scenario が判定する印。それ以外は実機の列だけ（統括が書く） */
export const MARKS = [
  { id: "S-0", title: "初めての人の通し（M-PC3 の Claude Desktop）", auto: false, note: "自動の代わりは walkthrough.spec（D2 に含む）" },
  { id: "A1", title: "物差しで全施設の計画・開いた問い 0・記録より下がらない", auto: true },
  { id: "A1b", title: "同じ物差しで施設ごとに ⑤ 50 以下・③ 80% 以上・⑥ 70% 以上", auto: true },
  { id: "A2", title: "見ていない様式で計画ができる（1 回だけ測る）", auto: false, note: "1 回だけ（docs/plan.md §2.6、#18）。npm run scenario では走らせない" },
  { id: "A3", title: "初めて読む物差しで施設ごとに計画・1 年目の問い 50 以下・③ 80% 以上・⑥ 70% 以上・答えの間違い 0（残りの年度の条件は #67）", auto: true },
  { id: "A4", title: "S-0 の 3 が M-PC3 で通る", auto: false },
  { id: "B1", title: "台帳は moyai-ledger、切り替えが main、台帳の試験が全部通る", auto: true },
  { id: "B2", title: "手元の受け口と偽の GitHub で 1 本通り、断る試験も通る", auto: true },
  { id: "B3", title: "本物の受け口で【架空】の共有ファイルが PR になり ✓", auto: false },
  { id: "C1", title: "フィードバックの Issue → ルールの案 → 物差し → draft PR", auto: true },
  { id: "C2", title: "本物の GitHub で C1 が毎日の回しの中で 1 本通る", auto: false },
  { id: "C3", title: "アプリからのフィードバックの書き出しが C1 の道に乗る", auto: true },
  { id: "C4", title: "Skill の文の採点（#23 の判断のとおり）", auto: true },
  { id: "D1", title: "確定した計画で、出力・共有の選び・入力 0、主ボタン 1", auto: true },
  { id: "D2", title: "e2e が全部通る（walkthrough・mcp・claude-code を含む。ubuntu・windows）", auto: true },
  { id: "D3", title: "開いている area:ux の Issue が 0", auto: true },
  { id: "D4", title: "S-0 の 4〜6 が M-PC3 で通り、運営者が迷わなかった", auto: false },
  { id: "E1", title: "毎日の回しが 3 日続けて運営者の手なしで回る", auto: false },
  { id: "E2", title: "CI（ubuntu・windows・pack-bench・scenario）が main で緑", auto: true },
  { id: "E3", title: "S-0 の 7（自動の更新）が M-PC3 で通る", auto: false },
];

const r = (status, evidence) => ({ status, evidence });

/**
 * A1：物差しの結果（moyai.pack-bench.result/0）と、記録した表との比べ（compare.mjs の --strict と同じ「数が 1 つでも違えば外れ」）
 * @param {{ facilities: Array<{facility:string, planMade:boolean, open:number, error?:string|null}> } | null} result
 * @param {{ same: boolean | null, detail: string }} strict  same が null なら比べていない
 */
export function judgeA1(result, strict) {
  if (!result) return r(UNKNOWN, "物差しの結果を読めない");
  const fs = result.facilities ?? [];
  if (fs.length === 0) return r(FAIL, "物差しの施設が 0");
  const made = fs.filter((f) => f.planMade && !f.error).length;
  const open = fs.reduce((a, f) => a + (Number(f.open) || 0), 0);
  const ev = `計画 ${made}/${fs.length} 施設・開いたままの問い ${open}・記録との比べ：${strict.detail}`;
  if (strict.same === false) return r(FAIL, ev);
  if (made !== fs.length || open !== 0) return r(FAIL, ev);
  if (strict.same === null) return r(UNKNOWN, ev);
  return r(PASS, ev);
}

/** A1b の下限（docs/scenarios.md） */
export const A1B = { asked: 50, accuracy: 0.8, recovery: 0.7 };
const ratio = (x) => (x && x.total > 0 ? x.correct / x.total : null);
const pct = (v) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

/**
 * A1b：同じ物差しで、施設ごとに ⑤ 質問（asked）50 以下・③（accuracy）80% 以上・⑥（recovery）70% 以上。測れない（—）は外れ
 * @param {{ facilities: Array<{facility:string, asked:number, accuracy:{correct:number,total:number}|null, recovery:{correct:number,total:number}|null}> } | null} result
 */
export function judgeA1b(result, strict) {
  if (!result) return r(UNKNOWN, "物差しの結果を読めない");
  const fs = result.facilities ?? [];
  if (fs.length === 0) return r(FAIL, "物差しの施設が 0");
  const bad = fs.filter((f) => {
    const a = ratio(f.accuracy);
    const v = ratio(f.recovery);
    return !(Number(f.asked) <= A1B.asked) || a === null || a < A1B.accuracy || v === null || v < A1B.recovery;
  });
  const ok = fs.length - bad.length;
  const ev = `下限を満たす施設 ${ok}/${fs.length}${bad.length ? `（外れ：${bad.slice(0, 6).map((f) => `${f.facility} ⑤${f.asked}・③${pct(ratio(f.accuracy))}・⑥${pct(ratio(f.recovery))}`).join("、")}${bad.length > 6 ? ` ほか ${bad.length - 6}` : ""}）` : ""}・記録との比べ：${strict.detail}`;
  if (strict.same === false || bad.length > 0) return r(FAIL, ev);
  if (strict.same === null) return r(UNKNOWN, ev);
  return r(PASS, ev);
}

/**
 * A3：初めて読む物差し（pack-bench --first-read の結果。docs/scenarios.md、#93）。測った施設（年度ごとの資料のある施設）すべてで、
 * 計画ができ、1 年目の問い（firstAsked）50 以下・③ 80% 以上・⑥ 70% 以上（A1b と同じ下限）・人に聞かずに決めた答えの間違い（ruleWrong）0。記録との比べは A1 と同じ。
 * 残りの年度の問いの条件は決め直し中（#67）なので判定に入れない：ほかが全部そろっても「待ち」
 * @param {{ facilities: Array<{facility:string, planMade:boolean, error?:string|null, accuracy:{correct:number,total:number}|null, recovery:{correct:number,total:number}|null, firstRead?: {firstAsked:number, ruleWrong?:number}}> } | null} result
 */
export function judgeA3(result, strict) {
  if (!result) return r(UNKNOWN, "初めて読む物差しの結果を読めない");
  const fs = (result.facilities ?? []).filter((f) => f.firstRead);
  if (fs.length === 0) return r(FAIL, "初めて読む物差しで測った施設が 0");
  const why = (f) => {
    const out = [];
    if (!f.planMade || f.error) out.push("計画なし");
    if (!(f.firstRead.firstAsked <= A1B.asked)) out.push(`1 年目の問い ${f.firstRead.firstAsked}`);
    const a = ratio(f.accuracy);
    const v = ratio(f.recovery);
    if (a === null || a < A1B.accuracy) out.push(`③${pct(a)}`);
    if (v === null || v < A1B.recovery) out.push(`⑥${pct(v)}`);
    if (f.firstRead.ruleWrong === undefined) out.push("答えの間違いを測っていない");
    else if (f.firstRead.ruleWrong !== 0) out.push(`答えの間違い ${f.firstRead.ruleWrong}`);
    // 残りの年度で、1 年目に見た問い（同じ問いで正しい答えも同じ）を二度聞かない（物差しの (a)。#67）
    if (f.firstRead.askedAgain === undefined) out.push("1 年目に見た問いを測っていない");
    else if (f.firstRead.askedAgain !== 0) out.push(`1 年目に見た問い ${f.firstRead.askedAgain}`);
    return out;
  };
  const bad = fs.map((f) => ({ f, w: why(f) })).filter((x) => x.w.length);
  const ev = `下限を満たす施設 ${fs.length - bad.length}/${fs.length}${bad.length ? `（外れ：${bad.slice(0, 5).map((x) => `${x.f.facility} ${x.w.join("・")}`).join("、")}${bad.length > 5 ? ` ほか ${bad.length - 5}` : ""}）` : ""}・記録との比べ：${strict.detail}`;
  if (strict.same === false || bad.length > 0) return r(FAIL, ev);
  if (strict.same === null) return r(UNKNOWN, ev);
  return r(PASS, ev);
}

/** C1 の台本の試験のうち、合格に要るもの（題の頭で名指す。消えれば不合格） */
export const C1_REQUIRED = ["見本の Issue（良くなる案）", "見本の Issue（退行のある案）", "行の値のある Issue"];

/**
 * C1：読み方のフィードバックの Issue（見本）→ ルールの案 → 物差しの比べ → PR の本文（ドライラン）の台本の試験（tests/scripts/skill-loop-feedback.test.mjs）。
 * 本物の GitHub に draft PR を開くのは毎日の回し（C2 で確かめる）
 * @param {Array<{ name: string, status: string }> | null} tests
 */
export function judgeC1(tests) {
  if (!tests) return r(UNKNOWN, "C1 の台本の試験を走らせていない");
  const passed = tests.filter((t) => t.status === "passed").length;
  const missing = C1_REQUIRED.filter((h) => !tests.some((t) => t.name.startsWith(h) && t.status === "passed"));
  const ev = `skill-loop-feedback の試験 ${passed}/${tests.length}${missing.length ? `・通っていない名指しの試験：${missing.join("、")}` : ""}（見本の Issue から PR の本文まで。draft PR を開くのは C2）`;
  if (tests.length === 0 || passed !== tests.length || missing.length) return r(FAIL, ev);
  return r(PASS, ev);
}

/** C3 に要る試験（題の頭で名指す。消えれば不合格）。書き出しの芯（reading-feedback.test.ts）と C1 の台本（skill-loop-feedback.test.mjs） */
export const C3_UNIT = ["保存は人だけの経路", "書き出したファイルを Issue に貼ると"];
export const C3_LOOP = ["アプリから書き出したファイル"];

/**
 * C3：アプリからの書き出し（#23 の 1：人が押したときだけ・全文を見せてから・形と数だけ）が C1 の道に乗る。
 * 書き出しの芯と保存の経路の試験・C1 の台本で書き出したファイルを貼った Issue の試験・画面で押して書き出す e2e（slice.spec）
 * @param {Array<{ name: string, status: string }> | null} unit  tests/unit/share/reading-feedback.test.ts
 * @param {Array<{ name: string, status: string }> | null} loop  tests/scripts/skill-loop-feedback.test.mjs
 * @param {{ expected: number, unexpected: number, flaky: number, skipped: number } | null} slice  slice.spec の e2e の数
 */
export function judgeC3(unit, loop, slice) {
  const parts = [];
  let fail = false;
  let unknown = false;
  const named = (tests, heads, label) => {
    if (!tests) {
      unknown = true;
      parts.push(`${label}を走らせていない`);
      return;
    }
    const passed = tests.filter((t) => t.status === "passed").length;
    const missing = heads.filter((h) => !tests.some((t) => t.name.startsWith(h) && t.status === "passed"));
    if (tests.length === 0 || passed !== tests.length || missing.length) fail = true;
    parts.push(`${label} ${passed}/${tests.length}${missing.length ? `（通っていない名指しの試験：${missing.join("、")}）` : ""}`);
  };
  named(unit, C3_UNIT, "書き出しの芯と保存の経路の試験");
  named(loop, C3_LOOP, "C1 の台本の試験");
  if (!slice) {
    unknown = true;
    parts.push("画面で書き出す e2e（slice.spec）を走らせていない");
  } else {
    const ok = slice.expected > 0 && slice.unexpected + slice.flaky + slice.skipped === 0;
    if (!ok) fail = true;
    parts.push(`画面で押して全文を見せ保存する e2e（slice.spec）${ok ? "✓" : "×"}`);
  }
  return r(fail ? FAIL : unknown ? UNKNOWN : PASS, parts.join("・"));
}

/**
 * C4：Skill の文の採点（#23 の 2：作業役のセッションが解き、コードで採点する。API なし）。CI は Claude を動かせないので記録を見る。
 * 問題の組（eval/<パック>/suite.json）のあるパックごとに、scripts/skill-scores/check.mjs の checkPack の結果（今の文の記録があり、別々の解く役 2 つ以上でそろい、
 * 前の文の記録より合格の数が下がっていない）。記録が 1 つも無ければ待ち
 * @param {Array<{ pack: string, ok: boolean, note: string, hasRecords: boolean }>} packs
 */
export function judgeC4(packs) {
  if (!packs.length) return r(UNKNOWN, "問題の組（eval/<パック>/suite.json）のあるパックが無い");
  if (!packs.some((p) => p.hasRecords)) return r(WAIT, "採点の記録（eval/skill-scores/）がまだ無い");
  const ev = packs.map((p) => `${p.ok ? "✓" : "✗"} ${p.note}`).join("・");
  return r(packs.every((p) => p.ok) ? PASS : FAIL, ev);
}

/** まだ作られていない印：Issue が開いていれば「待ち」。閉じたのにランナーに道が無ければ「未確認」（道を足す合図） */
export function judgeWaiting(what, issue) {
  if (issue && issue.state === "closed") return r(UNKNOWN, `#${issue.number} が閉じた。ランナーに確かめの道がまだ無い（scripts/scenario/ に足す）`);
  return r(WAIT, what);
}

/**
 * B1：台帳の置き場所の設定（config/ledger.json）と、台帳に関わる試験
 * @param {{ repo: string } | null} config
 * @param {{ passed: number, failed: number, total: number } | null} tests
 */
export function judgeB1(config, tests) {
  const t = tests ? `台帳の試験 ${tests.passed}/${tests.total} 件が通った` : "台帳の試験を走らせていない";
  if (tests && (tests.failed > 0 || tests.total === 0)) return r(FAIL, `${t}（落ちた ${tests.failed}）`);
  if (!config || typeof config.repo !== "string") return r(UNKNOWN, `config/ledger.json を読めない。${t}`);
  if (!/\/moyai-ledger$/.test(config.repo)) return r(WAIT, `台帳はまだ ${config.repo}（#20：切り替え。台帳の側の検証を入れ替える PR を誰が入れるかの答え待ち）。${t}`);
  if (!tests) return r(UNKNOWN, `台帳は ${config.repo}。${t}`);
  return r(PASS, `台帳は ${config.repo}。${t}`);
}

/** B2 に要る試験（tests/unit/scenario-b2-intake.test.ts の題の頭。消えれば不合格。`npm run scenario:b2` と同じ試験） */
export const B2_FLOW = "アプリの送りで受け口に出すと";
export const B2_REFUSALS = [
  { what: "数の上限", title: "数の上限：" },
  { what: "転送", title: "転送：" },
  { what: "鍵の取り違え", title: "鍵の取り違え：" },
];

/**
 * B2：手元の受け口と偽の GitHub のシナリオ試験（scenario-b2-intake.test.ts：共有ファイル → 受け口 → PR → ledger-validate ✓ と、断る 3 つ）。
 * 画面から送る e2e（ledger-intake.spec）も、走らせたときは通ること
 * @param {{ ok: boolean, total: number } | null} e2e  ledger-intake.spec の結果（走らせていなければ null。B2 の合否には要らない）
 * @param {Array<{ title: string, status: string }> | null} unit  scenario-b2-intake.test.ts の試験ごとの結果
 */
export function judgeB2(e2e, unit) {
  const parts = [];
  let fail = false;
  if (!unit) return r(UNKNOWN, "B2 のシナリオ試験（scenario-b2-intake.test.ts）を走らせていない");
  const passed = unit.filter((t) => t.status === "passed").length;
  if (passed !== unit.length || unit.length === 0) fail = true;
  parts.push(`B2 のシナリオ試験 ${passed}/${unit.length}`);
  const flow = unit.some((t) => t.title.startsWith(B2_FLOW) && t.status === "passed");
  if (!flow) fail = true;
  parts.push(`共有ファイル → 受け口 → PR → ledger-validate ${flow ? "✓" : "×"}`);
  for (const x of B2_REFUSALS) {
    const hit = unit.filter((t) => t.title.startsWith(x.title));
    const ok = hit.length > 0 && hit.every((t) => t.status === "passed");
    if (!ok) fail = true;
    parts.push(`断る：${x.what} ${ok ? "✓" : hit.length === 0 ? "× 試験が無い" : "×"}`);
  }
  if (e2e) {
    if (!e2e.ok || e2e.total === 0) fail = true;
    parts.push(`画面から送る e2e（ledger-intake.spec）${e2e.ok && e2e.total > 0 ? "✓" : "×"}`);
  }
  return r(fail ? FAIL : PASS, parts.join("・"));
}

/**
 * Playwright の JSON の報告を、ファイルごとの数にする（JSON に書ける形。CI の仕事どうしで渡す）
 * @returns {Record<string, { expected: number, unexpected: number, flaky: number, skipped: number, skippedTitles: string[] }>}
 */
export function summarizePlaywright(report) {
  const out = {};
  const walk = (suite, file) => {
    const f = String(suite.file ?? file ?? "").replace(/\\/g, "/");
    for (const spec of suite.specs ?? []) {
      const key = String(spec.file ?? f).replace(/\\/g, "/");
      const row = (out[key] ??= { expected: 0, unexpected: 0, flaky: 0, skipped: 0, skippedTitles: [] });
      for (const t of spec.tests ?? []) {
        if (t.status === "expected") row.expected++;
        else if (t.status === "flaky") row.flaky++;
        else if (t.status === "skipped") {
          row.skipped++;
          row.skippedTitles.push(spec.title);
        } else row.unexpected++;
      }
    }
    for (const s of suite.suites ?? []) walk(s, f);
  };
  for (const s of report?.suites ?? []) walk(s, s.file);
  return out;
}

/** ファイルの名前（道の最後）で引く */
export function fileRow(byFile, name) {
  for (const [k, v] of byFile) if (k === name || k.endsWith(`/${name}`)) return v;
  return null;
}

/** D1：数える e2e（tests/e2e/one-button.spec.ts）が走って全部通った */
export const D1_SPEC = "one-button.spec.ts";
export function judgeD1(byFile, ciE2e) {
  if (ciE2e) {
    if (ciE2e === "success") return r(PASS, `CI の e2e の仕事（${D1_SPEC} を含む）が通った`);
    return r(ciE2e === "failure" ? FAIL : UNKNOWN, `CI の e2e の仕事：${ciE2e}`);
  }
  if (!byFile) return r(UNKNOWN, "e2e を走らせていない");
  const row = fileRow(byFile, D1_SPEC);
  if (!row || row.expected + row.unexpected + row.flaky === 0) return r(FAIL, `${D1_SPEC} が走っていない`);
  if (row.unexpected > 0 || row.flaky > 0 || row.skipped > 0) return r(FAIL, `${D1_SPEC}：通った ${row.expected}・落ちた ${row.unexpected + row.flaky}・飛ばした ${row.skipped}`);
  return r(PASS, `${D1_SPEC} ${row.expected} 件が通った（出力・共有とも、選び・入力 0、主ボタン 1）`);
}

/** D2 が名指す台本。どれも走って通らなければ合格にしない */
export const D2_REQUIRED = ["walkthrough.spec.ts", "mcp.spec.ts", "claude-code.spec.ts"];

/**
 * D2：e2e が全部通る（落ちたもの 0、飛ばしたもの 0）。この OS で走らせた分と、もう一方の OS（CI の結果か未確認）
 * @param {Map|null} byFile  この OS の tests/e2e と tests/demo の報告をまとめたもの
 * @param {{ os: string, other: { os: string, result: string | null } }} where
 */
export function judgeD2(byFile, where) {
  if (!byFile) return r(UNKNOWN, "e2e を走らせていない");
  let expected = 0;
  let bad = [];
  const skipped = [];
  for (const [file, row] of byFile) {
    expected += row.expected;
    const name = file.split("/").pop();
    if (row.unexpected + row.flaky > 0) bad.push(`${name} ${row.unexpected + row.flaky}`);
    for (const t of row.skippedTitles) skipped.push(`${name}「${t.slice(0, 30)}」`);
  }
  const missing = D2_REQUIRED.filter((n) => {
    const row = fileRow(byFile, n);
    return !row || row.expected === 0;
  });
  const head = `${where.os}：通った ${expected}・落ちた ${bad.length ? bad.join("、") : 0}・飛ばした ${skipped.length}`;
  const tail = [];
  if (skipped.length) tail.push(`飛ばしたもの：${skipped.join("、")}`);
  if (missing.length) tail.push(`走って通っていない名指しの台本：${missing.join("、")}`);
  const other = where.other.result ? `${where.other.os}：CI ${where.other.result}` : `${where.other.os}：未確認`;
  tail.push(other);
  const ev = [head, ...tail].join("。");
  if (bad.length) return r(FAIL, ev);
  if (where.other.result && where.other.result !== "success") return r(where.other.result === "failure" ? FAIL : UNKNOWN, ev);
  if (skipped.length || missing.length || !where.other.result) return r(UNKNOWN, ev);
  return r(PASS, ev);
}

/** D2 を CI の仕事の結果だけで決める（e2e の仕事が ubuntu と windows の両方で走る。飛ばした台本は、その仕事の中では分からないので未確認に寄せる） */
export function judgeD2FromCi(ciE2e, skippedKnown) {
  if (ciE2e !== "success") return r(ciE2e === "failure" ? FAIL : UNKNOWN, `CI の e2e の仕事（ubuntu・windows）：${ciE2e}`);
  return r(UNKNOWN, `CI の e2e の仕事（ubuntu・windows）は通った。CI で飛ばす台本：${skippedKnown.join("、")}`);
}

/** D3：開いている area:ux の Issue の数（GitHub が答えたときだけ） */
export function judgeD3(issues) {
  if (!issues) return r(UNKNOWN, "GitHub の Issue を読めない（この走らせ方ではトークンが無いか、GitHub に断られた。CI の scenario の仕事は github.token で読む）");
  if (issues.length === 0) return r(PASS, "開いている area:ux の Issue 0");
  return r(FAIL, `開いている area:ux の Issue ${issues.length}：${issues.map((i) => `#${i.number}`).join("・")}`);
}

/** E2 が名指す CI の仕事（ci.yml の名前の頭） */
export const E2_JOBS = ["test (ubuntu-latest)", "test (windows-latest)", "pack-bench", "scenario"];

/**
 * E2：main の CI の最後の回の仕事が、名指しのものを含めて全部緑
 * @param {{ sha: string, conclusion: string | null, jobs: Array<{ name: string, conclusion: string | null }> } | null} run
 */
export function judgeE2(run) {
  if (!run) return r(UNKNOWN, "main の CI の回を読めない（この走らせ方ではトークンが無いか、GitHub に断られた。CI では同じ回の仕事の結果で決める）");
  const short = run.sha.slice(0, 7);
  const parts = E2_JOBS.map((n) => {
    const js = run.jobs.filter((j) => j.name === n || j.name.startsWith(`${n}（`) || j.name.startsWith(`${n} (`) || j.name.startsWith(`${n}(`));
    if (js.length === 0) return { n, ok: false, why: "無い" };
    const ok = js.every((j) => j.conclusion === "success");
    return { n, ok, why: js.map((j) => j.conclusion ?? "走っている").join("・") };
  });
  const others = run.jobs.filter((j) => !parts.some((p) => j.name === p.n || j.name.startsWith(p.n)) && j.conclusion !== "success" && j.conclusion !== "skipped");
  const ev = `main ${short}：${parts.map((p) => `${p.n} ${p.ok ? "✓" : `×（${p.why}）`}`).join("・")}${others.length ? `・ほかに緑でない仕事 ${others.map((j) => j.name).join("、")}` : ""}`;
  if (parts.every((p) => p.ok) && others.length === 0) return r(PASS, ev);
  return r(FAIL, ev);
}

/** CI の中の E2：同じ回の仕事の結果（needs）。main への push の回だけ判定する */
export function judgeE2FromCi(ref, needs) {
  if (ref !== "refs/heads/main") return r(UNKNOWN, `main の回ではない（${ref || "不明"}）。main の CI で決まる`);
  const parts = Object.entries(needs).map(([k, v]) => `${k} ${v === "success" ? "✓" : `×（${v}）`}`);
  const ok = Object.values(needs).every((v) => v === "success");
  return r(ok ? PASS : FAIL, `この回の仕事：${parts.join("・")}（scenario はこの仕事そのもの）`);
}

// ---- 表 ----

const esc = (s) => String(s ?? "").replace(/\|/g, "｜").replace(/\r?\n/g, " ");

/** 前の表から実機の列（統括が書く）を読む。印 → 実機の欄の字 */
export function readManual(md) {
  const out = new Map();
  if (!md) return out;
  for (const line of md.split(/\r?\n/)) {
    const m = /^\|\s*([A-Z]\d|S-0)\s*\|/.exec(line);
    if (!m) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    // 印｜合格の条件｜自動｜根拠｜実機
    if (cells.length >= 5) out.set(m[1], cells[4]);
  }
  return out;
}

/**
 * 結果の表（eval/scenario/result.md）
 * @param {Record<string, {status:string, evidence:string}>} results
 * @param {{ commit: string, dirty: boolean, at: string, os: string, ci: boolean }} meta
 * @param {string | null} prevMd  前の表（実機の列を残す）
 */
export function renderResult(results, meta, prevMd) {
  const manual = readManual(prevMd);
  const autoMarks = MARKS.filter((m) => m.auto);
  const count = (s) => autoMarks.filter((m) => results[m.id]?.status === s).length;
  const lines = [
    "# シナリオテストの結果",
    "",
    "`npm run scenario` が書く（手で書かない）。合格の条件は `docs/scenarios.md`。実機の列は統括が書く（ランナーは前の字を残す）。",
    "",
    `- 版：${meta.commit}${meta.dirty ? "（作業ツリーに変更あり）" : ""}`,
    `- 日時：${meta.at}`,
    `- 走らせた所：${meta.os}${meta.ci ? "（CI）" : ""}`,
    `- 自動の印 ${autoMarks.length}：合格 ${count(PASS)}・不合格 ${count(FAIL)}・未確認 ${count(UNKNOWN)}・待ち ${count(WAIT)}`,
    "",
    "| 印 | 合格の条件 | 自動 | 根拠 | 実機 |",
    "|---|---|---|---|---|",
  ];
  for (const m of MARKS) {
    const res = results[m.id];
    const auto = m.auto ? (res ? res.status : UNKNOWN) : "—";
    const ev = m.auto ? (res ? res.evidence : "走らせていない") : (m.note ?? "実機（統括が書く）");
    lines.push(`| ${m.id} | ${esc(m.title)} | ${auto} | ${esc(ev)} | ${esc(manual.get(m.id) ?? "")} |`);
  }
  lines.push("", "完成は、自動と実機の全部が「合格」のときだけ言う（docs/scenarios.md）。", "");
  return lines.join("\n");
}
