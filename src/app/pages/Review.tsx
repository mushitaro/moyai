// 検査の画面（docs/plan.md §2.14）：作業中の計画に、パックの検査（src/review/ の純粋な関数）を、この画面の基準日で走らせて見せる。
// 検査ごとの結果・根拠の数字・例 10 件・出典（資料・条項・頁・URL）・水準・閾値の出どころ・確かめた度合い。
// いつも「自己点検であって、審査の判断ではない」と出す。主ボタンは無い（検査を直すのは人で、パックを直して版を上げる）。
// 業種の言葉は、パックの checks.json と sources.json から出る（コードに置かない）。
import { Anchor, Container, Group, List, Paper, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Switch } from "../components/Switch";
import { MergeSideContext } from "../state/merge-side";
import { sheetHash } from "../stages";
import { nodePath, type CheckResult, type NumberKey } from "../../review/checks";
import type { Plan } from "../../shared/plan";
import { APP_PAGES } from "../../shared/routes";
import { FictionMark } from "../components/FictionMark";
import { useWorkingPlan } from "../state/plan-store";
import { reviewOf, setReferenceDate, useReferenceDate } from "../state/review";
import { REVIEW_TEXT, exampleText, numberLabel, numberValue } from "../text";

const T = REVIEW_TEXT;
// 結果の印（docs/screens.md 3.2「検査」）：外れは朱の ×、満たすは ✓、当たらないは ―。色は朱だけ（緑や赤の札は使わない）
const RESULT_MARK: Record<CheckResult["result"], string> = { met: "✓", notMet: "×", notApplicable: "―" };

function ReferenceDate() {
  const date = useReferenceDate();
  const [draft, setDraft] = useState(date);
  const [bad, setBad] = useState(false);
  return (
    <TextInput
      type="date"
      label={T.referenceDate}
      value={draft}
      error={bad ? T.referenceDateInvalid : null}
      onChange={(e) => {
        const v = e.currentTarget.value;
        setDraft(v);
        setBad(!setReferenceDate(v));
      }}
      data-testid="reference-date"
      maw={420}
    />
  );
}

function CheckCard({ c, plan }: { c: CheckResult; plan: Plan }) {
  const numbers = Object.entries(c.numbers) as [NumberKey, number | null][];
  return (
    <Paper withBorder p="md" data-testid="check" data-check={c.checkId} data-result={c.result} data-count={c.count}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Title order={3} size="h4">
            {c.name}
          </Title>
          <Group gap={6} wrap="nowrap" c={c.result === "notMet" ? "var(--shu)" : c.result === "met" ? undefined : "dimmed"}>
            <Text span fw={700} aria-hidden data-testid="check-mark">
              {RESULT_MARK[c.result]}
            </Text>
            <Text span fw={c.result === "notMet" ? 700 : 400} data-testid="check-result">
              {T.result[c.result]}
            </Text>
          </Group>
        </Group>
        <Text size="sm">
          {T.whatLabel}：{c.what}
        </Text>
        {c.notApplicable && (
          <Text size="sm" c="dimmed" data-testid="check-na">
            {T.notApplicable[c.notApplicable]}
          </Text>
        )}

        <Table withTableBorder withColumnBorders layout="fixed" data-testid="check-meta">
          <Table.Tbody>
            <Table.Tr>
              <Table.Th w={160}>{T.levelLabel}</Table.Th>
              <Table.Td data-testid="check-level" data-level={c.level}>
                {T.level[c.level]}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>{T.thresholdLabel}</Table.Th>
              <Table.Td data-testid="check-threshold" data-origin={c.thresholdOrigin}>
                {T.threshold[c.thresholdOrigin]}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>{T.sourceLabel}</Table.Th>
              <Table.Td data-testid="check-source">
                {c.source ? (
                  <Stack gap={2}>
                    <Text size="sm">{T.sourceText(c.source.document, c.source.clause, c.source.page)}</Text>
                    <Anchor href={c.source.url} target="_blank" rel="noreferrer" size="sm" style={{ wordBreak: "break-all" }}>
                      {c.source.url}
                    </Anchor>
                  </Stack>
                ) : (
                  T.noSource
                )}
              </Table.Td>
            </Table.Tr>
            <Table.Tr>
              <Table.Th>{T.verificationLabel}</Table.Th>
              <Table.Td data-testid="check-verification">{c.verification ?? T.noSource}</Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>

        <div>
          <Text size="sm" fw={700}>
            {T.numbersLabel}
          </Text>
          <Table withTableBorder className="moyai-num" data-testid="check-numbers" maw={560}>
            <Table.Tbody>
              {numbers.map(([k, v]) => (
                <Table.Tr key={k} data-key={k}>
                  <Table.Td>{numberLabel(k, c.kind)}</Table.Td>
                  <Table.Td ta="right">{numberValue(k, v)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          {(c.numbers.dateless ?? 0) > 0 && (
            <Text size="xs" c="dimmed" mt={4}>
              {T.granularity}
            </Text>
          )}
        </div>

        <div>
          <Text size="sm" fw={700}>
            {T.examplesLabel(c.examples.length, c.count)}
          </Text>
          {c.examples.length === 0 ? (
            <Text size="sm" c="dimmed">
              {c.result === "notApplicable" ? T.notApplicable[c.notApplicable!] : T.noExamples}
            </Text>
          ) : (
            <Table withTableBorder striped className="moyai-num" data-testid="check-examples">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{T.exampleCols.node}</Table.Th>
                  <Table.Th w={140}>{T.exampleCols.years}</Table.Th>
                  <Table.Th>{T.exampleCols.what}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {c.examples.map((e, i) => (
                  <Table.Tr key={i} data-testid="check-example" data-node={e.nodeKey ?? ""}>
                    <Table.Td>{e.nodeKey ? nodePath(plan, e.nodeKey).join(T.pathSep) : T.wholePlan}</Table.Td>
                    <Table.Td>{e.fiscalYears.join(" → ")}</Table.Td>
                    <Table.Td>{exampleText(e, c)}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </div>

        {c.unimplemented && (
          <Text size="sm" data-testid="check-unimplemented">
            <Text span c="dimmed" mr={6}>
              {T.unimplementedLabel}
            </Text>
            {c.unimplemented}
          </Text>
        )}
        {c.note && (
          <Text size="xs" c="dimmed">
            {T.noteLabel}：{c.note}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}

/** 検査のシートの 1 行（1 つの外れを 1 行。機器ごと。例の無い検査と、満たす・当てはまらないは 1 検査 1 行。PM の決定） */
interface CheckLine {
  key: string;
  c: CheckResult;
  e: CheckResult["examples"][number] | null;
}

function linesOf(results: readonly CheckResult[], want: CheckResult["result"]): CheckLine[] {
  const out: CheckLine[] = [];
  for (const c of results) {
    if (c.result !== want) continue;
    if (want === "notMet" && c.examples.length > 0) c.examples.forEach((e, i) => out.push({ key: `${c.checkId}#${i}`, c, e }));
    else out.push({ key: c.checkId, c, e: null });
  }
  return out;
}

/** 出典の短い言い方（条項の頭。括弧の中の言い換えは詳しくへ。例「第三の 11」） */
const shortSource = (s: NonNullable<CheckResult["source"]>) => (s.clause || s.document).split(/[（(]/)[0]!.trim();
/** 基準の短い言い方（「3 年以内」。閾値の年数が無い検査は ―） */
const standardOf = (c: CheckResult) => (typeof c.numbers.thresholdYears === "number" ? T.withinYears(c.numbers.thresholdYears) : "―");
/** この施設の短い言い方（外れの例から。例が無ければ外れの数か結果） */
function hereOf(l: CheckLine): string {
  if (l.e) return l.e.years !== null ? T.years(l.e.years) : l.e.value ?? exampleText(l.e, l.c);
  return l.c.result === "notMet" ? T.notMetCount(l.c.count) : T.result[l.c.result];
}

/** MERGE の検査のシート（docs/screens.md 3.2、Wire、2026-11-05。絵は Check.dc.html）：1 つの外れを 1 行。行を選ぶと横の板の詳しく */
function CheckSheet({ plan, results, referenceFiscalYear, checksVersion }: { plan: Plan; results: readonly CheckResult[]; referenceFiscalYear: number; checksVersion: number }) {
  const side = useContext(MergeSideContext);
  const date = useReferenceDate();
  const [which, setWhich] = useState<CheckResult["result"]>("notMet");
  const [editDate, setEditDate] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const counts = { notMet: linesOf(results, "notMet").length, met: linesOf(results, "met").length, notApplicable: linesOf(results, "notApplicable").length };
  const lines = linesOf(results, which);
  const picked = lines.find((l) => l.key === sel) ?? null;
  const node = (l: CheckLine) => (l.e?.nodeKey ? (nodePath(plan, l.e.nodeKey).at(-1) ?? "―") : "―");
  const detail = picked && (
    <Stack gap="xs" data-testid="check-detail" data-check={picked.c.checkId}>
      <Text size="sm" fw={700}>
        <Text span c={picked.c.result === "notMet" ? "var(--shu-text)" : undefined} mr={6}>
          {RESULT_MARK[picked.c.result]}
        </Text>
        {picked.c.name}
      </Text>
      {picked.e?.nodeKey && <Text size="sm">{nodePath(plan, picked.e.nodeKey).join(T.pathSep)}</Text>}
      <Text size="xs" c="dimmed">
        {T.whatLabel}
      </Text>
      <Text size="sm">{picked.c.what}</Text>
      <Text size="xs" c="dimmed">
        {T.here}
      </Text>
      <Text size="sm" c={picked.c.result === "notMet" ? "var(--shu-text)" : undefined}>
        {picked.e ? exampleText(picked.e, picked.c) : hereOf(picked)}
      </Text>
      <Text size="xs" c="dimmed">
        {T.standard}
      </Text>
      <Text size="sm">
        {standardOf(picked.c)}（{T.level[picked.c.level]}）
      </Text>
      <Text size="xs" c="dimmed">
        {T.sourceLabel}
      </Text>
      <Text size="sm">{picked.c.source ? T.sourceText(picked.c.source.document, picked.c.source.clause, picked.c.source.page) : T.noSource}</Text>
      <Text size="xs" c="dimmed">
        {T.verificationLabel}
      </Text>
      <Text size="sm">{picked.c.verification ?? T.noSource}</Text>
      <Text size="xs" c="dimmed" className="moyai-num">
        {T.referenceFiscalYear(referenceFiscalYear)}　{T.checksVersion(checksVersion)}
      </Text>
      <Group gap={0}>
        {picked.e?.nodeKey && (
          <a className="moyai-inline-act" href={sheetHash("chart")} data-testid="check-to-chart">
            {T.toChart}
          </a>
        )}
        {picked.c.source && (
          <a className="moyai-inline-act" href={picked.c.source.url} target="_blank" rel="noreferrer" data-testid="check-open-source">
            {T.openSource}
          </a>
        )}
      </Group>
    </Stack>
  );
  return (
    <Stack gap="md" px="xl" py="lg" data-testid="check-sheet">
      <Group justify="space-between" wrap="nowrap">
        <Switch
          value={which}
          onChange={(v) => {
            setWhich(v);
            setSel(null);
          }}
          aria-label={T.kindSwitch}
          data-testid="check-kind"
          data={(["notMet", "met", "notApplicable"] as const).map((k) => ({ value: k, label: `${T.kinds[k]} ${counts[k]}` }))}
        />
        <Group gap={0} wrap="nowrap" className="moyai-num">
          <Text size="xs" c="var(--text-2)" data-testid="reference-date-text">
            {T.referenceDate}　{date}
          </Text>
          <button type="button" className="moyai-inline-act" onClick={() => setEditDate((x) => !x)} data-testid="reference-date-edit">
            {T.changeDate}
          </button>
        </Group>
      </Group>
      {editDate && <ReferenceDate />}
      <Table.ScrollContainer minWidth={0}>
      <Table verticalSpacing="sm" fz="sm" highlightOnHover data-testid="check-table" data-kind={which}>
        <Table.Thead>
          <Table.Tr>
            {T.cols.map((h) => (
              <Table.Th key={h} style={{ whiteSpace: "nowrap" }}>
                {h}
              </Table.Th>
            ))}
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {lines.map((l) => (
            <Table.Tr
              key={l.key}
              data-testid="check-line"
              data-check={l.c.checkId}
              data-result={l.c.result}
              aria-selected={sel === l.key}
              style={{ cursor: "pointer" }}
              onClick={() => {
                setSel(l.key);
                side?.show();
              }}
            >
              <Table.Td w={32} fw={700} c={l.c.result === "notMet" ? "var(--shu-text)" : undefined}>
                {RESULT_MARK[l.c.result]}
              </Table.Td>
              <Table.Td style={{ whiteSpace: "nowrap" }}>{l.c.name}</Table.Td>
              <Table.Td style={{ whiteSpace: "nowrap" }}>{node(l)}</Table.Td>
              <Table.Td className="moyai-num" miw={160} c={l.c.result === "notMet" ? "var(--shu-text)" : undefined}>
                {hereOf(l)}
              </Table.Td>
              <Table.Td className="moyai-num" style={{ whiteSpace: "nowrap" }}>
                {standardOf(l.c)}
              </Table.Td>
              <Table.Td c="var(--text-2)" style={{ whiteSpace: "nowrap" }} title={l.c.source ? T.sourceText(l.c.source.document, l.c.source.clause, l.c.source.page) : undefined}>
                {l.c.source ? shortSource(l.c.source) : T.threshold[l.c.thresholdOrigin]}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      </Table.ScrollContainer>
      {side?.el && detail && createPortal(detail, side.el)}
    </Stack>
  );
}

export function Review({ embedded = false }: { embedded?: boolean } = {}) {
  const working = useWorkingPlan();
  const date = useReferenceDate();
  const review = useMemo(() => (working ? reviewOf(working.plan, date) : null), [working, date]);
  if (embedded && working && review?.kind === "ok")
    return <CheckSheet plan={working.plan} results={review.run.results} referenceFiscalYear={review.run.referenceFiscalYear} checksVersion={review.run.checksVersion} />;
  const results = review?.kind === "ok" ? review.run.results : [];
  const count = (r: CheckResult["result"]) => results.filter((x) => x.result === r).length;

  return (
    <Container fluid py="md" px="lg" data-testid="review-page">
      <Stack gap="md">
        {!embedded && (
        <Group justify="space-between">
          <Group gap="sm">
            <Title order={2}>{T.title}</Title>
            {!embedded && working?.plan.facility.fictional && <FictionMark />}
            {working && (
              <Text c="dimmed" data-testid="review-plan">
                {T.plan}：{working.plan.displayName}
              </Text>
            )}
          </Group>
        </Group>
        )}

        {/* 「自己点検であって、審査の判断ではない」は画面には出さない（運営者、2026-11-04：意味が分からない。分かる文で戻すかは未定）。
            AI のツールの結果（check_results の notice）と MCP の決まり 5 には残す */}

        {!working && (
          <Stack gap="xs">
            <Text data-testid="review-empty">{T.noPlan}</Text>
            <Anchor href={APP_PAGES.intake}>{T.toIntake}</Anchor>
          </Stack>
        )}

        {working && <ReferenceDate />}

        {review?.kind === "noChecks" && <Text data-testid="review-no-checks">{T.noChecks}</Text>}
        {review?.kind === "invalid" && (
          <Text c="var(--shu)" data-testid="review-invalid">
            {T.invalid} {T.loadProblem[review.reason]}（{review.detail}）
          </Text>
        )}

        {review?.kind === "ok" && (
          <>
            <Group gap="md" className="moyai-num">
              <Text size="sm" data-testid="review-fy">
                {T.referenceFiscalYear(review.run.referenceFiscalYear)}
              </Text>
              <Text size="sm">{T.checksVersion(review.run.checksVersion)}</Text>
              <Text size="sm" fw={700} data-testid="review-summary" data-met={count("met")} data-notmet={count("notMet")} data-na={count("notApplicable")}>
                {T.summary(count("met"), count("notMet"), count("notApplicable"))}
              </Text>
            </Group>
            <Stack gap="md">
              {results.map((c) => (
                <CheckCard key={c.checkId} c={c} plan={working!.plan} />
              ))}
            </Stack>
            {review.run.notMade.length > 0 && (
              <Paper withBorder p="md" data-testid="review-not-made">
                <Title order={3} size="h5" mb="xs">
                  {T.notMadeTitle}
                </Title>
                <List size="sm" spacing={4}>
                  {review.run.notMade.map((m) => (
                    <List.Item key={m.what}>
                      {m.what}：{m.why}
                    </List.Item>
                  ))}
                </List>
              </Paper>
            )}
          </>
        )}

        {working && (
          <Paper withBorder p="md" data-testid="review-unimplemented">
            <Title order={3} size="h5" mb="xs">
              {T.codeUnimplementedTitle}
            </Title>
            <List size="sm" spacing={4}>
              {T.codeUnimplemented.map((x) => (
                <List.Item key={x}>{x}</List.Item>
              ))}
            </List>
          </Paper>
        )}
      </Stack>
    </Container>
  );
}
