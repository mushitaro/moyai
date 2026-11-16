// 指示書 §5 の正解の形（answer/files・answer/world.json。補いは samples/heldout/ANSWER.md）を読み、
// 施設ごとに、書き方に依らない正解の形（contract.ts）に写す。台本と物差し（harness.ts）は、写したものをそのまま使う。
// 行で書いた正解（Excel・CSV は行、PDF は文書の中の順）を、読み手の格子のセルに引き当てるのは contract.ts の resolve。
// 読み手（src/）が決めた行の役割や列の役目は使わない（使うのは格子の文字だけ）。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { HeldoutTruth, type Asset, type Event, type FileEntry, type HeldoutWorld, type LoadedSet, type Locate, type Mark } from "./contract";
import { runSet, type FileResult, type RunOptions, type SetResult } from "./harness";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Loc = z.object({ file: z.string().min(1), sheet: z.string().nullable().optional(), r: z.number().int().positive().optional(), seq: z.number().int().nonnegative().optional(), image: z.string().optional() }).passthrough();

export const AnswerFile = z
  .object({
    schema: z.literal("moyai.answer.file/0").optional(),
    file: z.string().min(1),
    plan: z.boolean(),
    hidden_data: z.enum(["include", "exclude"]).optional(),
    source_xlsx: z.string().optional(),
    records: z.array(
      z
        .object({
          sheet: z.string().nullable().optional(),
          r: z.number().int().positive().optional(),
          seq: z.number().int().nonnegative().optional(),
          image: z.string().optional(),
          kind: z.enum(["item", "parent", "subtotal", "total"]),
          fields: z.record(z.string(), z.unknown()).default({}),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type AnswerFile = z.infer<typeof AnswerFile>;
type Rec = AnswerFile["records"][number];

export const AnswerWorld = z
  .object({
    schema: z.literal("moyai.answer.world/0").optional(),
    facility: z.object({ id: z.string().min(1), name: z.string(), industry: z.string().default("waste-incineration"), profile: z.unknown().optional() }).passthrough(),
    fiscal_year_start_month: z.number().int().min(1).max(12).default(4),
    man_day_hours: z.number().positive().default(8),
    today: z.string().optional(),
    equipment: z.array(
      z
        .object({
          id: z.string().min(1),
          name: z.string(),
          names: z.record(z.string(), z.string()).optional(),
          furnace: z.number().int().nullable().optional(),
          install_year: z.number().int().nullable().optional(),
          code: z.string().nullable().optional(),
          path: z.array(z.string()).optional(),
          rows: z.array(Loc).default([]),
        })
        .passthrough(),
    ),
    works: z.array(
      z
        .object({
          id: z.string().min(1),
          label: z.string().default(""),
          attribute: z.string().optional(),
          status: z.enum(["actual", "planned"]),
          fiscal_year: z.number().int(),
          equipment: z.array(z.string()).min(1),
          start: date.nullable().optional(),
          end: date.nullable().optional(),
          man_days: z.number().nullable().optional(),
          days: z.number().nullable().optional(),
          precision: z.boolean().optional(),
          rows: z.array(Loc.extend({ year: z.number().int().optional(), symbol: z.string().optional() })).default([]),
        })
        .passthrough(),
    ),
    unrecorded: z.array(z.object({ work: z.string(), reason: z.string() }).passthrough()).default([]),
  })
  .passthrough();
export type AnswerWorld = z.infer<typeof AnswerWorld>;

export interface AnswerFacility {
  /** 組のフォルダの中の、施設のフォルダの名前 */
  key: string;
  industry: string;
  set: LoadedSet;
  /** 写せなかった正解（理由つき）。物差しの外で数える */
  unmapped: string[];
}

const nfk = (s: string) => s.normalize("NFKC").trim();
const isDate = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const ext = (f: string) => /\.([^.]+)$/.exec(f)?.[1]?.toLowerCase() ?? "";
const formatOf = (f: string): FileEntry["format"] | null => {
  const e = ext(f);
  if (e === "xlsx" || e === "xlsm") return "xlsx";
  if (e === "csv" || e === "tsv" || e === "txt") return "csv";
  if (e === "pdf") return "pdf";
  if (e === "jpg" || e === "jpeg") return "jpg";
  if (e === "png") return "png";
  return null;
};
const locKey = (file: string, sheet: string | null | undefined, r: number | undefined, seq: number | undefined) => `${file}\u0000${sheet ?? ""}\u0000${r ?? ""}\u0000${seq ?? ""}`;
const lastName = (p: unknown) => (Array.isArray(p) && p.length ? String(p[p.length - 1]) : null);

/** PDF の行を指す文字の組：記録の文字の値（日付の形でないもの）と、書いてあった工数の文字。長いものから 4 つまで */
function textsOf(rec: Rec): string[] {
  const strs: string[] = [];
  const nums: string[] = [];
  for (const [k, v] of Object.entries(rec.fields)) {
    if (k === "manDays" || k === "marks" || k === "comments") continue;
    if (typeof v === "string" && v.trim() !== "" && !isDate(v)) strs.push(v.trim());
    else if (Array.isArray(v) && k === "path" && v.length) strs.push(String(v[v.length - 1]));
    else if (typeof v === "number") nums.push(String(v));
  }
  const out = [...new Set(strs)].sort((a, b) => b.length - a.length).slice(0, 4);
  for (const n of nums) if (out.length < 2 && !out.includes(n)) out.push(n);
  return out.map((t) => t.split(/\r?\n/)[0]!.trim()).filter((t) => t !== "");
}

/** 組を読む。組のフォルダの下の、answer/world.json を持つフォルダがそれぞれ 1 つの施設 */
export function loadAnswerSet(dir: string, opt: { filesDir?: (key: string) => string } = {}): { set: string; facilities: AnswerFacility[] } {
  const keys = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "answer", "world.json")))
    .map((e) => e.name)
    .sort();
  if (!keys.length) throw new Error(`${dir} に施設のフォルダ（answer/world.json）が無い`);
  const set = dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? dir;
  return { set, facilities: keys.map((k) => loadFacility(dir, k, set, opt.filesDir?.(k))) };
}

function loadFacility(setDir: string, key: string, setName: string, filesDirOverride?: string): AnswerFacility {
  const base = join(setDir, key);
  const filesDir = filesDirOverride ?? join(base, "files");
  const wp = AnswerWorld.safeParse(JSON.parse(readFileSync(join(base, "answer", "world.json"), "utf8")));
  if (!wp.success) throw new Error(`${key}/answer/world.json の形が違う：${wp.error.issues.slice(0, 5).map((i) => `${i.path.join(".")} ${i.message}`).join("、")}`);
  const w = wp.data;
  const answers: AnswerFile[] = [];
  const adir = join(base, "answer", "files");
  for (const n of existsSync(adir) ? readdirSync(adir).filter((x) => x.endsWith(".json")).sort() : []) {
    const p = AnswerFile.safeParse(JSON.parse(readFileSync(join(adir, n), "utf8")));
    if (!p.success) throw new Error(`${key}/answer/files/${n} の形が違う：${p.error.issues.slice(0, 5).map((i) => `${i.path.join(".")} ${i.message}`).join("、")}`);
    answers.push(p.data);
  }
  const unmapped: string[] = [];
  const recAt = new Map<string, { a: AnswerFile; rec: Rec }>();
  for (const a of answers) for (const rec of a.records) recAt.set(locKey(a.file, rec.sheet, rec.r, rec.seq), { a, rec });
  const workRows = new Set<string>();
  for (const wk of w.works) for (const r of wk.rows) workRows.add(r.file);
  const eqOfLoc = new Map<string, (typeof w.equipment)[number]>();
  for (const e of w.equipment) for (const r of e.rows) eqOfLoc.set(locKey(r.file, r.sheet, r.r, r.seq), e);

  // PDF の記録の nth：同じ文字の組の記録のうち、文書の順の何番目か
  const nthOf = new Map<Rec, number>();
  for (const a of answers) {
    if (formatOf(a.file) !== "pdf") continue;
    const bySig = new Map<string, Rec[]>();
    for (const rec of [...a.records].sort((x, y) => (x.seq ?? 0) - (y.seq ?? 0))) {
      const sig = textsOf(rec).join("\u0001");
      bySig.set(sig, [...(bySig.get(sig) ?? []), rec]);
    }
    for (const rs of bySig.values()) rs.forEach((r, i) => nthOf.set(r, i));
  }
  /** 記録の場所。text：その行のその文字のセル（名前・印のセル） */
  const locate = (a: AnswerFile, rec: Rec, text?: string, nth?: number): Locate | null => {
    const fmt = formatOf(a.file);
    if (fmt === "xlsx" || fmt === "csv") {
      if (!rec.r) return null;
      const sheet = fmt === "xlsx" ? (rec.sheet ?? null) : null;
      return text !== undefined ? { row: rec.r, sheet, text, ...(nth ? { nth } : {}) } : { row: rec.r, sheet };
    }
    if (fmt === "pdf") {
      const texts = textsOf(rec);
      if (!texts.length) return null;
      return { texts, nth: nthOf.get(rec) ?? 0, ...(text !== undefined ? { text } : {}) };
    }
    return null;
  };

  const files: FileEntry[] = [];
  for (const a of answers) {
    const format = formatOf(a.file);
    if (!format) {
      unmapped.push(`${a.file}：形式が分からない`);
      continue;
    }
    const kind: FileEntry["kind"] = format === "jpg" || format === "png" ? "photo" : a.plan ? "star" : workRows.has(a.file) ? (format === "pdf" ? "report" : "daily") : "ledger";
    files.push({
      file: a.file,
      format,
      kind,
      ...(a.hidden_data ? { hidden_data: a.hidden_data } : {}),
      ...(format === "pdf" && a.source_xlsx ? { source_xlsx: relative(filesDir, resolve(setDir, a.source_xlsx)).split("\\").join("/") } : {}),
    });
  }

  // ─── 機器とまとまり（path を持つ記録） ───
  const assets: Asset[] = [];
  for (const a of answers) {
    const fmt = formatOf(a.file);
    if (fmt !== "xlsx" && fmt !== "csv" && fmt !== "pdf") continue;
    const withPath = a.records.filter((r) => Array.isArray(r.fields.path) && (r.fields.path as unknown[]).length > 0);
    const prefixKey = (p: string[]) => p.join("\u0001");
    const pathOf = (rec: Rec) => (rec.fields.path as unknown[]).map(String);
    // 機器の行の場所：記録ごと（同じ名前の機器が号炉ごとに何行もある）。道で引くものは、その道の最初の行
    const eqAt = new Map<string, Locate>();
    const eqLocOf = new Map<Rec, Locate>();
    for (const rec of withPath) {
      const path = pathOf(rec);
      if (!eqOfLoc.has(locKey(a.file, rec.sheet, rec.r, rec.seq))) continue;
      const loc = locate(a, rec, path[path.length - 1]);
      if (!loc) continue;
      eqLocOf.set(rec, loc);
      if (!eqAt.has(prefixKey(path))) eqAt.set(prefixKey(path), loc);
    }
    // まとまりの場所：自分の行を持つ親の記録（数える）か、その道で始まる記録のうち行にその名前を書いたもの（最初の行。数えない）
    const groupAt = new Map<string, { loc: Locate; measure: boolean }>();
    const ownGroup = new Map<Rec, Locate>();
    for (const rec of withPath) {
      const path = pathOf(rec);
      if (rec.kind === "parent" && !eqOfLoc.has(locKey(a.file, rec.sheet, rec.r, rec.seq))) {
        const loc = locate(a, rec, path[path.length - 1]);
        if (loc) {
          ownGroup.set(rec, loc);
          if (!groupAt.get(prefixKey(path))?.measure) groupAt.set(prefixKey(path), { loc, measure: true });
        }
      }
      for (let i = 1; i < path.length; i++) {
        const k = prefixKey(path.slice(0, i));
        if (groupAt.has(k) || eqAt.has(k)) continue;
        const loc = locate(a, rec, path[i - 1]);
        if (loc) groupAt.set(k, { loc, measure: false });
      }
    }
    // 親の場所：文書の順で前にある、道が 1 つ短い記録（機器か、自分の行を持つまとまり）。無ければ、その道のまとまりか機器
    const parentLoc = (idx: number, path: string[]): Locate | null => {
      if (path.length < 2) return null;
      const pk = prefixKey(path.slice(0, -1));
      for (let j = idx - 1; j >= 0; j--) {
        const x = withPath[j]!;
        if (prefixKey(pathOf(x)) !== pk) continue;
        const l = eqLocOf.get(x) ?? ownGroup.get(x);
        if (l) return l;
      }
      return groupAt.get(pk)?.loc ?? eqAt.get(pk) ?? null;
    };
    // 星取表の段と親は、親があることだけを見る（開発用の物差しと同じ。星取表の段は、名前の列の位置で読むため資料ごとに違う）
    const tree = !a.plan;
    // まとまりの鍵の道：その下の機器の、世界の道（書いた文字ではなく、同じまとまりかを決める鍵）
    const worldPathOf = (path: string[]) => {
      for (const rec of withPath) {
        const p = (rec.fields.path as unknown[]).map(String);
        if (p.length <= path.length || path.some((x, i) => p[i] !== x)) continue;
        const e = eqOfLoc.get(locKey(a.file, rec.sheet, rec.r, rec.seq));
        if (e?.path && e.path.length >= path.length) return e.path.slice(0, path.length);
      }
      return path;
    };
    for (const [k, g] of groupAt) {
      if (eqAt.has(k)) continue;
      const path = k.split("\u0001");
      const parent = path.length > 1 ? (groupAt.get(prefixKey(path.slice(0, -1)))?.loc ?? eqAt.get(prefixKey(path.slice(0, -1))) ?? null) : null;
      assets.push({ file: a.file, at: g.loc, kind: "group", level: tree ? path.length : null, ...(tree ? { parent } : {}), equipment_id: null, path: worldPathOf(path), name_text: path[path.length - 1]!, ...(g.measure ? {} : { measure: false }) });
    }
    withPath.forEach((rec, idx) => {
      const path = pathOf(rec);
      const e = eqOfLoc.get(locKey(a.file, rec.sheet, rec.r, rec.seq));
      if (!e) {
        // 機器の下の部位の行（道のどこかに機器がある、機器そのものではない行）：持ち主は、文書の順で前にある、道の短い機器
        if (rec.kind !== "item") return;
        let owner: string | null = null;
        for (let j = idx - 1; j >= 0 && !owner; j--) {
          const x = withPath[j]!;
          const xp = pathOf(x);
          if (xp.length >= path.length || xp.some((n, i) => path[i] !== n)) continue;
          owner = eqOfLoc.get(locKey(a.file, x.sheet, x.r, x.seq))?.id ?? null;
        }
        const loc = locate(a, rec, path[path.length - 1]);
        if (!owner || !loc) return;
        assets.push({ file: a.file, at: loc, kind: "part", level: tree ? path.length : null, ...(tree ? { parent: parentLoc(idx, path) } : {}), equipment_id: owner, name_text: path[path.length - 1]!, ...(Array.isArray(rec.fields.specs) ? { spec_texts: (rec.fields.specs as unknown[]).map(String) } : {}) });
        return;
      }
      const loc = eqLocOf.get(rec);
      if (!loc) {
        unmapped.push(`${a.file} ${rec.sheet ?? ""} ${rec.r ?? rec.seq}：機器の行の場所が決まらない`);
        return;
      }
      const parent = parentLoc(idx, path);
      const nameText = path[path.length - 1]!;
      assets.push({
        file: a.file,
        at: loc,
        kind: "equipment",
        level: tree ? path.length : null,
        ...(tree ? { parent } : path.length > 1 ? { parent: "exists" as const } : {}),
        equipment_id: e.id,
        name_text: nameText,
        ...(e.names?.[a.file] ? { name: e.names[a.file] } : {}),
        ...(typeof rec.fields.code === "string" ? { tag: rec.fields.code } : {}),
        ...(typeof rec.fields.install_year === "number" ? { install_year: rec.fields.install_year } : {}),
        ...(Array.isArray(rec.fields.specs) ? { spec_texts: (rec.fields.specs as unknown[]).map(String) } : {}),
      });
    });
  }

  // ─── 星取表の印 ───
  const marks: Mark[] = [];
  // 星取表の行の作業：年度が同じで、記号を書いた行（同じ年度に予定と実績の 2 つの印）は記号も同じもの
  const worksAt = (file: string, sheet: string | null | undefined, r: number | undefined, seq: number | undefined, year?: number, symbol?: string) =>
    w.works.filter((wk) => wk.rows.some((x) => x.file === file && (x.sheet ?? null) === (sheet ?? null) && x.r === r && x.seq === seq && (year === undefined || x.year === year) && (symbol === undefined || x.symbol === undefined || nfk(x.symbol) === nfk(symbol))));
  for (const a of answers) {
    if (!a.plan) continue;
    for (const rec of a.records) {
      const ms = rec.fields.marks;
      if (!ms || typeof ms !== "object") continue;
      // 同じ年度に 2 つの印（予定の列と実績の列）は、記号の並び（列の順）で書く
      const entries = Object.entries(ms as Record<string, unknown>)
        .flatMap(([y, s]) => (Array.isArray(s) ? s : [s]).map((x) => ({ y: Number(y), s: String(x) })))
        .filter((x) => Number.isInteger(x.y) && x.s !== "")
        .sort((p, q) => p.y - q.y);
      const seen = new Map<string, number>();
      for (const m of entries) {
        const nth = seen.get(m.s) ?? 0;
        seen.set(m.s, nth + 1);
        const ws = worksAt(a.file, rec.sheet, rec.r, rec.seq, m.y, m.s);
        if (!ws.length) {
          unmapped.push(`${a.file} ${rec.sheet ?? ""} ${rec.r ?? rec.seq} の ${m.y} 年度の印「${m.s}」：世界の作業に結んでいない`);
          continue;
        }
        const loc = locate(a, rec, m.s, nth);
        if (!loc || !("row" in loc)) {
          unmapped.push(`${a.file} ${rec.r ?? rec.seq} の印：場所が決まらない`);
          continue;
        }
        const own = eqOfLoc.get(locKey(a.file, rec.sheet, rec.r, rec.seq));
        marks.push({
          file: a.file,
          at: loc as Mark["at"],
          fiscal_year: m.y,
          status: ws[0]!.status,
          equipment_id: own?.id ?? ws[0]!.equipment[0]!,
          work_ids: ws.map((x) => x.id),
          symbol: m.s,
        });
      }
    }
  }

  // ─── 作業の行（星取表でない資料） ───
  const events: Event[] = [];
  for (const a of answers) {
    if (a.plan) continue;
    const fmt = formatOf(a.file);
    if (fmt !== "xlsx" && fmt !== "csv" && fmt !== "pdf") continue;
    for (const rec of a.records) {
      const ws = worksAt(a.file, rec.sheet, rec.r, rec.seq);
      if (!ws.length) continue;
      const loc = locate(a, rec);
      if (!loc) {
        unmapped.push(`${a.file} ${rec.r ?? rec.seq}：作業の行の場所が決まらない`);
        continue;
      }
      const f = rec.fields;
      const w0 = ws[0]!;
      const start = isDate(f.date) ? (f.date as string) : isDate(f.start) ? (f.start as string) : (w0.start ?? null);
      const end = isDate(f.date) ? (f.date as string) : isDate(f.end) ? (f.end as string) : (w0.end ?? start);
      if (!start || !end) {
        unmapped.push(`${a.file} ${rec.r ?? rec.seq}：期間が無い`);
        continue;
      }
      const eqs = [...new Set(ws.flatMap((x) => x.equipment))];
      events.push({
        file: a.file,
        at: loc,
        status: w0.status,
        fiscal_year: w0.fiscal_year,
        equipment_ids: eqs,
        work_ids: ws.map((x) => x.id),
        start,
        end,
        man_days: typeof f.manDays === "number" ? f.manDays : null,
        days: typeof f.days === "number" ? f.days : null,
        bundle: eqs.length > 1,
      });
    }
  }

  const truth = HeldoutTruth.parse({ schema: "moyai.heldout.truth/0", set: `${setName}/${key}`, world: "answer/world.json", files, assets, marks, events });
  const furnaces = [...new Set(w.equipment.map((e) => e.furnace).filter((n): n is number => typeof n === "number"))].sort((p, q) => p - q);
  const world: HeldoutWorld = {
    schema: "moyai.heldout.world/0",
    facility: { id: w.facility.id, name: w.facility.name, furnace_type: "", furnaces: furnaces.map((no) => ({ no, label: `${no}` })) },
    fiscal_years: [...new Set(w.works.map((x) => x.fiscal_year))].sort((p, q) => p - q),
    today: w.today ?? "",
    man_day_hours: w.man_day_hours,
    equipment: w.equipment.map((e) => ({ id: e.id, name: e.name, base_name: e.name, tag: e.code ?? "", system: e.path?.[0] ?? "", path: e.path ?? [], parts: [], furnace: e.furnace ?? null, furnace_label: e.furnace ? `${e.furnace}` : "", install_year: e.install_year ?? 0, spec: [] })),
    works: w.works.map((x) => ({ id: x.id, equipment_id: x.equipment[0]!, fiscal_year: x.fiscal_year, status: x.status, label: x.label, attr: x.attribute ?? "", start: x.start ?? null, end: x.end ?? null, man_days: x.man_days ?? null, duration_days: x.days ?? null, precision: !!x.precision })),
  };
  return { key, industry: w.facility.industry, set: { dir: base, filesDir, truth, world }, unmapped };
}

/** 施設ごとに走らせ、組の結果にまとめる（資料の名前の頭に施設のフォルダ） */
export async function runAnswerSet(
  dir: string,
  facts: (key: string) => Record<string, unknown> = () => ({}),
  opt: RunOptions = {},
  load: { filesDir?: (key: string) => string } = {},
): Promise<{ result: SetResult; facilities: { key: string; industry: string; result: SetResult; unmapped: string[] }[] }> {
  const { set, facilities } = loadAnswerSet(dir, load);
  const per: { key: string; industry: string; result: SetResult; unmapped: string[] }[] = [];
  for (const f of facilities) {
    const { result } = await runSet(f.set, { ...opt, facts: facts(f.key), facilityKey: f.set.world.facility.id });
    per.push({ key: f.key, industry: f.industry, result, unmapped: f.unmapped });
  }
  return { result: mergeResults(set, per), facilities: per };
}

export function mergeResults(set: string, per: { key: string; result: SetResult; unmapped?: string[] }[]): SetResult {
  const files: FileResult[] = per.flatMap((p) => p.result.files.map((f) => ({ ...f, file: `${p.key}/${f.file}` })));
  const sum = (g: (r: SetResult) => number) => per.reduce((a, p) => a + g(p.result), 0);
  const sumAcc = (g: (r: SetResult) => { correct: number; total: number }) => ({ correct: sum((r) => g(r).correct), total: sum((r) => g(r).total) });
  const notCounted: Record<string, number> = {};
  for (const p of per) for (const [k, v] of Object.entries(p.result.recovery.notCounted)) notCounted[`${p.key}：${k}`] = v;
  const planMade = per.every((p) => p.result.planMade);
  return {
    set,
    files,
    asked: sum((r) => r.asked),
    answered: sum((r) => r.answered),
    openAtEnd: per.flatMap((p) => p.result.openAtEnd.map((q) => ({ ...q, text: `${p.key}：${q.text}` }))),
    unresolvedBefore: sum((r) => r.unresolvedBefore),
    unresolvedAfter: sum((r) => r.unresolvedAfter),
    planMade,
    blockers: per.flatMap((p) => p.result.blockers.map((b) => `${p.key}：${b}`)),
    plan: planMade ? { assets: sum((r) => r.plan?.assets ?? 0), works: sum((r) => r.plan?.works ?? 0), details: sum((r) => r.plan?.details ?? 0) } : null,
    markWorkCount: per.every((p) => p.result.markWorkCount) ? sumAcc((r) => r.markWorkCount!) : null,
    recovery: {
      denominator: sum((r) => r.recovery.denominator),
      together: sum((r) => r.recovery.together),
      inPlan: sum((r) => r.recovery.inPlan),
      manDays: sumAcc((r) => r.recovery.manDays),
      days: sumAcc((r) => r.recovery.days),
      marksOnly: sum((r) => r.recovery.marksOnly),
      notCounted,
      misses: per.flatMap((p) => p.result.recovery.misses.map((m) => `${p.key}：${m}`)).slice(0, 50),
    },
    unplaced: [...per.flatMap((p) => p.result.unplaced.map((u) => `${p.key}：${u}`)), ...per.flatMap((p) => (p.unmapped ?? []).map((u) => `${p.key}：写せない正解：${u}`))].slice(0, 80),
  };
}
