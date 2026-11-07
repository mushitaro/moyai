// 資料 200（日報は 12 シート）を入れたときの HOSHITORI の資料の選び（docs/screens.md 3.2「資料の選び」、§3.3 も同じ。Wire、11-07）と、
// 設定の「表示」の節（§3.7）。運営者「200 枚の取り込みがあることを想定した UI にしてほしい」。
// - タブの行は 1 行：資料ごとのタブを並べず、「資料」の札・資料の選び「{名前} ▾　k / 200　‹ ›」・シートの選び「4月 ▾　1 / 12」・「＋ 資料を追加」
// - 一覧：名前で絞る（空の字「名前」）、「名前順 | 未確定の多い順」、行「名前｜シート n｜未確定 n｜状態」、↑↓・Enter・Esc
// - 開く資料の既定：第 1 版の前は未確定のいちばん多い資料、版のあとは名前順の最初
// - 幅：横の板は 320px に固定、ページは横に送らない、名前は最大 280px で「…」
// - 設定の「表示」の節の字（階層・並び・最終年度・作業中の計画なし・Claude の入力）
// 資料はすべて架空：工場の fictional-1 の日報の行を、試験の中で 12 シートの xlsx と 199 の小さな CSV に組み直す。画面は react-dom/server で描く（試験は node で走る）。
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { loadSheets } from "../../src/app/pages/Intake";
import { Merge, SIDE_WIDTH } from "../../src/app/pages/Merge";
import { RootOffered } from "../../src/app/pages/Settings";
import { DisplaySettings, lastYearCheck, seriesLevelName } from "../../src/app/components/DisplaySettings";
import {
  LIST_WIDTH,
  RejectedDetail,
  SheetList,
  SourceList,
  defaultSource,
  filterRows,
  listKey,
  pickStart,
  pickStep,
  sortRows,
  sourceRows,
  type SourceRow,
} from "../../src/app/components/SourcePicker";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { resetScreenForTest, setDisplayPrefs } from "../../src/app/state/screen";
import type { MergeSheet } from "../../src/app/stages";
import { HUMAN_TEXT, TEXT } from "../../src/app/text";
import { asset, detail, plan as planOf, work } from "./share/fixtures";

const DAILY_CSV = "samples/out/waste-incineration/fictional-1/daily-report.csv";
const MONTHS = ["4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月", "1月", "2月", "3月"];
const XLSX = "daily-report.xlsx";
/** 199 の CSV。1 つ（report-150.csv）だけ行を多くし、未確定の多い資料が名前順の最初と別になるようにする */
const CSVS = Array.from({ length: 199 }, (_, i) => `report-${String(i + 1).padStart(3, "0")}.csv`);
const MANY = "report-150.csv";

/** 架空の日報の見出しと行（fictional-1 の作業日報の書き出し。Shift_JIS） */
function dailyLines(): { head: string[]; rows: string[][] } {
  const lines = new TextDecoder("shift_jis")
    .decode(readFileSync(DAILY_CSV))
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const at = lines.findIndex((l) => l.startsWith("日付,"));
  return { head: lines[at]!.split(","), rows: lines.slice(at + 1).map((l) => l.split(",")) };
}

async function dailyBook(head: string[], rows: string[][]): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  MONTHS.forEach((m, i) => {
    const sh = wb.addWorksheet(m);
    sh.addRow(head);
    for (const r of rows.slice(i * 3, i * 3 + 3)) sh.addRow(r);
  });
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

function csv(head: string[], rows: string[][]): Uint8Array {
  return new TextEncoder().encode(`\uFEFF${[head, ...rows].map((r) => r.join(",")).join("\r\n")}\r\n`);
}

const settings = { packId: "waste-incineration", facilityName: "【架空】資料 200 の試験", fiscalYearStartMonth: 4, fictional: true };

async function drop200(): Promise<IntakeWorkspace> {
  const { head, rows } = dailyLines();
  const files: { name: string; bytes: Uint8Array }[] = [{ name: XLSX, bytes: await dailyBook(head, rows) }];
  CSVS.forEach((name, i) => {
    const n = name === MANY ? 80 : 1;
    const from = 40 + ((i * 7) % (rows.length - 40));
    files.push({ name, bytes: csv(head, rows.slice(from, from + n)) });
  });
  const ws = new IntakeWorkspace(settings);
  await ws.addFiles(files.map((f) => ({ name: f.name, size: f.bytes.length, bytes: async () => f.bytes })));
  await ws.fresh();
  return ws;
}

/** 画面の部品が読む、ブラウザにだけあるもの（場所の hash と、橋渡しへの WebSocket。つながない） */
const saved = { location: (globalThis as { location?: unknown }).location, WebSocket: (globalThis as { WebSocket?: unknown }).WebSocket };
class NoSocket {
  addEventListener(): void {}
  send(): void {}
  close(): void {}
}
function at(hash: string): void {
  (globalThis as { location?: unknown }).location = { hash, search: "", protocol: "http:", host: "127.0.0.1:1" };
}
beforeAll(() => {
  (globalThis as { WebSocket?: unknown }).WebSocket = NoSocket;
  at("#/merge");
});
afterAll(() => {
  (globalThis as { location?: unknown }).location = saved.location;
  (globalThis as { WebSocket?: unknown }).WebSocket = saved.WebSocket;
  clearWorkingPlan();
  resetScreenForTest();
});

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
}
function page(ws: IntakeWorkspace, sheet: MergeSheet | null): string {
  return render(<Merge ws={ws} client={new BridgeClient("ws://unused")} sheet={sheet} />);
}
/** 開きタグ（data-testid で探す） */
function tags(html: string, testid: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z][a-z0-9]*[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((m) => m[0]);
}
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
/** data-testid の要素の中の字（タグを除いて。同じ名前のタグの入れ子を数えて閉じタグまで） */
function textsOf(html: string, testid: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<([a-z][a-z0-9]*)[^>]*data-testid="${testid}"[^>]*>`, "g"))) {
    const tag = m[1]!;
    const start = m.index! + m[0].length;
    let depth = 1;
    const re = new RegExp(`<(/?)${tag}(?=[\\s>])[^>]*>`, "g");
    re.lastIndex = start;
    let end = html.length;
    for (let t = re.exec(html); t; t = re.exec(html)) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = t.index;
        break;
      }
    }
    out.push(html.slice(start, end).replace(/<[^>]+>/g, ""));
  }
  return out;
}
/** data-testid の要素の中身（タグを残す） */
function innerOf(html: string, testid: string): string {
  const m = new RegExp(`<([a-z][a-z0-9]*)[^>]*data-testid="${testid}"[^>]*>`).exec(html);
  if (!m) return "";
  const tag = m[1]!;
  const start = m.index + m[0].length;
  let depth = 1;
  const re = new RegExp(`<(/?)${tag}(?=[\\s>])[^>]*>`, "g");
  re.lastIndex = start;
  for (let t = re.exec(html); t; t = re.exec(html)) {
    depth += t[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, t.index);
  }
  return html.slice(start);
}

/** theme.css の、そのセレクタの宣言（同じセレクタが何度あってもつなぐ。@media の中は除く） */
const css = readFileSync("src/app/theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const topCss = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
const rules = [...topCss.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const bodyOf = (sel: string) =>
  rules
    .filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel))
    .map((r) => r.body)
    .join("\n");

/** 第 1 版の前に開く資料：未確定の行がいちばん多い資料（同じ数なら名前順の先） */
function mostOpen(ws: IntakeWorkspace): string {
  const n = (f: string) => ws.view.counts.find((c) => c.file === f)?.unresolvedRows ?? 0;
  return [...ws.view.files].sort((a, b) => n(b) - n(a) || a.localeCompare(b, "ja", { numeric: true }))[0]!;
}
const byNameList = (names: readonly string[]) => [...names].sort((a, b) => a.localeCompare(b, "ja", { numeric: true }));
const rowsOf = (ws: IntakeWorkspace, reading: string[] = []): SourceRow[] =>
  sourceRows({ files: ws.view.files, sheets: ws.view.sheets, counts: ws.view.counts, rejected: [...ws.skippedFiles, ...ws.view.rejected], reading });

describe("資料 200・シート 12", () => {
  let ws: IntakeWorkspace;
  beforeAll(async () => {
    clearWorkingPlan();
    ws = await drop200();
    await loadSheets(ws, XLSX);
  });
  beforeEach(() => {
    clearWorkingPlan();
    at("#/merge");
  });

  test("入れた 200 の資料がすべて読めて、日報は 12 シート。未確定の多い資料は名前順の最初と別", () => {
    expect(ws.view.files).toHaveLength(200);
    expect(ws.view.rejected).toEqual([]);
    expect(ws.view.sheets.filter((s) => s.file === XLSX).map((s) => s.sheet)).toEqual(MONTHS);
    expect(mostOpen(ws)).not.toBe(byNameList(ws.view.files)[0]);
    expect(ws.view.counts.find((c) => c.file === mostOpen(ws))!.unresolvedRows).toBeGreaterThan(0);
  });

  test("タブの行は 1 行：資料ごとのタブを並べず、「資料」の札・資料の選び・シートの選び・「＋ 資料を追加」だけ", () => {
    at(`#/merge/files?f=${encodeURIComponent(XLSX)}`);
    const html = page(ws, "files");
    expect(getWorkingPlan()).toBeNull();
    expect(tags(html, "merge-tabs")).toHaveLength(1);
    const row = innerOf(html, "merge-tabs");
    // 資料ごとのタブは無い：行の中に出る資料の名前は、開いている資料の 1 つだけ
    expect(tags(html, "sheet-file")).toEqual([]);
    expect(CSVS.filter((n) => row.includes(n))).toEqual([]);
    expect(tags(row, "source-picker")).toHaveLength(1);
    expect(tags(row, "sheet-picker")).toHaveLength(1);
    expect(tags(row, "merge-add-files")).toHaveLength(1);
    expect(row.match(/role="tab"/g) ?? []).toHaveLength(0);
    expect(row.match(/<button/g)!.length).toBeLessThanOrEqual(6);
    // 並びは「資料」の札 → 資料の選び → シートの選び → 「＋ 資料を追加」
    const label = row.indexOf(`<span class="moyai-sheet-label">${TEXT.merge.filesLabel}</span>`);
    expect(label).toBeGreaterThanOrEqual(0);
    expect(label).toBeLessThan(row.indexOf('data-testid="source-picker"'));
    expect(row.indexOf('data-testid="source-picker"')).toBeLessThan(row.indexOf('data-testid="sheet-picker"'));
    expect(row.indexOf('data-testid="sheet-picker"')).toBeLessThan(row.indexOf('data-testid="merge-add-files"'));
    // 折り返さない・はみ出しは行の中で切る（ページを横に送らない）
    expect(bodyOf(".moyai-merge-tabs")).toMatch(/flex-wrap:\s*nowrap/);
    expect(bodyOf(".moyai-merge-tabs")).toMatch(/overflow:\s*hidden/);
    expect(bodyOf(".moyai-merge-tablist")).toMatch(/flex-wrap:\s*nowrap/);
    expect(bodyOf(".moyai-merge-tablist")).toMatch(/min-width:\s*0/);
  });

  test("資料の選び「daily-report.xlsx ▾」と、右に等幅の text-3「k / 200」「‹ ›」。名前は最大 280px で「…」、title に全文", () => {
    at(`#/merge/files?f=${encodeURIComponent(XLSX)}`);
    const html = page(ws, "files");
    const picker = tags(html, "source-picker")[0]!;
    expect(attr(picker, "data-file")).toBe(XLSX);
    expect(attr(picker, "data-count")).toBe("200");
    expect(attr(picker, "title")).toBe(XLSX);
    expect(attr(picker, "aria-haspopup")).toBe("listbox");
    expect(textsOf(html, "source-picker")).toEqual([`${XLSX}▾`]);
    const k = byNameList(ws.view.files).indexOf(XLSX) + 1;
    expect(textsOf(html, "source-position")).toEqual([`${k} / 200`]);
    expect(attr(tags(html, "source-position")[0]!, "class")).toContain("moyai-num");
    expect(bodyOf(".moyai-srcpick-pos")).toMatch(/color:\s*var\(--text-3\)/);
    expect(textsOf(html, "source-prev")).toEqual(["‹"]);
    expect(textsOf(html, "source-next")).toEqual(["›"]);
    // 名前順の最初の資料（daily-report.xlsx）なので「‹」は押せない
    expect(k).toBe(1);
    expect(tags(html, "source-prev")[0]).toContain("disabled");
    expect(tags(html, "source-next")[0]).not.toContain("disabled");
    const label = bodyOf(".moyai-srcpick-label");
    expect(label).toMatch(/max-width:\s*280px/);
    expect(label).toMatch(/text-overflow:\s*ellipsis/);
    expect(label).toMatch(/white-space:\s*nowrap/);
    // 入らないときは資料の名前から切る：資料の選びだけが縮み、ほかの項目は縮まない
    expect(bodyOf(".moyai-merge-tablist > .moyai-srcpick-source")).toMatch(/flex:\s*0 1 auto/);
    expect(bodyOf(".moyai-merge-tablist > *")).toMatch(/flex:\s*none/);
    // 資料の選びを開いた所は資料のシート（今のシートの字）
    expect(attr(tags(html, "source-pick")[0]!, "data-selected")).toBe("true");
  });

  test("シートの選び「4月 ▾　1 / 12」（シートが 2 つ以上のときだけ）。シートが 1 つの資料では出さない", async () => {
    at(`#/merge/files?f=${encodeURIComponent(XLSX)}`);
    const html = page(ws, "files");
    expect(textsOf(html, "sheet-picker")).toEqual(["4月▾"]);
    expect(textsOf(html, "sheet-position")).toEqual(["1 / 12"]);
    // 本体はそのシートの元の表
    expect(attr(tags(html, "source-tab")[0]!, "data-sheet")).toBe("4月");
    const one = CSVS[0]!;
    at(`#/merge/files?f=${encodeURIComponent(one)}`);
    await loadSheets(ws, one);
    const csvPage = page(ws, "files");
    expect(attr(tags(csvPage, "source-picker")[0]!, "data-file")).toBe(one);
    expect(tags(csvPage, "sheet-picker")).toEqual([]);
    expect(tags(csvPage, "sheet-position")).toEqual([]);
    await loadSheets(ws, XLSX);
  });

  test("シートの一覧は「シート名｜未確定 n」（絞る欄なし）", () => {
    const html = render(
      <SheetList
        rows={MONTHS.map((name, i) => ({ name, open: i === 2 ? 3 : 0 }))}
        current={0}
        onChoose={() => undefined}
        onClose={() => undefined}
      />,
    );
    expect(tags(html, "sheet-row")).toHaveLength(12);
    expect(textsOf(html, "sheet-row")).toEqual(MONTHS.map((m, i) => `${m}未確定 ${i === 2 ? 3 : 0}`));
    expect(tags(html, "source-filter-name")).toEqual([]);
    expect(html).toContain('data-shu="true"');
    expect(html.match(/data-shu="true"/g)).toHaveLength(1);
  });

  test("一覧：幅 520px・高さは画面の 60% まで中で送る。名前で絞る欄（空の字「名前」）、「名前順 | 未確定の多い順」、行「名前｜シート n｜未確定 n｜状態」", () => {
    expect(LIST_WIDTH).toBe(520);
    expect(bodyOf(".moyai-srcpick-rows")).toMatch(/max-height:\s*60vh/);
    expect(bodyOf(".moyai-srcpick-rows")).toMatch(/overflow-y:\s*auto/);
    const rows = rowsOf(ws);
    expect(rows).toHaveLength(200);
    const sorted = sortRows(rows, "name");
    const html = render(<SourceList rows={sorted} current={XLSX} order="name" onOrder={() => undefined} onChoose={() => undefined} onClose={() => undefined} />);
    expect(attr(tags(html, "source-filter-name")[0]!, "placeholder")).toBe("名前");
    expect(html).toMatch(/aria-pressed="true"[^>]*>名前順</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>未確定の多い順</);
    const list = tags(html, "source-row");
    expect(list).toHaveLength(200);
    expect(list.map((t) => attr(t, "data-file"))).toEqual(byNameList(ws.view.files));
    const texts = textsOf(html, "source-row");
    expect(texts[0]).toBe(`${XLSX}シート 12未確定 ${rows.find((r) => r.name === XLSX)!.open}`);
    for (const [i, r] of sorted.entries()) expect(texts[i]).toBe(`${r.name}シート ${r.sheets}未確定 ${r.open}`);
    // 未確定は 1 以上で朱、0 は text-3（状態は読めた資料なら空ける）
    const shu = (html.match(/class="moyai-srcpick-open moyai-num" data-shu="true"/g) ?? []).length;
    expect(shu).toBe(rows.filter((r) => r.open > 0).length);
    expect(shu).toBeGreaterThan(0);
    expect(bodyOf(".moyai-srcpick-open")).toMatch(/color:\s*var\(--text-3\)/);
    expect(bodyOf('.moyai-srcpick-open[data-shu="true"]')).toMatch(/color:\s*var\(--shu-text\)/);
    // 今の資料の行に印
    expect(list.filter((t) => attr(t, "data-current") === "true").map((t) => attr(t, "data-file"))).toEqual([XLSX]);
  });

  test("名前で絞る（大文字・全角でも同じ）と、未確定の多い順（同じ数なら名前順）", () => {
    const rows = rowsOf(ws);
    expect(filterRows(rows, "report-00").map((r) => r.name)).toEqual(CSVS.slice(0, 9));
    expect(filterRows(rows, "ＲＥＰＯＲＴ－１５０").map((r) => r.name)).toEqual([MANY]);
    expect(filterRows(rows, "DAILY").map((r) => r.name)).toEqual([XLSX]);
    expect(filterRows(rows, "存在しない名前")).toEqual([]);
    const open = sortRows(rows, "open");
    expect(open[0]!.name).toBe(mostOpen(ws));
    for (let i = 1; i < open.length; i++) {
      const a = open[i - 1]!;
      const b = open[i]!;
      expect(a.open > b.open || (a.open === b.open && a.name.localeCompare(b.name, "ja", { numeric: true }) < 0)).toBe(true);
    }
    // 絞った一覧を描く
    const html = render(<SourceList rows={sortRows(rows, "open")} current={null} order="open" onOrder={() => undefined} onChoose={() => undefined} onClose={() => undefined} initial={{ query: "daily", active: 0 }} />);
    expect(tags(html, "source-row").map((t) => attr(t, "data-file"))).toEqual([XLSX]);
    expect(html).toMatch(/aria-pressed="true"[^>]*>未確定の多い順</);
  });

  test("キー操作：↑↓ で行を動かし、Enter で開き、Esc で閉じる。絞ったあとも同じ。読込中の行は開かない", () => {
    const sorted = sortRows(rowsOf(ws), "name");
    const cur = CSVS[9]!;
    let st = pickStart(sorted, cur);
    expect(sorted[st.active]!.name).toBe(cur);
    const press = (key: string) => {
      const r = pickStep(st, { type: "key", key }, sorted, cur);
      st = r.state;
      return r;
    };
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowDown");
    press("ArrowUp");
    const enter = press("Enter");
    expect(enter.choose?.name).toBe(sorted[sorted.findIndex((r) => r.name === cur) + 2]!.name);
    expect(enter.close).toBe(true);
    const esc = press("Escape");
    expect(esc.choose).toBeNull();
    expect(esc.close).toBe(true);
    // 端で止まる
    st = { query: "", active: 0 };
    press("ArrowUp");
    expect(st.active).toBe(0);
    st = { query: "", active: sorted.length - 1 };
    press("ArrowDown");
    expect(st.active).toBe(sorted.length - 1);
    // 絞ると今の行は先頭（今の資料が残れば、その行）
    st = pickStep(st, { type: "query", query: "report-15" }, sorted, cur).state;
    expect(st.active).toBe(0);
    press("ArrowDown");
    expect(filterRows(sorted, "report-15")[st.active]!.name).toBe("report-151.csv");
    expect(press("Enter").choose?.name).toBe("report-151.csv");
    st = pickStep(st, { type: "query", query: "report-010" }, sorted, cur).state;
    expect(filterRows(sorted, "report-010")[st.active]!.name).toBe(cur);
    // ほかのキーは扱わない
    expect(listKey("a", 3, 10)).toBeNull();
    expect(listKey("Tab", 3, 10)).toBeNull();
    // 読込中の行は開かない（閉じない）
    const reading: SourceRow[] = [{ name: "読込中の資料.xlsx", state: "reading", sheets: 0, open: 0, reason: null }];
    const r = pickStep({ query: "", active: 0 }, { type: "key", key: "Enter" }, reading, null);
    expect(r.choose).toBeNull();
    expect(r.close).toBe(false);
  });

  test("開く資料の既定：第 1 版の前は未確定のいちばん多い資料、版のあとは名前順の最初", () => {
    const rows = rowsOf(ws);
    expect(defaultSource(rows, true)).toBe(mostOpen(ws));
    expect(defaultSource(rows, false)).toBe(byNameList(ws.view.files)[0]);
    at("#/merge/files");
    const before = page(ws, "files");
    expect(attr(tags(before, "source-picker")[0]!, "data-file")).toBe(mostOpen(ws));
    // 版のあと（作業中の計画がある）
    setWorkingPlan(
      planOf({ assets: [asset("a1", null)], works: [work("w1", "OVERHAUL", ["a1"])], details: [detail("d1", "w1", 2024)] }),
      "intake",
    );
    const after = page(ws, "files");
    expect(attr(tags(after, "source-picker")[0]!, "data-file")).toBe(XLSX);
    expect(byNameList(ws.view.files)[0]).toBe(XLSX);
    // ?f= で選んだ資料はそのまま
    at(`#/merge/files?f=${encodeURIComponent(MANY)}`);
    expect(attr(tags(page(ws, "files"), "source-picker")[0]!, "data-file")).toBe(MANY);
  });

  test("読込の途中は、選びの右に text-3 の「読込 120 / 200」。済んだら消す", () => {
    at("#/merge/files");
    ws.readProgress = { done: 120, total: 200 };
    try {
      const html = page(ws, "files");
      expect(textsOf(html, "source-reading")).toEqual(["読込 120 / 200"]);
      const row = innerOf(html, "merge-tabs");
      expect(row.indexOf('data-testid="source-reading"')).toBeGreaterThan(row.indexOf('data-testid="source-picker"'));
      expect(row.indexOf('data-testid="source-reading"')).toBeLessThan(row.indexOf('data-testid="merge-add-files"'));
      expect(bodyOf(".moyai-srcpick-reading")).toMatch(/color:\s*var\(--text-3\)/);
    } finally {
      ws.readProgress = null;
    }
    expect(tags(page(ws, "files"), "source-reading")).toEqual([]);
  });

  test("幅：横の板は 320px に固定（引いて変えない）、本体は残り。表は本体の中で横に送り、ページは横に送らない", () => {
    expect(SIDE_WIDTH).toBe(320);
    expect(bodyOf(".moyai-merge-side")).toMatch(/width:\s*320px/);
    expect(bodyOf(".moyai-merge-side")).toMatch(/flex:\s*none/);
    expect(bodyOf(".moyai-merge-main")).toMatch(/flex:\s*1/);
    expect(bodyOf(".moyai-merge-main")).toMatch(/min-width:\s*0/);
    expect(bodyOf(".moyai-merge-main")).toMatch(/overflow:\s*auto/);
    expect(bodyOf(".moyai-merge")).not.toMatch(/min-width:\s*1024px/);
    expect(bodyOf(".moyai-merge")).toMatch(/overflow:\s*hidden/);
    expect(css).not.toContain(".moyai-side-resize");
    expect(tags(page(ws, "files"), "side-resize")).toEqual([]);
  });
});

describe("読込中・読込不可の行", () => {
  test("状態は「読込中」（text-3）と「読込不可」（朱）だけ。読めた資料は空ける。読込不可の理由は詳細に", async () => {
    clearWorkingPlan();
    const { head, rows } = dailyLines();
    const ws = new IntakeWorkspace(settings);
    const good = csv(head, rows.slice(40, 42));
    const broken = new TextEncoder().encode("架空の壊れた資料");
    await ws.addFiles([
      { name: "report-a.csv", size: good.length, bytes: async () => good },
      { name: "broken.xlsx", size: broken.length, bytes: async () => broken },
      { name: "report-a.csv", size: good.length, bytes: async () => good },
    ]);
    await ws.fresh();
    const list = rowsOf(ws, ["report-b.csv", "report-a.csv"]);
    expect(list.map((r) => [r.name, r.state])).toEqual([
      ["report-a.csv", "ready"],
      ["report-b.csv", "reading"],
      ["broken.xlsx", "rejected"],
      ["report-a.csv", "rejected"],
    ]);
    expect(list.filter((r) => r.state === "rejected").every((r) => !!r.reason)).toBe(true);
    const html = render(<SourceList rows={list} current="report-a.csv" order="name" onOrder={() => undefined} onChoose={() => undefined} onClose={() => undefined} />);
    expect(tags(html, "source-row").map((t) => attr(t, "data-state"))).toEqual(["ready", "reading", "rejected", "rejected"]);
    const texts = textsOf(html, "source-row");
    expect(texts[0]).toMatch(/^report-a\.csvシート 1未確定 \d+$/);
    expect(texts[1]).toBe("report-b.csv読込中");
    expect(texts[2]).toBe("broken.xlsx読込不可");
    expect(attr(tags(html, "source-row")[1]!, "aria-disabled")).toBe("true");
    expect(attr(tags(html, "source-row")[2]!, "title")).toContain(list[2]!.reason!);
    expect(bodyOf('.moyai-srcpick-state[data-state="reading"]')).toMatch(/color:\s*var\(--text-3\)/);
    expect(bodyOf('.moyai-srcpick-state[data-state="rejected"]')).toMatch(/color:\s*var\(--shu-text\)/);
    // 詳細：名前・「読込不可」・理由
    const d = render(<RejectedDetail row={list[2]!} />);
    expect(textsOf(d, "source-rejected-detail")).toEqual([`broken.xlsx読込不可${list[2]!.reason}`]);
    // 一覧の行の数は資料の選びの数（読めた資料）とは別。読めた資料が 1 つなら「1 / 1」と「‹ ›」は出さない
    at("#/merge/files");
    const pageHtml = page(ws, "files");
    expect(attr(tags(pageHtml, "source-picker")[0]!, "data-count")).toBe("1");
    expect(tags(pageHtml, "source-position")).toEqual([]);
    expect(tags(pageHtml, "source-prev")).toEqual([]);
    // 読まなかった資料の一覧は本体に積まない（一覧の行と詳細に出す）
    expect(tags(pageHtml, "skipped")).toEqual([]);
    at("#/merge");
  });
});

describe("設定の「表示」の節（docs/screens.md 3.7）", () => {
  const FAC = "fac-display";
  /** 架空の計画：星取は 2020〜2024 年度 */
  const displayPlan = (packId = "waste-incineration") => {
    const p = planOf({
      assets: [asset("a1", null), asset("a2", null)],
      works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "OVERHAUL", ["a2"])],
      details: [detail("d1", "w1", 2020), detail("d2", "w1", 2023), detail("d3", "w2", 2024), detail("d4", "w2", 2024)],
    });
    return { ...p, packId, facility: { ...p.facility, facilityKey: FAC } };
  };
  beforeEach(() => resetScreenForTest());

  test("既定：階層「設備 › 機器 › 号炉」「設備 › 号炉 › 機器」、並び「計画の順」、最終年度は空の字「2040」の等幅の欄と「| 適用」と text-3「計画の最終年度」", () => {
    const html = render(<DisplaySettings plan={displayPlan()} />);
    expect(html).toMatch(/aria-pressed="true"[^>]*>設備 › 機器 › 号炉</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>設備 › 号炉 › 機器</);
    expect(textsOf(html, "display-row-order-value")).toEqual(["計画の順"]);
    expect(tags(html, "display-row-order-reset")).toEqual([]);
    for (const t of ["親の行", "上へ", "最大年度", "当てる", "計画の最後の年度", "号炉・系統"]) expect(html, t).not.toContain(t);
    const input = tags(html, "display-last-year-input")[0]!;
    expect(attr(input, "placeholder")).toBe("2040");
    expect(attr(input, "value")).toBe("");
    expect(attr(input, "class")).toContain("moyai-num");
    expect(textsOf(html, "display-last-year-apply")).toEqual(["適用"]);
    expect(attr(tags(html, "display-last-year-apply")[0]!, "class")).toBe("moyai-inline-act");
    expect(textsOf(html, "display-last-year-default")).toEqual(["計画の最終年度"]);
    expect(tags(html, "display-last-year-reset")).toEqual([]);
    expect(tags(html, "display-last-year-blocked")).toEqual([]);
  });

  test("号炉・系統の字は Skillパックの既定の階層の名前：し尿は系統、パックに無ければ「号炉・系統」", () => {
    expect(seriesLevelName("waste-incineration")).toBe("号炉");
    expect(seriesLevelName("night-soil")).toBe("系統");
    expect(seriesLevelName("no-such-pack")).toBe("号炉・系統");
    const ns = render(<DisplaySettings plan={displayPlan("night-soil")} />);
    expect(ns).toContain("設備 › 機器 › 系統");
    expect(ns).toContain("設備 › 系統 › 機器");
  });

  test("入れ替えたときだけ「入れ替え n」と「| 計画の順に戻す」。最終年度を変えたときだけ「| 計画の最終年度に戻す」", () => {
    setDisplayPrefs(FAC, { rowOrder: { "": ["n:a2", "n:a1"], "n:x": ["n:y", "n:z"] }, lastFiscalYear: 2040 });
    const html = render(<DisplaySettings plan={displayPlan()} />);
    expect(textsOf(html, "display-row-order-value")).toEqual(["入れ替え 2"]);
    expect(textsOf(html, "display-row-order-reset")).toEqual(["計画の順に戻す"]);
    expect(attr(tags(html, "display-last-year-input")[0]!, "value")).toBe("2040");
    expect(textsOf(html, "display-last-year-reset")).toEqual(["計画の最終年度に戻す"]);
    expect(tags(html, "display-last-year-default")).toEqual([]);
  });

  test("当てられないときは「理由：2022 年度より後の星取 n」（n はその年度より後の星取の数）", () => {
    const p = displayPlan();
    expect(lastYearCheck(p, "2022")).toEqual({ year: 2022, after: 3 });
    expect(lastYearCheck(p, "２０２４")).toEqual({ year: 2024, after: 0 });
    expect(lastYearCheck(p, "2040")).toEqual({ year: 2040, after: 0 });
    expect(lastYearCheck(p, "")).toBeNull();
    expect(lastYearCheck(p, "20400")).toBeNull();
    expect(lastYearCheck(p, "abcd")).toBeNull();
    expect(HUMAN_TEXT.settings.lastYearBlocked(2022, 3)).toBe("理由：2022 年度より後の星取 3");
  });

  test("作業中の計画が無いときは「作業中の計画なし」（text-3）の 1 行", () => {
    const html = render(<DisplaySettings plan={null} />);
    expect(textsOf(html, "display-no-plan")).toEqual(["作業中の計画なし"]);
    expect(html).toContain("color:var(--text-3)");
    expect(tags(html, "display-level-order")).toEqual([]);
  });

  test("Claude が保存先を入れたとき：欄の下に朱の小さな字「- Claude の入力」、右に text-3「前　（元の道）」。前の 1 行の文は無い", () => {
    const html = render(<RootOffered before="/tmp/架空の今の保存先" />);
    expect(textsOf(html, "root-offered-mark")).toEqual(["- Claude の入力"]);
    expect(tags(html, "root-offered-mark")[0]).toContain("--shu-text");
    expect(textsOf(html, "root-offered-before")).toEqual(["前　/tmp/架空の今の保存先"]);
    expect(tags(html, "root-offered-before")[0]).toContain("--text-3");
    const all = readFileSync("src/app/text/human.ts", "utf8");
    expect(all).not.toContain("良ければ「保存」を押してください");
    // 「表示」の節は Skillパックの上（設定を読めたとき）
    const src = readFileSync("src/app/pages/Settings.tsx", "utf8");
    expect(src.indexOf("row(T.displayTitle")).toBeGreaterThan(-1);
    expect(src.indexOf("row(T.displayTitle")).toBeLessThan(src.indexOf("T.packsTitle,"));
  });
});
