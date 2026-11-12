// 様式の欄（docs/screens.md 3.5、運営者の決定 3C、Wire の ExportOne.dc.html）：様式の行（標準・差分・保存先の様式・Claude が入れた様式・＋ 様式を追加）と、
// 選んだ行で出力するものの見本。行が画面の唯一の選び。
// 列対応は読むだけ（運営者 2026-11-10「引き算」：画面で列ごとに直すメニューは外した）。決める・直すのは Claude（screen_set の templateLayout）。
// 様式と列対応は保存先に置く（橋渡しの template_save）。下書きの列対応は、その列対応で書き出した Excel に人が署名したとき承認される（export_sign。主ボタンは Export.tsx）。
// 様式の中身は AI に渡さない（例外：Claude が intake_add_files の source: template で入れた様式は、橋渡しが形だけを返す。仕事 template-layout-v1）。
import { Stack, Table, Text, FileButton } from "@mantine/core";
import { useMemo, useState } from "react";
import { patchedExcelJS } from "../../import/exceljs-setup";
import { cellValue, findHeaderRow, roleOfHeader, templateRows, COLUMNS_SCHEMA, type ColumnRole, type TemplateColumns, type TemplateRow } from "../../plan/template";
import type { Plan } from "../../shared/plan";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { undecidedOf } from "../state/export-reason";
import { TEXT } from "../text";

const T = TEXT.export.template;
const PREVIEW_ROWS = 4;
const HEAD_ROWS = 30;

/** 保存先の様式の 1 つ（橋渡しの templates_read） */
export interface SharedTemplate {
  name: string;
  version: string;
  current: boolean;
  columns: TemplateColumns;
  approval: { in: number; by: string; at: string } | null;
  /** この計画のいちばん新しい版で、もう署名して書き出したか */
  exported: boolean;
}

const roleKey = (r: ColumnRole) => (r.kind === "year" ? `year:${r.fiscalYear}` : r.kind);
const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));
export const templateKey = (t: Pick<SharedTemplate, "name" | "version">) => `${t.name}|${t.version}`;

export function roleLabel(r: ColumnRole): string {
  switch (r.kind) {
    case "item":
      return T.role.item;
    case "work":
      return T.role.work;
    case "cycle":
      return T.role.cycle;
    case "next":
      return T.role.next;
    case "year":
      return T.role.year(r.fiscalYear);
    default:
      return T.role.none;
  }
}

/** 確定した版の作業を、様式に写す行にする（機器 × 作業ごとに 1 行） */
export function rowsFor(plan: Plan, asOf: string): TemplateRow[] {
  const labels = (catalogFor(plan.packId) ?? emptyCatalog()).workLabels as Record<string, string>;
  return templateRows(plan, (a) => labels[a], asOf);
}

/** 様式を読む：最初のシートの見出しの行と、列ごとの役目（見出しの言葉から）。名前はファイルの名前から拡張子を除いたもの */
export async function readTemplate(f: File): Promise<{ ok: true; name: string; bytes: ArrayBuffer; columns: TemplateColumns } | { ok: false; message: string }> {
  try {
    const bytes = await f.arrayBuffer();
    const wb = new (patchedExcelJS().Workbook)();
    await wb.xlsx.load(bytes);
    const ws = wb.worksheets[0];
    if (!ws) return { ok: false, message: T.noSheet };
    const head: string[][] = [];
    for (let r = 1; r <= Math.min(HEAD_ROWS, ws.rowCount); r++) {
      const row = ws.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= Math.max(1, ws.columnCount); c++) cells.push(String(row.getCell(c).text ?? "").trim());
      head.push(cells);
    }
    const h = findHeaderRow(head);
    const headers = head[h] ?? [];
    while (headers.length && headers.at(-1) === "") headers.pop();
    if (headers.length === 0) return { ok: false, message: T.noHeader };
    return { ok: true, name: f.name.replace(/\.xls[xm]?$/i, ""), bytes, columns: { schema: COLUMNS_SCHEMA, headerRow: h + 1, headers, roles: headers.map(roleOfHeader) } };
  } catch {
    return { ok: false, message: T.unreadable };
  }
}

/** 保存先の様式の行の状態の字（右に出す。出力済み・承認済みか列対応の下書き・未定） */
export function sharedState(t: SharedTemplate, claude: boolean): string {
  const s: string[] = [];
  // Claude の案は、まだ出力していない列対応（前の列対応の「出力済み」は出さない）
  if (t.exported && !claude) s.push(T.exported);
  if (claude) s.push(T.draft);
  else if (t.approval) s.push(T.approved(t.approval.in, t.approval.by));
  else {
    const n = undecidedOf(t.columns);
    s.push(n > 0 ? T.undecided(n) : T.draft);
  }
  return s.join("　");
}

/**
 * 様式の行（縦の並び：標準・差分・保存先の様式〔右に状態〕・Claude が入れた様式・＋ 様式を追加）と、選んだ様式の見本。
 * onDrop：追加した様式を保存先に置く（下書き）
 */
export function TemplateExport({
  plan,
  asOf,
  templates,
  selected,
  onSelect,
  onDrop,
  standardExported,
  diff = null,
  onSelectDiff,
  pending = [],
  pendingSel = null,
  onSelectPending,
  draftNames,
  layoutView = null,
}: {
  plan: Plan;
  /** 次回の基準日（版を確定した日。橋渡しが署名して書き出すときと同じ日） */
  asOf: string;
  templates: readonly SharedTemplate[];
  /** 選んだ保存先の様式（null は標準・差分・Claude が入れた様式） */
  selected: SharedTemplate | null;
  onSelect: (t: SharedTemplate | null) => void;
  onDrop: (f: File) => Promise<string | null>;
  /** 標準の書き出しがあるか（確定の署名で書き出している） */
  standardExported: boolean;
  /** 差分の行（前の確定版があるときだけ）：前の版の番号・選んでいるか・この画面で出力したか */
  diff?: { from: number; active: boolean; exported: boolean } | null;
  onSelectDiff?: () => void;
  /** Claude が入れて、まだ保存していない様式 */
  pending?: readonly { name: string; hasDraft: boolean }[];
  pendingSel?: string | null;
  onSelectPending?: (name: string) => void;
  /** Claude が列対応を置いた、保存先の様式の名前 */
  draftNames?: ReadonlySet<string>;
  /** Claude の列対応か保存した列対応（案）のある様式の見本（列の役目の表の代わり） */
  layoutView?: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => rowsFor(plan, asOf), [plan, asOf]);

  const pick = async (f: File | null) => {
    if (!f) return;
    setError(await onDrop(f));
  };
  // 選べる行が標準の 1 つだけのときは、選びにしない（押せない行。見た目は選んだ行のまま）。選ぶものが無いので、押せるものを置かない（シナリオ D1、docs/screens.md §0 の引き算）
  const only = !diff && templates.length === 0 && pending.length === 0;
  const row = (key: string, active: boolean, onClick: () => void, name: string, state: string, tag: boolean, testid: string) => {
    const inner = (
      <>
      <span className="moyai-template-choice-name">{name}</span>
      <span className="moyai-template-choice-state">
        {state && (
          <Text span size="xs" c="var(--text-3)" data-testid="template-state">
            {state}
          </Text>
        )}
        {tag && (
          <span className="moyai-template-choice-tag" data-testid="template-claude">
            {T.claude}
          </span>
        )}
      </span>
      </>
    );
    if (only)
      return (
        <div key={key} className="moyai-template-choice" data-active="true" data-testid={testid}>
          {inner}
        </div>
      );
    return (
      <button type="button" key={key} className="moyai-template-choice" data-active={active ? "true" : undefined} aria-pressed={active} onClick={onClick} data-testid={testid}>
        {inner}
      </button>
    );
  };
  const columns = selected?.columns ?? null;

  return (
    <Stack gap="sm" data-testid="template-export">
      <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
        {T.label}
      </Text>
      <div className="moyai-template-choices" data-testid="template-choices">
        {row("standard", selected === null && pendingSel === null && !diff?.active, () => onSelect(null), T.standard, standardExported ? T.exported : "", false, "template-standard")}
        {diff && row("diff", diff.active, () => onSelectDiff?.(), T.diff(diff.from), diff.exported ? T.exported : "", false, "export-report")}
        {templates.map((t) => {
          const claude = !!draftNames?.has(t.name) && t.current;
          return row(templateKey(t), !!selected && templateKey(selected) === templateKey(t), () => onSelect(t), t.name, sharedState(t, claude), claude, "template-shared");
        })}
        {pending.map((p) => row(`pending|${p.name}`, pendingSel === p.name, () => onSelectPending?.(p.name), p.name, p.hasDraft ? T.draft : T.undecided(null), true, "template-pending"))}
        <FileButton accept=".xlsx,.xlsm" onChange={(f) => void pick(f)}>
          {(props) => (
            <button type="button" className="moyai-inline-act" {...props} data-testid="template-pick">
              {T.pick}
            </button>
          )}
        </FileButton>
      </div>
      {error && (
        <Text size="sm" c="var(--shu-text)" data-testid="template-error">
          {error}
        </Text>
      )}
      {layoutView}
      {!layoutView && selected && columns && (
        <div style={{ overflowX: "auto" }}>
          <Table withColumnBorders fz="xs" verticalSpacing={8} horizontalSpacing={12} className="moyai-num moyai-template" data-testid="template-preview" style={{ width: "max-content" }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th style={{ border: 0 }} />
                {columns.roles.map((r, i) => (
                  // 列対応は読むだけの字（未定は朱）
                  <Table.Th key={i} className="moyai-template-role" data-testid="template-role" data-role={roleKey(r)} data-none={r.kind === "none" ? "true" : undefined}>
                    {roleLabel(r)}
                  </Table.Th>
                ))}
              </Table.Tr>
              <Table.Tr>
                <Table.Th />
                {columns.headers.map((_, i) => (
                  <Table.Th key={i} c="dimmed">
                    {colLetter(i)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td c="dimmed">{columns.headerRow}</Table.Td>
                {columns.headers.map((h, i) => (
                  <Table.Td key={i} fw={500}>
                    {h}
                  </Table.Td>
                ))}
              </Table.Tr>
              {rows.slice(0, PREVIEW_ROWS).map((row, j) => (
                <Table.Tr key={j} data-testid="template-row">
                  <Table.Td c="dimmed">{columns.headerRow + 1 + j}</Table.Td>
                  {columns.roles.map((r, i) => (
                    <Table.Td key={i}>{String(cellValue(r, row))}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </div>
      )}
    </Stack>
  );
}
