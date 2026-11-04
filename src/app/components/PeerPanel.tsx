// 似た施設と並べる（docs/plan.md §2.2 行の切り替え・§2.8 受け取りと 3 つの立場）。星取表の共通の設備項目の行で、人が開く。
// 立場を人が選び、見え方は施設の設定（計画の施設の欄）から読んで、橋渡しの人だけの経路 peers_compare が、台帳の clone と自分の輪の ✓ の束から場ごとに数える。
// 開いている間だけ、比べをこのタブのメモリ（state/peers）に置く。AI のツール peer_reference は、ここで開いた比べだけを読む。閉じれば消す。
import { Alert, Button, Group, NativeSelect, SimpleGrid, Stack, Text } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Comparison, PlaceView, Position } from "../../share/receive";
import { PROFILE_FROM } from "../../share/receive";
import type { Plan } from "../../shared/plan";
import { ROUTES } from "../../shared/routes";
import { useConnection } from "../state/bridge";
import { setFacilityDialog } from "../state/facility-dialog";
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

/** 入札の対象の見え方（O&M のときだけ。対象は自分の施設ではないので、施設の設定には置かない） */
function TargetFields({ questions, tableAxes, answers, onAnswers }: { questions: Question[]; tableAxes: string[]; answers: Answers; onAnswers: (a: Answers) => void }) {
  return (
    <SimpleGrid cols={{ base: 1, sm: 3, lg: 6 }} spacing="sm" verticalSpacing="xs" data-testid="peer-target">
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
        data-testid="peer-target-national"
      />
      {questions
        .filter((q) => tableAxes.includes(q.key))
        .map((q) => (
          <NativeSelect
            size="xs"
            key={q.key}
            label={q.name}
            value={answers.facility[q.key] ?? ""}
            onChange={(e) => {
              const v = e.currentTarget.value;
              onAnswers({ ...answers, facility: { ...answers.facility, [q.key]: v === "" ? null : v } });
            }}
            data={[{ value: "", label: P.choose }, ...q.codes.map((c) => ({ value: c.code, label: c.name }))]}
            data-testid={`peer-target-${q.key}`}
          />
        ))}
    </SimpleGrid>
  );
}

/** 自分の施設の見え方が決まっていないときの理由（施設の設定で決める） */
const SELF_MISSING = new Set(["groupUnknown", "axisUnanswered"]);

/**
 * 開いている間、比べを親（星取表の行）と state/peers に渡す。閉じると両方から消す。
 * 自分の施設の見え方は、施設の設定（計画の施設の欄）から読む。ここでは答えない（Wire の決定 2026-11-04）。
 * 星取表の上に出すのは、立場の切り替えと「公開の台帳　似た施設 7　| 見え方を直す」の 1 行だけ（O&M のときは入札の対象の見え方も）。
 */
export function PeerPanel({ plan, onComparison }: { plan: Plan; onComparison: (c: Comparison | null) => void }) {
  const { client, state } = useConnection();
  const [position, setPosition] = useState<Position>("municipal");
  const [target, setTarget] = useState<Answers>({ facility: {}, inNationalTable: null });
  const [res, setRes] = useState<CompareBody | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const report = useRef(onComparison);
  report.current = onComparison;
  const self = useMemo<Answers>(() => ({ facility: { ...(plan.facility.profile ?? {}) }, inNationalTable: plan.facility.inNationalTable }), [plan.facility]);

  useEffect(() => {
    if (state.kind !== "open") return;
    const n = ++seq.current;
    setLoading(true);
    void (async () => {
      const r = await client.callHuman("peers_compare", ROUTES.peersCompare.path, {
        packId: plan.packId,
        position,
        axes: null,
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
    })();
  }, [client, state.kind, plan.packId, plan.facility, position, self, target]);

  // 閉じたら、比べを表と AI の読める所から消す
  useEffect(
    () => () => {
      report.current(null);
      setPeerView(null);
    },
    [],
  );

  const from = PROFILE_FROM[position];
  const views = res?.comparison?.places ?? [];
  const statusOf = (v: PlaceView) => res?.places.find((s) => s.kind === v.kind && (v.id === null || s.id === v.id));
  const selfMissing = res?.comparison === null && !!res.reason && SELF_MISSING.has(res.reason) && from === "self";
  const unknown = res?.comparison === null && res.reason && !selfMissing ? (P.reason[res.reason] ?? res.reason) : null;
  const fix = (
    <Button variant="default" size="xs" onClick={() => setFacilityDialog(true)} data-testid="peer-fix">
      {selfMissing ? P.fixDecide : P.fixProfile}
    </Button>
  );

  return (
    <Stack gap="xs" px="md" pb="sm" className="moyai-peer-panel" data-testid="peer-panel" data-loading={loading}>
      <Group gap="md" wrap="wrap" align="center">
        <Switch
          aria-label={P.positionLabel}
          data-testid="peer-position"
          value={position}
          onChange={(v) => setPosition(v)}
          data={[
            { value: "municipal", label: P.position.municipal },
            { value: "subsidiary", label: P.position.subsidiary },
            { value: "om", label: P.position.om },
          ]}
        />
        {/* 1 行：場ごとの似た施設の数（台帳の ID は出さない）と「| 見え方を直す」。見え方が決まっていなければ、そう言って施設の設定へ */}
        {selfMissing ? (
          <Group gap="xs" wrap="nowrap" data-testid="peer-reason" data-reason={res?.reason ?? ""}>
            <Text size="xs">{P.profileMissing}</Text>
            {fix}
          </Group>
        ) : (
          views.length > 0 && (
            <Group gap="xs" wrap="nowrap" data-testid="peer-places">
              {views.map((v, i) => {
                const s = statusOf(v);
                return (
                  <Text key={`${v.kind}${i}`} size="xs" className="moyai-num" data-testid="peer-place" data-kind={v.kind} data-status={v.status}>
                    {i > 0 ? " · " : ""}
                    {P.placeName[v.kind]}　{placeLine(v, s)}
                  </Text>
                );
              })}
              {from === "self" && fix}
            </Group>
          )
        )}
      </Group>
      {from === "target" && res && <TargetFields questions={res.questions} tableAxes={res.tableAxes} answers={target} onAnswers={setTarget} />}
      {error && <Alert color="red">{error}</Alert>}
      {!res && !error && <Text size="xs">{P.loading}</Text>}
      {unknown && (
        <Text size="xs" c="dimmed" data-testid="peer-reason" data-reason={res?.reason ?? ""}>
          {unknown}
        </Text>
      )}
    </Stack>
  );
}
