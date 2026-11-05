// 開発用の工場の正解（tests/unit/import/truth.ts）を、書き方に依らない正解の形（contract.ts）に写す。校正（calibrate.test.ts）とデモの 3 施設（demo.test.ts）が使う。
import type { Truth } from "../unit/import/truth";
import { HeldoutTruth, type Asset, type Event, type Mark } from "./contract";

export const PACK = "waste-incineration";

// 開発用の正解は型の無い JSON
export type J = any;
export const fyOf = (date: string) => {
  const [y, m] = date.split("-").map(Number) as [number, number];
  return m >= 4 ? y : y - 1;
};

/** 開発用の正解 → 書き方に依らない正解の形 */
export function fromDev(t: Truth, files: string[]): HeldoutTruth {
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

export function reportFiles(t: Truth): string[] {
  return ((t.reports?.reports ?? []) as J[]).map((r) => r.file_pdf);
}

export const CASES = [
  { facility: "fictional-1", files: (t: Truth) => ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv", ...reportFiles(t)] },
  { facility: "fictional-2", files: () => ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"] },
];
