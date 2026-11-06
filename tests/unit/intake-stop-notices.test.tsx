// 下の帯の止まった知らせ（docs/screens.md 3.3 の末尾「止まった知らせ」、Wire、11-07。仕事 intake-screen-v2）と、版があるときの資料のシートの形。
// - 作業場の記録のうち、結果不明と取り込みの処理の停止（workerStopped・workerFallback）だけを、下の帯の左（編集者の右）に朱の字で「結果不明 n」「取り込み停止」。
//   ふつうに終わった作業の記録だけなら何も出さない。押すと横の板の詳細にその記録（何を・いつ・止まった所）。やり直しの口は無いので「| やり直す」は出さない。
// - 版があるとき（「資料を重ねて第 n 版をつくる」）も、押せない理由は「理由：未回答 n」、知らせの箱は出さない。確定のシートには人の答えを並べない。
// 画面は react-dom/server で描く（試験は node で走る）。押すのは、描いた要素の onClick を呼ぶ（DOM の無い所で、画面と同じ手を通す）。
// 資料は工場の架空の資料（fictional-1）。
import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { StopNoticeDetail, StopNotices, composeReasons, loadSheets, stopNotices } from "../../src/app/pages/Intake";
import { Merge } from "../../src/app/pages/Merge";
import { clearWorkingPlan, getWorkingPlan } from "../../src/app/state/plan-store";
import type { MergeSheet } from "../../src/app/stages";
import { TEXT } from "../../src/app/text";
import { aiDecisions } from "../../src/plan/diff";

const DIR = "samples/out/waste-incineration/fictional-1";
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

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

function newWorkspace(): IntakeWorkspace {
  return new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】止まった知らせの試験", fiscalYearStartMonth: 4, fictional: true });
}

async function drop(ws: IntakeWorkspace, names: string[]): Promise<void> {
  await ws.addFiles(
    names.map((name) => {
      const bytes = new Uint8Array(readFileSync(`${DIR}/${name}`));
      return { name, size: bytes.length, bytes: async () => bytes };
    }),
  );
  await ws.fresh();
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
}

function page(ws: IntakeWorkspace, sheet: MergeSheet | null): string {
  return render(<Merge ws={ws} client={new BridgeClient("ws://unused")} sheet={sheet} />);
}

/** 開きタグ（data-testid で探す） */
function tags(html: string, testid: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((m) => m[0]);
}
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
/** data-testid の要素の中の字（タグを除いて。同じ名前のタグの入れ子を数えて閉じタグまで） */
function textsOf(html: string, testid: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<([a-z]+)[^>]*data-testid="${testid}"[^>]*>`, "g"))) {
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

/** 描いた要素の木から data-testid の要素を探す（DOM の無い所で、ボタンの onClick を呼ぶため。部品は開かず、子をたどる） */
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

/** 下の帯（.moyai-merge-bar から後ろ）の中で、testid の開きタグの位置 */
function inBar(html: string, testid: string): number {
  const bar = html.slice(html.indexOf("moyai-merge-bar"));
  return bar.indexOf(`data-testid="${testid}"`);
}

describe("止まった知らせ（下の帯）", () => {
  beforeAll(() => clearWorkingPlan());

  test("ふつうに終わった作業の記録だけなら、下の帯に何も出さない", () => {
    const ws = newWorkspace();
    ws.note("ai", TEXT.intake.ai.surveyed);
    ws.note("ai", TEXT.intake.ai.settled(3, 0));
    ws.note("info", TEXT.crosswalk.carried({ rules: 1, acceptedBefore: 1, acceptedAfter: 1, humanLost: 0 }));
    expect(ws.notices).toHaveLength(3);
    expect(stopNotices(ws.notices)).toEqual({ unknown: [], stopped: [] });
    const html = page(ws, null);
    expect(tags(html, "stop-unknown")).toEqual([]);
    expect(tags(html, "stop-worker")).toEqual([]);
    expect(tags(html, "stop-detail")).toEqual([]);
    expect(html).not.toContain(TEXT.intake.stop.unknownTitle);
    expect(html).not.toContain(TEXT.intake.stop.stopped);
    expect(html).not.toContain(TEXT.intake.ai.surveyed);
  });

  test("結果不明の記録が 1 つあると、下の帯の左に朱の字で「結果不明 1」。押すと詳細にその記録（何を・いつ・止まった所）", () => {
    const ws = newWorkspace();
    ws.note("ai", TEXT.intake.ai.surveyed);
    ws.note("unknown", TEXT.intake.activity.unknown("intake_settle"));
    ws.note("ai", TEXT.intake.ai.composeStarted);
    const html = page(ws, null);
    const b = tags(html, "stop-unknown");
    expect(b).toHaveLength(1);
    expect(b[0]).toMatch(/^<button /);
    expect(attr(b[0]!, "class")).toBe("moyai-stop-notice");
    expect(textsOf(html, "stop-unknown")).toEqual(["結果不明 1"]);
    expect(tags(html, "stop-worker")).toEqual([]);
    // 下の帯の左にあり、右の主ボタンより前
    expect(inBar(html, "stop-unknown")).toBeGreaterThan(-1);
    expect(inBar(html, "stop-unknown")).toBeLessThan(inBar(html, "compose"));
    // 押すまでは、詳細に記録を出さない
    expect(tags(html, "stop-detail")).toEqual([]);

    // 押すと、横の板の詳細をその記録で開く
    const onShow = vi.fn();
    const btn = findByTestId(StopNotices({ notices: ws.notices, onShow }), "stop-unknown");
    expect(btn).toHaveLength(1);
    (btn[0]!.props.onClick as () => void)();
    expect(onShow).toHaveBeenCalledWith("unknown");
    const detail = render(<StopNoticeDetail notices={ws.notices} kind="unknown" />);
    const records = textsOf(detail, "stop-record");
    expect(records).toHaveLength(1);
    const n = ws.notices.find((x) => x.kind === "unknown")!;
    expect(TEXT.intake.at(n.at)).toMatch(STAMP);
    expect(records[0]).toContain(`結果不明　${TEXT.intake.at(n.at)}`);
    expect(records[0]).toContain("項目　intake_settle");
    expect(records[0]).toContain(`停止箇所　${TEXT.intake.stop.whereTool}`);
    expect(records[0]).toContain(n.text);
    // ふつうの記録は詳細にも出さない。やり直しの口は無いので「| やり直す」は出さない
    expect(detail).not.toContain(TEXT.intake.ai.surveyed);
    expect(detail).not.toContain(TEXT.intake.ai.composeStarted);
    expect(detail).not.toContain("やり直す");
  });

  test("取り込みの処理の停止（workerStopped・workerFallback）は「取り込み停止」1 つ。詳細に記録が新しい順に 2 つ", () => {
    const ws = newWorkspace();
    ws.note("info", TEXT.intake.workerFallback);
    ws.note("info", TEXT.intake.workerStopped);
    ws.note("unknown", TEXT.intake.activity.unknown("intake_compose"));
    ws.note("unknown", TEXT.intake.activity.unknown("intake_settle"));
    const html = page(ws, null);
    expect(textsOf(html, "stop-unknown")).toEqual(["結果不明 2"]);
    expect(textsOf(html, "stop-worker")).toEqual(["取り込み停止"]);
    expect(attr(tags(html, "stop-worker")[0]!, "class")).toBe("moyai-stop-notice");
    expect(inBar(html, "stop-unknown")).toBeLessThan(inBar(html, "stop-worker"));
    const onShow = vi.fn();
    (findByTestId(StopNotices({ notices: ws.notices, onShow }), "stop-worker")[0]!.props.onClick as () => void)();
    expect(onShow).toHaveBeenCalledWith("stopped");
    const detail = render(<StopNoticeDetail notices={ws.notices} kind="stopped" />);
    const records = textsOf(detail, "stop-record");
    expect(records).toHaveLength(2);
    expect(records[0]).toMatch(/^取り込み停止　\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    expect(records[0]).toContain(`項目　${TEXT.intake.stop.whatWorker}`);
    expect(records[0]).toContain(`停止箇所　${TEXT.intake.stop.whereStopped}`);
    expect(records[0]).toContain(TEXT.intake.workerStopped);
    expect(records[1]).toContain(`停止箇所　${TEXT.intake.stop.whereFallback}`);
    expect(records[1]).toContain(TEXT.intake.workerFallback);
    // 結果不明の記録は、結果不明の詳細だけに出す
    expect(detail).not.toContain("intake_settle");
    const unknown = textsOf(render(<StopNoticeDetail notices={ws.notices} kind="unknown" />), "stop-record");
    expect(unknown.map((r) => /項目　([a-z_]+)/.exec(r)?.[1])).toEqual(["intake_settle", "intake_compose"]);
  });
});

describe("版があるとき（資料を重ねて第 n 版をつくる）", () => {
  test("押せない理由は「理由：未回答 n」、知らせの箱は出さない。止まった知らせは編集者の右。確定のシートに人の答えは並ばない", async () => {
    clearWorkingPlan();
    const ws = newWorkspace();
    await drop(ws, ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"]);
    // 既定の答えで、人が画面で答える（試験の台本が押した）。答えで次の質問が出ることがあるので、無くなるまで
    for (let i = 0; i < 20 && ws.view.open.length > 0; i++) {
      const byId = new Map(ws.view.questions.map((q) => [q.questionId, q]));
      for (const id of ws.view.open) {
        const q = byId.get(id)!;
        await ws.answerAsHumanAsync(id, q.defaultAnswer ?? (q.valueKind === "option" ? q.options[0]!.id : "0"), "試験の台本が押した");
      }
      await ws.fresh();
    }
    expect(ws.view.open).toEqual([]);
    expect(ws.startCompose("human").started).toBe(true);
    await ws.whenComposed();
    expect(ws.compose.state).toBe("done");
    const plan = getWorkingPlan()!.plan;
    // 人の答えは確定のシート（Claude が置いたものを人が受ける所）に並べない
    expect((plan.readingDecisions ?? []).length).toBeGreaterThan(0);
    expect((plan.readingDecisions ?? []).every((r) => r.author === "human")).toBe(true);
    expect(aiDecisions(plan).filter((d) => d.kind === "reading")).toEqual([]);

    // 資料を重ねる：作業日報を足すと、新しい質問が出る
    await drop(ws, ["daily-report.csv"]);
    const open = ws.view.open.length;
    expect(open).toBeGreaterThan(0);
    expect(composeReasons(ws)).toEqual([`未回答 ${open}`]);
    at("#/merge/files?f=daily-report.csv");
    await loadSheets(ws, "daily-report.csv");
    const html = page(ws, "files");
    const compose = tags(html, "compose");
    expect(compose).toHaveLength(1);
    expect(compose[0]).toContain("disabled");
    expect(textsOf(html, "compose")[0]).toMatch(/^資料を重ねて第 \d+ 版をつくる$/);
    expect(textsOf(html, "compose-disabled-reason")).toEqual([`理由：未回答 ${open}`]);
    expect(textsOf(html, "side-band-open")).toEqual([`未回答 ${open}`]);
    // 知らせの箱・決定の一覧・AI の作業の記録は出さない。ふつうの記録しか無いので、止まった知らせも出さない
    for (const id of ["composed", "to-chart", "decisions", "decision", "activity", "stop-unknown", "stop-worker"]) expect(tags(html, id), id).toEqual([]);
    expect(html).not.toContain("計画を作りました");

    // 結果不明の記録が置かれると、下の帯の左の編集者のすぐ右に「結果不明 1」（右の主ボタンより前）
    ws.note("unknown", TEXT.intake.activity.unknown("intake_settle"));
    const withStop = page(ws, "files");
    expect(textsOf(withStop, "merge-turn")).toEqual([TEXT.merge.turnLine("editing", true, "")]);
    expect(inBar(withStop, "merge-turn")).toBeLessThan(inBar(withStop, "stop-unknown"));
    expect(inBar(withStop, "stop-unknown")).toBeLessThan(inBar(withStop, "confirm-open"));
    expect(textsOf(withStop, "stop-unknown")).toEqual(["結果不明 1"]);
    at("#/merge");
  });
});
