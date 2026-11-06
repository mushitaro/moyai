// 整備の詳細（docs/screens.md 3.9、Wire、絵は WorkDetail.dc.html。11-06 の運営者の直しの形）：1 つの作業を開く画面。
// データの形（運営者の定義）：機器 › 作業（火格子交換）› 作業明細（作業日報の 1 行）。作業の年度ごとの計画・実績はコードの WorkDetail。
// 本体を置き換え、左上の「| ‹ 星取表」で戻る。表の行は作業の年度ごとの計画・実績（年度ごとに 2 段）。行を選ぶと横の板の詳細に、
// その年度の値の全部の欄（空の欄は出さない）と「作業明細 n」（日報の 1 行ずつ。lines の無い前の版は「記録していない」）。
import { Stack, Table, Text } from "@mantine/core";
import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { Plan, WorkDetailT } from "../../shared/plan";
import { planDueViews } from "../../plan/due-view";
import { sheetHash } from "../stages";
import { MergeSideContext } from "../state/merge-side";
import { HUMAN_TEXT } from "../text";

const T = HUMAN_TEXT.workDetail;
const fmt = (n: number, digits = 0) => n.toLocaleString("ja-JP", { maximumFractionDigits: digits });
/** 費用は千円で見せる（円の整数で持つ） */
const kyen = (yen: number) => fmt(yen / 1000, 1);

type Kind = "plan" | "actual" | "unplanned";
interface Row {
  key: string;
  fiscalYear: number;
  kind: Kind;
  details: WorkDetailT[];
  /** 同じ年度の計画の費用（実績の差異に使う）。無ければ null */
  budget: number | null;
}

const sum = (xs: (number | null)[]) => (xs.some((x) => x !== null) ? xs.reduce<number>((n, x) => n + (x ?? 0), 0) : null);
const period = (ds: WorkDetailT[]) => {
  const s = ds.map((d) => d.startDate).filter((x): x is string => !!x).sort();
  const e = ds.map((d) => d.endDate ?? d.startDate).filter((x): x is string => !!x).sort();
  if (!s.length) return null;
  const end = e.at(-1);
  if (!end || end === s[0]) return s[0]!;
  // 同じ年の終わりの日は年を略す（「2021-10-04〜10-20」。Wire）
  return end.slice(0, 4) === s[0]!.slice(0, 4) ? `${s[0]}〜${end.slice(5)}` : `${s[0]}〜${end}`;
};
/** 元の資料（資料名とセル）。同じものは 1 つ */
const sourcesOf = (ds: WorkDetailT[]) => {
  const seen = new Map<string, { file: string; label: string }>();
  for (const s of ds.flatMap((d) => d.sources)) {
    const label = `${s.file}${s.sheet ? `「${s.sheet}」` : ""}${s.cell ? `　${s.cell}` : ""}`;
    if (!seen.has(label)) seen.set(label, { file: s.file, label });
  }
  return [...seen.values()];
};

export function WorkDetailView({ plan, workKey, asOf, path, attributeLabel, onBack }: { plan: Plan; workKey: string; asOf: string; path: string; attributeLabel: string | null; onBack: () => void }) {
  const work = plan.works.find((w) => w.workKey === workKey);
  const ds = useMemo(() => plan.details.filter((d) => d.workKey === workKey), [plan, workKey]);
  const due = useMemo(() => planDueViews(plan, asOf).get(workKey) ?? null, [plan, asOf, workKey]);
  const rows = useMemo<Row[]>(() => {
    const years = [...new Set(ds.map((d) => d.fiscalYear))].sort((a, b) => a - b);
    return years.flatMap((fy) => {
      const plans = ds.filter((d) => d.fiscalYear === fy && d.planOrActual === "plan");
      const acts = ds.filter((d) => d.fiscalYear === fy && d.planOrActual === "actual");
      const budget = sum(plans.map((d) => d.cost));
      const out: Row[] = [];
      if (plans.length) out.push({ key: `${fy}:plan`, fiscalYear: fy, kind: "plan", details: plans, budget });
      if (acts.length) out.push({ key: `${fy}:actual`, fiscalYear: fy, kind: plans.length ? "actual" : "unplanned", details: acts, budget });
      return out;
    });
  }, [ds]);
  const side = useContext(MergeSideContext);
  const [picked, setPicked] = useState<string | null>(null);
  const sel = rows.find((r) => r.key === picked) ?? null;
  if (!work) return null;
  const title = shortName(work.kind, plan, work.targets);
  const budgetTotal = sum(ds.filter((d) => d.planOrActual === "plan").map((d) => d.cost));
  const actualTotal = sum(ds.filter((d) => d.planOrActual === "actual").map((d) => d.cost));
  const head: [string, string | null][] = [
    [T.attribute, attributeLabel],
    [T.cycle, due?.decided || due?.basis ? (work.trigger ? cycleText(work.trigger) : null) : null],
    [T.next, due?.text ?? null],
    [T.basis, due?.basis ?? null],
    [T.origin, due?.origin ?? null],
    [T.budgetTotal, budgetTotal !== null ? kyen(budgetTotal) : null],
    [T.actualTotal, actualTotal !== null ? kyen(actualTotal) : null],
  ];
  const counts = { plan: rows.filter((r) => r.kind === "plan").length, actual: rows.filter((r) => r.kind !== "plan").length };
  const detail = sel && <RowDetail row={sel} name={title} contractor={work.contractor} strategy={work.strategy} />;
  return (
    <div style={{ padding: "8px 32px 32px" }} data-testid="work-detail" data-work={workKey}>
      <button type="button" className="moyai-inline-act" style={{ marginLeft: 0 }} onClick={onBack} data-testid="work-detail-back">
        {T.back}
      </button>
      <Text size="xs" c="var(--text-3)" mt="sm">
        {path}
      </Text>
      <Text fw={500} size="lg" data-testid="work-detail-title">
        {title}
      </Text>
      <Text size="sm" className="moyai-num" mt={4} data-testid="work-detail-head">
        {head
          .filter(([, v]) => v !== null)
          .map(([k, v]) => (
            <span key={k} style={{ marginRight: 20 }}>
              <Text span size="xs" c="var(--text-3)" mr={6}>
                {k}
              </Text>
              {v}
            </span>
          ))}
      </Text>
      {/* 表だけを横に送る（面ごと送ると、見出しと戻るの字が左へ切れる） */}
      <div style={{ overflowX: "auto", marginTop: 16 }}>
      <Table className="moyai-num moyai-work-detail" verticalSpacing={6} fz="sm" data-testid="work-detail-table">
        <Table.Thead>
          <Table.Tr>
            {T.cols.map((c, i) => (
              <Table.Th key={c} ta={i >= 3 && i <= 5 ? "right" : undefined}>
                {c}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r, i) => {
            const firstOfYear = i === 0 || rows[i - 1]!.fiscalYear !== r.fiscalYear;
            const span = rows.filter((x) => x.fiscalYear === r.fiscalYear).length;
            const cost = sum(r.details.map((d) => d.cost));
            const diff = r.kind !== "plan" && cost !== null && r.budget !== null ? cost - r.budget : null;
            const verdict = r.details.map((d) => d.resultValue).filter(Boolean).join("・") || null;
            return (
              <Table.Tr
                key={r.key}
                data-testid="work-detail-row"
                data-kind={r.kind}
                className="moyai-pick-row"
                aria-selected={picked === r.key}
                onClick={() => {
                  setPicked(r.key);
                  side?.show();
                }}
                style={{ cursor: "pointer", borderTop: firstOfYear ? "1px solid var(--line-strong)" : undefined }}
              >
                {firstOfYear && <Table.Td rowSpan={span}>{T.fy(r.fiscalYear)}</Table.Td>}
                <Table.Td>{T.kind[r.kind]}</Table.Td>
                <Table.Td>{period(r.details) ?? ""}</Table.Td>
                <Table.Td ta="right">{fmtOr(sum(r.details.map((d) => d.days)))}</Table.Td>
                <Table.Td ta="right">{fmtOr(sum(r.details.map((d) => d.manDays)), 1)}</Table.Td>
                <Table.Td ta="right">
                  {cost !== null ? kyen(cost) : ""}
                  {diff !== null && (
                    <Text span size="xs" c="var(--text-3)" ml={6}>
                      {signed(diff)}
                    </Text>
                  )}
                </Table.Td>
                <Table.Td>{verdict ?? ""}</Table.Td>
                <Table.Td c="var(--text-3)" ff="monospace" fz="xs" title={sourcesOf(r.details)[0]?.label ?? ""} style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {sourcesOf(r.details)[0]?.label ?? ""}
                </Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
      </div>
      <Text size="xs" c="var(--text-3)" ta="right" mt="xs" data-testid="work-detail-counts">
        {T.counts(counts.plan, counts.actual)}
      </Text>
      {side?.el && detail && createPortal(detail, side.el)}
    </div>
  );
}

/** 作業名から対象の機器の名前を外す（題は作業名だけ。機器は上の道に出ている。Wire） */
function shortName(kind: string, plan: Plan, targets: readonly string[]): string {
  for (const t of targets) {
    const n = plan.assets.find((a) => a.nodeKey === t)?.name;
    if (n && kind.startsWith(n)) {
      const rest = kind.slice(n.length).replace(/^の/, "").trim();
      if (rest) return rest;
    }
  }
  return kind;
}

function fmtOr(n: number | null, digits = 0): string {
  return n === null ? "" : fmt(n, digits);
}
function signed(yen: number): string {
  const k = kyen(Math.abs(yen));
  return yen > 0 ? `+${k}` : yen < 0 ? `−${k}` : "0";
}
function cycleText(trigger: unknown): string | null {
  const t = trigger as { branches?: { kind: string; years?: number; months?: number }[] };
  const cal = t.branches?.find((b) => b.kind === "calendar");
  if (!cal) return null;
  const m = (cal.years ?? 0) * 12 + (cal.months ?? 0);
  return m % 12 === 0 ? T.years(m / 12) : T.months(m);
}

function RowDetail({ row, name, contractor, strategy }: { row: Row; name: string; contractor: string | null; strategy: string | null }) {
  const ds = row.details;
  const cost = sum(ds.map((d) => d.cost));
  const diff = row.kind !== "plan" && cost !== null && row.budget !== null ? cost - row.budget : null;
  const verdict = ds.map((d) => d.resultValue).filter(Boolean).join("・");
  const measured = ds.map((d) => d.measuredValue).filter(Boolean).join("・");
  const fields: [string, string | null][] = [
    [T.period, period(ds)],
    [T.manDays, sum(ds.map((d) => d.manDays)) !== null ? T.manDaysValue(fmtOr(sum(ds.map((d) => d.manDays)), 1)) : null],
    [T.cost, cost !== null ? kyen(cost) : null],
    [T.diff, diff !== null ? signed(diff) : null],
    [T.verdict, verdict ? (measured ? `${verdict}（${measured}）` : verdict) : null],
    [T.previous, ds.map((d) => d.previousValue).filter(Boolean).join("・") || null],
    [T.strategy, strategy ? (T.strategies[strategy] ?? strategy) : null],
    [T.contractor, contractor],
  ];
  // 作業明細：lines の無い作業の年度の値（前の版・日報の無い資料）は「記録していない」（空の一覧と読まない。Architect の 43 の 5）
  const recorded = ds.some((d) => d.lines !== undefined);
  const lines = ds.flatMap((d) => d.lines ?? []);
  const total = sum(lines.filter((l) => l.flag !== "effortExcluded").map((l) => l.manDays));
  // 作業量の欄がどの行にも無ければ、列を置かない（狭い横の板で内容の字を折らないように）
  const hasQty = lines.some((l) => l.quantity !== null && l.quantity !== "");
  return (
    <Stack gap="xs" data-testid="work-detail-side" data-kind={row.kind}>
      <Text size="xs" c="var(--text-3)">
        {T.kind[row.kind]}
      </Text>
      <Text size="sm" fw={700}>
        {T.fy(row.fiscalYear)}　{name}
      </Text>
      <dl className="moyai-dl moyai-num">
        {fields
          .filter(([, v]) => v !== null && v !== "")
          .map(([k, v]) => (
            <div key={k} style={{ display: "contents" }}>
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
      </dl>
      <Text size="xs" c="var(--text-3)" mt="xs" data-testid="work-lines-title">
        {recorded ? T.linesTitle(lines.length) : T.linesNotRecorded}
      </Text>
      {recorded && lines.length > 0 && (
        <div className="moyai-lines moyai-num" data-testid="work-lines" style={{ gridTemplateColumns: hasQty ? "44px 1fr 52px 28px" : "44px 1fr 28px" }}>
          {lines.map((l, i) => (
            <div key={i} style={{ display: "contents" }} data-flag={l.flag ?? ""}>
              <span>{l.date ? l.date.slice(5) : "\u2015"}</span>
              <span className="moyai-lines-content" title={l.content}>
                {l.content}
                {l.flag && <span style={{ color: "var(--text-3)", marginLeft: 4 }}>{T.lineFlags[l.flag]}</span>}
              </span>
              {hasQty && <span>{l.quantity ?? ""}</span>}
              <span style={{ textAlign: "right" }}>{l.manDays !== null ? fmt(l.manDays, 1) : ""}</span>
            </div>
          ))}
          <span />
          <span style={{ color: "var(--text-3)" }}>{T.linesTotal}</span>
          {hasQty && <span />}
          <span style={{ textAlign: "right" }}>{total !== null ? fmt(total, 1) : ""}</span>
        </div>
      )}
      <Text size="xs" c="var(--text-3)" mt="xs">
        {T.sources}
      </Text>
      {sourcesOf(ds).map((s) => (
        <Text key={s.label} size="xs" ff="monospace">
          {s.label}
          <a className="moyai-inline-act" href={`${sheetHash("files")}?f=${encodeURIComponent(s.file)}`}>
            {T.showFile}
          </a>
        </Text>
      ))}
    </Stack>
  );
}
