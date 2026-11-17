// 設定の「連携」：つなぎ先を足す（絵は Wire Frame の ConnectAdd。11-17）。
// - 人だけの経路 connect_add（タブの秘密と 1 回きりの印）だけで足す。AI の道具からは足せない。
// - 欄は 4 つ：名前・URL（https://host）・テストか本番（既定を置かない。必ず選ぶ）・API キー（人の入力だけ）。主ボタンは「足す」の 1 つ。
// - 押せないときは、主ボタンの左に「理由：」の 1 行だけ。API キーは送ったら欄を空にし、二度と見せない（橋渡しも返さない）。
import { Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useState } from "react";
import type { BridgeClient } from "../bridge-client";
import { ROUTES } from "../../shared/routes";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";
import { Switch } from "./Switch";

const T = HUMAN_TEXT.settings;
type Env = "test" | "production";

/** 押せない理由（無ければ null） */
export function connectAddStop(f: { label: string; url: string; env: Env | null; apiKey: string }): string | null {
  if (!f.label.trim()) return T.connectAddNeedName;
  if (!f.url.trim()) return T.connectAddNeedUrl;
  if (f.env === null) return T.connectAddNeedEnv;
  if (!f.apiKey) return T.connectAddNeedKey;
  return null;
}

export function ConnectAdd({ client, onAdded }: { client: BridgeClient; onAdded: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [env, setEnv] = useState<Env | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stop = connectAddStop({ label, url, env, apiKey });
  if (!open)
    return (
      <button type="button" className="moyai-inline-act" style={{ marginLeft: 0, alignSelf: "flex-start" }} onClick={() => setOpen(true)} data-testid="connect-add-open">
        {T.connectAddOpen}
      </button>
    );
  const add = async () => {
    if (stop || env === null) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean }>(await client.callHuman("connect_add", ROUTES.connectAdd.path, { label: label.trim(), url: url.trim(), env, apiKey }));
    setBusy(false);
    // キーは送ったら、通っても断られても欄から消す（画面に残さない）
    setApiKey("");
    if (!r.ok) return setError(r.message);
    setError(null);
    setLabel("");
    setUrl("");
    setEnv(null);
    setOpen(false);
    await onAdded();
  };
  return (
    <Stack gap={8} data-testid="connect-add" style={{ maxWidth: 520 }}>
      <TextInput label={T.connectAddName} value={label} onChange={(e) => setLabel(e.currentTarget.value)} maxLength={80} data-testid="connect-add-name" />
      <TextInput label={T.connectAddUrl} value={url} onChange={(e) => setUrl(e.currentTarget.value)} placeholder="https://maximo.example.com" ff="monospace" data-testid="connect-add-url" />
      <Stack gap={2}>
        <Text component="span" fz="sm" fw={400} c="var(--text-3)">
          {T.connectAddEnv}
        </Text>
        <Switch<string>
          aria-label={T.connectAddEnv}
          data-testid="connect-add-env"
          value={env ?? ""}
          onChange={(v) => setEnv(v === "test" || v === "production" ? v : null)}
          data={[
            { value: "test", label: HUMAN_TEXT.connect.envs.test! },
            { value: "production", label: HUMAN_TEXT.connect.envs.production! },
          ]}
        />
      </Stack>
      {/* 伏せ字だけ（見せる切り替えは置かない。キーを画面に出さない） */}
      <TextInput type="password" label={T.connectAddKey} value={apiKey} onChange={(e) => setApiKey(e.currentTarget.value)} autoComplete="off" spellCheck={false} data-testid="connect-add-key" />
      <Group gap="md" justify="flex-end" wrap="nowrap">
        {(stop || error) && (
          <Text size="xs" c={error ? "var(--shu-text)" : "var(--text-3)"} data-testid="connect-add-stop">
            {error ?? `${HUMAN_TEXT.connect.reasonPrefix}${stop}`}
          </Text>
        )}
        <Button onClick={() => void add()} disabled={!!stop || busy} loading={busy} data-testid="connect-add-submit">
          {T.connectAddSubmit}
        </Button>
      </Group>
    </Stack>
  );
}
