// 見ていない様式の試験の道具の校正（docs/plan.md §2.6）：開発用の工場の正解を、書き方に依らない正解の形（contract.ts）に写して、
// この道具（台本と物差し）が、開発用の資料で開発用の物差し（tests/unit/import/truth.ts）と同じ数を出すことを確かめる。
// 見ていない様式で数が落ちたとき、それが道具の誤りでなく読み手の数だと言えるようにするため。
// 写すのは試験の中だけ（開発用の正解の形を、見ていない様式の書き手には渡さない）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve as resolvePath } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { IntakeSession } from "../../src/import";
import { exportWorld } from "../../scripts/heldout/export-world.mjs";
import {
  Entities,
  ReportRows,
  loadTruth,
  measureDaily,
  measureLedger,
  measureRecovery as devRecovery,
  measureReport,
  measureStar,
  runScript as devScript,
  type Truth,
} from "../unit/import/truth";
import { loadAnswerSet, runAnswerSet } from "./answer";
import { HeldoutTruth, loadSet, type Asset, type Event, type LoadedSet, type Mark } from "./contract";
import { measureAssets, measureEvents, measureMarks, measureRecovery, runSet } from "./harness";

// 工場の資料を計画の厚さにしたので、fictional-1 の校正は、ほかの試験と並べて走らせると 4 分を越えることがある（上限 600 秒）
const PACK = "waste-incineration";
// MOYAI_CALIBRATE_KEEP に道を渡すと、写した正解をそこに残す（道具の誤りを調べるため）
const keep = process.env.MOYAI_CALIBRATE_KEEP;
const tmp = keep ?? mkdtempSync(join(tmpdir(), "moyai-heldout-calibrate-"));
afterAll(() => {
  if (!keep) rmSync(tmp, { recursive: true, force: true });
});

type J = any;
const fyOf = (date: string) => {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};

/** 開発用の正解 → 書き方に依らない正解の形 */
function fromDev(t: Truth, files: string[]): HeldoutTruth {
  const assets: Asset[] = [];
  const marks: Mark[] = [];
  const events: Event[] = [];
  const eq = new Map<string, J>((t.world.equipment as J[]).map((e) => [e.id, e]));
  const L = t.ledger;
  if (L) {
    const rows: J[] = L.rows;
    for (const r of rows) {
      const parentRow = [...rows].reverse().find((x) => x.row < r.row && x.level === r.level - 1);
      let path: string[] | undefined;
      if (r.kind === "group") {
        for (const x of rows.filter((z) => z.row > r.row)) {
          if (x.level <= r.level) break;
          if (x.kind === "equipment") {
            path = (eq.get(x.equipment_id)?.path ?? []).slice(0, r.level);
            break;
          }
        }
      }
      assets.push({
        file: L.file,
        at: { cell: `A${r.row}`, sheet: L.sheet },
        kind: r.kind,
        level: r.level,
        parent: parentRow ? { cell: `A${parentRow.row}`, sheet: L.sheet } : null,
        equipment_id: r.equipment_id ?? null,
        ...(path ? { path } : {}),
        name_text: r.name_text,
        ...(r.kind === "equipment" ? { install_year: eq.get(r.equipment_id)?.install_year } : {}),
        spec_texts: [r.spec_text, r.remark_text].filter((x): x is string => typeof x === "string" && x !== ""),
      });
    }
  }
  const S = t.star;
  if (S) {
    const rowEq = new Map<number, string>((S.rows as J[]).map((r) => [r.row, r.equipment_id]));
    for (const r of S.rows as J[]) {
      assets.push({ file: S.file, at: { cell: `${S.columns.equipment}${r.row}`, sheet: S.sheet }, kind: "equipment", level: null, parent: "exists", equipment_id: r.equipment_id, name_text: S.equipment_names[r.equipment_id], name: S.equipment_names[r.equipment_id] });
      ((S.columns.levels ?? []) as string[]).forEach((col, li) => {
        const e = eq.get(r.equipment_id);
        if (e) assets.push({ file: S.file, at: { cell: `${col}${r.row}`, sheet: S.sheet }, kind: "group", level: null, equipment_id: null, path: e.path.slice(0, li + 1), name_text: e.path[li] ?? "?", measure: false });
      });
    }
    const yearOf = new Map<string, { fy: number; kind: "actual" | "planned" }>();
    for (const y of S.year_columns as J[]) {
      yearOf.set(y.actual_col, { fy: y.fiscal_year, kind: "actual" });
      yearOf.set(y.planned_col, { fy: y.fiscal_year, kind: "planned" });
    }
    for (const [ref, c] of Object.entries(S.cells as Record<string, J>)) {
      const y = yearOf.get(/^[A-Z]+/.exec(ref)![0])!;
      marks.push({ file: S.file, at: { cell: ref, sheet: S.sheet }, fiscal_year: y.fy, status: c.kind === "planned" ? "planned" : "actual", equipment_id: rowEq.get(Number(/\d+$/.exec(ref)![0]))!, work_ids: c.work_ids, symbol: c.symbol });
    }
  }
  const D = t.daily;
  const fyOfWork = new Map<string, number>((t.world.works as J[]).map((w) => [w.id, w.fiscal_year]));
  if (D)
    for (const r of D.rows as J[])
      events.push({ file: D.file, at: { row: r.line }, status: "actual", fiscal_year: fyOfWork.get(r.work_ids[0]) ?? fyOf(r.date), equipment_ids: r.equipment_ids, work_ids: r.work_ids, start: r.date, end: r.date, man_days: r.man_days, days: null, bundle: !!r.bundle });
  for (const rep of (t.reports?.reports ?? []) as J[]) {
    if (!files.includes(rep.file_pdf)) continue;
    for (const x of rep.rows as J[])
      events.push({ file: rep.file_pdf, at: { texts: [String(x.no), x.equipment_text] }, status: "actual", fiscal_year: rep.fiscal_year, equipment_ids: x.equipment_ids, work_ids: x.work_ids, start: x.start, end: x.end, man_days: x.man_days, days: x.duration_days, bundle: !!x.bundle });
  }
  const kindOf = (f: string) => (f === L?.file ? "ledger" : f === S?.file ? "star" : f === D?.file ? "daily" : "report");
  const fmt = (f: string) => (f.endsWith(".xlsx") ? "xlsx" : f.endsWith(".csv") ? "csv" : "pdf");
  const srcXlsx = (f: string) => ((t.reports?.reports ?? []) as J[]).find((r) => r.file_pdf === f)?.file_xlsx ?? null;
  return HeldoutTruth.parse({
    schema: "moyai.heldout.truth/0",
    set: `calibrate-${t.facility}`,
    world: "world.json",
    files: files.map((f) => ({ file: f, format: fmt(f), kind: kindOf(f), ...(fmt(f) === "pdf" ? { source_xlsx: srcXlsx(f) } : {}), ...(f === D?.file ? { encoding: D.encoding, delimiter: "," } : {}) })),
    assets,
    marks,
    events,
  });
}

/**
 * 開発用の正解 → 指示書 §5 の形（answer/files・answer/world.json。補いは samples/heldout/ANSWER.md）。
 * 行で書く（Excel・CSV は行、PDF は文書の中の順）。この形を answer.ts が写したものが、上の形と同じ数を出すことを確かめる
 */
function fromDevAnswer(t: Truth, files: string[], setDir: string, filesDir: string): { world: J; answers: J[] } {
  const eq = new Map<string, J>((t.world.equipment as J[]).map((e) => [e.id, e]));
  const eqRows = new Map<string, J[]>();
  const workRows = new Map<string, J[]>();
  const addEq = (id: string, loc: J) => eqRows.set(id, [...(eqRows.get(id) ?? []), loc]);
  const addWork = (id: string, loc: J) => workRows.set(id, [...(workRows.get(id) ?? []), loc]);
  const names: Record<string, Record<string, string>> = {};
  const answers: J[] = [];
  const L = t.ledger;
  if (L) {
    const records: J[] = [];
    const stack: string[] = [];
    const rows: J[] = L.rows;
    rows.forEach((r, i) => {
      stack.length = r.level - 1;
      stack.push(r.name_text);
      const next = rows[i + 1];
      const kind = r.kind === "group" || (next && next.level > r.level) ? "parent" : "item";
      const specs = [r.spec_text, r.remark_text].filter((x): x is string => typeof x === "string" && x !== "");
      records.push({ sheet: L.sheet, r: r.row, kind, fields: { path: [...stack], ...(r.kind === "equipment" ? { install_year: eq.get(r.equipment_id)?.install_year } : {}), specs } });
      if (r.kind === "equipment") addEq(r.equipment_id, { file: L.file, sheet: L.sheet, r: r.row });
    });
    answers.push({ schema: "moyai.answer.file/0", file: L.file, plan: false, records });
  }
  const S = t.star;
  if (S) {
    const yearOf = new Map<string, number>();
    for (const y of S.year_columns as J[]) {
      yearOf.set(y.actual_col, y.fiscal_year);
      yearOf.set(y.planned_col, y.fiscal_year);
    }
    const colNo = (ref: string) => /^[A-Z]+/.exec(ref)![0].split("").reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
    const rowNo = (ref: string) => Number(/\d+$/.exec(ref)![0]);
    const byRow = new Map<number, [string, J][]>();
    for (const [ref, c] of Object.entries(S.cells as Record<string, J>)) byRow.set(rowNo(ref), [...(byRow.get(rowNo(ref)) ?? []), [ref, c]]);
    const records: J[] = [];
    for (const r of S.rows as J[]) {
      const e = eq.get(r.equipment_id);
      const levels = ((S.columns.levels ?? []) as string[]).map((_, li) => e?.path[li] ?? "?");
      const marks: Record<string, string[]> = {};
      for (const [ref, c] of (byRow.get(r.row) ?? []).sort((a, b) => colNo(a[0]) - colNo(b[0]))) {
        const fy = yearOf.get(/^[A-Z]+/.exec(ref)![0])!;
        (marks[String(fy)] ??= []).push(c.symbol);
        for (const w of c.work_ids as string[]) addWork(w, { file: S.file, sheet: S.sheet, r: r.row, year: fy, symbol: c.symbol });
      }
      records.push({ sheet: S.sheet, r: r.row, kind: "item", fields: { path: [...levels, S.equipment_names[r.equipment_id]], marks } });
      addEq(r.equipment_id, { file: S.file, sheet: S.sheet, r: r.row });
      (names[r.equipment_id] ??= {})[S.file] = S.equipment_names[r.equipment_id];
    }
    answers.push({ schema: "moyai.answer.file/0", file: S.file, plan: true, records });
  }
  const D = t.daily;
  if (D) {
    const records: J[] = [];
    for (const r of D.rows as J[]) {
      records.push({ r: r.line, kind: "item", fields: { date: r.date, manDays: r.man_days, manDaysText: r.effort_text } });
      for (const w of r.work_ids as string[]) addWork(w, { file: D.file, r: r.line });
    }
    answers.push({ schema: "moyai.answer.file/0", file: D.file, plan: false, records });
  }
  for (const rep of (t.reports?.reports ?? []) as J[]) {
    if (!files.includes(rep.file_pdf)) continue;
    const records: J[] = [];
    (rep.rows as J[]).forEach((x, seq) => {
      records.push({ seq, kind: "item", fields: { no: x.no, equipment: x.equipment_text, start: x.start, end: x.end, days: x.duration_days, manDays: x.man_days } });
      for (const w of x.work_ids as string[]) addWork(w, { file: rep.file_pdf, seq });
    });
    answers.push({ schema: "moyai.answer.file/0", file: rep.file_pdf, plan: false, source_xlsx: relative(setDir, resolvePath(filesDir, rep.file_xlsx)).split("\\").join("/"), records });
  }
  const precision = new Set<string>(t.crossdoc?.precision_work_ids ?? []);
  const world = {
    schema: "moyai.answer.world/0",
    facility: { id: t.facility, name: t.world.facility.name, industry: PACK },
    fiscal_year_start_month: 4,
    man_day_hours: t.world.man_day_hours,
    today: t.world.today,
    equipment: (t.world.equipment as J[]).map((e) => ({ id: e.id, name: e.name, ...(names[e.id] ? { names: names[e.id] } : {}), furnace: e.furnace ?? null, install_year: e.install_year ?? null, code: e.tag ?? null, path: e.path, rows: eqRows.get(e.id) ?? [] })),
    // 予定のうち書き漏れの作業（planned_unrecorded）も、星取表の印は持つので予定の作業として書く（印の行を世界の作業に結ぶため）
    works: (t.world.works as J[]).filter((w) => w.status === "actual" || w.status === "planned" || w.status === "planned_unrecorded").map((w) => ({ id: w.id, label: w.label, attribute: w.attr, status: w.status === "actual" ? "actual" : "planned", fiscal_year: w.fiscal_year, equipment: [w.equipment_id], start: w.start, end: w.end, man_days: w.man_days, days: w.duration_days, precision: precision.has(w.id), rows: workRows.get(w.id) ?? [] })),
    unrecorded: [],
  };
  return { world, answers };
}

function reportFiles(t: Truth): string[] {
  return ((t.reports?.reports ?? []) as J[]).map((r) => r.file_pdf);
}

const CASES = [
  { facility: "fictional-1", files: (t: Truth) => ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv", ...reportFiles(t)] },
  { facility: "fictional-2", files: () => ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"] },
];

/** この道具（台本と物差し）を、写した正解で走らせ、開発用の台本と物差しと同じ数を出すことを確かめる */
async function calibrate(c: (typeof CASES)[number], t: Truth, files: string[], set: LoadedSet, label: string) {
      const facts = Object.fromEntries(Object.entries(t.facts));
      const g = await runSet(set, { read: files, facts, facilityKey: c.facility });

      // 開発用の台本と同じ聞き方・答え方になる
      const s = new IntakeSession({
        planId: `plan-${c.facility}`,
        displayName: t.world.facility.name,
        packId: PACK,
        facility: { facilityKey: c.facility, name: t.world.facility.name, fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
      });
      await s.add(files.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(`samples/out/${PACK}/${c.facility}/${n}`)) })));
      const ds = devScript(s, t);
      const dc = s.compose();
      expect(g.result.asked, "質問の数").toBe(ds.asked);
      expect(g.result.answered, "台本が答えた数").toBe(ds.answered.length);
      expect(g.result.unresolvedAfter, "未解決").toBe([...dc.status.values()].filter((x) => x.s === "unresolved").length);
      expect(g.result.plan, "計画の大きさ").toEqual(dc.plan ? { assets: dc.plan.assets.length, works: dc.plan.works.length, details: dc.plan.details.length } : null);
      expect(g.result.unplaced, "正解の場所が格子に引き当たらない").toEqual([]);

      // 同じ計画に、開発用の物差しと、この道具の物差しを当てて、資料ごとの数が同じ
      const plan = g.plan!;
      const an = g.analysis;
      const ents = new Entities(t);
      const reps = t.reports ? new ReportRows(t, an.sources) : null;
      const devAcc: Record<string, { correct: number; total: number }> = {};
      const add = (f: string, a: { correct: number; total: number }) => (devAcc[f] = { correct: a.correct, total: a.total });
      if (t.ledger) add(t.ledger.file, measureLedger(plan, t, ents));
      if (t.star) add(t.star.file, measureStar(plan, t));
      if (t.daily) add(t.daily.file, measureDaily(plan, t, ents));
      for (const f of reps?.files.filter((x) => files.includes(x)) ?? []) add(f, measureReport(plan, t, reps!, f, an.sources));
      const mine = Object.fromEntries(g.result.files.map((f) => [f.file, f.accuracy ? { correct: f.accuracy.correct, total: f.accuracy.total } : null]));
      for (const [f, a] of Object.entries(devAcc)) expect(mine[f], f).toEqual(a);
      // ① も同じ
      for (const f of g.result.files) if (f.format !== "pdf") expect(f.leak, `${f.file} の ①`).toBe(0);
      // ⑥ も同じ
      const dr = devRecovery(plan, t, new Set(files), reps, an.sources);
      expect({ d: g.result.recovery.denominator, t: g.result.recovery.together, md: g.result.recovery.manDays, dy: g.result.recovery.days }).toEqual({ d: dr.denominator, t: dr.together, md: dr.manDays, dy: dr.days });
      // 物差しが空回りしていないか：計画をわざと壊し、両方の物差しが落とす数を比べる。
      // この道具の行（日報・報告書）の物差しは、開発用の日報と報告書の物差しの見るものを合わせて持つ（年度・予定と実績・まとめ工事の期間も見る）。
      // だから、台帳と星取表は同じ数、日報と報告書はこの道具の方が多いか同じだけ落とす。⑥ は同じ数。
      // 壊し方 A：工数・日付・出どころ・名前・親・設置年。壊し方 B：年度・予定と実績
      const breakA = (p: typeof plan) => {
        const b = structuredClone(p);
        b.details.forEach((d, i) => {
          if (i % 11 === 0) d.manDays = (d.manDays ?? 0) + 1;
          if (i % 17 === 0 && d.startDate) d.startDate = "1999-01-01";
          if (i % 23 === 0 && d.endDate) d.endDate = "2000-01-01";
          if (i % 29 === 0) d.sources = [];
        });
        b.assets.forEach((a, i) => {
          if (i % 5 === 0) a.name = `${a.name}x`;
          if (i % 9 === 0) a.parentKey = null;
          if (i % 13 === 0) a.installedOn = "1900";
        });
        return b;
      };
      const breakB = (p: typeof plan) => {
        const b = structuredClone(p);
        b.details.forEach((d, i) => {
          if (i % 7 === 0) d.fiscalYear += 1;
          if (i % 31 === 0) d.planOrActual = d.planOrActual === "plan" ? "actual" : "plan";
        });
        return b;
      };
      const both = (broken: typeof plan) => {
        const dev: Record<string, { correct: number; total: number }> = {};
        if (t.ledger) dev[t.ledger.file] = measureLedger(broken, t, ents);
        if (t.star) dev[t.star.file] = measureStar(broken, t);
        if (t.daily) dev[t.daily.file] = measureDaily(broken, t, ents);
        for (const f of reps?.files.filter((x) => files.includes(x)) ?? []) dev[f] = measureReport(broken, t, reps!, f, an.sources);
        const parts = [measureAssets(broken, g.index), measureMarks(broken, g.index), measureEvents(broken, g.index)];
        const mine = (f: string) => parts.map((x) => x[f]).filter((x) => !!x).reduce((x, y) => ({ correct: x.correct + y!.correct, total: x.total + y!.total }), { correct: 0, total: 0 });
        return Object.entries(dev).map(([f, a]) => ({ f, dev: { correct: a.correct, total: a.total }, mine: mine(f) }));
      };
      const exact = new Set([t.ledger?.file, t.star?.file]);
      const fellBy: Record<string, number> = {};
      for (const [name, broken] of [["A", breakA(plan)], ["B", breakB(plan)]] as const) {
        let fell = 0;
        for (const x of both(broken)) {
          if (exact.has(x.f)) expect(x.mine, `壊し方 ${name} の ${x.f}`).toEqual(x.dev);
          else {
            expect(x.mine.total, `壊し方 ${name} の ${x.f} の分母`).toBe(x.dev.total);
            expect(x.mine.correct, `壊し方 ${name} の ${x.f}（この道具は見るものが多い）`).toBeLessThanOrEqual(x.dev.correct);
          }
          fell += x.mine.total - x.mine.correct;
        }
        expect(fell, `壊し方 ${name} で落ちた数`).toBeGreaterThan(0);
        fellBy[name] = fell;
        const rd = devRecovery(broken, t, new Set(files), reps, an.sources);
        const rg = measureRecovery(broken, g.index, new Set(files));
        expect({ t: rg.together, md: rg.manDays, dy: rg.days }, `壊し方 ${name} の ⑥`).toEqual({ t: rd.together, md: rd.manDays, dy: rd.days });
      }

      console.log(`校正 ${label} ${c.facility}：${g.result.files.map((f) => `${f.file} ${f.accuracy?.correct}/${f.accuracy?.total}`).join("、")}・⑥ ${g.result.recovery.together}/${g.result.recovery.denominator}・壊し方 A で落ちた ${fellBy.A}・B で落ちた ${fellBy.B}`);
}

describe("見ていない様式の道具の校正：開発用の資料で、開発用の物差しと同じ数", () => {
  for (const c of CASES) {
    test(c.facility, async () => {
      const t = loadTruth(PACK, c.facility);
      const files = c.files(t);
      const dir = join(tmp, c.facility);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "world.json"), JSON.stringify(exportWorld(t.world, t.crossdoc?.precision_work_ids ?? [])));
      writeFileSync(join(dir, "truth.json"), JSON.stringify(fromDev(t, files)));
      // 資料は samples/out にあるものをそのまま読む（写さない）
      const set = loadSet(dir, { filesDir: `samples/out/${PACK}/${c.facility}` });
      await calibrate(c, t, files, set, "場所の形");
    }, 600_000); // CI では、ほかの重い試験と並ぶと 383 秒かかった（11-05、ubuntu-latest）。上限は測った値に合わせる

    // 指示書 §5 の形（行で書いた正解）を answer.ts で写しても、同じ数になる
    test(`${c.facility}（§5 の形）`, async () => {
      const t = loadTruth(PACK, c.facility);
      const files = c.files(t);
      const setDir = join(tmp, `answer-${c.facility}`);
      const filesDir = `samples/out/${PACK}/${c.facility}`;
      const { world, answers } = fromDevAnswer(t, files, setDir, filesDir);
      mkdirSync(join(setDir, c.facility, "answer", "files"), { recursive: true });
      writeFileSync(join(setDir, c.facility, "answer", "world.json"), JSON.stringify(world));
      for (const a of answers) writeFileSync(join(setDir, c.facility, "answer", "files", `${String(a.file).replace(/\.[^.]+$/, "").split("/").join("__")}.json`), JSON.stringify(a));
      const { facilities } = loadAnswerSet(setDir, { filesDir: () => filesDir });
      expect(facilities.map((f) => f.key)).toEqual([c.facility]);
      expect(facilities[0]!.unmapped, "写せない正解").toEqual([]);
      await calibrate(c, t, files, facilities[0]!.set, "§5 の形");
    }, 600_000);
  }

  // 1 組に施設がいくつもある形（指示書 §2.2）：施設ごとに走らせて、資料の名前の頭に施設のフォルダを付けてまとめる
  test("§5 の形：施設をまたいだ組は、施設ごとの数の和", async () => {
    const t = loadTruth(PACK, "fictional-2");
    const files = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"];
    const setDir = join(tmp, "answer-two");
    const filesDir = `samples/out/${PACK}/fictional-2`;
    const { world, answers } = fromDevAnswer(t, files, setDir, filesDir);
    for (const k of ["fac-a", "fac-b"]) {
      mkdirSync(join(setDir, k, "answer", "files"), { recursive: true });
      writeFileSync(join(setDir, k, "answer", "world.json"), JSON.stringify({ ...world, facility: { ...world.facility, id: k } }));
      for (const a of answers) writeFileSync(join(setDir, k, "answer", "files", `${String(a.file).replace(/\.[^.]+$/, "")}.json`), JSON.stringify(a));
    }
    const { result, facilities } = await runAnswerSet(setDir, () => ({}), { read: files }, { filesDir: () => filesDir });
    expect(facilities.map((f) => f.key)).toEqual(["fac-a", "fac-b"]);
    expect(result.files.map((f) => f.file)).toEqual(["fac-a/equipment-ledger.xlsx", "fac-a/plan-hoshitori.xlsx", "fac-b/equipment-ledger.xlsx", "fac-b/plan-hoshitori.xlsx"]);
    expect(result.asked).toBe(facilities[0]!.result.asked + facilities[1]!.result.asked);
    expect(result.recovery.denominator).toBe(facilities[0]!.result.recovery.denominator * 2);
  }, 600_000);
});
