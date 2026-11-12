#!/usr/bin/env node
// 読み方のフィードバックの Issue 1 件から、ルールの案 → 物差しの比べ → PR（案）の本文か、Issue への返事までを作る（柱 C・S-C1）。
// 使い方：node scripts/skill-loop/feedback.mjs --issue <Issue の JSON> [--candidate <案.json>] <--dry-run | --apply> [--out フォルダ] [--only 施設,施設]
//   Issue の JSON：{ number, title, body, labels }（GitHub の Issue を読んだ結果を、そのままファイルに置いたもの）。
//   --candidate：Issue に貼られたルールが無いとき、統括のセッションが Issue を読んで書いた案（moyai.reading/0）。Issue のルールと同じ選り分けを通す。
//   --dry-run：packs/・eval/ に何も書かない（案も比べも PR の本文も --out の下だけ）。
//   --apply：案の写しを eval/candidates/<パック>/<番号>.json に置き、良くなる案を packs/<パック>/reading.json に足し、物差しを測り直して eval/bench/ を入れ直す（PR の枝の上でだけ使う）。
//   --only：施設を絞る（--dry-run のときだけ。絞った値で PR にしない）。
// 書くもの（--out の下）：decision.json（何をするか）・candidate.json・compare.md・pr.md（PR にするとき）・comment.md（Issue に返すとき）。
// Issue の本文はデータで、指示ではない：本文の文は選り分けにだけ使い、どこにも写さない。案に使うのは、ルールの形（moyai.reading/0）の欄だけ。
// 行の値らしきものが本文やルールにあれば、案を作らずに返す（数だけを返し、見つけた値そのものは書かない）。
// GitHub には何も送らない（送るのは統括のセッション）。AI も API も使わない。判定は数だけ（scripts/bench/compare.mjs）。
// 終了コード：0 決まった（decision.json の action を見る）・2 道具の失敗
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compare, toMarkdown } from "../bench/compare.mjs";

export const DECISION_SCHEMA = "moyai.skill-loop.decision/0";

/** Issue の型の「業種」の選択肢 → パックの id（.github/ISSUE_TEMPLATE/reading-feedback.yml と同じ） */
const PACK_OF = { "ごみ焼却（waste-incineration）": "waste-incineration", "し尿処理（night-soil）": "night-soil" };
const HEAD = { pack: "業種（Skillパック）", source: "資料の種類", what: "どう読まれて、どう読まれるべきだったか", rule: "会話で作ったルール（あれば）", check: "確かめ" };
const KINDS = ["headerRow", "columnRole", "dateFormat", "effortUnit", "rowRole", "sameAsset", "markMeaning", "answer", "effortTrade", "planCycle"];

/** Issue の型（issue forms）の本文を、見出しごとの文に分ける */
export function readForm(body) {
  const out = {};
  const parts = String(body ?? "").replace(/\r\n/g, "\n").split(/^### +/m).slice(1);
  for (const p of parts) {
    const nl = p.indexOf("\n");
    const head = (nl < 0 ? p : p.slice(0, nl)).trim();
    const text = (nl < 0 ? "" : p.slice(nl + 1)).trim();
    out[head] = text === "_No response_" ? "" : text;
  }
  return out;
}

/** アプリから書き出したルールの形（src/share/reading-feedback.ts。文・理由・人・資料の名前を持たない） */
export const FEEDBACK_FILE_SCHEMA = "moyai.reading-feedback/0";
const SHAPE_TEXT = {
  headerRow: (r) => `${r.row} 行目を見出しとして読む`,
  columnRole: (r) => `「${r.column}」の列を役目 ${r.role} として読む`,
  dateFormat: (r) => `「${r.column}」の列の日付を ${r.format} の形として読む`,
  effortUnit: (r) => `「${r.column}」の列の工数を ${r.unit} として読む`,
  rowRole: (r) => `「${r.match}」の行を ${r.role} の行として読む`,
  sameAsset: (r) => `「${(r.names ?? []).join("」「")}」を同じ機器として読む`,
  markMeaning: (r) => `「${r.symbol}」を ${r.planOrActual} の印として読む`,
  answer: (r) => `問い ${r.question} の「${r.match}」に ${r.answer} と答える`,
  effortTrade: (r) => `「${(r.words ?? []).join("」「")}」を職種の語として読む`,
  planCycle: (r) => `${r.commonItem} の ${r.attribute} を ${r.years} 年ごととする`,
};
/** 形だけの規則を、moyai.reading/0 の規則にする（文は形から作る。id は書き出しの並び） */
function fromAppShape(r, i) {
  if (!r || typeof r !== "object" || !SHAPE_TEXT[r.kind]) return r;
  return { ...r, id: `app${i + 1}`, text: SHAPE_TEXT[r.kind](r).slice(0, 200), author: "ai", reason: "アプリから書き出したルールの形" };
}

/** 貼られたルール（```json の中か、そのままの JSON）を、規則の並びにする。読めなければ null */
export function rulesOf(text) {
  if (!text) return [];
  const m = /```(?:json)?\s*\n([\s\S]*?)\n```/.exec(text);
  let v;
  try {
    v = JSON.parse(m ? m[1] : text);
  } catch {
    return null;
  }
  if (Array.isArray(v)) return v;
  if (v && typeof v === "object" && v.schema === FEEDBACK_FILE_SCHEMA) return Array.isArray(v.rules) ? v.rules.map(fromAppShape) : null;
  if (v && typeof v === "object" && Array.isArray(v.rules)) return v.rules;
  if (v && typeof v === "object" && typeof v.kind === "string") return [v];
  return null;
}

// ─── 行の値らしきものの数え ──────────────────────────────
// 公開のリポジトリに行の値（金額・日付・番号・会社や施設の名前）を書かない決まり。迷えば数える（返して人に消してもらう）
const GENERIC_PREFIX = /^(ごみ|し尿|汚泥|下水|廃棄物|一般廃棄物|資源化|リサイクル)$/u;
const FACILITY = /([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}A-Za-zー]{2,})(清掃工場|クリーンセンター|クリーンプラザ|環境センター|衛生センター|処理センター|浄化センター|処理場|焼却場)/gu;
export const VALUE_KINDS = {
  money: "金額",
  groupedNumber: "桁区切りの数",
  exactDate: "日付",
  code: "番号（契約・機器の番号の形）",
  longNumber: "4 桁以上の数",
  decimal: "小数",
  company: "会社の名前",
  facility: "施設の名前",
  contact: "連絡先",
};
const PATTERNS = {
  money: [/[¥￥]\s*\d/g, /\d\s*(?:円|万円|千円|百万円)/g],
  groupedNumber: [/\d{1,3}(?:,\d{3})+/g],
  exactDate: [/\d{2,4}\s*[/.\-年]\s*\d{1,2}\s*[/.\-月]\s*\d{1,2}/g, /(?:令和|平成|昭和|[RHS])\s*(?:\d{1,2}|元)\s*[.年]\s*\d{1,2}/g],
  code: [/[A-Za-z]{1,4}\d{0,4}-\d{2,}/g],
  longNumber: [/\d{4,}/g],
  decimal: [/\d+\.\d+/g],
  company: [/株式会社|有限会社|合同会社|合資会社|\(株\)|\(有\)|㈱|㈲/g],
  contact: [/[\w.+-]+@[\w-]+\.[\w.]+/g, /\d{2,4}-\d{2,4}-\d{4}/g],
};

/** 文の中の行の値らしきものを、種類ごとに数える（値そのものは返さない） */
export function countValues(texts) {
  const counts = Object.fromEntries(Object.keys(VALUE_KINDS).map((k) => [k, 0]));
  for (const raw of texts) {
    const t = String(raw ?? "").normalize("NFKC");
    for (const [k, res] of Object.entries(PATTERNS)) for (const re of res) counts[k] += (t.match(re) ?? []).length;
    for (const m of t.matchAll(FACILITY)) if (!GENERIC_PREFIX.test(m[1])) counts.facility++;
  }
  return counts;
}

/** 規則の中の、人の字の入る欄（数えるもの）。kind・id・author・役目などの決まった語と、公の分類の番号は数えない */
function ruleTexts(rule) {
  const out = [];
  const add = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
  };
  for (const k of ["text", "reason", "by", "match", "column", "names", "words", "symbol", "meaning"]) add(rule?.[k]);
  if (rule?.when) {
    add(rule.when.headers);
    add(rule.when.file);
  }
  return out;
}

/** 規則の形のあらまし（細かい形は物差しの側で moyai.reading/0 の定義が確かめる） */
function shapeProblems(rules) {
  const bad = [];
  rules.forEach((r, i) => {
    if (!r || typeof r !== "object" || Array.isArray(r)) bad.push(`${i + 1} 件目：オブジェクトでない`);
    else if (!KINDS.includes(r.kind)) bad.push(`${i + 1} 件目：kind が moyai.reading/0 の種類でない`);
  });
  if (rules.length > 20) bad.push(`ルールが ${rules.length} 件（1 件のフィードバックの案は 20 件まで）`);
  return bad;
}

/**
 * Issue を選り分ける：案を作ってよいか。返すのは数と決まった語だけ（本文の文は返さない）
 * @returns {{ ok: true, pack: string, rules: object[], source: string } | { ok: false, reason: string, counts?: object, problems?: string[] } | { ok: "draft", pack: string }}
 */
export function screen(issue, candidate = null) {
  const labels = (issue.labels ?? []).map((l) => (typeof l === "string" ? l : l?.name));
  if (!labels.includes("feedback")) return { ok: false, reason: "not-feedback" };
  const f = readForm(issue.body);
  const pack = PACK_OF[f[HEAD.pack] ?? ""];
  if (!pack) return { ok: false, reason: "pack-unknown" };
  if (!/^- \[[xX]\]/m.test(f[HEAD.check] ?? "")) return { ok: false, reason: "not-confirmed" };
  const pasted = rulesOf(f[HEAD.rule]);
  if (pasted === null) return { ok: false, reason: "rule-unreadable" };
  const rules = candidate ? candidate : pasted;
  const counts = countValues([issue.title, f[HEAD.what], f[HEAD.rule], ...rules.flatMap(ruleTexts)]);
  if (Object.values(counts).some((n) => n > 0)) return { ok: false, reason: "row-values", counts };
  if (!rules.length) return { ok: "draft", pack };
  const problems = shapeProblems(rules);
  if (problems.length) return { ok: false, reason: "rule-shape", problems };
  return { ok: true, pack, rules, source: candidate ? "session" : "issue" };
}

/** 案の読み方（moyai.reading/0）：id に Issue の番号を付け、人の呼び名（by）を外し、書いたのは AI（案）にする */
export function buildCandidate(number, pack, rules) {
  return {
    schema: "moyai.reading/0",
    name: `フィードバック #${number} の案（${pack}）`,
    rules: rules.map((r, i) => {
      const { by: _by, author: _author, ...rest } = r;
      const id = `fb${number}-${String(r.id ?? i + 1).replace(/[^A-Za-z0-9_-]/g, "")}`.slice(0, 40);
      const reason = `${typeof r.reason === "string" && r.reason ? r.reason : "理由の書かれていないルール"}（フィードバック #${number} から）`.slice(0, 500);
      return { ...rest, id, author: "ai", reason };
    }),
  };
}

/** Skillパックの読み方に案を足す（案を先に置く：物差しで案を当てたときと同じく、同じ種類の決まりでは案が先に効く） */
export function mergeIntoPack(packReading, candidate) {
  const have = new Set(packReading.rules.map((r) => r.id));
  const clash = candidate.rules.filter((r) => have.has(r.id)).map((r) => r.id);
  if (clash.length) throw new Error(`Skillパックに同じ id のルールがある（${clash.length} 件）`);
  return { ...packReading, rules: [...candidate.rules, ...packReading.rules] };
}

const REASON_TEXT = {
  "not-feedback": "ラベル feedback の無い Issue なので、読み方の案は作りません。",
  "pack-unknown": "業種（Skillパック）が「そのほか」か読めないので、どの Skillパックの物差しで測るか決まりません。業種を選び直してください。",
  "not-confirmed": "「資料の中身を書いていない」の確かめに印が無いので、案を作りません。本文を見直して印を付けてください。",
  "rule-unreadable": "「会話で作ったルール」の欄が JSON として読めません。rules.json からそのまま貼ってください。",
  "rule-shape": "貼られたルールが moyai.reading/0 の形に合いません。",
};

/** 比べの表の見出し（# 1 つ）を、PR・Issue の本文の中の小見出しに下げる */
const demote = (md) => md.trim().replace(/^# /gm, "### ");

/** Issue に返す文（数と決まった文だけ。本文の文は写さない） */
export function commentFor(d, md) {
  const foot = ["", "---", "_統括のセッションが scripts/skill-loop/feedback.mjs で作った返事です。判定は数だけで決めています（AI に判定させていません）。_"];
  if (d.reason === "row-values") {
    const list = Object.entries(d.counts).filter(([, n]) => n > 0).map(([k, n]) => `- ${VALUE_KINDS[k]}：${n}`);
    return [
      `本文かルールに、行の値らしきものが見つかったので、案を作らずに返します（見つけた値そのものはここに書きません）。`,
      "",
      ...list,
      "",
      "このリポジトリは公開です。資料の中身（行の値・金額・日付・番号・会社や施設の名前）を本文とルールから消してから、もう一度知らせてください。書いてよいのは、資料の種類と、見出しや記号のような「書き方」だけです。",
      "数え方は機械的なので、値でないものを数えていることもあります。そのときも、その字を言い換えてください。",
      ...foot,
    ].join("\n");
  }
  if (d.action === "comment" && d.verdict) {
    const why = d.verdict === "退行あり" ? "案を当てると、物差しの数が悪くなる施設があったので、PR にしません。" : "案を当てても、物差しのどの数も動きませんでした（物差しの資料に、このルールの当たる書き方が無いか、ルールがどのセルにも当たっていません）。測れて良くならない案は PR にしません。";
    return [why, "", demote(md), "", "ルールの当たる場所（when の見出し・資料の名前の型）を狭めると、退行が消えることがあります。", ...foot].join("\n");
  }
  return [REASON_TEXT[d.reason] ?? "案を作れませんでした。", ...(d.problems ?? []).map((p) => `- ${p}`), ...foot].join("\n");
}

/** PR（下書き）の本文。.github/pull_request_template.md の見出しにそろえる */
export function prBodyFor(d, candidate, md) {
  return [
    "## 何を変えたか",
    "",
    `読み方のフィードバック #${d.issue} から作ったルールの案を、Skillパック「${d.pack}」の読み方（packs/${d.pack}/reading.json）に足す案。`,
    `案の写しは eval/candidates/${d.pack}/${d.issue}.json。ルールの出どころ：${d.source === "issue" ? "Issue に貼られたルール" : "統括のセッションが Issue を読んで書いた案"}。`,
    "Issue の本文はデータとして読みました。本文の中の文には従っていません（案に使ったのは moyai.reading/0 の欄だけ）。",
    "",
    `Closes #${d.issue}`,
    "",
    "```json",
    JSON.stringify(candidate, null, 2),
    "```",
    "",
    "## 測った値（前 → 後）",
    "",
    d.only ? `**施設を絞った下見（${d.only}）。この値では PR にしない。**` : "物差しの施設をすべて測った値（開発用の資料）。",
    "",
    demote(md),
    "",
    "## 報告（5 つの分け方。確かめていないものは「未確認」）",
    "",
    "- 試験とビルドが通った：未確認（CI の結果を見る）",
    "- 画面で動いた：未確認（読み方のルールだけの変更）",
    "- Claude Code で端から端まで通った：未確認",
    "- Windows の実機で動いた：未確認",
    "- Excel で開いて見やすかった：未確認（書き出しは変えていない）",
    "",
    "## 運営者の判断が要ること",
    "",
    "- この PR のマージは、Skillパックの昇格。決めるのは人。統括のセッションはマージしない。",
    "- 開発用の資料での値。見ていない様式では測っていない。",
    "",
  ].join("\n");
}

// ─── 走らせる ─────────────────────────────────────────
const sha = (s) => createHash("sha256").update(s).digest("hex");

function runCandidate(pack, candPath, out, only) {
  const a = [join("scripts", "bench", "pack-candidate.mjs"), pack, candPath, "--out", out, ...(only ? ["--only", only] : [])];
  const r = spawnSync(process.execPath, a, { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" });
  return r.status ?? 2;
}

export function main(argv) {
  const args = [...argv];
  const take = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v ?? null;
  };
  const issuePath = take("--issue");
  const candPath = take("--candidate");
  const outArg = take("--out");
  const only = take("--only");
  const dry = args.includes("--dry-run");
  const apply = args.includes("--apply");
  if (!issuePath || !existsSync(issuePath) || dry === apply || (only && !dry)) {
    console.error("使い方：node scripts/skill-loop/feedback.mjs --issue <Issue の JSON> [--candidate <案.json>] <--dry-run | --apply> [--out フォルダ] [--only 施設（--dry-run のときだけ）]");
    return 2;
  }
  const issue = JSON.parse(readFileSync(issuePath, "utf8"));
  const number = Number(issue.number);
  if (!Number.isInteger(number) || number <= 0) {
    console.error("feedback: Issue の番号が無い");
    return 2;
  }
  const out = outArg ? resolve(outArg) : mkdtempSync(join(tmpdir(), "moyai-feedback-"));
  mkdirSync(out, { recursive: true });
  const write = (name, text) => writeFileSync(join(out, name), text, "utf8");
  let candRules = null;
  if (candPath) {
    const c = JSON.parse(readFileSync(candPath, "utf8"));
    candRules = Array.isArray(c?.rules) ? c.rules : null;
    if (!candRules) {
      console.error("feedback: --candidate が moyai.reading/0 の形でない");
      return 2;
    }
  }
  const s = screen(issue, candRules);
  const d = { schema: DECISION_SCHEMA, issue: number, dryRun: dry, only: only ?? null };
  const finish = (extra) => {
    const all = { ...d, ...extra };
    write("decision.json", JSON.stringify(all, null, 1) + "\n");
    console.error(`feedback: #${number} → ${all.action}${all.verdict ? `（${all.verdict}）` : ""}・${out}`);
    return 0;
  };
  if (s.ok === false) {
    const dec = { action: s.reason === "not-feedback" ? "skip" : "comment", reason: s.reason, counts: s.counts ?? null, problems: s.problems ?? null };
    if (dec.action === "comment") write("comment.md", commentFor({ ...d, ...dec }, ""));
    return finish(dec);
  }
  // 貼られたルールが無い：統括のセッションが Issue を読んで案を書き、--candidate で渡し直す
  if (s.ok === "draft") return finish({ action: "draft", pack: s.pack, reason: "no-rule" });

  const candidate = buildCandidate(number, s.pack, s.rules);
  const candText = JSON.stringify(candidate, null, 2) + "\n";
  write("candidate.json", candText);
  const measure = join(out, "measure");
  const code = runCandidate(s.pack, join(out, "candidate.json"), measure, only);
  if (code === 2) return finish({ action: "error", pack: s.pack, reason: "bench-failed", candidateSha256: sha(candText) });
  const base = JSON.parse(readFileSync(join(measure, "base", "result.json"), "utf8"));
  const head = JSON.parse(readFileSync(join(measure, "candidate", "result.json"), "utf8"));
  const c = compare(base, head);
  const md = toMarkdown(base, head, c);
  write("compare.md", md);
  const common = { pack: s.pack, source: s.source, verdict: c.verdict, worse: c.worse, better: c.better, candidateSha256: sha(candText) };
  if (c.verdict !== "良くなった") {
    const dec = { action: "comment", reason: c.verdict === "退行あり" ? "regression" : "no-change", ...common };
    write("comment.md", commentFor({ ...d, ...dec }, md));
    return finish(dec);
  }
  const files = [`eval/candidates/${s.pack}/${number}.json`, `packs/${s.pack}/reading.json`, `eval/bench/${s.pack}/result.json`, `eval/bench/${s.pack}/README.md`];
  if (dry) {
    write("pr.md", prBodyFor({ ...d, ...common }, candidate, md));
    return finish({ action: "pr", ...common, files, branch: `skill-loop/feedback-${number}` });
  }
  // ここから下は PR の枝の上でだけ：案の写しを置き、Skillパックに足し、測り直す
  const candFile = resolve("eval", "candidates", s.pack, `${number}.json`);
  mkdirSync(dirname(candFile), { recursive: true });
  writeFileSync(candFile, candText, "utf8");
  const packPath = resolve("packs", s.pack, "reading.json");
  const benchDir = resolve("eval", "bench", s.pack);
  const saved = { pack: readFileSync(packPath, "utf8"), result: readFileSync(join(benchDir, "result.json"), "utf8"), readme: readFileSync(join(benchDir, "README.md"), "utf8") };
  const restore = () => {
    writeFileSync(packPath, saved.pack, "utf8");
    writeFileSync(join(benchDir, "result.json"), saved.result, "utf8");
    writeFileSync(join(benchDir, "README.md"), saved.readme, "utf8");
    rmSync(candFile, { force: true });
  };
  writeFileSync(packPath, JSON.stringify(mergeIntoPack(JSON.parse(saved.pack), candidate), null, 2) + "\n", "utf8");
  const r = spawnSync(process.execPath, [join("scripts", "bench", "pack-bench.mjs"), s.pack], { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) {
    restore();
    return finish({ action: "error", ...common, reason: "bench-failed-after-apply" });
  }
  const after = JSON.parse(readFileSync(join(benchDir, "result.json"), "utf8"));
  const c2 = compare(base, after);
  const md2 = toMarkdown(base, after, c2);
  write("compare.md", md2);
  if (c2.verdict !== "良くなった") {
    restore();
    const dec = { action: "comment", ...common, verdict: c2.verdict, worse: c2.worse, better: c2.better, reason: c2.verdict === "退行あり" ? "regression-after-apply" : "no-change-after-apply" };
    write("comment.md", commentFor({ ...d, ...dec }, md2));
    return finish(dec);
  }
  write("pr.md", prBodyFor({ ...d, ...common, verdict: c2.verdict }, candidate, md2));
  return finish({ action: "pr", ...common, verdict: c2.verdict, worse: c2.worse, better: c2.better, files, applied: true, branch: `skill-loop/feedback-${number}` });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main(process.argv.slice(2)));
