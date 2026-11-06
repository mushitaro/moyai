// 資料を落としたあとの画面（第 1 版の前）が、版があるときの資料のシートと同じ形であること（docs/screens.md 3.3 の末尾、Wire、11-07）。
// 白紙で資料 2 つ：資料のタブが 2 つ・最初の資料が選ばれている・本体はその資料の元の表と凡例の 1 行だけ・数の行と知らせの箱と決定の一覧が無い・
// 押せない理由は「理由：未回答 n」。横の板の質問は「- 既定」「n 行」「| 決める」。第 1 版をつくったあとも、知らせの箱と決定の一覧を出さず、資料のタブを 1 つ選んだ形。
// 画面は react-dom/server で描く（試験は node で走る）。資料は工場の架空の資料（fictional-1）の 2 つ。
import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { Questions, composeReasons, loadSheets } from "../../src/app/pages/Intake";
import { Merge } from "../../src/app/pages/Merge";
import { clearWorkingPlan, getWorkingPlan } from "../../src/app/state/plan-store";
import type { MergeSheet } from "../../src/app/stages";
import { TEXT } from "../../src/app/text";

const DIR = "samples/out/waste-incineration/fictional-1";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"];

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

async function dropTwo(): Promise<IntakeWorkspace> {
  const ws = new IntakeWorkspace({ packId: "waste-incineration", facilityName: "【架空】資料の画面の試験", fiscalYearStartMonth: 4, fictional: true });
  await ws.addFiles(
    FILES.map((name) => {
      const bytes = new Uint8Array(readFileSync(`${DIR}/${name}`));
      return { name, size: bytes.length, bytes: async () => bytes };
    }),
  );
  await ws.fresh();
  return ws;
}

function page(ws: IntakeWorkspace, sheet: MergeSheet | null): string {
  return renderToStaticMarkup(
    <MantineProvider>
      <Merge ws={ws} client={new BridgeClient("ws://unused")} sheet={sheet} />
    </MantineProvider>,
  );
}

/** 開きタグの属性（data-testid で探す。同じ testid がいくつもあれば全部） */
function tags(html: string, testid: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z]+[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((m) => m[0]);
}
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
/** data-testid の要素の中の字（入れ子の無い要素だけ） */
function textOf(html: string, testid: string): string {
  const m = new RegExp(`data-testid="${testid}"[^>]*>([^<]*)<`).exec(html);
  return m?.[1] ?? "";
}

/** 画面から無くした字と部品（前の取り込みの画面のもの） */
const GONE_TEXT = ["入れた行", "取り込んだ", "セル・除外", "除外の理由", "決定の一覧", "画面で作りました", "AI が作りました", "計画を作りました", "星取表を表示", "この答えにする", "対象行", "（既定）", "既定の答えで答える", "未解決のセル"];
const GONE_TESTID = ["destinations", "dest-file", "dest-reasons", "jump-unresolved", "composed", "to-chart", "decisions", "decision", "undo", "ai-only", "activity", "answer-group", "sheet-files"];
function expectNoOldIntake(html: string): void {
  for (const t of GONE_TEXT) expect(html, t).not.toContain(t);
  for (const id of GONE_TESTID) expect(tags(html, id), id).toEqual([]);
}

describe("資料を落としたあとの画面（第 1 版の前）", () => {
  let ws: IntakeWorkspace;
  beforeAll(async () => {
    clearWorkingPlan();
    ws = await dropTwo();
    // 本体の表は、開いた資料のシートを受け手から読んでから描く（画面の最初の描画で出るように、先に読んでおく）
    await loadSheets(ws, ws.view.files[0]!);
  });

  test("白紙で資料 2 つ：「資料」の札と資料のタブ 2 つと「＋ 資料を追加」。最初の資料が選ばれている", () => {
    expect(ws.view.files).toEqual(FILES);
    const html = page(ws, null);
    expect(getWorkingPlan()).toBeNull();
    const fileTabs = tags(html, "sheet-file");
    expect(fileTabs.map((t) => attr(t, "data-file"))).toEqual(FILES);
    expect(fileTabs.map((t) => attr(t, "aria-selected"))).toEqual(["true", "false"]);
    expect(html).toContain(`<span class="moyai-sheet-label">${TEXT.merge.filesLabel}</span>`);
    expect(tags(html, "merge-add-files")).toHaveLength(1);
    // 版があるときのシート（星取表・確定など）と、資料を 1 つのタブに積んだ「資料」のシートのタブは出さない
    expect(tags(html, "sheet-chart")).toEqual([]);
    expect(tags(html, "sheet-decisions")).toEqual([]);
  });

  test("本体は選んだ資料の元の表。上は凡例の 1 行「未確定行 n｜全行 n　■ 読取　■ 除外　■ 未確定」だけ", () => {
    const html = page(ws, null);
    const source = tags(html, "source-tab");
    expect(source).toHaveLength(1);
    expect(attr(source[0]!, "data-file")).toBe(FILES[0]);
    expect(tags(html, "sheet-grid")).toHaveLength(1);
    expect(html).toContain(TEXT.intake.source.openRows);
    expect(html).toContain(TEXT.intake.source.allRows);
    const legend = textOf(html, "source-legend");
    expect(html).toMatch(/data-testid="source-legend"[^>]*>.*読取.*除外.*未確定/s);
    expect(legend).not.toContain("セル");
    // 資料ごとの数の行・知らせの箱・決定の一覧・前の取り込みの画面の部品は無い。施設の欄と落とし場所も、資料が入ったら出さない
    expectNoOldIntake(html);
    expect(tags(html, "drop")).toEqual([]);
    expect(tags(html, "pack")).toEqual([]);
  });

  test("下の帯：右端に主ボタン「第 1 版をつくる」1 つ。押せない理由は「理由：未回答 n」だけ（セルの数は出さない）", () => {
    const open = ws.view.open.length;
    expect(open).toBeGreaterThan(0);
    // 取り込みはセルの数と答えの無い質問の数で止めている
    expect(ws.composeBlockers().some((b) => b.startsWith("未解決のセル"))).toBe(true);
    expect(composeReasons(ws)).toEqual([`未回答 ${open}`]);
    const html = page(ws, null);
    expect(textOf(html, "compose-disabled-reason")).toBe(`理由：未回答 ${open}`);
    const compose = tags(html, "compose");
    expect(compose).toHaveLength(1);
    expect(compose[0]).toContain("disabled");
    expect(html).toMatch(new RegExp(`data-testid="compose"[^>]*>(<[^>]+>)*${TEXT.merge.composeFirst}<`));
    expect(tags(html, "confirm-open")).toEqual([]);
    // 横の板の帯は「未回答 n」（既定はたたむ。数は下の帯と同じ）
    expect(textOf(html, "side-band-open")).toBe(`未回答 ${open}`);
  });

  test("横の板の質問：既定の答えに「- 既定」、「n 行」、ラジオ、「| 決める」。前の字は無い", () => {
    const view = ws.view;
    const html = renderToStaticMarkup(
      <MantineProvider>
        <Questions ws={ws} view={view} />
      </MantineProvider>,
    );
    const open = view.questions.filter((q) => view.open.includes(q.questionId));
    expect(tags(html, "question")).toHaveLength(open.length);
    expect(tags(html, "question-default")).toHaveLength(open.filter((q) => q.defaultAnswer !== null).length);
    expect(html).toContain(">- 既定<");
    expect([...html.matchAll(/data-testid="question-rows"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(open.map((q) => `${q.sameShapeRows} 行`));
    const answers = tags(html, "answer");
    expect(answers).toHaveLength(open.length);
    for (const a of answers) expect(attr(a, "class")).toBe("moyai-inline-act");
    expect([...html.matchAll(/data-testid="answer"[^>]*>([^<]*)</g)].map((m) => m[1])).toEqual(open.map(() => "決める"));
    expect(html).toContain('type="radio"');
    expectNoOldIntake(html);
  });

  test("画面の字から、前の質問の字を消した", () => {
    const q = TEXT.intake.questions as Record<string, unknown>;
    expect(q.defaultMark).toBe("- 既定");
    expect(q.answer).toBe("決める");
    expect((q.rows as (n: number) => string)(4)).toBe("4 行");
    expect(q.answerGroup).toBeUndefined();
    const all = readFileSync("src/app/text/index.ts", "utf8");
    for (const t of ["（既定）", "この答えにする", "対象行（", "問を既定の答えで答える", "決定の一覧", "画面で作りました", "入れた行"]) expect(all, t).not.toContain(t);
  });
});

describe("第 1 版をつくったあと", () => {
  test("知らせの箱と決定の一覧を出さず、資料のタブを 1 つ選んだ形で開く", async () => {
    clearWorkingPlan();
    const ws = await dropTwo();
    // 既定の答えで、人が画面で答える（試験の台本が押した）。答えで次の質問が出ることがあるので、無くなるまで
    for (let i = 0; i < 20 && ws.view.open.length > 0; i++) {
      const byId = new Map(ws.view.questions.map((q) => [q.questionId, q]));
      for (const id of ws.view.open) {
        const q = byId.get(id)!;
        const answer = q.defaultAnswer ?? (q.valueKind === "option" ? q.options[0]!.id : "0");
        await ws.answerAsHumanAsync(id, answer, "試験の台本が押した");
      }
      await ws.fresh();
    }
    expect(ws.view.open).toEqual([]);
    expect(composeReasons(ws)).toEqual([]);
    expect(ws.startCompose("human").started).toBe(true);
    await ws.whenComposed();
    expect(ws.compose.state).toBe("done");
    expect(getWorkingPlan()).not.toBeNull();
    // 白紙のあいだに資料が入ると、道は資料のシート（#/merge/files）になっている
    at("#/merge/files");
    await loadSheets(ws, FILES[0]!);
    const html = page(ws, "files");
    // 版があるときのシートのタブが並び、資料のタブは 2 つで、最初が選ばれている
    expect(tags(html, "sheet-chart")).toHaveLength(1);
    const fileTabs = tags(html, "sheet-file");
    expect(fileTabs.map((t) => attr(t, "data-file"))).toEqual(FILES);
    expect(fileTabs.map((t) => attr(t, "aria-selected"))).toEqual(["true", "false"]);
    expect(attr(tags(html, "merge-page")[0]!, "data-sheet")).toBe("files");
    expect(attr(tags(html, "source-tab")[0]!, "data-file")).toBe(FILES[0]);
    // つくったことは画面の印（data-compose）にだけ残し、知らせの箱は出さない
    expect(attr(tags(html, "intake-page")[0]!, "data-compose")).toBe("done");
    expect(attr(tags(html, "intake-page")[0]!, "data-compose-by")).toBe("human");
    expectNoOldIntake(html);
    // ?f= で選んだ資料を開く
    at(`#/merge/files?f=${encodeURIComponent(FILES[1]!)}`);
    const second = page(ws, "files");
    expect(tags(second, "sheet-file").map((t) => attr(t, "aria-selected"))).toEqual(["false", "true"]);
    at("#/merge");
  });
});
