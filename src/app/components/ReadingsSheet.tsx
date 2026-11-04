// MERGE のシート「読み方」（docs/screens.md 3.2・Wire のキャンバスの Reading.dc.html）：作業画面が当てている 3 段目の Skill（読み方）。
// 読み方ごとの見出しの行（名前・範囲・版・状態）と、1 規則 1 行（決まり・効く資料・効いたセル・決めた人・前の版から）。決まりの下に見本を 1 行。
// データは state/reading-tab.ts の readingTab()。承認済みのセルが変わる数は、版どうしのセルの差が要るので、まだ出さない（null のときは「―」）。
import { Stack, Table, Text } from "@mantine/core";
import { useMemo } from "react";
import type { IntakeWorkspace } from "../intake/workspace";
import { readingTab } from "../state/reading-tab";
import { HUMAN_TEXT } from "../text";

const T = HUMAN_TEXT.readings;
const fmt = (n: number) => n.toLocaleString("ja-JP");

/** 未承認の読み方の規則の数（シートのタブの「読み方 n」） */
export function unapprovedReadings(ws: IntakeWorkspace): number {
  if (!ws.fileCount || ws.currentReadings().length === 0) return 0;
  return readingTab(ws.currentReadings(), ws.analysis()).unapproved;
}

export function ReadingsSheet({ ws }: { ws: IntakeWorkspace }) {
  const tab = useMemo(() => (ws.fileCount ? readingTab(ws.currentReadings(), ws.analysis()) : { skills: [], unapproved: 0 }), [ws, ws.version]);
  return (
    <Stack gap="md" p="md" data-testid="readings-sheet">
      <Text size="sm">{T.lead}</Text>
      {tab.skills.length === 0 && (
        <Text size="sm" c="dimmed" data-testid="readings-none">
          {T.none}
        </Text>
      )}
      {tab.skills.map((k) => (
        <Stack key={k.name} gap={4} data-testid="reading-skill" data-status={k.status}>
          <Text fw={700}>
            {k.name}
            <Text span size="sm" c="dimmed">
              {T.scope[k.scope]}　{T.version(k.version)}
            </Text>
            {"　"}
            <Text span size="sm" c={k.status === "approved" ? "dimmed" : "var(--shu)"}>
              {k.status === "approved" ? T.approved(k.approvedIn) : T.status[k.status]}
            </Text>
          </Text>
          <Table withTableBorder>
            <Table.Thead>
              <Table.Tr>
                {T.head.map((h) => (
                  <Table.Th key={h}>{h}</Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {k.rules.map((r) => (
                <Table.Tr key={r.id} data-testid="reading-rule" data-change={r.change}>
                  <Table.Td>
                    <Text size="sm">{r.text}</Text>
                    {r.sample && (
                      <Text size="xs" c="dimmed">
                        {T.sample(r.sample.file, r.sample.ref, r.sample.text)}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>{r.appliesTo ?? T.anyFile}</Table.Td>
                  <Table.Td className="moyai-num" style={{ textAlign: "right" }}>
                    {fmt(r.hits)}
                  </Table.Td>
                  <Table.Td>{r.decidedBy.kind === "ai" ? T.byAi : (r.decidedBy.name ?? T.byHuman)}</Table.Td>
                  <Table.Td>
                    {r.change === "same" ? (
                      <Text span c="dimmed">
                        ―
                      </Text>
                    ) : (
                      <Text span c="var(--shu)">
                        {T.change[r.change]}
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Stack>
      ))}
      {tab.unapproved > 0 && (
        <Text size="sm" c="var(--shu)" data-testid="readings-unapproved">
          {T.unapproved(tab.unapproved)}
        </Text>
      )}
    </Stack>
  );
}
