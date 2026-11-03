// 物差し ③（写真。docs/plan.md §2.6）：工場の写真を、ほかの 3 つの資料（台帳・星取表・日報）と一緒に取り込み、
// 測った値をそのまま出す（目標は開発用で 100%。届かなければ届かないまま書く）。
// この試験では AI が画像を読まない：AI の読み取りの代わりに、試験が正解から書いた格子（tests/helpers/photo.ts）を置く。
// 質問には正解の世界から答える決まった台本（truth.ts）が、写真の確かめは試験の台本が、人の代わりに押す。
// 比べる正解：写真の正解（photos.truth.json）が指す報告書の頁に印刷された明細の行（reports.truth.json）と、その中の手書きの印の行。
// 行ごとに、その行のセルを出どころに持つ明細があり、実績・年度・日付・工数・対象の機器が正解と合うかを見る。
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { IntakeSession } from "../../../src/import";
import { Plan } from "../../../src/shared/plan";
import { PHOTO_DIR, PHOTO_NAME, photoBytes, photoTruth, truthReading, truthRowOf } from "../../helpers/photo";
import { loadTruth, pct, runScript, type Accuracy } from "./truth";

const PACK = "waste-incineration";
const FACILITY = "fictional-1";
const TRIO = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];

type J = Record<string, any>;

/** 写真の格子の 1 行（0 から）にある、計画の出どころのセルの参照（"A8" など。格子の行は 1 から） */
function rowRefs(gridRow: number): RegExp {
  return new RegExp(`^[A-Z]+${gridRow + 1}$`);
}

/** 年度（4 月始まり） */
function fiscalYearOf(iso: string): number {
  const y = Number(iso.slice(0, 4));
  return Number(iso.slice(5, 7)) < 4 ? y - 1 : y;
}

function measurePhoto(plan: Plan, rows: J[], ledgerRows: Record<string, number>, ledgerFile: string): Accuracy & { rows: Map<number, boolean> } {
  const acc: Accuracy & { rows: Map<number, boolean> } = { total: 0, correct: 0, extra: 0, misses: [], rows: new Map() };
  const workOf = new Map(plan.works.map((w) => [w.workKey, w]));
  const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const eqOfNode = (k: string) => {
    const a = byKey.get(k);
    for (const [eq, row] of Object.entries(ledgerRows)) if (a?.sources.some((s) => s.file === ledgerFile && s.cell === `A${row}`)) return eq;
    return null;
  };
  const used = new Set<string>();
  for (const r of rows) {
    acc.total++;
    const re = rowRefs(truthRowOf(r.no));
    const ds = plan.details.filter((d) => d.sources.some((s) => s.file === PHOTO_NAME && s.cell !== null && re.test(s.cell)));
    const why: string[] = [];
    if (!ds.length) why.push("明細が無い");
    else {
      for (const d of ds) used.add(d.detailKey);
      if (ds.some((d) => d.planOrActual !== "actual")) why.push("予定と実績");
      if (ds.some((d) => d.fiscalYear !== fiscalYearOf(r.start))) why.push("年度");
      if (ds.some((d) => d.startDate !== r.start || d.endDate !== r.end)) why.push("日付");
      const md = ds.reduce((a, d) => a + (d.manDays ?? 0), 0);
      if (Math.abs(md - r.man_days) > 1e-6) why.push(`工数 ${md}≠${r.man_days}`);
      const targets = new Set<string>();
      for (const d of ds) for (const k of workOf.get(d.workKey)?.targets ?? []) {
        const eq = eqOfNode(k);
        if (eq) targets.add(eq);
      }
      const want = new Set<string>(r.equipment_ids);
      if (targets.size !== want.size || [...want].some((x) => !targets.has(x))) why.push(`機器 ${[...targets].join(",") || "なし"}≠${[...want].join(",")}`);
    }
    acc.rows.set(r.no, why.length === 0);
    if (why.length) acc.misses.push(`写真の明細 ${r.no}：${why.join("・")}`);
    else acc.correct++;
  }
  // 余分：写真のセルを出どころに持つのに、正解の明細の行に当たらない記録（機器の節・明細）
  const dataRows = rows.map((r) => rowRefs(truthRowOf(r.no)));
  const inTruthRow = (cell: string | null) => cell !== null && dataRows.some((re) => re.test(cell));
  for (const a of plan.assets) if (a.sources.some((s) => s.file === PHOTO_NAME) && !a.sources.some((s) => s.file === PHOTO_NAME && inTruthRow(s.cell))) acc.extra++;
  for (const d of plan.details) if (!used.has(d.detailKey) && d.sources.some((s) => s.file === PHOTO_NAME)) acc.extra++;
  return acc;
}

describe("import の物差し ③：写真（試験が正解から書いた読み取りを置く）", () => {
  test(`${FACILITY} の ${PHOTO_NAME}`, async () => {
    const t = loadTruth(PACK, FACILITY);
    const { photo, rows } = photoTruth();
    const s = new IntakeSession({
      planId: `plan-${FACILITY}-photo`,
      displayName: t.world.facility.name,
      packId: PACK,
      facility: { facilityKey: FACILITY, name: t.world.facility.name, fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
    });
    const rejected = await s.add([...TRIO.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(`${PHOTO_DIR}/${n}`)) })), { name: PHOTO_NAME, bytes: photoBytes() }]);
    expect(rejected).toEqual([]);
    // 読んでいないうちは、計画を作らない
    expect(s.analyze().composition.blockers.join("・")).toContain("読んでいない写真 1");
    // AI の代わりに、試験が正解から書いた読み取りを置く（元の画像の画素。工場の写真は 1,800 × 655）
    const grid = truthReading({ width: 1800, height: 655 });
    expect(s.photos.place(PHOTO_NAME, { width: 1800, height: 655, cells: grid.cells }, new Date().toISOString(), null)).toBe("ok");
    const script = runScript(s, t);
    const before = s.compose();
    const review = before.photoReview;
    expect(before.plan).toBeNull();
    expect(before.blockers).toContain(`要確認 ${review.assets + review.details}`);
    // 人が画像と並べて確かめる（試験の台本が押した）
    expect(s.photos.confirm(PHOTO_NAME, "試験の台本が押した：正解から書いた格子なので、画像の表と合っている", new Date().toISOString())).toBe("ok");
    const script2 = runScript(s, t);
    const comp = s.compose();
    const counts = comp.counts.find((c) => c.file === PHOTO_NAME);
    const lines: string[] = [`== ${PACK}/${FACILITY}（写真）`];
    lines.push(`置いたセル ${grid.cells.length}（試験が正解から書いた。AI は読んでいない）`);
    lines.push(`確かめる前：要確認 ${review.assets + review.details}（機器の節 ${review.assets}・明細 ${review.details}）、計画は作らなかった（${before.blockers.join("・")}）`);
    if (counts)
      lines.push(
        `${PHOTO_NAME}：② ${counts.unresolvedCells}／入れた行 ${counts.inputRows}＝取り込んだ ${counts.importedRows}＋外した ${Object.values(counts.excludedRows).reduce((a, b) => a + b, 0)}＋未解決 ${counts.unresolvedRows}${counts.holds ? "" : " ← 合わない"}`,
      );
    if (!comp.plan) {
      lines.push(`計画：作らなかった（${comp.blockers.join("・")}）`);
      console.log(lines.join("\n"));
      expect(comp.blockers.length).toBeGreaterThan(0);
      return;
    }
    expect(Plan.safeParse(comp.plan).success).toBe(true);
    for (const d of comp.plan.details) expect(d.needsReview).toBe(false);
    const acc = measurePhoto(comp.plan, rows, (t.ledger?.equipment_rows ?? {}) as Record<string, number>, t.ledger?.file ?? "");
    const marked = (photo.marks as J[]).map((m) => m.row_no as number);
    const markedOk = marked.filter((no) => acc.rows.get(no)).length;
    lines.push(`${PHOTO_NAME}：③ ${pct(acc)}%（${acc.correct}/${acc.total}、余分 ${acc.extra}）／手書きの印のある行 ${marked.length ? Math.round((markedOk / marked.length) * 10000) / 100 : 0}%（${markedOk}/${marked.length}）`);
    for (const m of acc.misses.slice(0, 5)) lines.push(`  ✗ ${m}`);
    const fromPhoto = comp.plan.assets.filter((a) => a.sources.some((x) => x.file === PHOTO_NAME));
    lines.push(`写真から作った記録：機器の節 ${fromPhoto.length}（${fromPhoto.slice(0, 6).map((a) => a.name).join("・")}${fromPhoto.length > 6 ? " ほか" : ""}）・明細 ${comp.plan.details.filter((d) => d.sources.some((x) => x.file === PHOTO_NAME)).length}`);
    lines.push(`⑤ 質問 ${script.asked}（確かめたあとに台本が答えた質問 ${script2.answered.length}）`);
    console.log(lines.join("\n"));
    expect(acc.total).toBe(rows.length);
    expect(counts?.holds).toBe(true);
  });
});
