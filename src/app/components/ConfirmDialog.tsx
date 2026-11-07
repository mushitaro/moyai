// 確定のダイアログと版の履歴（docs/plan.md §2.9・§2.18.2）。確定は人だけ：差分の要約と一言の理由（空は通さない）、
// 自分の鍵で版に署名する（鍵がまだ無ければ、作ってから署名する。合言葉はやめた、docs/plan.md §2.18）。この署名で承認する読み方を 1 行ずつ見せる。
// 人が受けていない決定（作者が AI・AI（チャットでの人の答え））は、MERGE の決定のシートで一言の理由を書いて受けるまで確定できない（受けた決定は state/decisions.ts）。
// 確定・戻すは、押したその場で中身に結んだ 1 回きりの印をもらって人だけの経路を呼ぶ。window.confirm は使わない。
import { Alert, Anchor, Button, Group, Modal, Radio, Stack, Table, Text, TextInput } from "@mantine/core";
import { mailtoOf, setHandoffMail, type HandoffMail } from "../state/handoff";
import { droppedPlanRules, readingsForCommit, readingsSigned } from "../state/readings";
import { acceptancesFor, clearAccepted } from "../state/decisions";
import { settleDraft } from "../state/draft";
import { pendingDeriveFor, setPendingDerive } from "../state/derive";
import { getWorkingPlan } from "../state/plan-store";
import { displayPrefs } from "../state/screen";
import { sheetHash } from "../stages";
import { useEffect, useMemo, useState } from "react";
import { diffPlans, pendingDecisions, type Acceptance, type DiffMark } from "../../plan/diff";
import { noteCommittedRemovals, removalAcceptances } from "../state/stars";
import type { Plan } from "../../shared/plan";
import type { Rule } from "../../shared/tools";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import type { BridgeClient, HumanResult } from "../bridge-client";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { ERROR_TEXT, HUMAN_TEXT, TEXT } from "../text";
import { versionName } from "../version-name";
import { KeyWarnLine, untrustedSigners, type TrustSig } from "./KeyWarn";

const T = HUMAN_TEXT.confirm;
const H = HUMAN_TEXT.history;

interface Synced {
  kind: "onedrive" | "sharepoint";
  base: string;
}

/** 効かない頼み（その版を作った鍵でない・ほかの中身に宛てた。数えない。Wire の B1 の追い） */
export interface IgnoredRequest {
  by: string;
  fingerprint: string;
  at: string;
  why: "otherKey" | "otherContent";
}

/** 書き出しの署名（信じ方つき）：結び目の鎖の「書出」の行と、EXPORT の鍵の警告 */
export interface ExportSig extends Omit<TrustSig, "role"> {
  at: string;
  template: { name: string; file: string; columns: string; version: string };
  excel: string;
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
    signatures: TrustSig[];
    legacy: boolean;
    problem: string | null;
    /** 様式で書き出した Excel への署名（3C。版を作る署名ではない） */
    exports?: ExportSig[];
  }[];
  latest?: {
    version: number;
    plan: Plan;
    /** 次の版に重ねるための記録（1C・重-2）。写真のある版と前の形の版は null */
    sources?: { name: string; sha256: string; size: number }[] | null;
    decisions?: { questionId: string; answer: string; author: string; reason: string; sources: string[] }[] | null;
    crosswalk?: { rule: Rule; target: "assetNode" | "work"; value: string; basis: string }[] | null;
  } | null;
  /** いちばん新しい版のひとつ前の版（確かめで合うときだけ） */
  previous?: { version: number; plan: Plan } | null;
  accepted?: Acceptance[];
  /** 自分の呼び名と、この PC にその鍵があるか */
  name?: string | null;
  hasKey?: boolean;
  /** 編集の番（docs/screens.md 3.4） */
  turn?: { version: number; state: "editing" | "awaitingApproval" | "approved" | "returned"; holder: string | null; to: string | null; from: string; note: string; at: string } | null;
  /** いちばん新しい版の頼みと受け取り（監査 B1） */
  request?: {
    version: number;
    kind: "approve" | "edit";
    to: string;
    by: string;
    mine: boolean;
    received: { by: string; pub: string; fingerprint: string; trust: string; previous: { fingerprint: string; at: string } | null } | null;
    receivedByMe: boolean;
    done: boolean;
  } | null;
  /** いちばん新しい版に置かれた、数えない頼み（その版を作った鍵でないか、ほかの中身に宛てたもの。監査 B1 の追い） */
  requestsIgnored?: IgnoredRequest[];
}


/** 頼むこと：渡さずに自分で確定する・編集を頼む・承認を頼む */
export type Ask = "self" | "edit" | "approve";

/**
 * 署名のダイアログの題と主ボタン（docs/screens.md §3.4 の末尾。Wire、11-07）：頼むことで替える。
 * 自分で確定する：「第 n 版に署名して確定する」「署名して確定する」。編集・承認を頼む：「第 n 版に署名して渡す」「署名して渡す」。
 * 承認を頼まれた人の「承認して署名する」はここでは使わない（SignDialog）。
 */
export function signDialogWords(ask: Ask, n: number): { title: string; submit: string } {
  return ask === "self" ? { title: T.titleSign(n), submit: T.submit } : { title: T.titleHandoff(n), submit: T.submitHandoff };
}

/**
 * 署名したあとの結果の 1 文。自分で確定した版は年度で呼ぶ（「令和 8 年度版（第 1 版）を確定しました。」）。
 * 渡したとき（まだ確定していない）は年度を付けない（「第 1 版に署名して、［宛先］へのメールを用意しました。」）。
 * at は版の記録の署名の時刻、startMonth は施設の年度の始まり（見せ方だけ。署名される字には足さない）
 */
export function signDoneLine(done: { version: number; at: string | null; startMonth: number | null }, mail: { to: string } | null): string {
  return mail ? T.doneHandoff(done.version, mail.to) : T.doneSelf(versionName(done.version, done.at, done.startMonth));
}

/** 署名の「もとにした版」：作業中の計画がもとにした保管先の版（作業中の計画でなければ、保管先のいちばん新しい版） */
function baseOf(plan: Plan, latest: number | null): number | null {
  const w = getWorkingPlan();
  return w && w.plan.planId === plan.planId ? w.base : latest;
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
  sources,
  intake,
}: {
  client: BridgeClient;
  plan: Plan;
  opened: boolean;
  onClose: () => void;
  onConfirmed: (plan: Plan) => void;
  /** 次の版に重ねるための資料と決定（1C・重-2）。写真のある版や資料の無い版は null */
  /** 聞いた数（2A） */
  intake?: () => { questions: number; decisions: { human: number; ai: number; ai_relayed_human: number; rule_code: number } } | null;
  sources?: () => Promise<{ files: { name: string; bytes: Uint8Array; sha256: string }[]; decisions: { questionId: string; answer: string; author: string; reason: string; sources: string[] }[] } | null>;
}) {
  const [load, reload] = usePlanStatus(client, plan.planId, opened);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ version: number; at: string | null; startMonth: number | null; files: { version: string; report: string; export: string | null } } | null>(null);
  const [keyMade, setKeyMade] = useState<string | null>(null);
  // 頼むこと：自分で確定する・編集を頼む・承認を頼む
  // 下の帯の「署名して確定する」から開いたときの既定は、渡さずに自分で確定する
  const [ask, setAsk] = useState<Ask>("self");
  const [to, setTo] = useState("");
  const [mail, setMail] = useState<HandoffMail | null>(null);

  useEffect(() => {
    if (!opened) return;
    setReason("");
    setError(null);
    setDone(null);
    setKeyMade(null);
    setAsk("self");
    setTo("");
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
  // 署名：呼び名が決まっていなければ署名できない。この PC に鍵が無ければ、鍵を作ってから署名する（合言葉はやめた。docs/plan.md §2.18）
  const name = status?.name ?? null;
  const newKey = !!status && !status.hasKey && keyMade === null;
  // この署名で承認する読み方（下書きの計画ルールは、この署名で受ける周期の案のもとになったものだけ。Architect の 42 の 2）
  const acceptedIds = new Set(accepted.map((a) => a.id));
  const readings = readingsSigned(plan, acceptedIds);
  // この版に載せない計画ルール（案を受けていない下書きのルール）。人が知ったうえで署名する（Architect の 42 の答え 4）
  const dropped = droppedPlanRules(plan, acceptedIds);
  const toOk = ask === "self" || /^[^\s@]+@[^\s@]+$/.test(to.trim());
  const canSubmit = !!status && !!name && toOk && reason.trim().length > 0 && left === 0 && !busy && !done;
  const blockReason = !toOk ? T.toMissing : !name ? T.needName : left > 0 ? T.pendingLeft(left) : reason.trim().length === 0 ? T.reasonEmpty : null;

  const submit = async () => {
    if (!canSubmit || !status) return;
    setBusy(true);
    setError(null);
    if (newKey) {
      // 鍵を作る（人だけの経路）。作れたら、続けて署名する
      const k = readHuman<{ ok: boolean; reason?: string; fingerprint: string }>(await client.callHuman("person_key_create", ROUTES.personKeyCreate.path, {}));
      if (!k.ok) {
        setBusy(false);
        return setError(k.message);
      }
      setKeyMade(k.body.fingerprint);
    }
    // 次の版に重ねるための資料を、1 つずつ先に保存先に置く（確定では SHA-256 だけを送る。Architect の縛り 2）
    const src = sources ? await sources() : null;
    if (src) {
      for (const f of src.files) {
        const put = readHuman<{ ok: boolean; sha256: string }>(await client.callHuman("plan_source_put", ROUTES.planSourcePut.path, { planId: plan.planId, base64: base64Of(f.bytes) }));
        if (!put.ok) {
          setBusy(false);
          return setError(put.message);
        }
      }
    }
    const crosswalk = (getWorkingPlan()?.proposals ?? []).filter((p) => p.state === "accepted").map((p) => ({ rule: p.rule, target: p.target, value: p.value, basis: p.basis }));
    const stats = intake ? intake() : null;
    const sentRemovals = removalAcceptances();
    const payload = {
      ...(stats ? { intake: stats } : {}),
      ...(src ? { sources: src.files.map((f) => ({ name: f.name, sha256: f.sha256, size: f.bytes.length })), decisions: src.decisions, crosswalk } : {}),
      plan,
      reason: reason.trim(),
      // 確定した星取の削除も、確定の理由と作者を版の記録の署名の内側に入れる（remove:<明細の鍵>。Architect の 70）
      acceptances: [...accepted, ...sentRemovals],
      // もとにした版：この編集を始めた保管先の版（ほかの人がその後に版を足していれば、橋渡しが断る）
      basedOn: baseOf(plan, status.latest?.version ?? null),
      // 使った読み方（下書きと承認済み）。署名すると、この版の読み方は承認済みになる
      readings: readingsForCommit(plan, acceptedIds),
      request: { kind: ask, to: ask === "self" ? null : to.trim(), note: reason.trim() },
      // ほかの施設の版から作った新しい施設の第 1 版なら、その元（トップの「この版から別の施設をつくる」）
      derivedFrom: status.latest ? null : pendingDeriveFor(plan.planId),
      origin: location.origin,
      // 画面の星取表の行の並び（見せ方）：書き出しの Excel を同じ並びにする。版の記録の計画には入らない（仕事 chat-ops-v1）
      ...(Object.keys(rowOrderOf(plan)).length > 0 ? { rowOrder: rowOrderOf(plan) } : {}),
    };
    const r = readHuman<{ ok: boolean; reason?: string; version: number; at?: string; plan: Plan; files: { version: string; report: string; export: string | null }; mail: HandoffMail | null }>(
      await client.callHuman("plan_commit", ROUTES.planCommit.path, payload),
    );
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // 結果の 1 文の年度は、版の記録の署名の時刻と、署名した版の施設の年度の始まりから出す（見せ方だけ）
    setDone({ version: r.body.version, at: r.body.at ?? null, startMonth: r.body.plan?.facility?.fiscalYearStartMonth ?? null, files: r.body.files });
    setMail(r.body.mail);
    // 用意したメールの文は、AI にも intake_survey の handoff で渡す（Claude が利用者の連携したメールから送る）
    setHandoffMail(r.body.mail);
    if (pendingDeriveFor(plan.planId)) setPendingDerive(null);
    clearAccepted();
    // 送った削除を履歴に足す（橋渡しの状態を読み直す前に作り直しても、消した星取が戻らないように。Architect の 70 の残り）
    noteCommittedRemovals(plan.planId, r.body.version, sentRemovals);
    // 確定したら、前の作業の写しを消す（pwa-v0）
    settleDraft(plan.planId);
    onConfirmed(r.body.plan);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={status ? signDialogWords(ask, (status.latest?.version ?? 0) + 1).title : T.title} size={680} centered data-testid="confirm-dialog">
      <Stack gap="sm">
        {load.kind === "loading" && <Text size="sm">{T.loading}</Text>}
        {load.kind === "error" && (
          <Alert color="red" data-testid="confirm-error">
            {load.message}
          </Alert>
        )}
        {/* 署名したら、中身を結果に置き換える（Wire、2026-11-04）。入力の欄は残さない */}
        {status && diff && !done && (
          <>
            {/* 署名して渡す（docs/screens.md 3.4、絵は Handoff.dc.html）：件数の 1 行 → 頼むこと → 宛先・理由 → この署名で承認する読み方 → 署名。
                差分の行は差分レポートと決定のシートが持つので、ここには件数だけ */}
            <Text size="sm" className="moyai-num" data-testid="diff-summary">
              {T.summaryLine(status.latest?.version ?? null, diff.added, diff.removed, diff.changed)}
            </Text>
            <SyncedNotice synced={status.synced} kind="root" />

            {/* この署名に入る、決定のシートで受けた決定の数 */}
            {pending.length > 0 && left === 0 && (
              <Text size="xs" c="dimmed" data-testid="pending">
                {T.pendingAllAccepted(pending.length)}
              </Text>
            )}
            {pending.length > 0 && left > 0 && (
              <Alert color="gray" p="xs" data-testid="pending">
                <Group gap="xs">
                  <Text size="sm">{T.pendingLeft(left)}</Text>
                  <Anchor href={sheetHash("decisions")} size="sm" onClick={onClose} data-testid="to-decisions">
                    {T.toDecisions}
                  </Anchor>
                </Group>
              </Alert>
            )}

            <Radio.Group label={T.askTitle} value={ask} onChange={(v) => setAsk(v as Ask)} data-testid="ask">
              <Group gap="lg" mt={4}>
                <Radio value="self" label={T.ask.self} disabled={!!done} data-testid="ask-self" />
                <Radio value="edit" label={T.ask.edit} disabled={!!done} data-testid="ask-edit" />
                <Radio value="approve" label={T.ask.approve} disabled={!!done} data-testid="ask-approve" />
              </Group>
            </Radio.Group>
            {ask !== "self" && <TextInput label={T.to} placeholder={T.toPlaceholder} value={to} onChange={(e) => setTo(e.currentTarget.value)} disabled={!!done} data-testid="ask-to" />}
            <TextInput
              label={ask === "self" ? T.reason : T.reasonHandoff}
              placeholder={T.reasonPlaceholder}
              value={reason}
              onChange={(e) => setReason(e.currentTarget.value)}
              maxLength={500}
              data-testid="confirm-reason"
              disabled={!!done}
            />

            {readings.length > 0 && (
              <Stack gap={2} data-testid="sign-readings">
                <Text size="xs" fw={500} c="dimmed">
                  {T.readingsTitle(readings.length)}
                </Text>
                {readings.map((r) => (
                  <Group key={`${r.skill.name}|${r.version}`} gap="md" wrap="nowrap" data-testid="sign-reading">
                    <Text size="sm">{r.skill.name}</Text>
                    <Text size="xs" c="dimmed">
                      {T.readingScope[r.skill.scope]}
                    </Text>
                    <Text size="xs" c="dimmed" className="moyai-num">
                      {T.readingRules(r.skill.rules.length)}
                    </Text>
                    {r.draft ? (
                      <Text size="xs" c="var(--shu-text)">
                        {T.readingDraft}
                      </Text>
                    ) : (
                      <Text size="xs" c="dimmed">
                        {r.approved ? T.readingApproved : T.readingUnapproved}
                      </Text>
                    )}
                  </Group>
                ))}
              </Stack>
            )}
            {dropped > 0 && (
              <Text size="xs" c="var(--shu-text)" data-testid="sign-dropped-plan-rules">
                {T.droppedPlanRules(dropped)}
              </Text>
            )}

            <Stack gap={4} data-testid="sign">
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
                <Text size="xs" c="dimmed" data-testid="sign-as">
                  {T.signAs(name)}
                  {newKey ? ` ${T.keyNew}` : ""}
                </Text>
              )}
            </Stack>

            {error && (
              <Alert color="red" data-testid="confirm-error">
                {error}
              </Alert>
            )}
          </>
        )}
        {done && (
          <>
            {done && (
              <Alert color="teal" data-testid="confirm-done">
                {/* 結果は 1 文だけ（保管先のファイルの道は出さない。版と差分レポートは EXPORT から落とす） */}
                <Text size="sm" fw={700}>
                  {signDoneLine(done, mail)}
                </Text>
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
                  </Group>
                </Stack>
              </Alert>
            )}
          </>
        )}
        {/* 次の版を重ねて署名するとき、比べる版の鎖に確かめていない鍵があれば、主ボタンのすぐ上に 1 行（KeyWarn.dc.html の 3。止めない） */}
        {!done && status?.versions && untrustedSigners(status.versions).length > 0 && (
          <Group justify="flex-end">
            <KeyWarnLine signers={untrustedSigners(status.versions)} onConfirmed={reload} />
          </Group>
        )}
        <Group justify="flex-end" gap="sm">
          {!done && status && blockReason && (
            <Text size="xs" c="dimmed" data-testid="confirm-submit-reason">
              {blockReason}
            </Text>
          )}
          {done ? (
            // 確定のあとに SHARE へ行く道は、上の段の SHARE だけ（閉じるだけ）
            <Button onClick={onClose} data-testid="confirm-close">
              {T.close}
            </Button>
          ) : (
            <>
              <Button variant="default" onClick={onClose}>
                {T.cancel}
              </Button>
              <Button onClick={submit} disabled={!canSubmit} loading={busy} data-testid="confirm-submit">
                {signDialogWords(ask, (status?.latest?.version ?? 0) + 1).submit}
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
    // 前の版に戻した（署名した）ので、前の作業の写しを消す（pwa-v0）
    settleDraft(planId);
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

/** バイト列を base64 に（大きな資料でも引数の上限を越えないよう、少しずつ） */
function base64Of(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 施設の星取表の行の並び（設定の「表示」・AI の screen_set で入れ替えたもの） */
function rowOrderOf(plan: Plan): Record<string, readonly string[]> {
  return { ...displayPrefs(plan.facility.facilityKey).rowOrder };
}
