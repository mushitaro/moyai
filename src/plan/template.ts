// 様式に写す（docs/screens.md 3.5、P2 の 7、絵は Export.dc.html）：利用者が落とした様式（Excel）の見出しの行を読み、列ごとに写すものを決めて、
// 確定した版の作業を 1 行ずつ写す。純粋な関数（Excel を読み書きするのは画面の側）。
// - 列の役目：項目（機器の名前）・作業・周期（年）・年度の印（○ 計画・● 実施・◎ 両方）・次回・未定（何も写さない。人が見て決める）。
// - 見出しの言葉から役目を決める（「設備名」「作業区分」「周期（年）」「R8」「2026 年度」など）。決まらない列は未定にする（推測で埋めない）。
// - 周期は、行の作業のきっかけ（取り込みが周期の列から置いたもの）の暦の枝の年数。行に合わさった作業のきっかけが違えば空。
//   どの作業にもきっかけが無いときだけ、印の年度の差でいちばん多いもの（印が 2 つに満たなければ空）。台帳の新-11
// - 次回は、画面と Excel の標準の様式と同じ字（due-view.ts）。見出しの言葉からは決めず、人が「← 次回」を当てた列にだけ写す（docs/screens.md 3.5）
import type { Plan, WorkT } from "../shared/plan";
import { templateLayoutSchema, type TemplateLayout } from "../shared/template-layout";
import { planDueViews, rowDue } from "./due-view";
import { TriggerSchema } from "./next";

export type ColumnRole = { kind: "item" } | { kind: "work" } | { kind: "cycle" } | { kind: "year"; fiscalYear: number } | { kind: "next" } | { kind: "none" };

/** 様式に写す言葉（年に割り切れない周期の書き方。Wire に確かめる） */
export const TEMPLATE_TEXT = { months: (m: number) => `${m}か月` };
export type TemplateMark = "plan" | "actual" | "both";

const z2h = (s: string) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\s+/g, "");

/** 見出しが年度なら、その年度（西暦）。R8・令和8・令和8年度・H30・平成30年度・2026・2026年度・FY2026 */
export function fiscalYearOfHeader(text: string): number | null {
  const t = z2h(text);
  let m = /^(?:R|令和)(\d{1,2})(?:年度?)?$/.exec(t);
  if (m) return 2018 + Number(m[1]);
  m = /^(?:H|平成)(\d{1,2})(?:年度?)?$/.exec(t);
  if (m) return 1988 + Number(m[1]);
  m = /^(?:FY)?(20\d\d|19\d\d)(?:年度?)?$/.exec(t);
  if (m) return Number(m[1]);
  return null;
}

/** 見出しの言葉から、列の役目を決める */
export function roleOfHeader(text: string): ColumnRole {
  const t = z2h(text);
  if (!t) return { kind: "none" };
  const fy = fiscalYearOfHeader(t);
  if (fy !== null) return { kind: "year", fiscalYear: fy };
  if (/周期|間隔|サイクル/.test(t)) return { kind: "cycle" };
  if (/作業|区分|内容|保全/.test(t)) return { kind: "work" };
  if (/設備|機器|項目|名称|装置/.test(t)) return { kind: "item" };
  return { kind: "none" };
}

/** 見出しの行：上から見て、2 つ以上の欄に字がある最初の行（無ければ 0） */
export function findHeaderRow(rows: readonly (readonly string[])[]): number {
  const i = rows.findIndex((r) => r.filter((c) => c.trim() !== "").length >= 2);
  return i < 0 ? 0 : i;
}

export interface TemplateRow {
  item: string;
  work: string;
  /** 周期（年。年に割り切れない周期は「6か月」）。決まらなければ null */
  cycle: number | string | null;
  marks: Map<number, TemplateMark>;
  /** 次回（画面と同じ字。決まらなければ「―」） */
  next: string;
}

/**
 * 行の作業のきっかけから周期：暦の枝がちょうど 1 つのきっかけの、その年数。きっかけのある作業どうしで違えば null。
 * どの作業にもきっかけが無ければ undefined（印から数え直す）
 */
function cycleOfTriggers(works: readonly WorkT[]): number | string | null | undefined {
  const withTrigger = works.filter((w) => w.trigger !== null && w.trigger !== undefined);
  if (withTrigger.length === 0) return undefined;
  const spans = new Set<number>();
  for (const w of withTrigger) {
    const t = TriggerSchema.safeParse(w.trigger);
    if (!t.success) return null;
    const cal = t.data.branches.filter((b) => b.kind === "calendar");
    if (cal.length !== 1) return null;
    const b = cal[0] as { years?: number; months?: number };
    spans.add((b.years ?? 0) * 12 + (b.months ?? 0));
  }
  if (spans.size !== 1) return null;
  const m = [...spans][0]!;
  if (m <= 0) return null;
  return m % 12 === 0 ? m / 12 : TEMPLATE_TEXT.months(m);
}

/** 印の年度の差でいちばん多いもの（同じ数なら小さい方） */
function cycleOf(years: number[]): number | null {
  const ys = [...new Set(years)].sort((a, b) => a - b);
  if (ys.length < 2) return null;
  const count = new Map<number, number>();
  for (let i = 1; i < ys.length; i++) {
    const d = ys[i]! - ys[i - 1]!;
    count.set(d, (count.get(d) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
}

/** 行の周期：作業のきっかけから。どの作業にもきっかけが無ければ印の年度の差でいちばん多いもの（様式の写し方の案〔template-layout.ts〕も同じ決まり） */
export function cycleFor(works: readonly WorkT[], markYears: readonly number[]): number | string | null {
  const fromTrigger = cycleOfTriggers(works);
  return fromTrigger === undefined ? cycleOf([...markYears]) : fromTrigger;
}

/**
 * 確定した版の作業を、機器の名前 × 作業の言い方ごとに 1 行（同じ機器の同じ作業は印を合わせる）。
 * 作業の言い方は、作業の属性が決まっていればその言い方（点検・分解整備…）、無ければ資料の作業の名前
 */
export function templateRows(plan: Plan, workLabel: (attribute: string) => string | undefined, asOf: string): TemplateRow[] {
  const names = new Map(plan.assets.map((a) => [a.nodeKey, a.name]));
  const due = planDueViews(plan, asOf);
  const byKey = new Map<string, { item: string; work: string; marks: Map<number, TemplateMark>; works: WorkT[] }>();
  for (const w of plan.works) {
    const item = w.targets.map((t) => names.get(t) ?? t).join("、");
    const work = (w.attribute ? workLabel(w.attribute) : undefined) ?? w.kind;
    const key = `${item}\u0000${work}`;
    const row = byKey.get(key) ?? { item, work, marks: new Map<number, TemplateMark>(), works: [] };
    row.works.push(w);
    for (const d of plan.details.filter((x) => x.workKey === w.workKey)) {
      const was = row.marks.get(d.fiscalYear);
      const now: TemplateMark = d.planOrActual === "plan" ? "plan" : "actual";
      row.marks.set(d.fiscalYear, was && was !== now ? "both" : now);
    }
    byKey.set(key, row);
  }
  return [...byKey.values()]
    .filter((r) => r.marks.size > 0)
    .map(({ works, ...r }) => ({ ...r, cycle: cycleFor(works, [...r.marks.keys()]), next: rowDue(works.map((w) => w.workKey), due)?.text ?? "" }))
    .sort((a, b) => a.item.localeCompare(b.item, "ja") || a.work.localeCompare(b.work, "ja"));
}

const MARK_TEXT: Record<TemplateMark, string> = { plan: "○", actual: "●", both: "◎" };

/** 1 つの欄に写す値（未定の列は空） */
export function cellValue(role: ColumnRole, row: TemplateRow): string | number {
  switch (role.kind) {
    case "item":
      return row.item;
    case "work":
      return row.work;
    case "cycle":
      return row.cycle ?? "";
    case "next":
      return row.next;
    case "year": {
      const m = row.marks.get(role.fiscalYear);
      return m ? MARK_TEXT[m] : "";
    }
    default:
      return "";
  }
}

/**
 * 写し方（列の役目）：様式の見出しの行（1 から数える Excel の行）・見出しの言葉・列ごとの役目。保管先の 様式/<名前>/columns.json。
 * layout があれば、列の役目ではなく写し方の案（TemplateLayout。人が EXPORT で受けたもの）で書く（template-layout.ts）。
 * layout の無い写し方は前と同じ形（ハッシュも版も変わらない）
 */
export const COLUMNS_SCHEMA = "moyai.columns/0";
export interface TemplateColumns {
  schema: typeof COLUMNS_SCHEMA;
  headerRow: number;
  headers: string[];
  roles: ColumnRole[];
  layout?: TemplateLayout;
}

/** 写し方の形か（保管先や画面から来たものを確かめる） */
export function isTemplateColumns(v: unknown): v is TemplateColumns {
  if (!v || typeof v !== "object") return false;
  const c = v as Partial<TemplateColumns>;
  const keys = Object.keys(c).sort().join(",");
  if ((keys !== "headerRow,headers,roles,schema" && keys !== "headerRow,headers,layout,roles,schema") || c.schema !== COLUMNS_SCHEMA) return false;
  if ("layout" in c && !templateLayoutSchema.safeParse(c.layout).success) return false;
  if (!Number.isInteger(c.headerRow) || c.headerRow! < 1 || c.headerRow! > 1000) return false;
  if (!Array.isArray(c.headers) || !Array.isArray(c.roles) || c.headers.length !== c.roles.length || c.headers.length === 0 || c.headers.length > 200) return false;
  if (!c.headers.every((h) => typeof h === "string" && h.length <= 200)) return false;
  return c.roles.every((r) => {
    if (!r || typeof r !== "object") return false;
    const k = (r as { kind?: unknown }).kind;
    if (k === "year") return Object.keys(r).sort().join(",") === "fiscalYear,kind" && Number.isInteger((r as { fiscalYear?: unknown }).fiscalYear);
    return (k === "item" || k === "work" || k === "cycle" || k === "next" || k === "none") && Object.keys(r).length === 1;
  });
}

/** 様式の Excel に、行を見出しの行の下から写す（画面の見本と同じ写し方。ExcelJS の型だけを受け、ブラウザでも橋渡しでも使う） */
export async function fillTemplate(wb: { xlsx: { load(b: ArrayBuffer | Uint8Array): Promise<unknown>; writeBuffer(): Promise<ArrayBuffer | Uint8Array> }; worksheets: { getCell(r: number, c: number): { value: unknown } }[] }, bytes: ArrayBuffer | Uint8Array, columns: Pick<TemplateColumns, "headerRow" | "roles">, rows: readonly TemplateRow[]): Promise<Uint8Array> {
  await wb.xlsx.load(bytes);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("様式にシートが無い");
  rows.forEach((row, i) => {
    columns.roles.forEach((role, c) => {
      if (role.kind === "none") return;
      ws.getCell(columns.headerRow + 1 + i, c + 1).value = cellValue(role, row);
    });
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
