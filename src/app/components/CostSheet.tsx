// MERGE のシート「費用」（docs/screens.md 3.8、Wire、絵は Cost.dc.html。運営者の決定 A 案、11-06）：予算と実績の推移。
// 数の元は作業の年度ごとの計画・実績の費用（WorkDetail.cost。円の整数）。計画の費用＝予算、実績の費用＝実績。年度で合計する。
// 当施設の画面にだけ出す（共有ファイル・公開台帳・AI には出さない）。朱は使わない（予算超過は判断を求めるものではない）
import { Select, Stack, Table, Text } from "@mantine/core";
import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { fiscalYearOf } from "../../plan/chart";
import type { Plan } from "../../shared/plan";
import { sheetHash } from "../stages";
import { MergeSideContext } from "../state/merge-side";
import { requestWorkDetail } from "../state/work-detail";
import { HUMAN_TEXT } from "../text";
import { Switch } from "./Switch";

const T = HUMAN_TEXT.cost;
const kyen = (yen: number) => Math.round(yen / 1000).toLocaleString("ja-JP");
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
          return { wk, label: `${(w?.targets ?? []).slice(0, 1).map(pathOf).join("")}${T.pathSep}${w?.kind ?? wk}`, budget: b, actual: a, diff: a !== null ? a - (b ?? 0) : null, unplanned: b === null && ds.some((d) => d.planOrActual === "actual") };
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
      {[
        [T.budget, sel.budget !== null ? kyen(sel.budget) : "―"],
        [T.actual, sel.actual !== null ? kyen(sel.actual) : "―"],
        [T.diff, sel.budget !== null && sel.actual !== null ? signed(sel.actual - sel.budget) : "―"],
        [T.rate, sel.budget && sel.actual !== null ? `${Math.round((sel.actual / sel.budget) * 100)}%` : "―"],
        [T.counts, T.countsValue(sel.planCount, sel.actualCount)],
      ].map(([k, v]) => (
        <Text key={k} size="sm" className="moyai-num">
          <Text span size="xs" c="var(--text-3)" mr={8}>
            {k}
          </Text>
          {v}
        </Text>
      ))}
      {top.length > 0 && (
        <>
          <Text size="xs" c="var(--text-3)" mt="xs">
            {T.topDiffs}
          </Text>
          {top.map((t) => (
            <button key={t.wk} type="button" className="moyai-pick-row" onClick={() => open(t.wk)} data-testid="cost-top" style={{ all: "unset", cursor: "pointer", display: "block" }}>
              <Text size="sm">{t.label}</Text>
              <Text size="xs" c="var(--text-3)" className="moyai-num">
                {t.unplanned ? T.unplanned : T.budgetActual(t.budget !== null ? kyen(t.budget) : "―", t.actual !== null ? kyen(t.actual) : "―")}　{signed(t.diff!)}
              </Text>
            </button>
          ))}
        </>
      )}
    </Stack>
  );
  const W = 56;
  const H = 160;
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
      {/* グラフ：年度ごとに 2 本の棒。予算は枠だけ、実績は墨の塗り、年度途中の実績は淡い塗り。選んだ年度は帯 */}
      <svg role="img" aria-label={T.chartLabel} width={Math.max(320, shown.length * W + 40)} height={H + 28} style={{ display: "block", marginTop: 16 }} data-testid="cost-chart">
        {shown.map((s, i) => {
          const x = 20 + i * W;
          const h = (v: number | null) => (v === null ? 0 : Math.max(1, (v / max) * H));
          const inProgress = s.fy === nowFy;
          return (
            <g key={s.fy} onClick={() => pick(s.fy)} style={{ cursor: "pointer" }} data-fy={s.fy}>
              {picked === s.fy && <rect x={x - 6} y={0} width={W - 8} height={H + 26} fill="var(--layer-2)" />}
              <rect x={x} y={H - h(s.budget)} width={18} height={h(s.budget)} fill="none" stroke="var(--text-3)" />
              <rect x={x + 20} y={H - h(s.actual)} width={18} height={h(s.actual)} fill={inProgress ? "var(--mark-faint)" : "var(--text)"} />
              <text x={x + 19} y={H + 18} textAnchor="middle" fontSize={11} fill="var(--text-3)" className="moyai-num">
                {s.fy}
              </text>
            </g>
          );
        })}
      </svg>
      <Text size="xs" c="var(--text-3)" mt={4} data-testid="cost-legend">
        {T.legend}
        <Text span ml={24}>
          {T.noCost(noCost)}
        </Text>
      </Text>
      <div style={{ overflowX: "auto", marginTop: 16 }}>
        <Table className="moyai-num moyai-work-detail" verticalSpacing={6} fz="sm" data-testid="cost-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th />
              {shown.map((s) => (
                <Table.Th key={s.fy} ta="right" onClick={() => pick(s.fy)} style={{ cursor: "pointer" }}>
                  {T.fy(s.fy)}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(["budget", "actual", "diff", "rate"] as const).map((row) => (
              <Table.Tr key={row} data-testid={`cost-row-${row}`}>
                <Table.Td c="var(--text-3)">{T[row]}</Table.Td>
                {shown.map((s) => {
                  const future = s.fy > nowFy;
                  const inProgress = s.fy === nowFy;
                  const v =
                    row === "budget"
                      ? s.budget !== null ? kyen(s.budget) : "―"
                      : row === "actual"
                        ? future ? "―" : s.actual !== null ? kyen(s.actual) : "―"
                        : future
                          ? "―"
                          : inProgress
                            ? T.inProgress
                            : s.budget === null || s.actual === null
                              ? "―"
                              : row === "diff"
                                ? signed(s.actual - s.budget)
                                : s.budget
                                  ? `${Math.round((s.actual / s.budget) * 100)}%`
                                  : "―";
                  return (
                    <Table.Td key={s.fy} ta="right" onClick={() => pick(s.fy)} style={{ cursor: "pointer", background: picked === s.fy ? "var(--layer-1)" : undefined }}>
                      {v}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      {side?.el && detail && createPortal(detail, side.el)}
    </div>
  );
}
