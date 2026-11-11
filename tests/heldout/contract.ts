// 見ていない様式の正解の形（docs/plan.md §2.6）。書き方（見出しの位置・列の並び・段の書き方）に依らない形にしてある。
// 正解の 1 つ 1 つは「資料のどこにあるか」（セル・行・その行にだけある文字の組）で指し、試験はそれを読み手の格子のセルに引き当てて比べる。
// 新しい書き手は samples/heldout/CONTRACT.md（この形の説明）だけを見て正解を書く。開発用の工場の正解（samples/truth/）は、
// calibrate.test.ts がこの形に写して、この試験の道具そのものが開発用の資料で開発用の物差しと同じ数を出すことを確かめる。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { SourceFile } from "../../src/import/grid";

const cellRef = z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/);
const sheet = z.string().nullable().optional();

/**
 * 資料のどこにあるか。cell：そのセル。row：その行のすべてのセル。row と text：その行の、その文字のセル（同じ文字のセルが
 * いくつかあれば、列の順の nth 番目。0 から）。texts：それぞれの文字を持つセルがそろう、ただ 1 つの行（nth があれば、そうなる行の
 * 文書の順の nth 番目。text があれば、その行のその文字のセル）。row と text・nth は、行で書いた正解（answer.ts）を写すときに使う
 */
export const Locate = z.union([
  z.object({ cell: cellRef, sheet }).strict(),
  z.object({ row: z.number().int().positive(), sheet }).strict(),
  z.object({ row: z.number().int().positive(), sheet, text: z.string().min(1).max(200), nth: z.number().int().nonnegative().optional() }).strict(),
  z.object({ texts: z.array(z.string().min(1).max(200)).min(1).max(8), sheet, nth: z.number().int().nonnegative().optional(), text: z.string().min(1).max(200).optional() }).strict(),
]);
export type Locate = z.infer<typeof Locate>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const id = z.string().min(1).max(32);

export const FileEntry = z
  .object({
    file: z.string().min(1).max(200),
    format: z.enum(["xlsx", "csv", "pdf", "jpg", "png"]),
    kind: z.enum(["ledger", "star", "daily", "report", "photo"]),
    /** CSV：書き手が書いた文字コード（Python の codec の名前）と区切り */
    encoding: z.string().max(32).nullable().optional(),
    delimiter: z.string().max(2).nullable().optional(),
    /** PDF を xlsx から書き出したなら、その xlsx（① を比べる相手） */
    source_xlsx: z.string().max(200).nullable().optional(),
    /** 隠した行・列・シートの中身を計画に入れるか（既定は入れる） */
    hidden_data: z.enum(["include", "exclude"]).optional(),
    /** 写真：何を撮ったか（同じ組の資料の名前と頁） */
    photo_of: z.object({ file: z.string(), page: z.number().int().positive() }).nullable().optional(),
    note: z.string().max(2000).optional(),
  })
  .strict();
export type FileEntry = z.infer<typeof FileEntry>;

export const Asset = z
  .object({
    file: z.string(),
    at: Locate,
    /** group：設備・系統などのまとまり、equipment：機器（世界の equipment の 1 つ）、part：機器の部位 */
    kind: z.enum(["group", "equipment", "part"]),
    /** その資料の段（1 から）。資料が段を持たないなら null */
    level: z.number().int().positive().nullable(),
    /** 親：そのセル（at と同じ形）。null は根。"exists" は「親があること」だけを見る。省くと見ない */
    parent: z.union([Locate, z.null(), z.literal("exists")]).optional(),
    equipment_id: id.nullable(),
    /** group：世界の path の、その段までの名前（同じものかを決める鍵。書いた文字ではない） */
    path: z.array(z.string()).optional(),
    /** セルに書いた文字そのもの */
    name_text: z.string().min(1),
    /**
     * true：name_text は、セルに書いた文字そのものではなく、番号や記号の飾りを除いた名前（工場 v2 の正解は、書いた文字そのものを持たない）。
     * このときは、引き当てたセルの文字そのものの名前も正しいとする（書いた文字そのものを名前にするのは、ほかの組でも正しい読み）
     */
    name_cleaned: z.boolean().optional(),
    /** 機器の名前（番号を除いた、その資料での呼び名）と、番号（タグ）。書いていなければ null */
    name: z.string().nullable().optional(),
    tag: z.string().nullable().optional(),
    install_year: z.number().int().nullable().optional(),
    /** 仕様・備考として計画に残るべき文字（セルに書いたまま） */
    spec_texts: z.array(z.string()).optional(),
    /** false：数えない（引き当てと質問の答えにだけ使う） */
    measure: z.boolean().optional(),
  })
  .strict();
export type Asset = z.infer<typeof Asset>;

export const Mark = z
  .object({
    file: z.string(),
    /** 印のセル（行で書いた正解から写したものは、行とその印の文字と列の順） */
    at: z.union([z.object({ cell: cellRef, sheet }).strict(), z.object({ row: z.number().int().positive(), sheet, text: z.string().min(1), nth: z.number().int().nonnegative().optional() }).strict()]),
    fiscal_year: z.number().int(),
    status: z.enum(["planned", "actual"]),
    equipment_id: id,
    work_ids: z.array(id).min(1),
    symbol: z.string().min(1).max(8),
    /** false：③ に数えない（何台もの機器をまとめた行の印。対象の機器が 1 つに決まらない）。台本の答え・読みすぎの数え・⑥ には使う */
    measure: z.boolean().optional(),
  })
  .strict();
export type Mark = z.infer<typeof Mark>;

export const Event = z
  .object({
    file: z.string(),
    at: Locate,
    status: z.enum(["planned", "actual"]),
    fiscal_year: z.number().int(),
    equipment_ids: z.array(id).min(1),
    work_ids: z.array(id).min(1),
    start: date,
    end: date,
    /** その行に書いた工数（人・日に直した値）。書いていなければ null */
    man_days: z.number().nullable(),
    /** その行に書いた日数（工期）。書いていなければ null */
    days: z.number().nullable(),
    /** 一式（いくつかの機器をまとめた 1 行） */
    bundle: z.boolean(),
  })
  .strict();
export type Event = z.infer<typeof Event>;

export const HeldoutTruth = z
  .object({
    schema: z.literal("moyai.heldout.truth/0"),
    set: z.string().min(1).max(64),
    /** 世界の書き出し（moyai.heldout.world/0）の道（この JSON からの相対） */
    world: z.string(),
    files: z.array(FileEntry).min(1),
    assets: z.array(Asset),
    marks: z.array(Mark),
    events: z.array(Event),
  })
  .strict();
export type HeldoutTruth = z.infer<typeof HeldoutTruth>;

/** 世界の書き出し（scripts/heldout/export-world.py が作る。生成器の書き方の決まりは含まない） */
export interface HeldoutWorld {
  schema: "moyai.heldout.world/0";
  facility: { id: string; name: string; furnace_type: string; furnaces: { no: number; label: string }[] };
  fiscal_years: number[];
  today: string;
  man_day_hours: number;
  equipment: { id: string; name: string; base_name: string; tag: string; system: string; path: string[]; parts: unknown[]; furnace: number | null; furnace_label: string; install_year: number; spec: string[] }[];
  works: { id: string; equipment_id: string; fiscal_year: number; status: "planned" | "actual"; label: string; attr: string; start: string | null; end: string | null; man_days: number | null; duration_days: number | null; precision: boolean }[];
}

export interface LoadedSet {
  dir: string;
  /** 資料の置き場所（既定は dir/files） */
  filesDir?: string;
  truth: HeldoutTruth;
  world: HeldoutWorld;
}

/** 組を読む。形が違えば、どこが違うかを投げる（直さない） */
export function loadSet(dir: string, opt: { truthFile?: string; filesDir?: string } = {}): LoadedSet {
  const p = join(dir, opt.truthFile ?? "truth.json");
  const filesDir = opt.filesDir ?? join(dir, "files");
  const parsed = HeldoutTruth.safeParse(JSON.parse(readFileSync(p, "utf8")));
  if (!parsed.success) throw new Error(`${p} の形が違う：${parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")} ${i.message}`).join("、")}`);
  const truth = parsed.data;
  const world = JSON.parse(readFileSync(join(dir, truth.world), "utf8")) as HeldoutWorld;
  if (world.schema !== "moyai.heldout.world/0") throw new Error(`${truth.world} は世界の書き出しでない`);
  for (const f of truth.files) if (!existsSync(join(filesDir, f.file))) throw new Error(`${join(filesDir, f.file)} が無い`);
  return { dir, filesDir, truth, world };
}

// ─── 正解の場所 → 読み手の格子のセル ─────────────────────────────

export const nf = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");
export const rowOf = (ref: string) => Number(/\d+$/.exec(ref)?.[0] ?? 0);

export interface Resolved {
  /** 読み手のシートの名前（CSV・PDF は null） */
  sheet: string | null;
  row: number;
  refs: Set<string>;
}
export type Resolution = { ok: true; at: Resolved } | { ok: false; why: string };

type Sheet = SourceFile["sheets"][number];

function sheetsOf(src: SourceFile, name: string | null | undefined): Sheet[] {
  if (name === undefined || name === null) return src.sheets;
  return src.sheets.filter((s) => s.name === name);
}

/** 場所を読み手の格子のセルに引き当てる。決まらなければ理由（行が無い・2 つ以上に当たる）を返す */
export function resolve(src: SourceFile | undefined, loc: Locate): Resolution {
  if (!src) return { ok: false, why: "読み手の格子が無い" };
  if ("cell" in loc) {
    const sh = loc.sheet === undefined || loc.sheet === null ? src.sheets[0] : sheetsOf(src, loc.sheet)[0];
    if (!sh) return { ok: false, why: `シート ${loc.sheet} が無い` };
    return { ok: true, at: { sheet: sh.name, row: rowOf(loc.cell), refs: new Set([loc.cell]) } };
  }
  if ("row" in loc && "text" in loc) {
    const sh = loc.sheet === undefined || loc.sheet === null ? src.sheets[0] : sheetsOf(src, loc.sheet)[0];
    if (!sh) return { ok: false, why: `シート ${loc.sheet} が無い` };
    const c = cellWithText(sh.cells.filter((x) => x.r === loc.row), loc.text, loc.nth ?? 0);
    if (!c) return { ok: false, why: `${loc.row} 行に「${loc.text}」のセルが${loc.nth ? ` ${loc.nth + 1} つ` : ""}無い` };
    return { ok: true, at: { sheet: sh.name, row: loc.row, refs: new Set([c.ref]) } };
  }
  if ("row" in loc) {
    const sh = loc.sheet === undefined || loc.sheet === null ? src.sheets[0] : sheetsOf(src, loc.sheet)[0];
    if (!sh) return { ok: false, why: `シート ${loc.sheet} が無い` };
    const refs = new Set(sh.cells.filter((c) => c.r === loc.row).map((c) => c.ref));
    if (!refs.size) return { ok: false, why: `${loc.row} 行にセルが無い` };
    return { ok: true, at: { sheet: sh.name, row: loc.row, refs } };
  }
  // 文字の組：それぞれの文字が、行のどれかのセルの文字と同じ行。無ければ、セルの文字に含まれる行。そうなる行がただ 1 つ
  const want = loc.texts.map(nf);
  const find = (match: (t: string, w: string) => boolean) => {
    const out: { sh: Sheet; r: number }[] = [];
    for (const sh of sheetsOf(src, loc.sheet)) {
      const rows = new Map<number, string[]>();
      for (const c of sh.cells) rows.set(c.r, [...(rows.get(c.r) ?? []), nf(c.text)]);
      for (const [r, ts] of rows) if (want.every((w) => ts.some((t) => match(t, w)))) out.push({ sh, r });
    }
    return out;
  };
  let hits = find((t, w) => t === w);
  if (hits.length === 0) hits = find((t, w) => t.includes(w));
  if (hits.length === 0) return { ok: false, why: `「${loc.texts.join("」「")}」をそろえて持つ行が無い` };
  if (loc.nth === undefined && hits.length > 1) return { ok: false, why: `「${loc.texts.join("」「")}」の行が ${hits.length} つあり、1 つに決まらない` };
  const h = hits[loc.nth ?? 0];
  if (!h) return { ok: false, why: `「${loc.texts.join("」「")}」の行が ${hits.length} つで、${(loc.nth ?? 0) + 1} 番目が無い` };
  const rowCells = h.sh.cells.filter((c) => c.r === h.r);
  if (loc.text !== undefined) {
    const c = cellWithText(rowCells, loc.text, 0);
    if (!c) return { ok: false, why: `「${loc.texts.join("」「")}」の行に「${loc.text}」のセルが無い` };
    return { ok: true, at: { sheet: h.sh.name, row: h.r, refs: new Set([c.ref]) } };
  }
  return { ok: true, at: { sheet: h.sh.name, row: h.r, refs: new Set(rowCells.map((c) => c.ref)) } };
}

/** 行のセルのうち、その文字のセル（列の順の nth 番目）。同じ文字が無ければ、その文字を含むセル */
function cellWithText(cells: Sheet["cells"], text: string, nth: number): Sheet["cells"][number] | null {
  const w = nf(text);
  const byCol = [...cells].sort((a, b) => a.c - b.c);
  const exact = byCol.filter((c) => nf(c.text) === w);
  if (exact.length) return exact[nth] ?? null;
  return byCol.filter((c) => w !== "" && nf(c.text).includes(w))[nth] ?? null;
}

/** 出どころ（計画の sources の 1 つ）が、引き当てたセルのどれかか */
export function hits(s: { file: string; sheet: string | null; cell: string | null }, file: string, at: Resolved): boolean {
  return s.file === file && s.cell !== null && at.refs.has(s.cell) && (s.sheet ?? null) === (at.sheet ?? null);
}
