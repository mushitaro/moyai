// 様式で書き出す（docs/screens.md 3.5、運営者の決定 3C、Wire の Export.dc.html V48・V50）：様式の選び（標準・保存先の様式・＋ 様式を落とす）と、
// 様式を選んでいるときの見本（列の見出しの上の役目を、人が列ごとに直せる）。
// 様式と写し方（列の役目）は保存先に置く（橋渡しの template_save）。直すと、その写し方は下書きになる。
// 下書きの写し方は、その写し方で書き出した Excel に人が署名したとき承認される（export_sign。主ボタンは Export.tsx）。
// 様式の中身は AI に渡さない（例外：Claude が intake_add_files の source: template で入れた様式は、橋渡しが形だけを返す。仕事 template-layout-v1）。
// Claude が入れてまだ保存していない様式は「未保存」の行で並び、写し方の案（layout）のある様式は、列の役目の表の代わりに案の見本（TemplateLayoutPreview）を出す。
import { Stack, Table, Text, FileButton, Menu } from "@mantine/core";
import { useMemo, useState } from "react";
import { patchedExcelJS } from "../../import/exceljs-setup";
import { cellValue, findHeaderRow, roleOfHeader, templateRows, COLUMNS_SCHEMA, type ColumnRole, type TemplateColumns, type TemplateRow } from "../../plan/template";
import type { Plan } from "../../shared/plan";
import { catalogFor, emptyCatalog } from "../chart/catalog";
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

function roleLabel(r: ColumnRole): string {
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

/**
 * 様式の選び（縦の並び：標準・保存先の様式〔右に状態〕・＋ 様式を落とす）と、選んだ様式の見本。
 * onDrop：落とした様式を保存先に置く。onRoles：列の役目を直した写し方を、同じ名前の下書きとして置く
 */
export function TemplateExport({
  plan,
  asOf,
  templates,
  selected,
  onSelect,
  onDrop,
  onRoles,
  standardExported,
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
  selected: SharedTemplate | null;
  onSelect: (t: SharedTemplate | null) => void;
  onDrop: (f: File) => Promise<string | null>;
  onRoles: (t: SharedTemplate, columns: TemplateColumns) => void;
  /** 標準の書き出しがあるか（確定の署名で書き出している） */
  standardExported: boolean;
  /** Claude が入れて、まだ保存していない様式 */
  pending?: readonly { name: string; hasDraft: boolean }[];
  pendingSel?: string | null;
  onSelectPending?: (name: string) => void;
  /** 写し方の案（下書き）のある様式の名前 */
  draftNames?: ReadonlySet<string>;
  /** 写し方の案のある様式を選んでいるときの見本（列の役目の表の代わり） */
  layoutView?: React.ReactNode;
}) {
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => rowsFor(plan, asOf), [plan, asOf]);

  const pick = async (f: File | null) => {
    if (!f) return;
    setError(await onDrop(f));
  };
  const setRole = (i: number, key: string) => {
    if (!selected) return;
    const fy = /^year:(\d+)$/.exec(key);
    const r: ColumnRole = fy ? { kind: "year", fiscalYear: Number(fy[1]) } : ({ kind: key } as ColumnRole);
    onRoles(selected, { ...selected.columns, roles: selected.columns.roles.map((x, j) => (j === i ? r : x)) });
  };
  const row = (key: string, active: boolean, onClick: () => void, name: string, right: React.ReactNode, testid: string) => (
    <button type="button" key={key} className="moyai-template-choice" data-active={active ? "true" : undefined} onClick={onClick} data-testid={testid}>
      <span className="moyai-template-choice-name">{name}</span>
      <span className="moyai-template-choice-state">{right}</span>
    </button>
  );
  const columns = selected?.columns ?? null;

  return (
    <Stack gap="sm" data-testid="template-export">
      <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
        {T.label}
      </Text>
      <div className="moyai-template-choices" data-testid="template-choices">
        {row(
          "standard",
          selected === null && pendingSel === null,
          () => onSelect(null),
          T.standard,
          standardExported ? (
            <Text span size="xs" c="var(--text-2)" data-testid="template-exported">
              {T.exported}
            </Text>
          ) : null,
          "template-standard",
        )}
        {templates.map((t) =>
          row(
            templateKey(t),
            !!selected && templateKey(selected) === templateKey(t),
            () => onSelect(t),
            t.name,
            <>
              {draftNames?.has(t.name) && (
                <Text span size="xs" c="var(--shu-text)" mr="sm" data-testid="template-layout-draft">
                  {T.layout.draft}
                </Text>
              )}
              {t.exported && (
                <Text span size="xs" c="var(--text-2)" mr="sm" data-testid="template-exported">
                  {T.exported}
                </Text>
              )}
              {t.approval ? (
                <Text span size="xs" c="var(--text-2)">
                  {T.approved(t.approval.in, t.approval.by)}
                </Text>
              ) : (
                <Text span size="xs" c="var(--text-3)">
                  {T.draft}
                </Text>
              )}
            </>,
            "template-shared",
          ),
        )}
        {pending.map((p) =>
          row(
            `pending|${p.name}`,
            pendingSel === p.name,
            () => onSelectPending?.(p.name),
            p.name,
            <>
              {p.hasDraft && (
                <Text span size="xs" c="var(--shu-text)" mr="sm" data-testid="template-layout-draft">
                  {T.layout.draft}
                </Text>
              )}
              <Text span size="xs" c="var(--text-3)">
                {T.layout.pending}
              </Text>
            </>,
            "template-pending",
          ),
        )}
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
                <Table.Th />
                {columns.roles.map((r, i) => {
                  const fy = columns.headers[i] ? roleOfHeader(columns.headers[i]!) : { kind: "none" as const };
                  const choices: { value: string; label: string }[] = [
                    { value: "item", label: T.role.item },
                    { value: "work", label: T.role.work },
                    { value: "cycle", label: T.role.cycle },
                    { value: "next", label: T.role.next },
                    ...(fy.kind === "year" ? [{ value: `year:${fy.fiscalYear}`, label: T.role.year(fy.fiscalYear) }] : []),
                    { value: "none", label: T.role.none },
                  ];
                  return (
                    <Table.Th key={i} data-testid="template-role" data-role={roleKey(r)}>
                      {/* 箱の無い 11px の字。押すと選ぶ欄が開く（字は切らず、長ければ折る） */}
                      <Menu position="bottom-start" withinPortal>
                        <Menu.Target>
                          <button type="button" className="moyai-template-role" data-none={r.kind === "none" ? "true" : undefined} aria-label={T.roleOf(colLetter(i))}>
                            {roleLabel(r)}
                          </button>
                        </Menu.Target>
                        <Menu.Dropdown>
                          {choices.map((c) => (
                            <Menu.Item key={c.value} onClick={() => setRole(i, c.value)} data-testid="template-role-item" data-value={c.value}>
                              {c.label}
                            </Menu.Item>
                          ))}
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Th>
                  );
                })}
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
