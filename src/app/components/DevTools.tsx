// 開発の道具（会期のあいだだけ。設定の画面の下に置く）：確定の試し（人だけの経路の守りを通す）、前の画面への道、Ed25519 の試験のページ。
// トップは星取表だけにするので、ここへ移した（Wire、2026-11-04）。
import { Alert, Anchor, Button, Divider, Group, Modal, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { sha256Hex, type BridgeClient } from "../bridge-client";
import { CHART_HASH } from "../chart/route";
import { useConnection } from "../state/bridge";
import { ERROR_TEXT, HUMAN_TEXT, TEXT } from "../text";
import { APP_PAGES, ROUTES } from "../../shared/routes";

type TrialStep =
  | { kind: "idle" }
  | { kind: "waiting" }
  | { kind: "ready"; token: string; payload: string; expiresAt: number }
  | { kind: "failed"; message: string }
  | { kind: "done" };

function CommitTrialDialog({ client, opened, onClose }: { client: BridgeClient; opened: boolean; onClose: () => void }) {
  const [step, setStep] = useState<TrialStep>({ kind: "idle" });

  useEffect(() => {
    if (!opened) return;
    let live = true;
    setStep({ kind: "waiting" });
    // 確かめのダイアログを開いたときに、この操作と中身のハッシュに結んだ印をもらう
    const payload = JSON.stringify({ action: "commit_trial", openedAt: new Date().toISOString() });
    void (async () => {
      const t = await client.requestToken("commit_trial", await sha256Hex(payload));
      if (!live) return;
      setStep(t ? { kind: "ready", token: t.token, payload, expiresAt: t.expiresAt } : { kind: "failed", message: TEXT.trial.tokenFailed });
    })();
    return () => {
      live = false;
    };
  }, [opened, client]);

  const confirm = async () => {
    if (step.kind !== "ready") return;
    const r = await client.postHuman(ROUTES.commitTrial.path, step.token, step.payload);
    if (r.ok) setStep({ kind: "done" });
    else setStep({ kind: "failed", message: r.code === "network" ? TEXT.connection.closed : ERROR_TEXT[r.code] });
  };

  return (
    <Modal opened={opened} onClose={onClose} title={TEXT.trial.title} centered>
      <Stack>
        <Text size="sm">{TEXT.trial.body}</Text>
        {step.kind === "waiting" && <Text size="sm">{TEXT.trial.waitingToken}</Text>}
        {step.kind === "ready" && (
          <Text size="sm" className="moyai-num" data-testid="trial-token">
            {TEXT.trial.tokenReady(Math.max(0, Math.round((step.expiresAt - Date.now()) / 1000)))}
          </Text>
        )}
        {step.kind === "failed" && (
          <Alert color="red" data-testid="trial-failed">
            {step.message}
          </Alert>
        )}
        {step.kind === "done" && (
          <Alert color="teal" data-testid="trial-done">
            {TEXT.trial.done}
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {TEXT.trial.cancel}
          </Button>
          <Button onClick={confirm} disabled={step.kind !== "ready"} data-testid="trial-confirm">
            {TEXT.trial.confirm}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

export function DevTools() {
  const { client, state } = useConnection();
  const [trialOpen, setTrialOpen] = useState(false);
  const canTrial = state.kind === "open";
  return (
    <>
      <Divider my="xl" label={TEXT.home.title} labelPosition="left" />
      <Stack gap="sm" align="flex-start" data-testid="dev-tools">
        <Text size="sm" c="dimmed">
          {TEXT.home.lead}
        </Text>
        <Group gap="sm">
          <Button variant="default" size="xs" onClick={() => setTrialOpen(true)} disabled={!canTrial} data-testid="trial-open">
            {TEXT.trial.button}
          </Button>
          {!canTrial && (
            <Text size="sm" c="dimmed" data-testid="trial-disabled-reason">
              {TEXT.trial.disabledReason}
            </Text>
          )}
        </Group>
        <Anchor href={APP_PAGES.intake}>{TEXT.home.intakeLink}</Anchor>
        <Anchor href={CHART_HASH}>{TEXT.home.chartLink}</Anchor>
        <Anchor href={APP_PAGES.review}>{TEXT.home.reviewLink}</Anchor>
        <Anchor href={APP_PAGES.checkpoint}>{HUMAN_TEXT.checkpoint.title}</Anchor>
        <Anchor href={APP_PAGES.selftest}>{TEXT.home.selftestLink}</Anchor>
      </Stack>
      <CommitTrialDialog client={client} opened={trialOpen} onClose={() => setTrialOpen(false)} />
    </>
  );
}
