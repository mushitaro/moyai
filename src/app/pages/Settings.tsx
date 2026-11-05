// 設定（docs/plan.md §2.14）：置き場所（Documents と同期フォルダの知らせ）、輪のフォルダと鍵、公開の台帳の clone の場所（受け手が読む）、
// 自分の呼び名と署名の鍵（§2.18.2。ほかの人の鍵は、指紋を読み合わせて人が確認済みにする）。
// 主ボタンは「保存」（変えたときだけ）で、見出しの行の右端。輪を作るのは副のボタンから開くダイアログ。
import { Alert, Button, Code, Container, Group, Modal, NativeSelect, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import { SyncedNotice, readHuman } from "../components/ConfirmDialog";
import { DevTools } from "../components/DevTools";
import { KeyCheckDialog, type TrustSig } from "../components/KeyWarn";
import { useConnection } from "../state/bridge";
import { HUMAN_TEXT, TEXT } from "../text";

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
  ledger: string | null;
  /** 公開の台帳へ PR を出す GitHub のアカウント（トークンは画面に来ない） */
  github: string | null;
  rings: { ringId: string; root: string; pack: string; key: string; fingerprint: string | null; synced: Synced | null }[];
  packs: { id: string; name: string; ready: boolean; reason: string | null }[];
  name: string | null;
  people: { by: string; key: string; pub: string; fingerprint: string; confirmed: boolean; own: boolean; changed: boolean; firstSeen: string; previous?: { fingerprint: string; at: string } | null }[];
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ringId: string; fingerprint: string; synced: Synced | null } | null>(null);
  // 開いたときだけ消す（作ったあとに設定を読み直すと packs が替わるが、そのときに作った知らせと指紋を消さない）
  useEffect(() => {
    if (!opened) return;
    setFolder("");
    setError(null);
    setDone(null);
  }, [opened]);
  const firstReady = packs.find((p) => p.ready)?.id ?? "";
  useEffect(() => {
    if (opened) setPack((cur) => cur || firstReady);
  }, [opened, firstReady]);
  const can = folder.trim().length > 0 && pack !== "" && !busy && !done;
  const submit = async () => {
    if (!can) return;
    setBusy(true);
    setError(null);
    const r = readHuman<{ ok: boolean; reason?: string; ringId: string; fingerprint: string; synced: Synced | null }>(
      await client.callHuman("ring_create", ROUTES.ringCreate.path, { root: folder.trim(), packId: pack }),
    );
    setBusy(false);
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
  const [ledger, setLedger] = useState("");
  const [name, setName] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    const r = readHuman<SettingsBody>(await client.callHuman("settings_read", ROUTES.settingsRead.path, {}));
    if (!r.ok) return setError(r.message);
    setError(null);
    setS(r.body);
    setRoot(r.body.chosenRoot ?? "");
    setLedger(r.body.ledger ?? "");
    setName(r.body.name ?? "");
  }, [client]);

  useEffect(() => {
    if (state.kind === "open") void load();
  }, [state.kind, load]);

  const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
  const changed = s !== null && (orNull(root) !== s.chosenRoot || orNull(ledger) !== s.ledger || orNull(name) !== s.name);
  const save = async () => {
    if (!changed) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("settings_save", ROUTES.settingsSave.path, { root: orNull(root), ledger: orNull(ledger), name: orNull(name) }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setSaved(true);
    await load();
  };
  // ほかの人の鍵を、指紋を読み合わせて確認済みにする（人だけの経路）。どこからでも同じ読み合わせのダイアログを開く（KeyWarn.dc.html の 7）
  const [check, setCheck] = useState<TrustSig | null>(null);

  return (
    <Container size="lg" py="lg" data-testid="settings-page">
      <KeyCheckDialog signer={check} onClose={() => setCheck(null)} onConfirmed={() => void load()} />
      <Group justify="space-between" align="center" mb="md">
        <Group gap="sm">
          <Title order={2}>{T.title}</Title>
          <a className="moyai-inline-act" href={APP_PAGES.industries} data-testid="industries-link">
            {TEXT.industries.link}
          </a>
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
            <Stack gap="xs" data-testid="name-setting">
              <Title order={4}>{T.nameTitle}</Title>
              <Text size="xs" c="dimmed">
                {T.nameLead}
              </Text>
              <Group gap="xs">
                <Text size="sm" fw={700}>
                  {T.current}
                </Text>
                <Code data-testid="current-name">{s.name ?? T.nameNone}</Code>
              </Group>
              <TextInput label={T.nameInput} value={name} maxLength={40} onChange={(e) => (setName(e.currentTarget.value), setSaved(false))} data-testid="name-input" />
            </Stack>
            <Stack gap="xs" data-testid="people">
              <Title order={4}>{T.peopleTitle}</Title>
              <Text size="xs" c="dimmed">
                {T.peopleLead}
              </Text>
              {s.people.length === 0 ? (
                <Text size="sm">{T.peopleNone}</Text>
              ) : (
                <Table withTableBorder data-testid="people-table">
                  <Table.Thead>
                    <Table.Tr>
                      {T.peopleHead.map((h, i) => (
                        <Table.Th key={i}>{h}</Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {s.people.map((p) => (
                      <Table.Tr key={p.key} data-testid="person" data-key={p.key}>
                        <Table.Td>{p.by}</Table.Td>
                        <Table.Td>
                          <Fingerprint value={p.fingerprint} />
                        </Table.Td>
                        <Table.Td c={p.changed ? "var(--shu-text)" : undefined}>{p.own ? T.own : p.confirmed ? T.confirmed : p.changed ? HUMAN_TEXT.history.trust.changed : T.unconfirmed}</Table.Td>
                        <Table.Td>
                          {!p.own && !p.confirmed && (
                            <Button
                              size="compact-sm"
                              variant="default"
                              onClick={() => setCheck({ role: "confirm", by: p.by, pub: p.pub, fingerprint: p.fingerprint, trust: p.changed ? "changed" : "unconfirmed", previous: p.previous ?? null })}
                              data-testid="person-confirm"
                            >
                              {T.confirmKey}
                            </Button>
                          )}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
            </Stack>
            <Stack gap="xs" data-testid="ledger-setting">
              <Title order={4}>{T.ledgerTitle}</Title>
              <Text size="xs" c="dimmed">
                {T.ledgerLead}
              </Text>
              <Group gap="xs">
                <Text size="sm" fw={700}>
                  {T.current}
                </Text>
                <Code data-testid="current-ledger">{s.ledger ?? T.ledgerNone}</Code>
              </Group>
              <TextInput label={T.ledgerInput} value={ledger} onChange={(e) => (setLedger(e.currentTarget.value), setSaved(false))} data-testid="ledger-input" />
              <Group gap="sm" align="center" data-testid="github-setting">
                <Text size="sm" data-testid="settings-github">
                  {s.github ? HUMAN_TEXT.github.connectedAs(s.github) : HUMAN_TEXT.github.none}
                </Text>
                {s.github && (
                  <Button
                    size="xs"
                    variant="default"
                    onClick={() =>
                      void (async () => {
                        const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("github_disconnect", ROUTES.githubDisconnect.path, {}));
                        if (r.ok) setS((x) => (x ? { ...x, github: null } : x));
                      })()
                    }
                    data-testid="github-disconnect"
                  >
                    {HUMAN_TEXT.github.disconnect}
                  </Button>
                )}
              </Group>
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
      <DevTools />
    </Container>
  );
}
