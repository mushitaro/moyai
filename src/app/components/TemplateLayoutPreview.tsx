// 列対応（案。仕事 template-layout-v1）の見本（docs/screens.md 3.5）：
// 案のとおりに版を様式に書いたブックを、様式の見た目のまま（結合・太字・背景・列の幅）表に描く。計画の表は見出しの下の明細の最初の 20 行と合計の行、
// 基本情報のシートは上から。列の上に列対応を読むだけの字で出し（← 項目・← 年度・← 周期・← 次回）、案が書くセルに色を付ける。
// 書かないもの・書けないものの数を添える（黙って捨てない）。説明の文は置かない（運営者 2026-11-10「引き算」）。
// 書くのは出力と同じ関数（plan/template-layout.ts の fillLayout）。出力・保存は人が主ボタンを押したときだけ（pages/Export.tsx）。
import { Group, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { patchedExcelJS } from "../../import/exceljs-setup";
import type { ChartCatalog } from "../../plan/chart";
import { colLetter, colNum, fillLayout, previewGrid, writtenCellsOf, type LayoutSummary, type PreviewGrid } from "../../plan/template-layout";
import type { Plan } from "../../shared/plan";
import type { TemplateLayout } from "../../shared/template-layout";
import { TEXT } from "../text";

const L = TEXT.export.template.layout;
const R = TEXT.export.template.role;
/** 計画の表の見本に出す明細の行の数 */
export const PREVIEW_DATA_ROWS = 20;
/** 基本情報のシートの見本に出す行の数 */
const FACILITY_ROWS = 30;

export type Built = { kind: "ready"; grids: PreviewGrid[]; summary: LayoutSummary } | { kind: "error"; message: string } | { kind: "reading" };

/** 案のとおりに書いたブックから、見本の格子と数を作る */
export async function buildPreview(bytes: Uint8Array, layout: TemplateLayout, input: { plan: Plan; catalog: ChartCatalog; asOf: string }): Promise<Built> {
  try {
    const wb = new (patchedExcelJS().Workbook)();
    await wb.xlsx.load(bytes.slice().buffer as ArrayBuffer);
    const { summary, rows } = fillLayout(wb, layout, input);
    const written = writtenCellsOf(layout, summary, rows, input.plan);
    const grids: PreviewGrid[] = [];
    for (const s of summary.sheets) {
      const g = previewGrid(wb, s.sheet, s.firstRow + PREVIEW_DATA_ROWS - 1, [s.totalRow], written.get(s.sheet) ?? new Set());
      if (g) grids.push(g);
    }
    if (layout.facility) {
      const g = previewGrid(wb, layout.facility.sheet, FACILITY_ROWS, [], written.get(layout.facility.sheet) ?? new Set());
      if (g) grids.unshift(g);
    }
    return { kind: "ready", grids, summary };
  } catch (e) {
    return { kind: "error", message: e instanceof Error ? e.message.split("\n").slice(0, 3).join("／") : String(e) };
  }
}

/** 列の字 → 列対応の字（読むだけ）：階層の列は「← 項目」、年度の列は「← 2026 年度」、周期・次回の列 */
export function layoutRoles(layout: TemplateLayout, summary: LayoutSummary, sheet: string): Map<string, string> {
  const m = new Map<string, string>();
  const s = layout.sheets.find((x) => x.sheet === sheet);
  if (!s) return m;
  for (const c of s.levels.columns) m.set(c.col, R.item);
  const years = summary.sheets.find((x) => x.sheet === sheet)?.yearOf ?? {};
  for (let i = colNum(s.years.from); i <= colNum(s.years.to); i++) {
    const fy = years[colLetter(i)];
    if (fy !== undefined) m.set(colLetter(i), R.fiscal(fy));
  }
  for (const g of s.group.rows) if (g.col) m.set(g.col, g.content === "cycle" ? R.cycle : R.next);
  return m;
}

function Grid({ g, roles }: { g: PreviewGrid; roles: Map<string, string> }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="moyai-num moyai-template moyai-layout-grid" data-testid="layout-grid" data-sheet={g.sheet}>
        <colgroup>
          <col style={{ width: 36 }} />
          {g.cols.map((c) => (
            <col key={c.letter} style={{ width: c.width }} />
          ))}
        </colgroup>
        <thead>
          {roles.size > 0 && (
            <tr>
              <th style={{ border: 0 }} />
              {g.cols.map((c) => (
                <th key={c.letter} className="moyai-template-role" style={{ border: 0 }} data-testid="layout-role">
                  {roles.get(c.letter) ?? ""}
                </th>
              ))}
            </tr>
          )}
          <tr>
            <th />
            {g.cols.map((c) => (
              <th key={c.letter} className="moyai-layout-colhead">
                {c.letter}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.n} data-row={r.n} data-gap={r.gap ? "true" : undefined}>
              <td className="moyai-layout-rowhead">{r.gap ? `…${r.n}` : r.n}</td>
              {r.cells.map((c, i) =>
                c === null ? null : (
                  <td
                    key={i}
                    colSpan={c.colSpan}
                    rowSpan={c.rowSpan}
                    data-written={c.written ? "true" : undefined}
                    data-formula={c.formula ? "true" : undefined}
                    style={{ fontWeight: c.bold ? 700 : undefined, background: c.written ? undefined : (c.fill ?? undefined), textAlign: c.align }}
                  >
                    {c.text}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 列対応の見本。draft は Claude が置いてまだ人が署名していない列対応 */
export function TemplateLayoutPreview({ bytes, layout, plan, catalog, asOf, draft }: { bytes: Uint8Array; layout: TemplateLayout; plan: Plan; catalog: ChartCatalog; asOf: string; draft: boolean }) {
  const [built, setBuilt] = useState<Built>({ kind: "reading" });
  useEffect(() => {
    let alive = true;
    setBuilt({ kind: "reading" });
    void buildPreview(bytes, layout, { plan, catalog, asOf }).then((b) => alive && setBuilt(b));
    return () => {
      alive = false;
    };
  }, [bytes, layout, plan, catalog, asOf]);
  return <LayoutPreviewView built={built} layout={layout} draft={draft} />;
}

/** 見本の描き方（作った見本を受けて描くだけ） */
export function LayoutPreviewView({ built, layout, draft }: { built: Built; layout: TemplateLayout; draft: boolean }) {
  const [sheet, setSheet] = useState<string | null>(null);
  if (built.kind === "reading") return <Text size="sm" c="dimmed">{L.reading}</Text>;
  if (built.kind === "error")
    return (
      <Text size="sm" c="var(--shu-text)" data-testid="layout-error">
        {L.invalid(built.message)}
      </Text>
    );
  const s = built.summary;
  const shown = built.grids.find((g) => g.sheet === sheet) ?? built.grids.find((g) => g.sheet === s.sheets[0]?.sheet) ?? built.grids[0];
  const notes = [
    s.outOfRange ? L.outOfRange(s.outOfRange) : null,
    s.amountMissing ? L.amountMissing(s.amountMissing) : null,
    s.taxMismatch ? L.taxMismatch(s.taxMismatch) : null,
    s.taxUnknown ? L.taxUnknown(s.taxUnknown) : null,
    s.namesWithoutColumn ? L.namesWithoutColumn(s.namesWithoutColumn) : null,
    s.levelsSkipped ? L.levelsSkipped(s.levelsSkipped) : null,
    s.orphans ? L.orphans(s.orphans) : null,
    layout.facility ? L.facility(s.facility.written, s.facility.missing.length) : null,
  ].filter((x): x is string => x !== null);
  return (
    <Stack gap="xs" data-testid="layout-preview" data-draft={draft ? "true" : undefined}>
      <Text size="xs" c="var(--text-2)">
        {L.unit(layout.amount.unit === "thousand_yen", layout.amount.tax)}
      </Text>
      {s.sheets.map((x) => (
        <Text key={x.sheet} size="xs" c="var(--text-2)" data-testid="layout-sheet-line">
          {L.sheetLine(x.sheet, x.rows, x.inserted, x.firstYear, x.lastYear)}
        </Text>
      ))}
      {notes.map((n) => (
        <Text key={n} size="xs" c="var(--text)" data-testid="layout-note">
          {n}
        </Text>
      ))}
      <Group gap="md" data-testid="layout-sheets">
        {built.grids.map((g) => (
          <button type="button" key={g.sheet} className="moyai-template-choice" data-active={g === shown ? "true" : undefined} onClick={() => setSheet(g.sheet)} style={{ padding: "2px 0 2px 8px" }}>
            {g.sheet}
          </button>
        ))}
      </Group>
      {shown && <Grid g={shown} roles={layoutRoles(layout, s, shown.sheet)} />}
    </Stack>
  );
}
