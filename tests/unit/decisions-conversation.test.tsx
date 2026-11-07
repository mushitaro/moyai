// 確定のシートの会話の回答の受け方（docs/screens.md 3.2「会話の回答の受け方」、Wire、11-07。仕事 decisions-sheet-v1）：
// 1 種類で「会話の回答」を選んでいるときは「判断の理由」の欄を出さず、上の行は「| 会話の回答 n 件を確定」だけ（押せる）。行ごとの「| 確定」「| 却下」も押せる。
// 2 「Claude 判断」は今どおり：判断の理由の欄と「| 表示中の n 件を一括確定」。理由が空のあいだは押せず「理由：判断の理由が未入力」。
// 3 件数：取り込みの質問の答えは「n 行」（横の板の質問の「n 行」と同じ字）。数のある行が 1 つも無ければ件数の列を出さない。「—」を並べない。
// 4 「理由」の列は 1 行で切り、全文は title。「| 却下」「| 確定」の列は右端に固定。
// 5 版の記録に入る理由は、Claude が置いた理由（会話の回答の理由）のまま。
// 6 1 段目の Skill の取り込みの手順の最後に、会話で確定を頼む 1 行。
// 画面は react-dom/server で描く（試験は node で走る。押す操作は、画面の部品と同じ関数 acceptDecisionsAs で確かめる）。計画は架空。
import { readFileSync } from "node:fs";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test } from "vitest";
import { DecisionsView, acceptDecisionsAs, relayedReason } from "../../src/app/components/DecisionsSheet";
import { acceptedList, clearAccepted } from "../../src/app/state/decisions";
import { HUMAN_TEXT, TEXT } from "../../src/app/text";
import { proposeCycles } from "../../src/plan/cycle";
import { pendingDecisions, type Decision } from "../../src/plan/diff";
import type { Plan } from "../../src/shared/plan";
import type { Rule } from "../../src/shared/tools";
import { skillMoyaiMarkdown } from "../../src/shared/skill-moyai";
import { asset, detail, plan, work } from "./share/fixtures";

const T = HUMAN_TEXT.decisions;
type Author = "ai" | "ai_relayed_human";

const READING_REASON = "利用者がチャットで、年の列は年度で読むと答えた";
const CYCLE_BASIS = "利用者が会話で、分解整備は 4 年ごとと言った";

/** 取り込みの質問の答え（読み方の決定）1 つと、台帳を照らしていない周期の案 1 つ（作者は同じ） */
function planOf(author: Author, rows = 12): Plan {
  const base: Plan = {
    ...plan({
      assets: [asset("a1", "T.FEED.LIFT", { name: "押込送風機" })],
      works: [work("w1", "OVERHAUL", ["a1"])],
      details: [detail("d1", "w1", 2018), detail("d2", "w1", 2022), detail("d3", "w1", 2032, { planOrActual: "plan" })],
    }),
    readingDecisions: [{ questionId: "q-year", kind: "yearKind", question: "年の列は年度か暦年か", answer: "年度", author, reason: READING_REASON, rows, details: [] }],
  };
  const rule: Rule = { when: [{ field: "assetNode.name", op: "in", values: ["押込送風機"] }], set: { field: "work.trigger", value: 4 }, reason: "利用者の言葉" };
  const r = proposeCycles(base, [rule], { nextId: () => "C1", basis: CYCLE_BASIS, fromLedger: false, author });
  if (!r.ok) throw new Error(r.code);
  return r.plan;
}

function render(node: ReactNode): string {
  return renderToStaticMarkup(<MantineProvider>{node}</MantineProvider>);
}
function sheet(p: Plan, pending: readonly Decision[] = pendingDecisions(p, [])): string {
  return render(<DecisionsView plan={p} pending={pending} ready />);
}
/** 開きタグ（data-testid で探す） */
function tags(html: string, testid: string): string[] {
  return [...html.matchAll(new RegExp(`<[a-z][a-z0-9]*[^>]*data-testid="${testid}"[^>]*>`, "g"))].map((m) => m[0]);
}
function attr(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}
/** data-testid の要素の中の字（同じ名前のタグの入れ子を数えて閉じタグまで。タグは除く） */
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
/** 受けていない行の表（decisions-table）の行ごとの、セルの開きタグ（th・td） */
function tableRows(html: string): string[][] {
  const start = html.indexOf('data-testid="decisions-table"');
  expect(start).toBeGreaterThan(0);
  const table = html.slice(start, html.indexOf("</table>", start));
  return [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((m) => [...m[1]!.matchAll(/<t[hd](?=[\s>])[^>]*>/g)].map((c) => c[0]));
}
const isDisabled = (tag: string) => attr(tag, "disabled") !== null;

afterEach(() => clearAccepted());

describe("1 会話の回答は判断の理由なしで受ける", () => {
  test("判断の理由の欄を出さず、上の行は「| 会話の回答 n 件を確定」だけで、押せる", () => {
    const html = sheet(planOf("ai_relayed_human"));
    expect(attr(tags(html, "decisions-sheet")[0]!, "data-kind")).toBe("relayed");
    expect(tags(html, "decisions-reason")).toEqual([]);
    expect(tags(html, "decisions-bulk-reason")).toEqual([]);
    // 上の行（種類の切り替えより上）に「判断の理由」の字が無い（下の「人が直に当てる」は別の欄）
    expect(html.slice(0, html.indexOf('data-testid="decisions-kind"'))).not.toContain(T.reasonLabel);
    const bulk = tags(html, "decisions-bulk-accept");
    expect(bulk).toHaveLength(1);
    expect(isDisabled(bulk[0]!)).toBe(false);
    // 行は 2 つ（取り込みの質問の答え・周期の案 C1）
    expect(textsOf(html, "decisions-bulk-accept")).toEqual([T.relayedAccept(2)]);
    expect(T.relayedAccept(2)).toBe("会話の回答 2 件を確定");
    expect(html).not.toContain("表示中の");
  });

  test("行ごとの「| 確定」も理由なしで押せる。「| 却下」も押せる（理由は却下のダイアログで書く）", () => {
    const html = sheet(planOf("ai_relayed_human"));
    const accept = tags(html, "pending-accept");
    expect(accept).toHaveLength(2);
    for (const b of accept) {
      expect(isDisabled(b)).toBe(false);
      expect(attr(b, "title")).toBeNull();
    }
    const reject = tags(html, "pending-reject");
    expect(reject).toHaveLength(1);
    expect(isDisabled(reject[0]!)).toBe(false);
  });

  test("受けると、版の記録に入る理由は Claude が置いた理由のまま。受けた行は下にたたみ、種類の切り替えから消える", () => {
    const p = planOf("ai_relayed_human");
    const pending = pendingDecisions(p, []);
    // 判断の理由は空のまま押す
    expect(acceptDecisionsAs("relayed", pending, "")).toBe(pending.length);
    const byId = new Map(acceptedList().map((a) => [a.id, a.reason]));
    expect(byId.size).toBe(pending.length);
    for (const d of pending) expect(byId.get(d.id)).toBe(d.basis);
    expect(byId.get("reading:q-year")).toBe(READING_REASON);
    expect([...byId.entries()].filter(([id]) => id.startsWith("detail:")).every(([, r]) => r.startsWith(CYCLE_BASIS))).toBe(true);
    const after = sheet(p, pending);
    expect(tags(after, "decisions-kind")).toEqual([]);
    expect(tags(after, "decisions-table")).toEqual([]);
    const done = tags(after, "pending-row");
    expect(done).toHaveLength(2);
    expect(done.every((t) => attr(t, "data-accepted") === "true")).toBe(true);
  });

  test("Claude が置いた理由が無いときは種類の名前。500 字を越える分は切る", () => {
    expect(relayedReason("  利用者が答えた  ")).toBe("利用者が答えた");
    expect(relayedReason("")).toBe(T.kinds.relayed);
    expect(relayedReason("あ".repeat(600))).toHaveLength(500);
  });
});

describe("2 Claude 判断は今どおり判断の理由が要る", () => {
  test("判断の理由の欄と「| 表示中の n 件を一括確定」。理由が空のあいだは押せず、押せない理由は「理由：判断の理由が未入力」", () => {
    const html = sheet(planOf("ai"));
    expect(attr(tags(html, "decisions-sheet")[0]!, "data-kind")).toBe("ai");
    expect(tags(html, "decisions-reason")).toHaveLength(1);
    const bulk = tags(html, "decisions-bulk-accept");
    expect(textsOf(html, "decisions-bulk-accept")).toEqual([T.visibleAccept(2)]);
    expect(isDisabled(bulk[0]!)).toBe(true);
    expect(textsOf(html, "decisions-bulk-reason")).toEqual(["理由：判断の理由が未入力"]);
    const accept = tags(html, "pending-accept");
    expect(accept).toHaveLength(2);
    for (const b of accept) {
      expect(isDisabled(b)).toBe(true);
      expect(attr(b, "title")).toBe("理由：判断の理由が未入力");
    }
    expect(tags(html, "pending-reject").every(isDisabled)).toBe(true);
  });

  test("判断の理由が空なら受けない。書けば、その理由で受ける", () => {
    const pending = pendingDecisions(planOf("ai"), []);
    expect(acceptDecisionsAs("ai", pending, "  ")).toBe(0);
    expect(acceptedList()).toEqual([]);
    expect(acceptDecisionsAs("ai", pending, "画面で見て受けた")).toBe(pending.length);
    expect(acceptedList().every((a) => a.reason === "画面で見て受けた")).toBe(true);
  });
});

describe("3 件数", () => {
  test("取り込みの質問の答えは、その答えで決まった行の数を「n 行」（横の板の質問の「n 行」と同じ字）。「—」「―」を並べない", () => {
    const html = sheet(planOf("ai_relayed_human", 37));
    expect(tags(html, "decisions-count-head")).toHaveLength(1);
    const counts = textsOf(html, "pending-count");
    expect(counts).toContain(TEXT.intake.questions.rows(37));
    expect(TEXT.intake.questions.rows(37)).toBe("37 行");
    for (const c of counts) expect(c).not.toMatch(/[—―]/);
    // 周期の案は今どおり星取の数
    const cycle = tags(html, "pending-row").findIndex((t) => attr(t, "data-cycle") === "C1");
    expect(cycle).toBeGreaterThanOrEqual(0);
    expect(counts[cycle]).toMatch(/^\d+$/);
  });

  test("表示中の種類に数のある行が 1 つも無ければ、件数の列を出さない（見出しも、行のセルも）", () => {
    const p = planOf("ai_relayed_human");
    // 数の無い行だけの種類：行の数を持たない取り込みの質問の答え
    const pending = pendingDecisions(p, [])
      .filter((d) => d.kind === "reading")
      .map((d) => ({ ...d, rows: undefined }));
    expect(pending).toHaveLength(1);
    const html = sheet(p, pending);
    expect(tags(html, "decisions-count-head")).toEqual([]);
    expect(tags(html, "pending-count")).toEqual([]);
    expect(html).not.toContain(`>${T.head[2]}<`);
    const rows = tableRows(html);
    // 見出しと 1 行。どちらも 項目｜理由｜確定 の 3 列
    expect(rows.map((r) => r.length)).toEqual([3, 3]);
  });
});

describe("4 理由の列と、却下・確定の列", () => {
  const css = readFileSync("src/app/theme.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
  const bodyOf = (sel: string) => rules.filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel)).map((r) => r.body).join("\n");

  test("「| 却下」「| 確定」の列は、どの行でも右端のセルで、右端に固定する（横に送っても隠れない）", () => {
    for (const author of ["ai_relayed_human", "ai"] as const) {
      const rows = tableRows(sheet(planOf(author)));
      expect(rows.length).toBe(3);
      for (const cells of rows) expect(attr(cells.at(-1)!, "class") ?? "").toContain("moyai-decisions-act");
    }
    const act = bodyOf(".moyai-decisions-act");
    expect(act).toMatch(/position:\s*sticky/);
    expect(act).toMatch(/right:\s*0/);
    expect(act).toMatch(/white-space:\s*nowrap/);
    expect(act).toMatch(/background:\s*var\(--bg\)/);
    expect(bodyOf(".moyai-decisions-scroll")).toMatch(/overflow-x:\s*auto/);
  });

  test("「理由」は 1 行で切り、全文は title", () => {
    const html = sheet(planOf("ai_relayed_human"));
    const why = tags(html, "pending-why");
    expect(why).toHaveLength(2);
    for (const t of why) expect(attr(t, "class") ?? "").toContain("moyai-decisions-why");
    expect(why.map((t) => attr(t, "title"))).toContain(READING_REASON);
    const cut = bodyOf(".moyai-decisions-why");
    expect(cut).toMatch(/white-space:\s*nowrap/);
    expect(cut).toMatch(/overflow:\s*hidden/);
    expect(cut).toMatch(/text-overflow:\s*ellipsis/);
  });
});

describe("5 シートに説明の 1 行を置かず、1 段目の Skill で会話から確定を頼む", () => {
  test("取り込みの手順（利用者の資料）の最後の 1 行：会話で「確定のシートで会話の回答 n 件を確定してください」と伝える。確定は人が画面でする", () => {
    const md = skillMoyaiMarkdown();
    const section = md.slice(md.indexOf("### 利用者の資料"), md.indexOf("### アンインストール"));
    const steps = section.split("\n").filter((l) => /^\d+\. /.test(l));
    const last = steps.at(-1)!;
    expect(last.startsWith(`${steps.length}. `)).toBe(true);
    expect(last).toContain("「確定のシートで会話の回答 n 件を確定してください」");
    expect(last).toContain("確定は人が画面でする。Claude は押さない。");
    expect(readFileSync("skills/moyai/SKILL.md", "utf8").replace(/\r\n/g, "\n")).toContain(last);
    // シートには説明の文を置かない
    const html = sheet(planOf("ai_relayed_human"));
    expect(html).not.toContain(T.lead);
  });
});
