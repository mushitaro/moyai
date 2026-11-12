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
  { id: "A2", title: "見ていない様式で計画ができる（1 回だけ測る）", auto: false, note: "1 回だけ（docs/plan.md §2.6、#18）。npm run scenario では走らせない" },
  { id: "A3", title: "初めて読む物差しで計画・残りの年度の問いが 1 年目の 1 割以下", auto: true },
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

/** B2 の断る試験：この題を含む試験が、それぞれ 1 件以上あって全部通ること（題が変われば外れにする。試験を消して通さない） */
export const B2_REFUSALS = [
  { what: "数の上限", title: "件数：同じ IP から 1 時間に" },
  { what: "転送", title: "転送（低 6）" },
  { what: "鍵の取り違え", title: "ほかの鍵で署名した束" },
];

/**
 * B2：受け口の e2e（ledger-intake.spec）と、受け口の単体の試験（断る試験を含む）
 * @param {{ ok: boolean, total: number } | null} e2e  ledger-intake.spec の結果
 * @param {Array<{ title: string, status: string }> | null} unit  tests/unit/ledger-intake.test.ts の試験ごとの結果
 */
export function judgeB2(e2e, unit) {
  const parts = [];
  let fail = false;
  let unknown = false;
  if (!e2e) {
    unknown = true;
    parts.push("ledger-intake.spec を走らせていない");
  } else {
    if (!e2e.ok || e2e.total === 0) fail = true;
    parts.push(`ledger-intake.spec ${e2e.ok && e2e.total > 0 ? "✓" : "×"}（${e2e.total} 件）`);
  }
  if (!unit) {
    unknown = true;
    parts.push("受け口の単体の試験を走らせていない");
  } else {
    const passed = unit.filter((t) => t.status === "passed").length;
    if (passed !== unit.length || unit.length === 0) fail = true;
    parts.push(`受け口の試験 ${passed}/${unit.length}`);
    for (const x of B2_REFUSALS) {
      const hit = unit.filter((t) => t.title.includes(x.title));
      const ok = hit.length > 0 && hit.every((t) => t.status === "passed");
      if (!ok) fail = true;
      parts.push(`断る：${x.what} ${ok ? "✓" : hit.length === 0 ? "× 試験が無い" : "×"}`);
    }
  }
  return r(fail ? FAIL : unknown ? UNKNOWN : PASS, parts.join("・"));
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
  if (!issues) return r(UNKNOWN, "GitHub の Issue を読めない（トークンが無いか、GitHub に断られた）");
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
  if (!run) return r(UNKNOWN, "main の CI の回を読めない（トークンが無いか、GitHub に断られた）");
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
