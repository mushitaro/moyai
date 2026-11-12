#!/usr/bin/env node
// Skillパックの物差しの 2 つの結果（moyai.pack-bench.result/0）を比べる。判定は数だけで決める（AI に判定させない）。
// 使い方：node scripts/bench/compare.mjs <もとの result.json> <比べる result.json> [--strict] [--md <書き出す .md>]
//   退行あり（終了コード 1）：計画を作れなくなった施設がある／⑥・③・工数の合った数が減った／③ の読みすぎ・未解決のセル・開いたままの問いが増えた／施設が減った
//   良くなった（0）：退行が無く、上のどれかが良い向きに動いた
//   差なし（0）：どの数も同じ
// --strict：数が 1 つでも違えば終了コード 1（CI が、記録した表 eval/bench/ と今のコードの測った値が同じかを確かめるのに使う）
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const n = (r) => (r ? r.correct : 0);

/** 施設ごとの数（比べるものだけ） */
export function metricsOf(row) {
  return {
    planMade: row.planMade ? 1 : 0,
    recovery: n(row.recovery),
    accuracy: n(row.accuracy),
    manDays: n(row.manDays),
    days: n(row.days),
    extra: row.extra ?? 0,
    unresolved: row.unresolvedAfter,
    open: row.open,
    asked: row.asked,
    // 分母（正解の側の数）。同じ資料なら変わらない。変わったら、物差しか資料が変わっている（--strict が拾う）
    recoveryTotal: row.recovery?.total ?? 0,
    accuracyTotal: row.accuracy?.total ?? 0,
    // 初めて読む測り（--first-read）だけ：1 年目の問い・残りを足した問い・規則で決まった問い・規則の数
    ...(row.firstRead ? { firstAsked: row.firstRead.firstAsked, restAsked: row.firstRead.restAsked, ruleAnswered: row.firstRead.ruleAnswered, rules: row.firstRead.rules, ruleWrong: row.firstRead.ruleWrong ?? 0, askedAgain: row.firstRead.askedAgain ?? 0 } : {}),
  };
}

// 大きいほど良い数と、小さいほど良い数。extra は ③ の読みすぎ（正解に無いのに計画に読んだ数。合った数が増えても、読みすぎが増えれば退行）。
// asked（質問の数）と分母は記録するだけで、退行の判定には使わない（違えば changed になり、--strict が拾う）
const UP = ["planMade", "recovery", "accuracy", "manDays", "days"];
// ruleWrong は初めて読む測りだけ：ルールで決まった問いのうち、正解の台本と違う答えの数（増えれば退行）
// askedAgain も初めて読む測りだけ：1 年目にもあったのに、残りの年度でまた聞いた問い（増えれば退行。mushitaro/moyai#67）
const DOWN = ["extra", "unresolved", "open", "ruleWrong", "askedAgain"];
const NOTE = ["asked", "recoveryTotal", "accuracyTotal", "firstAsked", "restAsked", "ruleAnswered", "rules"];
// 分母でなく、記録するだけの数（違えば changed になるが、分母が変わった所には書かない）
const COUNT_ONLY = ["asked", "firstAsked", "restAsked", "ruleAnswered", "rules"];
const LABEL = { planMade: "計画", recovery: "⑥", accuracy: "③", manDays: "工数", days: "日数", extra: "③ の読みすぎ", unresolved: "② 未解決", open: "開いたままの問い", asked: "⑤ 質問", recoveryTotal: "⑥ の分母", accuracyTotal: "③ の分母", firstAsked: "1 年目の問い", restAsked: "残りを足した問い", ruleAnswered: "規則で決まった問い", rules: "1 年目の規則", ruleWrong: "ルールの答えが正解と違う問い", askedAgain: "1 年目に見たのにまた聞いた問い" };

export function compare(base, head) {
  if (base.schema !== "moyai.pack-bench.result/0" || head.schema !== "moyai.pack-bench.result/0") throw new Error("moyai.pack-bench.result/0 でない");
  if (base.pack !== head.pack) throw new Error(`パックが違う（${base.pack}・${head.pack}）`);
  if ((base.mode ?? null) !== (head.mode ?? null)) throw new Error(`測り方が違う（${base.mode ?? "既定"}・${head.mode ?? "既定"}）`);
  const bm = new Map(base.facilities.map((f) => [f.facility, f]));
  const hm = new Map(head.facilities.map((f) => [f.facility, f]));
  const rows = [];
  const worse = [];
  const better = [];
  const notes = [];
  let changed = false;
  for (const [id, b] of bm) {
    const h = hm.get(id);
    if (!h) {
      worse.push(`${id}：比べる側に無い`);
      changed = true;
      continue;
    }
    if (h.error && !b.error) worse.push(`${id}：測れなくなった`);
    const mb = metricsOf(b);
    const mh = metricsOf(h);
    const diff = {};
    for (const k of [...UP, ...DOWN, ...NOTE]) {
      if (mb[k] === mh[k]) continue;
      changed = true;
      diff[k] = [mb[k], mh[k]];
      if (NOTE.includes(k)) {
        if (!COUNT_ONLY.includes(k)) notes.push(`${id}：${LABEL[k]} ${mb[k]} → ${mh[k]}`);
        continue;
      }
      const good = UP.includes(k) ? mh[k] > mb[k] : mh[k] < mb[k];
      (good ? better : worse).push(`${id}：${LABEL[k]} ${mb[k]} → ${mh[k]}`);
    }
    rows.push({ facility: id, base: mb, head: mh, diff });
  }
  for (const id of hm.keys())
    if (!bm.has(id)) {
      changed = true;
      better.push(`${id}：新しく測った`);
    }
  const verdict = worse.length ? "退行あり" : better.length ? "良くなった" : "差なし";
  return { verdict, changed, worse, better, notes, rows };
}

export function toMarkdown(base, head, c) {
  const cell = (r, k) => (r.diff[k] ? `${r.diff[k][0]} → ${r.diff[k][1]}` : `${r.head[k]}`);
  return [
    `# Skillパックの物差しの比べ：${head.pack}`,
    "",
    `判定：**${c.verdict}**（数だけで決める。もと ${String(base.reader?.commit ?? "").slice(0, 7)}・比べる側 ${String(head.reader?.commit ?? "").slice(0, 7)}${head.reader?.dirty ? "〔commit していない変更あり〕" : ""}）`,
    "",
    "| 施設 | 計画 | ⑥ | ③ | ③ の読みすぎ | 工数 | ② 未解決 | 開いたままの問い | ⑤ 質問 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...c.rows.map((r) => `| ${r.facility} | ${cell(r, "planMade")} | ${cell(r, "recovery")} | ${cell(r, "accuracy")} | ${cell(r, "extra")} | ${cell(r, "manDays")} | ${cell(r, "unresolved")} | ${cell(r, "open")} | ${cell(r, "asked")} |`),
    "",
    ...(c.worse.length ? ["退行：", ...c.worse.map((x) => `- ${x}`), ""] : []),
    ...(c.better.length ? ["良くなった所：", ...c.better.map((x) => `- ${x}`), ""] : []),
    ...(c.notes.length ? ["分母が変わった所（物差しか資料が変わっている。前と後の数をそのまま比べられない）：", ...c.notes.map((x) => `- ${x}`), ""] : []),
    "- 数は、合った数（分子）と件数。分母は正解の側で決まり、同じ資料なら変わらない。",
    "- 開発用の資料での値。見ていない様式の結果ではない。昇格（Skillパックの版を上げること）を決めるのは人。",
    "",
  ].join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const mdAt = args.indexOf("--md");
  const md = mdAt >= 0 ? args[mdAt + 1] : null;
  const files = args.filter((a, i) => !a.startsWith("--") && (mdAt < 0 || i !== mdAt + 1));
  if (files.length !== 2) {
    console.error("使い方：node scripts/bench/compare.mjs <もとの result.json> <比べる result.json> [--strict] [--md <.md>]");
    process.exit(2);
  }
  const base = JSON.parse(readFileSync(files[0], "utf8"));
  const head = JSON.parse(readFileSync(files[1], "utf8"));
  const c = compare(base, head);
  const text = toMarkdown(base, head, c);
  if (md) writeFileSync(md, text, "utf8");
  console.error(text);
  if (c.verdict === "退行あり") process.exit(1);
  if (strict && c.changed) {
    console.error("compare: 記録した表と測った値が違う。node scripts/bench/pack-bench.mjs を走らせ、eval/bench/ を入れ直す");
    process.exit(1);
  }
}
