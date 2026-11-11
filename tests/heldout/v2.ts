// 作り手の工場 v2 の正解（moyai.sample-world/0 の answer/world.json と answer/files/*.json）を、書き方に依らない正解の形（contract.ts）に写す。
// デモの 3 施設（demo.test.ts）の施設 C（星取表も台帳も無い、作業日報と発注台帳だけの施設）を、heldout と同じ物差しで測るため。
// 正解の answer/ を読むのは測る人（この道具）だけ。読み手には渡さない。
// 写す決まり（出来事）：
// - 作業そのものを書いた行（links の how が無いもの・group・contract）を出来事の正解にする。how が annual・bundle・rollup・upgrade の結びは、
//   年間の委託・まとめた工事などの契約の行で、作業そのものの行ではない（world.json の counts.note）ので、出来事にしない。
// - 同じ行に結んだ作業は 1 つの出来事（作業と機器はその和）。工数はファイルの正解の記録の manDays、日数は days（書いていなければ null）。
// - 作業の状態は、planned・postponed を予定、ほかを実績にする。
// 写す決まり（星取表。plan が true の資料。mushitaro/moyai#14）：
// - 印：記録の marks（予定と実績を 2 列に分けた表は、実績が marks・予定が plans）の 1 つ 1 つ。場所は、その行の、その記号のセル（列の順の何番目か）。
//   作業は、世界の結び（links の file・sheet・r・year）。予定か実績かは「書いてあるもの」で決める：plans の列は予定。marks の列は世界の作業の状態。
//   ただし、書き漏れ（errata の omitMark・lastYearUnreflected。実績を書かずに予定の印のまま）と記録されたセルは予定。記号の意味を道具が推し量ることはしない。
// - 機器：行の印が結ぶ作業の機器が、ただ 1 つに決まる行だけ。その機器の、シートの中の最初の行の、名前のセル（道の最後の名前）。
//   何台もの機器をまとめた行の印は、正解に置くが ③ には数えない（measure: false。数は dropped に書く。台本の答え・読みすぎの数え・⑥ には使う）。
//   世界の作業に結んでいない行は、機器にも印にもしない（数は dropped に書く）。
// - 名前のセルは、その道（まとまり・機器の名前の並び）の最初の行にある（続く行は名前を空けるか「〃」）。親の記録（kind が parent）が作業の行を兼ねることがある。
// - まとまり：自分の行を持つ親の記録のうち、機器の名前の行でないものの、名前のセル。
// - 名前：正解の道の名前は、番号や記号の飾り（「１．」「■」「・」）を除いたもの。セルに書いた字そのものの名前も正しいとする（name_cleaned）。
//   号機だけを書いた行（「1号炉」「#1」）の機器は、その資料の 1 つ上の名前（機器の名前）で呼んでも正しい。
// - 星取表の段と親は、親があることだけを見る（answer.ts と同じ。段は名前の列の位置で読むため資料ごとに違う）。
// - 写さないもの：機器台帳の行（1 行が何台もの機器を表す。正解の形の Asset は 1 行 1 機器）。機器を結ぶ問いは、正解が両方の機器を知っているときだけ台本が答える（harness.ts）。
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { HeldoutTruth, type Asset, type Event, type HeldoutWorld, type LoadedSet, type Mark } from "./contract";

type J = any;

const CONTRACT_ONLY = new Set(["annual", "bundle", "rollup", "upgrade"]);
const PLANNED = new Set(["planned", "postponed"]);
/** 実績を書かずに、予定の印のまま残したセル（正解の errata に 1 件ずつ記録してある） */
const LEFT_AS_PLAN = new Set(["omitMark", "lastYearUnreflected"]);
const DROP = {
  multi: "星取表：何台もの機器をまとめた行の印",
  unlinkedRow: "星取表：世界の作業に結んでいない行の印",
  unlinkedMark: "星取表：世界の作業に結んでいない印",
  notSymbol: "星取表：記号でない文字の印（年度をまたいで結合したセルなど）",
} as const;

export function loadV2Facility(dir: string, set = basename(dir)): { set: LoadedSet; dropped: Record<string, number> } {
  const w: J = JSON.parse(readFileSync(join(dir, "answer", "world.json"), "utf8"));
  if (w.schema !== "moyai.sample-world/0") throw new Error(`${dir}/answer/world.json は v2 の世界の正解でない（${w.schema}）`);
  const works = new Map<string, J>((w.works as J[]).map((x) => [x.id, x]));
  // ファイルの正解の記録（行の工数・日数）
  const recOf = new Map<string, J>();
  const answers: { file: string; plan: boolean; records: J[] }[] = [];
  for (const n of readdirSync(join(dir, "answer", "files")).sort()) {
    const a: J = JSON.parse(readFileSync(join(dir, "answer", "files", n), "utf8"));
    const file = (w.files as J[]).find((f) => f.file.replace(/\.[^.]+$/, "") === n.replace(/\.json$/, ""))?.file ?? a.file;
    answers.push({ file, plan: a.plan === true, records: a.records as J[] });
    for (const r of a.records as J[]) recOf.set(`${file}\u0000${r.sheet ?? ""}\u0000${r.r}`, r);
  }
  const dropped: Record<string, number> = {};
  const rows = new Map<string, { file: string; sheet: string | null; r: number; works: J[]; day: string | null }>();
  const starFiles = new Set(answers.filter((a) => a.plan).map((a) => a.file));
  for (const l of w.links as J[]) {
    // 星取表の結び（年度つき）は印として写す（下）。出来事（日付のある行）にしない
    if (starFiles.has(l.file)) continue;
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
  // ─── 星取表：印・機器・まとまり ───
  const assets: Asset[] = [];
  const marks: Mark[] = [];
  const drop = (k: string, n = 1) => {
    if (n > 0) dropped[k] = (dropped[k] ?? 0) + n;
  };
  const at3 = (file: string, sheet: unknown, r: unknown) => `${file}\u0000${sheet ?? ""}\u0000${r}`;
  // 星取表の行 → 年度 → 世界の作業
  const starLinks = new Map<string, Map<number, J[]>>();
  for (const l of w.links as J[]) {
    if (!starFiles.has(l.file) || typeof l.year !== "number") continue;
    const x = works.get(l.work);
    if (!x) continue;
    const k = at3(l.file, l.sheet, l.r);
    const byYear = starLinks.get(k) ?? new Map<number, J[]>();
    byYear.set(l.year, [...(byYear.get(l.year) ?? []), x]);
    starLinks.set(k, byYear);
  }
  // 号機だけを書いた行（道の最後が「1号炉」「#1」などで、同じ種類のほかの号機が、最後の名前だけが違う道に並ぶ）の機器の呼び名：
  // その資料の、1 つ上の名前（「ボイラー給水ポンプ › 1号炉」なら「ボイラー給水ポンプ」）。号機の行の節を機器の名前で呼ぶ読みも正しい
  const SEP = " › ";
  const pathsByClass = new Map<string, Map<string, string>>();
  for (const x of w.assets as J[]) {
    for (const [file, p] of Object.entries((x.names ?? {}) as Record<string, string>)) {
      const k = `${file}\u0000${x.class}\u0000${x.part ?? ""}`;
      pathsByClass.set(k, (pathsByClass.get(k) ?? new Map<string, string>()).set(x.id as string, p));
    }
  }
  const assetById = new Map<string, J>((w.assets as J[]).map((x) => [x.id as string, x]));
  const unitRowName = (eq: string, file: string, path: string[]): string | null => {
    const x = assetById.get(eq);
    if (!x || path.length < 2) return null;
    const head = path.slice(0, -1).join(SEP) + SEP;
    const sibs = pathsByClass.get(`${file}\u0000${x.class}\u0000${x.part ?? ""}`) ?? new Map<string, string>();
    for (const [id, p] of sibs) if (id !== eq && p.startsWith(head) && !p.slice(head.length).includes(SEP) && p !== path.join(SEP)) return path[path.length - 2]!;
    return null;
  };
  const leftAsPlan = new Set<string>((w.errata as J[] | undefined ?? []).filter((e) => LEFT_AS_PLAN.has(e.type)).map((e) => `${at3(e.file, e.sheet, e.r)}\u0000${e.year}`));
  for (const a of answers) {
    if (!a.plan) continue;
    const eqSeen = new Set<string>();
    // 道（まとまり・機器の名前の並び）ごとの、最初の行：名前のセルは、その道の最初の行にある（続く行は名前を空けるか「〃」）
    const firstRow = new Map<string, number>();
    // まとまりの候補（行 → もの）。その行が機器の名前の行だと分かったら、機器が優先
    const groups = new Map<number, Asset>();
    const equipment: Asset[] = [];
    for (const rec of a.records) {
      if (rec.kind !== "parent" && rec.kind !== "item") continue;
      const path = Array.isArray(rec.fields?.path) ? (rec.fields.path as unknown[]).map(String) : [];
      const name = path[path.length - 1];
      if (!name || typeof rec.r !== "number") continue;
      const sheet: string | null = rec.sheet ?? null;
      const pathKey = `${sheet ?? ""}\u0000${path.join("\u0001")}`;
      if (!firstRow.has(pathKey)) firstRow.set(pathKey, rec.r);
      // 行の印（列の順＝年度の順。同じ年度に予定と実績の 2 つの印がある表は、記号が違う）
      const entries = (["plans", "marks"] as const)
        .flatMap((col) =>
          Object.entries((rec.fields?.[col] ?? {}) as Record<string, unknown>).flatMap(([y, v]) => (Array.isArray(v) ? v : [v]).map((x) => ({ y: Number(y), s: String(x), col }))),
        )
        .filter((m) => Number.isInteger(m.y) && m.s !== "")
        .sort((p, q) => p.y - q.y);
      const byYear = starLinks.get(at3(a.file, rec.sheet, rec.r)) ?? new Map<number, J[]>();
      const eqs = new Set([...byYear.values()].flat().map((x) => x.asset as string));
      if (eqs.size !== 1) {
        // 自分の行を持つ親の記録は、まとまり（作業の行を兼ねる親で、機器が 1 つに決まらないものも）
        if (rec.kind === "parent" && firstRow.get(pathKey) === rec.r) groups.set(rec.r, { file: a.file, at: { row: rec.r, sheet, text: name }, kind: "group", level: null, equipment_id: null, path, name_text: name, name_cleaned: true });
        if (eqs.size === 0) {
          drop(DROP.unlinkedRow, entries.length);
          continue;
        }
      }
      // 何台もの機器をまとめた行：印は正解に置くが、③ には数えない（対象の機器が 1 つに決まらない。機器も置かない）
      const multi = eqs.size > 1;
      const eq = [...eqs].sort()[0]!;
      const eqKey = `${sheet ?? ""}\u0000${eq}`;
      if (!multi && !eqSeen.has(eqKey)) {
        eqSeen.add(eqKey);
        const row = firstRow.get(pathKey)!;
        groups.delete(row);
        equipment.push({ file: a.file, at: { row, sheet, text: name }, kind: "equipment", level: null, ...(path.length > 1 ? { parent: "exists" as const } : {}), equipment_id: eq, name_text: name, name_cleaned: true, ...(unitRowName(eq, a.file, path) ? { name: unitRowName(eq, a.file, path)! } : {}) });
      }
      const seen = new Map<string, number>();
      for (const m of entries) {
        const nth = seen.get(m.s) ?? 0;
        seen.set(m.s, nth + 1);
        if ([...m.s].length > 8) {
          drop(DROP.notSymbol);
          continue;
        }
        const ws = byYear.get(m.y) ?? [];
        if (!ws.length) {
          drop(DROP.unlinkedMark);
          continue;
        }
        const written = m.col === "plans" || leftAsPlan.has(`${at3(a.file, rec.sheet, rec.r)}\u0000${m.y}`) || ws.every((x) => PLANNED.has(x.status));
        marks.push({
          file: a.file,
          at: { row: rec.r, sheet, text: m.s, ...(nth ? { nth } : {}) },
          fiscal_year: m.y,
          status: written ? "planned" : "actual",
          equipment_id: eq,
          work_ids: ws.map((x) => x.id as string),
          symbol: m.s,
          ...(multi ? { measure: false } : {}),
        });
        if (multi) drop(DROP.multi);
      }
    }
    assets.push(...groups.values(), ...equipment);
  }
  const fmt = (f: string) => (/\.xlsx$/i.test(f) ? "xlsx" : /\.csv$/i.test(f) ? "csv" : /\.pdf$/i.test(f) ? "pdf" : "jpg");
  const truth = HeldoutTruth.parse({
    schema: "moyai.heldout.truth/0",
    set,
    world: "answer/world.json",
    files: (w.files as J[]).map((f) => ({ file: f.file, format: fmt(f.file), kind: starFiles.has(f.file) ? "star" : /日報/.test(f.file) ? "daily" : "report" })),
    assets,
    marks,
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
