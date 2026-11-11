// 設定（docs/plan.md §2.14）：置き場所（Documents と同期フォルダの知らせ）、輪のフォルダと鍵、公開の台帳の clone の場所（受け手が読む）、
// 自分の呼び名と署名の鍵（§2.18.2。ほかの人の鍵は、指紋を読み合わせて人が確認済みにする）。
// 主ボタンは「保存」（変えたときだけ）で、見出しの行の右端。1 列で、左に節の名前（168px）、右に中身。見出しの下の説明の文は置かない（docs/screens.md 3.7）。
// 値の欄は「| 変更」を押したときだけ入力を開く（Wire、11-06）。共有フォルダを作るのは、その節の「| ＋ 共有フォルダを作成」から開くダイアログ。
import { Alert, Button, Container, Group, Modal, NativeSelect, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import { SyncedNotice, readHuman } from "../components/ConfirmDialog";
import { DevTools } from "../components/DevTools";
import { NoneMark } from "../components/NoneMark";
import { KeyCheckDialog, type TrustSig } from "../components/KeyWarn";
import { packVersion } from "../chart/catalog";
import { useConnection } from "../state/bridge";
import { takeRootOffer, useRootOffer } from "../state/screen";
import { ThemeChoice } from "../components/ThemeChoice";
import { Switch } from "../components/Switch";
import { useWorkingPlan } from "../state/plan-store";
import { DisplaySettings } from "../components/DisplaySettings";
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
  /** 最新の確かめ（#65 の 5）。古い橋渡しは送らない */
  autoUpdate?: boolean;
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


/** 道・名前の値（地なしの等幅。値を地の色の箱に入れない。Wire、11-06） */
function Val({ children, testid, mono = true }: { children: React.ReactNode; testid?: string; mono?: boolean }) {
  return (
    <Text component="span" size="sm" ff={mono ? "monospace" : undefined} data-testid={testid} style={{ overflowWrap: "anywhere" }}>
      {children}
    </Text>
  );
}

/** Claude が保存先の欄に入れたときの、欄の下の 1 行：朱の小さな字「- Claude の入力」と、その右に text-3 で「前　（元の道）」 */
export function RootOffered({ before }: { before: string | null }) {
  return (
    <Group gap="md" wrap="nowrap" align="baseline" data-testid="root-offered">
      <Text size="xs" c="var(--shu-text)" style={{ whiteSpace: "nowrap", letterSpacing: "0.1em" }} data-testid="root-offered-mark">
        {T.rootOfferedMark}
      </Text>
      <Text size="xs" c="var(--text-3)" data-testid="root-offered-before" style={{ overflowWrap: "anywhere" }}>
        {`${T.rootBefore}　`}
        <Text span size="xs" ff="monospace" c="var(--text-3)">
          {before ?? <NoneMark />}
        </Text>
      </Text>
    </Group>
  );
}

export function Settings() {
  const { client, state } = useConnection();
  const [s, setS] = useState<SettingsBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [root, setRoot] = useState("");
  const [ledger, setLedger] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // 値の欄は「| 変更」を押したときだけ入力を開く（docs/screens.md 3.7。Wire、11-06）
  const [editRoot, setEditRoot] = useState(false);
  const [editName, setEditName] = useState(false);
  const [editLedger, setEditLedger] = useState(false);

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

  // Claude が screen_set で渡した保存先の道（橋渡しが設定と同じ確かめを通したもの）：保存先の欄に入れて開くだけ。保存は人が押す
  const offered = useRootOffer();
  // Claude が入れた道（人が欄を書き替えたら、Claude の入力ではなくなる）
  const [rootOffered, setRootOffered] = useState<string | null>(null);
  useEffect(() => {
    if (!s || offered === null) return;
    const path = takeRootOffer();
    if (path === null) return;
    setRoot(path);
    setEditRoot(true);
    setRootOffered(path);
  }, [s, offered]);
  const working = useWorkingPlan();

  const orNull = (v: string) => (v.trim() === "" ? null : v.trim());
  const changed = s !== null && (orNull(root) !== s.chosenRoot || orNull(ledger) !== s.ledger || orNull(name) !== s.name);
  const save = async () => {
    if (!changed) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("settings_save", ROUTES.settingsSave.path, { root: orNull(root), ledger: orNull(ledger), name: orNull(name) }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // 保存できたら入力を閉じる（「保存しました」は置かない。保存のボタンが押せなくなる。docs/words.md）
    setEditRoot(false);
    setRootOffered(null);
    setEditName(false);
    setEditLedger(false);
    await load();
  };
  const saveAutoUpdate = async (on: boolean) => {
    if (!s) return;
    const r = readHuman<{ ok: boolean }>(await client.callHuman("settings_save", ROUTES.settingsSave.path, { root: s.chosenRoot, autoUpdate: on }));
    if (!r.ok) return setError(r.message);
    await load();
  };
  // ほかの人の鍵を、指紋を読み合わせて確認済みにする（人だけの経路）。どこからでも同じ読み合わせのダイアログを開く（KeyWarn.dc.html の 7）
  const [check, setCheck] = useState<TrustSig | null>(null);

  const change = (open: boolean, set: (v: boolean) => void, testid: string) => (
    <button type="button" className="moyai-inline-act" onClick={() => set(!open)} aria-expanded={open} data-testid={testid}>
      {T.change}
    </button>
  );
  const row = (title: string, body: React.ReactNode, testid?: string) => (
    <div className="moyai-settings-row" data-testid={testid}>
      <Text size="sm" c="var(--text-3)" className="moyai-settings-name">
        {title}
      </Text>
      <div style={{ minWidth: 0 }}>{body}</div>
    </div>
  );
  const rootMarks = s ? [!s.chosenRoot ? T.defaultMark : null, s.rootSynced || (!s.chosenRoot && s.documentsSynced) ? T.syncedMark : null].filter(Boolean).join("・") : "";

  return (
    <Container size="lg" py="lg" data-testid="settings-page">
      <KeyCheckDialog signer={check} onClose={() => setCheck(null)} onConfirmed={() => void load()} />
      <Group justify="space-between" align="center" mb="lg">
        <Title order={2}>{T.title}</Title>
        <Group gap="sm" wrap="nowrap">
          {!changed && (
            <Text size="xs" c="var(--text-3)" data-testid="settings-save-reason">
              {state.kind === "open" ? T.saveDisabled : HUMAN_TEXT.notConnected}
            </Text>
          )}
          <Button onClick={save} disabled={!changed} loading={busy} data-testid="settings-save">
            {T.save}
          </Button>
        </Group>
      </Group>
      {error && <Alert color="red">{error}</Alert>}
      {!s && !error && <Text size="sm">{T.loading}</Text>}
      {s && (
        <div className="moyai-settings">
          {row(
            T.rootTitle,
            <Stack gap={6}>
              <Group gap="sm" wrap="nowrap" align="baseline">
                <Val testid="current-root">{s.root ?? <NoneMark />}</Val>
                {rootMarks && (
                  <Text size="xs" c="var(--text-3)" style={{ whiteSpace: "nowrap" }}>
                    {rootMarks}
                  </Text>
                )}
                {change(editRoot, setEditRoot, "root-change")}
              </Group>
              {editRoot && (
                <>
                  <Text size="xs" c="var(--text-3)">
                    {T.documents} {s.documents ? <Val testid="documents-path">{s.documents}</Val> : T.documentsUnknown}
                  </Text>
                  <SyncedNotice synced={s.documentsSynced} kind="root" />
                  {s.chosenRoot && <SyncedNotice synced={s.rootSynced} kind="root" />}
                  <Group align="flex-end" gap="sm">
                    <TextInput style={{ flex: 1 }} label={T.rootInput} value={root} onChange={(e) => setRoot(e.currentTarget.value)} placeholder={s.defaultRoot ?? ""} data-testid="root-input" />
                    <Button variant="default" onClick={() => setRoot("")} disabled={root === ""}>
                      {T.useDefault}
                    </Button>
                  </Group>
                  {/* Claude が入れた道：欄の下に朱の小さな字「- Claude の入力」と、text-3 の「前　（元の道）」。保存は人が上の行の「| 保存」で（docs/screens.md 3.7） */}
                  {rootOffered !== null && root === rootOffered && <RootOffered before={s.root} />}
                </>
              )}
            </Stack>,
            "root-setting",
          )}
          {row(
            T.nameTitle,
            <Stack gap={6}>
              <Group gap="sm" wrap="nowrap" align="baseline">
                <Val testid="current-name" mono={false}>
                  {s.name ?? T.nameNone}
                </Val>
                {change(editName, setEditName, "name-change")}
              </Group>
              {editName && <TextInput label={T.nameInput} value={name} maxLength={40} onChange={(e) => setName(e.currentTarget.value)} data-testid="name-input" style={{ maxWidth: 360 }} />}
            </Stack>,
            "name-setting",
          )}
          {row(
            T.peopleTitle,
            s.people.length === 0 ? (
              <Text size="sm">{T.peopleNone}</Text>
            ) : (
              <Table data-testid="people-table" verticalSpacing={6}>
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
                      <Table.Td c={p.changed ? "var(--shu-text)" : p.own || p.confirmed ? "var(--text-3)" : undefined}>
                        {p.own ? T.own : p.confirmed ? T.confirmed : p.changed ? HUMAN_TEXT.history.trust.changed : T.unconfirmed}
                        {!p.own && !p.confirmed && (
                          <button
                            type="button"
                            className="moyai-inline-act"
                            onClick={() => setCheck({ role: "confirm", by: p.by, pub: p.pub, fingerprint: p.fingerprint, trust: p.changed ? "changed" : "unconfirmed", previous: p.previous ?? null })}
                            data-testid="person-confirm"
                          >
                            {T.confirmKey}
                          </button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            ),
            "people",
          )}
          {row(
            T.ringsTitle,
            <Stack gap={6}>
              {s.rings.length === 0 ? (
                <Text size="sm">{T.noRings}</Text>
              ) : (
                <Table data-testid="rings-table" verticalSpacing={6}>
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
                          <Val>{r.root}</Val>
                          <SyncedNotice synced={r.synced} kind="ring" />
                        </Table.Td>
                        <Table.Td>{s.packs.find((p) => p.id === r.pack)?.name ?? r.pack}</Table.Td>
                        <Table.Td>{r.fingerprint ? <Fingerprint value={r.fingerprint} /> : <NoneMark />}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              )}
              <button type="button" className="moyai-inline-act" style={{ marginLeft: 0, alignSelf: "flex-start" }} onClick={() => setCreateOpen(true)} data-testid="ring-create-open">
                {T.createShort}
              </button>
            </Stack>,
            "rings",
          )}
          {row(
            T.ledgerTitle,
            <Stack gap={6} data-testid="ledger-setting">
              <Group gap="sm" wrap="nowrap" align="baseline">
                <Text size="xs" c="var(--text-3)" className="moyai-settings-label">
                  {T.clone}
                </Text>
                <Val testid="current-ledger" mono={!!s.ledger}>
                  {s.ledger ?? T.ledgerNone}
                </Val>
                {change(editLedger, setEditLedger, "ledger-change")}
              </Group>
              {editLedger && <TextInput label={T.ledgerInput} value={ledger} onChange={(e) => setLedger(e.currentTarget.value)} data-testid="ledger-input" />}
              <Group gap="sm" wrap="nowrap" align="baseline" data-testid="github-setting">
                {/* 「clone」と「GitHub」は text-3 の小さな字で同じ幅（Wire、11-06） */}
                <Text size="xs" c="var(--text-3)" className="moyai-settings-label">
                  {T.github}
                </Text>
                <Text size="sm" data-testid="settings-github">
                  {s.github ?? T.githubNone}
                </Text>
                {s.github && (
                  <button
                    type="button"
                    className="moyai-inline-act"
                    onClick={() =>
                      void (async () => {
                        const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("github_disconnect", ROUTES.githubDisconnect.path, {}));
                        if (r.ok) setS((x) => (x ? { ...x, github: null } : x));
                      })()
                    }
                    data-testid="github-disconnect"
                  >
                    {HUMAN_TEXT.github.disconnect}
                  </button>
                )}
              </Group>
            </Stack>,
          )}
          {/* 表示：星取表の見せ方（施設ごとにブラウザに覚える。押すとすぐ効き、上の行の「保存」とは別。Skillパックの上。docs/screens.md 3.7） */}
          {/* 明暗：既定は自動（PC の設定に従う）。暗・明に固定できる（#61。ヘッダには置かない） */}
          {row(T.themeTitle, <ThemeChoice />, "theme-setting")}
          {/* 最新の確かめ（#65 の 5）：押すとすぐ保存する（人だけの経路）。切ったら一切問い合わせない。説明の文は置かない */}
          {s.autoUpdate !== undefined &&
            row(
              T.updateTitle,
              <Switch
                aria-label={T.updateTitle}
                data-testid="update-choice"
                value={s.autoUpdate ? "on" : "off"}
                onChange={(v) => void saveAutoUpdate(v === "on")}
                data={[
                  { value: "on", label: T.updateOn },
                  { value: "off", label: T.updateOff },
                ]}
              />,
              "update-setting",
            )}
          {row(T.displayTitle, <DisplaySettings plan={working?.plan ?? null} />, "display-setting")}
          {row(
            T.packsTitle,
            <Text size="sm">
              {/* パックの名前と版（pack.json の version。版は等幅の text-3。Wire、11-06） */}
              {s.packs.filter((p) => p.ready).length === 0
                ? T.packsNone
                : s.packs
                    .filter((p) => p.ready)
                    .map((p, i) => {
                      const v = packVersion(p.id);
                      return (
                        <span key={p.id} data-testid="pack-version" data-pack={p.id}>
                          {i > 0 && "・"}
                          {p.name}
                          {v !== null && (
                            <Text span size="sm" ff="monospace" c="var(--text-3)" ml={6}>
                              {T.packVersion(v)}
                            </Text>
                          )}
                        </span>
                      );
                    })}
              <a className="moyai-inline-act" href={APP_PAGES.industries} data-testid="industries-link">
                {T.packsLink}
              </a>
            </Text>,
            "packs-setting",
          )}
          {/* AI への提供範囲・Skill の採点の画面はまだ無いので、「| 提供範囲を表示」「| 採点を表示」は置かない（動かない部品は置かない） */}
          {row(T.aiTitle, <Text size="sm">{T.aiScope}</Text>, "ai-setting")}
          {row(T.evalTitle, <Text size="sm" c="var(--text-3)">{T.evalNone}</Text>, "eval-setting")}
        </div>
      )}
      {/* 開発の道具は、設定を読めないとき（2 つ目のタブ・ブリッジ未接続）にも出す（押せない理由を出すため） */}
      <div className="moyai-settings">
        {/* 設定を読めないあいだ（橋渡しが無い）も、表示は変えられるので出す（読めたら Skillパックの上に置く） */}
        {!s && row(T.themeTitle, <ThemeChoice />, "theme-setting")}
        {!s && row(T.displayTitle, <DisplaySettings plan={working?.plan ?? null} />, "display-setting")}
        {row(
          T.devTitle,
          <div style={{ color: "var(--text-3)" }}>
            <DevTools />
          </div>,
          "dev-setting",
        )}
      </div>
      {s && <CreateRingDialog opened={createOpen} onClose={() => setCreateOpen(false)} packs={s.packs} onCreated={() => void load()} />}
    </Container>
  );
}
