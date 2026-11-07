// 資料のセルを選ぶと、そのセルを決めた答えと「| 取り消す」を詳しくに出す（docs/screens.md 3.3 の末尾「答えの取り消し」、Wire、11-07。仕事 intake-screen-v3）。
// - 取り込みの側：データ・除外のセルの行き先に、そのセルを決めた質問の ID の並び（qs）。同じスレッドの受け手でも worker の形でも同じ値が届く。
//   未解決のセルを決める質問（questionId）は、分かる所では埋まる。答えた時刻は作業場が持ち（settle で書き、undo で消す）、Decision と版の記録には入らない。
// - 画面：qs のあるセルの詳しくに、質問ごとに 1 行「答え　{答えの字}　{作者}　{日時}」と「| 取り消す」。押すと未回答が 1 増え、下の帯の押せない理由も増える。
// 画面は react-dom/server で描く（試験は node で走る）。押すのは、描いた要素の onClick を呼ぶ（DOM の無い所で、画面と同じ手を通す）。
// 資料は工場の架空の資料（fictional-2 の台帳と星取表）。
import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { WorkerEngine, sameThreadPort } from "../../src/app/intake/engine";
import { IntakeWorkspace, type SheetData } from "../../src/app/intake/workspace";
import { CellAnswers, cellAnswers, composeReasons, loadSheets } from "../../src/app/pages/Intake";
import { Merge } from "../../src/app/pages/Merge";
import { clearWorkingPlan } from "../../src/app/state/plan-store";
import { TEXT } from "../../src/app/text";
import type { CellStatus } from "../../src/import/compose";
import type { Decision } from "../../src/import/questions";
import { IntakeSession, type IntakeOptions } from "../../src/import/session";

const DIR = "samples/out/waste-incineration/fictional-2";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"];
const PLAN_FILE = FILES[1]!;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
const settings = { packId: "waste-incineration", facilityName: "【架空】答えの取り消しの試験", fiscalYearStartMonth: 4, fictional: true };

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
});
afterEach(() => {
  vi.useRealTimers();
  clearWorkingPlan();
});

const files = () => FILES.map((name) => ({ name, bytes: new Uint8Array(readFileSync(`${DIR}/${name}`)) }));
const sameThread = () => new IntakeWorkspace(settings);
const inWorker = () => new IntakeWorkspace(settings, new WorkerEngine(sameThreadPort()));

async function drop(ws: IntakeWorkspace): Promise<void> {
  await ws.addFiles(files().map((f) => ({ name: f.name, size: f.bytes.length, bytes: async () => f.bytes.slice() })));
  await ws.fresh();
}

/** 既定の答え（無ければ最初の選択肢）で、人が画面で答える。答えで次の質問が出ることがあるので、無くなるまで */
async function answerAll(ws: IntakeWorkspace, skip: (kind: string) => boolean = () => false): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const v = ws.view;
    const byId = new Map(v.questions.map((q) => [q.questionId, q]));
    const ids = v.open.filter((id) => !skip(byId.get(id)!.kind));
    if (!ids.length) return;
    for (const id of ids) {
      const q = byId.get(id)!;
      const r = await ws.answerAsHumanAsync(id, q.defaultAnswer ?? q.options[0]!.id, "試験の台本が押した");
      expect(r.ok).toBe(true);
    }
    await ws.fresh();
  }
}

const qsOf = (st: CellStatus | undefined): string[] => (st && st.s !== "unresolved" ? (st.qs ?? []) : []);
/** そのシートで、質問 q の答えで決まったセル（位置） */
const decidedBy = (sheets: SheetData[], q: string): string[] => sheets.flatMap((s) => [...s.status].filter(([, st]) => qsOf(st).includes(q)).map(([ref]) => `${s.sheetIndex}:${ref}`));
const statusAt = (sheets: SheetData[], key: string): CellStatus | undefined => {
  const [si, ref] = key.split(":") as [string, string];
  return sheets.find((s) => s.sheetIndex === Number(si))?.status.get(ref);
};

/** 機器を結ぶ質問（台帳と星取表の機器を同じものとして結ぶか）の ID */
const linkQuestion = (ws: IntakeWorkspace): string => {
  const q = ws.view.questions.find((x) => x.kind === "assetLink");
  expect(q).toBeDefined();
  return q!.questionId;
};

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
}
function page(ws: IntakeWorkspace): string {
  return render(<Merge ws={ws} client={new BridgeClient("ws://unused")} sheet={null} />);
}
/** 開きタグ（data-testid で探す） */
function tags(html: string, testid: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((m) => m[0]);
}
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
/** data-testid の要素の中の字（入れ子の無い要素だけ） */
function textsOf(html: string, testid: string): string[] {
  return [...html.matchAll(new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`, "g"))].map((m) => m[1] ?? "");
}
/** 描いた要素の木から data-testid の要素を探す（部品は開かず、子をたどる） */
function findByTestId(node: ReactNode, testid: string): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = [];
  const walk = (n: ReactNode): void => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<Record<string, unknown>>;
    if (el.props["data-testid"] === testid) out.push(el);
    walk(el.props.children as ReactNode);
  };
  walk(node);
  return out;
}

describe("取り込みの側：セルを決めた質問（qs）と答えた時刻", () => {
  test("答えたセルの qs に質問の ID が入る。同じスレッドと worker で同じ値。答えた時刻が作業場から届く", async () => {
    const a = sameThread();
    const b = inWorker();
    await drop(a);
    await drop(b);
    // 答える前は、どのセルにも qs が無い（決めた答えが無い）
    const before = await a.sheets(PLAN_FILE);
    expect(before.flatMap((s) => [...s.status.values()].filter((st) => qsOf(st).length > 0))).toEqual([]);

    const t0 = Date.now();
    await answerAll(a);
    await answerAll(b);
    const t1 = Date.now();
    expect(a.view.open).toEqual([]);
    expect(b.view.open).toEqual([]);
    const q = linkQuestion(a);
    expect(linkQuestion(b)).toBe(q);

    const sa = await a.sheets(PLAN_FILE);
    const sb = await b.sheets(PLAN_FILE);
    // 結ぶ答えで決まったデータのセルがある
    const cells = decidedBy(sa, q);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((k) => statusAt(sa, k)?.s === "data")).toBe(true);
    // worker の形でも同じ値（SheetWire → 作業場のシートの写し）
    expect(sb.map((s) => [s.file, s.sheetIndex, [...s.status]])).toEqual(sa.map((s) => [s.file, s.sheetIndex, [...s.status]]));
    // qs に入るのは、答えが効いている質問だけ
    const answered = new Set(a.view.questions.filter((x) => x.decision && !x.invalid).map((x) => x.questionId));
    for (const s of sa) for (const st of s.status.values()) for (const id of qsOf(st)) expect(answered.has(id)).toBe(true);
    // 答えた時刻（このタブで置いた決定ごと）。Decision には足さない
    for (const ws of [a, b]) {
      const iso = ws.answeredAt(q);
      expect(iso).not.toBeNull();
      const ms = Date.parse(iso!);
      expect(ms).toBeGreaterThanOrEqual(t0);
      expect(ms).toBeLessThanOrEqual(t1);
      expect(TEXT.intake.at(iso!)).toMatch(STAMP);
      for (const d of ws.decisions()) expect(Object.keys(d).sort()).toEqual(["answer", "author", "questionId", "reason"]);
    }
  });

  test("未解決のセルを決める質問（questionId）は、分かる所では埋まる", async () => {
    const ws = sameThread();
    await drop(ws);
    // 機器を結ぶ質問だけを残して答える：残りの未解決のセルは、どれもその質問を待っている
    await answerAll(ws, (kind) => kind === "assetLink");
    const q = linkQuestion(ws);
    expect(ws.view.open).toEqual([q]);
    const sheets = [...(await ws.sheets(FILES[0]!)), ...(await ws.sheets(PLAN_FILE))];
    const open = sheets.flatMap((s) => [...s.status.values()].filter((st) => st.s === "unresolved"));
    expect(open.length).toBe(ws.view.unresolvedCells);
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((st) => st.s === "unresolved" && st.questionId === q)).toBe(true);
  });

  test("取り消すと、未回答が 1 増え、同じ答えで決まったセルがまとめて未解決に戻る。時刻も消える。答え直すと計画を作れる（worker の形）", async () => {
    const ws = inWorker();
    await drop(ws);
    await answerAll(ws);
    const q = linkQuestion(ws);
    expect(composeReasons(ws)).toEqual([]);
    const cells = decidedBy(await ws.sheets(PLAN_FILE), q);
    expect(cells.length).toBeGreaterThan(0);
    const open = ws.view.open.length;

    await ws.undoAsync(q);
    expect(ws.view.open.length).toBe(open + 1);
    expect(ws.view.open).toContain(q);
    expect(ws.answeredAt(q)).toBeNull();
    const after = await ws.sheets(PLAN_FILE);
    // 同じ答えで決まったセルは、どれも未解決に戻り、その質問を待つ
    expect(cells.map((k) => statusAt(after, k))).toEqual(cells.map(() => ({ s: "unresolved", questionId: q })));
    expect(decidedBy(after, q)).toEqual([]);
    expect(composeReasons(ws)).toEqual([`未回答 ${open + 1}`]);

    // 答え直すと、セルはまた決まり、計画を作れる
    await answerAll(ws);
    expect(ws.view.open).toEqual([]);
    expect(composeReasons(ws)).toEqual([]);
    expect(decidedBy(await ws.sheets(PLAN_FILE), q)).toEqual(cells);
    expect(ws.answeredAt(q)).not.toBeNull();
  });

  test("版の記録の字は変わらない：答えた時刻も qs も計画に入らず、違う時刻に答えても同じ計画", async () => {
    const options: IntakeOptions = {
      planId: "plan-cell-answers",
      displayName: settings.facilityName,
      packId: settings.packId,
      facility: { facilityKey: "f-cell-answers", name: settings.facilityName, fiscalYearStartMonth: 4, scale: null, scaleUnit: null, legalFlags: [], fictional: true, inNationalTable: null },
    };
    // 1 回目：作業場で答え、その決定を取る（作者・理由のまま）
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-07T06:30:00+09:00"));
    const ws = sameThread();
    await drop(ws);
    await answerAll(ws);
    const decisions: Decision[] = ws.decisions();
    expect(ws.answeredAt(linkQuestion(ws))).toBe("2026-11-06T21:30:00.000Z");
    const compose = async (when: string) => {
      vi.setSystemTime(new Date(when));
      const s = new IntakeSession(options);
      await s.add(files());
      s.settle(decisions);
      return s.compose();
    };
    const c1 = await compose("2026-11-07T06:30:00+09:00");
    const c2 = await compose("2026-11-08T19:59:00+09:00");
    expect(c1.plan).not.toBeNull();
    expect(JSON.stringify(c2.plan)).toBe(JSON.stringify(c1.plan));
    const json = JSON.stringify(c1.plan);
    // セルの行き先の写し（qs）と答えた時刻は、計画の字に入らない
    expect(json).not.toContain('"qs"');
    expect(json).not.toContain("2026-11-06T21:30");
    expect(json).not.toContain("answeredAt");
    // 読み方の決定の記録の欄は今までのまま
    for (const r of c1.plan!.readingDecisions ?? []) expect(Object.keys(r).sort()).toEqual(["answer", "author", "details", "kind", "question", "questionId", "reason", "rows", "where"]);
    // セルの行き先には qs が付いている（画面の写しだけ）
    expect([...c1.status.values()].some((st) => qsOf(st).length > 0)).toBe(true);
  });
});

describe("画面：資料のシートの詳しくの、セルを決めた答えと「| 取り消す」", () => {
  test("答えで決まったセル：質問ごとに 1 行「答え　{答えの字}　{作者}　{日時}」と「| 取り消す」。押すと未回答が 1 増え、下の帯の理由も増える", async () => {
    const ws = sameThread();
    await drop(ws);
    await answerAll(ws);
    const q = linkQuestion(ws);
    const sheets = await loadSheets(ws, PLAN_FILE);
    const cell = decidedBy(sheets, q)[0]!;
    const qs = qsOf(statusAt(sheets, cell));
    expect(qs).toContain(q);
    const view = ws.view;
    const question = view.questions.find((x) => x.questionId === q)!;
    const label = question.options.find((o) => o.id === question.decision!.answer)!.label;

    const html = render(<CellAnswers ws={ws} view={view} qs={qs} />);
    const rows = tags(html, "cell-answer");
    expect(rows.map((t) => attr(t, "data-question"))).toEqual(cellAnswers(ws, view, qs).map((x) => x.questionId));
    expect(rows.map((t) => attr(t, "data-question"))).toContain(q);
    const line = textsOf(html, "cell-answer-line")[rows.findIndex((t) => attr(t, "data-question") === q)]!;
    const stamp = TEXT.intake.at(ws.answeredAt(q)!);
    expect(stamp).toMatch(STAMP);
    expect(line).toBe(`答え　${label}　人　${stamp}`);
    const undo = tags(html, "cell-answer-undo");
    expect(undo).toHaveLength(rows.length);
    for (const u of undo) {
      expect(u).toMatch(/^<button /);
      expect(attr(u, "class")).toBe("moyai-inline-act");
    }
    expect(textsOf(html, "cell-answer-undo")).toEqual(rows.map(() => "取り消す"));

    // 押す前：未回答 0、下の帯の押せない理由も無い
    expect(ws.view.open).toEqual([]);
    expect(tags(page(ws), "compose-disabled-reason")).toEqual([]);
    // 「| 取り消す」を押す（描いた要素の onClick）
    const row = findByTestId(CellAnswers({ ws, view, qs }), "cell-answer").find((r) => r.props["data-question"] === q);
    expect(row).toBeDefined();
    const btn = findByTestId(row!.props.children as ReactNode, "cell-answer-undo")[0];
    expect(btn).toBeDefined();
    (btn!.props.onClick as () => void)();
    await ws.fresh();
    expect(ws.view.open).toEqual([q]);
    expect(composeReasons(ws)).toEqual(["未回答 1"]);
    const after = page(ws);
    expect(textsOf(after, "side-band-open")).toEqual(["未回答 1"]);
    expect(textsOf(after, "compose-disabled-reason")).toEqual(["理由：未回答 1"]);
    // 取り消した答えは、詳しくから消える（古いシートの写しのままでも出さない）
    expect(cellAnswers(ws, ws.view, qs).map((x) => x.questionId)).not.toContain(q);
  });

  test("作者の字は今の字（人・会話の回答・Claude 判断）。読み方の規則の答えと、答えの無い質問は出さない", async () => {
    const ws = sameThread();
    await drop(ws);
    await answerAll(ws, (kind) => kind === "assetLink");
    const q = linkQuestion(ws);
    const question = ws.view.questions.find((x) => x.questionId === q)!;
    // 答えの無い質問は出さない
    expect(cellAnswers(ws, ws.view, [q])).toEqual([]);
    const label = question.options.find((o) => o.id === question.defaultAnswer)!.label;
    for (const [author, word] of [
      ["ai_relayed_human", TEXT.author.ai_relayed_human],
      ["ai", TEXT.author.ai],
    ] as const) {
      expect(ws.settle([{ questionId: q, answer: question.defaultAnswer!, author, reason: "試験：会話から" }]).ok).toBe(true);
      const sheets = await ws.sheets(PLAN_FILE);
      const qs = qsOf(statusAt(sheets, decidedBy(sheets, q)[0]!));
      const mine = cellAnswers(ws, ws.view, qs).find((x) => x.questionId === q)!;
      expect(mine).toEqual({ questionId: q, answer: label, author: word, at: TEXT.intake.at(ws.answeredAt(q)!) });
      expect(textsOf(render(<CellAnswers ws={ws} view={ws.view} qs={[q]} />), "cell-answer-line")).toEqual([`答え　${label}　${word}　${mine.at}`]);
    }
    expect([TEXT.author.human, TEXT.author.ai_relayed_human, TEXT.author.ai]).toEqual(["人", "会話の回答", "Claude 判断"]);
    // このタブの決定でない質問の ID は出さない
    expect(cellAnswers(ws, ws.view, ["q-unknown"])).toEqual([]);
  });

  test("版から戻した決定は、答えた時刻が分からないので日時を出さない（取り消しはできる）", async () => {
    const first = sameThread();
    await drop(first);
    await answerAll(first);
    const decisions = first.decisions();
    const q = linkQuestion(first);
    const ws = sameThread();
    await ws.restoreVersion(1, files(), decisions);
    expect(ws.view.open).toEqual([]);
    expect(ws.answeredAt(q)).toBeNull();
    const sheets = await ws.sheets(PLAN_FILE);
    const qs = qsOf(statusAt(sheets, decidedBy(sheets, q)[0]!));
    const question = ws.view.questions.find((x) => x.questionId === q)!;
    const label = question.options.find((o) => o.id === question.decision!.answer)!.label;
    const html = render(<CellAnswers ws={ws} view={ws.view} qs={[q]} />);
    expect(textsOf(html, "cell-answer-line")).toEqual([`答え　${label}　人`]);
    expect(tags(html, "cell-answer-undo")).toHaveLength(1);
    expect(qs).toContain(q);
  });
});
