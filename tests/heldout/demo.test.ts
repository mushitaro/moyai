// デモの 3 施設（動画の材料。PM の決定 2026-11-05）：A＝fictional-1、B＝fictional-2（開発用の工場の資料）、C＝ほたる川（工場 v2、作業日報と発注台帳だけ）を、
// 見ていない様式と同じ物差し（harness.ts・contract.ts）で測る。どれも見ていない様式ではない（開発用の資料とデモの材料）。結果は heldout とは別の表に出す。
// MOYAI_DEMO_OUT=<フォルダ> のときだけ走る（result.json と README.md を書く）。MOYAI_DEMO_C=<施設 C のフォルダ>（files/ と answer/）。
// 質問には、正解だけを見る台本が人の代わりに答える。時間は、資料を入れてから計画ができる（か止まる）までの、台本が答える時間を含む壁の時計。
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { exportWorld } from "../../scripts/heldout/export-world.mjs";
import { loadTruth } from "../unit/import/truth";
import { loadSet, type LoadedSet } from "./contract";
import { CASES, PACK, fromDev } from "./dev";
import { runSet, type SetResult } from "./harness";
import { loadV2Facility } from "./v2";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

interface DemoRow {
  key: string;
  label: string;
  seconds: number;
  dropped: Record<string, number>;
  result: SetResult;
}

const sum = (xs: { correct: number; total: number }[]) => xs.reduce((a, b) => ({ correct: a.correct + b.correct, total: a.total + b.total }), { correct: 0, total: 0 });
const pct = (a: { correct: number; total: number } | null) => (a && a.total ? `${a.correct}/${a.total}（${((a.correct / a.total) * 100).toFixed(1)}%）` : "—");

describe("デモの 3 施設", () => {
  const out = process.env.MOYAI_DEMO_OUT;
  it.runIf(!!out)("A・B・C を同じ物差しで測り、表を書く", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "moyai-demo-"));
    const sets: { key: string; label: string; set: LoadedSet; facts: Record<string, unknown>; dropped: Record<string, number> }[] = [];
    for (const [key, c] of [
      ["A", CASES[0]],
      ["B", CASES[1]],
    ] as const) {
      if (!c) continue;
      const t = loadTruth(PACK, c.facility);
      const files = c.files(t);
      const dir = join(tmp, c.facility);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "world.json"), JSON.stringify(exportWorld(t.world, t.crossdoc?.precision_work_ids ?? [])));
      writeFileSync(join(dir, "truth.json"), JSON.stringify(fromDev(t, files)));
      sets.push({ key, label: `${c.facility}（開発用の工場の資料）`, set: loadSet(dir, { filesDir: `samples/out/${PACK}/${c.facility}` }), facts: Object.fromEntries(Object.entries(t.facts)), dropped: {} });
    }
    const cdir = process.env.MOYAI_DEMO_C;
    if (cdir) {
      const v = loadV2Facility(cdir, "demo-C");
      sets.push({ key: "C", label: "ほたる川（工場 v2。作業日報 5 冊と発注台帳、星取表なし）", set: v.set, facts: {}, dropped: v.dropped });
    }
    const rows: DemoRow[] = [];
    for (const s of sets) {
      const t0 = performance.now();
      const { result } = await runSet(s.set, { facts: s.facts, facilityKey: s.set.world.facility.id });
      rows.push({ key: s.key, label: s.label, seconds: Math.round((performance.now() - t0) / 100) / 10, dropped: s.dropped, result });
    }
    rmSync(tmp, { recursive: true, force: true });
    const reader = { commit: git("rev-parse", "HEAD"), src: git("rev-parse", "HEAD:src"), dirty: git("status", "--porcelain", "--", "src", "packs") !== "" };
    const measuredAt = new Date().toISOString();
    mkdirSync(out!, { recursive: true });
    writeFileSync(join(out!, "result.json"), `${JSON.stringify({ schema: "moyai.demo.result/0", reader, measuredAt, facilities: rows }, null, 1)}\n`, "utf8");
    const at = (r: SetResult) => (r.planMade ? sum(r.files.flatMap((f) => (f.accuracy ? [f.accuracy] : []))) : null);
    const L = [
      "# デモの 3 施設（heldout と同じ物差し。見ていない様式の結果ではない）",
      "",
      `測った読み手：${reader.commit.slice(0, 7)}（src ${reader.src.slice(0, 7)}${reader.dirty ? "、commit していない変更あり" : ""}）。測った日時：${measuredAt}（UTC）。`,
      "質問には、正解だけを見る台本が人の代わりに答えた。時間は、資料を入れてから計画ができる（か止まる）までの壁の時計（台本が答える時間を含む）。",
      "",
      "| 施設 | ⑤ 質問（台本が答えた・開いたまま） | ② 未解決（答える前 → 後） | 計画 | ③ 読み取りの正しさ | ⑥ 取り戻せた割合 | 工数 | 日数 | 時間 |",
      "|---|---|---|---|---|---|---|---|---:|",
      ...rows.map((x) => {
        const r = x.result;
        const rc = r.recovery;
        return `| ${x.key}：${x.label} | ${r.asked}（${r.answered}・${r.openAtEnd.length}） | ${r.unresolvedBefore} → ${r.unresolvedAfter} | ${r.plan ? `機器 ${r.plan.assets}・作業 ${r.plan.works}・明細 ${r.plan.details}` : `作れない（${r.blockers.join("・")}）`} | ${pct(at(r))} | ${rc.together}/${rc.denominator}（${rc.denominator ? ((rc.together / rc.denominator) * 100).toFixed(1) : "—"}%） | ${pct(rc.manDays)} | ${pct(rc.days)} | ${x.seconds} 秒 |`;
      }),
      "",
      "- ③ は、計画を作れた施設の、資料ごとの正しさの和（機器・印・作業の行）。計画が無ければ測れない（—）。",
      "- ⑥ は、作業そのものを書いた行のある作業のうち、計画の作業に、機器・年度・資料の行がそろって取り戻せた数。工数・日数は、その作業の値が正解と合った数。",
      "- 施設 C の正解は工場 v2 の形で、tests/heldout/v2.ts が契約の形に写した。契約の行だけの結び（年間の委託・まとめた工事）は、作業そのものの行ではないので出来事にしない。",
      ...rows.filter((x) => Object.keys(x.dropped).length).map((x) => `- 施設 ${x.key} の写さなかった結び：${Object.entries(x.dropped).map(([k, v]) => `${k} ${v}`).join("、")}`),
      "",
    ];
    writeFileSync(join(out!, "README.md"), L.join("\n"), "utf8");
    for (const x of rows) console.log(`デモ ${x.key}：⑤ ${x.result.asked}・② ${x.result.unresolvedAfter}・計画 ${x.result.planMade ? "作った" : "作らなかった"}・⑥ ${x.result.recovery.together}/${x.result.recovery.denominator}・${x.seconds} 秒`);
    expect(rows.length).toBeGreaterThan(0);
  }, 1_800_000);
});
