// パックの pack.json の形（docs/plan.md §2.4・§2.7）。中身のあるパックと、設備の地図の「名前と出どころだけのパック」（中身は空）の 2 つ。
// 中身のあるパックは、ここで見るのは共通の欄だけで、ほかの欄は読む側（共有・星取表・検査）がそれぞれ確かめる（読みを変えない）。
// 空のパックは欄を閉じる（知らない欄があれば通さない）。業種の語はここに置かない（名前・群の名前・作らない理由はパックと packs/_kinds/ から読む）。
import { z } from "zod";

export const PACK_SCHEMA = "moyai.pack/0";
/** 確かめた度合いの 4 段 */
export const VERIFICATION_LEVELS = ["原典照合済", "要約のみ", "未確認", "プレビュー"] as const;
export const PACK_GROUPS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

const id = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const text = z.string().trim().min(1);

const base = {
  schema: z.literal(PACK_SCHEMA),
  id,
  name: text,
  version: z.number().int().min(1),
};

/** 出どころの候補：名前・発行元・URL（照らすまで無くてよい）・この行の候補か群の候補か */
export const SourceCandidate = z.strictObject({
  title: text,
  issuer: text.nullable(),
  url: z.url({ protocol: /^https$/ }).nullable(),
  scope: z.enum(["row", "group"]),
});
export type SourceCandidate = z.infer<typeof SourceCandidate>;

/** 中身のあるパック（共通の欄だけを見る） */
export const ContentPack = z.looseObject({
  ...base,
  group: z.enum(PACK_GROUPS),
  verification: z.record(z.string(), z.string()),
  sharing: z.enum(["on", "off"]),
  common: text,
});

const emptyBase = {
  ...base,
  content: z.literal("empty"),
  verification: z.enum(VERIFICATION_LEVELS),
  sharing: z.literal("off"),
  note: text.optional(),
};

/** 設備の地図の行：名前と出どころの候補だけ。中身は空 */
export const EmptyPack = z.strictObject({
  ...emptyBase,
  group: z.enum(PACK_GROUPS),
  sourceCandidates: z.array(SourceCandidate).min(1),
});

/** 作らない行：名前と作らない理由だけ */
export const NotBuiltPack = z.strictObject({
  ...emptyBase,
  group: z.null(),
  build: z.literal(false),
  reason: text,
  sourceCandidates: z.array(SourceCandidate).max(0),
});

export type ContentPackT = z.infer<typeof ContentPack>;
export type EmptyPackT = z.infer<typeof EmptyPack>;
export type NotBuiltPackT = z.infer<typeof NotBuiltPack>;

export type PackParse =
  | { ok: true; kind: "content"; pack: ContentPackT }
  | { ok: true; kind: "empty"; pack: EmptyPackT }
  | { ok: true; kind: "notBuilt"; pack: NotBuiltPackT }
  | { ok: false; issues: string[] };

const issues = (e: z.ZodError) => e.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.code}`);

/** pack.json を形で確かめる。folder を渡せば、id がフォルダの名前と同じことも確かめる。 */
export function parsePack(json: unknown, folder?: string): PackParse {
  const content = (json as { content?: unknown } | null)?.content;
  let out: PackParse;
  if (content === "empty") {
    const build = (json as { build?: unknown }).build;
    if (build === false) {
      const r = NotBuiltPack.safeParse(json);
      out = r.success ? { ok: true, kind: "notBuilt", pack: r.data } : { ok: false, issues: issues(r.error) };
    } else {
      const r = EmptyPack.safeParse(json);
      out = r.success ? { ok: true, kind: "empty", pack: r.data } : { ok: false, issues: issues(r.error) };
    }
  } else if (content !== undefined) {
    out = { ok: false, issues: ["content: invalid_value"] };
  } else {
    const r = ContentPack.safeParse(json);
    out = r.success ? { ok: true, kind: "content", pack: r.data } : { ok: false, issues: issues(r.error) };
  }
  if (out.ok && folder !== undefined && out.pack.id !== folder) return { ok: false, issues: ["id: folder_mismatch"] };
  return out;
}

/** 設備の地図の群（packs/_kinds/groups.json）：群の名前と、群の中の並び */
export const GroupsDoc = z.object({
  schema: z.literal("moyai.groups/0"),
  groups: z.array(z.object({ id: z.enum(PACK_GROUPS), name: text, order: z.array(id) })).length(PACK_GROUPS.length),
  notBuilt: z.array(id),
});
export type GroupsDoc = z.infer<typeof GroupsDoc>;

export interface MapRow {
  id: string;
  name: string;
  kind: "content" | "empty";
  verification: string;
  sourceCandidates: SourceCandidate[];
}
export interface IndustryMap {
  groups: { id: string; name: string; rows: MapRow[] }[];
  notBuilt: { id: string; name: string; reason: string }[];
  /** 形の通らない pack.json（フォルダの名前と理由）。読み込まずに画面に出す */
  invalid: { folder: string; issues: string[] }[];
  /** packs/ から数えた数（作らない行を含む。形の通らないものは含めない） */
  total: number;
}

/** packs/<folder>/pack.json の中身の一覧から、設備の地図を組む。並びは groups.json、数は pack.json から数える。 */
export function buildIndustryMap(packs: { folder: string; json: unknown }[], groupsJson: unknown): IndustryMap {
  const g = GroupsDoc.parse(groupsJson);
  const rowsByGroup = new Map<string, MapRow[]>();
  const notBuilt: IndustryMap["notBuilt"] = [];
  const invalid: IndustryMap["invalid"] = [];
  for (const p of [...packs].sort((a, b) => a.folder.localeCompare(b.folder))) {
    const r = parsePack(p.json, p.folder);
    if (!r.ok) {
      invalid.push({ folder: p.folder, issues: r.issues });
      continue;
    }
    if (r.kind === "notBuilt") {
      notBuilt.push({ id: r.pack.id, name: r.pack.name, reason: r.pack.reason });
      continue;
    }
    const row: MapRow =
      r.kind === "content"
        ? { id: r.pack.id, name: r.pack.name, kind: "content", verification: r.pack.verification.common ?? "未確認", sourceCandidates: [] }
        : { id: r.pack.id, name: r.pack.name, kind: "empty", verification: r.pack.verification, sourceCandidates: r.pack.sourceCandidates };
    const list = rowsByGroup.get(r.pack.group) ?? [];
    list.push(row);
    rowsByGroup.set(r.pack.group, list);
  }
  const groups = g.groups.map((grp) => {
    const rows = rowsByGroup.get(grp.id) ?? [];
    const at = (rid: string) => {
      const i = grp.order.indexOf(rid);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return { id: grp.id, name: grp.name, rows: [...rows].sort((a, b) => at(a.id) - at(b.id)) };
  });
  const total = groups.reduce((n, grp) => n + grp.rows.length, 0) + notBuilt.length;
  return { groups, notBuilt, invalid, total };
}
