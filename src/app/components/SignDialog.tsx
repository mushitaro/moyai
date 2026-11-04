// 承認して署名する／理由を添えて差し戻す（docs/screens.md 3.2 の下の帯・§2.18.2）：いちばん新しい版に、自分の鍵で署名を足す。
// 合言葉はやめた（運営者の決定 2026-11-04、docs/plan.md §2.18）。署名は、人がこのボタンを押したときに決まる。
// 差し戻しは一言の理由が要る。承認は、その版を作った人には押せない（橋渡しが断る）。window.confirm は使わない。
// 承認だけをする人は確定のダイアログを開かないので、この PC にまだ鍵が無ければ、ここで鍵を作ってから署名する。
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
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
    const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("plan_sign", ROUTES.planSign.path, { planId, version, role, reason: reason.trim() }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    onSigned();
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
