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
import { ReadingSkill, type LoadedReading } from "../../src/import/reading";
import { runSet, type SetResult } from "./harness";
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
}

const sum = (xs: Ratio[]): Ratio => xs.reduce((a, b) => ({ correct: a.correct + b.correct, total: a.total + b.total }), { correct: 0, total: 0 });
const pct = (a: Ratio | null) => (a && a.total ? `${a.correct}/${a.total}（${((a.correct / a.total) * 100).toFixed(1)}%）` : "—");
const ratio = (a: { correct: number; total: number } | null | undefined): Ratio | null => (a ? { correct: a.correct, total: a.total } : null);

describe("Skillパックの物差し", () => {
  const out = process.env.MOYAI_BENCH_OUT;
  const pack = process.env.MOYAI_BENCH_PACK ?? "waste-incineration";
  const only = (process.env.MOYAI_BENCH_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const rulesPath = process.env.MOYAI_BENCH_RULES;
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
    for (const n of names) {
      const t0 = performance.now();
      const base = { facility: n, name: n, files: 0, seconds: 0, asked: 0, answered: 0, open: 0, openKinds: {}, defaulted: {}, unresolvedBy: {}, openSamples: [], unresolvedBefore: 0, unresolvedAfter: 0, planMade: false, blockers: [], plan: null, accuracy: null, extra: null, recovery: { correct: 0, total: 0 }, manDays: null, days: null, unplaced: 0, dropped: {}, error: null } satisfies BenchRow;
      try {
        const v = loadV2Facility(join(root, n), n);
        const { result: r, analysis } = await runSet(v.set, { facilityKey: v.set.world.facility.id, acceptDefaults: true, deferWholeFile: true, asWritten: true, excludeUnreadPhotos: true, ...(readings.length ? { readings } : {}) });
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
        rows.push({
          ...base,
          name: v.set.world.facility.name,
          files: r.files.length,
          seconds: Math.round((performance.now() - t0) / 100) / 10,
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
        });
      } catch (e) {
        rows.push({ ...base, seconds: Math.round((performance.now() - t0) / 100) / 10, error: e instanceof Error ? e.message.slice(0, 300) : "道具が投げた" });
      }
      const x = rows[rows.length - 1]!;
      console.log(`物差し ${pack}/${n}：⑤ ${x.asked}（開いたまま ${x.open}）・② ${x.unresolvedAfter}・計画 ${x.planMade ? "作った" : "作らなかった"}・⑥ ${x.recovery.correct}/${x.recovery.total}・${x.seconds} 秒${x.error ? "・測れなかった" : ""}`);
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
    };
    mkdirSync(out!, { recursive: true });
    writeFileSync(join(out!, "result.json"), `${JSON.stringify({ schema: "moyai.pack-bench.result/0", pack, only: only.length ? only : null, candidate, reader, measuredAt, total, facilities: rows }, null, 1)}\n`, "utf8");
    const L = [
      `# Skillパックの物差し：${pack}（開発用の資料。見ていない様式の結果ではない）`,
      "",
      "`node scripts/bench/pack-bench.mjs` が作る（手で書かない）。",
      "",
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
