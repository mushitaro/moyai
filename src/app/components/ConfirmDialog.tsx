// 確定のダイアログと版の履歴（docs/plan.md §2.9・§2.18.2）。確定は人だけ：差分の要約と一言の理由（空は通さない）、
// 自分の鍵の合言葉で版に署名する（鍵がまだ無ければ、合言葉を決めて作ってから署名する）。この署名で承認する読み方を 1 行ずつ見せる。
// 人が受けていない決定（作者が AI・AI（チャットでの人の答え））は、MERGE の決定のシートで一言の理由を書いて受けるまで確定できない（受けた決定は state/decisions.ts）。
// 確定・戻すは、押したその場で中身に結んだ 1 回きりの印をもらって人だけの経路を呼ぶ。window.confirm は使わない。
import { Alert, Anchor, Button, Group, Modal, PasswordInput, Radio, ScrollArea, Stack, Table, Text, TextInput, Textarea } from "@mantine/core";
import { mailtoOf, setHandoffMail, type HandoffMail } from "../state/handoff";
import { getCurrentReadings, readingsForCommit } from "../state/readings";
import { acceptancesFor, clearAccepted } from "../state/decisions";
import { sheetHash } from "../stages";
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
  versions?: {
    version: number;
    kind: "confirm" | "revert";
    revertOf: number | null;
    at: string;
    reason: string;
    summary: { added: number; removed: number; changed: number };
    signatures: { role: string; by: string; fingerprint: string; trust: string }[];
    legacy: boolean;
    problem: string | null;
  }[];
  latest?: { version: number; plan: Plan } | null;
  accepted?: Acceptance[];
  /** 自分の呼び名と、この PC にその鍵があるか */
  name?: string | null;
  hasKey?: boolean;
  /** 編集の番（docs/screens.md 3.4） */
  turn?: { version: number; state: "editing" | "awaitingApproval" | "approved" | "returned"; holder: string | null; to: string | null; from: string; note: string; at: string } | null;
}

const PASS_MIN = 8;

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

/** 確定した版の一覧と、いちばん新しい版（人だけの経路 plan_status）。opened のあいだ読む */
export function usePlanStatus(client: BridgeClient, planId: string, opened: boolean): [Load, () => void] {
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
  const [load] = usePlanStatus(client, plan.planId, opened);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; files: { version: string; report: string; export: string | null } } | null>(null);
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [keyMade, setKeyMade] = useState<string | null>(null);
  // 頼むこと：自分で確定する・編集を頼む・承認を頼む
  const [ask, setAsk] = useState<"self" | "edit" | "approve">("self");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [mail, setMail] = useState<HandoffMail | null>(null);

  useEffect(() => {
    if (!opened) return;
    setReason("");
    setError(null);
    setDone(null);
    setPass("");
    setPass2("");
    setKeyMade(null);
    setAsk("self");
    setTo("");
    setNote("");
    setMail(null);
  }, [opened]);

  const status = load.kind === "ready" ? load.status : null;
  const diff = useMemo(() => (status ? diffPlans(status.latest?.plan ?? null, plan) : null), [status, plan]);
  const pending = useMemo(() => (status ? pendingDecisions(plan, status.accepted ?? []) : []), [status, plan]);
  // 受けた決定は、MERGE の決定のシートで人が受けたもの
  const accepted = acceptancesFor(pending);
  const left = pending.length - accepted.length;
  // 共通の設備項目はコードでなくパックの名前で見せる（名前が無ければコードのまま）
  const catalog = useMemo(() => catalogFor(plan.packId), [plan.packId]);
  const itemName = (code: string) => catalog?.items.get(code)?.name ?? catalog?.systems.get(code)?.name ?? code;
  const attrName = (code: string) => ((catalog ?? emptyCatalog()).workLabels as Record<string, string>)[code] ?? code;
  // 署名：呼び名が決まっていなければ署名できない。鍵が無ければ、合言葉を決めて（2 回）鍵を作ってから署名する
  const name = status?.name ?? null;
  const newKey = !!status && !status.hasKey && keyMade === null;
  const passOk = newKey ? pass.length >= PASS_MIN && pass === pass2 : pass.length > 0;
  const readings = getCurrentReadings().readings;
  const toOk = ask === "self" || /^[^\s@]+@[^\s@]+$/.test(to.trim());
  const canSubmit = !!status && !!name && passOk && toOk && reason.trim().length > 0 && left === 0 && !busy && !done;
  const blockReason = !toOk ? T.toMissing : !name ? T.needName : left > 0 ? T.pendingLeft(left) : reason.trim().length === 0 ? T.reasonEmpty : !passOk ? (newKey && pass.length > 0 && pass.length < PASS_MIN ? T.passphraseShort : newKey && pass2.length > 0 && pass !== pass2 ? T.passphraseMismatch : T.passphraseEmpty) : null;

  const submit = async () => {
    if (!canSubmit || !status) return;
    setBusy(true);
    setError(null);
    if (newKey) {
      // 鍵を作る（人だけの経路）。作れたら、同じ合言葉で続けて署名する
      const k = readHuman<{ ok: boolean; reason?: string; fingerprint: string }>(await client.callHuman("person_key_create", ROUTES.personKeyCreate.path, { passphrase: pass }));
      if (!k.ok) {
        setBusy(false);
        return setError(k.message);
      }
      setKeyMade(k.body.fingerprint);
    }
    const payload = {
      plan,
      reason: reason.trim(),
      acceptances: accepted,
      basedOn: status.latest?.version ?? null,
      // 使った読み方（下書きと承認済み）。署名すると、この版の読み方は承認済みになる
      readings: readingsForCommit(),
      passphrase: pass,
      request: { kind: ask, to: ask === "self" ? null : to.trim(), note: note.trim() },
      origin: location.origin,
    };
    const r = readHuman<{ ok: boolean; reason?: string; version: number; plan: Plan; files: { version: string; report: string; export: string | null }; mail: HandoffMail | null }>(
      await client.callHuman("plan_commit", ROUTES.planCommit.path, payload),
    );
    setBusy(false);
    setPass("");
    setPass2("");
    if (!r.ok) return setError(r.message);
    setDone({ version: r.body.version, files: r.body.files });
    setMail(r.body.mail);
    // 用意したメールの文は、AI にも intake_survey の handoff で渡す（Claude が利用者の連携したメールから送る）
    setHandoffMail(r.body.mail);
    clearAccepted();
    onConfirmed(r.body.plan);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={status ? (ask === "self" ? T.titleSign((status.latest?.version ?? 0) + 1) : T.titleHandoff((status.latest?.version ?? 0) + 1)) : T.title} size="80rem" centered data-testid="confirm-dialog">
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
              <Alert color="gray" p="xs" data-testid="pending">
                <Group gap="xs">
                  <Text size="sm">{left > 0 ? T.pendingLeft(left) : T.pendingAllAccepted(pending.length)}</Text>
                  {left > 0 && (
                    <Anchor href={sheetHash("decisions")} size="sm" onClick={onClose} data-testid="to-decisions">
                      {T.toDecisions}
                    </Anchor>
                  )}
                </Group>
              </Alert>
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

            {readings.length > 0 && (
              <Stack gap={4} data-testid="sign-readings">
                <Text fw={700}>{T.readingsTitle(readings.length)}</Text>
                <Text size="xs" c="dimmed">
                  {T.readingsLead}
                </Text>
                <Table withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      {T.readingsHead.map((h) => (
                        <Table.Th key={h}>{h}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {readings.map((r) => (
                      <Table.Tr key={`${r.skill.name}|${r.version}`} data-testid="sign-reading">
                        <Table.Td>{r.skill.name}</Table.Td>
                        <Table.Td>{T.readingScope[r.skill.scope]}</Table.Td>
                        <Table.Td className="moyai-num">{r.skill.rules.length}</Table.Td>
                        <Table.Td>{r.draft ? <Text span c="var(--shu)">{T.readingDraft}</Text> : r.approved ? T.readingApproved : T.readingUnapproved}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            )}

            <Stack gap={4} data-testid="ask">
              <Radio.Group label={T.askTitle} value={ask} onChange={(v) => setAsk(v as typeof ask)}>
                <Group gap="lg" mt={4}>
                  <Radio value="self" label={T.ask.self} disabled={!!done} data-testid="ask-self" />
                  <Radio value="edit" label={T.ask.edit} disabled={!!done} data-testid="ask-edit" />
                  <Radio value="approve" label={T.ask.approve} disabled={!!done} data-testid="ask-approve" />
                </Group>
              </Radio.Group>
              {ask !== "self" && (
                <Group grow align="flex-start">
                  <TextInput label={T.to} placeholder={T.toPlaceholder} value={to} onChange={(e) => setTo(e.currentTarget.value)} disabled={!!done} data-testid="ask-to" />
                  <Textarea label={T.note} value={note} onChange={(e) => setNote(e.currentTarget.value)} autosize minRows={1} maxLength={1000} disabled={!!done} data-testid="ask-note" />
                </Group>
              )}
              {ask !== "self" && (
                <Text size="xs" c="dimmed">
                  {T.carries}
                </Text>
              )}
            </Stack>

            <Stack gap={4} data-testid="sign">
              <Text fw={700}>{T.signTitle}</Text>
              {!name ? (
                <Alert color="gray" p="xs" data-testid="sign-need-name">
                  <Group gap="xs">
                    <Text size="sm">{T.needName}</Text>
                    <Anchor href={APP_PAGES.settings} size="sm" onClick={onClose}>
                      {T.toSettings}
                    </Anchor>
                  </Group>
                </Alert>
              ) : (
                <>
                  <Text size="xs" c="dimmed">
                    {newKey ? T.newKeyLead : T.signLead(name)}
                  </Text>
                  <Group grow align="flex-start">
                    <PasswordInput
                      label={newKey ? T.passphraseNew : T.passphrase}
                      value={pass}
                      onChange={(e) => setPass(e.currentTarget.value)}
                      disabled={!!done}
                      autoComplete="off"
                      data-testid="sign-passphrase"
                    />
                    {newKey && (
                      <PasswordInput
                        label={T.passphraseAgain}
                        value={pass2}
                        onChange={(e) => setPass2(e.currentTarget.value)}
                        disabled={!!done}
                        autoComplete="off"
                        data-testid="sign-passphrase-again"
                      />
                    )}
                  </Group>
                  {keyMade && (
                    <Text size="xs" data-testid="sign-key-made">
                      {T.keyMade(keyMade)}
                    </Text>
                  )}
                </>
              )}
            </Stack>
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
            {done && mail && (
              <Alert color="gray" data-testid="handoff-mail">
                <Stack gap={4}>
                  <Text size="sm" fw={700}>
                    {T.mailTitle}
                  </Text>
                  <Text size="xs">
                    {T.mailTo}：{mail.to}
                  </Text>
                  <Text size="xs">
                    {T.mailSubject}：{mail.subject}
                  </Text>
                  <Text size="xs" style={{ whiteSpace: "pre-wrap" }} data-testid="handoff-body">
                    {mail.body}
                  </Text>
                  <Group gap="sm">
                    <Button component="a" href={mailtoOf(mail)} variant="default" size="xs" data-testid="handoff-mailto">
                      {T.mailOpen}
                    </Button>
                    <Text size="xs" c="dimmed">
                      {T.mailClaude}
                    </Text>
                  </Group>
                </Stack>
              </Alert>
            )}
          </>
        )}
        <Group justify="flex-end" gap="sm">
          {!done && status && blockReason && (
            <Text size="xs" c="dimmed" data-testid="confirm-submit-reason">
              {blockReason}
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
                {ask === "self" ? T.submit : T.submitHandoff}
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
  const [load, reload] = usePlanStatus(client, planId, opened);
  const [target, setTarget] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ color: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pass, setPass] = useState("");
  const status = load.kind === "ready" ? load.status : null;

  const revert = async () => {
    if (target === null || !status || reason.trim().length === 0 || pass.length === 0) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string; version: number; plan: Plan }>(
      await client.callHuman("plan_revert", ROUTES.planRevert.path, { planId, to: target, reason: reason.trim(), basedOn: status.latest?.version ?? null, passphrase: pass }),
    );
    setBusy(false);
    setPass("");
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
                  <Table.Td data-testid="history-signatures">
                    {v.problem ? (
                      <Text size="xs" c="var(--shu)">
                        {H.problem[v.problem]}
                      </Text>
                    ) : v.legacy ? (
                      <Text size="xs" c="dimmed">
                        {H.legacy}
                      </Text>
                    ) : (
                      v.signatures.map((x) => (
                        <Text size="xs" key={`${x.role}|${x.fingerprint}`}>
                          {x.by} {H.trust[x.trust] ?? ""}
                        </Text>
                      ))
                    )}
                  </Table.Td>
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
              <PasswordInput label={H.revertPassphrase} value={pass} onChange={(e) => setPass(e.currentTarget.value)} autoComplete="off" />
              <Button onClick={revert} disabled={reason.trim().length === 0 || pass.length === 0} loading={busy}>
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
