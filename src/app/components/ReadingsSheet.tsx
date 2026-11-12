// MERGE のシート「ルール」（docs/screens.md 3.2「読み方」・Wire のキャンバスの Reading.dc.html。MERGE r2）：作業画面が当てている 3 段目の Skill（ルール）。
// 上に切り替え「下書き n ／ 全件 n」（既定は下書き。下書きが 0 なら全件）。ルールごとに見出しの 1 行（名前・範囲・状態）と、1 つの決まりを 1 行（内容｜元の資料｜件数。値は「セル n」「印 n」）。
// 確定者・元の版・承認・見本は本体に置かず、行を選ぶと横の板の「詳細」に出す。
// データは state/reading-tab.ts の readingTab()。
// 古い版を開いたとき（Wire、11-07 夜。動画 C14）：その版をつくったときに当てていたルールを同じ表で並べる（版の記録から。見るだけ）。
// 状態の字は text-3 で「第 n 版で適用」。切り替え「下書き n ／ 全件 n」は出さない。記録の無い版は「適用ルールの記録なし」の 1 行。
// ルールの見出しの行を選ぶと、詳細にそのルールの来歴（名前と版「v n」・範囲・置き場・適用先 n と版の行・ルールの版ごとの行）。
// 適用先は MOYAI が読める版（保管先の版の記録）だけ。読めない施設は数えない（state/rule-lineage.ts）。
import { Stack, Table, Text } from "@mantine/core";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReadingScope } from "../../import/reading";
import type { Plan } from "../../shared/plan";
import type { IntakeWorkspace } from "../intake/workspace";
import { STAGE_HASH, sheetHash } from "../stages";
import { planRuleMarks, planRuleWaiting } from "../state/cycles";
import { MergeSideContext } from "../state/merge-side";
import { useWorkingPlan } from "../state/plan-store";
import { appliedTab, readingHitsOf, readingTab, type AppliedTabSkill, type ReadingTabRule, type ReadingTabSkill } from "../state/reading-tab";
import { appliedTo, placeFor, ruleVersionNo, ruleVersions, type Lineage, type RecordedReading } from "../state/rule-lineage";
import { tokyoYmd, versionName } from "../version-name";
import { HUMAN_TEXT, TEXT } from "../text";
import { Switch } from "./Switch";
import { ReadingOutBody, type ReadingOut } from "./ReadingOut";

const T = HUMAN_TEXT.readings;
const fmt = (n: number) => n.toLocaleString("ja-JP");
type Filter = "draft" | "all";

/** 古い版を見るだけで開いているとき：開いている版の番号と、その版の記録の読み方（null は記録なし）と、その版の計画 */
export interface OldReadings {
  version: number;
  skills: RecordedReading[] | null;
  plan: Plan | null;
}

/** ルールのシートで、そのルールを選んで開く道（署名の「適用 Skill」のルールの行から。?rule=<置き場所の道>） */
export const ruleHash = (path: string) => `${sheetHash("readings")}?rule=${encodeURIComponent(path)}`;
const ruleParam = () => new URLSearchParams(location.hash.split("?")[1] ?? "").get("rule");

/** 未承認のルールの決まりの数（シートのタブの「ルール n」） */
export function unapprovedReadings(ws: IntakeWorkspace): number {
  if (!ws.fileCount || ws.currentReadings().length === 0) return 0;
  return readingTab(ws.currentReadings(), readingHitsOf(ws.view)).unapproved;
}

export function ReadingsSheet({ ws, old = null, lineage = null, out = null }: { ws: IntakeWorkspace; old?: OldReadings | null; lineage?: Lineage | null; out?: ReadingOut | null }) {
  if (old) return <AppliedReadingsSheet old={old} lineage={lineage} />;
  // 読み方の書き出し：押したあいだは、シートの本体を書き出す全文に替える（Wire の ReadingOut）
  if (out?.state.kind === "preview")
    return (
      <div style={{ padding: "8px 32px 32px" }} data-testid="readings-sheet">
        <ReadingOutBody out={out} />
      </div>
    );
  return (
    <>
      <CurrentReadingsSheet ws={ws} lineage={lineage} />
      {out && out.state.kind !== "list" && (
        <div style={{ padding: "0 32px 32px" }}>
          <ReadingOutBody out={out} />
        </div>
      )}
    </>
  );
}

/** 選んだもの：ルールの見出しの行（来歴）か、決まりの行 */
type Picked<S, R> = { skill: S; rule: R | null };

/** ?rule= のルールを選び、詳細を開く（署名の「適用 Skill」のルールの行から来たとき）。同じ道は 1 度だけ（人が選び直したあとに戻さない） */
function useRuleParam<S>(skills: readonly S[], placeOfSkill: (s: S) => string | null, pick: (s: S) => void, ready: unknown): void {
  const param = ruleParam();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!param || done.current === param) return;
    const s = skills.find((x) => placeOfSkill(x) === param);
    if (!s) return;
    done.current = param;
    pick(s);
  }, [param, skills, ready]);
}

function CurrentReadingsSheet({ ws, lineage }: { ws: IntakeWorkspace; lineage: Lineage | null }) {
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
  const [picked, setPicked] = useState<Picked<ReadingTabSkill, ReadingTabRule> | null>(null);
  const pick = (skill: ReadingTabSkill, rule: ReadingTabRule | null) => {
    setPicked({ skill, rule });
    side?.show();
  };
  const placeOfSkill = (k: ReadingTabSkill) => placeFor(lineage, { name: k.name, scope: k.scope, path: k.ref.path }, ws.facilityKey());
  useRuleParam(
    tab.skills,
    placeOfSkill,
    (k) => {
      if (k.status === "approved") setChosen("all");
      pick(k, null);
    },
    lineage,
  );

  if (tab.skills.length === 0)
    return (
      <Text size="sm" c="dimmed" px={32} py="md" data-testid="readings-sheet">
        <span data-testid="readings-none">{T.none}</span>
      </Text>
    );

  const detail =
    picked &&
    (picked.rule === null ? (
      <RuleLineageDetail
        name={picked.skill.name}
        scope={picked.skill.scope}
        place={placeOfSkill(picked.skill)}
        stored={picked.skill.ref.path !== null}
        version={picked.skill.ref.version || null}
        lineage={lineage}
      />
    ) : (
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
    ));

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
            <SkillHead
              name={k.name}
              scope={k.scope}
              status={statusText(k)}
              statusShu={k.status !== "approved"}
              selected={picked?.rule === null && picked.skill.name === k.name}
              onPick={() => pick(k, null)}
            />
            <RulesTable
              rows={k.rules.map((r) => ({ id: r.id, text: r.text, appliesTo: r.appliesTo, count: count(r), waiting: r.waiting, change: r.change }))}
              selected={picked?.rule && picked.skill.name === k.name ? picked.rule.id : null}
              onPick={(id) => {
                const r = k.rules.find((x) => x.id === id);
                if (r) pick(k, r);
              }}
            />
          </Stack>
        ))}
      </Stack>
      {side?.el && detail && createPortal(detail, side.el)}
    </div>
  );
}

/** 古い版のルールのシート：その版で当てていたルールを、今と同じ表で見るだけ（切り替え・操作は置かない） */
function AppliedReadingsSheet({ old, lineage }: { old: OldReadings; lineage: Lineage | null }) {
  const skills = useMemo(() => (old.skills ? appliedTab(old.skills, (name, r) => planRuleMarks(old.plan, name, r.id)) : []), [old]);
  const side = useContext(MergeSideContext);
  const [picked, setPicked] = useState<Picked<AppliedTabSkill, AppliedTabSkill["rules"][number]> | null>(null);
  const pick = (skill: AppliedTabSkill, rule: AppliedTabSkill["rules"][number] | null) => {
    setPicked({ skill, rule });
    side?.show();
  };
  useRuleParam(skills, (k) => k.path, (k) => pick(k, null), lineage);
  const status = T.appliedIn(old.version);

  if (old.skills === null)
    return (
      <Text size="sm" c="var(--text-3)" px={32} py="md" data-testid="readings-sheet" data-old="true">
        <span data-testid="readings-applied-none">{T.appliedNone}</span>
      </Text>
    );

  // 件数の列は、版の記録から数えられる行（計画ルール）があるときだけ（読み方の決まりの効いたセルは版の記録に無い）
  const withCount = skills.some((k) => k.rules.some((r) => r.hits !== null));
  const detail =
    picked &&
    (picked.rule === null ? (
      <RuleLineageDetail name={picked.skill.name} scope={picked.skill.scope} place={picked.skill.path} stored={picked.skill.found} version={picked.skill.version} lineage={lineage} />
    ) : (
      <Stack gap="xs" data-testid="reading-detail" data-rule={picked.rule.id}>
        <Text size="sm" fw={700}>
          {picked.skill.name}
          <Text span size="xs" c="var(--text-3)" ml={8}>
            {status}
          </Text>
        </Text>
        <Text size="sm">{picked.rule.text}</Text>
        <Row label={T.head[1]!} value={picked.rule.appliesTo ?? T.anyFile} />
        <Row label={T.head[3]!} value={picked.rule.decidedBy.kind === "ai" ? T.byAi : (picked.rule.decidedBy.name ?? T.byHuman)} />
        {picked.rule.hits !== null && <Row label={T.head[2]!} value={count({ hits: picked.rule.hits, unit: picked.rule.unit })} />}
      </Stack>
    ));

  return (
    <div style={{ padding: "8px 32px 32px" }} data-testid="readings-sheet" data-old="true">
      <Stack gap="lg" mt="md">
        {skills.map((k) => (
          <Stack key={`${k.path}|${k.version}`} gap={4} data-testid="reading-skill" data-status="applied">
            <SkillHead name={k.name} scope={k.scope} status={status} statusShu={false} selected={picked?.rule === null && picked.skill.path === k.path} onPick={() => pick(k, null)} />
            {k.found ? (
              <RulesTable
                rows={k.rules.map((r) => ({ id: r.id, text: r.text, appliesTo: r.appliesTo, count: r.hits === null ? null : count({ hits: r.hits, unit: r.unit }), waiting: 0, change: null }))}
                withCount={withCount}
                selected={picked?.rule && picked.skill.path === k.path ? picked.rule.id : null}
                onPick={(id) => {
                  const r = k.rules.find((x) => x.id === id);
                  if (r) pick(k, r);
                }}
              />
            ) : (
              <Text size="sm" c="var(--text-3)" data-testid="reading-no-content">
                {T.noContent}
              </Text>
            )}
          </Stack>
        ))}
      </Stack>
      {side?.el && detail && createPortal(detail, side.el)}
    </div>
  );
}

/** ルールの見出しの行（名前・範囲・状態）。押すと詳細に来歴 */
function SkillHead({ name, scope, status, statusShu, selected, onPick }: { name: string; scope: ReadingScope | null; status: string; statusShu: boolean; selected: boolean; onPick: () => void }) {
  return (
    <Text
      fw={700}
      size="sm"
      className="moyai-pick-row"
      role="button"
      tabIndex={0}
      data-picked={selected ? "true" : undefined}
      style={{ cursor: "pointer" }}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onPick();
      }}
      data-testid="reading-skill-head"
    >
      {name}
      {scope && (
        <Text span size="xs" c="var(--text-3)" ml={8}>
          {T.scope[scope]}
        </Text>
      )}
      <Text span size="xs" c={statusShu ? "var(--shu-text)" : "var(--text-3)"} ml={8} data-testid="reading-skill-status">
        {status}
      </Text>
    </Text>
  );
}

/** 決まりの表（内容｜元の資料｜件数）。今の作業と古い版で同じ形 */
function RulesTable({
  rows,
  withCount = true,
  selected,
  onPick,
}: {
  rows: { id: string; text: string; appliesTo: string | null; count: string | null; waiting: number; change: ReadingTabRule["change"] | null }[];
  withCount?: boolean;
  selected: string | null;
  onPick: (id: string) => void;
}) {
  return (
    <Table verticalSpacing={6} fz="sm">
      <Table.Thead>
        <Table.Tr>
          <Table.Th style={{ width: "60%" }}>{T.head[0]}</Table.Th>
          <Table.Th>{T.head[1]}</Table.Th>
          {withCount && (
            <Table.Th ta="right" style={{ whiteSpace: "nowrap" }}>
              {T.head[2]}
            </Table.Th>
          )}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {rows.map((r) => (
          <Table.Tr
            key={r.id}
            data-testid="reading-rule"
            data-change={r.change ?? undefined}
            className="moyai-pick-row"
            aria-selected={selected === r.id}
            onClick={() => onPick(r.id)}
            style={{ cursor: "pointer" }}
          >
            <Table.Td>{r.text}</Table.Td>
            <Table.Td c="var(--text-2)">{r.appliesTo ?? T.anyFile}</Table.Td>
            {withCount && (
              <Table.Td className="moyai-num" ta="right" style={{ whiteSpace: "nowrap" }}>
                {r.count}
                {/* 紐付けを人が確定していない作業の数（確定するまで案を出さない。文にしない。Wire、11-06） */}
                {r.waiting > 0 && (
                  <Text span size="xs" c="var(--text-3)" ml={8} data-testid="reading-plan-waiting">
                    {T.planWaiting(r.waiting)}
                  </Text>
                )}
              </Table.Td>
            )}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

const openLink = (planId: string, version: number, contentHash: string) => `${STAGE_HASH.merge}?open=${encodeURIComponent(planId)}&v=${version}&h=${contentHash.slice(0, 16)}`;
const monthOf = (iso: string) => {
  const d = tokyoYmd(iso);
  return d ? `${d.y}-${String(d.m).padStart(2, "0")}` : "";
};

/**
 * ルールの詳細（見出しの行を選んだとき）：名前と版「v n」、範囲、置き場（置いた所だけ）、「適用先 n」と版の行（新しい順、開ける版だけ「| 開く」）、
 * ルールの版ごとの行「v1　2026-05」。来歴をまだ読んでいなければ、適用先と版ごとの行は出さない
 */
export function RuleLineageDetail({
  name,
  scope,
  place,
  stored,
  version,
  lineage,
}: {
  name: string;
  scope: ReadingScope | null;
  /** 置き場所の道（保管先にまだ無い下書きは null） */
  place: string | null;
  /** 保管先に置いてあるか */
  stored: boolean;
  /** 見ているルールの版（中身のハッシュ。下書きは null） */
  version: string | null;
  lineage: Lineage | null;
}) {
  const no = place && version ? ruleVersionNo(lineage, place, version) : null;
  const inStore = stored || (!!place && !!lineage?.places.some((p) => p.path === place));
  const rows = lineage && place ? appliedTo(lineage, place) : null;
  const versions = lineage && place ? ruleVersions(lineage, place) : [];
  const mark = `【${TEXT.fictionMark}】`;
  return (
    <Stack gap="xs" data-testid="rule-lineage" data-place={place ?? ""}>
      <Text size="sm" fw={700} data-testid="rule-lineage-name">
        {name}
        {no !== null && (
          <Text span ff="monospace" fz={11} fw={400} c="var(--text-3)" ml={6}>
            {T.ruleVersion(no)}
          </Text>
        )}
      </Text>
      {scope && <Row label={T.scopeLabel} value={T.scope[scope]!} />}
      {inStore && <Row label={T.placeLabel} value={T.placeStore} />}
      {rows && (
        <>
          <Text size="xs" fw={700} mt="xs" data-testid="rule-applied-count" data-count={rows.length}>
            {T.appliedTo(rows.length)}
          </Text>
          {rows.map(({ v, ruleNo }) => {
            const facility = v.fictional && !v.displayName.includes(mark) ? `${mark}${v.displayName}` : v.displayName;
            const label = v.held ? `${HUMAN_TEXT.versionName.plain(v.version)}　${TEXT.top.state[v.held] ?? ""}` : versionName(v.version, v.signedAt, v.fiscalYearStartMonth);
            return (
              <Text size="xs" key={`${v.planId}|${v.version}`} data-testid="rule-applied" data-plan={v.planId} data-version={v.version}>
                {facility}　{label}
                {ruleNo !== null && (
                  <>
                    {"　"}
                    <Text span ff="monospace" fz={11} c="var(--text-3)">
                      {T.ruleVersion(ruleNo)}
                    </Text>
                  </>
                )}
                {v.openable && (
                  <a className="moyai-inline-act" href={openLink(v.planId, v.version, v.contentHash)} data-testid="rule-applied-open">
                    {T.open}
                  </a>
                )}
              </Text>
            );
          })}
          {versions.length > 0 && (
            <Stack gap={2} mt="xs">
              {versions.map((x) => (
                <Text size="xs" key={x.version} data-testid="rule-version" data-n={x.n}>
                  <Text span ff="monospace" fz={11} c="var(--text-3)">
                    {T.ruleVersion(x.n)}
                  </Text>
                  {"　"}
                  <span className="moyai-num">{monthOf(x.firstAt)}</span>
                </Text>
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}

/** 件数に単位を付ける（読み方の決まりは「セル 42」、計画ルールは「印 18」。Wire、11-06） */
function count(r: { hits: number; unit: "cell" | "mark" }): string {
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
