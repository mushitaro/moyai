// 資料のフォルダを今の読み手で読み、表の形・質問・未解決を書き出す道具（正解を使わない）。
// MOYAI_PROBE=<資料のフォルダ> のときだけ走る。MOYAI_PROBE_OUT=<JSON の道> なら結果を書く。MOYAI_PROBE_SHAPES=1 なら表ごとの形（見出し・列の役目）も出す。
// 質問には人の答えの代わりに既定の答え（無ければ最初の選択肢）を置き直し、何回目で止まるかを見る。正解と比べないので ③⑥ は測らない。
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { IntakeSession } from "../../src/import/session";

const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));

describe("import.probe：資料を読んで形を見る", () => {
  const dir = process.env.MOYAI_PROBE;
  it.runIf(!!dir)("資料のフォルダを読み、質問・未解決・計画を書き出す", async () => {
    const names = walk(dir!).filter((p) => /\.(xlsx|csv|pdf)$/i.test(p)).map((p) => relative(dir!, p).replace(/\\/g, "/"));
    const s = new IntakeSession({
      planId: "probe",
      displayName: "probe",
      packId: "waste-incineration",
      facility: { facilityKey: "probe", name: "probe", fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
    });
    await s.add(names.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(join(dir!, n))) })));
    const first = s.analyze();
    const unresolvedOf = (an: ReturnType<IntakeSession["analyze"]>) => [...an.composition.status.values()].filter((x) => x.s === "unresolved").length;
    const askedFirst = first.questions.length;
    const kinds = (qs: { kind: string }[]) => qs.reduce<Record<string, number>>((m, q) => ((m[q.kind] = (m[q.kind] ?? 0) + 1), m), {});
    const shapes = process.env.MOYAI_PROBE_SHAPES
      ? first.layouts.flatMap((l) =>
          l.tables.map((t) => ({
            file: l.file,
            sheet: l.sheet,
            rows: `${t.top}-${t.bottom}`,
            shape: t.shape,
            header: t.headerRows,
            cols: t.cols.map((c) => `${c.c}:${c.header.slice(0, 16)}=${c.role}`),
            data: t.rows.filter((r) => r.role === "data").length,
            issues: t.issues.map((i) => i.kind),
          })),
        )
      : undefined;
    // 既定の答えで置き直す（何回かくり返す。答えで新しい質問が出るため）
    const passes: { open: number; unresolved: number }[] = [];
    let an = first;
    for (let pass = 0; pass < 6 && an.open.length; pass++) {
      s.settle(an.open.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer ?? q.options[0]?.id ?? "", author: "ai" as const, reason: "既定の答え（probe）" })));
      an = s.analyze();
      passes.push({ open: an.open.length, unresolved: unresolvedOf(an), kinds: kinds(an.open), sample: an.open.slice(0, 3).map((q) => `${q.kind}：${q.text.slice(0, 200)}｜${q.options.map((o) => `${o.id}=${o.label}`).join("、")}`) } as never);
    }
    const comp = s.compose();
    const out = {
      schema: "moyai.probe/0",
      dir,
      files: comp.counts.map((c) => ({ file: c.file, input: c.inputRows, imported: c.importedRows, excluded: c.excludedRows, unresolvedRows: c.unresolvedRows, unresolvedCells: c.unresolvedCells })),
      first: { asked: askedFirst, kinds: kinds(first.questions), unresolved: unresolvedOf(first), open: first.open.slice(0, 30).map((q) => `${q.kind}：${q.text.slice(0, 160)}`) },
      defaults: { passes, open: an.open.map((q) => `${q.kind}：${q.text.slice(0, 160)}`).slice(0, 30), unresolved: unresolvedOf(an) },
      plan: comp.plan ? { assets: comp.plan.assets.length, works: comp.plan.works.length, details: comp.plan.details.length } : null,
      blockers: comp.blockers,
      stuck: s.survey().stuck.slice(0, 5),
      ...(shapes ? { shapes } : {}),
    };
    if (process.env.MOYAI_PROBE_OUT) writeFileSync(process.env.MOYAI_PROBE_OUT, `${JSON.stringify(out, null, 1)}\n`, "utf8");
    console.log(`probe ${dir}：質問 ${askedFirst}・未解決 ${out.first.unresolved} → 既定の答えのあと ${out.defaults.unresolved}・計画 ${out.plan ? `機器 ${out.plan.assets}・作業 ${out.plan.works}・明細 ${out.plan.details}` : "作らなかった"}`);
    expect(names.length).toBeGreaterThan(0);
  }, 1_200_000);
});
