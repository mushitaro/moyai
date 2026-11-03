// 設定（docs/plan.md §2.14）：置き場所（Documents と同期フォルダの知らせ）、輪のフォルダと鍵。
// 主ボタンは「保存」（変えたときだけ）で、見出しの行の右端。輪を作るのは副のボタンから開くダイアログ。
import { Alert, Button, Code, Container, Group, Modal, NativeSelect, PasswordInput, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import { SyncedNotice, readHuman } from "../components/ConfirmDialog";
import { useConnection } from "../state/bridge";
import { HUMAN_TEXT } from "../text";

const T = HUMAN_TEXT.settings;

interface Synced {
  kind: "onedrive" | "sharepoint";
  base: string;
}
interface SettingsBody {
  ok: boolean;
  reason?: string;
  documents: string | null;
  documentsSynced: Synced | null;
  defaultRoot: string | null;
  chosenRoot: string | null;
  root: string | null;
  rootSynced: Synced | null;
  rings: { ringId: string; root: string; pack: string; key: string; fingerprint: string | null; synced: Synced | null }[];
  packs: { id: string; name: string; ready: boolean; reason: string | null }[];
}

export function Fingerprint({ value }: { value: string }) {
  return (
    <Text component="span" ff="monospace" fw={700} size="lg" className="moyai-num" data-testid="fingerprint" style={{ letterSpacing: "0.08em" }}>
      {value}
    </Text>
  );
}

function CreateRingDialog({ opened, onClose, packs, onCreated }: { opened: boolean; onClose: () => void; packs: SettingsBody["packs"]; onCreated: () => void }) {
  const { client } = useConnection();
  const [folder, setFolder] = useState("");
  const [pack, setPack] = useState("");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ringId: string; fingerprint: string; synced: Synced | null } | null>(null);
  useEffect(() => {
    if (!opened) return;
    setFolder("");
    setA("");
    setB("");
    setError(null);
    setDone(null);
    setPack(packs.find((p) => p.ready)?.id ?? "");
  }, [opened, packs]);
  const mismatch = b.length > 0 && a !== b;
  const can = folder.trim().length > 0 && pack !== "" && a.length >= 8 && a === b && !busy && !done;
  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    const r = readHuman<{ ok: boolean; reason?: string; ringId: string; fingerprint: string; synced: Synced | null }>(
      await client.callHuman("ring_create", ROUTES.ringCreate.path, { root: folder.trim(), packId: pack, passphrase: a }),
    );
    setBusy(false);
    setA("");
    setB("");
    if (!r.ok) return setError(r.message);
    setDone({ ringId: r.body.ringId, fingerprint: r.body.fingerprint, synced: r.body.synced });
    onCreated();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={T.createTitle} size="lg" centered>
      <Stack gap="sm">
        <Text size="sm">{T.createLead}</Text>
        <TextInput label={T.folder} value={folder} onChange={(e) => setFolder(e.currentTarget.value)} data-testid="ring-folder" disabled={!!done} />
        <NativeSelect
          label={T.pack}
          value={pack}
          onChange={(e) => setPack(e.currentTarget.value)}
          data={packs.map((p) => ({ value: p.id, label: p.ready ? p.name : `${p.name} ${T.packNotReady(HUMAN_TEXT.packReason[p.reason ?? ""] ?? "")}`, disabled: !p.ready }))}
          data-testid="ring-pack"
          disabled={!!done}
        />
        <PasswordInput label={T.passphrase} value={a} onChange={(e) => setA(e.currentTarget.value)} data-testid="ring-pass" disabled={!!done} />
        <PasswordInput label={T.passphraseAgain} value={b} onChange={(e) => setB(e.currentTarget.value)} error={mismatch ? T.passphraseMismatch : undefined} data-testid="ring-pass2" disabled={!!done} />
        {error && <Alert color="red">{error}</Alert>}
        {done && (
          <Alert color="teal" data-testid="ring-created">
            <Stack gap={4}>
              <Text size="sm">{T.created}</Text>
              <Group gap="xs">
                <Text size="sm">{T.fingerprint}</Text>
                <Fingerprint value={done.fingerprint} />
              </Group>
              <SyncedNotice synced={done.synced} kind="ring" />
            </Stack>
          </Alert>
        )}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {HUMAN_TEXT.confirm.close}
          </Button>
          {!done && (
            <Button onClick={submit} disabled={!can} loading={busy} data-testid="ring-create-submit">
              {T.createSubmit}
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}

export function Settings() {
  const { client, state } = useConnection();
  const [s, setS] = useState<SettingsBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const r = readHuman<SettingsBody>(await client.callHuman("settings_read", ROUTES.settingsRead.path, {}));
    if (!r.ok) return setError(r.message);
    setError(null);
    setS(r.body);
    setRoot(r.body.chosenRoot ?? "");
  }, [client]);

  useEffect(() => {
    if (state.kind === "open") void load();
  }, [state.kind, load]);

  const changed = s !== null && (root.trim() === "" ? null : root.trim()) !== s.chosenRoot;
  const save = async () => {
    if (!changed) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("settings_save", ROUTES.settingsSave.path, { root: root.trim() === "" ? null : root.trim() }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setSaved(true);
    await load();
  };

  return (
    <Container size="lg" py="lg" data-testid="settings-page">
      <Group justify="space-between" align="center" mb="md">
        <Group gap="sm">
          <Title order={2}>{T.title}</Title>
        </Group>
        <Group gap="sm">
          <Button variant="default" onClick={() => setCreateOpen(true)} disabled={!s} data-testid="ring-create-open">
            {T.create}
          </Button>
          {!changed && (
            <Text size="xs" c="dimmed">
              {state.kind === "open" ? T.saveDisabled : HUMAN_TEXT.notConnected}
            </Text>
          )}
          <Button onClick={save} disabled={!changed} loading={busy} data-testid="settings-save">
            {T.save}
          </Button>
        </Group>
      </Group>
      <Stack gap="lg">
        {error && <Alert color="red">{error}</Alert>}
        {!s && !error && <Text size="sm">{T.loading}</Text>}
        {s && (
          <>
            <Stack gap="xs">
              <Title order={4}>{T.rootTitle}</Title>
              <Group gap="xs">
                <Text size="sm" fw={700}>
                  {T.documents}
                </Text>
                {s.documents ? <Code data-testid="documents-path">{s.documents}</Code> : <Text size="sm">{T.documentsUnknown}</Text>}
              </Group>
              <SyncedNotice synced={s.documentsSynced} kind="root" />
              <Group gap="xs">
                <Text size="sm" fw={700}>
                  {T.defaultRoot}
                </Text>
                <Code>{s.defaultRoot ?? "—"}</Code>
              </Group>
              <Group gap="xs">
                <Text size="sm" fw={700}>
                  {T.current}
                </Text>
                <Code data-testid="current-root">{s.root ?? "—"}</Code>
              </Group>
              {s.chosenRoot && <SyncedNotice synced={s.rootSynced} kind="root" />}
              <Group align="flex-end" gap="sm">
                <TextInput style={{ flex: 1 }} label={T.rootInput} value={root} onChange={(e) => (setRoot(e.currentTarget.value), setSaved(false))} placeholder={s.defaultRoot ?? ""} data-testid="root-input" />
                <Button variant="default" onClick={() => setRoot("")} disabled={root === ""}>
                  {T.useDefault}
                </Button>
              </Group>
              {saved && (
                <Text size="sm" c="teal" data-testid="settings-saved">
                  {T.saved}
                </Text>
              )}
            </Stack>
            <Stack gap="xs">
              <Title order={4}>{T.ringsTitle}</Title>
              <Text size="xs" c="dimmed">
                {T.ringsLead}
              </Text>
              {s.rings.length === 0 ? (
                <Text size="sm">{T.noRings}</Text>
              ) : (
                <Table withTableBorder data-testid="rings-table">
                  <Table.Thead>
                    <Table.Tr>
                      {T.ringHead.map((h) => (
                        <Table.Th key={h}>{h}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {s.rings.map((r) => (
                      <Table.Tr key={r.ringId}>
                        <Table.Td ff="monospace">{r.ringId}</Table.Td>
                        <Table.Td>
                          <Code>{r.root}</Code>
                          <SyncedNotice synced={r.synced} kind="ring" />
                        </Table.Td>
                        <Table.Td>{s.packs.find((p) => p.id === r.pack)?.name ?? r.pack}</Table.Td>
                        <Table.Td>{r.fingerprint ? <Fingerprint value={r.fingerprint} /> : "—"}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <Text size="xs" c="dimmed">
                {T.join} {T.peersNotYet}
              </Text>
            </Stack>
          </>
        )}
      </Stack>
      {s && <CreateRingDialog opened={createOpen} onClose={() => setCreateOpen(false)} packs={s.packs} onCreated={() => void load()} />}
    </Container>
  );
}
