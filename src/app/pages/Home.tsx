// 作業画面（v0）：橋渡しとのつながりと、確定の試し（人だけの経路の守りを通す）。
// 主ボタンは見出しの行の右端に 1 つだけ。副のボタンはその左。
import { Alert, Anchor, Badge, Button, Container, Group, Modal, Stack, Text, Title, useMantineColorScheme } from "@mantine/core";
import { useEffect, useState } from "react";
import { sha256Hex, type BridgeClient, type ConnectionState } from "../bridge-client";
import { ERROR_TEXT, TEXT } from "../text";
import { APP_PAGES, ROUTES } from "../../shared/routes";

function useConnection(client: BridgeClient): ConnectionState {
  const [s, setS] = useState<ConnectionState>({ kind: "connecting" });
  useEffect(() => client.subscribe(setS), [client]);
  return s;
}

function ConnectionBadge({ state }: { state: ConnectionState }) {
  const color = state.kind === "open" ? "teal" : state.kind === "connecting" ? "gray" : "red";
  return (
    <Badge color={color} variant="light" data-testid="connection" data-state={state.kind}>
      {TEXT.connection[state.kind]}
    </Badge>
  );
}

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

export function Home({ client }: { client: BridgeClient }) {
  const state = useConnection(client);
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const [trialOpen, setTrialOpen] = useState(false);
  const canTrial = state.kind === "open";

  return (
    <Container size="lg" py="lg">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="sm">
          <Title order={2}>{TEXT.appName}</Title>
          <Text c="dimmed">{TEXT.home.title}</Text>
          <ConnectionBadge state={state} />
        </Group>
        <Group gap="sm">
          <Button variant="default" onClick={toggleColorScheme}>
            {colorScheme === "dark" ? TEXT.scheme.toLight : TEXT.scheme.toDark}
          </Button>
          {!canTrial && (
            <Text size="sm" c="dimmed" data-testid="trial-disabled-reason">
              {TEXT.trial.disabledReason}
            </Text>
          )}
          <Button onClick={() => setTrialOpen(true)} disabled={!canTrial} data-testid="trial-open">
            {TEXT.trial.button}
          </Button>
        </Group>
      </Group>

      <Stack gap="md">
        {state.kind === "refused" && (
          <Alert color="red" title={TEXT.connection.refused} data-testid="refused">
            {ERROR_TEXT[state.code]} {TEXT.connection.refusedHelp}
          </Alert>
        )}
        {state.kind === "closed" && (
          <Alert color="orange" title={TEXT.connection.closed}>
            {TEXT.connection.closedHelp}
          </Alert>
        )}
        <Text>{TEXT.home.lead}</Text>
        <Anchor href={APP_PAGES.selftest}>{TEXT.home.selftestLink}</Anchor>
      </Stack>

      <CommitTrialDialog client={client} opened={trialOpen} onClose={() => setTrialOpen(false)} />
    </Container>
  );
}
