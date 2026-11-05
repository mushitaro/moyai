// 作り手の工場 v2 の正解（moyai.sample-world/0 の answer/world.json と answer/files/*.json）を、書き方に依らない正解の形（contract.ts）に写す。
// デモの 3 施設（demo.test.ts）の施設 C（星取表も台帳も無い、作業日報と発注台帳だけの施設）を、heldout と同じ物差しで測るため。
// 正解の answer/ を読むのは測る人（この道具）だけ。読み手には渡さない。
// 写す決まり：
// - 作業そのものを書いた行（links の how が無いもの・group・contract）を出来事の正解にする。how が annual・bundle・rollup・upgrade の結びは、
//   年間の委託・まとめた工事などの契約の行で、作業そのものの行ではない（world.json の counts.note）ので、出来事にしない。
// - 同じ行に結んだ作業は 1 つの出来事（作業と機器はその和）。工数はファイルの正解の記録の manDays、日数は days（書いていなければ null）。
// - 作業の状態は、planned・postponed を予定、ほかを実績にする。
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { HeldoutTruth, type Event, type HeldoutWorld, type LoadedSet } from "./contract";

type J = any;

const CONTRACT_ONLY = new Set(["annual", "bundle", "rollup", "upgrade"]);
const PLANNED = new Set(["planned", "postponed"]);

export function loadV2Facility(dir: string, set = basename(dir)): { set: LoadedSet; dropped: Record<string, number> } {
  const w: J = JSON.parse(readFileSync(join(dir, "answer", "world.json"), "utf8"));
  if (w.schema !== "moyai.sample-world/0") throw new Error(`${dir}/answer/world.json は v2 の世界の正解でない（${w.schema}）`);
  const works = new Map<string, J>((w.works as J[]).map((x) => [x.id, x]));
  // ファイルの正解の記録（行の工数・日数）
  const recOf = new Map<string, J>();
  for (const n of readdirSync(join(dir, "answer", "files"))) {
    const a: J = JSON.parse(readFileSync(join(dir, "answer", "files", n), "utf8"));
    const file = (w.files as J[]).find((f) => f.file.replace(/\.[^.]+$/, "") === n.replace(/\.json$/, ""))?.file ?? a.file;
    for (const r of a.records as J[]) recOf.set(`${file}\u0000${r.sheet ?? ""}\u0000${r.r}`, r);
  }
  const dropped: Record<string, number> = {};
  const rows = new Map<string, { file: string; sheet: string | null; r: number; works: J[]; day: string | null }>();
  for (const l of w.links as J[]) {
    if (l.how && CONTRACT_ONLY.has(l.how)) {
      dropped[`契約の行の結び（${l.how}）`] = (dropped[`契約の行の結び（${l.how}）`] ?? 0) + 1;
      continue;
    }
    const x = works.get(l.work);
    if (!x) {
      dropped["世界に無い作業"] = (dropped["世界に無い作業"] ?? 0) + 1;
      continue;
    }
    const k = `${l.file}\u0000${l.sheet ?? ""}\u0000${l.r}`;
    const row = rows.get(k) ?? { file: l.file, sheet: l.sheet ?? null, r: l.r, works: [] as J[], day: l.day ?? null };
    row.works.push(x);
    rows.set(k, row);
  }
  const events: Event[] = [];
  for (const [k, row] of rows) {
    const rec = recOf.get(k);
    const ws = row.works;
    const starts = ws.map((x) => x.start).filter(Boolean).sort();
    const ends = ws.map((x) => x.end).filter(Boolean).sort();
    const start = row.day ?? starts[0];
    const end = row.day ?? ends[ends.length - 1] ?? start;
    if (!start || !end) {
      dropped["日付の無い行"] = (dropped["日付の無い行"] ?? 0) + 1;
      continue;
    }
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    events.push({
      file: row.file,
      at: { row: row.r, ...(row.sheet ? { sheet: row.sheet } : {}) },
      status: ws.every((x) => PLANNED.has(x.status)) ? "planned" : "actual",
      fiscal_year: ws[0].fy,
      equipment_ids: [...new Set(ws.map((x) => x.asset as string))],
      work_ids: ws.map((x) => x.id as string),
      start,
      end,
      man_days: num(rec?.fields?.manDays),
      days: num(rec?.fields?.days),
      bundle: new Set(ws.map((x) => x.asset)).size > 1,
    });
  }
  const fmt = (f: string) => (/\.xlsx$/i.test(f) ? "xlsx" : /\.csv$/i.test(f) ? "csv" : /\.pdf$/i.test(f) ? "pdf" : "jpg");
  const truth = HeldoutTruth.parse({
    schema: "moyai.heldout.truth/0",
    set,
    world: "answer/world.json",
    files: (w.files as J[]).map((f) => ({ file: f.file, format: fmt(f.file), kind: /日報/.test(f.file) ? "daily" : "report" })),
    assets: [],
    marks: [],
    events,
  });
  const world: HeldoutWorld = {
    schema: "moyai.heldout.world/0",
    facility: { id: w.facility.id, name: w.facility.name, furnace_type: w.profile?.furnace ?? "", furnaces: [] },
    fiscal_years: [...new Set((w.works as J[]).map((x) => x.fy as number))].sort((a, b) => a - b),
    today: w.maker?.today ?? "",
    man_day_hours: 8,
    equipment: (w.assets as J[]).map((a) => ({
      id: a.id,
      name: a.name,
      base_name: a.name,
      tag: a.tag ?? "",
      system: a.system ?? "",
      path: [a.system ?? "", a.name].filter(Boolean),
      parts: [],
      furnace: a.furnace ?? null,
      furnace_label: a.furnace ? `${a.furnace}` : "",
      install_year: a.installed ?? 0,
      spec: [],
    })),
    works: (w.works as J[]).map((x) => ({
      id: x.id,
      equipment_id: x.asset,
      fiscal_year: x.fy,
      status: PLANNED.has(x.status) ? "planned" : "actual",
      label: x.task,
      attr: x.attr ?? "",
      start: x.start ?? null,
      end: x.end ?? null,
      man_days: x.manDays ?? null,
      duration_days: x.days ?? null,
      precision: /精密機能検査/.test(x.task ?? ""),
    })),
  };
  return { set: { dir, filesDir: join(dir, "files"), truth, world }, dropped };
}
