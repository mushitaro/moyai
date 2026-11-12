// Skillパックの物差し（開発用。見ていない様式の結果ではない）：samples/<パック>/ の下の工場 v2 の施設をすべて、
// 見ていない様式と同じ道具（harness.ts・v2.ts）で測り、施設ごとの ②・⑤・計画・③・⑥ を 1 つの表にする。
// 会話で作った読み方（3 段目）は当てない。標準（1 段目）と Skillパック（2 段目）だけで、どこまで読めるかを見る。
// MOYAI_BENCH_OUT=<フォルダ> のときだけ走る（result.json と README.md を書く）。MOYAI_BENCH_PACK（既定 waste-incineration）、
// MOYAI_BENCH_ONLY=<施設,施設>（絞る。絞った結果は表に「絞った」と書く）。走らせるのは scripts/bench/pack-bench.mjs。
// MOYAI_BENCH_RULES=<ルールの案の JSON>（moyai.reading/0。3 段目の rules.json か、Skillパックの reading.json と同じ形）なら、その案を
// 下書きの読み方として当てて測る（Skillパックに入れる前の試し。案の名前・数・ハッシュを結果に書く。scripts/bench/pack-candidate.mjs が使う）。
// 質問には、正解だけを見る台本が人の代わりに答える。AI も API も使わない。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { ReadingSkill, countShape, type LoadedReading } from "../../src/import/reading";
import { questionKey, rulesFromAnswers, yearSplit } from "./first-read";
import { answer, runSet, truthKnows, type SetResult } from "./harness";
import { loadV2Facility } from "./v2";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

interface Ratio {
  correct: number;
  total: number;
}

export interface BenchRow {
  facility: string;
  name: string;
  files: number;
  seconds: number;
  asked: number;
  answered: number;
  open: number;
  /** 開いたままの問いの種類ごとの数 */
  openKinds: Record<string, number>;
  /** 正解から答えられず、既定の答えを受けた問いの種類ごとの数（answered に含む） */
  defaulted: Record<string, number>;
  /** 未解決のセルを、待っている問いの種類ごとに数えたもの（問いに結ばれていないセルは「問いなし」） */
  unresolvedBy: Record<string, number>;
  /** 開いたままの問いの見本（種類ごとに 2 つまで。架空の資料の字） */
  openSamples: { kind: string; rows: number; text: string; options: string[]; defaultAnswer: string | null }[];
  unresolvedBefore: number;
  unresolvedAfter: number;
  planMade: boolean;
  blockers: string[];
  plan: SetResult["plan"];
  accuracy: Ratio | null;
  /** ③ の読みすぎ（正解に無いのに、計画に読んだ数）。計画が無ければ null */
  extra: number | null;
  recovery: Ratio;
  manDays: Ratio | null;
  days: Ratio | null;
  /** 測りの道具が、正解を資料のセルに引き当てられなかった数（読み手の値ではなく、物差しの側の穴） */
  unplaced: number;
  dropped: Record<string, number>;
  /** 測れなかった理由（道具が投げた） */
  error: string | null;
  /**
   * 初めて読む測り（--first-read）だけ：1 年目の年度と資料の数、1 年目の問い（N）、1 年目の答えから作った規則の数、
   * 全部の資料を規則ありで読んだときの問い（K）と規則で決まった問い、規則なしで全部を読んだときの問い（M0）
   */
  firstRead?: { askedAgain: number; askedAgainUnanswered: number; askedAgainYear: number; askedNew: number; askedAgainKinds: Record<string, number>; year: string; firstFiles: number; restFiles: number; restYears: number; firstAsked: number; rules: number; ruleAnswered: number; ruleWrong: number; restAsked: number; restAskedNoRules: number };
}

const sum = (xs: Ratio[]): Ratio => xs.reduce((a, b) => ({ correct: a.correct + b.correct, total: a.total + b.total }), { correct: 0, total: 0 });
const pct = (a: Ratio | null) => (a && a.total ? `${a.correct}/${a.total}（${((a.correct / a.total) * 100).toFixed(1)}%）` : "—");
const ratio = (a: { correct: number; total: number } | null | undefined): Ratio | null => (a ? { correct: a.correct, total: a.total } : null);

const emptyRow = (n: string): BenchRow => ({ facility: n, name: n, files: 0, seconds: 0, asked: 0, answered: 0, open: 0, openKinds: {}, defaulted: {}, unresolvedBy: {}, openSamples: [], unresolvedBefore: 0, unresolvedAfter: 0, planMade: false, blockers: [], plan: null, accuracy: null, extra: null, recovery: { correct: 0, total: 0 }, manDays: null, days: null, unplaced: 0, dropped: {}, error: null });
const secondsSince = (t0: number) => Math.round((performance.now() - t0) / 100) / 10;

/** 1 回の読み（runSet）を、表の 1 行にする */
function rowOf(n: string, v: ReturnType<typeof loadV2Facility>, t0: number, got: Awaited<ReturnType<typeof runSet>>): BenchRow {
  const { result: r, analysis } = got;
  const openKinds: Record<string, number> = {};
  const openSamples: BenchRow["openSamples"] = [];
  for (const q of r.openAtEnd) {
    openKinds[q.kind] = (openKinds[q.kind] ?? 0) + 1;
    if (openKinds[q.kind]! <= 2) openSamples.push({ kind: q.kind, rows: q.rows, text: q.text, options: q.options ?? [], defaultAnswer: q.defaultAnswer ?? null });
  }
  const kindOf = new Map(analysis.questions.map((q) => [q.questionId, q.kind] as const));
  const unresolvedBy: Record<string, number> = {};
  for (const st of analysis.composition.status.values()) {
    if (st.s !== "unresolved") continue;
    const k = st.questionId ? (kindOf.get(st.questionId) ?? "問いが見つからない") : "問いなし";
    unresolvedBy[k] = (unresolvedBy[k] ?? 0) + 1;
  }
  return {
    ...emptyRow(n),
    name: v.set.world.facility.name,
    files: r.files.length,
    seconds: secondsSince(t0),
    asked: r.asked,
    answered: r.answered,
    open: r.openAtEnd.length,
    openKinds,
    defaulted: r.defaulted ?? {},
    unresolvedBy,
    openSamples,
    unresolvedBefore: r.unresolvedBefore,
    unresolvedAfter: r.unresolvedAfter,
    planMade: r.planMade,
    blockers: r.blockers,
    plan: r.plan,
    accuracy: r.planMade ? sum(r.files.flatMap((f) => (f.accuracy ? [{ correct: f.accuracy.correct, total: f.accuracy.total }] : []))) : null,
    extra: r.planMade ? r.files.reduce((a, f) => a + (f.accuracy?.extra ?? 0), 0) : null,
    recovery: { correct: r.recovery.together, total: r.recovery.denominator },
    manDays: ratio(r.recovery.manDays),
    days: ratio(r.recovery.days),
    unplaced: r.unplaced.length,
    dropped: v.dropped,
  };
}

const RUN = { acceptDefaults: true, deferWholeFile: true, asWritten: true, excludeUnreadPhotos: true } as const;

/** 今の Skillパックで、施設の資料をすべて読む */
async function measure(n: string, v: ReturnType<typeof loadV2Facility>, readings: LoadedReading[]): Promise<BenchRow> {
  const t0 = performance.now();
  try {
    return rowOf(n, v, t0, await runSet(v.set, { facilityKey: v.set.world.facility.id, ...RUN, ...(readings.length ? { readings } : {}) }));
  } catch (e) {
    return { ...emptyRow(n), seconds: secondsSince(t0), error: e instanceof Error ? e.message.slice(0, 300) : "道具が投げた" };
  }
}

// ─── 初めて読む（パックなし・1 年 → ルール → 残り。mushitaro/moyai#67）───────────────

/**
 * パックなしで、1 年目だけを読み（問い N）、答えを規則にして、全部の資料（1 年目＋残りの年度）を読み直す（問い K）。
 * 行の数は最後の読み（全部の資料・規則あり）。比べに、規則なしで全部を読んだときの問い（M0）も測る
 */
async function measureFirstRead(n: string, v: ReturnType<typeof loadV2Facility>, split: { year: string; first: string[]; rest: string[]; restYears: number }): Promise<BenchRow> {
  const t0 = performance.now();
  const opt = { facilityKey: v.set.world.facility.id, ...RUN, packId: "" };
  try {
    const y1 = await runSet(v.set, { ...opt, read: split.first });
    // 1 年目の答えは、既定の答えを受けた問い（人が推された答えを押したもの）も含めてルールにする（1 年目に見て答えたものは二度聞かない。mushitaro/moyai#67）
    const rules = rulesFromAnswers(y1.analysis.questions, y1.answered, v.set.truth.files.map((f) => f.file));
    const skill = ReadingSkill.parse({ schema: "moyai.reading/0", name: "1 年目の読み方", scope: "facility", rules });
    const readings: LoadedReading[] = [{ skill, version: "", path: null, approved: false, draft: true }];
    const all = [...split.first, ...split.rest];
    const noRules = await runSet(v.set, { ...opt, read: all });
    const got = await runSet(v.set, { ...opt, read: all, readings });
    const row = rowOf(n, v, t0, got);
    // 規則で決まった問いのうち、正解の台本の答えと違うもの（台本が正解から答えられる問いだけ。答えられない問いは数に入れない）
    let ruleWrong = 0;
    for (const q of got.analysis.questions) {
      if (!got.analysis.ruleAnswers.has(q.questionId) || !q.decision) continue;
      const want = truthKnows(q, got.index) ? answer(q, got.index) : null;
      if (want !== null && want !== q.decision.answer) ruleWrong++;
    }
    // 残りの年度を足した読みで、規則で決まらずに聞いた問いを 2 つに分ける（統括の判断、mushitaro/moyai#67）：
    // (a) 1 年目にもあった問い（同じ鍵の問いが 1 年目にあった）がまた聞かれた → 読み手の不具合。(b) 1 年目に無かった問い → 聞くのが正しい
    const files = v.set.truth.files.map((f) => f.file);
    const firstKeys = new Set(y1.analysis.questions.map((q) => questionKey(q, files).key));
    const askedQs = got.analysis.questions.filter((q) => !got.analysis.ruleAnswers.has(q.questionId));
    const again = askedQs.filter((q) => firstKeys.has(questionKey(q, files).key));
    const againKinds: Record<string, number> = {};
    for (const q of again) againKinds[q.kind] = (againKinds[q.kind] ?? 0) + 1;
    // (a) の内訳：1 年目に聞いたが答えの無かった問い（開いたまま。規則にできない）／年度だけが違う問い（年度を伏せない鍵では 1 年目に無い。年度ごとに正解が変わりうる）／そのほか
    const answeredIds = new Set(y1.answered.map((d) => d.questionId));
    const answeredKeys = new Set(y1.analysis.questions.filter((q) => answeredIds.has(q.questionId)).map((q) => questionKey(q, files).key));
    const yearKeys = new Set(y1.analysis.questions.map((q) => `${q.kind}|${countShape(questionKey(q, files).match)}`));
    let againUnanswered = 0;
    let againYear = 0;
    for (const q of again) {
      if (!answeredKeys.has(questionKey(q, files).key)) againUnanswered++;
      else if (!yearKeys.has(`${q.kind}|${countShape(questionKey(q, files).match)}`)) againYear++;
    }
    return { ...row, firstRead: { askedAgain: again.length, askedAgainUnanswered: againUnanswered, askedAgainYear: againYear, askedNew: askedQs.length - again.length, askedAgainKinds: againKinds, year: split.year, firstFiles: split.first.length, restFiles: split.rest.length, restYears: split.restYears, firstAsked: y1.result.asked, rules: rules.length, ruleAnswered: got.analysis.ruleAnswers.size, ruleWrong, restAsked: got.result.asked, restAskedNoRules: noRules.result.asked } };
  } catch (e) {
    return { ...emptyRow(n), seconds: secondsSince(t0), error: e instanceof Error ? e.message.slice(0, 300) : "道具が投げた" };
  }
}

describe("Skillパックの物差し", () => {
  const out = process.env.MOYAI_BENCH_OUT;
  const pack = process.env.MOYAI_BENCH_PACK ?? "waste-incineration";
  const only = (process.env.MOYAI_BENCH_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const rulesPath = process.env.MOYAI_BENCH_RULES;
  /** 初めて読む測り：パックなしで 1 年目 → 規則 → 残りの年度（MOYAI_BENCH_FIRST_READ=1） */
  const firstRead = process.env.MOYAI_BENCH_FIRST_READ === "1";
  it.runIf(!!out)("工場 v2 の施設をすべて測り、表を書く", async () => {
    // ルールの案：範囲（scope）は書いていなければ会社にする（Skillパックの読み方は範囲を持たない。効き方は同じで、下書きとして先に当たる）
    let candidate: { name: string; rules: number; sha256: string } | null = null;
    const readings: LoadedReading[] = [];
    if (rulesPath) {
      const bytes = readFileSync(rulesPath);
      const raw = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      const skill = ReadingSkill.parse({ scope: "company", ...raw });
      candidate = { name: skill.name, rules: skill.rules.length, sha256: createHash("sha256").update(bytes).digest("hex") };
      readings.push({ skill, version: `candidate-${candidate.sha256.slice(0, 8)}`, path: null, approved: false, draft: true });
    }
    const root = join("samples", pack);
    const all = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(root, e.name, "answer", "world.json")))
      .map((e) => e.name)
      .sort();
    const names = only.length ? all.filter((n) => only.includes(n)) : all;
    expect(names.length, "測る施設が 0 件").toBeGreaterThan(0);
    const rows: BenchRow[] = [];
    const skipped: string[] = [];
    for (const n of names) {
      let v: ReturnType<typeof loadV2Facility>;
      try {
        v = loadV2Facility(join(root, n), n);
      } catch (e) {
        rows.push({ ...emptyRow(n), error: e instanceof Error ? e.message.slice(0, 300) : "道具が投げた" });
        continue;
      }
      if (!firstRead) {
        rows.push(await measure(n, v, readings));
      } else {
        const split = yearSplit(v.set.truth.files.filter((f) => f.kind !== "photo").map((f) => f.file));
        if (!split) {
          skipped.push(n);
          continue;
        }
        rows.push(await measureFirstRead(n, v, split));
      }
      const x = rows[rows.length - 1]!;
      console.log(`物差し ${pack}/${n}：⑤ ${x.asked}（開いたまま ${x.open}）・② ${x.unresolvedAfter}・計画 ${x.planMade ? "作った" : "作らなかった"}・⑥ ${x.recovery.correct}/${x.recovery.total}・${x.seconds} 秒${x.firstRead ? `・1 年目 ${x.firstRead.firstAsked} → 残り ${x.firstRead.restAsked}（ルールなし ${x.firstRead.restAskedNoRules}）` : ""}${x.error ? "・測れなかった" : ""}`);
    }
    const reader = { commit: git("rev-parse", "HEAD"), src: git("rev-parse", "HEAD:src"), packs: git("rev-parse", "HEAD:packs"), dirty: git("status", "--porcelain", "--", "src", "packs", "tests/heldout") !== "" };
    const measuredAt = new Date().toISOString();
    const total = {
      facilities: rows.length,
      planMade: rows.filter((x) => x.planMade).length,
      asked: rows.reduce((a, x) => a + x.asked, 0),
      open: rows.reduce((a, x) => a + x.open, 0),
      unresolvedAfter: rows.reduce((a, x) => a + x.unresolvedAfter, 0),
      accuracy: sum(rows.flatMap((x) => (x.accuracy ? [x.accuracy] : []))),
      recovery: sum(rows.map((x) => x.recovery)),
      manDays: sum(rows.flatMap((x) => (x.manDays ? [x.manDays] : []))),
      days: sum(rows.flatMap((x) => (x.days ? [x.days] : []))),
      errors: rows.filter((x) => x.error).length,
      ...(firstRead
        ? {
            firstRead: {
              firstAsked: rows.reduce((a, x) => a + (x.firstRead?.firstAsked ?? 0), 0),
              restAsked: rows.reduce((a, x) => a + (x.firstRead?.restAsked ?? 0), 0),
              restAskedNoRules: rows.reduce((a, x) => a + (x.firstRead?.restAskedNoRules ?? 0), 0),
              rules: rows.reduce((a, x) => a + (x.firstRead?.rules ?? 0), 0),
              ruleAnswered: rows.reduce((a, x) => a + (x.firstRead?.ruleAnswered ?? 0), 0),
              ruleWrong: rows.reduce((a, x) => a + (x.firstRead?.ruleWrong ?? 0), 0),
              askedAgain: rows.reduce((a, x) => a + (x.firstRead?.askedAgain ?? 0), 0),
              askedNew: rows.reduce((a, x) => a + (x.firstRead?.askedNew ?? 0), 0),
              askedAgainUnanswered: rows.reduce((a, x) => a + (x.firstRead?.askedAgainUnanswered ?? 0), 0),
              askedAgainYear: rows.reduce((a, x) => a + (x.firstRead?.askedAgainYear ?? 0), 0),
              skipped,
            },
          }
        : {}),
    };
    mkdirSync(out!, { recursive: true });
    writeFileSync(join(out!, "result.json"), `${JSON.stringify({ schema: "moyai.pack-bench.result/0", pack, ...(firstRead ? { mode: "first-read" } : {}), only: only.length ? only : null, candidate, reader, measuredAt, total, facilities: rows }, null, 1)}\n`, "utf8");
    const L = [
      firstRead ? `# 初めて読む物差し：${pack} の資料をパックなしで（開発用の資料。見ていない様式の結果ではない）` : `# Skillパックの物差し：${pack}（開発用の資料。見ていない様式の結果ではない）`,
      "",
      firstRead ? "`node scripts/bench/pack-bench.mjs --first-read` が作る（手で書かない）。" : "`node scripts/bench/pack-bench.mjs` が作る（手で書かない）。",
      "",
      ...(firstRead && total.firstRead
        ? [
            "Skillパックを選ばずに（パックなし）、1 年目の資料だけを読み、台本の答えを決まった答えの規則（1 年目の読み方）にして、残りの年度を足した全部の資料を読み直した。下の表の行の数は、その最後の読み。",
            "1 年目は、名前に年度が 1 つだけある資料のいちばん多い年度（同じ数なら新しい年度）と、年度に分けられない資料（範囲の資料・台帳）。年度ごとの資料の無い施設は測らない。",
            "",
            `合計：1 年目の問い ${total.firstRead.firstAsked} → 残りの年度を足したときの問い ${total.firstRead.restAsked}（1 年目の規則 ${total.firstRead.rules} 件で決まった問い ${total.firstRead.ruleAnswered}、そのうち正解の台本と違う答え ${total.firstRead.ruleWrong}。規則なしで全部を読むと ${total.firstRead.restAskedNoRules}）。残りを足した問いのうち (a) 1 年目にもあった問い ${total.firstRead.askedAgain}（うち 1 年目に答えの無かった問い ${total.firstRead.askedAgainUnanswered}・年度だけが違う問い ${total.firstRead.askedAgainYear}・そのほか ${total.firstRead.askedAgain - total.firstRead.askedAgainUnanswered - total.firstRead.askedAgainYear}）・(b) 1 年目に無かった問い ${total.firstRead.askedNew}`,
            "",
            "| 施設 | 1 年目（年度・資料） | 1 年目の問い N | 規則 | 残り（年度・資料） | 残りを足した問い K | 残りの 1 年あたり K÷年度 | (a) 1 年目にもあった問い | (b) 1 年目に無かった問い | 規則で決まった問い | うち正解と違う答え | 規則なしの問い M0 |",
            "|---|---|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|",
            ...rows.map((x) => (x.firstRead ? `| ${x.facility} | ${x.firstRead.year}・${x.firstRead.firstFiles} | ${x.firstRead.firstAsked} | ${x.firstRead.rules} | ${x.firstRead.restYears}・${x.firstRead.restFiles} | ${x.firstRead.restAsked} | ${(x.firstRead.restAsked / x.firstRead.restYears).toFixed(1)} | ${x.firstRead.askedAgain} | ${x.firstRead.askedNew} | ${x.firstRead.ruleAnswered} | ${x.firstRead.ruleWrong} | ${x.firstRead.restAskedNoRules} |` : `| ${x.facility} | 測れなかった | — | — | — | — | — | — | — | — | — | — |`)),
            "- K は、全部の資料を 1 年目の規則で読み直したときに、規則で決まらずに残った問い。規則は、そのままの字か、くり返しの数（行・問・か所）だけが違う同じ問いに当たる（年度・番号・中身の数は伏せて広げない。src/import/reading.ts の countShape）。人に聞く数はこれ。",
            "- 残りの 1 年あたりは K を残りの年度の数で割った値。1 年目の問い N より小さければ、2 年目からが速い。",
            "- 規則は、1 年目の問いごとの答え（名前ごと）だけ。既定の答えを受けた問い（人が推された答えを押したもの）も規則にする。年度や数だけが違って答えの分かれた問いは、規則にしない。",
            "- (a)(b) は、K を 2 つに分けたもの。(a) は、同じ鍵（問いの種類と、資料の名前を除いた文。年度と数は伏せる。tests/heldout/first-read.ts の questionKey）の問いが 1 年目にもあったのに、また聞いた問い（1 年目に見たものを二度聞いている。0 にする）。(b) は 1 年目に無かった問い（新しい機器・様式・作業。聞くのが正しい）。",
            "- (a) の内訳：1 年目に答えの無かった問い（1 年目に開いたまま。規則を作れない）、年度だけが違う問い（年度を伏せない鍵では 1 年目に無い。年度ごとに正解が変わりうるので、規則を年度をまたいで当てない）、そのほか（まとめた 1 問の中身の数〔何件・何通り〕が増えた問いなど）。",
            ...rows.filter((x) => x.firstRead?.askedAgain).map((x) => `- ${x.facility} の (a) の問いの種類：${Object.entries(x.firstRead!.askedAgainKinds).sort((p, q) => q[1] - p[1]).map(([k, n]) => `${k} ${n}`).join("、")}`),
            "- 正解と違う答えは、規則で決まった問いのうち、正解の台本が答えられて、その答えと規則の答えが違う数。台本が正解から答えられない問いは数えていない。",
            ...(total.firstRead.skipped.length ? ["", `- 年度ごとの資料が無いので測っていない施設：${total.firstRead.skipped.join("・")}`] : []),
            "",
          ]
        : []),
      `測った読み手：${reader.commit.slice(0, 7)}（src ${reader.src.slice(0, 7)}・packs ${reader.packs.slice(0, 7)}${reader.dirty ? "、commit していない変更あり" : ""}）。測った日時：${measuredAt}（UTC）。${only.length ? `施設を絞った（${only.join("・")}）。` : ""}`,
      candidate ? `ルールの案を当てた：「${candidate.name}」（${candidate.rules} 件・SHA-256 ${candidate.sha256.slice(0, 16)}…）。Skillパックに入れる前の試しで、この値は案の値。` : "会話で作った読み方（3 段目）は当てていない。",
      "質問には、正解だけを見る台本が人の代わりに答えた。台本が正解から答えられない問いは、既定の答えがあればそれを受けた（人が推された答えを押すのと同じ。数は下の注）。AI も API も使っていない。",
      "写真は読んでいない：読んでいない写真は、人が「読まずに外す」を押したものとして外した（写真の行は計画に入らず、⑥ の分母には残る）。",
      "",
      `合計：計画を作れた ${total.planMade}/${total.facilities} 施設・⑤ 質問 ${total.asked}（開いたまま ${total.open}）・② 未解決 ${total.unresolvedAfter}・③ ${pct(total.accuracy)}・⑥ ${pct(total.recovery)}・工数 ${pct(total.manDays)}・日数 ${pct(total.days)}${total.errors ? `・測れなかった ${total.errors}` : ""}`,
      "",
      "| 施設 | 資料 | ⑤ 質問（台本が答えた・開いたまま） | ② 未解決（答える前 → 後） | 計画 | ③ 読み取りの正しさ | ⑥ 取り戻せた割合 | 工数 | 日数 | 時間 |",
      "|---|---:|---|---|---|---|---|---|---|---:|",
      ...rows.map((x) =>
        x.error
          ? `| ${x.facility} | — | — | — | 測れなかった（${x.error.replace(/\|/g, "／").replace(/\s+/g, " ")}） | — | — | — | — | ${x.seconds} 秒 |`
          : `| ${x.facility}（${x.name}） | ${x.files} | ${x.asked}（${x.answered}・${x.open}） | ${x.unresolvedBefore} → ${x.unresolvedAfter} | ${x.plan ? `機器 ${x.plan.assets}・作業 ${x.plan.works}・明細 ${x.plan.details}` : `作れない（${x.blockers.join("・")}）`} | ${pct(x.accuracy)} | ${pct(x.recovery)} | ${pct(x.manDays)} | ${pct(x.days)} | ${x.seconds} 秒 |`,
      ),
      "",
      "- ③ は、計画を作れた施設の、資料ごとの正しさの和（機器・印・作業の行）。計画が無ければ測れない（—）。合計の ③ は、計画を作れた施設だけの和。",
      ...(rows.some((x) => x.extra) ? [`- ③ の読みすぎ（正解に無いのに計画に読んだ数）：${rows.filter((x) => x.extra).map((x) => `${x.facility} ${x.extra}`).join("、")}`] : []),
      "- ⑥ は、作業そのものを書いた行のある作業のうち、計画の作業に、機器・年度・資料の行がそろって取り戻せた数。計画を作れなかった施設は 0 として分母に入れる。",
      "- ⑥ の作業の場所は、実績として書いてある印と行。予定として書いてある印（予定の列・実績を書かずに予定のまま残した印）は、作業をしたという記録に数えない。",
      "- 正解は工場 v2 の形で、tests/heldout/v2.ts が契約の形に写す。契約の行だけの結び（年間の委託・まとめた工事）は出来事にしない。",
      "- 星取表は、印・機器・まとまりを写す。機器台帳の行（1 行が何台もの機器を表す）は写していない。機器を結ぶ問いは、正解が両方の機器を知っているときだけ台本が答える。",
      ...(() => {
        const star = (k: string) => rows.filter((x) => x.dropped[k]).map((x) => `${x.facility} ${x.dropped[k]}`).join("、");
        const keys = [...new Set(rows.flatMap((x) => Object.keys(x.dropped)))].filter((k) => k.startsWith("星取表：")).sort();
        return keys.map((k) => `- ③ に数えていない印（${k.slice("星取表：".length)}）：${star(k)}`);
      })(),
      ...rows.filter((x) => x.open).map((x) => `- ${x.facility} の開いたままの問い：${Object.entries(x.openKinds).map(([k, v]) => `${k} ${v}`).join("、")}`),
      ...rows.filter((x) => Object.keys(x.defaulted).length).map((x) => `- ${x.facility} の既定の答えを受けた問い：${Object.entries(x.defaulted).map(([k, v]) => `${k} ${v}`).join("、")}`),
      ...rows.filter((x) => x.unresolvedAfter).map((x) => `- ${x.facility} の未解決のセルが待っている問い：${Object.entries(x.unresolvedBy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("、")}`),
      ...rows.filter((x) => x.unplaced).map((x) => `- ${x.facility}：物差しが正解を資料のセルに引き当てられなかった所がある（${x.unplaced}${x.unplaced >= 50 ? " 以上" : ""}。読み手の値ではなく、物差しの側の穴）`),
      "",
    ];
    writeFileSync(join(out!, "README.md"), L.join("\n"), "utf8");
    expect(rows.length).toBeGreaterThan(0);
  }, 3_600_000);
});
