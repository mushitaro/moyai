// 取り込みの画面（plan §2.3・§2.14）：資料を入れる、全セルの行き先（色と数。未解決を押すとそのセルへ）、質問、
// 決定の一覧（取り消せる）、AI だけで結んだものの一覧、AI の作業、当てはめ（AI の規則の案を人が受ける。components/CrosswalkPanel.tsx）、
// 写真（人が 1 枚ずつ AI クライアントに渡すことを許し、読み取りを画像と並べて確かめる。components/PhotoPanel.tsx）。
// 主ボタン「計画を作る」は見出しの行の右端。止める決まりに当たる間は押せず、理由を横に出す。
// 状態は取り込みの作業場（intake/workspace.ts。このタブのメモリだけ）が持ち、AI のツールも同じ作業場を使う。
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Container,
  FileButton,
  Grid,
  Group,
  NumberInput,
  Paper,
  Radio,
  Select,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { useMemo, useState, useSyncExternalStore } from "react";
import type { Analysis } from "../../import";
import type { CellStatus } from "../../import/compose";
import type { QuestionKind, QuestionState } from "../../import/questions";
import { cellKey } from "../../import/records";
import type { SheetLayout } from "../../import/structure";
import { CHART_HASH } from "../chart/route";
import { packChoices, packFiscalStart } from "../chart/catalog";
import { CrosswalkPanel } from "../components/CrosswalkPanel";
import { FictionMark } from "../components/FictionMark";
import { PhotoPanel } from "../components/PhotoPanel";
import "../intake/intake.css";
import { answerOffered, type IntakeWorkspace, type SettleOutcome } from "../intake/workspace";
import { PHOTO_TEXT, TEXT } from "../text";

const T = TEXT.intake;
const KIND_LABEL: Record<QuestionKind, string> = T.questionKind;
const WINDOW_ROWS = 40;
const MAX_COLS = 30;

export function useWorkspace(ws: IntakeWorkspace): number {
  return useSyncExternalStore(
    (cb) => ws.subscribe(cb),
    () => ws.version,
    () => ws.version,
  );
}

function colName(c: number): string {
  let s = "";
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

type Focus = { file: string; sheetIndex: number; r: number; c: number } | null;

/** 未解決のセルを、資料・シート・行・列の順に並べる */
function unresolvedCells(an: Analysis, file?: string): { file: string; sheetIndex: number; r: number; c: number }[] {
  const out: { file: string; sheetIndex: number; r: number; c: number }[] = [];
  for (const lay of an.layouts) {
    if (file && lay.file !== file) continue;
    for (const cell of lay.grid.cells) {
      const st = an.composition.status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref }));
      if (st?.s === "unresolved") out.push({ file: lay.file, sheetIndex: lay.sheetIndex, r: cell.r, c: cell.c });
    }
  }
  return out;
}

// ─── セルの行き先 ────────────────────────────────────────────────

function Destinations({ an, onJump }: { an: Analysis; onJump: (file: string) => void }) {
  if (!an.composition.counts.length) return <Text size="sm" c="dimmed">{T.dest.none}</Text>;
  return (
    <Stack gap="xs" data-testid="destinations">
      <Group gap="md">
        {(["data", "excluded", "unresolved"] as const).map((s) => (
          <Text key={s} size="xs">
            <span className="moyai-swatch" data-s={s} />
            {T.dest[s]}
          </Text>
        ))}
      </Group>
      {an.composition.counts.map((fc) => {
        const excluded = Object.values(fc.excludedCells).reduce((a, b) => a + b, 0);
        const excludedRows = Object.values(fc.excludedRows).reduce((a, b) => a + b, 0);
        const total = Math.max(1, fc.inputCells);
        return (
          <Paper key={fc.file} withBorder p="xs" data-testid="dest-file" data-file={fc.file} data-unresolved={fc.unresolvedCells}>
            <Group justify="space-between" wrap="nowrap" gap="sm">
              <Text size="sm" fw={700} truncate>
                {fc.file}
              </Text>
              {fc.unresolvedCells > 0 ? (
                <Button size="compact-xs" color="red" variant="light" title={T.dest.jumpHint} onClick={() => onJump(fc.file)} data-testid="jump-unresolved">
                  {T.dest.jump(fc.unresolvedCells)}
                </Button>
              ) : null}
            </Group>
            <div className="moyai-dest-bar" aria-hidden="true">
              <span data-s="data" style={{ width: `${(fc.dataCells / total) * 100}%` }} />
              <span data-s="excluded" style={{ width: `${(excluded / total) * 100}%` }} />
              <span data-s="unresolved" style={{ width: `${(fc.unresolvedCells / total) * 100}%` }} />
            </div>
            <Text size="xs" className="moyai-num" mt={4}>
              {T.dest.data} {T.dest.cells(fc.dataCells)}・{T.dest.excluded} {T.dest.cells(excluded)}・{T.dest.unresolved} {T.dest.cells(fc.unresolvedCells)}
            </Text>
            <Text size="xs" className="moyai-num" c={fc.holds ? "dimmed" : "red"}>
              {T.dest.rows(fc.inputRows, fc.importedRows, excludedRows, fc.unresolvedRows)}
              {fc.holds ? "" : `（${T.dest.rowsNotHeld}）`}
            </Text>
            {excluded > 0 && (
              <Text size="xs" c="dimmed">
                {T.dest.reasons}：
                {Object.entries(fc.excludedCells)
                  .map(([k, v]) => `${k} ${v}`)
                  .join("、")}
              </Text>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}

// ─── シートのセル（色で行き先） ───────────────────────────────────────

function cellInfo(st: CellStatus | undefined, an: Analysis): string {
  if (!st) return T.dest.empty;
  if (st.s === "data") return T.sheet.cellData;
  if (st.s === "excluded") return T.sheet.cellExcluded(st.reason);
  const q = st.questionId ? an.questions.find((x) => x.questionId === st.questionId) : undefined;
  return q ? `${T.sheet.cellUnresolved}。${T.sheet.cellQuestion(q.text)}` : T.sheet.cellUnresolved;
}

function SheetView({ an, lay, focus, top, setTop, onFocus, onNext }: {
  an: Analysis;
  lay: SheetLayout;
  focus: Focus;
  top: number;
  setTop: (n: number) => void;
  onFocus: (r: number, c: number) => void;
  onNext: () => void;
}) {
  const maxRow = lay.grid.maxRow;
  const cols = Math.min(lay.grid.maxCol, MAX_COLS);
  const from = Math.max(1, Math.min(top, Math.max(1, maxRow - WINDOW_ROWS + 1)));
  const to = Math.min(maxRow, from + WINDOW_ROWS - 1);
  const rows: number[] = [];
  for (let r = from; r <= to; r++) rows.push(r);
  const focused = focus && focus.file === lay.file && focus.sheetIndex === lay.sheetIndex ? focus : null;
  const focusCell = focused ? lay.index.at(focused.r, focused.c) : null;
  const focusStatus = focusCell ? an.composition.status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: focusCell.ref })) : undefined;
  return (
    <Stack gap={6}>
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed" className="moyai-num">
          {T.sheet.rowsShown(from, to, maxRow)}
          {lay.grid.maxCol > cols ? `・${T.sheet.colsCut(cols, lay.grid.maxCol)}` : ""}
        </Text>
        <Group gap={4}>
          <Button size="compact-xs" variant="default" disabled={from <= 1} onClick={() => setTop(Math.max(1, from - WINDOW_ROWS))}>
            {T.sheet.up}
          </Button>
          <Button size="compact-xs" variant="default" disabled={to >= maxRow} onClick={() => setTop(from + WINDOW_ROWS)}>
            {T.sheet.down}
          </Button>
          <Button size="compact-xs" variant="light" color="red" onClick={onNext} data-testid="next-unresolved">
            {T.sheet.nextUnresolved}
          </Button>
        </Group>
      </Group>
      <div className="moyai-sheet">
        <Table withTableBorder={false} data-testid="sheet-grid">
          <Table.Thead>
            <Table.Tr>
              <Table.Th className="moyai-rowhead" />
              {Array.from({ length: cols }, (_, i) => (
                <Table.Th key={i}>{colName(i + 1)}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r}>
                <Table.Th className="moyai-rowhead">{r}</Table.Th>
                {Array.from({ length: cols }, (_, i) => {
                  const c = i + 1;
                  const cell = lay.index.at(r, c);
                  const st = cell ? an.composition.status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref })) : undefined;
                  const isFocus = !!focused && focused.r === r && focused.c === c;
                  return (
                    <Table.Td
                      key={c}
                      data-s={st?.s ?? ""}
                      data-ref={cell?.ref ?? ""}
                      data-focus={isFocus ? "true" : undefined}
                      title={cell?.text ?? ""}
                      onClick={() => onFocus(r, c)}
                      ref={isFocus ? (el: HTMLTableCellElement | null) => el?.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}
                    >
                      {cell?.text ?? ""}
                    </Table.Td>
                  );
                })}
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
      <Text size="xs" data-testid="cell-info">
        {focusCell ? `${T.sheet.cell(focusCell.ref)}${focusCell.page !== undefined ? T.sheet.page(focusCell.page) : ""}：${cellInfo(focusStatus, an)}` : T.sheet.pick}
      </Text>
    </Stack>
  );
}

// ─── 質問 ──────────────────────────────────────────────────────

function refusedText(r: SettleOutcome): string | null {
  return r.ok ? null : T.questions.refused[r.code];
}

function QuestionCard({ ws, q }: { ws: IntakeWorkspace; q: QuestionState }) {
  const [value, setValue] = useState<string>(q.defaultAnswer ?? "");
  const [refused, setRefused] = useState<string | null>(null);
  const ok = answerOffered(q, value);
  return (
    <Paper withBorder p="xs" data-testid="question" data-kind={q.kind} data-question={q.questionId}>
      <Text size="sm">{q.text}</Text>
      <Text size="xs" c="dimmed" className="moyai-num">
        {T.questions.rows(q.sameShapeRows)}
      </Text>
      {q.invalid && (
        <Text size="xs" c="red">
          {T.questions.invalid(q.invalid)}
        </Text>
      )}
      {q.valueKind === "number" ? (
        <NumberInput
          size="xs"
          mt={4}
          label={T.questions.numberLabel}
          min={0}
          value={value === "" ? "" : Number(value)}
          onChange={(v) => setValue(v === "" ? "" : String(v))}
          description={q.defaultAnswer !== null ? `${T.questions.defaultMark} ${q.defaultAnswer}` : T.questions.noDefault}
          style={{ maxWidth: 200 }}
        />
      ) : (
        <Radio.Group value={value} onChange={setValue} mt={4}>
          <Stack gap={4}>
            {q.options.map((o) => (
              <Radio key={o.id} value={o.id} size="xs" label={`${o.label}${o.id === q.defaultAnswer ? ` ${T.questions.defaultMark}` : ""}`} />
            ))}
          </Stack>
        </Radio.Group>
      )}
      {q.defaultAnswer === null && q.valueKind === "option" && (
        <Text size="xs" c="dimmed">
          {T.questions.noDefault}
        </Text>
      )}
      <Group justify="flex-end" mt={4}>
        {refused && (
          <Text size="xs" c="red">
            {refused}
          </Text>
        )}
        <Button
          size="compact-sm"
          variant="default"
          disabled={!ok}
          data-testid="answer"
          onClick={() => setRefused(refusedText(ws.answerAsHuman(q.questionId, value, T.questions.humanReason)))}
        >
          {T.questions.answer}
        </Button>
      </Group>
    </Paper>
  );
}

export function Questions({ ws, an }: { ws: IntakeWorkspace; an: Analysis }) {
  const groups = useMemo(() => {
    const m = new Map<QuestionKind, QuestionState[]>();
    for (const q of an.open) m.set(q.kind, [...(m.get(q.kind) ?? []), q]);
    return [...m.entries()];
  }, [an]);
  if (!groups.length) return <Text size="sm" c="dimmed">{T.questions.none}</Text>;
  return (
    <Stack gap="sm" data-testid="questions">
      {groups.map(([kind, qs]) => {
        const withDefault = qs.filter((q) => q.defaultAnswer !== null && answerOffered(q, q.defaultAnswer));
        return (
          <Stack key={kind} gap={6} data-testid="question-group" data-kind={kind}>
            <Group justify="space-between" gap="xs">
              <Title order={5}>
                {KIND_LABEL[kind] ?? T.questions.other} <Badge variant="light" size="sm" className="moyai-num">{qs.length}</Badge>
              </Title>
              {withDefault.length > 0 && (
                <Button
                  size="compact-xs"
                  variant="default"
                  data-testid="answer-group"
                  onClick={() =>
                    ws.settle(withDefault.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer ?? "", author: "human", reason: T.questions.humanReason })))
                  }
                >
                  {T.questions.answerGroup(withDefault.length)}
                </Button>
              )}
            </Group>
            {qs.map((q) => (
              <QuestionCard key={`${q.questionId}|${q.decision?.answer ?? ""}`} ws={ws} q={q} />
            ))}
          </Stack>
        );
      })}
    </Stack>
  );
}

// ─── 決定の一覧・AI だけで結んだもの・AI の作業 ─────────────────────────

function answerLabel(q: QuestionState | undefined, answer: string): string {
  if (!q || q.valueKind === "number") return answer;
  return q.options.find((o) => o.id === answer)?.label ?? answer;
}

function Decisions({ ws, an }: { ws: IntakeWorkspace; an: Analysis }) {
  const ds = ws.decisions();
  if (!ds.length) return <Text size="sm" c="dimmed">{T.decisions.none}</Text>;
  const byId = new Map(an.questions.map((q) => [q.questionId, q]));
  return (
    <Table striped withTableBorder data-testid="decisions" fz="xs">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{T.decisions.question}</Table.Th>
          <Table.Th>{T.decisions.answer}</Table.Th>
          <Table.Th>{T.decisions.author}</Table.Th>
          <Table.Th>{T.decisions.reason}</Table.Th>
          <Table.Th />
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {ds.map((d) => {
          const q = byId.get(d.questionId);
          return (
            <Table.Tr key={d.questionId} data-testid="decision" data-author={d.author}>
              <Table.Td>{q ? q.text : T.decisions.unused}</Table.Td>
              <Table.Td>{answerLabel(q, d.answer)}</Table.Td>
              <Table.Td>{TEXT.author[d.author]}</Table.Td>
              <Table.Td>{d.reason}</Table.Td>
              <Table.Td>
                <Button size="compact-xs" variant="default" onClick={() => ws.undo(d.questionId)} data-testid="undo">
                  {T.decisions.undo}
                </Button>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function AiOnly({ ws }: { ws: IntakeWorkspace }) {
  const items = ws.aiOnlyLinks();
  return (
    <Stack gap={4} data-testid="ai-only">
      <Text size="xs" c="dimmed">
        {T.aiOnly.note}
      </Text>
      {items.length === 0 ? (
        <Text size="sm" c="dimmed">
          {T.aiOnly.none}
        </Text>
      ) : (
        items.map(({ question, decision }) => (
          <Paper key={question.questionId} withBorder p="xs" data-testid="ai-only-item">
            <Text size="sm">{question.text}</Text>
            <Text size="xs">
              {T.decisions.answer}：{answerLabel(question, decision.answer)}・{T.decisions.reason}：{decision.reason}・{T.questions.rows(question.sameShapeRows)}
            </Text>
          </Paper>
        ))
      )}
    </Stack>
  );
}

function Activity({ ws }: { ws: IntakeWorkspace }) {
  if (!ws.notices.length) return <Text size="sm" c="dimmed">{T.activity.none}</Text>;
  return (
    <Stack gap={2} data-testid="activity">
      {ws.notices.slice(0, 12).map((n) => (
        <Text key={n.id} size="xs" c={n.kind === "unknown" ? "red" : undefined} data-testid={n.kind === "unknown" ? "result-unknown" : n.kind === "info" ? "screen-activity" : "ai-activity"}>
          <span className="moyai-num">{new Date(n.at).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" })}</span> {n.text}
        </Text>
      ))}
    </Stack>
  );
}

// ─── 画面 ──────────────────────────────────────────────────────

/**
 * 取り込み。embedded は MERGE の「資料」のシートとして入れるとき（docs/screens.md 3.2・3.3）：見出しを出さず、
 * 計画を作るのは副のボタン（composeLabel。白紙では「第 1 版をつくる」、版があれば「資料を重ねて第 n 版をつくる」）、
 * 当てはめの案は決定のシートへ、質問は MERGE の横の板へ移す。
 */
export function Intake({ ws, embedded = false, composeLabel }: { ws: IntakeWorkspace; embedded?: boolean; composeLabel?: string }) {
  useWorkspace(ws);
  const an = ws.fileCount ? ws.analysis() : null;
  const blockers = ws.composeBlockers();
  const compose = ws.compose;
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [fictionFound, setFictionFound] = useState(false);
  const [month, setMonth] = useState<number>(ws.settings.fiscalYearStartMonth);
  const [sel, setSel] = useState<{ file: string; sheetIndex: number } | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const [top, setTop] = useState(1);
  const packs = useMemo(() => packChoices(), []);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    try {
      await ws.addFiles(files.map((f) => ({ name: f.name, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) })));
      if (!ws.settings.fictional && ws.sourcesMarkedFictional()) {
        ws.setFacility({ fictional: true });
        setFictionFound(true);
      }
    } finally {
      setReading(false);
    }
  };

  const layouts = an?.layouts ?? [];
  const current = sel ? layouts.find((l) => l.file === sel.file && l.sheetIndex === sel.sheetIndex) : layouts[0];

  const goTo = (c: { file: string; sheetIndex: number; r: number; c: number }) => {
    setSel({ file: c.file, sheetIndex: c.sheetIndex });
    setFocus(c);
    setTop(Math.max(1, c.r - 5));
  };
  const jump = (file: string) => {
    if (!an) return;
    const first = unresolvedCells(an, file)[0];
    if (first) goTo(first);
  };
  const next = () => {
    if (!an) return;
    const all = unresolvedCells(an);
    if (!all.length) return;
    const i = focus ? all.findIndex((x) => x.file === focus.file && (x.sheetIndex > focus.sheetIndex || (x.sheetIndex === focus.sheetIndex && (x.r > focus.r || (x.r === focus.r && x.c > focus.c))))) : 0;
    goTo(all[i >= 0 ? i : 0] ?? all[0]!);
  };

  return (
    <Container size={embedded ? undefined : "xl"} fluid={embedded} py="md" data-testid="intake-page">
      <Group justify={embedded ? "flex-end" : "space-between"} align="center" mb="md" wrap="nowrap" gap="sm">
        {!embedded && (
          <Group gap="sm" wrap="nowrap">
            <Title order={2} style={{ whiteSpace: "nowrap" }}>
              {T.title}
            </Title>
            {ws.settings.facilityName && (
              <Text fw={700} truncate>
                {ws.settings.facilityName}
              </Text>
            )}
            {ws.settings.fictional && <FictionMark />}
          </Group>
        )}
        <Group gap="sm" wrap="nowrap" style={{ flex: "none" }}>
          {blockers.length > 0 && compose.state !== "running" && (
            <Text size="xs" c="dimmed" maw={420} lineClamp={2} title={blockers.join("・")} data-testid="compose-disabled-reason">
              {T.reasonsPrefix}
              {blockers.join("・")}
            </Text>
          )}
          <Button
            variant={embedded ? "default" : "filled"}
            onClick={() => ws.startCompose("human")}
            disabled={blockers.length > 0 || compose.state === "running"}
            loading={compose.state === "running"}
            data-testid="compose"
          >
            {composeLabel ?? T.compose}
          </Button>
        </Group>
      </Group>

      <Stack gap="md">
        {compose.state === "done" && (
          <Alert color="teal" title={T.composedBy[compose.by]} data-testid="composed">
            <Group justify="space-between" gap="sm">
              <Text size="sm">{T.composed(compose.plan.assets.length, compose.plan.works.length, compose.plan.details.length)}</Text>
              <Button component="a" href={CHART_HASH} variant="light" data-testid="to-chart">
                {T.toChart}
              </Button>
            </Group>
          </Alert>
        )}
        {compose.state === "failed" && (
          <Alert color="orange" title={T.composeFailed} data-testid="compose-failed">
            {compose.blockers.join("・")}
          </Alert>
        )}

        {!embedded && (
          <Paper withBorder p="sm">
            <Title order={4} mb="xs">
              {TEXT.crosswalk.title}
            </Title>
            <CrosswalkPanel />
          </Paper>
        )}

        <Paper withBorder p="sm">
          <Title order={4} mb="xs">
            {T.settings.title}
          </Title>
          <Group align="flex-end" gap="sm">
            <Select
              label={T.settings.pack}
              placeholder={T.settings.packPlaceholder}
              data={packs.map((p) => ({ value: p.id, label: T.settings.packLabel(p.id, p.table) }))}
              value={ws.settings.packId || null}
              onChange={(v) => {
                ws.setFacility({ packId: v ?? "" });
                // パックの年度の始まり（pack.json）を案として出す。効かせるのは人が［読み直す］を押したとき
                const m = v ? packFiscalStart(v) : null;
                if (m !== null) setMonth(m);
              }}
              w={360}
              data-testid="pack"
            />
            <TextInput
              label={T.settings.name}
              value={ws.settings.facilityName}
              onChange={(e) => ws.setFacility({ facilityName: e.currentTarget.value })}
              w={260}
              data-testid="facility-name"
            />
            <NumberInput label={T.settings.startMonth} min={1} max={12} value={month} onChange={(v) => setMonth(Number(v) || month)} w={140} />
            {month !== ws.settings.fiscalYearStartMonth && (
              <Button
                variant="default"
                title={T.settings.applyHint}
                loading={reading}
                onClick={async () => {
                  setReading(true);
                  try {
                    await ws.configure({ ...ws.settings, fiscalYearStartMonth: Math.min(12, Math.max(1, Math.round(month))) });
                  } finally {
                    setReading(false);
                  }
                }}
              >
                {T.settings.apply}
              </Button>
            )}
            <Checkbox
              label={T.settings.fictional}
              checked={ws.settings.fictional}
              onChange={(e) => ws.setFacility({ fictional: e.currentTarget.checked })}
              mb={8}
              data-testid="fictional"
            />
          </Group>
          {fictionFound && ws.settings.fictional && (
            <Text size="xs" c="dimmed" mt={4}>
              {T.settings.fictionalFound}
            </Text>
          )}
        </Paper>

        <Paper
          className="moyai-drop"
          data-over={over ? "true" : "false"}
          data-testid="drop"
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void addFiles([...e.dataTransfer.files]);
          }}
        >
          <Group justify="space-between" gap="sm">
            <Stack gap={2}>
              <Title order={4}>{T.drop.title}</Title>
              <Text size="sm">{T.drop.hint}</Text>
            </Stack>
            <FileButton multiple onChange={(fs) => void addFiles(fs)}>
              {(props) => (
                <Button {...props} variant="default" loading={reading}>
                  {T.drop.pick}
                </Button>
              )}
            </FileButton>
          </Group>
          {reading && (
            <Text size="xs" c="dimmed">
              {T.drop.reading}
            </Text>
          )}
          {(ws.skippedFiles.length > 0 || (an?.rejected.length ?? 0) > 0) && (
            <Stack gap={0} mt={4} data-testid="skipped">
              <Text size="xs" fw={700}>
                {T.drop.skipped}
              </Text>
              {[...ws.skippedFiles, ...(an?.rejected ?? [])].map((r, i) => (
                <Text key={i} size="xs" c="orange">
                  {r.file}：{r.reason}
                </Text>
              ))}
            </Stack>
          )}
        </Paper>

        {ws.photoBook.entries().length > 0 && (
          <Paper withBorder p="sm">
            <Title order={4} mb="xs">
              {PHOTO_TEXT.title}
            </Title>
            <PhotoPanel ws={ws} an={an} />
          </Paper>
        )}

        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="md">
              <Paper withBorder p="sm">
                <Title order={4} mb="xs">
                  {T.dest.title}
                </Title>
                {an ? <Destinations an={an} onJump={jump} /> : <Text size="sm" c="dimmed">{T.dest.none}</Text>}
              </Paper>
              {an && current && (
                <Paper withBorder p="sm">
                  <Group justify="space-between" mb="xs" gap="sm">
                    <Title order={5}>{T.sheet.title(current.file, current.sheet)}</Title>
                    <Select
                      size="xs"
                      aria-label={T.sheet.choose}
                      data={layouts.map((l) => ({ value: `${l.sheetIndex}\u0000${l.file}`, label: T.sheet.title(l.file, l.sheet) }))}
                      value={`${current.sheetIndex}\u0000${current.file}`}
                      onChange={(v) => {
                        if (!v) return;
                        const [si, ...f] = v.split("\u0000");
                        setSel({ file: f.join("\u0000"), sheetIndex: Number(si) });
                        setTop(1);
                      }}
                      w={320}
                    />
                  </Group>
                  <SheetView
                    an={an}
                    lay={current}
                    focus={focus}
                    top={top}
                    setTop={setTop}
                    onFocus={(r, c) => setFocus({ file: current.file, sheetIndex: current.sheetIndex, r, c })}
                    onNext={next}
                  />
                </Paper>
              )}
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="md">
              {!embedded && (
                <Paper withBorder p="sm">
                  <Title order={4} mb="xs">
                    {T.questions.title}
                  </Title>
                  {an ? <Questions ws={ws} an={an} /> : <Text size="sm" c="dimmed">{T.questions.none}</Text>}
                </Paper>
              )}
              <Paper withBorder p="sm">
                <Title order={4} mb="xs">
                  {T.activity.title}
                </Title>
                <Activity ws={ws} />
              </Paper>
            </Stack>
          </Grid.Col>
        </Grid>

        <Paper withBorder p="sm">
          <Title order={4} mb="xs">
            {T.decisions.title}
          </Title>
          {an ? <Decisions ws={ws} an={an} /> : <Text size="sm" c="dimmed">{T.decisions.none}</Text>}
        </Paper>
        <Paper withBorder p="sm" mb="xl">
          <Title order={4} mb="xs">
            {T.aiOnly.title}
          </Title>
          {an && <AiOnly ws={ws} />}
        </Paper>
      </Stack>
    </Container>
  );
}
