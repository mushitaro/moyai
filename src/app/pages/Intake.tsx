// 取り込みの画面（plan §2.3・§2.14）：資料を入れる、全セルの行き先（色と数。未解決を押すとそのセルへ）、質問、
// 決定の一覧（取り消せる）、AI だけで結んだものの一覧、AI の作業、当てはめ（AI の規則の案を人が受ける。components/CrosswalkPanel.tsx）、
// 写真（人が 1 枚ずつ AI クライアントに渡すことを許し、読み取りを画像と並べて確かめる。components/PhotoPanel.tsx）。
// 主ボタン「計画を作る」は見出しの行の右端。止める決まりに当たる間は押せず、理由を横に出す。
// 状態は取り込みの作業場（intake/workspace.ts。このタブのメモリだけ）が持ち、AI のツールも同じ作業場を使う。
import { removedCellOf } from "../state/stars";
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
import { useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { MergeSideContext } from "../state/merge-side";
import { Switch } from "../components/Switch";
import type { CellStatus } from "../../import/compose";
import type { QuestionKind } from "../../import/questions";
import { CHART_HASH } from "../chart/route";
import { packChoices, packFiscalStart } from "../chart/catalog";
import { CrosswalkPanel } from "../components/CrosswalkPanel";
import { FictionMark } from "../components/FictionMark";
import { PhotoPanel } from "../components/PhotoPanel";
import "../intake/intake.css";
import { answerOffered, type CellPos, type IntakeView, type IntakeWorkspace, type QuestionView, type SettleOutcome, type SheetData } from "../intake/workspace";
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

type Focus = CellPos | null;

/**
 * 1 つの資料のシート（セルと行き先）を、取り込みの受け手から読む。資料と決定が変わったら（写しの版が進んだら）読み直す。
 * 読み直している間は、前に読んだものを出したままにする
 */
function useSheets(ws: IntakeWorkspace, file: string | null): SheetData[] | null {
  const at = ws.view.at;
  const [got, setGot] = useState<{ file: string; at: number; sheets: SheetData[] } | null>(null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void ws
      .sheets(file)
      .then((sheets) => {
        if (live) setGot({ file, at, sheets });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ws, file, at]);
  return got && got.file === file ? got.sheets : null;
}

// ─── セルの行き先 ────────────────────────────────────────────────

function Destinations({ view, onJump }: { view: IntakeView; onJump: (file: string) => void }) {
  if (!view.counts.length) return <Text size="sm" c="dimmed">{T.dest.none}</Text>;
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
      {view.counts.map((fc) => {
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
              <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }} data-testid="dest-reasons">
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

function cellInfo(st: CellStatus | undefined, view: IntakeView): string {
  if (!st) return T.dest.empty;
  if (st.s === "data") return T.sheet.cellData;
  if (st.s === "excluded") return T.sheet.cellExcluded(st.reason);
  const q = st.questionId ? view.questions.find((x) => x.questionId === st.questionId) : undefined;
  return q ? `${T.sheet.cellUnresolved}。${T.sheet.cellQuestion(q.text)}` : T.sheet.cellUnresolved;
}

function SheetView({ view, lay, focus, top, setTop, onFocus, onNext }: {
  view: IntakeView;
  lay: SheetData;
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
  const focusStatus = focusCell ? lay.status.get(focusCell.ref) : undefined;
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
                  const st = cell ? lay.status.get(cell.ref) : undefined;
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
        {focusCell ? `${T.sheet.cell(focusCell.ref)}${focusCell.page !== undefined ? T.sheet.page(focusCell.page) : ""}：${cellInfo(focusStatus, view)}` : T.sheet.pick}
      </Text>
    </Stack>
  );
}

// ─── 資料のタブ（MERGE r2。docs/screens.md 3.2「資料のシート」、絵は Source.dc.html） ─────────────

type SourceFilter = "open" | "all";

/**
 * MERGE の資料のタブ：その資料 1 つだけ。上に切り替え「未確定行 n ／ 全行 n」（既定は未確定行、数は朱）と凡例。その下に元の表
 * （行の番号と列の字。未確定のセルは朱の枠）。セルを選ぶと、横の板の「詳細」にそのセルの行き先（未確定ならその質問）を出す。
 * 施設の欄・すべての資料の行き先の一覧・AI の作業の記録は置かない
 */
function SourceTab({ view, layouts }: { view: IntakeView; layouts: SheetData[] }) {
  const S = T.source;
  const [sheet, setSheet] = useState(0);
  const lay = layouts[Math.min(sheet, layouts.length - 1)]!;
  const statusOf = (ref: string) => lay.status.get(ref);
  const cols = Math.min(lay.grid.maxCol, MAX_COLS);
  // 未確定のセルがある行
  const openRows = useMemo(() => {
    const out = new Set<number>();
    for (const cell of lay.grid.cells) if (statusOf(cell.ref)?.s === "unresolved") out.add(cell.r);
    return [...out].sort((a, b) => a - b);
  }, [lay]);
  const [chosen, setChosen] = useState<SourceFilter | null>(null);
  const filter: SourceFilter = chosen ?? (openRows.length > 0 ? "open" : "all");
  const [top, setTop] = useState(1);
  const allRows = Array.from({ length: lay.grid.maxRow }, (_, i) => i + 1);
  const list = filter === "open" ? openRows : allRows;
  const from = Math.max(0, Math.min(top - 1, Math.max(0, list.length - WINDOW_ROWS)));
  const rows = list.slice(from, from + WINDOW_ROWS);
  const side = useContext(MergeSideContext);
  const [picked, setPicked] = useState<{ r: number; c: number } | null>(null);
  const pickedCell = picked ? lay.index.at(picked.r, picked.c) : null;
  const pickedStatus = pickedCell ? statusOf(pickedCell.ref) : undefined;
  const detail = picked && (
    <Stack gap="xs" data-testid="source-cell-detail" data-s={pickedStatus?.s ?? ""}>
      <Text size="sm" fw={700} className="moyai-num">
        {T.sheet.title(lay.file, lay.sheet)}　{pickedCell ? T.sheet.cell(pickedCell.ref) : `${colName(picked.c)}${picked.r}`}
        {pickedCell?.page !== undefined ? T.sheet.page(pickedCell.page) : ""}
      </Text>
      {pickedCell?.text && <Text size="sm">「{pickedCell.text}」</Text>}
      <Text size="sm" c={pickedStatus?.s === "unresolved" ? "var(--shu-text)" : undefined}>
        {cellInfo(pickedStatus, view)}
      </Text>
      {(() => {
        // 版の履歴で人が確定して消した星取のセル：「削除（第 n 版）」と理由（Architect の 70。Wire）
        const rm = pickedCell ? removedCellOf(lay.file, lay.sheet, pickedCell.ref) : undefined;
        return (
          rm && (
            <Text size="sm" data-testid="source-cell-removed">
              {T.source.removedIn(rm.version)}　{rm.reason}
            </Text>
          )
        );
      })()}
    </Stack>
  );
  return (
    <Stack gap="sm" data-testid="source-tab" data-file={lay.file}>
      <Group justify="space-between" gap="md" wrap="nowrap">
        <Group gap="lg" wrap="nowrap">
          <Switch<SourceFilter>
            aria-label={S.filterLabel}
            value={filter}
            onChange={(v) => {
              setChosen(v);
              setTop(1);
            }}
            data-testid="source-filter"
            data={[
              { value: "open", label: S.openRows, count: openRows.length, shu: openRows.length > 0 },
              { value: "all", label: S.allRows, count: lay.grid.maxRow },
            ]}
          />
          <Text size="xs" c="var(--text-3)" data-testid="source-legend">
            <span className="moyai-swatch" data-s="data" /> {S.read}　<span className="moyai-swatch" data-s="excluded" /> {S.excluded}　<span className="moyai-swatch" data-s="unresolved" /> {S.open}
          </Text>
        </Group>
        {layouts.length > 1 && (
          <Select
            size="xs"
            aria-label={T.sheet.choose}
            data={layouts.map((l, i) => ({ value: String(i), label: l.sheet ?? l.file }))}
            value={String(Math.min(sheet, layouts.length - 1))}
            onChange={(v) => {
              if (v === null) return;
              setSheet(Number(v));
              setTop(1);
              setPicked(null);
            }}
            w={240}
          />
        )}
      </Group>
      <div className="moyai-sheet moyai-source">
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
                  const st = cell ? statusOf(cell.ref) : undefined;
                  const isPicked = !!picked && picked.r === r && picked.c === c;
                  return (
                    <Table.Td
                      key={c}
                      data-s={st?.s ?? ""}
                      data-ref={cell?.ref ?? ""}
                      data-focus={isPicked ? "true" : undefined}
                      title={cell?.text ?? ""}
                      onClick={() => {
                        setPicked({ r, c });
                        side?.show();
                      }}
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
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="var(--text-3)" className="moyai-num">
          {list.length > WINDOW_ROWS ? S.rowsShown(from + 1, Math.min(list.length, from + WINDOW_ROWS), list.length) : ""}
          {lay.grid.maxCol > cols ? `　${T.sheet.colsCut(cols, lay.grid.maxCol)}` : ""}
        </Text>
        {list.length > WINDOW_ROWS && (
          <Group gap={4}>
            <Button size="compact-xs" variant="default" disabled={from <= 0} onClick={() => setTop(Math.max(1, from + 1 - WINDOW_ROWS))}>
              {T.sheet.up}
            </Button>
            <Button size="compact-xs" variant="default" disabled={from + WINDOW_ROWS >= list.length} onClick={() => setTop(from + 1 + WINDOW_ROWS)}>
              {T.sheet.down}
            </Button>
          </Group>
        )}
      </Group>
      {side?.el && detail && createPortal(detail, side.el)}
    </Stack>
  );
}

// ─── 質問 ──────────────────────────────────────────────────────

function refusedText(r: SettleOutcome): string | null {
  return r.ok ? null : T.questions.refused[r.code];
}

function QuestionCard({ ws, q }: { ws: IntakeWorkspace; q: QuestionView }) {
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
          disabled={!ok || ws.busy}
          data-testid="answer"
          onClick={() => void ws.answerAsHumanAsync(q.questionId, value, T.questions.humanReason).then((r) => setRefused(refusedText(r)))}
        >
          {T.questions.answer}
        </Button>
      </Group>
    </Paper>
  );
}

export function Questions({ ws, view }: { ws: IntakeWorkspace; view: IntakeView }) {
  const groups = useMemo(() => {
    const byId = new Map(view.questions.map((q) => [q.questionId, q]));
    const m = new Map<QuestionKind, QuestionView[]>();
    for (const id of view.open) {
      const q = byId.get(id);
      if (q) m.set(q.kind, [...(m.get(q.kind) ?? []), q]);
    }
    return [...m.entries()];
  }, [view]);
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
                  disabled={ws.busy}
                  data-testid="answer-group"
                  onClick={() =>
                    void ws.settleAsync(withDefault.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer ?? "", author: "human", reason: T.questions.humanReason })))
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

function answerLabel(q: QuestionView | undefined, answer: string): string {
  if (!q || q.valueKind === "number") return answer;
  return q.options.find((o) => o.id === answer)?.label ?? answer;
}

function Decisions({ ws, view }: { ws: IntakeWorkspace; view: IntakeView }) {
  const ds = ws.decisions();
  if (!ds.length) return <Text size="sm" c="dimmed">{T.decisions.none}</Text>;
  const byId = new Map(view.questions.map((q) => [q.questionId, q]));
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
                <Button size="compact-xs" variant="default" disabled={ws.busy} onClick={() => void ws.undoAsync(d.questionId)} data-testid="undo">
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
export function Intake({
  ws,
  embedded = false,
  composeLabel,
  composeInBar = false,
  file = null,
}: {
  ws: IntakeWorkspace;
  embedded?: boolean;
  composeLabel?: string;
  /** 計画をつくるボタンは MERGE の下の帯にある（白紙のあいだ）。ここには出さない */
  composeInBar?: boolean;
  file?: string | null;
}) {
  useWorkspace(ws);
  // 画面は受け手から返った写しを読む（取り込みは worker の中。読み取りの間も画面は止まらない）
  const view = ws.fileCount ? ws.view : null;
  const blockers = ws.composeBlockers();
  const compose = ws.compose;
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
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
      // 「架空」の印は、読み終わったあとの写しで見る
      await ws.fresh(undefined, false).catch(() => undefined);
      if (!ws.settings.fictional && ws.sourcesMarkedFictional()) {
        ws.setFacility({ fictional: true });
      }
    } finally {
      setReading(false);
    }
  };

  const layouts = view?.sheets ?? [];
  // MERGE の資料ごとのタブ（?f=）で開いたら、その資料の最初のシートを見せる
  useEffect(() => {
    if (!file) return;
    const l = layouts.find((x) => x.file === file);
    if (l) setSel({ file, sheetIndex: l.sheetIndex });
  }, [file, layouts.length]);
  const current = sel ? layouts.find((l) => l.file === sel.file && l.sheetIndex === sel.sheetIndex) : layouts[0];
  // 開いている資料のシートだけを受け手から読む（資料のタブなら、その資料）
  const sheetsOf = useSheets(ws, embedded && file ? file : (current?.file ?? null));
  const currentSheet = current ? sheetsOf?.find((l) => l.file === current.file && l.sheetIndex === current.sheetIndex) : undefined;

  const goTo = (c: CellPos) => {
    setSel({ file: c.file, sheetIndex: c.sheetIndex });
    setFocus(c);
    setTop(Math.max(1, c.r - 5));
  };
  const jump = (file: string) => {
    if (!view) return;
    void ws.nextUnresolved(null, file).then((first) => first && goTo(first));
  };
  const next = () => {
    if (!view) return;
    void ws.nextUnresolved(focus).then((c) => c && goTo(c));
  };

  return (
    <Container size={embedded ? undefined : "xl"} fluid={embedded} py="md" data-testid="intake-page" data-busy={ws.busy ? "true" : undefined}>
      {/* 白紙の MERGE の中では、上の行ごと出さない（主ボタンは下の帯にある） */}
      {!composeInBar && (
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
      )}

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
            <Title order={4} fz={14} fw={500} mb="xs">
              {TEXT.crosswalk.title}
            </Title>
            <CrosswalkPanel />
          </Paper>
        )}

        {/* 施設の欄は資料のタブに置かない（施設設定にある。MERGE r2） */}
        {!(embedded && file) && (
        <Paper withBorder p="sm">
          <Title order={4} fz={14} fw={500} mb="xs">
            {T.settings.title}
          </Title>
          <Group align="flex-end" gap="sm">
            <Select
              label={T.settings.pack}
              placeholder={T.settings.packPlaceholder}
              data={packs.map((p) => ({ value: p.id, label: p.name }))}
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
              w={360}
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
        </Paper>
        )}

        {!(embedded && ws.fileCount > 0) && (
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
            {/* 見出しも説明の文も置かない。空のときの 1 行だけ（MergeNew.dc.html） */}
            <Text size="sm" c="dimmed">
              {ws.fileCount > 0 ? "" : T.drop.empty}
            </Text>
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
          {(ws.skippedFiles.length > 0 || (view?.rejected.length ?? 0) > 0) && (
            <Stack gap={0} mt={4} data-testid="skipped">
              <Text size="xs" fw={700}>
                {T.drop.skipped}
              </Text>
              {[...ws.skippedFiles, ...(view?.rejected ?? [])].map((r, i) => (
                <Text key={i} size="xs" c="orange">
                  {r.file}：{r.reason}
                </Text>
              ))}
            </Stack>
          )}
        </Paper>
        )}
        {embedded && ws.fileCount > 0 && (ws.skippedFiles.length > 0 || (view?.rejected.length ?? 0) > 0) && (
          <Stack gap={0} data-testid="skipped">
            <Text size="xs" fw={700}>
              {T.drop.skipped}
            </Text>
            {[...ws.skippedFiles, ...(view?.rejected ?? [])].map((r, i) => (
              <Text key={i} size="xs" c="orange">
                {r.file}：{r.reason}
              </Text>
            ))}
          </Stack>
        )}

        {ws.photoBook.entries().length > 0 && (
          <Paper withBorder p="sm">
            <Title order={4} fz={14} fw={500} mb="xs">
              {PHOTO_TEXT.title}
            </Title>
            <PhotoPanel ws={ws} view={view} />
          </Paper>
        )}

        {embedded && file && view && layouts.some((l) => l.file === file) ? (
          sheetsOf && sheetsOf.length > 0 ? (
            <SourceTab key={file} view={view} layouts={sheetsOf} />
          ) : (
            <Text size="sm" c="dimmed" data-testid="source-loading">
              {T.sheet.loading}
            </Text>
          )
        ) : (
        <>
        <Grid gap="md">
          <Grid.Col span={{ base: 12, md: 7 }}>
            <Stack gap="md">
              <Paper withBorder p="sm">
                <Title order={4} fz={14} fw={500} mb="xs">
                  {T.dest.title}
                </Title>
                {view ? <Destinations view={view} onJump={jump} /> : <Text size="sm" c="dimmed">{T.dest.none}</Text>}
              </Paper>
              {view && current && (
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
                  {currentSheet ? (
                    <SheetView
                      view={view}
                      lay={currentSheet}
                      focus={focus}
                      top={top}
                      setTop={setTop}
                      onFocus={(r, c) => setFocus({ file: current.file, sheetIndex: current.sheetIndex, r, c })}
                      onNext={next}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      {T.sheet.loading}
                    </Text>
                  )}
                </Paper>
              )}
            </Stack>
          </Grid.Col>
          <Grid.Col span={{ base: 12, md: 5 }}>
            <Stack gap="md">
              {!embedded && (
                <Paper withBorder p="sm">
                  <Title order={4} fz={14} fw={500} mb="xs">
                    {T.questions.title}
                  </Title>
                  {view ? <Questions ws={ws} view={view} /> : <Text size="sm" c="dimmed">{T.questions.none}</Text>}
                </Paper>
              )}
              <Paper withBorder p="sm">
                <Title order={4} fz={14} fw={500} mb="xs">
                  {T.activity.title}
                </Title>
                <Activity ws={ws} />
              </Paper>
            </Stack>
          </Grid.Col>
        </Grid>

        <Paper withBorder p="sm">
          <Title order={4} fz={14} fw={500} mb="xs">
            {T.decisions.title}
          </Title>
          {view ? <Decisions ws={ws} view={view} /> : <Text size="sm" c="dimmed">{T.decisions.none}</Text>}
        </Paper>
        <Paper withBorder p="sm" mb="xl">
          <Title order={4} fz={14} fw={500} mb="xs">
            {T.aiOnly.title}
          </Title>
          {view && <AiOnly ws={ws} />}
        </Paper>
        </>
        )}
      </Stack>
    </Container>
  );
}
