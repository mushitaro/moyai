// 会話の繰り返しで詰めるときの、ルールと問いの穴の直し（仕事 loop-fixes-v1。docs/progress/conversation-loop-2026-11-08.md）。
// 1 行の役割の prefix は行のいちばん左のセルだけ・当たった行と資料の数・読めていたセルを多く外したら note
// 2 資料を丸ごと外す決まった答えは when.file で指したときだけ効く・どの資料も外したときの止める理由にルールの id
// 3 下書きのルールを remove で外す 4 intake_survey の part と資料の一覧の limit 5 計画を作った結果の、資料ごとの新しい機器の節の数と同じ名前の節の知らせ。
// 資料はどれも試験の中で組む架空のもの。
import { afterEach, describe, expect, test } from "vitest";
import { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { WorkerEngine, sameThreadPort } from "../../../src/app/intake/engine";
import { runTabTool, runTabToolAsync, type TabToolResult } from "../../../src/app/intake/tab-tools";
import { clearWorkingPlan } from "../../../src/app/state/plan-store";
import { READING_SCHEMA, type LoadedReading, type ReadingRule } from "../../../src/import/reading";
import { newNodesOf, sameNameNote, SAME_NAME_NODES_MIN } from "../../../src/plan/new-nodes";
import { READING_DROP_NOTE_MIN, SURVEY_FILES_DEFAULT, TOOLS } from "../../../src/shared/tools";
import type { Plan } from "../../../src/shared/plan";
import { acceptDefaults, session } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
const CTX = { conversation: "c-loop", rowsRemaining: 2000 };
const base = { author: "ai" as const, reason: "試験" };
const draft = (rules: ReadingRule[], o: Partial<LoadedReading> = {}): LoadedReading => ({
  skill: { schema: READING_SCHEMA, name: "【架空】甲浜の読み方", scope: "facility", rules },
  version: "",
  path: null,
  approved: false,
  draft: true,
  ...o,
});

/** 頁の頭書き（「【架空】」で始まる施設の名前の行）が 10 行ごとに入る作業の一覧。業者の列にも「【架空】」で始まる名前がある */
function dailyLines(rows: number): string[] {
  const lines = ["日付,機器,作業,工数(h),業者"];
  for (let i = 0; i < rows; i++) {
    if (i % 10 === 0) lines.push("【架空】甲浜クリーンセンター,,,,");
    lines.push(`2024/4/${(i % 28) + 1},ポンプ${i % 5},点検,${(i % 4) + 1},【架空】乙山工業`);
  }
  return lines;
}
const ledger = csv(["名称,系列", ...[0, 1, 2, 3, 4].map((i) => `ポンプ${i},1号`)]);
/** 役目の決まりにくい欄の多い資料（参考として外すかの問いの的） */
const memo = (k: string) => csv(["機器,甲欄,乙欄,丙欄", ...Array.from({ length: 6 }, (_, i) => `ポンプ${i},${k}あ${i},${k}い${i},${k}う${i}`)]);
const REF_MATCH = "は、今回は参考として計画に使わないか";

const SETTINGS = { packId: "waste-incineration", facilityName: "【架空】甲浜クリーンセンター", fiscalYearStartMonth: 4, fictional: true };
function workspace(): IntakeWorkspace {
  return new IntakeWorkspace(SETTINGS);
}

async function add(ws: IntakeWorkspace, files: { name: string; bytes: Uint8Array }[]): Promise<void> {
  await ws.addFiles(files.map((f) => ({ name: f.name, size: f.bytes.length, bytes: async () => f.bytes })));
}

/** 既定の答えのある質問に、AI がチャットの人の答えとして答える（無くなるまで） */
function acceptAll(ws: IntakeWorkspace): void {
  for (let i = 0; i < 10; i++) {
    const open = ws.analysis().open.filter((q) => q.defaultAnswer !== null && !q.decision);
    if (!open.length) return;
    const r = ws.settle(open.map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer!, author: "ai_relayed_human" as const, reason: "試験" })));
    expect(r.ok).toBe(true);
  }
}

function ok(r: TabToolResult): any {
  if (!r.ok) throw new Error(`誤り：${r.code}`);
  return r.data;
}

const statusAt = (ws: IntakeWorkspace, file: string, ref: string) => ws.analysis().composition.status.get(`${file}\u00000\u0000${ref}`)?.s;

afterEach(() => clearWorkingPlan());

describe("1. 行の役割のルール：prefix は行のいちばん左のセルだけ", () => {
  test("prefix は行の頭のセルと比べ、ほかの列の字（業者の名前）には当たらない。丸ごとの一致はどのセルでもよい。当たった行と資料を数える", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: csv(dailyLines(30)) },
    ]);
    acceptDefaults(s);
    const dataBefore = [...s.analyze().composition.status.values()].filter((v) => v.s === "data").length;
    s.setReadings([draft([{ ...base, id: "p1", text: "「【架空】」で始まる行は頁の頭書きとして外す", kind: "rowRole", match: "【架空】", prefix: true, role: "note" }])]);
    let an = s.analyze();
    const t = an.layouts.find((l) => l.file === "日報.csv")!.tables[0]!;
    // 頁の頭書きの 3 行だけに当たり、業者の列に「【架空】乙山工業」のある作業の 30 行には当たらない
    expect(an.ruleHits.rows("p1")).toBe(3);
    expect(an.ruleHits.files("p1")).toBe(1);
    expect(t.rows.filter((r) => r.role === "data").length).toBe(30);
    expect([...an.composition.status.values()].filter((v) => v.s === "data").length).toBe(dataBefore);
    // 丸ごとの一致（prefix なし）は、今までどおり行のどのセルでもよい
    s.setReadings([draft([{ ...base, id: "e1", text: "「【架空】乙山工業」の行は注記", kind: "rowRole", match: "【架空】乙山工業", role: "note" }])]);
    an = s.analyze();
    expect(an.ruleHits.rows("e1")).toBe(30);
    expect(an.ruleHits.count("e1")).toBe(150);
  });

  test("reading_rules_propose：ルールごとの行と資料の数を返し、読めていたデータのセルを 1,000 以上外したルールは note に書く", async () => {
    const ws = workspace();
    await add(ws, [
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: csv(dailyLines(250)) },
    ]);
    acceptAll(ws);
    expect(ws.view.unresolvedCells).toBe(0);
    const name = "【架空】甲浜の読み方";
    const p = ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [{ ...base, id: "p1", text: "「【架空】」で始まる行は頁の頭書き", kind: "rowRole", match: "【架空】", prefix: true, role: "note" }] }, CTX));
    expect(TOOLS.reading_rules_propose.output.safeParse(p).success).toBe(true);
    expect(p.rules).toEqual([{ id: "p1", text: "「【架空】」で始まる行は頁の頭書き", hits: 25, rows: 25, files: 1 }]);
    expect(p.note).toBeUndefined();
    expect(p.unresolvedCells).toBe(0);
    expect(statusAt(ws, "日報.csv", "E3")).toBe("data");

    // 業者の名前の字の同じ行を外す：作業の 250 行（5 セルずつ）が、読めていたデータから外れる
    const e = ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [{ ...base, id: "e1", text: "「【架空】乙山工業」の行は注記", kind: "rowRole", match: "【架空】乙山工業", role: "note" }] }, CTX));
    expect(TOOLS.reading_rules_propose.output.safeParse(e).success).toBe(true);
    expect(e.rules.find((r: any) => r.id === "e1")).toEqual({ id: "e1", text: "「【架空】乙山工業」の行は注記", hits: 1250, rows: 250, files: 1 });
    expect(1250).toBeGreaterThanOrEqual(READING_DROP_NOTE_MIN);
    expect(e.note).toContain("ルール e1 が読めていた 1,250 セルを外した");
    // 前に置いた p1 は、この呼び出しで置いたものではないので、外した数に書かない
    expect(e.note).not.toContain("ルール p1");
    expect(statusAt(ws, "日報.csv", "E3")).not.toBe("data");
  });

  test("worker の形でも、同じスレッドと同じ答え（行と資料の数・外した数の note・外した id）", async () => {
    const run = async (ws: IntakeWorkspace) => {
      await add(ws, [
        { name: "台帳.csv", bytes: ledger },
        { name: "日報.csv", bytes: csv(dailyLines(250)) },
      ]);
      for (let i = 0; i < 10; i++) {
        await ws.fresh();
        const v = ws.view;
        const ds = v.questions
          .filter((q) => v.open.includes(q.questionId) && q.defaultAnswer !== null)
          .map((q) => ({ questionId: q.questionId, answer: q.defaultAnswer!, author: "ai_relayed_human" as const, reason: "試験" }));
        if (!ds.length) break;
        expect((await ws.settleAsync(ds)).ok).toBe(true);
      }
      const name = "【架空】甲浜の読み方";
      const placed = ok(await runTabToolAsync(ws, "reading_rules_propose", { name, scope: "facility", rules: [{ ...base, id: "e1", text: "「【架空】乙山工業」の行は注記", kind: "rowRole", match: "【架空】乙山工業", role: "note" }] }, CTX));
      const removed = ok(await runTabToolAsync(ws, "reading_rules_propose", { name, scope: "facility", remove: ["e1"] }, CTX));
      return [placed, removed];
    };
    const same = await run(workspace());
    const worker = await run(new IntakeWorkspace(SETTINGS, new WorkerEngine(sameThreadPort())));
    expect(worker).toEqual(same);
    expect(same[0].note).toContain("ルール e1 が読めていた 1,250 セルを外した");
    expect(same[1]).toMatchObject({ removed: ["e1"], rules: [], unresolvedCells: 0 });
  });

  test("ツールの説明に rowRole の当たり方（丸ごとはどのセルでも、prefix は行の頭のセル）がある", () => {
    const d = TOOLS.reading_rules_propose.description;
    expect(d).toContain("prefix なしなら行のどのセルでも字が丸ごと同じなら当たり、prefix: true なら行のいちばん左の字のあるセルの頭だけと比べる");
  });
});

describe("2. 資料を丸ごと外す決まった答え", () => {
  const refRule = (when?: ReadingRule["when"]): ReadingRule => ({ ...base, id: "a-ref", text: "参考として計画に使わない", kind: "answer", question: "stray", match: REF_MATCH, answer: "reference", ...(when ? { when } : {}) });
  const three = [
    { name: "雑記A.csv", bytes: memo("甲") },
    { name: "雑記B.csv", bytes: memo("乙") },
    { name: "雑記C.csv", bytes: memo("丙") },
  ];
  const referenced = (s: ReturnType<typeof session>) =>
    [...new Set([...s.analyze().composition.status.entries()].filter(([, v]) => v.s === "excluded" && v.reason === "参考の資料").map(([k]) => k.split("\u0000")[0]))].sort();

  test("when.file の無いものは、どの資料にも効かない。when.file で指した資料だけを外す", async () => {
    const s = session();
    await s.add(three);
    s.setReadings([draft([refRule()])]);
    expect(referenced(s)).toEqual([]);
    expect([...s.analyze().ruleAnswers.values()]).not.toContain("a-ref");
    s.setReadings([draft([refRule({ file: "雑記A*" })])]);
    expect(referenced(s)).toEqual(["雑記A.csv"]);
    const an = s.analyze();
    expect([...an.ruleAnswers.values()]).toEqual(["a-ref"]);
    expect(an.questions.find((q) => an.ruleAnswers.get(q.questionId) === "a-ref")?.decision?.author).toBe("rule_code");
  });

  test("どの資料も外したときは、止める理由に外したルールの id を添える", async () => {
    const s = session();
    await s.add(three);
    s.setReadings([draft([refRule({ file: "雑記*.csv" })])]);
    expect(referenced(s)).toEqual(["雑記A.csv", "雑記B.csv", "雑記C.csv"]);
    const c = s.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers).toContain("計画に使う資料が無い（どの資料も参考として外した 3。外したルール：a-ref）");
  });

  test("reading_rules_propose：when.file の無いものは置いても効かず note で知らせる。when.file は置け、見出しの when は断る。intake_compose は id を添えて止める", async () => {
    const ws = workspace();
    await add(ws, three);
    const name = "【架空】甲浜の読み方";
    const r0 = ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [refRule()] }, CTX));
    expect(r0.note).toContain("資料を丸ごと外す答えは、when.file で資料を指してください");
    expect(r0.rules[0]).toMatchObject({ id: "a-ref", hits: 0, rows: 0, files: 0 });
    expect(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [refRule({ file: "雑記*", headers: ["甲欄"] })] }, CTX)).toEqual({ ok: false, code: "reading_when_ignored" });
    // ほかの決まった答えの when は、今までどおり断る
    expect(
      runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [{ ...base, id: "a2", text: "x", kind: "answer", question: "assetLink", match: "結ぶか", answer: "yes", when: { file: "雑記A*" } }] }, CTX),
    ).toEqual({ ok: false, code: "reading_when_ignored" });
    const r1 = ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [refRule({ file: "雑記*" })] }, CTX));
    expect(TOOLS.reading_rules_propose.output.safeParse(r1).success).toBe(true);
    expect(r1.note ?? "").not.toContain("when.file で資料を指してください");
    expect(r1.rules[0]).toMatchObject({ id: "a-ref", rows: 3 * 7, files: 3 });
    ok(runTabTool(ws, "intake_compose", {}, CTX));
    await ws.whenComposed();
    const c = ok(runTabTool(ws, "intake_survey", { part: "compose" }, CTX)).compose;
    expect(c.state).toBe("failed");
    expect(c.message).toContain("外したルール：a-ref");
  });

  test("ツールの説明に、資料を丸ごと外す答えは when.file で指すことがある", () => {
    expect(TOOLS.reading_rules_propose.description).toContain("資料を丸ごと外す決まった答え（answer が reference・reject）だけは when.file で資料を指したときだけ効き");
  });
});

describe("3. 下書きのルールを remove で外す", () => {
  test("外した id を返し、読み直すとそのルールの効きが消える。下書きに無い id と承認済みのルールは外せない", async () => {
    const ws = workspace();
    await add(ws, [
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.csv", bytes: csv(dailyLines(30)) },
    ]);
    acceptAll(ws);
    const name = "【架空】甲浜の読み方";
    const e1 = { ...base, id: "e1", text: "「【架空】乙山工業」の行は注記", kind: "rowRole", match: "【架空】乙山工業", role: "note" };
    const keep = { ...base, id: "k1", text: "「【架空】」で始まる行は頁の頭書き", kind: "rowRole", match: "【架空】", prefix: true, role: "note" };
    ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [e1, keep] }, CTX));
    expect(ws.view.ruleHits.e1?.count).toBe(150);
    expect(statusAt(ws, "日報.csv", "E3")).not.toBe("data");

    const r = ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", remove: ["e1", "nope"] }, CTX));
    expect(TOOLS.reading_rules_propose.output.safeParse(r).success).toBe(true);
    expect(r.removed).toEqual(["e1"]);
    expect(r.rules.map((x: any) => x.id)).toEqual(["k1"]);
    expect(r.note).toContain("下書きに無いので外していない id：nope");
    expect(ws.draftReading(name)?.skill.rules.map((x) => x.id)).toEqual(["k1"]);
    expect(ws.view.ruleHits.e1).toBeUndefined();
    expect(ws.analysis().ruleHits.count("e1")).toBe(0);
    expect(statusAt(ws, "日報.csv", "E3")).toBe("data");
    expect(r.unresolvedCells).toBe(0);

    // 残りを外すと、下書きの読み方ごと無くなる
    const last = ok(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", remove: ["k1"] }, CTX));
    expect(last.removed).toEqual(["k1"]);
    expect(last.rules).toEqual([]);
    expect(ws.draftReading(name)).toBeNull();

    // 承認済み（保管先の versions/）のルールは外せない
    ws.setApprovedReadings([
      draft([{ ...e1, id: "ok1" } as ReadingRule], { skill: { schema: READING_SCHEMA, name: "【架空】承認済み", scope: "facility", rules: [{ ...e1, id: "ok1" } as ReadingRule] }, version: "a1b2c3d4", path: "skills/x", approved: true, draft: false, owner: ws.facilityKey() }),
    ]);
    expect(ws.view.ruleHits.ok1?.count).toBe(150);
    const ng = ok(runTabTool(ws, "reading_rules_propose", { name: "【架空】承認済み", scope: "facility", remove: ["ok1"] }, CTX));
    expect(ng.removed).toEqual([]);
    expect(ng.note).toContain("下書きに無いので外していない id：ok1");
    expect(ws.view.ruleHits.ok1?.count).toBe(150);
  });

  test("rules も remove も空、同じ id を両方に書いたものは型で断る", () => {
    const ws = workspace();
    const name = "【架空】甲浜の読み方";
    const r = { ...base, id: "e1", text: "x", kind: "rowRole", match: "x", role: "note" };
    expect(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [] }, CTX)).toEqual({ ok: false, code: "tool_failed" });
    expect(runTabTool(ws, "reading_rules_propose", { name, scope: "facility", rules: [r], remove: ["e1"] }, CTX)).toEqual({ ok: false, code: "tool_failed" });
    expect(TOOLS.reading_rules_propose.input.safeParse({ name, scope: "facility", remove: Array.from({ length: 51 }, (_, i) => `r${i}`) }).success).toBe(false);
  });
});

describe("4. intake_survey の part と資料の一覧", () => {
  test("資料の一覧は part: all か files のときだけ、limit（既定 20）まで。全部の数は filesTotal、part: files は cursor で続きを読む", async () => {
    const ws = workspace();
    const names = Array.from({ length: 23 }, (_, i) => `台帳${String(i + 1).padStart(2, "0")}.csv`);
    await add(
      ws,
      names.map((n, i) => ({ name: n, bytes: csv(["名称,系列", `【架空】機器${i},1号`]) })),
    );
    const out = TOOLS.intake_survey.output;
    const all = ok(runTabTool(ws, "intake_survey", {}, CTX));
    expect(out.safeParse(all).success).toBe(true);
    expect(all.files.length).toBe(SURVEY_FILES_DEFAULT);
    expect(all.filesTotal).toBe(23);
    const one = ok(runTabTool(ws, "intake_survey", { limit: 1 }, CTX));
    expect(one.files.map((f: any) => f.fileRef)).toEqual([names[0]]);
    expect(one.filesTotal).toBe(23);
    for (const part of ["questions", "compose", "crosswalk"]) {
      const d = ok(runTabTool(ws, "intake_survey", { part, limit: 1 }, CTX));
      expect(out.safeParse(d).success, part).toBe(true);
      expect(d.files, part).toEqual([]);
      expect(d.filesTotal, part).toBe(23);
    }
    const rest = ok(runTabTool(ws, "intake_survey", { part: "files", cursor: 20 }, CTX));
    expect(out.safeParse(rest).success).toBe(true);
    expect(rest.files.map((f: any) => f.fileRef)).toEqual(names.slice(20));
    expect(rest.questions).toEqual([]);
    expect(rest.samples).toEqual([]);
    expect(TOOLS.intake_survey.input.safeParse({ part: "files" }).success).toBe(true);
    expect(TOOLS.intake_survey.description).toContain("filesTotal");
  });
});

describe("5. 計画を作った結果の、資料ごとの新しい機器の節", () => {
  const node = (name: string, file: string, parentKey: string | null, i: number) =>
    ({ nodeKey: `n-${file}-${i}`, name, parentKey, sources: [{ file, sheet: null, page: null, cell: `A${i + 1}`, box: null }] }) as unknown as Plan["assets"][number];

  test("節ができた資料は、出どころのうち入れた順でいちばん先の資料。同じ名前の節が 20 以上の資料を知らせる", () => {
    const assets = [
      ...Array.from({ length: 5 }, (_, i) => node(`【架空】機器${i}`, "一.csv", null, i)),
      // 二つめの資料にも出る機器（先の資料で数える）
      { ...node("【架空】機器0", "二.pdf", null, 99), sources: [{ file: "二.pdf", sheet: null, page: 1, cell: "A1", box: null }, { file: "一.csv", sheet: null, page: null, cell: "A1", box: null }] },
      ...Array.from({ length: SAME_NAME_NODES_MIN + 5 }, (_, i) => node("【架空】甲浜クリーンセンター", "二.pdf", `p${i}`, i)),
      ...Array.from({ length: SAME_NAME_NODES_MIN - 1 }, (_, i) => node("【架空】表の題", "三.pdf", `q${i}`, i)),
      { ...node("出どころの無い節", "一.csv", null, 0), sources: [] },
    ];
    const n = newNodesOf({ assets }, ["一.csv", "二.pdf", "三.pdf"]);
    expect(n.byFile).toEqual([
      { fileRef: "二.pdf", nodes: 25 },
      { fileRef: "三.pdf", nodes: 19 },
      { fileRef: "一.csv", nodes: 6 },
    ]);
    expect(n.sameName).toEqual([{ fileRef: "二.pdf", name: "【架空】甲浜クリーンセンター", nodes: 25 }]);
    expect(sameNameNote(n.sameName)).toContain("二.pdf の「【架空】甲浜クリーンセンター」25");
    expect(sameNameNote([])).toBeNull();
    // 上位 10 資料まで
    const many = Array.from({ length: 12 }, (_, i) => node(`x${i}`, `f${i}.csv`, null, i));
    expect(newNodesOf({ assets: many }, []).byFile.length).toBe(10);
  });

  test("intake_survey の compose に、資料ごとの新しい機器の節の数と、同じ名前の節の note が入る", async () => {
    const ws = workspace();
    const tree = csv(["設備名,機器名称", ...Array.from({ length: 25 }, (_, i) => [`【架空】系統${i},`, ",【架空】甲浜クリーンセンター"]).flat()]);
    await add(ws, [{ name: "台帳.csv", bytes: tree }]);
    acceptAll(ws);
    ok(runTabTool(ws, "intake_compose", {}, CTX));
    await ws.whenComposed();
    const d = ok(runTabTool(ws, "intake_survey", { part: "compose" }, CTX));
    expect(TOOLS.intake_survey.output.safeParse(d).success).toBe(true);
    expect(d.compose.state).toBe("done");
    expect(d.compose.newNodesByFile).toEqual([{ fileRef: "台帳.csv", nodes: 50 }]);
    expect(d.compose.note).toContain("台帳.csv の「【架空】甲浜クリーンセンター」25");
  });
});
