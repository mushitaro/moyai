// 検査の画面（docs/plan.md §2.14）：作業中の計画に、パックの検査（src/review/ の純粋な関数）を、この画面の基準日で走らせて見せる。
// 検査ごとの結果・根拠の数字・例 10 件・出典（資料・条項・頁・URL）・水準・閾値の出どころ・確かめた度合い。
// いつも「自己点検であって、審査の判断ではない」と出す。主ボタンは無い（検査を直すのは人で、パックを直して版を上げる）。
// 業種の言葉は、パックの checks.json と sources.json から出る（コードに置かない）。
import { Anchor, Container, Group, List, Paper, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useMemo, useState } from "react";
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
      description={T.referenceDateHelp}
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

export function Review({ embedded = false }: { embedded?: boolean } = {}) {
  const working = useWorkingPlan();
  const date = useReferenceDate();
  const review = useMemo(() => (working ? reviewOf(working.plan, date) : null), [working, date]);
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

        {/* 冒頭にいつも（箱にせず、文で） */}
        <Stack gap={2} data-testid="review-notice">
          <Text fw={700}>{T.notice}。</Text>
          <Text size="sm" c="dimmed">
            {T.noticeBody}
          </Text>
        </Stack>

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
