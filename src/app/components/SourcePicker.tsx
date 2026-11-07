// 資料の選びとシートの選び（docs/screens.md 3.2「資料の選び」、Wire、11-07。§3.3 の第 1 版の前も同じ）。
// 運営者「200 枚の取り込みがあることを想定した UI にしてほしい」：資料ごとのタブを横に並べず、シートのタブの行に選びを 1 つずつ置く。
// 資料の選び「daily-report.xlsx ▾」（名前は最大 280px、入らなければ後ろを「…」、title に全文）と、右に等幅の text-3「3 / 200」「‹ ›」（資料が 1 つなら出さない）。
// 開くと一覧（幅 520px、高さは画面の 60% まで、中で縦に送る）：名前で絞る欄（空の字「名前」）、「名前順 | 未確定の多い順」、
// 行「名前｜シート n｜未確定 n｜状態」。未確定は 1 以上なら朱、0 は text-3。状態は「読込中」（text-3）と「読込不可」（朱、理由は詳細）だけ。↑↓・Enter・Esc。
// シートの選びは、シートが 2 つ以上のときだけ「4月 ▾　1 / 12」。一覧は「シート名｜未確定 n」で、絞る欄なし。
// 選ぶ・並べる・キーの決まりは、下の関数（画面の外でも試せる形）に置く。
import { Popover } from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { TEXT } from "../text";
import { Switch } from "./Switch";

const P = TEXT.merge.picker;
/** 資料の一覧の幅（docs/screens.md 3.2「資料の選び」） */
export const LIST_WIDTH = 520;

/** 一覧の 1 行（資料 1 つ）。ready：読めた／reading：読込中／rejected：読込不可（reason に理由） */
export interface SourceRow {
  name: string;
  state: "ready" | "reading" | "rejected";
  /** シートの数（読めた資料だけ） */
  sheets: number;
  /** 未確定の行の数（読めた資料だけ。資料のタブの「未確定行 n」の、その資料のシートの合計） */
  open: number;
  reason: string | null;
}

export type SourceOrder = "name" | "open";

const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/** 名前順（字の順。数は数として並べる） */
export function byName(a: { name: string }, b: { name: string }): number {
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}

/** 並べる：名前順、または未確定の多い順（同じ数なら名前順。読めていない資料は数が無いので後ろ） */
export function sortRows(rows: readonly SourceRow[], order: SourceOrder): SourceRow[] {
  const known = (r: SourceRow) => (r.state === "ready" ? 0 : 1);
  return [...rows].sort((a, b) => (order === "open" ? known(a) - known(b) || b.open - a.open || byName(a, b) : byName(a, b)));
}

/** 名前で絞る（大文字・小文字と全角・半角を区別しない） */
export function filterRows(rows: readonly SourceRow[], query: string): SourceRow[] {
  const q = query.normalize("NFKC").trim().toLowerCase();
  if (!q) return [...rows];
  return rows.filter((r) => r.name.normalize("NFKC").toLowerCase().includes(q));
}

/**
 * 一覧の行を組む：読めた資料（files）、読込中の名前（reading。まだ読めた資料にも読込不可にも無いもの）、読込不可（rejected。理由つき）。
 * 同じ名前の読込不可（同じ名前の資料がもう入っている、など）も 1 行として残す（黙って捨てない）
 */
export function sourceRows(input: {
  files: readonly string[];
  sheets: readonly { file: string }[];
  counts: readonly { file: string; unresolvedRows: number }[];
  rejected: readonly { file: string; reason: string }[];
  reading: readonly string[];
}): SourceRow[] {
  const sheetCount = new Map<string, number>();
  for (const s of input.sheets) sheetCount.set(s.file, (sheetCount.get(s.file) ?? 0) + 1);
  const open = new Map(input.counts.map((c) => [c.file, c.unresolvedRows]));
  const ready: SourceRow[] = input.files.map((name) => ({ name, state: "ready", sheets: sheetCount.get(name) ?? 0, open: open.get(name) ?? 0, reason: null }));
  const known = new Set([...input.files, ...input.rejected.map((r) => r.file)]);
  const reading: SourceRow[] = [...new Set(input.reading)].filter((n) => !known.has(n)).map((name) => ({ name, state: "reading", sheets: 0, open: 0, reason: null }));
  const rejected: SourceRow[] = input.rejected.map((r) => ({ name: r.file, state: "rejected", sheets: 0, open: 0, reason: r.reason }));
  return [...ready, ...reading, ...rejected];
}

/** 開く資料の既定（docs/screens.md 3.2）：第 1 版の前は未確定のいちばん多い資料（同じ数なら名前順の先）、版のあとは名前順の最初。読めた資料が無ければ null */
export function defaultSource(rows: readonly SourceRow[], beforeFirstVersion: boolean): string | null {
  const ready = rows.filter((r) => r.state === "ready");
  return sortRows(ready, beforeFirstVersion ? "open" : "name")[0]?.name ?? null;
}

/** 一覧のキー（↑↓・Enter・Esc）。扱わないキーは null。active は今の行（0 から）、count は見えている行の数 */
export function listKey(key: string, active: number, count: number): { active: number; act: "choose" | "close" | null } | null {
  switch (key) {
    case "ArrowDown":
      return { active: count === 0 ? 0 : Math.min(count - 1, active + 1), act: null };
    case "ArrowUp":
      return { active: Math.max(0, active - 1), act: null };
    case "Enter":
      return { active, act: count > 0 ? "choose" : null };
    case "Escape":
      return { active, act: "close" };
    default:
      return null;
  }
}

/** 一覧の状態（絞る字と今の行）。キーと字の入力で動かし、選んだ行・閉じるを返す（画面の部品はこれを使う） */
export interface PickState {
  query: string;
  active: number;
}
export type PickAction = { type: "query"; query: string } | { type: "key"; key: string } | { type: "hover"; index: number };
export function pickStep(state: PickState, action: PickAction, rows: readonly SourceRow[], current: string | null): { state: PickState; choose: SourceRow | null; close: boolean } {
  if (action.type === "query") {
    const shown = filterRows(rows, action.query);
    const i = current ? shown.findIndex((r) => r.name === current && r.state === "ready") : -1;
    return { state: { query: action.query, active: Math.max(0, i) }, choose: null, close: false };
  }
  const shown = filterRows(rows, state.query);
  if (action.type === "hover") return { state: { ...state, active: Math.min(Math.max(0, action.index), Math.max(0, shown.length - 1)) }, choose: null, close: false };
  const k = listKey(action.key, state.active, shown.length);
  if (!k) return { state, choose: null, close: false };
  const next = { ...state, active: k.active };
  if (k.act === "close") return { state: next, choose: null, close: true };
  if (k.act === "choose") {
    const row = shown[k.active] ?? null;
    // 読込中の資料は、まだ開けるものが無い
    return { state: next, choose: row && row.state !== "reading" ? row : null, close: !!row && row.state !== "reading" };
  }
  return { state: next, choose: null, close: false };
}

/** 一覧を開いたときの状態（今の資料の行に合わせる） */
export function pickStart(rows: readonly SourceRow[], current: string | null): PickState {
  const i = current ? rows.findIndex((r) => r.name === current && r.state === "ready") : -1;
  return { query: "", active: Math.max(0, i) };
}

/** 未確定の数の字：1 以上は朱、0 は text-3 */
function OpenCount({ n }: { n: number }) {
  return (
    <span className="moyai-srcpick-open moyai-num" data-shu={n > 0 ? "true" : undefined}>
      {P.open(n)}
    </span>
  );
}

/**
 * 資料の一覧（開いた選びの中身）。rows は並べたもの（order の順）。onChoose は読めた資料・読込不可の行を選んだとき。
 * 一覧は名前で絞り、↑↓ で行を動かし、Enter で選び、Esc で閉じる
 */
export function SourceList({
  rows,
  current,
  order,
  onOrder,
  onChoose,
  onClose,
  initial,
}: {
  rows: readonly SourceRow[];
  current: string | null;
  order: SourceOrder;
  onOrder: (o: SourceOrder) => void;
  onChoose: (row: SourceRow) => void;
  onClose: () => void;
  /** 試験：一覧の状態を外から与える */
  initial?: PickState;
}) {
  const [st, setSt] = useState<PickState>(() => initial ?? pickStart(rows, current));
  const shown = filterRows(rows, st.query);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => input.current?.focus(), []);
  // 並びを替えたら、今の行を今の資料に合わせ直す（同じ番号の別の資料を指さない）
  const firstOrder = useRef(true);
  useEffect(() => {
    if (firstOrder.current) {
      firstOrder.current = false;
      return;
    }
    setSt((s) => pickStep(s, { type: "query", query: s.query }, rows, current).state);
  }, [order]);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${st.active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [st.active, st.query]);
  const run = (a: PickAction) => {
    const r = pickStep(st, a, rows, current);
    setSt(r.state);
    if (r.choose) onChoose(r.choose);
    else if (r.close) onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!listKey(e.key, st.active, shown.length)) return;
    e.preventDefault();
    e.stopPropagation();
    run({ type: "key", key: e.key });
  };
  return (
    <div className="moyai-srcpick-list" data-testid="source-list">
      <div className="moyai-srcpick-head">
        <input
          ref={input}
          className="moyai-srcpick-filter"
          placeholder={P.filter}
          aria-label={P.filter}
          value={st.query}
          onChange={(e) => run({ type: "query", query: e.currentTarget.value })}
          onKeyDown={onKey}
          data-testid="source-filter-name"
        />
        <Switch<SourceOrder>
          aria-label={P.orderLabel}
          value={order}
          onChange={onOrder}
          data-testid="source-order"
          data={[
            { value: "name", label: P.order.name },
            { value: "open", label: P.order.open },
          ]}
        />
      </div>
      <div ref={list} className="moyai-srcpick-rows" role="listbox" aria-label={P.source} data-testid="source-rows">
        {shown.map((r, i) => (
          <div
            key={`${r.state}\u0000${r.name}\u0000${i}`}
            role="option"
            className="moyai-srcpick-row"
            aria-selected={i === st.active}
            aria-disabled={r.state === "reading" ? "true" : undefined}
            data-index={i}
            data-current={r.state === "ready" && r.name === current ? "true" : undefined}
            data-testid="source-row"
            data-file={r.name}
            data-state={r.state}
            data-open={r.state === "ready" ? r.open : undefined}
            title={r.reason ? `${r.name}\n${r.reason}` : r.name}
            onMouseEnter={() => run({ type: "hover", index: i })}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => r.state !== "reading" && onChoose(r)}
          >
            <span className="moyai-srcpick-name">{r.name}</span>
            <span className="moyai-num">{r.state === "ready" ? P.sheets(r.sheets) : ""}</span>
            {r.state === "ready" ? <OpenCount n={r.open} /> : <span />}
            <span className="moyai-srcpick-state" data-state={r.state}>
              {r.state === "ready" ? "" : P.state[r.state]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * 資料の選び（シートのタブの行）。rows は一覧の行（並べる前）。current は開いている資料（無ければ null）。
 * selected は資料のシートを見ているとき（選びを今のシートの字にする）。onChoose：読めた資料を開く／読込不可の行の理由を詳細に出す。
 * 「‹ ›」と「3 / 200」は、読めた資料を今の並び（order）で数える
 */
export function SourcePicker({
  rows,
  current,
  selected,
  order,
  onOrder,
  onChoose,
  defaultOpened = false,
}: {
  rows: readonly SourceRow[];
  current: string | null;
  selected: boolean;
  order: SourceOrder;
  onOrder: (o: SourceOrder) => void;
  onChoose: (row: SourceRow) => void;
  defaultOpened?: boolean;
}) {
  const [opened, setOpened] = useState(defaultOpened);
  const sorted = useMemo(() => sortRows(rows, order), [rows, order]);
  const ready = useMemo(() => sorted.filter((r) => r.state === "ready"), [sorted]);
  const pos = current ? ready.findIndex((r) => r.name === current) : -1;
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpened(false);
    button.current?.focus();
  };
  const step = (d: -1 | 1) => {
    const r = ready[pos + d];
    if (r) onChoose(r);
  };
  return (
    <div className="moyai-srcpick moyai-srcpick-source" data-selected={selected ? "true" : undefined} data-testid="source-pick">
      <Popover opened={opened} onChange={setOpened} onClose={() => requestAnimationFrame(() => button.current?.focus())} position="bottom-start" width={LIST_WIDTH} offset={2} shadow="md" radius={0} trapFocus={false} returnFocus withRoles={false} classNames={{ dropdown: "moyai-srcpick-dropdown" }}>
        <Popover.Target>
          <button
            ref={button}
            type="button"
            className="moyai-srcpick-button"
            aria-haspopup="listbox"
            aria-expanded={opened}
            aria-label={P.source}
            title={current ?? undefined}
            onClick={() => setOpened((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && !opened) {
                e.preventDefault();
                setOpened(true);
              }
            }}
            data-testid="source-picker"
            data-file={current ?? ""}
            data-count={ready.length}
          >
            <span className="moyai-srcpick-label">{current ?? P.none}</span>
            <span className="moyai-srcpick-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        </Popover.Target>
        <Popover.Dropdown>
          <SourceList
            rows={sorted}
            current={current}
            order={order}
            onOrder={onOrder}
            onClose={close}
            onChoose={(r) => {
              setOpened(false);
              onChoose(r);
            }}
          />
        </Popover.Dropdown>
      </Popover>
      {ready.length >= 2 && pos >= 0 && (
        <span className="moyai-srcpick-pos moyai-num" data-testid="source-position">
          {P.position(pos + 1, ready.length)}
        </span>
      )}
      {ready.length >= 2 && pos >= 0 && (
        <span className="moyai-srcpick-steps">
          <button type="button" className="moyai-srcpick-step" aria-label={P.prev} disabled={pos <= 0} onClick={() => step(-1)} data-testid="source-prev">
            ‹
          </button>
          <button type="button" className="moyai-srcpick-step" aria-label={P.next} disabled={pos >= ready.length - 1} onClick={() => step(1)} data-testid="source-next">
            ›
          </button>
        </span>
      )}
    </div>
  );
}

/** 横の板の詳細：一覧で選んだ読込不可の資料（名前・「読込不可」（朱）・理由） */
export function RejectedDetail({ row }: { row: SourceRow }) {
  return (
    <div className="moyai-srcpick-detail" data-testid="source-rejected-detail" data-file={row.name}>
      <div className="moyai-srcpick-detail-name">{row.name}</div>
      <div className="moyai-srcpick-detail-state">{P.state.rejected}</div>
      {row.reason && <div className="moyai-srcpick-detail-reason">{row.reason}</div>}
    </div>
  );
}

/** シートの一覧の 1 行。open は未確定の行の数（まだ読んでいなければ null で、数を出さない） */
export interface SheetRow {
  name: string;
  open: number | null;
}

/** シートの一覧（「シート名｜未確定 n」、絞る欄なし）。↑↓・Enter・Esc */
export function SheetList({ rows, current, onChoose, onClose }: { rows: readonly SheetRow[]; current: number; onChoose: (i: number) => void; onClose: () => void }) {
  const [active, setActive] = useState(Math.max(0, Math.min(current, rows.length - 1)));
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => list.current?.focus(), []);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  return (
    <div
      ref={list}
      className="moyai-srcpick-rows moyai-srcpick-sheets"
      role="listbox"
      aria-label={P.sheet}
      tabIndex={0}
      data-testid="sheet-rows"
      onKeyDown={(e) => {
        const k = listKey(e.key, active, rows.length);
        if (!k) return;
        e.preventDefault();
        e.stopPropagation();
        setActive(k.active);
        if (k.act === "choose") onChoose(k.active);
        else if (k.act === "close") onClose();
      }}
    >
      {rows.map((r, i) => (
        <div
          key={i}
          role="option"
          className="moyai-srcpick-row"
          aria-selected={i === active}
          data-index={i}
          data-current={i === current ? "true" : undefined}
          data-testid="sheet-row"
          data-sheet={r.name}
          title={r.name}
          onMouseEnter={() => setActive(i)}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChoose(i)}
        >
          <span className="moyai-srcpick-name">{r.name}</span>
          {r.open === null ? <span /> : <OpenCount n={r.open} />}
        </div>
      ))}
    </div>
  );
}

/** シートの選び「4月 ▾　1 / 12」（シートが 2 つ以上のときだけ置く。置くかは呼ぶ側が決める） */
export function SheetPicker({ rows, current, onChoose, defaultOpened = false }: { rows: readonly SheetRow[]; current: number; onChoose: (i: number) => void; defaultOpened?: boolean }) {
  const [opened, setOpened] = useState(defaultOpened);
  const button = useRef<HTMLButtonElement>(null);
  const i = Math.max(0, Math.min(current, rows.length - 1));
  return (
    <div className="moyai-srcpick" data-testid="sheet-pick">
      <Popover opened={opened} onChange={setOpened} onClose={() => requestAnimationFrame(() => button.current?.focus())} position="bottom-start" width={320} offset={2} shadow="md" radius={0} trapFocus={false} returnFocus withRoles={false} classNames={{ dropdown: "moyai-srcpick-dropdown moyai-srcpick-sheets" }}>
        <Popover.Target>
          <button
            ref={button}
            type="button"
            className="moyai-srcpick-button"
            aria-haspopup="listbox"
            aria-expanded={opened}
            aria-label={P.sheet}
            title={rows[i]?.name}
            onClick={() => setOpened((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && !opened) {
                e.preventDefault();
                setOpened(true);
              }
            }}
            data-testid="sheet-picker"
            data-index={i}
          >
            <span className="moyai-srcpick-label">{rows[i]?.name ?? P.none}</span>
            <span className="moyai-srcpick-caret" aria-hidden="true">
              ▾
            </span>
          </button>
        </Popover.Target>
        <Popover.Dropdown>
          <SheetList
            rows={rows}
            current={i}
            onClose={() => {
              setOpened(false);
              button.current?.focus();
            }}
            onChoose={(n) => {
              setOpened(false);
              onChoose(n);
            }}
          />
        </Popover.Dropdown>
      </Popover>
      <span className="moyai-srcpick-pos moyai-num" data-testid="sheet-position">
        {P.position(i + 1, rows.length)}
      </span>
    </div>
  );
}
