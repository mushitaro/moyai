// MERGE のシート「決定」（docs/screens.md 3.2・docs/plan.md §2.9）：Claude が決めたことと、会話から写した人の答え。受けるまで、版は確定できない。
// - 当てはめの案（Claude が置いた規則）：1 規則 1 行。受ける・断るは今の当てはめの欄（CrosswalkPanel）のまま。
// - Claude の決定・会話から写した答え：1 行ずつ、一言の理由を書いて受ける。上の「まとめて受ける」は、1 つの理由で受けていないもの全部を受ける。
// 受けた決定はこのタブのメモリ（state/decisions.ts）に持ち、署名のダイアログがそこから読んで送る。
import { Alert, Badge, Button, Group, ScrollArea, Stack, Table, Text, TextInput } from "@mantine/core";
import { useMemo, useState } from "react";
import { pendingDecisions, type Decision } from "../../plan/diff";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { acceptDecision, isAccepted, unacceptDecision, useAccepted } from "../state/decisions";
import { HUMAN_TEXT, TEXT } from "../text";
import { CrosswalkPanel } from "./CrosswalkPanel";
import { usePlanStatus } from "./ConfirmDialog";

const T = HUMAN_TEXT.decisions;
const C = HUMAN_TEXT.confirm;

/** 受けていない決定（版の履歴で受けたものを除く）。署名のダイアログと下の帯も同じ数を使う */
export function usePending(client: BridgeClient, plan: Plan | null): { pending: Decision[]; ready: boolean } {
  const [load] = usePlanStatus(client, plan?.planId ?? "", !!plan);
  const status = load.kind === "ready" ? load.status : null;
  const pending = useMemo(() => (plan && status ? pendingDecisions(plan, status.accepted ?? []) : []), [plan, status]);
  return { pending, ready: !!status };
}

export function DecisionsSheet({ client, plan }: { client: BridgeClient; plan: Plan }) {
  const { pending } = usePending(client, plan);
  const accepted = useAccepted();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState("");
  const catalog = useMemo(() => catalogFor(plan.packId), [plan.packId]);
  const itemName = (code: string) => catalog?.items.get(code)?.name ?? catalog?.systems.get(code)?.name ?? code;
  const attrName = (code: string) => ((catalog ?? emptyCatalog()).workLabels as Record<string, string>)[code] ?? code;
  const left = pending.filter((d) => !accepted.has(`${d.id}\u0000${d.hash}`));
  const what = (d: Decision) => {
    if (d.kind === "detail") {
      const [pa, fy] = d.value.split(":");
      return `${d.target} · ${C.pendingValue[pa ?? ""] ?? ""} · ${C.pendingFiscal(fy ?? "")}`;
    }
    return `${d.target} → ${d.kind === "attribute" ? attrName(d.value) : itemName(d.value)}`;
  };
  const acceptAll = () => {
    for (const d of left) acceptDecision(d.id, d.hash, bulk);
    setBulk("");
  };

  return (
    <Stack gap="md" p="md" data-testid="decisions-sheet">
      <Text size="sm">{T.lead}</Text>

      <Stack gap="xs" data-testid="decisions-crosswalk">
        <Text fw={700}>{T.crosswalkTitle}</Text>
        <CrosswalkPanel />
      </Stack>

      <Stack gap="xs">
        <Group justify="space-between" align="flex-end" wrap="nowrap">
          <Text fw={700}>{T.title(left.length)}</Text>
          {left.length > 0 && (
            <Group gap="sm" align="flex-end" wrap="nowrap">
              <TextInput size="xs" w={320} label={T.bulkReason} value={bulk} onChange={(e) => setBulk(e.currentTarget.value)} maxLength={500} data-testid="decisions-bulk-reason" />
              {bulk.trim().length === 0 && (
                <Text size="xs" c="dimmed">
                  {T.bulkNeedsReason}
                </Text>
              )}
              <Button size="xs" variant="default" disabled={bulk.trim().length === 0} onClick={acceptAll} data-testid="decisions-bulk-accept">
                {T.bulkAccept}
              </Button>
            </Group>
          )}
        </Group>
        {pending.length === 0 ? (
          <Text size="sm" c="dimmed" data-testid="decisions-none">
            {T.none}
          </Text>
        ) : (
          <ScrollArea.Autosize mah={480}>
            <Table withTableBorder data-testid="decisions-table">
              <Table.Thead>
                <Table.Tr>
                  {T.head.map((h) => (
                    <Table.Th key={h}>{h}</Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {pending.map((d) => {
                  const done = isAccepted(d.id, d.hash);
                  const reason = reasons[d.id] ?? "";
                  return (
                    <Table.Tr key={d.id} data-testid="pending-row" data-accepted={done ? "true" : "false"}>
                      <Table.Td>
                        <Text size="sm">{what(d)}</Text>
                        <Text size="xs" c="var(--shu)">
                          {d.author === "ai_relayed_human" ? T.kind.relayed : T.kind.ai}
                        </Text>
                      </Table.Td>
                      <Table.Td>{d.basis}</Table.Td>
                      <Table.Td>
                        <Badge variant="outline" color="gray">
                          {d.author === "ai_relayed_human" ? T.by.relayed : TEXT.author[d.author]}
                        </Badge>
                      </Table.Td>
                      <Table.Td className="moyai-num">1</Table.Td>
                      <Table.Td>
                        {done ? (
                          <Group gap="xs" wrap="nowrap">
                            <Text size="xs" c="dimmed" data-testid="pending-accepted">
                              {T.accepted}
                            </Text>
                            <Button size="compact-xs" variant="subtle" onClick={() => unacceptDecision(d.id, d.hash)}>
                              {T.undo}
                            </Button>
                          </Group>
                        ) : (
                          <Group gap="xs" wrap="nowrap">
                            <TextInput
                              size="xs"
                              aria-label={`${T.reason} ${d.target}`}
                              placeholder={T.reason}
                              value={reason}
                              onChange={(e) => {
                                const v = e.currentTarget.value;
                                setReasons((s) => ({ ...s, [d.id]: v }));
                              }}
                              data-testid="pending-reason"
                            />
                            <Button
                              size="compact-sm"
                              variant="default"
                              disabled={reason.trim().length === 0}
                              title={reason.trim().length === 0 ? C.acceptNeedsReason : undefined}
                              onClick={() => acceptDecision(d.id, d.hash, reason)}
                              data-testid="pending-accept"
                            >
                              {C.accept}
                            </Button>
                          </Group>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </ScrollArea.Autosize>
        )}
        {left.length > 0 && (
          <Alert color="gray" p="xs" data-testid="decisions-left">
            {T.left(left.length)}
          </Alert>
        )}
      </Stack>
    </Stack>
  );
}
