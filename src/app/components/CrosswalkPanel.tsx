// 当てはめの欄（docs/plan.md §2.1・§2.9）：AI が置いた規則の案を、人が規則ごとに一言の理由で受けるか断る。人が直に当てることもできる。
// 受けた当てはめだけが星取表の共通の設備項目の行に入り、共有に写る。未当てはめの数を出す。
// ここは人の画面だけの道（state/crosswalk.ts の acceptByHuman・rejectByHuman・setByHuman）で、AI のツールからは届かない。
// 断るのは案を捨てる操作なので、確かめのダイアログを通す（window.confirm は使わない）。
import { Alert, Badge, Button, Group, Modal, ScrollArea, Select, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { Switch } from "./Switch";
import { useMemo, useState } from "react";
import { crosswalkSummary, heldRows, nodeRef, workRef, type CrosswalkProposal, type CrosswalkTarget } from "../../plan/crosswalk";
import { WORK_ATTRIBUTES, type Plan } from "../../shared/plan";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { acceptByHuman, rejectByHuman, setByHuman, valueLabel } from "../state/crosswalk";
import { useWorkingPlan } from "../state/plan-store";
import { TEXT } from "../text";

const C = TEXT.crosswalk;
const EXAMPLES_SHOWN = 3;
const CLEAR = "-";

/** 行の参照 → 画面の名前（節は段の道、作業は対象と名前） */
function useNames(plan: Plan): (ref: string) => string {
  return useMemo(() => {
    const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
    const pathOf = (key: string): string => {
      const out: string[] = [];
      const seen = new Set<string>();
      for (let a = assets.get(key); a && !seen.has(a.nodeKey); a = a.parentKey ? assets.get(a.parentKey) : undefined) {
        seen.add(a.nodeKey);
        out.unshift(a.name);
      }
      return out.join(TEXT.chart.pathSep) || key;
    };
    const works = new Map(plan.works.map((w) => [w.workKey, w]));
    return (ref: string) => {
      const key = ref.slice(2);
      if (ref.startsWith("n:")) return pathOf(key);
      const w = works.get(key);
      return w ? `${w.targets.map((t) => assets.get(t)?.name ?? t).join("、")} · ${w.kind || C.noName}` : key;
    };
  }, [plan]);
}

function ProposalRow({ p, plan, nameOf, onReject, onDone }: {
  p: CrosswalkProposal;
  plan: Plan;
  nameOf: (ref: string) => string;
  onReject: (p: CrosswalkProposal, reason: string) => void;
  onDone: (msg: { color: string; text: string }) => void;
}) {
  const [reason, setReason] = useState("");
  const catalog = catalogFor(plan.packId);
  const held = heldRows(plan, p).length;
  const ok = reason.trim().length > 0;
  return (
    <Table.Tr data-testid="crosswalk-rule" data-rule={p.ruleId} data-state={p.state} data-target={p.target}>
      <Table.Td style={{ minWidth: 260 }}>
        <Text size="xs">{p.basis}</Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs">{valueLabel(catalog, p.target, p.value)}</Text>
      </Table.Td>
      <Table.Td className="moyai-num" data-testid="crosswalk-matched">
        {p.matched}
      </Table.Td>
      <Table.Td className="moyai-num" data-testid="crosswalk-conflicts">
        {p.conflicts}
      </Table.Td>
      <Table.Td className="moyai-num" data-testid="crosswalk-held">
        {held}
      </Table.Td>
      <Table.Td style={{ minWidth: 160 }}>
        <Text size="xs">
          {p.examples.slice(0, EXAMPLES_SHOWN).map(nameOf).join("／")}
          {p.examples.length > EXAMPLES_SHOWN ? `　${C.more(p.matched - EXAMPLES_SHOWN)}` : ""}
        </Text>
      </Table.Td>
      <Table.Td style={{ minWidth: 104 }}>
        <Badge variant="light" style={{ overflow: "visible" }} color={p.state === "accepted" ? "teal" : p.state === "rejected" ? "gray" : "orange"}>
          {C.state[p.state]}
        </Badge>
      </Table.Td>
      <Table.Td style={{ minWidth: 200 }}>
        {p.state === "proposed" ? (
          <TextInput
            size="xs"
            aria-label={C.reasonLabel(p.ruleId)}
            placeholder={C.reasonPlaceholder}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.currentTarget.value)}
            data-testid="crosswalk-reason"
          />
        ) : (
          <Text size="xs">{p.humanReason}</Text>
        )}
      </Table.Td>
      <Table.Td>
        {p.state === "proposed" && (
          <Group gap={4} wrap="nowrap">
            <Button
              size="compact-xs"
              variant="light"
              disabled={!ok}
              title={ok ? undefined : C.needReason}
              data-testid="crosswalk-accept"
              onClick={() => {
                const r = acceptByHuman(p.ruleId, reason);
                onDone(r.ok ? { color: "teal", text: C.acceptedDone(p.ruleId, r.rows) } : { color: "red", text: C.refused[r.reason] ?? "" });
              }}
            >
              {C.accept}
            </Button>
            <Button size="compact-xs" variant="default" disabled={!ok} title={ok ? undefined : C.needReason} data-testid="crosswalk-reject" onClick={() => onReject(p, reason)}>
              {C.reject}
            </Button>
          </Group>
        )}
      </Table.Td>
    </Table.Tr>
  );
}

function DirectSet({ plan, onDone }: { plan: Plan; onDone: (msg: { color: string; text: string }) => void }) {
  const D = C.direct;
  const [target, setTarget] = useState<CrosswalkTarget>("assetNode");
  const [row, setRow] = useState<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const catalog = catalogFor(plan.packId);
  const nameOf = useNames(plan);
  const rows = useMemo(() => {
    if (target === "assetNode") {
      const targeted = new Set(plan.works.flatMap((w) => w.targets));
      return plan.assets
        .filter((a) => targeted.has(a.nodeKey))
        .map((a) => ({ value: a.nodeKey, label: `${nameOf(nodeRef(a.nodeKey))}　${a.commonItem ? C.current(valueLabel(catalog, "assetNode", a.commonItem)) : C.currentNone}` }));
    }
    return plan.works.map((w) => ({ value: w.workKey, label: `${nameOf(workRef(w.workKey))}　${w.attribute ? C.current(valueLabel(catalog, "work", w.attribute)) : C.currentNone}` }));
  }, [plan, target, nameOf, catalog]);
  const values = useMemo(() => {
    const labels = (catalog ?? emptyCatalog()).workLabels;
    const list =
      target === "assetNode"
        ? catalog
          ? [...catalog.items.values()].sort((a, b) => a.order - b.order).map((i) => ({ value: i.code, label: `${i.name}（${i.code}）` }))
          : []
        : WORK_ATTRIBUTES.map((a) => ({ value: a, label: `${labels[a]}（${a}）` }));
    return [...list, { value: CLEAR, label: D.clear }];
  }, [catalog, target, D.clear]);
  const can = row !== null && value !== null && reason.trim().length > 0;
  return (
    <Stack gap={6} data-testid="crosswalk-direct">
      <Title order={5}>{D.title}</Title>
      <Text size="xs" c="dimmed">
        {D.lead}
      </Text>
      <Group align="flex-end" gap="sm" wrap="wrap">
        <Switch<CrosswalkTarget>
          aria-label={D.kind}
          value={target}
          onChange={(v) => {
            setTarget(v);
            setRow(null);
            setValue(null);
          }}
          data={[
            { value: "assetNode", label: D.kindNode },
            { value: "work", label: D.kindWork },
          ]}
          data-testid="crosswalk-direct-kind"
        />
        <Select size="xs" label={D.row} placeholder={D.rowPlaceholder} searchable data={rows} value={row} onChange={setRow} w={420} limit={200} data-testid="crosswalk-direct-row" />
        <Select size="xs" label={D.value} placeholder={D.valuePlaceholder} searchable data={values} value={value} onChange={setValue} w={280} data-testid="crosswalk-direct-value" />
        <TextInput size="xs" label={C.head[7]} placeholder={C.reasonPlaceholder} value={reason} maxLength={500} onChange={(e) => setReason(e.currentTarget.value)} w={260} data-testid="crosswalk-direct-reason" />
        <Button
          size="xs"
          variant="light"
          disabled={!can}
          title={can ? undefined : C.needReason}
          data-testid="crosswalk-direct-submit"
          onClick={() => {
            if (!row || !value) return;
            const r = setByHuman(target, row, value === CLEAR ? null : value, reason);
            if (r.ok) {
              setReason("");
              setRow(null);
              setValue(null);
            }
            onDone(r.ok ? { color: "teal", text: D.done } : { color: "red", text: C.refused[r.reason] ?? "" });
          }}
        >
          {D.submit}
        </Button>
      </Group>
    </Stack>
  );
}

export function CrosswalkPanel() {
  const working = useWorkingPlan();
  const [rejecting, setRejecting] = useState<{ p: CrosswalkProposal; reason: string } | null>(null);
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);
  const plan = working?.plan ?? null;
  const nameOf = useNames(plan ?? { assets: [], works: [] } as unknown as Plan);
  if (!working || !plan) return <Text size="sm" c="dimmed">{C.noPlan}</Text>;
  const s = crosswalkSummary(plan);
  const proposals = working.proposals;
  return (
    <Stack gap="sm" data-testid="crosswalk-panel">
      <Text size="xs" c="dimmed">
        {C.lead}
      </Text>
      <Group gap="md">
        <Text
          size="sm"
          className="moyai-num"
          data-testid="crosswalk-unmapped"
          data-nodes={s.nodes.none}
          data-works={s.works.none}
          data-records={s.unmappedRecords}
        >
          {C.unmapped(s.nodes.none, s.works.none, s.unmappedRecords)}
        </Text>
        <Text size="sm" className="moyai-num" data-testid="crosswalk-accepted" data-nodes={s.nodes.accepted} data-works={s.works.accepted}>
          {C.accepted(s.nodes.accepted, s.nodes.targeted, s.works.accepted, s.works.total)}
        </Text>
      </Group>
      {msg && (
        <Alert color={msg.color} p="xs" data-testid="crosswalk-message">
          <Text size="xs">{msg.text}</Text>
        </Alert>
      )}
      {proposals.length === 0 ? (
        <Text size="sm" c="dimmed" data-testid="crosswalk-none">
          {C.none}
        </Text>
      ) : (
        <ScrollArea.Autosize mah={520}>
          <Table withTableBorder striped fz="xs" data-testid="crosswalk-rules">
            <Table.Thead>
              <Table.Tr>
                {C.head.map((h, i) => (
                  <Table.Th key={i} style={{ whiteSpace: "nowrap" }}>
                    {h}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {proposals.map((p) => (
                <ProposalRow key={p.ruleId} p={p} plan={plan} nameOf={nameOf} onReject={(x, reason) => setRejecting({ p: x, reason })} onDone={setMsg} />
              ))}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      )}
      <DirectSet plan={plan} onDone={setMsg} />
      <Modal opened={!!rejecting} onClose={() => setRejecting(null)} title={rejecting ? C.rejectTitle(rejecting.p.ruleId) : ""} centered data-testid="crosswalk-reject-dialog">
        {rejecting && (
          <Stack gap="sm">
            <Text size="sm">{C.rejectBody(rejecting.p.ruleId, heldRows(plan, rejecting.p).length)}</Text>
            <Text size="xs" c="dimmed">
              {C.head[7]}：{rejecting.reason}
            </Text>
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setRejecting(null)}>
                {C.cancel}
              </Button>
              <Button
                color="red"
                data-testid="crosswalk-reject-confirm"
                onClick={() => {
                  const r = rejectByHuman(rejecting.p.ruleId, rejecting.reason);
                  setMsg(r.ok ? { color: "teal", text: C.rejectedDone(rejecting.p.ruleId, r.rows) } : { color: "red", text: C.refused[r.reason] ?? "" });
                  setRejecting(null);
                }}
              >
                {C.rejectConfirm}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
