// SHARE（共有。docs/screens.md 3.6、絵は Share.dc.html。P2 の 2 で引き算した）：
// 出す先（自社の輪 / 公開の台帳）、見え方の答え、相手から見たあなた（見え方の 1 行・何施設のどれかに見えるか・塊ごとの帯。委託先は伏せる）、
// 出元（鍵の指紋と束の鎖）。原本・出ていくバイト列そのもの（ハッシュ・メモ帳で開く）・相手の星取表は「中身を見る」にたたむ。
// 下の帯に、出したあとに起きることと、合言葉の欄の右の主ボタン 1 つ「署名して自社の輪へ出す」。
// 出ていくものは橋渡しが作る（送る処理と同じ関数）。画面は橋渡しが返したバイト列を見せ、そのハッシュを送るときに照らす。
import { Alert, Anchor, Button, Code, Container, Group, NativeSelect, Paper, PasswordInput, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROUTES } from "../../shared/routes";
import { emptyCatalog } from "../chart/catalog";
import { CHART_HASH } from "../chart/route";
import { SyncedNotice, readHuman } from "../components/ConfirmDialog";
import { FictionMark } from "../components/FictionMark";
import { Switch } from "../components/Switch";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { HUMAN_TEXT, bandText, reasonText } from "../text";

const T = HUMAN_TEXT.checkpoint;

interface Synced {
  kind: "onedrive" | "sharepoint";
  base: string;
}
interface Question {
  key: string;
  name: string;
  unit: string | null;
  tier: string;
  codes: { code: string; name: string }[];
  suggested: string | null;
}
interface Counts {
  shape: number;
  properNoun: number;
  money: number;
  freeText: number;
  exactDate: number;
}
interface OriginalRow {
  equipment: string;
  work: string;
  commonItem: string | null;
  lifted: string | null;
  attribute: string | null;
  fiscalYear: number;
  planOrActual: "plan" | "actual";
  date: string | null;
  manDays: number | null;
  days: number | null;
  cost: number | null;
  performer: string | null;
  contractor: string | null;
}
interface View {
  blockers: string[];
  missing: string[];
  tried: { stage: number; coarse: boolean; k: number }[];
  bodyText: string | null;
  bodyHash: string | null;
  bytes: number | null;
  seq: number;
  counts: Counts | null;
  k: number | null;
  minK: number;
  profile: { group: string; stage: number; axes: Record<string, string> } | null;
  steps: { all: number; profile: number; rows: number } | null;
  rowEffects: { class: string; n: number }[];
  copy: { copied: number; rows: number; skipped: Record<string, number>; withheld: Record<string, number>; omitted: Record<string, number> } | null;
  original: OriginalRow[];
  originalTotal: number;
  vanished: boolean;
}
interface RingInfo {
  ringId: string;
  root: string;
  pack: string;
  synced: Synced | null;
}
interface PreviewBody {
  ok: boolean;
  reason?: string;
  plan?: { planId: string; packId: string; version: number; displayName: string; fictional: boolean; inNationalTable: boolean | null; pending: number };
  questions?: Question[];
  classNames?: Record<string, string>;
  axes?: { key: string; name: string; codes: { code: string; name: string }[] }[];
  rings?: RingInfo[];
  ring?: RingInfo & { key: string; fingerprint: string | null; folder: string };
  ringCount?: number;
  view?: View;
}
interface VerifyLine {
  kind: string;
  name: string;
  status: string;
  reasons: string[];
  fingerprint?: string;
}
interface Report {
  ringId: string;
  lines: VerifyLine[];
  notBundleFiles: number;
  ok: boolean;
}
interface Chunk {
  class: string;
  work: string;
  years: string[];
  observed: string;
  interval?: string;
  manDays?: string;
  days?: string;
}

const Sumi = () => <span className="moyai-sumi">■■■■</span>;

function Num({ v }: { v: number | null }) {
  return v === null ? <Text span c="dimmed">—</Text> : <Text span className="moyai-shu">{v}</Text>;
}

function VerifyTable({ report }: { report: Report }) {
  return (
    <Table withTableBorder className="moyai-num" data-testid="verify-table" data-ok={report.ok}>
      <Table.Tbody>
        {report.lines.map((l) => (
          <Table.Tr key={`${l.kind}:${l.name}`} data-testid="verify-line" data-status={l.status} data-kind={l.kind}>
            <Table.Td w={60}>
              <Text fw={700} c={l.status === "ok" ? "teal" : "red"}>
                {T.verifyStatus[l.status] ?? l.status}
              </Text>
            </Table.Td>
            <Table.Td w={60}>{T.verifyKind[l.kind] ?? l.kind}</Table.Td>
            <Table.Td>
              <Text size="sm" ff="monospace">
                {l.name}
              </Text>
              {l.fingerprint && (
                <Text size="xs" ff="monospace">
                  {l.fingerprint}
                </Text>
              )}
            </Table.Td>
            <Table.Td>{[...new Set(l.reasons.map(reasonText))].join("、")}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

export function Checkpoint() {
  const working = useWorkingPlan();
  const { client, state } = useConnection();
  const planId = working?.plan.planId ?? null;
  const [ringId, setRingId] = useState<string | null>(null);
  const [facility, setFacility] = useState<Record<string, string | null>>({});
  const [national, setNational] = useState<boolean | null>(working?.plan.facility.inNationalTable ?? null);
  const [res, setRes] = useState<PreviewBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pass, setPass] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ fileName: string; report: Report } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const seq = useRef(0);
  const prefilled = useRef(false);

  const answers = useMemo(() => ({ facility, inNationalTable: national }), [facility, national]);

  // 輪・答えが変わるたびに、橋渡しで出ていくものを作り直す（送る処理と同じ関数）。
  // 断られても（輪が無い・見え方が決まらないなど）、聞くこと（輪の一覧と軸）は返ってくるので見せる。
  useEffect(() => {
    if (state.kind !== "open" || !planId) return;
    const n = ++seq.current;
    setLoading(true);
    void (async () => {
      const r = await client.callHuman("checkpoint_preview", ROUTES.checkpointPreview.path, { planId, ringId, answers });
      if (n !== seq.current) return;
      setLoading(false);
      const h = readHuman<PreviewBody>(r);
      setError(h.ok ? null : h.message);
      if (!r.ok) return;
      const b = r.body as PreviewBody;
      setRes(b);
      if (!prefilled.current && b.questions) {
        prefilled.current = true;
        const pre: Record<string, string | null> = {};
        for (const q of b.questions) if (q.suggested) pre[q.key] = q.suggested;
        if (Object.keys(pre).length > 0) setFacility((f) => ({ ...pre, ...f }));
      }
      if (ringId === null && b.rings && b.plan) {
        const first = b.rings.find((x) => x.pack === b.plan!.packId);
        if (first) setRingId(first.ringId);
      }
    })();
  }, [client, state.kind, planId, ringId, answers]);

  const view = res?.ok ? (res.view ?? null) : null;
  const body = useMemo(() => {
    if (!view?.bodyText) return null;
    try {
      return JSON.parse(view.bodyText) as { profile: { group: string; stage: number; axes: Record<string, string> }; chunks: Chunk[]; seq: number; month: string };
    } catch {
      return null;
    }
  }, [view?.bodyText]);
  const workLabels = useMemo(() => emptyCatalog().workLabels as Record<string, string>, []);
  const className = (c: string) => res?.classNames?.[c] ?? c;
  const axisName = (key: string) => res?.axes?.find((a) => a.key === key)?.name ?? key;
  const codeName = (key: string, code: string) => res?.axes?.find((a) => a.key === key)?.codes.find((c) => c.code === code)?.name ?? code;

  const countsZero = !!view?.counts && Object.values(view.counts).every((n) => n === 0);
  const canSend = !!view && view.blockers.length === 0 && !!view.bodyHash && countsZero && view.k !== null && view.k >= view.minK && pass.length > 0 && !sending && !sent;
  const sendReasons = !view ? [T.sendNeeds.noView] : [...view.blockers.map((b) => T.sendNeeds[b] ?? b), ...(pass.length === 0 ? [T.sendNeeds.passphrase] : [])];

  const send = async () => {
    if (!canSend || !view?.bodyHash || !res?.plan || !ringId) return;
    setSending(true);
    setSendError(null);
    const r = readHuman<{ ok: boolean; reason?: string; fileName: string; report: Report }>(
      await client.callHuman("checkpoint_send", ROUTES.checkpointSend.path, { planId, version: res.plan.version, ringId, answers, previewHash: view.bodyHash, passphrase: pass }),
    );
    setSending(false);
    setPass("");
    if (!r.ok) return setSendError(r.message);
    setSent({ fileName: r.body.fileName, report: r.body.report });
  };

  const verifyAgain = async () => {
    if (!ringId) return;
    const r = readHuman<{ ok: boolean; reason?: string; report: Report }>(await client.callHuman("ring_verify", ROUTES.ringVerify.path, { ringId }));
    if (r.ok) setSent((s) => (s ? { ...s, report: r.body.report } : s));
    else setSendError(r.message);
  };

  const openText = async () => {
    if (!ringId || !planId) return;
    const r = readHuman<{ ok: boolean; reason?: string; file: string }>(await client.callHuman("checkpoint_open_text", ROUTES.checkpointOpenText.path, { planId, ringId, answers }));
    if (r.ok) setOpened(r.body.file);
    else setSendError(r.message);
  };

  if (!planId) {
    return (
      <Container size="lg" py="lg">
        <Title order={2}>{T.title}</Title>
        <Text mt="md" data-testid="checkpoint-no-plan">
          {T.noPlan}
        </Text>
        <Anchor href={CHART_HASH}>{T.toChart}</Anchor>
      </Container>
    );
  }

  const years = body ? [...new Set(body.chunks.flatMap((c) => c.years))].sort() : [];

  const chain = view ? Array.from({ length: Math.min(3, view.seq) }, (_, i) => view.seq - i) : [];
  const profileLine = body ? Object.entries(body.profile.axes).map(([k, v]) => codeName(k, v)).join("、") : null;

  return (
    <div className="moyai-share-page" data-testid="checkpoint-page">
      <div className="moyai-share-body">
        <Group gap="md" align="baseline" mb="lg">
          <h1 className="moyai-top-title" style={{ margin: 0 }}>
            {T.title}
          </h1>
          <Text fw={500}>{res?.plan?.displayName ?? working?.plan.displayName}</Text>
          {res?.plan && (
            <Text size="sm" c="var(--text-2)" className="moyai-num">
              {T.versionOf(res.plan.version)}
            </Text>
          )}
          {(res?.plan?.fictional ?? working?.plan.facility.fictional) && <FictionMark />}
        </Group>

        <Stack gap="lg">
          {state.kind !== "open" && <Alert color="orange">{HUMAN_TEXT.notConnected}</Alert>}
          {error && (
            <Alert color="orange" data-testid="checkpoint-refused">
              {error}
            </Alert>
          )}

          {/* 出す先：自社の輪 / 公開の台帳（公開の台帳へ束を書き出す道は、まだ作っていない） */}
          <Group gap="md" align="center" data-testid="share-dest">
            <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
              {T.destLabel}
            </Text>
            <Switch<"ring" | "ledger">
              aria-label={T.destLabel}
              value="ring"
              onChange={() => undefined}
              data={[
                { value: "ring", label: T.dest.ring },
                { value: "ledger", label: T.dest.ledger, disabled: true },
              ]}
            />
            <Text size="xs" c="dimmed">
              {T.ledgerNotYet}
            </Text>
            {(res?.rings ?? []).length > 1 && (
              <NativeSelect
                size="xs"
                aria-label={T.ring}
                value={ringId ?? ""}
                onChange={(e) => setRingId(e.currentTarget.value || null)}
                data={[{ value: "", label: T.choose }, ...(res?.rings ?? []).map((r) => ({ value: r.ringId, label: r.ringId }))]}
                data-testid="ring-select"
              />
            )}
            {(res?.rings ?? []).length === 0 && res && (
              <Text size="xs" c="var(--shu-text)">
                {T.ringNone}
              </Text>
            )}
          </Group>

          {/* 見え方の答え（Claude との会話で決めてもよい。答えがそろうと、相手から見たあなたが出る） */}
          <Group gap="sm" align="flex-end" wrap="wrap">
            <NativeSelect
              size="xs"
              label={T.nationalQ}
              value={national === null ? "" : national ? "yes" : "no"}
              onChange={(e) => setNational(e.currentTarget.value === "" ? null : e.currentTarget.value === "yes")}
              data={[
                { value: "", label: T.choose },
                { value: "yes", label: T.yes },
                { value: "no", label: T.noAnswer },
              ]}
              data-testid="q-national"
            />
            {(res?.questions ?? []).map((q) => (
              <NativeSelect
                size="xs"
                key={q.key}
                label={q.name}
                value={facility[q.key] ?? ""}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setFacility((f) => ({ ...f, [q.key]: v === "" ? null : v }));
                }}
                data={[{ value: "", label: T.choose }, ...q.codes.map((c) => ({ value: c.code, label: c.name }))]}
                data-testid={`q-${q.key}`}
              />
            ))}
          </Group>
          {view && view.missing.length > 0 && (
            <Text size="xs" c="var(--shu-text)">
              {T.missingAxes(view.missing.map(axisName).join("、"))}
            </Text>
          )}

          {/* 相手から見たあなた：見え方の 1 行と、何施設のどれかに見えるか。塊ごとの周期・工数・日数の帯（委託先は伏せる） */}
          <section data-testid="you">
            <Title order={2} size="h4" fw={500} mb="xs">
              {T.youTitle}
            </Title>
            {view?.steps ? (
              <Stack gap={4}>
                {profileLine && (
                  <Text size="sm" data-testid="you-profile">
                    {T.profileLine(profileLine)} <span className="moyai-redact" aria-label={T.redacted} />
                  </Text>
                )}
                <Text size="lg" fw={500} className="moyai-num" data-testid="you-steps">
                  {view.profile?.group === "NATIONAL" ? T.youSteps(view.steps.all, view.steps.profile, view.steps.rows) : T.youPeers(view.steps.rows)}
                </Text>
                <Text size="xs" c="dimmed" className="moyai-num" data-testid="you-k" data-k={view.k ?? ""}>
                  {T.kLine(view.k ?? 0, view.minK)} · {T.stage(view.profile?.stage ?? 0)}
                </Text>
                {view.rowEffects.length > 0 &&
                  view.rowEffects.map((e) => (
                    <Text size="xs" key={e.class} className="moyai-num">
                      {T.rowEffect(className(e.class), e.n)}
                    </Text>
                  ))}
                {body && (
                  <Table verticalSpacing={6} fz="sm" mt="xs" className="moyai-num" style={{ maxWidth: 920 }}>
                    <Table.Thead>
                      <Table.Tr>
                        {T.youHead.map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {body.chunks.map((c, i) => (
                        <Table.Tr key={i} data-testid="plain-chunk">
                          <Table.Td>{T.col3Chunk(className(c.class), workLabels[c.work] ?? c.work)}</Table.Td>
                          <Table.Td>{c.interval ? bandText(c.interval) : T.none}</Table.Td>
                          <Table.Td>{c.manDays ? bandText(c.manDays) : T.none}</Table.Td>
                          <Table.Td>{c.days ? bandText(c.days) : T.none}</Table.Td>
                          <Table.Td>
                            <span className="moyai-redact" aria-label={T.redacted} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
              </Stack>
            ) : (
              <Stack gap={4}>
                <Text size="sm">{loading ? T.loading : T.noBody}</Text>
                {view && view.tried.length > 0 && (
                  <Text size="xs" c="dimmed" className="moyai-num">
                    {T.tried}：{view.tried.map((t) => T.triedRow(t.stage, t.coarse, t.k)).join(" → ")}
                  </Text>
                )}
              </Stack>
            )}
          </section>

          {/* 出元：鍵の指紋と、束の鎖（名前は出ない） */}
          {res?.ring && (
            <section data-testid="share-source">
              <Title order={2} size="h4" fw={500} mb="xs">
                {T.sourceTitle}
              </Title>
              <Stack gap={2}>
                {res.ring.fingerprint && (
                  <Text size="xs" c="dimmed" className="moyai-num">
                    {T.fingerprint}　{res.ring.fingerprint}
                  </Text>
                )}
                {chain.length > 0 && (
                  <Text size="xs" c="dimmed" className="moyai-num" data-testid="share-chain">
                    {chain.map((n) => T.bundleN(n)).join(" ← ")}
                  </Text>
                )}
              </Stack>
            </section>
          )}

          <Text size="xs" c="dimmed" className="moyai-num" data-testid="counts">
            {view?.counts ? T.counts(view.counts) : T.counts({ shape: NaN, properNoun: NaN, money: NaN, freeText: NaN, exactDate: NaN }).replace(/NaN/g, "—")}
          </Text>

          {/* 中身を見る：原本・出ていくバイト列そのもの（ハッシュ・メモ帳で開く）・相手の星取表。閉じていても DOM には残す */}
          <details data-testid="share-contents">
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>{T.contentsTitle}</summary>
            <Stack gap="md" mt="sm">
              <Paper withBorder p="sm" data-testid="col-outgoing">
                <Group justify="space-between" align="flex-start">
                  <Title order={4}>{T.col2}</Title>
                  <Button size="xs" variant="default" onClick={openText} disabled={!view?.bodyText} data-testid="open-text">
                    {T.openText}
                  </Button>
                </Group>
                {view?.bodyText ? (
                  <>
                    <Text size="xs" className="moyai-num">
                      {T.hash}：
                      <Code data-testid="body-hash">{view.bodyHash}</Code>
                    </Text>
                    <Text size="xs" className="moyai-num">
                      {T.bytes(view.bytes ?? 0)} · {T.seq(view.seq)}
                    </Text>
                    <ScrollArea h={240} mt={4}>
                      <Code block data-testid="body-text" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {view.bodyText}
                      </Code>
                    </ScrollArea>
                  </>
                ) : (
                  <Text size="sm">{T.noBody}</Text>
                )}
                {opened && (
                  <Text size="xs" c="dimmed" mt={4}>
                    {T.opened(opened)}
                  </Text>
                )}
              </Paper>

              <Paper withBorder p="sm" data-testid="col-original">
                <Title order={4}>{T.col1}</Title>
                {view?.copy && (
                  <Text size="sm" fw={700} className="moyai-num" data-testid="copied">
                    {T.copied(view.copy.copied, view.copy.rows)}
                  </Text>
                )}
                <ScrollArea h={280} type="auto">
                  <Table className="moyai-num" fz="xs" withRowBorders miw={760} style={{ whiteSpace: "nowrap" }}>
                    <Table.Thead>
                      <Table.Tr>
                        {T.col1Head.map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(view?.original ?? []).map((r, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>
                            <Sumi />
                          </Table.Td>
                          <Table.Td>
                            <Sumi />
                          </Table.Td>
                          <Table.Td>{r.commonItem ? <Text span size="xs" className="moyai-shu">{T.col1Lift(className(r.commonItem), r.lifted ? className(r.lifted) : null)}</Text> : "—"}</Table.Td>
                          <Table.Td>{r.attribute ? (workLabels[r.attribute] ?? r.attribute) : "—"}</Table.Td>
                          <Table.Td>{r.fiscalYear}</Table.Td>
                          <Table.Td>{r.date ? <Sumi /> : "—"}</Table.Td>
                          <Table.Td>
                            <Num v={r.manDays} />
                          </Table.Td>
                          <Table.Td>
                            <Num v={r.days} />
                          </Table.Td>
                          <Table.Td>{r.cost !== null ? <Sumi /> : "—"}</Table.Td>
                          <Table.Td>{r.performer || r.contractor ? <Sumi /> : "—"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {view && view.originalTotal > view.original.length && <Text size="xs">{T.col1More(view.originalTotal - view.original.length)}</Text>}
                </ScrollArea>
                {view?.copy && (
                  <Stack gap={0} mt={4}>
                    <Text size="xs" fw={700}>
                      {T.skipped}
                    </Text>
                    {Object.entries(view.copy.skipped)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => (
                        <Text size="xs" key={k} className="moyai-num">
                          {HUMAN_TEXT.skip[k] ?? k}：{n}
                        </Text>
                      ))}
                    <Text size="xs" fw={700} mt={4}>
                      {T.withheld}
                    </Text>
                    <Text size="xs" className="moyai-num">
                      {Object.entries(view.copy.withheld)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${HUMAN_TEXT.withheld[k] ?? k} ${n}`)
                        .join("　")}
                    </Text>
                  </Stack>
                )}
              </Paper>

              {body && (
                <Paper withBorder p="sm">
                  <Title order={4}>{T.chartTitle}</Title>
                  <ScrollArea>
                    <Table className="moyai-num" fz="xs" withTableBorder withColumnBorders data-testid="their-chart">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th />
                          {years.map((y) => (
                            <Table.Th key={y}>{y.slice(2)}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {body.chunks.map((c, i) => (
                          <Table.Tr key={i}>
                            <Table.Td style={{ whiteSpace: "nowrap" }}>{T.col3Chunk(className(c.class), workLabels[c.work] ?? c.work)}</Table.Td>
                            {years.map((y) => (
                              <Table.Td key={y} ta="center">
                                {c.years.includes(y) ? "●" : ""}
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Paper>
              )}
            </Stack>
          </details>

          {sendError && (
            <Alert color="red" data-testid="send-error">
              {sendError}
            </Alert>
          )}
          {sent && (
            <Stack gap="xs">
              <Alert color="gray" data-testid="sent">
                {T.sent(sent.fileName)}
              </Alert>
              <Group justify="space-between">
                <Text fw={700}>{T.verifyTitle}</Text>
                <Button size="xs" variant="default" onClick={verifyAgain}>
                  {T.verifyAgain}
                </Button>
              </Group>
              <VerifyTable report={sent.report} />
            </Stack>
          )}
        </Stack>
      </div>

      {/* 下の帯：出したあとに起きること（置き場所が残すもの・仲間に分かること）と、合言葉の欄の右に主ボタン 1 つ */}
      <Group justify="space-between" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar" data-testid="leave">
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {T.known} {T.leaveAlways}
            {(res?.ringCount ?? 0) > 1 ? ` ${T.twoRings}` : ""}
          </Text>
          <SyncedNotice synced={res?.ring?.synced} kind="ring" />
          {view?.vanished && (
            <Text size="xs" c="var(--shu-text)">
              {T.vanished}
            </Text>
          )}
        </Stack>
        <Group gap="sm" wrap="nowrap" align="center" style={{ flex: "none" }}>
          {!canSend && !sent && (
            <Text size="xs" c="dimmed" data-testid="send-reason">
              {sendReasons.join("・")}
            </Text>
          )}
          <PasswordInput
            size="xs"
            aria-label={T.passphrase}
            placeholder={T.passphrase}
            value={pass}
            onChange={(e) => setPass(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            style={{ width: 220 }}
            disabled={!!sent}
            data-testid="passphrase"
          />
          <Button onClick={send} disabled={!canSend} loading={sending} data-testid="send">
            {T.sendRing}
          </Button>
        </Group>
      </Group>
    </div>
  );
}
