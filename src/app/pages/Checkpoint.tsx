// 検問所（docs/plan.md §2.8・§2.14。運営者の画面の約束どおり）。
// いちばん大きく「相手から見たあなた」。3 つの欄：① 原本（墨と朱）② 出ていくもの（バイト列そのもの・ハッシュ・メモ帳で開く）
// ③ 公開語彙で日本語にしたもの。置き場所が残すもの、小さな数、合言葉の欄とその右の［送る］（主ボタンの決まりの例外）。
// 出ていくものは橋渡しが作る（送る処理と同じ関数）。画面は橋渡しが返したバイト列を見せ、そのハッシュを送るときに照らす。
import { Alert, Anchor, Badge, Button, Code, Container, Group, NativeSelect, Paper, PasswordInput, ScrollArea, SimpleGrid, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import { emptyCatalog } from "../chart/catalog";
import { CHART_HASH } from "../chart/route";
import { SyncedNotice, readHuman } from "../components/ConfirmDialog";
import { FictionMark } from "../components/FictionMark";
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

  return (
    <Container fluid py="md" px="lg" data-testid="checkpoint-page">
      <Group justify="space-between" align="center" mb="sm">
        <Group gap="sm">
          <Title order={2}>{T.title}</Title>
          <Text fw={700}>{res?.plan?.displayName ?? working?.plan.displayName}</Text>
          {(res?.plan?.fictional ?? working?.plan.facility.fictional) && <FictionMark />}
          {res?.plan && <Badge variant="light">{HUMAN_TEXT.confirm.basedOn(res.plan.version)}</Badge>}
        </Group>
        <Group gap="sm">
          <Anchor href={CHART_HASH}>{T.toChart}</Anchor>
          <Anchor href={APP_PAGES.settings}>{T.toSettings}</Anchor>
        </Group>
      </Group>

      <Stack gap="md">
        {state.kind !== "open" && <Alert color="orange">{HUMAN_TEXT.notConnected}</Alert>}
        {error && (
          <Alert color="orange" data-testid="checkpoint-refused">
            {error}
          </Alert>
        )}

        <Paper withBorder p="sm">
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="sm">
            <NativeSelect
              label={T.ring}
              value={ringId ?? ""}
              onChange={(e) => setRingId(e.currentTarget.value || null)}
              data={[{ value: "", label: (res?.rings ?? []).length === 0 ? T.ringNone : T.choose }, ...(res?.rings ?? []).map((r) => ({ value: r.ringId, label: `${r.ringId}（${r.root}）` }))]}
              data-testid="ring-select"
            />
            <NativeSelect
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
          </SimpleGrid>
          <Text size="sm" fw={700} mt="sm">
            {T.facilityTitle}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2, lg: 5 }} spacing="sm">
            {(res?.questions ?? []).map((q) => (
              <NativeSelect
                key={q.key}
                label={q.name}
                description={q.suggested ? `${T.suggested}：${q.codes.find((c) => c.code === q.suggested)?.name ?? q.suggested}` : undefined}
                value={facility[q.key] ?? ""}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setFacility((f) => ({ ...f, [q.key]: v === "" ? null : v }));
                }}
                data={[{ value: "", label: T.choose }, ...q.codes.map((c) => ({ value: c.code, label: c.name }))]}
                data-testid={`q-${q.key}`}
              />
            ))}
          </SimpleGrid>
          {view && view.missing.length > 0 && (
            <Text size="xs" c="orange" mt={4}>
              {T.missingAxes(view.missing.map(axisName).join("、"))}
            </Text>
          )}
        </Paper>

        <Paper withBorder p="md" data-testid="you">
          <Title order={3}>{T.youTitle}</Title>
          {view?.steps ? (
            <Stack gap={4}>
              <Text fz={26} fw={700} className="moyai-num" data-testid="you-steps">
                {view.profile?.group === "NATIONAL" ? T.youSteps(view.steps.all, view.steps.profile, view.steps.rows) : T.youPeers(view.steps.rows)}
              </Text>
              <Text size="sm" className="moyai-num" data-testid="you-k" data-k={view.k ?? ""}>
                {T.kLine(view.k ?? 0, view.minK)} · {T.stage(view.profile?.stage ?? 0)}
              </Text>
              <Text size="xs" c="dimmed" className="moyai-num">
                {T.tried}：{view.tried.map((t) => T.triedRow(t.stage, t.coarse, t.k)).join(" → ")}
              </Text>
              <Text size="sm" fw={700} mt={4}>
                {T.rowEffectsTitle}
              </Text>
              {view.rowEffects.length === 0 ? (
                <Text size="sm">{T.rowEffectsNone}</Text>
              ) : (
                view.rowEffects.map((e) => (
                  <Text size="sm" key={e.class} className="moyai-num">
                    {T.rowEffect(className(e.class), e.n)}
                  </Text>
                ))
              )}
              <Text size="xs" c="dimmed">
                {T.rowJumpNotYet}
              </Text>
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
        </Paper>

        <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
          <Paper withBorder p="sm" data-testid="col-original">
            <Title order={4}>{T.col1}</Title>
            <Text size="xs" c="dimmed" mb={4}>
              {T.col1Lead}
            </Text>
            {view?.copy && (
              <Text size="sm" fw={700} className="moyai-num" data-testid="copied">
                {T.copied(view.copy.copied, view.copy.rows)}
              </Text>
            )}
            <ScrollArea h={320} type="auto">
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

          <Paper withBorder p="sm" data-testid="col-outgoing">
            <Group justify="space-between" align="flex-start">
              <Title order={4}>{T.col2}</Title>
              <Button size="xs" variant="default" onClick={openText} disabled={!view?.bodyText} data-testid="open-text">
                {T.openText}
              </Button>
            </Group>
            <Text size="xs" c="dimmed" mb={4}>
              {T.col2Lead}
            </Text>
            {view?.bodyText ? (
              <>
                <Text size="xs" className="moyai-num">
                  {T.hash}：
                  <Code data-testid="body-hash">{view.bodyHash}</Code>
                </Text>
                <Text size="xs" className="moyai-num">
                  {T.bytes(view.bytes ?? 0)} · {T.seq(view.seq)}
                </Text>
                <ScrollArea h={300} mt={4}>
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

          <Paper withBorder p="sm" data-testid="col-plain">
            <Title order={4}>{T.col3}</Title>
            {body ? (
              <Stack gap={4} mt={4}>
                <Text size="sm" fw={700}>
                  {T.col3Profile}：{T.col3Group[body.profile.group] ?? body.profile.group} · {T.stage(body.profile.stage)}
                </Text>
                {Object.entries(body.profile.axes).map(([k, v]) => (
                  <Text size="sm" key={k}>
                    {axisName(k)}：{codeName(k, v)}
                  </Text>
                ))}
                <ScrollArea h={260}>
                  <Stack gap={6}>
                    {body.chunks.map((c, i) => (
                      <Stack gap={0} key={i} data-testid="plain-chunk">
                        <Text size="sm" fw={700}>
                          {T.col3Chunk(className(c.class), workLabels[c.work] ?? c.work)}
                        </Text>
                        <Text size="xs" className="moyai-num">
                          {T.col3Years(c.years.map((y) => y.slice(2)).join("・"))}
                        </Text>
                        <Text size="xs">{[c.observed, c.interval, c.manDays, c.days].filter((x): x is string => !!x).map(bandText).join("　")}</Text>
                      </Stack>
                    ))}
                  </Stack>
                </ScrollArea>
              </Stack>
            ) : (
              <Text size="sm">{T.noBody}</Text>
            )}
          </Paper>
        </SimpleGrid>

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

        <Paper withBorder p="sm" data-testid="leave">
          <Title order={4}>{T.leaveTitle}</Title>
          <SyncedNotice synced={res?.ring?.synced} kind="ring" />
          <Text size="sm">{T.leaveAlways}</Text>
          {(res?.ringCount ?? 0) > 1 && <Text size="sm">{T.twoRings}</Text>}
          {view?.vanished && (
            <Text size="sm" c="red">
              {T.vanished}
            </Text>
          )}
        </Paper>

        <Text size="xs" c="dimmed" className="moyai-num" data-testid="counts">
          {view?.counts ? T.counts(view.counts) : T.counts({ shape: NaN, properNoun: NaN, money: NaN, freeText: NaN, exactDate: NaN }).replace(/NaN/g, "—")}
        </Text>

        <Paper withBorder p="md">
          <Text size="sm" mb="xs">
            {T.known}
          </Text>
          <Group align="flex-end" gap="sm" wrap="nowrap">
            <PasswordInput
              label={T.passphrase}
              value={pass}
              onChange={(e) => setPass(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void send();
              }}
              style={{ width: 320 }}
              disabled={!!sent}
              data-testid="passphrase"
            />
            <Button onClick={send} disabled={!canSend} loading={sending} data-testid="send">
              {T.send}
            </Button>
            {!canSend && !sent && (
              <Text size="xs" c="dimmed" data-testid="send-reason">
                {sendReasons.join("・")}
              </Text>
            )}
          </Group>
          {sendError && (
            <Alert color="red" mt="sm" data-testid="send-error">
              {sendError}
            </Alert>
          )}
          {sent && (
            <Stack gap="xs" mt="sm">
              <Alert color="teal" data-testid="sent">
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
        </Paper>

        <Stack gap={2}>
          <Text size="sm">{T.bottom}</Text>
          <Text size="xs" c="dimmed">
            {T.aiNotYet} {T.slipNotYet}
          </Text>
        </Stack>
      </Stack>
    </Container>
  );
}
