// 確定のダイアログと版の履歴（docs/plan.md §2.9）。確定は人だけ：差分の要約と一言の理由（空は通さない）、
// 人が受けていない決定（作者が AI・AI（チャットでの人の答え））は、一言の理由を書いて受けるまで確定できない。
// 確定・戻すは、押したその場で中身に結んだ 1 回きりの印をもらって人だけの経路を呼ぶ。window.confirm は使わない。
import { Alert, Anchor, Badge, Button, Checkbox, Group, Modal, ScrollArea, Stack, Table, Text, TextInput } from "@mantine/core";
import { readingsForCommit } from "../state/readings";
import { useEffect, useMemo, useState } from "react";
import { diffPlans, pendingDecisions, type Acceptance, type DiffMark } from "../../plan/diff";
import type { Plan } from "../../shared/plan";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import type { BridgeClient, HumanResult } from "../bridge-client";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { ERROR_TEXT, HUMAN_TEXT, TEXT } from "../text";

const T = HUMAN_TEXT.confirm;
const H = HUMAN_TEXT.history;
const DIFF_MAX = 200;

interface Synced {
  kind: "onedrive" | "sharepoint";
  base: string;
}

interface StatusBody {
  ok: boolean;
  reason?: string;
  root?: string;
  synced?: Synced | null;
  versions?: { version: number; kind: "confirm" | "revert"; revertOf: number | null; at: string; reason: string; summary: { added: number; removed: number; changed: number } }[];
  latest?: { version: number; plan: Plan } | null;
  accepted?: Acceptance[];
}

/** 人だけの経路の答えを、画面に出す誤りの文か中身にする */
export function readHuman<T extends { ok: boolean; reason?: string }>(r: HumanResult): { ok: true; body: T } | { ok: false; message: string } {
  if (!r.ok) return { ok: false, message: r.code === "network" ? HUMAN_TEXT.network : ERROR_TEXT[r.code] };
  const b = r.body as T;
  if (!b.ok) return { ok: false, message: HUMAN_TEXT.refused[b.reason ?? ""] ?? HUMAN_TEXT.refused.unknownAction! };
  return { ok: true, body: b };
}

export function SyncedNotice({ synced, kind }: { synced: Synced | null | undefined; kind: "root" | "ring" }) {
  if (!synced) return null;
  return (
    <Alert color="orange" p="xs" data-testid={kind === "root" ? "root-synced" : "ring-synced"}>
      <Text size="sm">{kind === "root" ? HUMAN_TEXT.synced.rootWarn(HUMAN_TEXT.synced[synced.kind], synced.base) : HUMAN_TEXT.synced.ringWarn}</Text>
    </Alert>
  );
}

const markText = (m: DiffMark | null) => (m === null ? T.mark.none : T.mark[m]);

type Load = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; status: StatusBody };

function useStatus(client: BridgeClient, planId: string, opened: boolean): [Load, () => void] {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!opened) return;
    let live = true;
    setLoad({ kind: "loading" });
    void (async () => {
      const r = readHuman<StatusBody>(await client.callHuman("plan_status", ROUTES.planStatus.path, { planId }));
      if (!live) return;
      setLoad(r.ok ? { kind: "ready", status: r.body } : { kind: "error", message: r.message });
    })();
    return () => {
      live = false;
    };
  }, [client, planId, opened, n]);
  return [load, () => setN((x) => x + 1)];
}

export function ConfirmDialog({
  client,
  plan,
  opened,
  onClose,
  onConfirmed,
}: {
  client: BridgeClient;
  plan: Plan;
  opened: boolean;
  onClose: () => void;
  onConfirmed: (plan: Plan) => void;
}) {
  const [load] = useStatus(client, plan.planId, opened);
  const [reason, setReason] = useState("");
  const [accept, setAccept] = useState<Record<string, { reason: string; on: boolean }>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; files: { version: string; report: string; export: string | null } } | null>(null);

  useEffect(() => {
    if (!opened) return;
    setReason("");
    setAccept({});
    setError(null);
    setDone(null);
  }, [opened]);

  const status = load.kind === "ready" ? load.status : null;
  const diff = useMemo(() => (status ? diffPlans(status.latest?.plan ?? null, plan) : null), [status, plan]);
  const pending = useMemo(() => (status ? pendingDecisions(plan, status.accepted ?? []) : []), [status, plan]);
  const accepted = pending.filter((d) => accept[d.id]?.on && (accept[d.id]?.reason.trim().length ?? 0) > 0);
  const left = pending.length - accepted.length;
  // 共通の設備項目はコードでなくパックの名前で見せる（名前が無ければコードのまま）
  const catalog = useMemo(() => catalogFor(plan.packId), [plan.packId]);
  const itemName = (code: string) => catalog?.items.get(code)?.name ?? catalog?.systems.get(code)?.name ?? code;
  const attrName = (code: string) => ((catalog ?? emptyCatalog()).workLabels as Record<string, string>)[code] ?? code;
  const canSubmit = !!status && reason.trim().length > 0 && left === 0 && !busy && !done;

  const submit = async () => {
    if (!canSubmit || !status) return;
    setBusy(true);
    setError(null);
    const payload = {
      plan,
      reason: reason.trim(),
      acceptances: accepted.map((d) => ({ id: d.id, hash: d.hash, reason: accept[d.id]!.reason.trim() })),
      basedOn: status.latest?.version ?? null,
      // 使った読み方（下書きと承認済み）。署名すると、この版の読み方は承認済みになる
      readings: readingsForCommit(),
    };
    const r = readHuman<{ ok: boolean; reason?: string; version: number; plan: Plan; files: { version: string; report: string; export: string | null } }>(
      await client.callHuman("plan_commit", ROUTES.planCommit.path, payload),
    );
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setDone({ version: r.body.version, files: r.body.files });
    onConfirmed(r.body.plan);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={T.title} size="80rem" centered data-testid="confirm-dialog">
      <Stack gap="sm">
        {load.kind === "loading" && <Text size="sm">{T.loading}</Text>}
        {load.kind === "error" && (
          <Alert color="red" data-testid="confirm-error">
            {load.message}
          </Alert>
        )}
        {status && diff && (
          <>
            <Group gap="xs">
              <Text size="sm" fw={700}>
                {T.root}
              </Text>
              <Text size="sm" className="moyai-num" data-testid="confirm-root">
                {status.root}
              </Text>
            </Group>
            <SyncedNotice synced={status.synced} kind="root" />
            <Text size="sm">{status.latest ? T.basedOn(status.latest.version) : T.first}</Text>
            <Text size="sm" fw={700} className="moyai-num" data-testid="diff-summary">
              {T.summary(diff.added, diff.removed, diff.changed, diff.same)}
            </Text>
            <ScrollArea.Autosize mah={240}>
              <Table striped withTableBorder className="moyai-num" data-testid="diff-table">
                <Table.Thead>
                  <Table.Tr>
                    {T.diffHead.map((h) => (
                      <Table.Th key={h}>{h}</Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {diff.rows.slice(0, DIFF_MAX).map((r) => (
                    <Table.Tr key={`${r.nodeKey}|${r.workKey}|${r.fiscalYear}`}>
                      <Table.Td>{r.equipment}</Table.Td>
                      <Table.Td>{r.work}</Table.Td>
                      <Table.Td>{r.fiscalYear}</Table.Td>
                      <Table.Td>{markText(r.before)}</Table.Td>
                      <Table.Td>{markText(r.after)}</Table.Td>
                      <Table.Td>{r.authors.map((a) => TEXT.author[a]).join("、")}</Table.Td>
                      <Table.Td>{r.basis.join(" / ")}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </ScrollArea.Autosize>
            {diff.rows.length > DIFF_MAX && <Text size="xs">{T.diffMore(diff.rows.length - DIFF_MAX)}</Text>}

            {pending.length > 0 && (
              <Stack gap={4} data-testid="pending">
                <Text fw={700}>{T.pendingTitle(pending.length)}</Text>
                <Text size="xs" c="dimmed">
                  {T.pendingLead}
                </Text>
                <ScrollArea.Autosize mah={260}>
                  <Table withTableBorder>
                    <Table.Thead>
                      <Table.Tr>
                        {T.pendingHead.map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {pending.map((d) => {
                        const a = accept[d.id] ?? { reason: "", on: false };
                        const [pa, fy] = d.kind === "detail" ? d.value.split(":") : [null, null];
                        return (
                          <Table.Tr key={d.id} data-testid="pending-row">
                            <Table.Td>{d.target}</Table.Td>
                            <Table.Td className="moyai-num">
                              {d.kind === "detail" ? `${T.pendingValue[pa ?? ""] ?? ""} · ${T.pendingFiscal(fy ?? "")}` : d.kind === "attribute" ? attrName(d.value) : itemName(d.value)}
                            </Table.Td>
                            <Table.Td>
                              <Badge variant="light" color="orange">
                                {TEXT.author[d.author]}
                              </Badge>
                            </Table.Td>
                            <Table.Td>{d.basis}</Table.Td>
                            <Table.Td>
                              <TextInput
                                size="xs"
                                aria-label={`${T.pendingHead[4]} ${d.target}`}
                                value={a.reason}
                                onChange={(e) => {
                                  const v = e.currentTarget.value;
                                  setAccept((s) => ({ ...s, [d.id]: { on: v.trim().length > 0 && a.on, reason: v } }));
                                }}
                                data-testid="pending-reason"
                              />
                            </Table.Td>
                            <Table.Td>
                              <Checkbox
                                label={T.accept}
                                checked={a.on}
                                disabled={a.reason.trim().length === 0}
                                title={a.reason.trim().length === 0 ? T.acceptNeedsReason : undefined}
                                onChange={(e) => {
                                  const on = e.currentTarget.checked;
                                  setAccept((s) => ({ ...s, [d.id]: { reason: a.reason, on } }));
                                }}
                                data-testid="pending-accept"
                              />
                            </Table.Td>
                          </Table.Tr>
                        );
                      })}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </Stack>
            )}

            <TextInput
              label={T.reason}
              placeholder={T.reasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              maxLength={500}
              data-testid="confirm-reason"
              disabled={!!done}
            />
            {error && (
              <Alert color="red" data-testid="confirm-error">
                {error}
              </Alert>
            )}
            {done && (
              <Alert color="teal" data-testid="confirm-done">
                <Stack gap={4}>
                  <Text size="sm" fw={700}>
                    {T.done(done.version)}
                  </Text>
                  <Text size="xs">{T.files}</Text>
                  <Text size="xs" className="moyai-num" data-testid="confirm-files">
                    {done.files.version}
                  </Text>
                  <Text size="xs" className="moyai-num">
                    {done.files.report}
                  </Text>
                  {done.files.export && (
                    <Text size="xs" className="moyai-num" data-testid="confirm-export">
                      {done.files.export}
                    </Text>
                  )}
                </Stack>
              </Alert>
            )}
          </>
        )}
        <Group justify="flex-end" gap="sm">
          {!done && status && (left > 0 || reason.trim().length === 0) && (
            <Text size="xs" c="dimmed" data-testid="confirm-submit-reason">
              {left > 0 ? T.pendingLeft(left) : T.reasonEmpty}
            </Text>
          )}
          {done ? (
            <>
              <Button variant="default" onClick={onClose}>
                {T.close}
              </Button>
              <Button
                onClick={() => {
                  onClose();
                  location.hash = APP_PAGES.checkpoint;
                }}
                data-testid="to-checkpoint"
              >
                {T.toCheckpoint}
              </Button>
            </>
          ) : (
            <>
              <Button variant="default" onClick={onClose}>
                {T.cancel}
              </Button>
              <Button onClick={submit} disabled={!canSubmit} loading={busy} data-testid="confirm-submit">
                {T.submit}
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

export function HistoryDialog({
  client,
  planId,
  opened,
  onClose,
  onReverted,
}: {
  client: BridgeClient;
  planId: string;
  opened: boolean;
  onClose: () => void;
  onReverted: (plan: Plan) => void;
}) {
  const [load, reload] = useStatus(client, planId, opened);
  const [target, setTarget] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const status = load.kind === "ready" ? load.status : null;

  const revert = async () => {
    if (target === null || !status || reason.trim().length === 0) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string; version: number; plan: Plan }>(
      await client.callHuman("plan_revert", ROUTES.planRevert.path, { planId, to: target, reason: reason.trim(), basedOn: status.latest?.version ?? null }),
    );
    setBusy(false);
    if (!r.ok) return setMsg({ color: "red", text: r.message });
    setMsg({ color: "teal", text: H.reverted(r.body.version) });
    setTarget(null);
    setReason("");
    onReverted(r.body.plan);
    reload();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={H.title} size="60rem" centered>
      <Stack gap="sm">
        {load.kind === "loading" && <Text size="sm">{T.loading}</Text>}
        {load.kind === "error" && <Alert color="red">{load.message}</Alert>}
        {status && (status.versions ?? []).length === 0 && <Text size="sm">{H.none}</Text>}
        {status && (status.versions ?? []).length > 0 && (
          <Table striped withTableBorder className="moyai-num" data-testid="history-table">
            <Table.Thead>
              <Table.Tr>
                {H.head.map((h) => (
                  <Table.Th key={h}>{h}</Table.Th>
                ))}
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {(status.versions ?? []).map((v) => (
                <Table.Tr key={v.version}>
                  <Table.Td>{v.version}</Table.Td>
                  <Table.Td>{v.kind === "confirm" ? H.kind.confirm : H.kind.revert(v.revertOf ?? 0)}</Table.Td>
                  <Table.Td>{new Date(v.at).toLocaleString("ja-JP")}</Table.Td>
                  <Table.Td>{v.reason}</Table.Td>
                  <Table.Td>{H.diff(v.summary.added, v.summary.removed, v.summary.changed)}</Table.Td>
                  <Table.Td>
                    {v.version !== status.latest?.version && (
                      <Anchor component="button" size="sm" onClick={() => setTarget(v.version)}>
                        {H.revert}
                      </Anchor>
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
        {target !== null && (
          <Stack gap={4}>
            <Text size="xs" c="dimmed">
              {H.revertLead}
            </Text>
            <Group align="flex-end" gap="sm">
              <TextInput style={{ flex: 1 }} label={H.revertReason} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} />
              <Button onClick={revert} disabled={reason.trim().length === 0} loading={busy}>
                {H.revertSubmit(target)}
              </Button>
            </Group>
          </Stack>
        )}
        {msg && <Alert color={msg.color}>{msg.text}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {H.close}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
