// GitHub につなぐ（SHARE の公開の台帳。docs/plan.md §2.12 の通信の例外、絵は SharePublic.dc.html）：
// 合言葉を打って「コードを出す」→ 橋渡しが OAuth のデバイスフローを始め、台帳の自分の鍵を同じ合言葉で作るか開く →
// 人が github.com でコードを入れる → 橋渡しがトークンを合言葉で包んで状態フォルダに置く。トークンは画面に来ない。
import { Anchor, Button, Group, Modal, PasswordInput, Stack, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import { useConnection } from "../state/bridge";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = HUMAN_TEXT.github;
const POLL_MS = 2000;

type State = "waiting" | "ok" | "denied" | "expired" | "failed";

export function GitHubConnect({ opened, packId, onClose, onConnected }: { opened: boolean; packId: string; onClose: () => void; onConnected: (login: string) => void }) {
  const { client } = useConnection();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [login, setLogin] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) {
      setPass("");
      setError(null);
      setCode(null);
      setState(null);
      setLogin(null);
    }
  }, [opened]);

  // 人が github.com でコードを入れるまで、橋渡しに様子を聞く（橋渡しが GitHub に聞く間隔は GitHub が決める）
  useEffect(() => {
    if (!code || state !== "waiting") return;
    const t = setInterval(() => {
      void (async () => {
        const r = readHuman<{ ok: boolean; reason?: string; state: State | "none"; login: string | null }>(await client.callHuman("github_connect_state", ROUTES.githubConnectState.path, {}));
        if (!r.ok) return setError(r.message);
        if (r.body.state === "none" || r.body.state === "waiting") return;
        setState(r.body.state);
        if (r.body.state === "ok" && r.body.login) {
          setLogin(r.body.login);
          onConnected(r.body.login);
        }
      })();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [client, code, state, onConnected]);

  const start = async () => {
    setBusy(true);
    setError(null);
    const r = readHuman<{ ok: boolean; reason?: string; userCode: string; verificationUri: string }>(await client.callHuman("github_connect_start", ROUTES.githubConnectStart.path, { packId, passphrase: pass }));
    setBusy(false);
    setPass("");
    if (!r.ok) return setError(r.message);
    setCode({ userCode: r.body.userCode, verificationUri: r.body.verificationUri });
    setState("waiting");
  };

  return (
    <Modal opened={opened} onClose={onClose} title={T.title} centered data-testid="github-connect">
      <Stack gap="md">
        {!code && (
          <Group gap="sm" align="flex-end" wrap="nowrap">
            <PasswordInput
              label={T.passphrase}
              value={pass}
              onChange={(e) => setPass(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pass) void start();
              }}
              style={{ flex: 1 }}
              data-testid="github-passphrase"
            />
            <Button onClick={() => void start()} disabled={!pass} loading={busy} data-testid="github-start">
              {T.start}
            </Button>
          </Group>
        )}
        {code && (
          <Stack gap={6}>
            <Text size="sm">{T.code}</Text>
            <Text size="xl" fw={600} ff="monospace" style={{ letterSpacing: "0.2em" }} data-testid="github-user-code">
              {code.userCode}
            </Text>
            <Anchor href={code.verificationUri} target="_blank" rel="noopener noreferrer" size="sm" data-testid="github-verify-link">
              {T.open}
            </Anchor>
            <Text size="xs" c={state === "ok" ? "var(--text)" : state === "waiting" ? "dimmed" : "var(--shu-text)"} data-testid="github-state" data-state={state ?? ""}>
              {state === "ok" ? (login ? T.ok(login) : "") : state === "waiting" ? T.waiting : state ? T[state] : ""}
            </Text>
          </Stack>
        )}
        {error && (
          <Text size="sm" c="var(--shu-text)" data-testid="github-error">
            {error}
          </Text>
        )}
        {state === "ok" && (
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose} data-testid="github-close">
              {T.close}
            </Button>
          </Group>
        )}
      </Stack>
    </Modal>
  );
}
