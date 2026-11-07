// 資料のシート（HOSHITORI の中。docs/screens.md 3.2「資料のシート」・3.3、絵は Source.dc.html・MergeNew.dc.html）。
// 資料が無いあいだ：施設の欄と、資料の落とし場所だけ。資料があるとき：選んだ資料 1 つの元の表（SourceTab）を幅いっぱいに。
// 白紙（第 1 版の前）も版があるときも同じ形（Wire、11-07。運営者「取り込みの画面が古いまま」）。資料の選びとシートの選びは HOSHITORI のシートのタブの行にある
// （資料ごとのタブは並べない。components/SourcePicker、docs/screens.md 3.2「資料の選び」）。
// 質問は HOSHITORI の横の板（Questions）。写真は PhotoPanel（人が 1 枚ずつ AI クライアントに渡すことを許し、読み取りを画像と並べて確かめる）。
// 状態は取り込みの作業場（intake/workspace.ts。このタブのメモリだけ）が持ち、AI のツールも同じ作業場を使う。
import { removedCellOf } from "../state/stars";
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Container,
  FileButton,
  Group,
  Modal,
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
import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MergeSideContext } from "../state/merge-side";
import { setFacilityDialog, useFacilityDialog } from "../state/facility-dialog";
import { Switch } from "../components/Switch";
import type { CellStatus } from "../../import/compose";
import type { QuestionKind } from "../../import/questions";
import { packChoices, packFiscalStart } from "../chart/catalog";
import { PhotoPanel } from "../components/PhotoPanel";
import "../intake/intake.css";
import { answerOffered, type IntakeView, type IntakeWorkspace, type Notice, type QuestionView, type SettleOutcome, type SheetData } from "../intake/workspace";
import { sheetHash } from "../stages";
import { PHOTO_TEXT, TEXT } from "../text";
import { TOOL_NAMES } from "../../shared/tools";

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

/** 最後に読んだ資料のシート（作業場ごとに 1 つ）。資料のシートを開き直したとき、読み直すあいだも前に読んだ表を出す */
const lastSheets = new WeakMap<IntakeWorkspace, { file: string; at: number; sheets: SheetData[] }>();

/** 1 つの資料のシート（セルと行き先）を受け手から読み、最後に読んだものとして覚える */
export async function loadSheets(ws: IntakeWorkspace, file: string): Promise<SheetData[]> {
  const at = ws.view.at;
  const sheets = await ws.sheets(file);
  const prev = lastSheets.get(ws);
  if (!(prev && prev.file === file && prev.at > at)) lastSheets.set(ws, { file, at, sheets });
  return sheets;
}

/**
 * 1 つの資料のシート（セルと行き先）を、取り込みの受け手から読む。資料と決定が変わったら（写しの版が進んだら）読み直す。
 * 読み直している間は、前に読んだものを出したままにする
 */
export function useSheets(ws: IntakeWorkspace, file: string | null): SheetData[] | null {
  const at = ws.view.at;
  const [got, setGot] = useState<{ file: string; at: number; sheets: SheetData[] } | null>(() => lastSheets.get(ws) ?? null);
  useEffect(() => {
    if (!file) return;
    let live = true;
    void loadSheets(ws, file)
      .then((sheets) => {
        if (live) setGot({ file, at, sheets });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [ws, file, at]);
  if (got && got.file === file) return got.sheets;
  const last = lastSheets.get(ws);
  return last && last.file === file ? last.sheets : null;
}

// ─── セルの行き先（詳細の字） ──────────────────────────────────────────

/** 空・読取・除外のセルの行き先の字（未確定のセルは CellOpen が描く） */
function cellInfo(st: CellStatus | undefined): string {
  if (!st) return T.dest.empty;
  if (st.s === "data") return T.sheet.cellData;
  if (st.s === "excluded") return T.sheet.cellExcluded(st.reason);
  return T.source.open;
}

/**
 * 未確定のセルの詳細（docs/screens.md 3.3 の末尾「写しの照らし」、Wire、11-07）：種別「未確定」（朱。凡例と同じ言葉）の下に
 * 「質問　{その質問の種類の名前}」（問いの文は長いので、開いた先に置く。Wire、11-07）と「| 決める」。押すと横の板の「未回答」でその質問を開く（onQuestion）。
 * 質問が分からないセル（questionId が null か、写しに無い質問）は「質問」の行を出さない。
 * 「| 決める」は、その質問が未回答で、開く先（横の板）があるときだけ出す
 */
export function CellOpen({ view, questionId, onQuestion }: { view: IntakeView; questionId: string | null; onQuestion: ((questionId: string) => void) | null }) {
  const q = questionId ? view.questions.find((x) => x.questionId === questionId) : undefined;
  const open = !!q && view.open.includes(q.questionId);
  return (
    <Stack gap={2} data-testid="cell-open">
      <Text size="sm" c="var(--shu-text)" data-testid="cell-kind">
        {T.source.open}
      </Text>
      {q && (
        <Group gap="xs" wrap="nowrap" justify="space-between" align="flex-start" data-testid="cell-question" data-question={q.questionId}>
          <Text size="sm" data-testid="cell-question-line">
            {T.sheet.question((T.questionKind as Record<string, string>)[q.kind] ?? q.text)}
          </Text>
          {open && onQuestion && (
            <button type="button" className="moyai-inline-act" style={{ whiteSpace: "nowrap", flex: "none" }} data-testid="cell-question-open" onClick={() => onQuestion(q.questionId)}>
              {T.questions.answer}
            </button>
          )}
        </Group>
      )}
    </Stack>
  );
}

// ─── セルを決めた答え（docs/screens.md 3.3「答えの取り消し」、Wire、11-07） ─────────────────

export interface CellAnswer {
  questionId: string;
  /** 答えの字（選択肢の名前。数の答えは数） */
  answer: string;
  /** 作者の字（人・会話の回答・Claude 判断） */
  author: string;
  /** 答えた日時「2026-11-07 06:30」。このタブで答えたときだけ */
  at: string | null;
}

/**
 * セルを決めた質問（qs）のうち、取り消せる答え（このタブの決定。読み方の規則の決まった答えは決定ではないので出さない）。
 * 並びは qs の順
 */
export function cellAnswers(ws: IntakeWorkspace, view: IntakeView, qs: readonly string[]): CellAnswer[] {
  const questions = new Map(view.questions.map((q) => [q.questionId, q]));
  const decisions = new Map(view.decisions.map((d) => [d.questionId, d]));
  return qs.flatMap((id): CellAnswer[] => {
    const d = decisions.get(id);
    const q = questions.get(id);
    if (!d || !q || q.invalid) return [];
    const answer = q.valueKind === "number" ? d.answer : (q.options.find((o) => o.id === d.answer)?.label ?? d.answer);
    const at = ws.answeredAt(id);
    return [{ questionId: id, answer, author: TEXT.author[d.author], at: at ? T.at(at) : null }];
  });
}

/**
 * 横の板の詳細の、セルを決めた答え（docs/screens.md 3.3 の末尾「写しの照らし」、Wire、11-07）：質問ごとに 2 行。
 * 1 行目「答え　{答えの字}」、2 行目「{作者}　{日時}」と右端に「| 取り消す」（折り返さない）。
 * 押すとその質問は未回答に戻り、同じ答えで決まったセルもまとめて戻る（決定を外して読み直す）。確定のシートには並べない
 */
export function CellAnswers({ ws, view, qs }: { ws: IntakeWorkspace; view: IntakeView; qs: readonly string[] }) {
  const list = cellAnswers(ws, view, qs);
  if (!list.length) return null;
  return (
    <Stack gap={8} data-testid="cell-answers">
      {list.map((a) => (
        <Stack key={a.questionId} gap={0} data-testid="cell-answer" data-question={a.questionId}>
          <Text size="sm" data-testid="cell-answer-line">
            {T.sheet.answerLine(a.answer)}
          </Text>
          <Group gap="xs" wrap="nowrap" justify="space-between">
            <Text size="sm" className="moyai-num" data-testid="cell-answer-by">
              {T.sheet.answerBy(a.author, a.at)}
            </Text>
            <button
              type="button"
              className="moyai-inline-act"
              style={{ whiteSpace: "nowrap", flex: "none" }}
              disabled={ws.busy}
              data-testid="cell-answer-undo"
              onClick={() => void ws.undoAsync(a.questionId)}
            >
              {T.sheet.undo}
            </button>
          </Group>
        </Stack>
      ))}
    </Stack>
  );
}

// ─── 資料のタブ（MERGE r2。docs/screens.md 3.2「資料のシート」、絵は Source.dc.html） ─────────────

type SourceFilter = "open" | "all";

/**
 * HOSHITORI の資料のタブ：その資料の 1 つのシートだけ（sheet はシートの選びで選んだシートの番号。シートの選びはシートのタブの行にある）。
 * 上に切り替え「未確定行 n ／ 全行 n」（既定は未確定行、数は朱）と凡例。その下に元の表
 * （行の番号と列の字。未確定のセルは朱の字と下の 2px の朱の線）。セルを選ぶと、横の板の「詳細」にそのセルの行き先（除外ならその理由、
 * 未確定なら種別「未確定」とその質問と「| 決める」）を出す。答えで決まったセルなら、決めた答えと「| 取り消す」も出す（CellAnswers）。
 * end は凡例の行の右端に置くもの（版があるときの「| 資料を重ねて第 n 版をつくる」。凡例の上に行を足さない）。
 * 施設の欄・すべての資料の行き先の一覧・AI の作業の記録は置かない
 */
function SourceTab({ ws, view, layouts, sheet, end }: { ws: IntakeWorkspace; view: IntakeView; layouts: SheetData[]; sheet: number; end?: ReactNode }) {
  const S = T.source;
  const lay = layouts[Math.max(0, Math.min(sheet, layouts.length - 1))]!;
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
      {pickedStatus?.s === "unresolved" ? (
        <CellOpen view={view} questionId={pickedStatus.questionId} onQuestion={side?.openQuestion ?? null} />
      ) : (
        <Text size="sm">{cellInfo(pickedStatus)}</Text>
      )}
      {pickedStatus && pickedStatus.s !== "unresolved" && pickedStatus.qs && <CellAnswers ws={ws} view={view} qs={pickedStatus.qs} />}
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
    <Stack gap="sm" data-testid="source-tab" data-file={lay.file} data-sheet={lay.sheet ?? ""}>
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
        <Group gap="md" wrap="nowrap">
          {end}
        </Group>
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
                      data-answered={st && st.s !== "unresolved" && st.qs?.length ? "true" : undefined}
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

// ─── 質問（HOSHITORI の横の板「未回答 n」。docs/screens.md 3.2・3.3） ─────────────────────

function refusedText(r: SettleOutcome): string | null {
  return r.ok ? null : T.questions.refused[r.code];
}

/** 既定の答えの札「- 既定」（選択肢の後ろに小さく） */
function DefaultMark() {
  return (
    <Text span size="xs" c="var(--text-3)" ml={8} style={{ letterSpacing: "0.1em" }} data-testid="question-default">
      {T.questions.defaultMark}
    </Text>
  );
}

/**
 * 質問 1 つ：問いの文、「n 行」、ラジオ（既定の答えに「- 既定」）、「| 決める」。
 * focus（資料のセルの詳細の「| 決める」で開いた質問）なら印を付け、見える所へ送る（focusSeq は押すたびに増える）
 */
function QuestionCard({ ws, q, focus = false, focusSeq = 0 }: { ws: IntakeWorkspace; q: QuestionView; focus?: boolean; focusSeq?: number }) {
  const [value, setValue] = useState<string>(q.defaultAnswer ?? "");
  const [refused, setRefused] = useState<string | null>(null);
  const ok = answerOffered(q, value);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [focus, focusSeq]);
  return (
    <Paper ref={ref} withBorder p="xs" className="moyai-question" data-testid="question" data-kind={q.kind} data-question={q.questionId} data-focus={focus ? "true" : undefined}>
      <Text size="sm">{q.text}</Text>
      <Text size="xs" c="var(--text-3)" className="moyai-num" data-testid="question-rows">
        {T.questions.rows(q.sameShapeRows)}
      </Text>
      {q.invalid && (
        <Text size="xs" c="var(--shu-text)">
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
          description={
            q.defaultAnswer !== null ? (
              <>
                {q.defaultAnswer}
                <DefaultMark />
              </>
            ) : (
              T.questions.noDefault
            )
          }
          style={{ maxWidth: 200 }}
        />
      ) : (
        <Radio.Group value={value} onChange={setValue} mt={4}>
          <Stack gap={4}>
            {q.options.map((o) => (
              <Radio
                key={o.id}
                value={o.id}
                size="xs"
                label={
                  <>
                    {o.label}
                    {o.id === q.defaultAnswer && <DefaultMark />}
                  </>
                }
              />
            ))}
          </Stack>
        </Radio.Group>
      )}
      {q.defaultAnswer === null && q.valueKind === "option" && (
        <Text size="xs" c="dimmed">
          {T.questions.noDefault}
        </Text>
      )}
      <Group justify="flex-end" mt={4} gap="xs">
        {refused && (
          <Text size="xs" c="var(--shu-text)">
            {refused}
          </Text>
        )}
        <button
          type="button"
          className="moyai-inline-act"
          disabled={!ok || ws.busy}
          data-testid="answer"
          onClick={() => void ws.answerAsHumanAsync(q.questionId, value, T.questions.humanReason).then((r) => setRefused(refusedText(r)))}
        >
          {T.questions.answer}
        </button>
      </Group>
    </Paper>
  );
}

/** 横の板の「未回答 n」。focus は資料のセルの詳細の「| 決める」で開いた質問（無ければ null） */
export function Questions({ ws, view, focus = null }: { ws: IntakeWorkspace; view: IntakeView; focus?: { questionId: string; seq: number } | null }) {
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
      {groups.map(([kind, qs]) => (
        <Stack key={kind} gap={6} data-testid="question-group" data-kind={kind}>
          <Title order={5}>
            {KIND_LABEL[kind] ?? T.questions.other} <Badge variant="light" size="sm" className="moyai-num">{qs.length}</Badge>
          </Title>
          {qs.map((q) => (
            <QuestionCard
              key={`${q.questionId}|${q.decision?.answer ?? ""}`}
              ws={ws}
              q={q}
              focus={focus?.questionId === q.questionId}
              focusSeq={focus?.questionId === q.questionId ? focus.seq : 0}
            />
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

// ─── 計画をつくるボタンを止めている理由 ─────────────────────────────────────

/** 取り込みの止める決まりのうち、質問に答えれば決まるもの（セルの数と、答えの無い質問の数） */
const QUESTION_BOUND = /^(未解決のセル|答えの無い質問) \d+$/;

/**
 * 計画をつくるボタンを止めている理由（画面の字。頭の「理由：」は出す側が付ける）。
 * 未回答があるあいだは、セルの数と答えの無い質問の数を出さず「未回答 n」の 1 つにする（質問に答えればセルも決まる。
 * docs/screens.md 3.3、Wire、11-07）。n は横の板の「未回答 n」と同じ数。未回答が 0 なのに残るものは、そのまま出す
 */
export function composeReasons(ws: IntakeWorkspace): string[] {
  const all = ws.composeBlockers();
  if (!ws.fileCount) return all;
  const view = ws.view;
  const open = view.open.length;
  if (open === 0) return all;
  const fromIntake = new Set(view.blockers);
  return [
    ...all.filter((b) => !fromIntake.has(b)),
    TEXT.merge.block.open(open),
    ...view.blockers.filter((b) => !QUESTION_BOUND.test(b)),
  ];
}

// ─── 止まった知らせ（下の帯の左、編集者の右。docs/screens.md 3.3「止まった知らせ」、Wire、11-07） ─────────────

/** unknown：AI の作業の結果不明／stopped：取り込みの処理の停止 */
export type StopKind = "unknown" | "stopped";

/**
 * 作業場の記録のうち、下の帯に出すもの：AI に「結果不明」と返した記録と、取り込みの処理が止まった記録（workerStopped・workerFallback）。
 * ふつうに終わった作業の記録は出さない
 */
export function stopNotices(notices: readonly Notice[]): Record<StopKind, Notice[]> {
  return {
    unknown: notices.filter((n) => n.kind === "unknown"),
    stopped: notices.filter((n) => n.kind === "info" && (n.text === TEXT.intake.workerStopped || n.text === TEXT.intake.workerFallback)),
  };
}

/** 下の帯の朱の字「結果不明 n」「取り込み停止」。押すと横の板の詳細にその記録 */
export function StopNotices({ notices, onShow }: { notices: readonly Notice[]; onShow: (k: StopKind) => void }) {
  const s = stopNotices(notices);
  return (
    <>
      {s.unknown.length > 0 && (
        <button type="button" className="moyai-stop-notice" onClick={() => onShow("unknown")} data-testid="stop-unknown">
          {T.stop.unknown(s.unknown.length)}
        </button>
      )}
      {s.stopped.length > 0 && (
        <button type="button" className="moyai-stop-notice" onClick={() => onShow("stopped")} data-testid="stop-worker">
          {T.stop.stopped}
        </button>
      )}
    </>
  );
}

/** 結果不明の記録のツールの名前（記録の字は TEXT.intake.activity.unknown で作られる） */
function toolOf(text: string): string | null {
  return TOOL_NAMES.find((n) => TEXT.intake.activity.unknown(n) === text) ?? null;
}

/**
 * 横の板の詳細：止まった記録（新しい順）。1 件ごとに、題と日時（いつ）、項目（何を）、停止箇所（止まった所）、記録の字。
 * 「| やり直す」は置かない（今の作業場に、やり直しの口が無い）
 */
export function StopNoticeDetail({ notices, kind }: { notices: readonly Notice[]; kind: StopKind }) {
  const list = stopNotices(notices)[kind];
  return (
    <Stack gap="md" data-testid="stop-detail" data-kind={kind}>
      {list.map((n) => {
        const what = kind === "unknown" ? toolOf(n.text) : T.stop.whatWorker;
        const where = kind === "unknown" ? T.stop.whereTool : n.text === TEXT.intake.workerFallback ? T.stop.whereFallback : T.stop.whereStopped;
        return (
          <Stack key={n.id} gap={2} data-testid="stop-record">
            <Text size="sm" fw={700} c="var(--shu-text)">
              {kind === "unknown" ? T.stop.unknownTitle : T.stop.stopped}
            </Text>
            {what && (
              <Text size="sm">
                {T.stop.what}　{what}
              </Text>
            )}
            <Text size="sm">
              {T.stop.when}　<span className="moyai-num">{T.at(n.at)}</span>
            </Text>
            <Text size="sm">
              {T.stop.where}　{where}
            </Text>
            <Text size="xs" c="var(--text-2)">
              {n.text}
            </Text>
          </Stack>
        );
      })}
    </Stack>
  );
}

// ─── 施設の欄（資料が無いあいだは資料のシートに、資料が入ったら白紙の「施設設定」のダイアログに） ──────────

function FacilityFields({ ws }: { ws: IntakeWorkspace }) {
  const [month, setMonth] = useState<number>(ws.settings.fiscalYearStartMonth);
  const [reading, setReading] = useState(false);
  const packs = useMemo(() => packChoices(), []);
  return (
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
  );
}

/** 白紙（第 1 版の前）で資料が入ったあとの施設設定：見出しの「施設設定」から開く（版ができたあとは components/FacilityDialog） */
export function IntakeFacilityDialog({ ws }: { ws: IntakeWorkspace }) {
  useWorkspace(ws);
  const opened = useFacilityDialog();
  return (
    <Modal opened={opened} onClose={() => setFacilityDialog(false)} title={TEXT.merge.facilitySettings} centered size="lg" data-testid="intake-facility-dialog">
      <FacilityFields ws={ws} />
    </Modal>
  );
}

// ─── 画面 ──────────────────────────────────────────────────────

/**
 * 資料のシート（HOSHITORI の中。docs/screens.md 3.2・3.3）。file は今選んでいる資料（HOSHITORI のシートのタブが決める。資料が無ければ null）。
 * 計画をつくるボタン：白紙のあいだは HOSHITORI の下の帯にある（composeInBar）。版があるときは、凡例の行の右端の「| 資料を重ねて第 n 版をつくる」
 * （composeLabel）。出すのは、つくった版に入っていない変更があるとき（composeOffered）だけ。つくった直後は出さない（docs/screens.md 3.3 の末尾「写しの照らし」）。
 * 計画をつくったあとの知らせの箱と決定の一覧は置かない（タブの星取表と、確定のシートで分かる。Wire、11-07）
 */
export function Intake({
  ws,
  composeLabel,
  composeInBar = false,
  composeOffered = false,
  file = null,
  layouts: given,
  sheetIndex = 0,
  onAddFiles,
}: {
  ws: IntakeWorkspace;
  composeLabel: string;
  /** 開いている資料のシート（セルと行き先）。HOSHITORI が読んで渡す（シートの一覧の数にも使うので、2 度読まない）。渡さなければここで読む */
  layouts?: SheetData[] | null;
  /** シートの選びで選んだシートの番号（資料の中の順） */
  sheetIndex?: number;
  /** 資料を入れる（HOSHITORI の「＋ 資料を追加」と同じ道。読込中の名前を一覧に出すため）。無ければ作業場に直に入れる */
  onAddFiles?: (files: File[]) => Promise<void>;
  /** 計画をつくるボタンは HOSHITORI の下の帯にある（白紙のあいだ）。ここには出さない */
  composeInBar?: boolean;
  /** 版があるとき：つくった版に入っていない変更（資料の追加・答えの変更・取り消しなど）がある。無ければ「| 資料を重ねて第 n 版をつくる」を出さない */
  composeOffered?: boolean;
  file?: string | null;
}) {
  useWorkspace(ws);
  // 画面は受け手から返った写しを読む（取り込みは worker の中。読み取りの間も画面は止まらない）
  const view = ws.fileCount ? ws.view : null;
  const reasons = composeReasons(ws);
  const compose = ws.compose;
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setReading(true);
    try {
      if (onAddFiles) return await onAddFiles(files);
      await ws.addFiles(files.map((f) => ({ name: f.name, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) })));
      // 「架空」の印は、読み終わったあとの写しで見る
      await ws.fresh(undefined, false).catch(() => undefined);
      if (!ws.settings.fictional && ws.sourcesMarkedFictional()) {
        ws.setFacility({ fictional: true });
      }
    } finally {
      setReading(false);
    }
    // 資料のシートの道にしておく（第 1 版をつくったあとも、資料のタブを選んだ形で開く）
    location.hash = sheetHash("files");
  };

  const layouts = view?.sheets ?? [];
  const shown = file && layouts.some((l) => l.file === file) ? file : null;
  // 開いている資料のシートだけを受け手から読む（HOSHITORI が読んで渡したときは、それを使う）
  const own = useSheets(ws, given === undefined ? shown : null);
  const sheetsOf = given === undefined ? own : given && given[0]?.file === shown ? given : null;
  // 版があるときの「| 資料を重ねて第 n 版をつくる」と押せない理由（凡例の行の右端。白紙のあいだは下の帯にある）
  const composeEnd = !composeInBar && composeOffered && (
    <Group gap="sm" wrap="nowrap" data-testid="compose-next">
      {reasons.length > 0 && compose.state !== "running" && (
        <Text size="xs" c="dimmed" maw={420} lineClamp={2} title={reasons.join("・")} data-testid="compose-disabled-reason">
          {T.reasonsPrefix}
          {reasons.join("・")}
        </Text>
      )}
      <button
        type="button"
        className="moyai-inline-act"
        style={{ whiteSpace: "nowrap", flex: "none" }}
        onClick={() => ws.startCompose("human")}
        disabled={reasons.length > 0 || compose.state === "running"}
        aria-busy={compose.state === "running" ? "true" : undefined}
        data-testid="compose"
      >
        {composeLabel}
      </button>
    </Group>
  );

  return (
    <Container
      fluid
      py="md"
      data-testid="intake-page"
      data-busy={ws.busy ? "true" : undefined}
      data-compose={compose.state}
      data-compose-by={compose.state === "idle" ? undefined : compose.by}
      data-restored-from={ws.restoredFrom?.version}
    >
      <Stack gap="md">
        {compose.state === "failed" && (
          <Alert color="orange" title={T.composeFailed} data-testid="compose-failed">
            {compose.blockers.join("・")}
          </Alert>
        )}

        {/* 資料が無いあいだだけ：施設の欄と落とし場所。資料が入ったら、施設の欄は「施設設定」、資料はシートのタブの「＋ 資料を追加」 */}
        {ws.fileCount === 0 && (
          <Paper withBorder p="sm">
            <Title order={4} fz={14} fw={500} mb="xs">
              {T.settings.title}
            </Title>
            <FacilityFields ws={ws} />
          </Paper>
        )}
        {ws.fileCount === 0 && (
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
                {T.drop.empty}
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
          </Paper>
        )}
        {/* 読まなかった資料は、資料の一覧の「読込不可」の行と、その詳細の理由に出す（docs/screens.md 3.2「資料の選び」） */}

        {ws.photoBook.entries().length > 0 && (
          <Paper withBorder p="sm">
            <Title order={4} fz={14} fw={500} mb="xs">
              {PHOTO_TEXT.title}
            </Title>
            <PhotoPanel ws={ws} view={view} />
          </Paper>
        )}

        {view &&
          shown &&
          (sheetsOf && sheetsOf.length > 0 ? (
            <SourceTab key={`${shown}\u0000${sheetIndex}`} ws={ws} view={view} layouts={sheetsOf} sheet={sheetIndex} end={composeEnd} />
          ) : (
            <Group justify="space-between" gap="md" wrap="nowrap">
              <Text size="sm" c="dimmed" data-testid="source-loading" data-file={shown}>
                {T.sheet.loading}
              </Text>
              {composeEnd}
            </Group>
          ))}
      </Stack>
    </Container>
  );
}
