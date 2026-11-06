// 施設 C（ほたる川：作業日報 5 冊と発注台帳）で、intake_settle 1 回の時間を測る（Architect の 63 の 4。目安は 10 秒より下）。
// MOYAI_PERF=1 のときだけ走る。測った値は標準出力に出し、日誌に写す（測った値のまま）
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { runTabTool } from "../../src/app/intake/tab-tools";
import { clearWorkingPlan } from "../../src/app/state/plan-store";
import { IntakeSession } from "../../src/import/session";

const DIR = "samples/waste-incineration/hotarugawa/files";
const CTX = { conversation: "c-perf", rowsRemaining: 2000 };

describe("施設 C の settle の時間", () => {
  it.runIf(process.env.MOYAI_PERF === "1")("settle 1 回の時間と、資料を読み直した回数", async () => {
    try {
      const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】ほたる川", fiscalYearStartMonth: 4, fictional: true });
      const files = readdirSync(DIR).map((n) => {
        const b = new Uint8Array(readFileSync(join(DIR, n)));
        return { name: n, size: b.length, bytes: async () => b };
      });
      let t = performance.now();
      await ws.addFiles(files);
      const first = runTabTool(ws, "intake_survey", { part: "questions" }, CTX);
      console.log(`資料を入れて最初の要約まで ${((performance.now() - t) / 1000).toFixed(1)} 秒`);
      expect(first.ok).toBe(true);
      const spy = vi.spyOn(IntakeSession.prototype, "analyze");
      for (let round = 1; round <= 3; round++) {
        const s = runTabTool(ws, "intake_survey", { part: "questions" }, CTX);
        const qs = s.ok ? ((s.data as { questions: { questionId: string; kind: string; defaultAnswer: string | null; options: { id: string }[] }[] }).questions ?? []) : [];
        if (!qs.length) break;
        const q = qs.find((x) => x.defaultAnswer !== null) ?? qs[0]!;
        const before = spy.mock.calls.length;
        t = performance.now();
        const r = runTabTool(ws, "intake_settle", { decisions: [{ questionId: q.questionId, answer: q.defaultAnswer ?? q.options[0]?.id ?? "", author: "ai_relayed_human", reason: "試験の台本" }] }, CTX);
        const sec = (performance.now() - t) / 1000;
        console.log(`settle ${round} 回目（${q.kind}）：${sec.toFixed(1)} 秒、読み直し ${spy.mock.calls.length - before} 回、ok=${r.ok}、質問 ${qs.length}`);
      }
      spy.mockRestore();
    } finally {
      clearWorkingPlan();
    }
  }, 600_000);
});
