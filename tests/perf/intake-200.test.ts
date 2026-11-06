// 資料 200 個で、主のスレッドが止まらないかを測る（取り込みを worker に移した仕事の物差し）。
// 工場の架空の資料（fictional-1 の 37 個）を名前を変えて 200 個にし、node の worker_threads に置いた取り込みの受け手（画面の worker と同じ）へ入れる。
// 主のスレッドの 1 回の仕事の長さは、イベントループの遅れの最大（perf_hooks の monitorEventLoopDelay）で測る。200 ms を越えたら落とす。
// 受け手を worker に置くため、受け手を Vite の SSR のビルドで一時のフォルダに 1 つのファイルにする（依存は node_modules から読む）。
// 測った値は標準出力に出す（日誌と報告に、測った値のまま写す）。資料の中身は出さない。
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { build } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { WorkerEngine } from "../../src/app/intake/engine";
import { IntakeWorkspace, type DroppedFile } from "../../src/app/intake/workspace";
import { runTabToolAsync, type TabToolResult } from "../../src/app/intake/tab-tools";
import type { FromHost } from "../../src/app/intake/worker-protocol";
import { clearWorkingPlan } from "../../src/app/state/plan-store";

const DIR = "samples/out/waste-incineration/fictional-1";
const COUNT = 200;
const LIMIT_MS = 200;
const CTX = { conversation: "c-perf-200", rowsRemaining: 2000 };

afterEach(() => clearWorkingPlan());

function walk(d: string): string[] {
  return readdirSync(d)
    .sort()
    .flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
}

/** 工場の資料を名前を変えて count 個にする（2 巡目からは名前に -2・-3… を足す。中身は同じでも名前が違うので、どれも読む） */
function factoryFiles(count: number): DroppedFile[] {
  const base = walk(DIR).map((p) => ({ name: p.split(/[\\/]/).pop()!, bytes: new Uint8Array(readFileSync(p)) }));
  return Array.from({ length: count }, (_, i) => {
    const f = base[i % base.length]!;
    const round = Math.floor(i / base.length);
    const name = round ? f.name.replace(/(\.[A-Za-z]+)$/, `-${round + 1}$1`) : f.name;
    return { name, size: f.bytes.length, bytes: async () => f.bytes.slice() };
  });
}

/** 受け手を node の worker のファイルにする（一時のフォルダ。依存は node_modules への道で読む） */
async function buildWorker(out: string): Promise<string> {
  symlinkSync(resolve("node_modules"), join(out, "node_modules"), "junction");
  await build({
    configFile: false,
    logLevel: "silent",
    define: { __MOYAI_BUILD__: JSON.stringify({ time: "perf", commit: "perf" }) },
    build: {
      ssr: resolve("tests/perf/intake-node-worker.ts"),
      outDir: out,
      emptyOutDir: false,
      target: "node22",
      minify: false,
      rolldownOptions: { output: { entryFileNames: "intake-worker.mjs" } },
    },
  });
  return join(out, "intake-worker.mjs");
}

function ok(r: TabToolResult): Record<string, unknown> {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

describe("資料 200 個（worker）", () => {
  it(`主のスレッドの 1 回の仕事が ${LIMIT_MS} ms を越えない`, async () => {
    const out = mkdtempSync(join(tmpdir(), "moyai-perf-worker-"));
    let worker: Worker | null = null;
    try {
      const entry = await buildWorker(out);
      const files = factoryFiles(COUNT);
      worker = new Worker(entry);
      const w = worker;
      const engine = new WorkerEngine({
        post: (msg, transfer) => w.postMessage(msg, transfer as unknown as ArrayBuffer[]),
        listen: (on, fail) => {
          w.on("message", (m: FromHost) => on(m));
          w.on("error", () => fail());
        },
      });
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】ひかり台工場", fiscalYearStartMonth: 4, fictional: true }, engine);
      let progress = 0;
      ws.subscribe(() => {
        if (ws.readProgress) progress++;
      });

      const h = monitorEventLoopDelay({ resolution: 10 });
      const phases: { name: string; wallMs: number; maxBlockMs: number }[] = [];
      const phase = async <T>(name: string, f: () => Promise<T>): Promise<T> => {
        h.reset();
        const t = performance.now();
        const r = await f();
        phases.push({ name, wallMs: performance.now() - t, maxBlockMs: h.max / 1e6 });
        return r;
      };
      h.enable();

      // 1. 200 個を落とす。読んでいる途中に AI の要約を 1 回呼ぶ（読みの途中でもツールは答える）
      let midSurvey: Promise<TabToolResult> | null = null;
      let midMs = 0;
      let midLeft = 0;
      ws.subscribe(() => {
        if (!midSurvey && (ws.readProgress?.done ?? 0) >= 50) {
          const at = performance.now();
          midSurvey = runTabToolAsync(ws, "intake_survey", { part: "questions" }, CTX).then((r) => {
            midMs = performance.now() - at;
            const p = ws.readProgress;
            midLeft = p ? p.total - p.done : 0;
            return r;
          });
        }
      });
      await phase("読込（200 個）と、読み終わったあとの写し", () => ws.addFiles(files));
      expect(midSurvey).not.toBeNull();
      const mid = ok(await midSurvey!);
      expect(ws.fileCount).toBe(COUNT);
      expect(ws.readProgress).toBeNull();
      expect(ws.view.files.length).toBeGreaterThan(0);

      // 2. AI の要約（読み取りは覚えたものを使う）
      const s = ok(await phase("intake_survey", () => runTabToolAsync(ws, "intake_survey", { part: "questions" }, CTX)));
      const qs = s.questions as { questionId: string; defaultAnswer: string | null }[];

      // 3. AI の決定 1 つ（受け手が読み直す）と、そのあとの写し
      const q = qs.find((x) => x.defaultAnswer !== null);
      if (q) {
        ok(
          await phase("intake_settle", () =>
            runTabToolAsync(ws, "intake_settle", { decisions: [{ questionId: q.questionId, answer: q.defaultAnswer, author: "ai_relayed_human", reason: "試験の台本" }] }, CTX),
          ),
        );
        await phase("決定のあとの写し", () => ws.fresh());
      }

      // 4. 画面が開く資料 1 つのシートと、次の未解決のセル
      const first = ws.view.sheets[0]?.file ?? null;
      if (first) await phase("資料 1 つのシート", () => ws.sheets(first));
      await phase("次の未解決のセル", () => ws.nextUnresolved(null));
      h.disable();

      const worst = Math.max(...phases.map((p) => p.maxBlockMs));
      console.log(`資料 ${COUNT} 個、進みの知らせ ${progress} 回、質問 ${ws.view.questions.length}、未解決のセル ${ws.view.unresolvedCells}`);
      console.log(`読込の途中（50 個目のあと）に呼んだ intake_survey：答えまで ${midMs.toFixed(0)} ms、要約に入った資料 ${(mid.files as unknown[]).length}、答えたときに残っていた資料 ${midLeft}`);
      for (const p of phases) console.log(`${p.name}：かかった時間 ${(p.wallMs / 1000).toFixed(1)} 秒、主のスレッドの 1 回の仕事の最大 ${p.maxBlockMs.toFixed(1)} ms`);
      console.log(`主のスレッドの 1 回の仕事の最大（全体）：${worst.toFixed(1)} ms（上限 ${LIMIT_MS} ms）`);
      expect(worst).toBeLessThanOrEqual(LIMIT_MS);
    } finally {
      await worker?.terminate();
      // node_modules への道（junction）を先に外す（たどって中身を消さない）
      const link = join(out, "node_modules");
      if (existsSync(link) && lstatSync(link).isSymbolicLink()) unlinkSync(link);
      rmSync(out, { recursive: true, force: true });
    }
  }, 900_000);
});
