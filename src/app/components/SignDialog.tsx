// 承認して署名する／理由を添えて差し戻す（docs/screens.md 3.2 の下の帯・§2.18.2）：いちばん新しい版に、自分の鍵で署名を足す。
// 合言葉はやめた（運営者の決定 2026-11-04、docs/plan.md §2.18）。署名は、人がこのボタンを押したときに決まる。
// 差し戻しは一言の理由が要る。承認は、その版を作った人には押せない（橋渡しが断る）。window.confirm は使わない。
// 承認だけをする人は確定のダイアログを開かないので、この PC にまだ鍵が無ければ、ここで鍵を作ってから署名する。
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { BridgeClient } from "../bridge-client";
import { HUMAN_TEXT, TEXT } from "../text";
import { versionName } from "../version-name";
import { readHuman } from "./ConfirmDialog";
import { KeyWarnLine, type TrustSig } from "./KeyWarn";

const T = HUMAN_TEXT.approve;

/**
 * 承認・差し戻しの結果の 1 文（docs/screens.md §3.4 の末尾）。承認した版は年度で呼ぶ（「令和 8 年度版（第 1 版）を承認しました。」）。
 * 差し戻しは署名で版にならないので年度を付けない（「第 1 版を差戻しました。」）。at は承認の署名の時刻、startMonth は施設の年度の始まり（見せ方だけ）
 */
export function signResultLine(role: "approve" | "return", version: number, at: string | null, startMonth: number | null): string {
  return TEXT.merge.signed(role, version, versionName(version, role === "approve" ? at : null, startMonth));
}

export function SignDialog({
  client,
  planId,
  version,
  role,
  hasKey,
  untrusted = [],
  onKeyConfirmed,
  opened,
  onClose,
  onSigned,
}: {
  client: BridgeClient;
  planId: string;
  version: number;
  role: "approve" | "return";
  /** この PC に、設定の呼び名の鍵があるか */
  hasKey: boolean;
  /** 頼まれた版を作った鍵のうち、まだ確かめていないもの（主ボタンのすぐ上に 1 行。止めない） */
  untrusted?: readonly TrustSig[];
  onKeyConfirmed?: () => void;
  opened: boolean;
  onClose: () => void;
  /** at は署名の時刻（橋渡しが返したもの。古い橋渡しなら null） */
  onSigned: (at: string | null) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!opened) return;
    setReason("");
    setError(null);
  }, [opened]);
  const can = (role === "approve" || reason.trim().length > 0) && !busy;
  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    if (!hasKey) {
      const k = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("person_key_create", ROUTES.personKeyCreate.path, {}));
      if (!k.ok) {
        setBusy(false);
        return setError(k.message);
      }
    }
    const r = readHuman<{ ok: boolean; reason?: string; at?: string }>(await client.callHuman("plan_sign", ROUTES.planSign.path, { planId, version, role, reason: reason.trim() }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // 署名したら、前の作業の写しを消す（pwa-v0）
    onSigned(r.body.at ?? null);
    onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={role === "approve" ? T.titleApprove(version) : T.titleReturn(version)} size="lg" centered data-testid="sign-dialog">
      <Stack gap="sm">
        <Text size="sm">{role === "approve" ? T.leadApprove : T.leadReturn}</Text>
        <TextInput label={role === "approve" ? T.reasonOptional : T.reason} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} data-testid="sign-reason" />
        {!hasKey && (
          <Text size="xs" c="dimmed" data-testid="sign-dialog-new-key">
            {HUMAN_TEXT.confirm.keyNew}
          </Text>
        )}
        {error && (
          <Alert color="gray" data-testid="sign-error">
            {error}
          </Alert>
        )}
        {untrusted.length > 0 && (
          <Group justify="flex-end">
            <KeyWarnLine signers={untrusted} onConfirmed={() => onKeyConfirmed?.()} />
          </Group>
        )}
        <Group justify="flex-end" gap="sm">
          {!can && role === "return" && reason.trim().length === 0 && (
            <Text size="xs" c="dimmed">
              {T.reasonEmpty}
            </Text>
          )}
          <Button variant="default" onClick={onClose}>
            {HUMAN_TEXT.confirm.cancel}
          </Button>
          <Button onClick={() => void submit()} disabled={!can} loading={busy} data-testid="sign-submit">
            {role === "approve" ? T.submitApprove : T.submitReturn}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
