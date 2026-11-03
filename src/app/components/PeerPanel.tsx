// 似た施設と並べる（docs/plan.md §2.2 行の切り替え・§2.8 受け取りと 3 つの立場）。星取表の共通の設備項目の行で、人が開く。
// 立場・見え方（使う軸とその答え）を人が選び、橋渡しの人だけの経路 peers_compare が、台帳の clone と自分の輪の ✓ の束から場ごとに数える。
// 開いている間だけ、比べをこのタブのメモリ（state/peers）に置く。AI のツール peer_reference は、ここで開いた比べだけを読む。閉じれば消す。
import { Alert, Checkbox, Group, NativeSelect, SimpleGrid, Stack, Text } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import type { Comparison, PlaceView, Position } from "../../share/receive";
import { PROFILE_FROM } from "../../share/receive";
import type { Plan } from "../../shared/plan";
import { ROUTES } from "../../shared/routes";
import { useConnection } from "../state/bridge";
import { setPeerView } from "../state/peers";
import { TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";
import { Switch } from "./Switch";

const P = TEXT.chart.peers;

interface Question {
  key: string;
  name: string;
  unit: string | null;
  tier: string;
  codes: { code: string; name: string }[];
  suggested: string | null;
}
interface PlaceStatus {
  kind: "ledger" | "ring";
  id: string | null;
  ok: boolean;
  reason: string | null;
  peers: number;
  ng: number;
}
interface CompareBody {
  ok: boolean;
  /** 比べを作れなかった理由（作れたときは null。橋渡しは ok と一緒に返す） */
  reason?: string;
  packName: string;
  questions: Question[];
  tableAxes: string[];
  places: PlaceStatus[];
  ledgerRoot: string | null;
  chosenAxes: string[];
  comparison: Comparison | null;
}
interface Answers {
  facility: Record<string, string | null>;
  inNationalTable: boolean | null;
}

const blank = (a: Answers) => a.inNationalTable === null && Object.values(a.facility).every((v) => v === null);

function placeLine(v: PlaceView, status: PlaceStatus | undefined): string {
  if (v.status === "shown") return `${P.shown(v.agg.similar.length)}${v.agg.belowFive ? ` · ${P.belowFive}` : ""}`;
  if (v.status === "belowShow") return P.belowShow(v.similar);
  if (v.status === "outsideGroup") return P.outsideGroup;
  // 輪は、このパックの輪に入っていなければ状態の行も無い
  const r = status?.reason ?? (v.kind === "ring" ? "ring.none" : null);
  return r ? (P.loadReason[r] ?? r) : P.missing;
}

function AnswerFields({ questions, tableAxes, answers, onAnswers, axes, onToggle, suggest, testid }: {
  questions: Question[];
  tableAxes: string[];
  answers: Answers;
  onAnswers: (a: Answers) => void;
  axes: string[];
  onToggle: (key: string) => void;
  suggest: boolean;
  testid: string;
}) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3, lg: 6 }} spacing="sm" verticalSpacing="xs" data-testid={testid}>
      <NativeSelect
        size="xs"
        label={P.national}
        value={answers.inNationalTable === null ? "" : answers.inNationalTable ? "yes" : "no"}
        onChange={(e) => onAnswers({ ...answers, inNationalTable: e.currentTarget.value === "" ? null : e.currentTarget.value === "yes" })}
        data={[
          { value: "", label: P.choose },
          { value: "yes", label: P.yes },
          { value: "no", label: P.no },
        ]}
        data-testid={`${testid}-national`}
      />
      {questions.map((q) => {
        const inTable = tableAxes.includes(q.key);
        return (
          <Stack key={q.key} gap={2}>
            <NativeSelect
              size="xs"
              label={q.name}
              description={suggest && q.suggested ? `${P.suggested}：${q.codes.find((c) => c.code === q.suggested)?.name ?? q.suggested}` : undefined}
              value={answers.facility[q.key] ?? ""}
              onChange={(e) => {
                const v = e.currentTarget.value;
                onAnswers({ ...answers, facility: { ...answers.facility, [q.key]: v === "" ? null : v } });
              }}
              data={[{ value: "", label: P.choose }, ...q.codes.map((c) => ({ value: c.code, label: c.name }))]}
              data-testid={`${testid}-${q.key}`}
            />
            <Checkbox
              size="xs"
              label={P.use}
              checked={inTable && axes.includes(q.key)}
              disabled={!inTable}
              title={inTable ? undefined : P.notInTable}
              onChange={() => onToggle(q.key)}
              data-testid={`axis-${q.key}`}
            />
          </Stack>
        );
      })}
    </SimpleGrid>
  );
}

/** 開いている間、比べを親（星取表の行）と state/peers に渡す。閉じると両方から消す */
export function PeerPanel({ plan, onComparison }: { plan: Plan; onComparison: (c: Comparison | null) => void }) {
  const { client, state } = useConnection();
  const [position, setPosition] = useState<Position>("municipal");
  const [self, setSelf] = useState<Answers>({ facility: {}, inNationalTable: plan.facility.inNationalTable });
  const [target, setTarget] = useState<Answers>({ facility: {}, inNationalTable: null });
  const [axes, setAxes] = useState<string[] | null>(null);
  const [res, setRes] = useState<CompareBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const prefilled = useRef(false);
  const report = useRef(onComparison);
  report.current = onComparison;

  useEffect(() => {
    if (state.kind !== "open") return;
    const n = ++seq.current;
    setLoading(true);
    void (async () => {
      const r = await client.callHuman("peers_compare", ROUTES.peersCompare.path, {
        packId: plan.packId,
        position,
        axes,
        answers: self,
        target: blank(target) ? null : target,
        facility: { scale: plan.facility.scale, scaleUnit: plan.facility.scaleUnit },
      });
      if (n !== seq.current) return;
      setLoading(false);
      const h = readHuman<CompareBody>(r);
      if (!h.ok) {
        setError(h.message);
        setRes(null);
        report.current(null);
        setPeerView(null);
        return;
      }
      setError(null);
      setRes(h.body);
      report.current(h.body.comparison);
      setPeerView(h.body.comparison ? { comparison: h.body.comparison, packId: plan.packId } : null);
      // 自分の施設の見え方は、計画の規模からの見込みを最初に 1 回だけ入れる（人が直せる。推測で埋めない軸は空のまま）
      if (!prefilled.current) {
        prefilled.current = true;
        const pre: Record<string, string> = {};
        for (const q of h.body.questions) if (q.suggested) pre[q.key] = q.suggested;
        if (Object.keys(pre).length > 0) setSelf((a) => ({ ...a, facility: { ...pre, ...a.facility } }));
      }
    })();
  }, [client, state.kind, plan, position, axes, self, target]);

  // 閉じたら、比べを表と AI の読める所から消す
  useEffect(
    () => () => {
      report.current(null);
      setPeerView(null);
    },
    [],
  );

  const from = PROFILE_FROM[position];
  const chosen = axes ?? res?.chosenAxes ?? [];
  const toggle = (key: string) => setAxes(chosen.includes(key) ? chosen.filter((k) => k !== key) : [...chosen, key]);
  const views = res?.comparison?.places ?? [];
  const statusOf = (v: PlaceView) => res?.places.find((s) => s.kind === v.kind && (v.id === null || s.id === v.id));
  const unknown = res?.comparison === null && res.reason ? (P.reason[res.reason] ?? res.reason) : null;

  return (
    <Stack gap="xs" px="md" pb="sm" className="moyai-peer-panel" data-testid="peer-panel" data-loading={loading}>
      <Group gap="md" wrap="wrap" align="center">
        <Switch
          aria-label={P.positionLabel}
          data-testid="peer-position"
          value={position}
          onChange={(v) => {
            setPosition(v);
            setAxes(null);
          }}
          data={[
            { value: "municipal", label: P.position.municipal },
            { value: "subsidiary", label: P.position.subsidiary },
            { value: "om", label: P.position.om },
          ]}
        />
        <Text size="xs" c="dimmed">
          {P.positionLead[position]}
        </Text>
        <Text size="xs" fw={700}>
          {P.profileTitle[from]}
        </Text>
      </Group>
      {res && (
        <AnswerFields
          questions={res.questions}
          tableAxes={res.tableAxes}
          answers={from === "self" ? self : target}
          onAnswers={from === "self" ? setSelf : setTarget}
          axes={chosen}
          onToggle={toggle}
          suggest={from === "self"}
          testid={from === "self" ? "peer-self" : "peer-target"}
        />
      )}
      {error && <Alert color="red">{error}</Alert>}
      {!res && !error && <Text size="xs">{P.loading}</Text>}
      {unknown && (
        <Text size="sm" c="orange" data-testid="peer-reason" data-reason={res?.reason ?? ""}>
          {unknown}
        </Text>
      )}
      {views.length > 0 && (
        <Stack gap={2} data-testid="peer-places">
          {views.map((v, i) => {
            const s = statusOf(v);
            return (
              <Text key={`${v.kind}${i}`} size="xs" className="moyai-num" data-testid="peer-place" data-kind={v.kind} data-status={v.status}>
                <Text span fw={700}>
                  {P.placeName[v.kind]}
                </Text>
                {v.id ? ` ${v.id}` : ""} · {placeLine(v, s)}
                {s && s.ng > 0 ? ` · ${P.ng(s.ng)}` : ""}
              </Text>
            );
          })}
          {views.every((v) => v.status !== "shown") && <Text size="xs">{P.noRows}</Text>}
        </Stack>
      )}
      <Text size="xs" c="dimmed">
        {P.axesNote}
        {P.notesSep}
        {P.aiNote}
      </Text>
    </Stack>
  );
}
