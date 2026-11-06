// MERGE のシート「費用」（docs/screens.md 3.8、Wire、絵は Cost.dc.html。運営者の決定 A 案、11-06）：予算と実績の推移。
// 数の元は作業の年度ごとの計画・実績の費用（WorkDetail.cost。円の整数）。計画の費用＝予算、実績の費用＝実績。年度で合計する。
// 当施設の画面にだけ出す（共有ファイル・公開台帳・AI には出さない）。朱は使わない（予算超過は判断を求めるものではない）
import { Select, Stack, Table, Text } from "@mantine/core";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fiscalYearOf } from "../../plan/chart";
import type { Plan } from "../../shared/plan";
import { sheetHash } from "../stages";
import { MergeSideContext } from "../state/merge-side";
import { requestWorkDetail } from "../state/work-detail";
import { HUMAN_TEXT } from "../text";
import { NONE, NoneMark } from "./NoneMark";
import { Switch } from "./Switch";

const T = HUMAN_TEXT.cost;
const kyen = (yen: number) => Math.round(yen / 1000).toLocaleString("ja-JP");
const rateOf = (a: number, b: number) => `${((a / b) * 100).toFixed(1)} %`;
const signed = (yen: number) => (yen > 0 ? `+${kyen(yen)}` : yen < 0 ? `−${kyen(-yen)}` : "0");
type Mode = "year" | "cumulative";

interface YearSum {
  fy: number;
  budget: number | null;
  actual: number | null;
  planCount: number;
  actualCount: number;
}

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CostSheet({ plan }: { plan: Plan }) {
  const startMonth = plan.facility.fiscalYearStartMonth;
  const nowFy = fiscalYearOf(todayLocal(), startMonth);
  // 設備（1 段目の節）：機器の道の頭
  const byKey = useMemo(() => new Map(plan.assets.map((a) => [a.nodeKey, a])), [plan]);
  const rootOf = (k: string): string => {
    const a = byKey.get(k);
    return a?.parentKey ? rootOf(a.parentKey) : k;
  };
  const systems = useMemo(() => [...new Set(plan.assets.filter((a) => a.parentKey === null).map((a) => a.nodeKey))], [plan]);
  const [system, setSystem] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("year");
  const works = useMemo(() => new Map(plan.works.map((w) => [w.workKey, w])), [plan]);
  const inScope = (workKey: string) => system === null || (works.get(workKey)?.targets ?? []).some((t) => rootOf(t) === system);
  const details = plan.details.filter((d) => inScope(d.workKey));
  const noCost = details.filter((d) => d.cost === null).length;
  const years = useMemo(() => [...new Set(plan.details.map((d) => d.fiscalYear))].sort((a, b) => a - b), [plan]);
  const sums: YearSum[] = years.map((fy) => {
    const ds = details.filter((d) => d.fiscalYear === fy);
    const pick = (k: "plan" | "actual") => {
      const xs = ds.filter((d) => d.planOrActual === k && d.cost !== null).map((d) => d.cost!);
      return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
    };
    return { fy, budget: pick("plan"), actual: pick("actual"), planCount: ds.filter((d) => d.planOrActual === "plan").length, actualCount: ds.filter((d) => d.planOrActual === "actual").length };
  });
  // 累計：その年度までの和
  const shown: YearSum[] =
    mode === "year"
      ? sums
      : sums.map((s, i) => {
          const upTo = sums.slice(0, i + 1);
          const add = (k: "budget" | "actual") => (upTo.some((x) => x[k] !== null) ? upTo.reduce((a, x) => a + (x[k] ?? 0), 0) : null);
          return { ...s, budget: add("budget"), actual: add("actual") };
        });
  const max = Math.max(1, ...shown.flatMap((s) => [s.budget ?? 0, s.actual ?? 0]));
  const side = useContext(MergeSideContext);
  // 見えている幅（グラフと表の列の幅を決める）
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [avail, setAvail] = useState(0);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth));
    ro.observe(el);
    setAvail(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const [picked, setPicked] = useState<number | null>(null);
  const pick = (fy: number) => {
    setPicked(fy);
    side?.show();
  };
  const sel = sums.find((s) => s.fy === picked) ?? null;
  const pathOf = (k: string): string => {
    const a = byKey.get(k);
    return a ? (a.parentKey ? `${pathOf(a.parentKey)}${T.pathSep}${a.name}` : a.name) : k;
  };
  const top = sel
    ? [...new Set(details.filter((d) => d.fiscalYear === sel.fy).map((d) => d.workKey))]
        .map((wk) => {
          const ds = details.filter((d) => d.fiscalYear === sel.fy && d.workKey === wk);
          const sum = (k: "plan" | "actual") => {
            const xs = ds.filter((d) => d.planOrActual === k && d.cost !== null).map((d) => d.cost!);
            return xs.length ? xs.reduce((a, b) => a + b, 0) : null;
          };
          const b = sum("plan");
          const a = sum("actual");
          const w = works.get(wk);
          const target = (w?.targets ?? [])[0];
          const assetName = target ? (byKey.get(target)?.name ?? "") : "";
          const kind = w?.kind ?? wk;
          const short = assetName && kind.startsWith(assetName) ? kind.slice(assetName.length).replace(/^の/, "").trim() || kind : kind;
          return { wk, label: `${assetName}${T.pathSep}${short}`, budget: b, actual: a, diff: a !== null ? a - (b ?? 0) : null, unplanned: b === null && ds.some((d) => d.planOrActual === "actual") };
        })
        .filter((x) => x.diff !== null && x.diff !== 0)
        .sort((x, y) => Math.abs(y.diff!) - Math.abs(x.diff!))
        .slice(0, 3)
    : [];
  const open = (wk: string) => {
    requestWorkDetail(wk);
    location.hash = sheetHash("chart");
  };
  const detail = sel && (
    <Stack gap="xs" data-testid="cost-detail" data-fy={sel.fy}>
      <Text size="xs" c="var(--text-3)">
        {system ? (byKey.get(system)?.name ?? "") : T.allSystems}
      </Text>
      <Text size="sm" fw={700}>
        {T.fy(sel.fy)}
      </Text>
      {/* 6. 整備の詳細と同じ 2 列の dl */}
      <dl className="moyai-dl moyai-num">
        {[
          [T.budget, sel.budget !== null ? kyen(sel.budget) : NONE],
          [T.actual, sel.actual !== null ? kyen(sel.actual) : NONE],
          [T.diff, sel.budget !== null && sel.actual !== null ? signed(sel.actual - sel.budget) : NONE],
          [T.rate, sel.budget && sel.actual !== null ? rateOf(sel.actual, sel.budget) : NONE],
          [T.counts, T.countsValue(sel.planCount, sel.actualCount)],
        ].map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt>{k}</dt>
            <dd>{v === NONE ? <NoneMark /> : v}</dd>
          </div>
        ))}
      </dl>
      {top.length > 0 && (
        <>
          <Text size="xs" c="var(--text-3)" mt="xs">
            {T.topDiffs}
          </Text>
          {top.map((t) => (
            <button key={t.wk} type="button" className="moyai-pick-row" onClick={() => open(t.wk)} data-testid="cost-top" style={{ all: "unset", cursor: "pointer", display: "block" }}>
              <Text size="sm">{t.label}</Text>
              <Text size="xs" c="var(--text-3)" className="moyai-num">
                {t.unplanned ? T.unplanned : T.budgetActual(t.budget !== null ? kyen(t.budget) : NONE, t.actual !== null ? kyen(t.actual) : NONE)}　{signed(t.diff!)}
              </Text>
            </button>
          ))}
        </>
      )}
    </Stack>
  );
  // グラフと表は同じ列の幅：行の名前の列 NAME_W（目盛りの数もここ）、年度の列 COL_W。年度の帯が表の列の真上に来る（Wire、11-06）
  const NAME_W = 88;
  const COL_MIN = 76; // 「年度途中」「121.2 %」が 1 行に入る幅
  const COL_W = Math.max(COL_MIN, Math.floor((avail - NAME_W) / Math.max(1, shown.length)));
  const TOP = 14; // 目盛りのいちばん上の数が切れないように
  const H = 160;
  const width = NAME_W + shown.length * COL_W;
  // 目盛り：上限を切りのよい数に（千円）
  const step = (() => {
    const k = max / 1000 / 4;
    const p = Math.pow(10, Math.floor(Math.log10(Math.max(1, k))));
    return ([1, 2, 5, 10].map((m) => m * p).find((m) => m >= k) ?? 10 * p) * 1000;
  })();
  const ticks = [0, 1, 2, 3, 4].map((i) => i * step);
  const scaleTop = Math.max(max, step * 4);
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div style={{ padding: "8px 32px 32px" }} data-testid="cost-sheet">
      <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
        <Select
          size="xs"
          aria-label={T.systemLabel}
          data={[{ value: "", label: T.allSystems }, ...systems.map((k) => ({ value: k, label: byKey.get(k)?.name ?? k }))]}
          value={system ?? ""}
          onChange={(v) => setSystem(v ? v : null)}
          w={200}
          data-testid="cost-system"
        />
        <Switch<Mode> aria-label={T.modeLabel} value={mode} onChange={setMode} data-testid="cost-mode" data={[{ value: "year", label: T.year }, { value: "cumulative", label: T.cumulative }]} />
        <Text size="xs" c="var(--text-3)" ml="auto">
          {T.unit}
        </Text>
      </div>
      <div ref={scrollRef} style={{ overflowX: "auto", marginTop: 16 }} data-testid="cost-scroll">
      <div style={{ width }}>
      {/* グラフ：年度ごとに 2 本の棒。予算は枠だけ、実績は墨の塗り、年度途中の実績は淡い塗り。選んだ年度は帯 */}
      <svg role="img" aria-label={T.chartLabel} width={width} height={TOP + H + 28} style={{ display: "block" }} data-testid="cost-chart">
        {ticks.map((v) => {
          const y = TOP + H - (v / scaleTop) * H;
          return (
            <g key={v}>
              <line x1={NAME_W} x2={width} y1={y} y2={y} stroke="var(--line)" />
              <text x={NAME_W - 8} y={y + 4} textAnchor="end" fontSize={11} fill="var(--text-3)" className="moyai-num">
                {kyen(v)}
              </text>
            </g>
          );
        })}
        {shown.map((s, i) => {
          const x0 = NAME_W + i * COL_W;
          const mid = x0 + COL_W / 2;
          const h = (v: number | null) => (v === null ? 0 : Math.max(1, (v / scaleTop) * H));
          const inProgress = s.fy === nowFy;
          return (
            <g key={s.fy} onClick={() => pick(s.fy)} onMouseEnter={() => setHover(s.fy)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} data-fy={s.fy} data-testid="cost-band">
              <rect x={x0 + 2} y={0} width={COL_W - 4} height={TOP + H + 26} fill={picked === s.fy ? "var(--layer-2)" : hover === s.fy ? "var(--layer-1)" : "transparent"} />
              <rect x={mid - 20} y={TOP + H - h(s.budget)} width={18} height={h(s.budget)} fill="none" stroke="var(--text-3)" />
              <rect x={mid + 2} y={TOP + H - h(s.actual)} width={18} height={h(s.actual)} fill={inProgress ? "var(--mark-faint)" : "var(--text)"} />
              <text x={mid} y={TOP + H + 18} textAnchor="middle" fontSize={11} fill="var(--text-3)" className="moyai-num">
                {s.fy}
              </text>
            </g>
          );
        })}
      </svg>
      </div>
      {/* 凡例は見えている幅に置く（表を横に送っても「費用なし n 件」が右に見える） */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, position: "sticky", left: 0, maxWidth: width }} data-testid="cost-legend">
        <Text size="xs" c="var(--text-3)">
          {T.legend}
        </Text>
        <Text size="xs" c="var(--text-3)" className="moyai-num">
          {T.noCost(noCost.toLocaleString("ja-JP"))}
        </Text>
      </div>
      <div style={{ marginTop: 16, width }}>
        <Table className="moyai-num moyai-work-detail" verticalSpacing={6} fz="sm" data-testid="cost-table" style={{ tableLayout: "fixed", width }}>
          <colgroup>
            <col style={{ width: NAME_W }} />
            {shown.map((s) => (
              <col key={s.fy} style={{ width: COL_W }} />
            ))}
          </colgroup>
          <Table.Thead>
            <Table.Tr>
              <Table.Th className="moyai-cost-name" />
              {shown.map((s) => (
                <Table.Th key={s.fy} ta="right" onClick={() => pick(s.fy)} style={{ cursor: "pointer", padding: "6px 8px" }}>
                  {s.fy}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(["budget", "actual", "diff", "rate"] as const).map((row) => (
              <Table.Tr key={row} data-testid={`cost-row-${row}`}>
                <Table.Td c="var(--text-3)" className="moyai-cost-name">{T[row]}</Table.Td>
                {shown.map((s) => {
                  const future = s.fy > nowFy;
                  const inProgress = s.fy === nowFy && (s.budget !== null || s.actual !== null);
                  const v =
                    row === "budget"
                      ? s.budget !== null ? kyen(s.budget) : NONE
                      : row === "actual"
                        ? future ? NONE : s.actual !== null ? kyen(s.actual) : NONE
                        : future
                          ? NONE
                          : inProgress
                            ? T.inProgress
                            : s.fy === nowFy || s.budget === null || s.actual === null
                              ? NONE
                              : row === "diff"
                                ? signed(s.actual - s.budget)
                                : s.budget
                                  ? rateOf(s.actual, s.budget)
                                  : NONE;
                  return (
                    <Table.Td key={s.fy} ta="right" onClick={() => pick(s.fy)} style={{ cursor: "pointer", padding: "6px 8px", background: picked === s.fy ? "var(--layer-1)" : undefined }}>
                      {v === NONE ? <NoneMark /> : v}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      </div>
      {side?.el && detail && createPortal(detail, side.el)}
    </div>
  );
}
