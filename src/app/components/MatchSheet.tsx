// MERGE のシート「突き合せ」（docs/screens.md 3.2、絵は Match.dc.html）：資料ごとの書き方を並べ、「✓ 一致」「! 片方だけ」「× 食い違い」。
// 切り替えは「食い違い n / 片方だけ n / すべて n」（最初は、食い違いがあれば食い違い、無ければ片方だけ、それも無ければすべて）。
// 中身は取り込みの作業場（このタブのメモリ）の結び方から作る（src/import/match.ts）。資料がこのタブに無ければ、そう出す。
import { Table, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { matchRows, type MatchResult, type MatchRow } from "../../import/match";
import type { IntakeWorkspace } from "../intake/workspace";
import { TEXT } from "../text";
import { Switch } from "./Switch";

const T = TEXT.match;
const SHOWN_MAX = 500;

type Filter = "diff" | "one" | "all";

function resultText(r: MatchRow): string {
  if (r.result === "ok") return T.ok;
  if (r.result === "diff") return T.diff;
  return T.only(r.onlyIn ?? "");
}
const resultColor = (k: MatchResult) => (k === "diff" ? "var(--shu-text)" : k === "one" ? "var(--text-2)" : "var(--text-3)");

export function MatchSheet({ ws }: { ws: IntakeWorkspace }) {
  const an = ws.fileCount ? ws.analysis() : null;
  const m = useMemo(() => (an ? matchRows(an.linked, T.noDate) : null), [an]);
  const first: Filter = m && m.counts.diff > 0 ? "diff" : m && m.counts.one > 0 ? "one" : "all";
  const [filter, setFilter] = useState<Filter | null>(null);
  const f = filter ?? first;
  if (!m) {
    return (
      <Text size="sm" c="dimmed" px={32} py="md" data-testid="match-none">
        {T.noFiles}
      </Text>
    );
  }
  const rows = f === "all" ? m.rows : m.rows.filter((r) => r.result === f);
  return (
    <div style={{ padding: "8px 32px 32px" }} data-testid="match-sheet">
      <Switch<Filter>
        aria-label={T.filterLabel}
        value={f}
        onChange={setFilter}
        data-testid="match-filter"
        data={[
          { value: "diff", label: T.filterDiff(m.counts.diff) },
          { value: "one", label: T.filterOne(m.counts.one) },
          { value: "all", label: T.filterAll(m.rows.length) },
        ]}
      />
      <div style={{ overflowX: "auto", marginTop: 8 }}>
        <Table verticalSpacing={6} fz="sm" data-testid="match-table" style={{ minWidth: 760 }}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{T.head}</Table.Th>
              {m.files.map((file) => (
                <Table.Th key={file} ta="center">
                  {file}
                </Table.Th>
              ))}
              <Table.Th>{T.resultHead}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.slice(0, SHOWN_MAX).map((r) => (
              <Table.Tr key={r.id} data-testid="match-row" data-result={r.result}>
                <Table.Td>{T.item(r.machine, r.work, r.fiscalYear)}</Table.Td>
                {m.files.map((file) => (
                  <Table.Td key={file} ta="center" className="moyai-num" c="var(--text-2)">
                    {r.cells[file] ?? T.none}
                  </Table.Td>
                ))}
                <Table.Td c={resultColor(r.result)}>{resultText(r)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      {rows.length > SHOWN_MAX && (
        <Text size="xs" c="dimmed" mt="xs">
          {T.more(rows.length - SHOWN_MAX)}
        </Text>
      )}
    </div>
  );
}
