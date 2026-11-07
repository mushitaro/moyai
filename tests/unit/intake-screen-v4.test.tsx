// 取り込みの画面の写しの照らし 5 つ（docs/screens.md 3.3 の末尾「写しの照らし」、Wire、11-07、34cb0bd。仕事 intake-screen-v4）と、
// 取り込みの処理（worker）が起きたあとに止まったときの「取り込み停止」。
// 1 見出し：第 1 版をつくる前は施設の名前だけ。つくったあとは「第 1 版　編集中」。
// 2 未確定のセル：朱の字と、セルの下の 2px の朱の線だけ。四方の枠は選んだセルの印だけ。
// 3 未確定のセルの詳細：種別「未確定」（朱。凡例と同じ言葉）の下に「質問　{その質問の題}」と「| 決める」。押すと横の板の「未回答」でその質問を開く。
// 4 答えのセルの詳細は tests/unit/intake-cell-answers.test.tsx（1 行目「答え　…」、2 行目「人　日時」と右端の「| 取り消す」）。
// 5 「| 資料を重ねて第 n 版をつくる」：つくった版に入っていない変更があるときだけ。凡例の行の右端。つくった直後は出さない。
// 6 worker の見張り（Web Locks の lock が離れたら止まった）：待っている答えを誤りで終え、下の帯に「取り込み停止」。
// 画面は react-dom/server で描く（試験は node で走る）。資料は工場の架空の資料（fictional-2 の台帳と星取表）。
import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { BridgeClient } from "../../src/app/bridge-client";
import { holdAlive, watchAlive, type AliveLocks } from "../../src/app/intake/alive";
import { WorkerEngine, type EngineFault, type IntakePort } from "../../src/app/intake/engine";
import { IntakeHost } from "../../src/app/intake/intake-host";
import { IntakeWorkspace } from "../../src/app/intake/workspace";
import { CellOpen, Questions, StopNoticeDetail, loadSheets, stopNotices } from "../../src/app/pages/Intake";
import { Merge } from "../../src/app/pages/Merge";
import { clearWorkingPlan, getWorkingPlan } from "../../src/app/state/plan-store";
import type { MergeSheet } from "../../src/app/stages";
import { TEXT } from "../../src/app/text";
import type { CellStatus } from "../../src/import/compose";

const DIR = "samples/out/waste-incineration/fictional-2";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx"];
const NAME = "【架空】写しの照らしの試験";
const settings = { packId: "waste-incineration", facilityName: NAME, fiscalYearStartMonth: 4, fictional: true };

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

const bytesOf = (name: string) => new Uint8Array(readFileSync(`${DIR}/${name}`));

async function dropped(): Promise<IntakeWorkspace> {
  const ws = new IntakeWorkspace(settings);
  await ws.addFiles(FILES.map((name) => ({ name, size: bytesOf(name).length, bytes: async () => bytesOf(name) })));
  await ws.fresh();
  return ws;
}

/** 既定の答え（無ければ最初の選択肢）で、人が画面で答える。skip の種類は残す。答えで次の質問が出ることがあるので、無くなるまで */
async function answerAll(ws: IntakeWorkspace, skip: (kind: string) => boolean = () => false): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const byId = new Map(ws.view.questions.map((q) => [q.questionId, q]));
    const ids = ws.view.open.filter((id) => !skip(byId.get(id)!.kind));
    if (!ids.length) return;
    for (const id of ids) {
      const q = byId.get(id)!;
      const r = await ws.answerAsHumanAsync(id, q.defaultAnswer ?? (q.valueKind === "option" ? q.options[0]!.id : "1"), "試験の台本が押した");
      expect(r.ok).toBe(true);
    }
    await ws.fresh();
  }
}

async function composed(): Promise<IntakeWorkspace> {
  clearWorkingPlan();
  const ws = await dropped();
  await answerAll(ws);
  expect(ws.view.open).toEqual([]);
  expect(ws.startCompose("human").started).toBe(true);
  await ws.whenComposed();
  expect(ws.compose.state).toBe("done");
  expect(getWorkingPlan()).not.toBeNull();
  return ws;
}

/** 機器を結ぶ質問（台帳と星取表の機器を同じものとして結ぶか）の ID */
const linkQuestion = (ws: IntakeWorkspace): string => ws.view.questions.find((x) => x.kind === "assetLink")!.questionId;

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
/** 見出しの行（.moyai-merge-head から、シートのタブの行の前まで） */
function head(html: string): string {
  return html.slice(html.indexOf("moyai-merge-head"), html.indexOf("moyai-sheet-tabs"));
}

describe("1 見出し", () => {
  test("第 1 版をつくる前は施設の名前だけ（「第 1 版」の札も状態も出さない）。つくったあとは「第 1 版　編集中」", async () => {
    clearWorkingPlan();
    const ws = await dropped();
    expect(getWorkingPlan()).toBeNull();
    const before = page(ws, null);
    expect(textsOf(before, "plan-name")).toEqual([NAME]);
    expect(tags(before, "merge-version")).toEqual([]);
    expect(tags(before, "merge-state")).toEqual([]);
    expect(head(before)).not.toContain("第 ");
    // つくる版の番号は下の帯の主ボタンにある
    expect(textsOf(before, "compose")).toEqual([TEXT.merge.composeFirst]);

    await answerAll(ws);
    expect(ws.startCompose("human").started).toBe(true);
    await ws.whenComposed();
    expect(ws.compose.state).toBe("done");
    at("#/merge/files");
    await loadSheets(ws, FILES[0]!);
    const after = page(ws, "files");
    expect(textsOf(after, "plan-name")).toEqual([NAME]);
    expect(textsOf(after, "merge-version")).toEqual(["第 1 版"]);
    expect(textsOf(after, "merge-state")).toEqual([TEXT.top.state.editing]);
    expect(TEXT.top.state.editing).toBe("編集中");
    at("#/merge");
  });
});

describe("2 未確定のセルの見た目", () => {
  /** intake.css の、そのセレクタの宣言（同じセレクタが何度あってもつなぐ） */
  const css = readFileSync("src/app/intake/intake.css", "utf8");
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  const bodyOf = (sel: string) => rules.filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel)).map((r) => r.body).join("\n");

  test("資料のタブの未確定のセル：朱の字と、セルの下の 2px の朱の線（box-shadow）だけ。四方の枠（outline）は使わない", () => {
    const q = bodyOf('.moyai-source td[data-s="unresolved"]');
    expect(q).toMatch(/color:\s*var\(--shu-text\)/);
    expect(q).toMatch(/box-shadow:\s*inset 0 -2px 0 var\(--shu\)/);
    // 罫はほかのセルと同じ細い罫（朱の 2px の罫を重ねない）
    expect(q).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    // 未確定のセルのどの決まりも、枠で囲まない
    for (const r of rules.filter((x) => x.sel.includes('td[data-s="unresolved"]'))) expect(r.body, r.sel).not.toMatch(/outline/);
    // 資料のタブの決まりは、表の決まり（.moyai-sheet）より後ろにある（同じ強さなので後ろが効く）
    expect(css.indexOf('.moyai-source td[data-s="unresolved"]')).toBeGreaterThan(css.indexOf('.moyai-sheet td[data-s="unresolved"]'));
  });

  test("枠は選んだセルの印として残す", () => {
    const f = bodyOf('.moyai-sheet td[data-focus="true"]');
    expect(f).toMatch(/outline:\s*2px solid var\(--focus\)/);
  });
});

describe("3 未確定のセルの詳細", () => {
  let ws: IntakeWorkspace;
  beforeAll(async () => {
    clearWorkingPlan();
    ws = await dropped();
    // 機器を結ぶ質問だけを残す：残りの未確定のセルは、どれもその質問を待っている
    await answerAll(ws, (kind) => kind === "assetLink");
  });

  test("種別「未確定」（朱。凡例と同じ言葉）の下に「質問　{その質問の題}」と「| 決める」。前の文は出さない", async () => {
    const q = linkQuestion(ws);
    expect(ws.view.open).toEqual([q]);
    const sheets = await loadSheets(ws, FILES[1]!);
    const st = sheets.flatMap((s) => [...s.status.values()]).find((x): x is Extract<CellStatus, { s: "unresolved" }> => x.s === "unresolved");
    expect(st?.questionId).toBe(q);
    const question = ws.view.questions.find((x) => x.questionId === q)!;
    const html = render(<CellOpen view={ws.view} questionId={st!.questionId} onQuestion={() => undefined} />);
    // 凡例（source-legend の「■ 未確定」）と同じ字
    expect(textsOf(html, "cell-kind")).toEqual([TEXT.intake.source.open]);
    expect(TEXT.intake.source.open).toBe("未確定");
    expect(attr(tags(html, "cell-kind")[0]!, "style")).toContain("var(--shu-text)");
    expect(textsOf(html, "cell-question-line")).toEqual([`質問　${(TEXT.intake.questionKind as Record<string, string>)[question.kind] ?? question.text}`]);
    expect(attr(tags(html, "cell-question")[0]!, "data-question")).toBe(q);
    const open = tags(html, "cell-question-open");
    expect(open).toHaveLength(1);
    expect(open[0]).toMatch(/^<button /);
    expect(attr(open[0]!, "class")).toBe("moyai-inline-act");
    expect(textsOf(html, "cell-question-open")).toEqual(["決める"]);
    // 種別が先、質問の行がその下、「| 決める」はその行の右
    expect(html.indexOf('data-testid="cell-kind"')).toBeLessThan(html.indexOf('data-testid="cell-question-line"'));
    expect(html.indexOf('data-testid="cell-question-line"')).toBeLessThan(html.indexOf('data-testid="cell-question-open"'));
    for (const gone of ["未解決", "この質問に答えると決まります"]) expect(html).not.toContain(gone);
    const all = readFileSync("src/app/text/index.ts", "utf8");
    expect(all).not.toContain("この質問に答えると決まります");
  });

  test("「| 決める」を押すと、その質問を横の板の「未回答」で開く（開いた質問に印）", () => {
    const q = linkQuestion(ws);
    const onQuestion = vi.fn();
    const btn = findByTestId(CellOpen({ view: ws.view, questionId: q, onQuestion }), "cell-question-open");
    expect(btn).toHaveLength(1);
    (btn[0]!.props.onClick as () => void)();
    expect(onQuestion).toHaveBeenCalledWith(q);
    // 横の板の「未回答」：開いた質問にだけ印
    const side = render(<Questions ws={ws} view={ws.view} focus={{ questionId: q, seq: 1 }} />);
    const cards = tags(side, "question");
    expect(cards.map((t) => attr(t, "data-question"))).toContain(q);
    expect(cards.filter((t) => attr(t, "data-focus") === "true").map((t) => attr(t, "data-question"))).toEqual([q]);
    expect(tags(render(<Questions ws={ws} view={ws.view} />), "question").filter((t) => attr(t, "data-focus") === "true")).toEqual([]);
  });

  test("質問が分からないセル（questionId が null・写しに無い質問）は「質問」の行を出さない。開く先が無ければ「| 決める」を出さない", () => {
    const q = linkQuestion(ws);
    for (const id of [null, "q-unknown"]) {
      const html = render(<CellOpen view={ws.view} questionId={id} onQuestion={() => undefined} />);
      expect(textsOf(html, "cell-kind")).toEqual(["未確定"]);
      expect(tags(html, "cell-question")).toEqual([]);
      expect(tags(html, "cell-question-open")).toEqual([]);
      expect(html).not.toContain("質問");
    }
    const noSide = render(<CellOpen view={ws.view} questionId={q} onQuestion={null} />);
    expect(tags(noSide, "cell-question")).toHaveLength(1);
    expect(tags(noSide, "cell-question-open")).toEqual([]);
  });

  test("答えのある（未回答でない）質問なら、「質問」の行だけ出し「| 決める」は出さない（開いても板に無い）", async () => {
    const other = new IntakeWorkspace(settings);
    await other.addFiles(FILES.map((name) => ({ name, size: bytesOf(name).length, bytes: async () => bytesOf(name) })));
    await other.fresh();
    await answerAll(other);
    const q = linkQuestion(other);
    expect(other.view.open).not.toContain(q);
    const html = render(<CellOpen view={other.view} questionId={q} onQuestion={() => undefined} />);
    expect(tags(html, "cell-question")).toHaveLength(1);
    expect(tags(html, "cell-question-open")).toEqual([]);
  });
});

describe("5 「| 資料を重ねて第 n 版をつくる」", () => {
  test("つくった直後は出さない。答えを取り消すと、凡例の行の右端に出る（押せない理由は「理由：未回答 n」）。答え直しても、つくった版に無いので出したまま", async () => {
    const ws = await composed();
    const plan = getWorkingPlan()!.plan;
    expect(ws.uncomposed(plan.planId)).toBe(false);
    at("#/merge/files");
    await loadSheets(ws, FILES[0]!);
    const fresh = page(ws, "files");
    expect(tags(fresh, "source-tab")).toHaveLength(1);
    expect(tags(fresh, "compose")).toEqual([]);
    expect(tags(fresh, "compose-next")).toEqual([]);
    expect(tags(fresh, "compose-disabled-reason")).toEqual([]);
    expect(fresh).not.toContain("資料を重ねて");

    // 取り消す（答えの変更）：つくった版に入っていない変更
    const q = linkQuestion(ws);
    ws.undo(q);
    await ws.fresh();
    expect(ws.uncomposed(plan.planId)).toBe(true);
    await loadSheets(ws, FILES[0]!);
    const undone = page(ws, "files");
    const compose = tags(undone, "compose");
    expect(compose).toHaveLength(1);
    expect(compose[0]).toMatch(/^<button /);
    expect(attr(compose[0]!, "class")).toBe("moyai-inline-act");
    expect(compose[0]).toContain("disabled");
    expect(textsOf(undone, "compose")[0]).toMatch(/^資料を重ねて第 \d+ 版をつくる$/);
    expect(textsOf(undone, "compose-disabled-reason")).toEqual(["理由：未回答 1"]);
    // 置き場所は凡例の行の右端：資料のタブの中で、凡例のあと・表の前。資料のタブより上（凡例の上の行）には置かない
    const page0 = undone.indexOf('data-testid="intake-page"');
    const tab = undone.indexOf('data-testid="source-tab"');
    const legend = undone.indexOf('data-testid="source-legend"');
    const grid = undone.indexOf('data-testid="sheet-grid"');
    const at0 = undone.indexOf('data-testid="compose"');
    expect(page0).toBeGreaterThan(-1);
    expect(undone.slice(page0, tab)).not.toContain('data-testid="compose');
    expect(at0).toBeGreaterThan(legend);
    expect(at0).toBeLessThan(grid);
    // 凡例と同じ行（凡例の行の Group の中）：凡例の行の開きタグから、表の枠までの間に、ほかの行の区切り（moyai-sheet）は無い
    expect(undone.slice(legend, at0)).not.toContain("moyai-sheet");

    // 答え直す：押せるが、つくった版には入っていないので出したまま
    await answerAll(ws);
    expect(ws.view.open).toEqual([]);
    expect(ws.uncomposed(plan.planId)).toBe(true);
    await loadSheets(ws, FILES[0]!);
    const again = page(ws, "files");
    expect(tags(again, "compose")).toHaveLength(1);
    expect(tags(again, "compose")[0]).not.toContain("disabled");
    expect(tags(again, "compose-disabled-reason")).toEqual([]);

    // つくり直すと、また出さない
    expect(ws.startCompose("human").started).toBe(true);
    await ws.whenComposed();
    expect(ws.compose.state).toBe("done");
    expect(ws.uncomposed(getWorkingPlan()!.plan.planId)).toBe(false);
    await loadSheets(ws, FILES[0]!);
    expect(tags(page(ws, "files"), "compose")).toEqual([]);
    at("#/merge");
  });

  test("変更の数え方：資料が無ければ無い。資料の追加は変更。版の資料と決定を戻した直後は無い。ほかの計画の版には、このタブの資料は入っていない", async () => {
    const empty = new IntakeWorkspace(settings);
    expect(empty.uncomposed("plan-x")).toBe(false);

    // 版の資料と決定を戻した直後（「＋ 次の版」）は、変更が無い
    const first = await composed();
    const planId = getWorkingPlan()!.plan.planId;
    const decisions = first.decisions();
    const ws = new IntakeWorkspace(settings);
    ws.pinPlanId(planId);
    await ws.restoreVersion(
      1,
      FILES.map((name) => ({ name, bytes: bytesOf(name) })),
      decisions,
    );
    expect(ws.view.open).toEqual([]);
    expect(ws.uncomposed(planId)).toBe(false);
    // ほかの計画の版を開いているとき、このタブの資料はその版に入っていない
    expect(ws.uncomposed("plan-other")).toBe(true);
    // 資料を足すと変更
    const daily = new Uint8Array(readFileSync("samples/out/waste-incineration/fictional-1/daily-report.csv"));
    await ws.addFiles([{ name: "daily-report.csv", size: daily.length, bytes: async () => daily }]);
    await ws.fresh();
    expect(ws.uncomposed(planId)).toBe(true);

    // このタブで作っても戻してもいない計画（版を開いただけ）には、資料があれば変更として出す
    const notComposed = await dropped();
    expect(notComposed.uncomposed(planId)).toBe(true);
  });
});

/** Web Locks の偽物（同じ名前の頼みは順に通す。drop は、持っている側が止まって lock が離れたこと） */
class FakeLocks implements AliveLocks {
  private readonly held = new Map<string, () => void>();
  private readonly waiting = new Map<string, (() => void)[]>();
  request(name: string, callback: () => unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const grant = () => {
        let release: () => void = () => undefined;
        const released = new Promise<void>((r) => (release = r));
        this.held.set(name, release);
        void released.then(() => {
          this.held.delete(name);
          this.waiting.get(name)?.shift()?.();
        });
        Promise.resolve()
          .then(callback)
          .then(
            (v) => {
              resolve(v);
              release();
            },
            (e: unknown) => {
              reject(e);
              release();
            },
          );
      };
      if (this.held.has(name)) this.waiting.set(name, [...(this.waiting.get(name) ?? []), grant]);
      else grant();
    });
  }
  holds(name: string): boolean {
    return this.held.has(name);
  }
  drop(name: string): void {
    this.held.get(name)?.();
  }
}
const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

describe("6 worker が起きたあとに止まったとき（見張りの lock）", () => {
  test("worker は lock を取ってから ready に名前を添える。主のスレッドは lock が離れるまで待ち、離れたら止まったとみなす", async () => {
    const locks = new FakeLocks();
    const held = vi.fn();
    holdAlive(locks, "alive-1", held);
    await ticks();
    expect(held).toHaveBeenCalledWith("alive-1");
    expect(locks.holds("alive-1")).toBe(true);
    const gone = vi.fn();
    watchAlive(locks, "alive-1", gone);
    // 重い処理で答えないあいだも lock は持ったまま（時間では決めない）
    await ticks(20);
    expect(gone).not.toHaveBeenCalled();
    locks.drop("alive-1");
    await ticks();
    expect(gone).toHaveBeenCalledTimes(1);
  });

  test("Web Locks が無い・取れないときは、見張りなしで ready（名前を添えない）", async () => {
    const held = vi.fn();
    holdAlive(undefined, "alive-2", held);
    expect(held).toHaveBeenCalledWith(null);
    const refused = vi.fn();
    holdAlive({ request: () => Promise.reject(new Error("SecurityError")) }, "alive-3", refused);
    await ticks();
    expect(refused).toHaveBeenCalledWith(null);
    const gone = vi.fn();
    watchAlive(undefined, "alive-4", gone);
    await ticks();
    expect(gone).not.toHaveBeenCalled();
  });

  test("止まったら、待っている答えを誤りで終え、そのあとの要求も受けない。下の帯に「取り込み停止」（停止箇所は取り込み処理（応答なし））", async () => {
    let gone: () => void = () => undefined;
    let on: (m: { kind: "ready" }) => void = () => undefined;
    const sent: unknown[] = [];
    const port: IntakePort = {
      post: (msg) => void sent.push(msg),
      listen: (o, _fail, g) => {
        on = o;
        gone = g;
      },
    };
    const engine = new WorkerEngine(port, null);
    const faults: EngineFault[] = [];
    engine.onFault((f) => faults.push(f));
    clearWorkingPlan();
    const ws = new IntakeWorkspace(settings, engine);
    on({ kind: "ready" });
    // 答えの来ない要求（worker が答える前に止まった）
    const waiting = engine.request({ op: "view" }, 0);
    expect(sent.length).toBeGreaterThan(0);
    gone();
    await expect(waiting).rejects.toThrow("取り込みの worker が止まった");
    await expect(engine.request({ op: "view" }, 0)).rejects.toThrow("取り込みの worker が止まった");
    expect(() => engine.post({ op: "touch" }, 0)).not.toThrow();
    // 2 回目は知らせない
    gone();
    expect(faults).toEqual(["failed"]);
    expect(ws.notices.map((n) => n.text)).toEqual([TEXT.intake.workerStopped]);
    expect(stopNotices(ws.notices).stopped).toHaveLength(1);
    const html = page(ws, null);
    expect(textsOf(html, "stop-worker")).toEqual(["取り込み停止"]);
    const detail = textsOf(render(<StopNoticeDetail notices={ws.notices} kind="stopped" />), "stop-record");
    expect(detail).toHaveLength(1);
    expect(detail[0]).toContain(`処理　${TEXT.intake.stop.whatWorker}`);
    expect(detail[0]).toContain(`停止箇所　${TEXT.intake.stop.whereStopped}`);
    expect(TEXT.intake.stop.whereStopped).toBe("取り込み処理（応答なし）");
  });

  test("起きる前に落ちて同じスレッドで続けているときは、止まったとみなさない（知らせは再起動の 1 つだけ）", async () => {
    let fail: () => void = () => undefined;
    let gone: () => void = () => undefined;
    const port: IntakePort = {
      post: () => undefined,
      listen: (_o, f, g) => {
        fail = f;
        gone = g;
      },
    };
    const engine = new WorkerEngine(port, () => new IntakeHost());
    const faults: EngineFault[] = [];
    engine.onFault((f) => faults.push(f));
    const ws = new IntakeWorkspace(settings, engine);
    fail();
    gone();
    expect(faults).toEqual(["fallback"]);
    expect(ws.notices.map((n) => n.text)).toEqual([TEXT.intake.workerFallback]);
    // 同じスレッドの受け手が答える
    await expect(engine.request({ op: "view" }, 0)).resolves.toBeTruthy();
  });
});
