// 星取表（v0）：plan §2.2 と §2.14。表は AG Grid Community（chart/grid.ts）、行と印は src/plan/chart.ts。
// 開閉の状態はこの画面が持ち、見える行だけを表に渡す。畳んだ段はブラウザに覚える。
// 主ボタン「確定する」は見出しの行の右端。押すと確定のダイアログ（components/ConfirmDialog.tsx）を開く。
// 橋渡しとつながっていなければ押せず、理由を横に出す。
import { Alert, Button, Group, Modal, Stack, Table, Text, Title } from "@mantine/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildChart, nextFoldLevel, type ChartRow, type Layer, type PeerOverlay, type PeriodMode, type RowMode } from "../../plan/chart";
import { STAT_FIELDS, type StatField } from "../../share/bands";
import type { Comparison } from "../../share/receive";
import { Plan, type WorkDetailT, type WorkT } from "../../shared/plan";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { ChartGrid, bandCellText, cellAria, formatCell } from "../chart/grid";
import "../chart/chart.css";
import { FictionMark } from "../components/FictionMark";
import { PeerPanel } from "../components/PeerPanel";
import { Switch } from "../components/Switch";
import { ConfirmDialog, HistoryDialog } from "../components/ConfirmDialog";
import { useConnection } from "../state/bridge";
import { setWorkingPlan, useWorkingPlan, type PlanOrigin } from "../state/plan-store";
import { HUMAN_TEXT, TEXT } from "../text";

const T = TEXT.chart;
const P = T.peers;
const DEV_PLAN_NAME = /^[a-z0-9-]{1,64}$/;
const DETAILS_MAX = 300;

type Load = { kind: "loading" } | { kind: "none" } | { kind: "error"; message: string } | { kind: "ready"; plan: Plan };

/**
 * 開発と試験だけの入口：?plan=<名前> で、ビルドの横に書いた試しの計画（tests/fixtures/chart/write-dev-plans.mjs）を読む。
 * 名前が無ければ、取り込みがまだ無いので描く計画は無い。
 */
function usePlan(): Load {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  useEffect(() => {
    const name = new URLSearchParams(location.search).get("plan");
    if (name === null || !DEV_PLAN_NAME.test(name)) {
      setLoad({ kind: "none" });
      return;
    }
    let live = true;
    void (async () => {
      try {
        const r = await fetch(`/assets/dev-plans/${name}.json`, { cache: "no-store" });
        if (!r.ok) throw new Error(String(r.status));
        const parsed = Plan.safeParse(await r.json());
        if (!live) return;
        if (!parsed.success) {
          setLoad({ kind: "error", message: T.invalidPlan });
          return;
        }
        performance.mark("moyai-chart-data");
        setLoad({ kind: "ready", plan: parsed.data });
      } catch {
        if (live) setLoad({ kind: "error", message: T.loadFailed });
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return load;
}

const foldKey = (mode: RowMode) => `moyai.chart.foldLevel.${mode}`;
function readFold(mode: RowMode): number | null {
  try {
    const v = localStorage.getItem(foldKey(mode));
    const n = v === null ? NaN : Number(v);
    return Number.isInteger(n) && n >= 1 ? n : null;
  } catch {
    return null;
  }
}
function writeFold(mode: RowMode, level: number | null) {
  try {
    if (level === null) localStorage.removeItem(foldKey(mode));
    else localStorage.setItem(foldKey(mode), String(level));
  } catch {
    // 覚えられないときは、この画面の間だけ持つ
  }
}

/** 描いたあと（2 回目の描画の枠）に測りを閉じる */
function measureAfterPaint(name: string, start: string) {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      try {
        performance.measure(name, start);
      } catch {
        // 始まりの印が無ければ測らない
      }
    }),
  );
}

function sourceText(s: Plan["details"][number]["sources"][number]): string {
  return [s.file, s.sheet, s.cell, s.page !== null ? T.source.page(s.page) : null].filter((x) => x !== null && x !== "").join(" · ");
}

interface Index {
  works: Map<string, WorkT>;
  assetName: (nodeKey: string) => string;
  workLabels: Record<NonNullable<WorkT["attribute"]>, string>;
}

function DetailCard({ d, ix }: { d: WorkDetailT; ix: Index }) {
  const work = ix.works.get(d.workKey);
  const targets = (work?.targets ?? []).map(ix.assetName).join("、");
  return (
    <Stack gap={2} className="moyai-num" data-testid="source-detail">
      <Text size="sm" fw={700}>
        {targets} · {work?.kind}
      </Text>
      <Text size="xs">
        {T.source.planOrActual[d.planOrActual]} · {T.fiscalYear(d.fiscalYear)}
        {d.startDate ? ` · ${d.startDate}${d.endDate && d.endDate !== d.startDate ? `〜${d.endDate}` : ""}` : ""}
        {work?.attribute ? ` · ${T.commonLevels[2]}：${ix.workLabels[work.attribute]}${work.attributeAccepted ? "" : T.source.proposal}` : ""}
      </Text>
      {(d.manDays !== null || d.days !== null) && (
        <Text size="xs">
          {[d.manDays !== null ? T.source.manDays(d.manDays) : null, d.days !== null ? T.source.days(d.days) : null].filter(Boolean).join(" · ")}
        </Text>
      )}
      <Text size="xs" c="dimmed">
        {T.source.by}：{TEXT.author[d.author]} · {T.source.basis}：{d.basis}
        {d.needsReview ? ` · ${T.source.review}` : ""}
      </Text>
      <Stack gap={0} component="ul" style={{ margin: 0, paddingLeft: 16 }}>
        {d.sources.map((s, i) => (
          <Text key={i} size="xs" component="li" data-testid="source-ref">
            {sourceText(s)}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}

/** 似た施設の行と統計の行を選んだとき、横の板に出す帯と統計 */
function PeerSide({ row }: { row: ChartRow }) {
  const name = row.levelCells[row.levelCells.length - 1] ?? "";
  return (
    <Stack gap={4} data-testid="peer-side" data-kind={row.kind}>
      <Text size="xs" c="dimmed">
        {row.kind === "peer" ? P.side.peer : P.side.stat} · {P.side.place}：{row.place ? P.placeName[row.place] : P.side.none}
      </Text>
      <Text size="sm" fw={700}>
        {name}
      </Text>
      {STAT_FIELDS.map((f) => (
        <Text key={f} size="sm" className="moyai-num">
          {P.bandCols[f]}：{bandCellText(row, f) || P.side.none}
        </Text>
      ))}
      {row.kind === "stat" && (
        <Text size="xs" c="dimmed">
          {P.side.statNote}
        </Text>
      )}
    </Stack>
  );
}

function Chart({ plan, origin }: { plan: Plan; origin: PlanOrigin }) {
  const { client, state: conn } = useConnection();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const canConfirm = conn.kind === "open";
  // 確定・戻したあとの計画は、ダイアログを閉じてから置く（置くと表を描き直し、ダイアログの結果が消えるため）
  const nextPlan = useRef<Plan | null>(null);
  const closeAnd = (close: () => void) => () => {
    close();
    if (nextPlan.current) setWorkingPlan(nextPlan.current, origin);
    nextPlan.current = null;
  };
  const catalog = useMemo(() => catalogFor(plan.packId), [plan.packId]);
  const [mode, setMode] = useState<RowMode>("ledger");
  const [period, setPeriod] = useState<PeriodMode>("year");
  const [layer, setLayer] = useState<Layer>("adjusted");
  const [foldLevel, setFoldLevel] = useState<number | null>(() => readFold("ledger"));
  const [selected, setSelected] = useState<{ rowId: string; periodKey: string | null } | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState(false);
  const [peersOpen, setPeersOpen] = useState(false);
  const [band, setBand] = useState<StatField>("interval");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const overlay = useMemo<PeerOverlay | undefined>(
    () =>
      comparison
        ? {
            places: comparison.places.flatMap((p) => (p.status === "shown" ? [{ kind: p.kind, rows: p.agg.rows }] : [])),
            labels: { wholeSystem: P.wholeSystem, peer: (k, l) => P.peerRow(P.placeShort[k] ?? k, l), stat: (k) => P.statRow(P.placeShort[k] ?? k) },
          }
        : undefined,
    [comparison],
  );
  const gridEl = useRef<HTMLDivElement>(null);
  const grid = useRef<ChartGrid | null>(null);
  const firstPaint = useRef(true);

  const model = useMemo(() => {
    const t0 = performance.now();
    const m = buildChart(
      plan,
      catalog ?? emptyCatalog(),
      { levelFallback: T.levelFallback, commonLevels: T.commonLevels, unmapped: T.unmapped, series: T.series },
      { mode: mode === "common" && !catalog ? "ledger" : mode, period, layer, foldLevel, ...(overlay ? { peers: overlay } : {}) },
    );
    try {
      performance.measure("moyai-chart-build", { start: t0, end: performance.now() });
    } catch {
      // 測れない環境では測らない
    }
    return m;
  }, [plan, catalog, mode, period, layer, foldLevel, overlay]);

  const onFold = useCallback(
    (level: number) => {
      performance.mark("moyai-chart-update-start");
      setFoldLevel((cur) => {
        const next = nextFoldLevel(cur, level);
        writeFold(mode, next);
        return next;
      });
    },
    [mode],
  );
  const onFoldRef = useRef(onFold);
  onFoldRef.current = onFold;

  useEffect(() => {
    if (!gridEl.current) return;
    const g = new ChartGrid(gridEl.current, {
      onFold: (l) => onFoldRef.current(l),
      onSelect: (rowId, periodKey) => setSelected({ rowId, periodKey }),
      onOpenFolded: (rowId) => setOpenRow(rowId),
      onEditStopped: () => setEditNotice(true),
      onRendered: () => {
        if (firstPaint.current) {
          firstPaint.current = false;
          measureAfterPaint("moyai-chart-first-render", "moyai-chart-data");
        } else measureAfterPaint("moyai-chart-update", "moyai-chart-update-start");
      },
    });
    grid.current = g;
    return () => {
      g.destroy();
      grid.current = null;
    };
  }, []);

  useEffect(() => {
    grid.current?.update(model, foldLevel, band);
  }, [model, foldLevel, band]);

  const switchMode = (v: string) => {
    const m = v as RowMode;
    performance.mark("moyai-chart-update-start");
    setMode(m);
    setFoldLevel(readFold(m));
    setSelected(null);
    // 似た施設は共通の設備項目の行だけ。台帳の段の行へ移ったら閉じる（比べも AI の読める所から消える）
    if (m !== "common") setPeersOpen(false);
  };
  const switchPeriod = (v: string) => {
    performance.mark("moyai-chart-update-start");
    setPeriod(v as PeriodMode);
    setSelected(null);
  };

  const detailsByKey = useMemo(() => new Map(plan.details.map((d) => [d.detailKey, d])), [plan]);
  const ix = useMemo<Index>(() => {
    const names = new Map(plan.assets.map((a) => [a.nodeKey, a.name]));
    return {
      works: new Map(plan.works.map((w) => [w.workKey, w])),
      assetName: (k) => names.get(k) ?? k,
      workLabels: (catalog ?? emptyCatalog()).workLabels,
    };
  }, [plan, catalog]);
  const selRow = selected ? model.rows.find((r) => r.id === selected.rowId) : undefined;
  const selPeriod = selected?.periodKey ? model.periods.find((p) => p.key === selected.periodKey) : undefined;
  const selCell = selRow && selPeriod ? selRow.cells[selPeriod.key] : undefined;
  const open = openRow ? model.rows.find((r) => r.id === openRow) : undefined;
  const openDetails = open ? open.detailKeys.map((k) => detailsByKey.get(k)).filter((d): d is WorkDetailT => !!d).sort((a, b) => a.fiscalYear - b.fiscalYear) : [];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }} data-testid="chart-page">
      <Group justify="space-between" align="center" px="md" pt="sm" pb={6} wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Title order={2} style={{ flex: "none", whiteSpace: "nowrap" }}>
            {T.title}
          </Title>
          <Text fw={700} truncate data-testid="plan-name">
            {plan.displayName}
          </Text>
          {plan.facility.fictional && <FictionMark />}
        </Group>
        <Group gap="sm" wrap="nowrap" style={{ flex: "none" }}>
          <Button variant="default" onClick={() => setHistoryOpen(true)} disabled={!canConfirm} data-testid="history-open">
            {HUMAN_TEXT.confirm.history}
          </Button>
          {!canConfirm && (
            <Text size="xs" c="dimmed" data-testid="confirm-disabled-reason">
              {HUMAN_TEXT.notConnected}
            </Text>
          )}
          <Button onClick={() => setConfirmOpen(true)} disabled={!canConfirm} data-testid="confirm-open">
            {T.confirm}
          </Button>
        </Group>
      </Group>
      <ConfirmDialog client={client} plan={plan} opened={confirmOpen} onClose={closeAnd(() => setConfirmOpen(false))} onConfirmed={(p) => (nextPlan.current = p)} />
      <HistoryDialog client={client} planId={plan.planId} opened={historyOpen} onClose={closeAnd(() => setHistoryOpen(false))} onReverted={(p) => (nextPlan.current = p)} />

      <Group px="md" pb={6} gap="sm" wrap="wrap">
        <Switch
          aria-label={T.rowsLabel}
          data-testid="rows-mode"
          value={mode}
          onChange={switchMode}
          data={[
            { value: "ledger", label: T.rows.ledger },
            { value: "common", label: T.rows.common, disabled: !catalog },
          ]}
        />
        <Switch
          aria-label={T.periodLabel}
          data-testid="period-mode"
          value={period}
          onChange={switchPeriod}
          data={[
            { value: "year", label: T.period.year },
            { value: "month", label: T.period.month },
          ]}
        />
        <Switch
          aria-label={T.layerLabel}
          data-testid="layer-mode"
          value={layer}
          onChange={(v) => setLayer(v as Layer)}
          data={[
            { value: "original", label: T.layer.original },
            { value: "adjusted", label: T.layer.adjusted },
          ]}
        />
      </Group>

      <Group px="md" pb={6} gap="md" wrap="wrap">
        <Text size="xs" c="dimmed" className="moyai-num" data-testid="chart-rows-count" data-visible={model.rows.length} data-total={model.totalRows}>
          {T.rowsCount(model.rows.length, model.totalRows)}
        </Text>
        <Text size="xs" c="dimmed">
          {T.details.hint}
        </Text>
        {layer === "adjusted" && (
          <Text size="xs" c="dimmed" data-testid="adjusted-same">
            {T.adjustedSame}
          </Text>
        )}
        {mode === "common" ? (
          <Group gap="xs" wrap="nowrap">
            <Button size="xs" variant="default" onClick={() => setPeersOpen((o) => !o)} disabled={!canConfirm || !catalog} data-testid="peers-toggle" aria-pressed={peersOpen}>
              {peersOpen ? P.close : P.open}
            </Button>
            {peersOpen && period === "month" && (
              <Text size="xs" c="orange" data-testid="peers-only-year">
                {P.onlyYear}
              </Text>
            )}
            {model.peersShown && (
              <Switch
                aria-label={P.bandLabel}
                data-testid="peer-band"
                value={band}
                onChange={setBand}
                data={STAT_FIELDS.map((f) => ({ value: f, label: P.bandCols[f] }))}
              />
            )}
          </Group>
        ) : (
          <Text size="xs" c="dimmed">
            {P.onlyCommon}
          </Text>
        )}
        {model.unknownPeerClasses.length > 0 && (
          <Text size="xs" c="orange" data-testid="peers-unknown">
            {P.unknownClasses(model.unknownPeerClasses.length)}
          </Text>
        )}
        {!catalog && (
          <Text size="xs" c="orange">
            {T.noCatalog}
          </Text>
        )}
        {model.orphanDetails.length > 0 && (
          <Text size="xs" c="orange" data-testid="orphan">
            {T.orphan(model.orphanDetails.length)}
          </Text>
        )}
        {editNotice && (
          <Text size="xs" c="orange" data-testid="edit-not-saved">
            {T.editNotSaved}
          </Text>
        )}
      </Group>

      {peersOpen && mode === "common" && catalog && <PeerPanel plan={plan} onComparison={setComparison} />}

      <div style={{ flex: 1, display: "flex", minHeight: 0, paddingBottom: 28 }}>
        <div style={{ flex: 1, minWidth: 0, paddingLeft: 16 }}>
          <div ref={gridEl} className="moyai-chart-grid" data-testid="chart-grid" data-mode={mode} data-fold={foldLevel ?? ""} />
        </div>
        <aside className="moyai-chart-side" data-testid="source-panel" aria-label={T.source.title}>
          <Title order={4} mb="xs">
            {T.source.title}
          </Title>
          {selRow && (selRow.kind === "peer" || selRow.kind === "stat") ? (
            <PeerSide row={selRow} />
          ) : !selRow || !selPeriod ? (
            <Text size="sm" c="dimmed">
              {T.source.empty}
            </Text>
          ) : (
            <Stack gap="sm">
              <Text size="sm" data-testid="source-cell">
                {cellAria(selRow, selPeriod, selCell)} {formatCell(selCell)}
              </Text>
              {selCell?.change && (
                <Alert color="orange" p="xs">
                  <Text size="xs" style={{ whiteSpace: "pre-line" }}>
                    {T.change(
                      selCell.change.who ?? TEXT.author[selCell.change.author],
                      selCell.change.reason,
                      selCell.change.before ? T.markName[selCell.change.before] : T.markNone,
                      selCell.change.after ? T.markName[selCell.change.after] : T.markRemoved,
                    )}
                  </Text>
                </Alert>
              )}
              {(selCell?.detailKeys ?? []).slice(0, DETAILS_MAX).map((k) => {
                const d = detailsByKey.get(k);
                return d ? <DetailCard key={k} d={d} ix={ix} /> : null;
              })}
              {(selCell?.detailKeys.length ?? 0) > DETAILS_MAX && <Text size="xs">{T.details.more((selCell?.detailKeys.length ?? 0) - DETAILS_MAX)}</Text>}
            </Stack>
          )}
        </aside>
      </div>

      <Modal opened={!!open} onClose={() => setOpenRow(null)} title={open ? T.details.title(open.path.filter(Boolean).join(T.pathSep)) : ""} size="xl" centered>
        <Table striped withTableBorder className="moyai-num" data-testid="folded-details">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{T.details.target}</Table.Th>
              <Table.Th>{T.details.work}</Table.Th>
              <Table.Th>{T.details.attribute}</Table.Th>
              <Table.Th>{T.details.year}</Table.Th>
              <Table.Th>{T.details.kind}</Table.Th>
              <Table.Th>{T.details.date}</Table.Th>
              <Table.Th>{T.details.manDays}</Table.Th>
              <Table.Th>{T.details.days}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {openDetails.slice(0, DETAILS_MAX).map((d) => {
              const w = ix.works.get(d.workKey);
              return (
                <Table.Tr key={d.detailKey}>
                  <Table.Td>{(w?.targets ?? []).map(ix.assetName).join("、")}</Table.Td>
                  <Table.Td>{w?.kind}</Table.Td>
                  <Table.Td>{w?.attribute ? `${ix.workLabels[w.attribute]}${w.attributeAccepted ? "" : T.source.proposal}` : ""}</Table.Td>
                  <Table.Td>{d.fiscalYear}</Table.Td>
                  <Table.Td>{T.source.planOrActual[d.planOrActual]}</Table.Td>
                  <Table.Td>{d.startDate ?? ""}</Table.Td>
                  <Table.Td>{d.manDays ?? ""}</Table.Td>
                  <Table.Td>{d.days ?? ""}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
        {openDetails.length > DETAILS_MAX && <Text size="sm">{T.details.more(openDetails.length - DETAILS_MAX)}</Text>}
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setOpenRow(null)}>
            {T.details.close}
          </Button>
        </Group>
      </Modal>
    </div>
  );
}

export function StarTable() {
  const working = useWorkingPlan();
  const load = usePlan();
  // 取り込みが置いた作業中の計画を先に使い、無ければ開発用の見本（?plan=）を読む
  // 置き直したときだけ表を作り直す（当てはめで中身が変わっただけなら、行の切り替えや畳んだ段をそのまま残す）
  if (working) return <Chart key={working.generation} plan={working.plan} origin={working.origin} />;
  if (load.kind === "ready") return <Chart plan={load.plan} origin="dev" />;
  return (
    <Stack p="lg" gap="md">
      <Group justify="space-between">
        <Title order={2}>{T.title}</Title>
        <Group gap="sm">
          <Text size="xs" c="dimmed">
            {T.confirmDisabled}
          </Text>
          <Button disabled>{T.confirm}</Button>
        </Group>
      </Group>
      {load.kind === "loading" && <Text>{T.loading}</Text>}
      {load.kind === "none" && <Text data-testid="chart-empty">{T.noPlan}</Text>}
      {load.kind === "error" && (
        <Alert color="red" data-testid="chart-error">
          {load.message}
        </Alert>
      )}
    </Stack>
  );
}
