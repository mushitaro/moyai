// 様式に写す（docs/screens.md 3.5、P2 の 7、絵は Export.dc.html）：利用者が落とした様式（Excel）の見出しの行を読み、列ごとに写すもの
// （← 項目・← 作業・← 周期・← 年度の印・- 写すものが未定）を出す。落とすのは EXPORT の下の帯の「Excel を落とす」1 つだけで、
// 様式を選んでいればこの様式に写した Excel、選んでいなければ MOYAI の標準（Export.tsx）。
// 様式は、このタブのメモリだけで読む（保管先にも AI にも渡さない）。列の役目は見出しの言葉から決め、違えば人が列ごとに直す。
import { Button, Group, Menu, Stack, Table, Text, FileButton } from "@mantine/core";
import { useMemo, useState } from "react";
import { patchedExcelJS } from "../../import/exceljs-setup";
import { cellValue, findHeaderRow, roleOfHeader, templateRows, type ColumnRole, type TemplateRow } from "../../plan/template";
import type { Plan } from "../../shared/plan";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { TEXT } from "../text";

const T = TEXT.export.template;
const PREVIEW_ROWS = 4;
const HEAD_ROWS = 30;

export interface LoadedTemplate {
  name: string;
  bytes: ArrayBuffer;
  /** 見出しの行（1 から数える Excel の行） */
  headerRow: number;
  headers: string[];
  roles: ColumnRole[];
}

const roleKey = (r: ColumnRole) => (r.kind === "year" ? `year:${r.fiscalYear}` : r.kind);
const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

function roleLabel(r: ColumnRole): string {
  switch (r.kind) {
    case "item":
      return T.role.item;
    case "work":
      return T.role.work;
    case "cycle":
      return T.role.cycle;
    case "year":
      return T.role.year(r.fiscalYear);
    default:
      return T.role.none;
  }
}

/** 確定した版の作業を、様式に写す行にする（機器 × 作業ごとに 1 行） */
export function rowsFor(plan: Plan): TemplateRow[] {
  const labels = (catalogFor(plan.packId) ?? emptyCatalog()).workLabels as Record<string, string>;
  return templateRows(plan, (a) => labels[a]);
}

/** 様式を読む：最初のシートの見出しの行と、列ごとの役目（見出しの言葉から） */
export async function readTemplate(f: File): Promise<{ ok: true; t: LoadedTemplate } | { ok: false; message: string }> {
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
    return { ok: true, t: { name: f.name, bytes, headerRow: h + 1, headers, roles: headers.map(roleOfHeader) } };
  } catch {
    return { ok: false, message: T.unreadable };
  }
}

/** 様式に写した Excel を落とす（人が「Excel を落とす」を押したときだけ） */
export async function downloadTemplate(t: LoadedTemplate, plan: Plan, version: number): Promise<void> {
  const wb = new (patchedExcelJS().Workbook)();
  await wb.xlsx.load(t.bytes);
  const ws = wb.worksheets[0]!;
  rowsFor(plan).forEach((row, i) => {
    t.roles.forEach((role, c) => {
      if (role.kind === "none") return;
      ws.getCell(t.headerRow + 1 + i, c + 1).value = cellValue(role, row);
    });
  });
  const out = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = T.fileName(t.name.replace(/\.xlsx?$/i, ""), plan.displayName, version);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 様式の行（様式の名前・別の様式を落とす・標準の様式に戻す）と、様式を選んでいるときの見本 */
export function TemplateExport({ plan, template, onTemplate }: { plan: Plan; template: LoadedTemplate | null; onTemplate: (t: LoadedTemplate | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => rowsFor(plan), [plan]);

  const pick = async (f: File | null) => {
    if (!f) return;
    const r = await readTemplate(f);
    if (!r.ok) return setError(r.message);
    setError(null);
    onTemplate(r.t);
  };
  const setRole = (i: number, key: string) => {
    if (!template) return;
    const fy = /^year:(\d+)$/.exec(key);
    const r: ColumnRole = fy ? { kind: "year", fiscalYear: Number(fy[1]) } : ({ kind: key } as ColumnRole);
    onTemplate({ ...template, roles: template.roles.map((x, j) => (j === i ? r : x)) });
  };

  return (
    <Stack gap="sm" data-testid="template-export">
      <Group gap="md" align="center" wrap="wrap">
        <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
          {T.label}
        </Text>
        <Text size="sm" data-testid="template-name">
          {template ? template.name : T.standard}
        </Text>
        {template && (
          <Text size="xs" c="dimmed">
            {T.yours}
          </Text>
        )}
        <FileButton accept=".xlsx,.xlsm" onChange={(f) => void pick(f)}>
          {(props) => (
            <Button variant="default" size="xs" {...props} data-testid="template-pick">
              {T.pick}
            </Button>
          )}
        </FileButton>
        {template && (
          <Button variant="default" size="xs" onClick={() => onTemplate(null)} data-testid="template-reset">
            {T.reset}
          </Button>
        )}
      </Group>
      {error && (
        <Text size="sm" c="var(--shu-text)" data-testid="template-error">
          {error}
        </Text>
      )}
      {template && (
        <div style={{ overflowX: "auto" }}>
          <Table withColumnBorders fz="xs" verticalSpacing={8} horizontalSpacing={12} className="moyai-num moyai-template" data-testid="template-preview" style={{ width: "max-content" }}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th />
                {template.roles.map((r, i) => {
                  const fy = template.headers[i] ? roleOfHeader(template.headers[i]!) : { kind: "none" as const };
                  const choices: { value: string; label: string }[] = [
                    { value: "item", label: T.role.item },
                    { value: "work", label: T.role.work },
                    { value: "cycle", label: T.role.cycle },
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
                {template.headers.map((_, i) => (
                  <Table.Th key={i} c="dimmed">
                    {colLetter(i)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              <Table.Tr>
                <Table.Td c="dimmed">{template.headerRow}</Table.Td>
                {template.headers.map((h, i) => (
                  <Table.Td key={i} fw={500}>
                    {h}
                  </Table.Td>
                ))}
              </Table.Tr>
              {rows.slice(0, PREVIEW_ROWS).map((row, j) => (
                <Table.Tr key={j} data-testid="template-row">
                  <Table.Td c="dimmed">{template.headerRow + 1 + j}</Table.Td>
                  {template.roles.map((r, i) => (
                    <Table.Td key={i}>{String(cellValue(r, row))}</Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <Text size="xs" c="dimmed" mt={4} data-testid="template-count">
            {T.count(rows.length)}
          </Text>
        </div>
      )}
    </Stack>
  );
}
