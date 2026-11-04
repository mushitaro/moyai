// 頼み直す（Wire の B1）：同じ頼むことと宛先を入れた形で開き、宛先とひとことは直せる。主ボタンのすぐ上に結果の 1 文「前のリンクは使えなくなります。」。
// 押すと、新しい頼みに署名して置き（人だけの経路 request_renew）、渡すメールの文を出す（送るのは自分のメーラーか Claude。MOYAI は送らない）。
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { BridgeClient } from "../bridge-client";
import { mailtoOf, setHandoffMail, type HandoffMail } from "../state/handoff";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = HUMAN_TEXT.request;
const C = HUMAN_TEXT.confirm;

export function RequestRenewDialog({
  client,
  planId,
  version,
  to: initialTo,
  opened,
  onClose,
  onRenewed,
}: {
  client: BridgeClient;
  planId: string;
  version: number;
  to: string;
  opened: boolean;
  onClose: () => void;
  onRenewed: () => void;
}) {
  const [to, setTo] = useState(initialTo);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mail, setMail] = useState<HandoffMail | null>(null);
  useEffect(() => {
    if (!opened) return;
    setTo(initialTo);
    setNote("");
    setError(null);
    setMail(null);
  }, [opened, initialTo]);
  const can = /^[^\s@]+@[^\s@]+$/.test(to.trim()) && !busy && !mail;
  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    const r = readHuman<{ ok: boolean; reason?: string; mail: HandoffMail }>(await client.callHuman("request_renew", ROUTES.requestRenew.path, { planId, version, to: to.trim(), note: note.trim() }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setMail(r.body.mail);
    setHandoffMail(r.body.mail);
    onRenewed();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={T.renewTitle(version)} size="lg" centered data-testid="renew-dialog">
      <Stack gap="sm">
        <TextInput label={C.mailTo} value={to} onChange={(e) => setTo(e.currentTarget.value)} disabled={!!mail} data-testid="renew-to" />
        <TextInput label={C.reason} value={note} onChange={(e) => setNote(e.currentTarget.value)} maxLength={1000} disabled={!!mail} data-testid="renew-note" />
        {mail && (
          <Alert color="gray" p="xs" data-testid="renew-mail">
            <Stack gap={4}>
              <Text size="xs">
                {C.mailTo}：{mail.to}
              </Text>
              <Text size="xs">
                {C.mailSubject}：{mail.subject}
              </Text>
              <Text size="xs" style={{ whiteSpace: "pre-wrap" }}>
                {mail.body}
              </Text>
              <Group>
                <Button component="a" href={mailtoOf(mail)} variant="default" size="xs" data-testid="renew-mailto">
                  {C.mailOpen}
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}
        {error && (
          <Text size="sm" c="var(--shu-text)">
            {error}
          </Text>
        )}
        {!mail && (
          <Group justify="flex-end">
            <Text size="xs" c="var(--shu-text)">
              {T.renewResult}
            </Text>
          </Group>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {mail ? C.close : C.cancel}
          </Button>
          {!mail && (
            <Button onClick={() => void submit()} disabled={!can} loading={busy} data-testid="renew-submit">
              {T.renewSubmit}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
