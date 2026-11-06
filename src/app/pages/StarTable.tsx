// 星取表（v0）：plan §2.2 と §2.14。表は AG Grid Community（chart/grid.ts）、行と印は src/plan/chart.ts。
// 開閉の状態はこの画面が持ち、見える行だけを表に渡す。畳んだ段はブラウザに覚える。
// 主ボタン「確定する」は見出しの行の右端。押すと確定のダイアログ（components/ConfirmDialog.tsx）を開く。
// 橋渡しとつながっていなければ押せず、理由を横に出す。
import { Alert, Button, Group, Modal, Stack, Table, Text, Title } from "@mantine/core";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { buildChart, ledgerRowId, markWithout, nextFoldLevel, type ChartCatalog, type ChartCell, type ChartModel, type ChartRow, type Layer, type Mark, type PeerOverlay, type PeriodMode, type RowMode } from "../../plan/chart";
import { STAT_FIELDS, type StatField } from "../../share/bands";
import { bandShort } from "../../share/stat-text";
import type { Comparison } from "../../share/receive";
import { Plan, type WorkDetailT, type WorkT } from "../../shared/plan";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { ChartGrid, bandCellText, cellAria, formatCell } from "../chart/grid";
import { DUE_TEXT, planDueViews, rowDue, rowDues, type DueView } from "../../plan/due-view";
import { WorkDetailView } from "../components/WorkDetailView";
import { takeWorkDetailRequest } from "../state/work-detail";
import { takeChartJump, type ChartJump } from "../state/chart-jump";
import "../chart/chart.css";
import { FictionMark } from "../components/FictionMark";
import { PeerPanel } from "../components/PeerPanel";
import { Switch } from "../components/Switch";
import { ConfirmDialog, HistoryDialog } from "../components/ConfirmDialog";
import { usePending } from "../components/DecisionsSheet";
import { cycleIdOf, isLedgerCycle, isPlanRuleCycle } from "../../plan/cycle";
import { useAccepted } from "../state/decisions";
import { MergeCompareContext, MergePeersContext, MergeSideContext, commentMarkKey } from "../state/merge-side";
import { compareCounts, marksOf } from "../../plan/chart-compare";
import { useConnection } from "../state/bridge";
import { getWorkingPlan, setWorkingPlan, useWorkingPlan, type PlanOrigin } from "../state/plan-store";
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
        // 見本の計画も、作業中の計画として置く（MERGE の見出し・決定のシート・署名が同じ計画を見るため）。取り込みの計画があれば置かない
        if (!getWorkingPlan()) setWorkingPlan(parsed.data, "dev");
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
      <Stack gap={0}>
        {d.sources.map((s, i) => (
          <Text key={i} size="xs" data-testid="source-ref">
            - {sourceText(s)}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}

/** 今日の日（この PC の暦。次回の計算の基準日） */
function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 作業の名前から、行の機器の名前を外す（板はもうその機器の板なので。「ごみクレーンの分解整備」→「分解整備」。Wire） */
function workShort(kind: string, rowName: string): string {
  if (!rowName || !kind.startsWith(rowName)) return kind;
  const rest = kind.slice(rowName.length).replace(/^の/, "").trim();
  return rest || kind;
}

/** 行を選んだとき、横の板に出す次回の詳細（docs/screens.md 3.2）。作業が 2 つ以上ある行は作業ごとに */
function DueSide({ row, due, ix, onOpen }: { row: ChartRow; due: ReadonlyMap<string, DueView>; ix: Index; onOpen?: (workKey: string) => void }) {
  const views = rowDues(row.works, due);
  if (views.length === 0) return null;
  const S = DUE_TEXT.side;
  const head = rowDue(row.works, due);
  const many = views.length > 1;
  const rowName = [...row.path].reverse().find((x): x is string => !!x) ?? "";
  return (
    <Stack gap="md" data-testid="due-side">
      {(many ? views : [head!]).map((v) => {
        const lines: [string, string | null][] = [
          [S.due, v.text],
          [S.latest, v.latest],
          [S.window, v.window],
          [S.basis, v.basis],
          [S.origin, v.origin],
          [S.notes, v.notes || null],
        ];
        return (
          <Stack key={v.workKey} gap={0} className="moyai-num" data-testid="due-work" data-work={v.workKey}>
            {many && (
              <Text size="xs" fw={700}>
                {workShort(ix.works.get(v.workKey)?.kind ?? v.workKey, rowName)}
              </Text>
            )}
            {lines
              .filter(([, x]) => x !== null)
              .map(([k, x]) => (
                <Text key={k} size="sm" data-testid={`due-${k}`}>
                  {k}　{x}
                </Text>
              ))}
            {/* 整備の詳細（docs/screens.md 3.9）：作業ごとに、その作業の画面を開く */}
            {onOpen && (
              <button type="button" className="moyai-inline-act" style={{ marginLeft: 0, alignSelf: "flex-start" }} onClick={() => onOpen(v.workKey)} data-testid="open-work-detail">
                {HUMAN_TEXT.workDetail.open}
              </button>
            )}
          </Stack>
        );
      })}
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

    </Stack>
  );
}

/** 共通台帳のまとめたセルの、機器ごとの印（Wire、11-06）。案の行には種類（「- 台帳案」など）と「| 施設台帳で見る」 */
interface DeviceMark {
  nodeKey: string;
  name: string;
  /** 案を除いた印（案だけなら null） */
  base: Mark | null;
  /** 未確定の案の種類（台帳案・ルール案・会話の回答・Claude 判断） */
  kinds: (keyof typeof HUMAN_TEXT.decisions.kind)[];
}

/** 共通台帳の行（c:設備・c:項目・c:項目:作業の属性・c:unmapped）に、その機器と作業が載るか（chart.ts の commonTree と同じ決まり） */
function inCommonRow(rowId: string, a: Plan["assets"][number] | undefined, w: WorkT | undefined, catalog: ChartCatalog): boolean {
  if (!a || !w) return false;
  const mapped = a.commonItem !== null && a.commonItemAccepted && w.attribute !== null && w.attributeAccepted;
  if (rowId === "c:unmapped") return !mapped;
  if (!mapped || !rowId.startsWith("c:")) return false;
  const [code, attr] = rowId.slice(2).split(":") as [string, string | undefined];
  if (attr !== undefined) return a.commonItem === code && w.attribute === attr;
  if (catalog.items.has(code)) return a.commonItem === code;
  return catalog.items.get(a.commonItem!)?.systemCode === code;
}

function deviceMarks(
  row: ChartRow,
  cell: ChartCell,
  plan: Plan,
  details: ReadonlyMap<string, WorkDetailT>,
  ix: Index,
  catalog: ChartCatalog,
  proposals: ReadonlySet<string>,
  kinds: ReadonlyMap<string, "plan" | "actual">,
): DeviceMark[] {
  const assets = new Map(plan.assets.map((a) => [a.nodeKey, a]));
  const by = new Map<string, { keys: string[]; kinds: Set<DeviceMark["kinds"][number]> }>();
  for (const k of cell.detailKeys) {
    const d = details.get(k);
    const w = d ? ix.works.get(d.workKey) : undefined;
    if (!d || !w) continue;
    for (const t of new Set(w.targets)) {
      if (!inCommonRow(row.id, assets.get(t), w, catalog)) continue;
      let e = by.get(t);
      if (!e) by.set(t, (e = { keys: [], kinds: new Set() }));
      e.keys.push(k);
      const c = cycleIdOf(k);
      if (proposals.has(k)) e.kinds.add(c && isLedgerCycle(c) ? "ledger" : c && isPlanRuleCycle(c) ? "rule" : d.author === "ai_relayed_human" ? "relayed" : "ai");
    }
  }
  // 並びは計画の機器の並び
  return plan.assets
    .filter((a) => by.has(a.nodeKey))
    .map((a) => {
      const e = by.get(a.nodeKey)!;
      return { nodeKey: a.nodeKey, name: ix.assetName(a.nodeKey), base: markWithout(e.keys, proposals, kinds), kinds: [...e.kinds] };
    });
}

/** 印の形（表のセルと同じクラス）。案だけは朱の破線の円、案の混じった印は破線の円を重ねる */
function MarkGlyph({ base, proposal }: { base: Mark | null; proposal: boolean }) {
  const ring = proposal && base !== null;
  const m: Mark = base ?? "plan";
  return (
    <span className={`moyai-mark moyai-legend-mark${proposal && !ring ? " moyai-mark-proposal" : ""}${ring ? " moyai-mark-ring" : ""}`}>
      <span data-mark={m} data-ring={ring ? "true" : undefined}>
        {T.mark[m]}
      </span>
    </span>
  );
}

function Chart({ plan, origin, embedded }: { plan: Plan; origin: PlanOrigin; embedded: boolean }) {
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
  // ほかのシートの「| 星取表で見る」から開いたときは、その行の切り替えで開き、描いたあとにその行・期を選ぶ（1 回だけ）
  const [jump, setJump] = useState<ChartJump | null>(() => takeChartJump());
  const [mode, setMode] = useState<RowMode>(() => jump?.mode ?? "ledger");
  const [period, setPeriod] = useState<PeriodMode>("year");
  const [layer, setLayer] = useState<Layer>("adjusted");
  const [foldLevel, setFoldLevel] = useState<number | null>(() => readFold(jump?.mode ?? "ledger"));
  // 共通の設備項目で見るとき、畳んだ設備の見出しの行（Wire、2026-11-05）
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [selected, setSelected] = useState<{ rowId: string; periodKey: string | null } | null>(null);
  const [openRow, setOpenRow] = useState<string | null>(null);
  // 整備の詳細で開いている作業（本体を置き換える。「‹ 星取表」で戻る）
  const [detailWork, setDetailWork] = useState<string | null>(() => takeWorkDetailRequest());
  const [editNotice, setEditNotice] = useState(false);
  const [peersOpen, setPeersOpen] = useState(false);
  const [band, setBand] = useState<StatField>("interval");
  const [comparison, setComparison] = useState<Comparison | null>(null);
  // MERGE の中では、見出しの「似た施設　重ねる / 外す」で開け閉めし、似た施設は行ごとに 1 行にまとめる（docs/screens.md 3.2）
  const peersFromHead = useContext(MergePeersContext);
  const overlay = useMemo<PeerOverlay | undefined>(
    () =>
      comparison
        ? {
            places: comparison.places.flatMap((p) => (p.status === "shown" ? [{ kind: p.kind, rows: p.agg.rows }] : [])),
            summary: peersFromHead !== null,
            labels: {
              wholeSystem: P.wholeSystem,
              peer: (k, l) => P.peerRow(P.placeShort[k] ?? k, l),
              stat: (k) => P.statRow(P.placeShort[k] ?? k),
              summary: (k, stats) => (stats.interval.shown === "median" ? P.summaryRow(bandShort(stats.interval.median)) : P.summaryFew),
            },
          }
        : undefined,
    [comparison, peersFromHead],
  );
  const gridEl = useRef<HTMLDivElement>(null);
  const grid = useRef<ChartGrid | null>(null);
  // MERGE の中では、出どころを横の板の 1 枚に描き、印を選んだらその板へ切り替える
  const side = useContext(MergeSideContext);
  const sideRef = useRef(side);
  sideRef.current = side;
  const firstPaint = useRef(true);

  const model = useMemo(() => {
    const t0 = performance.now();
    const m = buildChart(
      plan,
      catalog ?? emptyCatalog(),
      { levelFallback: T.levelFallback, commonLevels: T.commonLevels, unmapped: T.unmapped, series: T.series },
      { mode: mode === "common" && !catalog ? "ledger" : mode, period, layer, foldLevel, ...(mode === "common" ? { collapsed } : {}), ...(overlay ? { peers: overlay } : {}) },
    );
    try {
      performance.measure("moyai-chart-build", { start: t0, end: performance.now() });
    } catch {
      // 測れない環境では測らない
    }
    return m;
  }, [plan, catalog, mode, period, layer, foldLevel, overlay, collapsed]);
  const modelRef = useRef<ChartModel>(model);
  modelRef.current = model;

  // 作業ごとの次回の字（計画が変わったときだけ作る）
  const due = useMemo(() => planDueViews(plan, todayLocal()), [plan]);

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
      // 本体の行・印・セルを選ぶと、横の板を詳しくで開く（たたんでいたら開く）。共通台帳の設備の見出しの行は、押すと畳む・開くだけなので開かない
      onSelect: (rowId, periodKey) => {
        setSelected({ rowId, periodKey });
        const m = modelRef.current;
        const r = m.rows.find((x) => x.id === rowId);
        const head = m.mode === "common" && r?.kind === "node" && r.level === 1 && r.hasChildren;
        if (periodKey || !head) sideRef.current?.show();
      },
      onOpenFolded: (rowId) => setOpenRow(rowId),
      onToggle: (rowId) =>
        setCollapsed((c) => {
          const n = new Set(c);
          if (!n.delete(rowId)) n.add(rowId);
          return n;
        }),
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

  // Claude が台帳から置き、人がまだ受けていない案の明細（朱の破線の円で描く）
  const { pending } = usePending(client, plan);
  const accepted = useAccepted();
  const proposals = useMemo(() => {
    const keys = pending
      .filter((d) => d.kind === "detail" && !accepted.has(`${d.id}\u0000${d.hash}`))
      .map((d) => d.id.slice("detail:".length))
      .filter((k) => cycleIdOf(k) !== null);
    return new Set(keys);
  }, [pending, accepted]);

  // 比べる版（MERGE の見出しの「比べる版　第 n 版」）：同じ作り方で比べる版の表を作り、セルごとの印を比べる
  const compareWith = useContext(MergeCompareContext);
  const compare = useMemo(() => {
    if (!compareWith) return null;
    const before = buildChart(
      compareWith.plan,
      catalog ?? emptyCatalog(),
      { levelFallback: T.levelFallback, commonLevels: T.commonLevels, unmapped: T.unmapped, series: T.series },
      { mode: mode === "common" && !catalog ? "ledger" : mode, period, layer, foldLevel },
    );
    return { version: compareWith.version, before: marksOf(before) };
  }, [compareWith, catalog, mode, period, layer, foldLevel]);
  const compared = useMemo(() => (compare ? compareCounts(compare.before, model) : null), [compare, model]);

  // コメントの付いた行（今の行の切り替えの分だけ）
  const commentMarks = useMemo(() => {
    const out = new Map<string, string>();
    if (!side) return out;
    for (const [k, v] of side.commentMarks) {
      const [m, id] = k.split("\u0000") as [string, string];
      if (m === mode) out.set(id, v);
    }
    return out;
  }, [side, mode]);

  // 明細の鍵 → 計画か実績か（共通台帳で、案を除いた印を描くため）
  const kinds = useMemo(() => new Map(plan.details.map((d) => [d.detailKey, d.planOrActual] as const)), [plan]);

  useEffect(() => {
    grid.current?.update(model, foldLevel, band, proposals, compare, commentMarks, due, kinds);
    // 「| 〜で見る」の頼み：行を渡したあとに、その行・期を見える所へ送って選ぶ（畳んでいて見えなければ親の行）
    if (jump && jump.mode === model.mode) {
      const j = jump;
      setJump(null);
      requestAnimationFrame(() => {
        for (const id of j.rowIds) if (grid.current?.reveal(id, j.periodKey)) break;
      });
    }
  }, [model, foldLevel, band, proposals, compare, commentMarks, due, kinds, jump]);

  // 見出しで「重ねる」を選ぶと、共通の設備項目の行に替えて比べを開く。「外す」で閉じる
  useEffect(() => {
    if (peersFromHead === null) return;
    if (peersFromHead) {
      if (catalog) setMode("common");
      setPeersOpen(true);
    } else setPeersOpen(false);
  }, [peersFromHead, catalog]);

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
  // 選んだ行を、MERGE の横の板（コメントを付ける先）へ知らせる。自分の行だけ（似た施設と統計の行には付けない）
  const selKey = selRow && (selRow.kind === "node" || selRow.kind === "unmapped") ? selRow.id : null;
  const selLabel = selRow ? selRow.path.filter((x): x is string => !!x).join(T.pathSep) : "";
  // 共通台帳のまとめたセル：機器ごとの印（案の行に種類と「| 施設台帳で見る」）
  const devices = useMemo(
    () => (model.mode === "common" && catalog && selRow && selCell && (selRow.kind === "node" || selRow.kind === "unmapped") ? deviceMarks(selRow, selCell, plan, detailsByKey, ix, catalog, proposals, kinds) : []),
    [model.mode, catalog, selRow, selCell, plan, detailsByKey, ix, proposals, kinds],
  );
  // 施設台帳のその機器の行・期を開く（畳んでいて見えなければ、見えている親の行）
  const seeInLedger = (nodeKey: string) => {
    const parents = new Map(plan.assets.map((a) => [a.nodeKey, a.parentKey]));
    const rowIds: string[] = [];
    for (let k: string | null | undefined = nodeKey; k; k = parents.get(k)) rowIds.push(ledgerRowId(k));
    const periodKey = selected?.periodKey ?? null;
    switchMode("ledger");
    setJump({ mode: "ledger", rowIds, periodKey });
  };
  useEffect(() => {
    sideRef.current?.select(selKey ? { mode, id: selKey, label: selLabel } : null);
  }, [selKey, mode, selLabel]);
  // 整備の詳細を開いているあいだは、横の板は整備の詳細だけが描く
  const sideBody = detailWork ? null : (
    <>
          {selRow && (selRow.kind === "peer" || selRow.kind === "stat") ? (
            <PeerSide row={selRow} />
          ) : !selRow || !selPeriod ? (
            selRow && (selRow.kind === "node" || selRow.kind === "unmapped") ? (
              // 行の名前の全文（表の階層の列は上限の幅で切るので、全文はここと title に。Wire、11-06）
              <Stack gap="sm">
                <Text size="sm" fw={700} data-testid="source-row">
                  {selLabel}
                </Text>
                {selRow.kind === "node" && selRow.works && <DueSide row={selRow} due={due} ix={ix} onOpen={setDetailWork} />}
              </Stack>
            ) : (
            <Text size="sm" c="dimmed">
              {T.source.empty}
            </Text>
            )
          ) : (
            <Stack gap="sm">
              {/* 共通台帳では、機器ごとの印を先に（作業が多いので、次回はその後ろ） */}
              {model.mode !== "common" && selRow.kind === "node" && selRow.works && <DueSide row={selRow} due={due} ix={ix} onOpen={setDetailWork} />}
              <Text size="sm" data-testid="source-cell">
                {cellAria(selRow, selPeriod, selCell)} {formatCell(selCell)}
              </Text>
              {selCell?.detailKeys.some((k) => proposals.has(k)) && (
                <Text size="xs" c="var(--shu)" data-testid="source-proposal">
                  {T.legend.proposalNote}
                </Text>
              )}
              {devices.length > 0 && (
                <Stack gap={2} data-testid="device-marks">
                  {devices.map((m) => (
                    <Group key={m.nodeKey} gap={6} wrap="nowrap" align="center" data-testid="device-mark" data-node={m.nodeKey} data-proposal={m.kinds.length > 0 ? "true" : "false"}>
                      <MarkGlyph base={m.base} proposal={m.kinds.length > 0} />
                      <Text size="sm" truncate title={m.name} style={{ minWidth: 0 }}>
                        {m.name}
                      </Text>
                      {m.kinds.map((k) => (
                        <Text key={k} size="xs" c="var(--shu-text)" style={{ whiteSpace: "nowrap" }} data-testid="device-mark-kind">
                          {HUMAN_TEXT.decisions.kind[k]}
                        </Text>
                      ))}
                      {m.kinds.length > 0 && (
                        <button type="button" className="moyai-inline-act" style={{ whiteSpace: "nowrap" }} onClick={() => seeInLedger(m.nodeKey)} data-testid="see-in-ledger">
                          {T.seeInLedger}
                        </button>
                      )}
                    </Group>
                  ))}
                </Stack>
              )}
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
              {model.mode === "common" && selRow.kind === "node" && selRow.works && <DueSide row={selRow} due={due} ix={ix} onOpen={setDetailWork} />}
              {(selCell?.detailKeys ?? []).slice(0, DETAILS_MAX).map((k) => {
                const d = detailsByKey.get(k);
                return d ? <DetailCard key={k} d={d} ix={ix} /> : null;
              })}
              {(selCell?.detailKeys.length ?? 0) > DETAILS_MAX && <Text size="xs">{T.details.more((selCell?.detailKeys.length ?? 0) - DETAILS_MAX)}</Text>}
            </Stack>
          )}
    </>
  );
  const open = openRow ? model.rows.find((r) => r.id === openRow) : undefined;
  const openDetails = open ? open.detailKeys.map((k) => detailsByKey.get(k)).filter((d): d is WorkDetailT => !!d).sort((a, b) => a.fiscalYear - b.fiscalYear) : [];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }} data-testid="chart-page">
      {/* MERGE の中では、施設の名前と主ボタン（署名して確定する）は MERGE の見出しと下の帯にある */}
      {!embedded && (
      <Group justify="space-between" align="center" px="md" pt="sm" pb={6} wrap="nowrap" gap="sm">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Title order={2} style={{ flex: "none", whiteSpace: "nowrap" }}>
            {T.title}
          </Title>
          <Text fw={700} truncate data-testid="plan-name">
            {plan.displayName}
          </Text>
          {!embedded && plan.facility.fictional && <FictionMark />}
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
      )}
      {!embedded && <ConfirmDialog client={client} plan={plan} opened={confirmOpen} onClose={closeAnd(() => setConfirmOpen(false))} onConfirmed={(p) => (nextPlan.current = p)} />}
      {!embedded && <HistoryDialog client={client} planId={plan.planId} opened={historyOpen} onClose={closeAnd(() => setHistoryOpen(false))} onReverted={(p) => (nextPlan.current = p)} />}

      {/* 表示の切り替えと凡例を 1 行に。説明の行は置かず、行の数だけを右端に小さく（docs/screens.md 3.2、Wire 2026-11-04） */}
      <Group px={embedded ? 32 : "md"} py={8} gap="md" wrap="wrap" align="center">
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
        {mode === "common" && (
          <Group gap="xs" wrap="nowrap">
            {/* MERGE の中では、開け閉めは見出しの「似た施設　重ねる / 外す」 */}
            {peersFromHead === null && (
              <Button size="xs" variant="default" onClick={() => setPeersOpen((o) => !o)} disabled={!canConfirm || !catalog} data-testid="peers-toggle" aria-pressed={peersOpen}>
                {peersOpen ? P.close : P.open}
              </Button>
            )}
            {peersOpen && period === "month" && (
              <Text size="xs" c="orange" data-testid="peers-only-year">
                {P.onlyYear}
              </Text>
            )}
            {model.peersShown && !model.peersSummary && (
              <Switch
                aria-label={P.bandLabel}
                data-testid="peer-band"
                value={band}
                onChange={setBand}
                data={STAT_FIELDS.map((f) => ({ value: f, label: P.bandCols[f] }))}
              />
            )}
          </Group>
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
        {detailWork && (
          <div style={{ flex: 1, minWidth: 0, overflowY: "auto", overflowX: "hidden" }}>
            <WorkDetailView
              plan={plan}
              workKey={detailWork}
              asOf={todayLocal()}
              path={(() => {
                const w = plan.works.find((x) => x.workKey === detailWork);
                // 機器の道（親から：燃焼設備 › 焼却炉本体）。対象がいくつもあれば「、」でつなぐ
                const byKey = new Map(plan.assets.map((a) => [a.nodeKey, a]));
                const pathOf = (k: string): string[] => {
                  const a = byKey.get(k);
                  return a ? [...(a.parentKey ? pathOf(a.parentKey) : []), a.name] : [k];
                };
                return (w?.targets ?? []).map((t) => pathOf(t).join(T.pathSep)).join("、");
              })()}
              attributeLabel={(() => {
                const a = plan.works.find((x) => x.workKey === detailWork)?.attribute;
                return a ? ((catalog ?? emptyCatalog()).workLabels as Record<string, string>)[a] ?? null : null;
              })()}
              onBack={() => setDetailWork(null)}
            />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, paddingLeft: embedded ? 32 : 16, display: detailWork ? "none" : "flex", flexDirection: "column" }}>
          <div ref={gridEl} className="moyai-chart-grid" data-testid="chart-grid" data-mode={mode} data-fold={foldLevel ?? ""} />
          {/* 凡例は表の下に 1 行。行の数は右端に小さく */}
          <Group gap="md" wrap="nowrap" pt={8} pr={16} align="center">
          <Group gap={10} wrap="nowrap" aria-label={T.legend.label} data-testid="chart-legend">
            {(["actual", "plan", "both"] as const).map((m) => (
              <Text key={m} size="xs" c="dimmed" span>
                <span className="moyai-mark moyai-legend-mark">
                  <span data-mark={m}>{T.mark[m]}</span>
                </span>
                {T.markName[m]}
              </Text>
            ))}
            {/* 朱は 1 つの意味：比べる版があれば「第 n 版から変わった」（この版の中で人が調整した所も含む）、無ければ「元の資料から変えた所」 */}
            <Text size="xs" c="var(--shu-text)" span data-testid="legend-changed-from" data-count={compared?.changed ?? 0}>
              <span className="moyai-mark moyai-legend-mark moyai-mark-vchg">
                <span data-mark="plan">{T.mark.plan}</span>
              </span>
              {compare ? T.legend.changedFrom(compare.version) : T.legend.changedFromSource}
            </Text>
            {compare && compared && compared.old > 0 && (
              <Text size="xs" c="dimmed" span data-testid="legend-old" data-count={compared.old}>
                <span className="moyai-mark moyai-legend-mark">
                  <span data-old="plan" />
                </span>
                {T.legend.oldPlan(compare.version)}
              </Text>
            )}
            {proposals.size > 0 && (
              <Text size="xs" c="dimmed" span data-testid="legend-proposal">
                <span className="moyai-mark moyai-legend-mark moyai-mark-proposal">
                  <span data-mark="plan">{T.mark.plan}</span>
                </span>
                {T.legend.proposal}
              </Text>
            )}
          </Group>
          <Text size="xs" c="dimmed" className="moyai-num" ml="auto" data-testid="chart-rows-count" data-visible={model.rows.length} data-total={model.totalRows}>
            {T.rowsShort(model.rows.length, model.totalRows)}
          </Text>
          </Group>
        </div>
        {side ? (
          side.el &&
          createPortal(
            <div data-testid="source-panel" aria-label={T.source.title}>
{sideBody}
            </div>,
            side.el,
          )
        ) : (
          <aside className="moyai-chart-side" data-testid="source-panel" aria-label={T.source.title}>
            <Title order={4} mb="xs">
              {T.source.title}
            </Title>
{sideBody}
          </aside>
        )}
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

/** 星取表。embedded は MERGE の「星取表」のシートとして入れるとき（見出しと主ボタンは MERGE が持つ） */
export function StarTable({ embedded = false }: { embedded?: boolean } = {}) {
  const working = useWorkingPlan();
  const load = usePlan();
  // 取り込みが置いた作業中の計画を先に使い、無ければ開発用の見本（?plan=）を読む
  // 置き直したときだけ表を作り直す（当てはめで中身が変わっただけなら、行の切り替えや畳んだ段をそのまま残す）
  if (working) return <Chart key={working.generation} plan={working.plan} origin={working.origin} embedded={embedded} />;
  if (load.kind === "ready") return <Chart plan={load.plan} origin="dev" embedded={embedded} />;
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
