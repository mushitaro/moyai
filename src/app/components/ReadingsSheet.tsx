// MERGE のシート「ルール」（docs/screens.md 3.2「読み方」・Wire のキャンバスの Reading.dc.html。MERGE r2）：作業画面が当てている 3 段目の Skill（ルール）。
// 上に切り替え「下書き n ／ 全件 n」（既定は下書き。下書きが 0 なら全件）。ルールごとに見出しの 1 行（名前・範囲・状態）と、1 つの決まりを 1 行（内容｜元の資料｜件数。値は「セル n」「印 n」）。
// 確定者・元の版・承認・見本は本体に置かず、行を選ぶと横の板の「詳細」に出す。
// データは state/reading-tab.ts の readingTab()。
import { Stack, Table, Text } from "@mantine/core";
import { useContext, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { IntakeWorkspace } from "../intake/workspace";
import { sheetHash } from "../stages";
import { planRuleMarks, planRuleWaiting } from "../state/cycles";
import { MergeSideContext } from "../state/merge-side";
import { useWorkingPlan } from "../state/plan-store";
import { readingHitsOf, readingTab, type ReadingTabRule, type ReadingTabSkill } from "../state/reading-tab";
import { HUMAN_TEXT } from "../text";
import { Switch } from "./Switch";

const T = HUMAN_TEXT.readings;
const fmt = (n: number) => n.toLocaleString("ja-JP");
type Filter = "draft" | "all";

/** 未承認のルールの決まりの数（シートのタブの「ルール n」） */
export function unapprovedReadings(ws: IntakeWorkspace): number {
  if (!ws.fileCount || ws.currentReadings().length === 0) return 0;
  return readingTab(ws.currentReadings(), readingHitsOf(ws.view)).unapproved;
}

export function ReadingsSheet({ ws }: { ws: IntakeWorkspace }) {
  // 計画ルールの件数は、作業中の計画に出した周期の案の印の数（計画が変わると数え直す）
  const working = useWorkingPlan();
  const tab = useMemo(
    () =>
      ws.fileCount
        ? readingTab(ws.currentReadings(), readingHitsOf(ws.view), (name, r) => ({ marks: planRuleMarks(working?.plan ?? null, name, r.id), waiting: planRuleWaiting(working?.plan ?? null, r) }))
        : { skills: [], unapproved: 0 },
    [ws, ws.version, working],
  );
  const draftRules = tab.skills.filter((k) => k.status !== "approved").reduce((n, k) => n + k.rules.length, 0);
  const allRules = tab.skills.reduce((n, k) => n + k.rules.length, 0);
  const [chosen, setChosen] = useState<Filter | null>(null);
  const filter: Filter = chosen ?? (draftRules > 0 ? "draft" : "all");
  const shown = tab.skills.filter((k) => filter === "all" || k.status !== "approved");
  const side = useContext(MergeSideContext);
  const [picked, setPicked] = useState<{ skill: ReadingTabSkill; rule: ReadingTabRule } | null>(null);
  const pick = (skill: ReadingTabSkill, rule: ReadingTabRule) => {
    setPicked({ skill, rule });
    side?.show();
  };

  if (tab.skills.length === 0)
    return (
      <Text size="sm" c="dimmed" px={32} py="md" data-testid="readings-sheet">
        <span data-testid="readings-none">{T.none}</span>
      </Text>
    );

  const detail = picked && (
    <Stack gap="xs" data-testid="reading-detail" data-rule={picked.rule.id}>
      <Text size="sm" fw={700}>
        {picked.skill.name}
        <Text span size="xs" c={picked.skill.status === "approved" ? "var(--text-3)" : "var(--shu-text)"} ml={8}>
          {statusText(picked.skill)}
        </Text>
      </Text>
      <Text size="sm">{picked.rule.text}</Text>
      <Row label={T.head[1]!} value={picked.rule.appliesTo ?? T.anyFile} />
      <Row label={T.head[3]!} value={picked.rule.decidedBy.kind === "ai" ? T.byAi : (picked.rule.decidedBy.name ?? T.byHuman)} />
      <Row label={T.head[4]!} value={picked.rule.change === "same" ? T.same : T.change[picked.rule.change]!} />
      <Row label={T.approval} value={picked.skill.status === "approved" ? T.approved(picked.skill.approvedIn) : T.unapprovedOne} />
      <Row label={T.head[2]!} value={count(picked.rule)} />
      {picked.rule.sample && (
        <Text size="xs" c="dimmed" data-testid="reading-sample">
          {T.sample(picked.rule.sample.file, picked.rule.sample.ref, picked.rule.sample.text)}
          <a className="moyai-inline-act" href={`${sheetHash("files")}?f=${encodeURIComponent(picked.rule.sample.file)}`} data-testid="reading-show-file">
            {T.showFile}
          </a>
        </Text>
      )}
    </Stack>
  );

  return (
    <div style={{ padding: "8px 32px 32px" }} data-testid="readings-sheet">
      <Switch<Filter>
        aria-label={T.filterLabel}
        value={filter}
        onChange={setChosen}
        data-testid="readings-filter"
        data={[
          { value: "draft", label: T.filterDraft, count: draftRules, shu: draftRules > 0 },
          { value: "all", label: T.filterAll, count: allRules },
        ]}
      />
      <Stack gap="lg" mt="md">
        {shown.length === 0 && (
          <Text size="sm" c="dimmed">
            {T.noDraft}
          </Text>
        )}
        {shown.map((k) => (
          <Stack key={k.name} gap={4} data-testid="reading-skill" data-status={k.status}>
            <Text fw={700} size="sm">
              {k.name}
              <Text span size="xs" c="var(--text-3)" ml={8}>
                {T.scope[k.scope]}
              </Text>
              <Text span size="xs" c={k.status === "approved" ? "var(--text-3)" : "var(--shu-text)"} ml={8}>
                {statusText(k)}
              </Text>
            </Text>
            <Table verticalSpacing={6} fz="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th style={{ width: "60%" }}>{T.head[0]}</Table.Th>
                  <Table.Th>{T.head[1]}</Table.Th>
                  <Table.Th ta="right" style={{ whiteSpace: "nowrap" }}>{T.head[2]}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {k.rules.map((r) => (
                  <Table.Tr
                    key={r.id}
                    data-testid="reading-rule"
                    data-change={r.change}
                    className="moyai-pick-row"
                    aria-selected={picked?.rule.id === r.id && picked.skill.name === k.name}
                    onClick={() => pick(k, r)}
                    style={{ cursor: "pointer" }}
                  >
                    <Table.Td>{r.text}</Table.Td>
                    <Table.Td c="var(--text-2)">{r.appliesTo ?? T.anyFile}</Table.Td>
                    <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }}>
                      {count(r)}
                      {/* 紐付けを人が確定していない作業の数（確定するまで案を出さない。文にしない。Wire、11-06） */}
                      {r.waiting > 0 && (
                        <Text span size="xs" c="var(--text-3)" ml={8} data-testid="reading-plan-waiting">
                          {T.planWaiting(r.waiting)}
                        </Text>
                      )}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Stack>
        ))}
      </Stack>
      {side?.el && detail && createPortal(detail, side.el)}
    </div>
  );
}

/** 件数に単位を付ける（読み方の決まりは「セル 42」、計画ルールは「印 18」。Wire、11-06） */
function count(r: ReadingTabRule): string {
  return r.unit === "mark" ? T.marks(fmt(r.hits)) : T.cells(fmt(r.hits));
}

function statusText(k: ReadingTabSkill): string {
  return k.status === "approved" ? T.approvedShort(k.approvedIn) : T.status[k.status]!;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Text size="sm">
      <Text span size="xs" c="dimmed" mr={8}>
        {label}
      </Text>
      {value}
    </Text>
  );
}
