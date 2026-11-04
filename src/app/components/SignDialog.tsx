// 承認して署名する／理由を添えて差し戻す（docs/screens.md 3.2 の下の帯・§2.18.2）：いちばん新しい版に、合言葉で開いた自分の鍵で署名を足す。
// 差し戻しは一言の理由が要る。承認は、その版を作った人には押せない（橋渡しが断る）。window.confirm は使わない。
// 承認だけをする人は確定のダイアログを開かないので、この PC にまだ鍵が無ければ、ここで合言葉を決めて（2 回）鍵を作ってから署名する。
import { Alert, Button, Group, Modal, PasswordInput, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { BridgeClient } from "../bridge-client";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = HUMAN_TEXT.approve;

export function SignDialog({
  client,
  planId,
  version,
  role,
  hasKey,
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
  opened: boolean;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [reason, setReason] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!opened) return;
    setReason("");
    setPass("");
    setPass2("");
    setError(null);
  }, [opened]);
  const passOk = hasKey ? pass.length > 0 : pass.length >= 8 && pass === pass2;
  const can = passOk && (role === "approve" || reason.trim().length > 0) && !busy;
  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    if (!hasKey) {
      const k = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("person_key_create", ROUTES.personKeyCreate.path, { passphrase: pass }));
      if (!k.ok) {
        setBusy(false);
        return setError(k.message);
      }
    }
    const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("plan_sign", ROUTES.planSign.path, { planId, version, role, reason: reason.trim(), passphrase: pass }));
    setBusy(false);
    setPass("");
    if (!r.ok) return setError(r.message);
    onSigned();
    onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={role === "approve" ? T.titleApprove(version) : T.titleReturn(version)} size="lg" centered data-testid="sign-dialog">
      <Stack gap="sm">
        <Text size="sm">{role === "approve" ? T.leadApprove : T.leadReturn}</Text>
        <TextInput label={role === "approve" ? T.reasonOptional : T.reason} value={reason} onChange={(e) => setReason(e.currentTarget.value)} maxLength={500} data-testid="sign-reason" />
        <Group grow align="flex-start">
          <PasswordInput label={hasKey ? HUMAN_TEXT.confirm.passphrase : HUMAN_TEXT.confirm.passphraseNew} value={pass} onChange={(e) => setPass(e.currentTarget.value)} autoComplete="off" data-testid="sign-dialog-passphrase" />
          {!hasKey && (
            <PasswordInput label={HUMAN_TEXT.confirm.passphraseAgain} value={pass2} onChange={(e) => setPass2(e.currentTarget.value)} autoComplete="off" data-testid="sign-dialog-passphrase-again" />
          )}
        </Group>
        {error && (
          <Alert color="gray" data-testid="sign-error">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" gap="sm">
          {!can && (
            <Text size="xs" c="dimmed">
              {role === "return" && reason.trim().length === 0 ? T.reasonEmpty : T.passEmpty}
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
