// 様式の写し方の案（TemplateLayout。仕事 template-layout-v1）と、Claude に返す様式の形（TemplateShape）の型。
// 見出しが 1 段で「1 行 1 作業」の平らな表（plan/template.ts の列の役目）では書けない様式のためのもの：
// 2 段の見出し、式で決まる年度の列、入れ子の縦の書き方、機器ごとの組の行（予定内容・予定金額…）、合計の行の前に足す明細、
// 年度で分かれる続きのシート、基本情報のシートの欄。
// 案は Claude が screen_set の templateLayout で置く。置いた案は下書きで、人が EXPORT の見本を見て「署名して出力」を押すまで使わない。
// 書くのは plan/template-layout.ts（純粋な関数。画面と橋渡しの両方で使う）。
import { z } from "zod";

export const LAYOUT_SCHEMA = "moyai.layout/0";

/** 列の字（A〜ZZZ） */
const col = z.string().regex(/^[A-Z]{1,3}$/);
/** セルの位置（A1 の形） */
const cell = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/);
const row = z.number().int().min(1).max(100_000);
const sheetName = z.string().min(1).max(31);

/**
 * 組の行の中身：年度の列に書くもの（予定内容・予定金額・実績内容・実績金額・星取）と、1 つの列に書くもの（周期・次回）。
 * 内容は作業の言い方（作業分類の名前か資料の作業の名前）、金額は明細の費用の和（金額の単位に合わせる。丸めない）、星取は ○ 計画・● 実績・◎ 両方
 */
export const GROUP_CONTENTS = ["plan_content", "plan_amount", "actual_content", "actual_amount", "marks", "cycle", "next"] as const;
export type GroupContent = (typeof GROUP_CONTENTS)[number];
/** 1 つの列に書く中身（col が要る） */
export const COLUMN_CONTENTS: readonly GroupContent[] = ["cycle", "next"];

/** 基本情報のシートに書ける施設の項目（計画の施設にあるものだけ。無い項目は書かずに数える） */
export const FACILITY_FIELDS = ["name", "scale", "scaleUnit", "scaleText", "fiscalYearStartMonth"] as const;
export type FacilityField = (typeof FACILITY_FIELDS)[number];

export const layoutPlanSheetSchema = z
  .object({
    sheet: sheetName.describe("計画の表のシートの名前"),
    headerRows: z.array(row).min(1).max(5).describe("見出しの行（1 から。2 段なら [7, 8]）"),
    years: z
      .object({
        row: row.describe("年度の見出しの行（字か式で年度が決まる行）"),
        from: col.describe("年度の列の左端"),
        to: col.describe("年度の列の右端"),
        startCell: cell.nullable().describe("開始年度のセル（ここに版の最初の年度を書き、年度の式が続く）。年度が見出しの字で決まるなら null"),
      })
      .strict(),
    levels: z
      .object({
        mode: z.enum(["nested", "flat"]).describe("nested は入れ子の縦の書き方（親の行の次の行に子を 1 つずつ）、flat は 1 行に横に並べる"),
        columns: z
          .array(z.object({ level: z.number().int().min(1).max(10).describe("計画の階層（1 から。intake_add_files の planLevels の順）"), col }).strict())
          .min(1)
          .max(10),
      })
      .strict(),
    group: z
      .object({
        labelCol: col.nullable().describe("組の行のラベルを書く列（記入区分など）。書かなければ null"),
        rows: z
          .array(
            z
              .object({
                label: z.string().max(40).describe("ラベルの列に書く字（「予定内容」など）"),
                content: z.enum(GROUP_CONTENTS),
                col: col.nullable().describe("cycle と next を書く列。年度の列に書く中身では null"),
              })
              .strict(),
          )
          .min(1)
          .max(8),
      })
      .strict(),
    insertBefore: row.describe("明細を足す位置：合計の行（この行の前の空行に書き、足りなければ行を足して合計の行を下へずらす）"),
    continues: sheetName.nullable().describe("年度で分かれる続きのシートなら、前のシートの名前（行の並びは前のシートと同じ）。最初のシートは null"),
  })
  .strict();

export const templateLayoutSchema = z
  .object({
    schema: z.literal(LAYOUT_SCHEMA),
    levelOrder: z.enum(["asset-first", "series-first"]).describe("階層の並び（asset-first 設備 › 機器 › 号炉・系統 › 部位、series-first 設備 › 号炉・系統 › 機器 › 部位）"),
    startYear: z.number().int().min(1900).max(2200).nullable().describe("開始年度のセルに書く年度。null は版の最初の年度"),
    amount: z
      .object({
        unit: z.enum(["yen", "thousand_yen"]).describe("金額の単位（円か千円。千円は円 ÷ 1000 で丸めない）"),
        tax: z.enum(["incl", "excl", "unknown"]).describe("様式の金額の税（税込・税抜・書いていない）。違う税の明細は換算せずに数える"),
      })
      .strict(),
    sheets: z.array(layoutPlanSheetSchema).min(1).max(10),
    facility: z
      .object({
        sheet: sheetName,
        cells: z.array(z.object({ field: z.enum(FACILITY_FIELDS), cell }).strict()).max(40),
      })
      .strict()
      .nullable()
      .describe("基本情報のシートの欄（施設の項目 → セル）。無ければ null"),
  })
  .strict();

export type TemplateLayout = z.infer<typeof templateLayoutSchema>;
export type LayoutPlanSheet = z.infer<typeof layoutPlanSheetSchema>;

/** screen_set の templateLayout：どの様式（intake_add_files の template.name）に置く案か ＋ 写し方 */
export const templateLayoutInputSchema = templateLayoutSchema.extend({ template: z.string().min(1).max(80).describe("intake_add_files（source: template）が返した様式の名前") }).strict();
export type TemplateLayoutInput = z.infer<typeof templateLayoutInputSchema>;

// ─── Claude に返す様式の形（intake_add_files の source: template）────────────────
// 形だけ：シートの名前・大きさ、字のあるセルの位置と字（見出し・ラベル・注記）、結合、式のあるセルの位置（年度の参照の式だけ中身を添える）。
// 値の入ったデータの行（年度らしくない数・日付のある行と、その間の行）は、字を返さずに行の範囲とセルの数だけを返す。

/** 1 つのシートに返す字のセルの上限（越えた分は数だけ） */
export const SHAPE_MAX_TEXT_CELLS = 600;
/** 1 つのシートに返す式のセルの上限 */
export const SHAPE_MAX_FORMULAS = 300;
/** 1 つのシートに返す結合の上限 */
export const SHAPE_MAX_MERGES = 300;
/** 1 つのセルの字の上限（越えたら切る） */
export const SHAPE_TEXT_MAX = 120;
/** 読むシートの数の上限 */
export const SHAPE_MAX_SHEETS = 20;

export const templateShapeSchema = z
  .object({
    name: z.string().min(1).max(80),
    sheets: z
      .array(
        z
          .object({
            name: z.string(),
            rows: z.number().int().min(0),
            cols: z.number().int().min(0),
            texts: z.array(z.object({ cell: z.string(), text: z.string().max(SHAPE_TEXT_MAX) }).strict()).max(SHAPE_MAX_TEXT_CELLS),
            textsTotal: z.number().int().min(0),
            merges: z.array(z.string()).max(SHAPE_MAX_MERGES),
            formulas: z
              .array(
                z
                  .object({
                    cell: z.string(),
                    /** 年度の参照の式（=G6・=G8+1・='前のシート'!O8+1 の形と、IF(ISNUMBER(前!$D$6),前!$D$6+1,"") のように包んだ形）なら、参照するセルと足す数。ほかの式は null */
                    yearRef: z.object({ sheet: z.string().nullable(), cell: z.string(), add: z.number().int() }).strict().nullable(),
                  })
                  .strict(),
              )
              .max(SHAPE_MAX_FORMULAS),
            formulasTotal: z.number().int().min(0),
            /** 値の入ったデータの行（字を返さない）：行の範囲と、値のあるセルの数 */
            dataRows: z.object({ from: z.number().int(), to: z.number().int(), cells: z.number().int().min(0) }).strict().nullable(),
          })
          .strict(),
      )
      .max(SHAPE_MAX_SHEETS),
    sheetsTotal: z.number().int().min(0),
  })
  .strict();
export type TemplateShape = z.infer<typeof templateShapeSchema>;
