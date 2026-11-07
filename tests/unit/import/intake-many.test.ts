// 資料を 100 個前後まとめて入れても、読めて、Claude に届く（ops/tasks/intake-many-v1）。
// 材料は工場の架空の資料：fictional-1 の星取表（Excel 1）と工事報告書の PDF（名前を変えて 87 本）、
// fictional-1-exports の発注明細の一覧（1 行目が題と抽出の条件の CSV 12 本）と設備機器の一覧（同じ書き方の、性質の違う CSV）。
// 縛ること：1. 形の違う資料を足しても、ある資料の読み（データのセルの数）が変わらない。2. intake_survey の答えが上限（60 KB）の内。
// 3. 同じ様式の CSV の同じ見出しの列は 1 問。4. CSV の 1 行目の題と条件を見出しにしない。5. 「名前の欄が空」の質問に資料と行を添える。
// 測った値（質問の数・答えの大きさ・時間）は標準出力に出す（報告に、測った値のまま写す）。資料の中身は出さない。
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { pageSurvey, jsonBytes } from "../../../src/bridge/survey-page";
import type { Analysis, IntakeSession } from "../../../src/import/session";
import { SURVEY_MAX_BYTES } from "../../../src/shared/tools";
import { acceptDefaults, human, rows, session, xlsxOf } from "./helpers";

const F1 = "samples/out/waste-incineration/fictional-1";
const EX = "samples/out/waste-incineration/fictional-1-exports";
const PLAN = "plan-hoshitori.xlsx";
type In = { name: string; bytes: Uint8Array };

const file = (path: string, name?: string): In => ({ name: name ?? (path.split("/").pop() as string), bytes: new Uint8Array(readFileSync(path)) });
const orders = (): In[] =>
  readdirSync(`${EX}/orders`)
    .sort()
    .map((n) => file(`${EX}/orders/${n}`));

/** 星取表 1・発注明細の CSV 12・工事報告書の PDF（名前を変えて、合わせて 100 個になるまで） */
function hundred(): In[] {
  const pdfs = readdirSync(`${F1}/reports`)
    .filter((n) => n.endsWith(".pdf"))
    .sort();
  const out = [file(`${F1}/${PLAN}`), ...orders()];
  for (let i = 0; out.length < 100; i++) {
    const n = pdfs[i % pdfs.length] as string;
    const round = Math.floor(i / pdfs.length);
    out.push(file(`${F1}/reports/${n}`, round ? n.replace(/\.pdf$/, `-${round + 1}.pdf`) : n));
  }
  return out;
}

/** 資料ごとのセルの行き先の数 */
function countsOf(an: Analysis, name: string): { data: number; unresolved: number } {
  let data = 0;
  let unresolved = 0;
  for (const [k, v] of an.composition.status) {
    if (k.split("\u0000")[0] !== name) continue;
    if (v.s === "data") data++;
    else if (v.s === "unresolved") unresolved++;
  }
  return { data, unresolved };
}

async function opened(files: In[]): Promise<IntakeSession> {
  const s = session();
  await s.add(files);
  return s;
}

/** 1 行目を除いた CSV（BOM は残す）：題と条件の行の無い同じ資料 */
function withoutFirstLine(b: Uint8Array): Uint8Array {
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? b.slice(0, 3) : new Uint8Array();
  return new Uint8Array([...bom, ...b.slice(b.indexOf(0x0a) + 1)]);
}

describe("資料を混ぜても、1 冊で読める資料の読みは変わらない", () => {
  test("星取表 1・題の行のある CSV 12・PDF 87（100 個）：星取表のデータのセルの数が、1 冊のときと同じ（落とした直後と、既定の答えのあと）", async () => {
    const files = hundred();
    expect(files).toHaveLength(100);
    expect(files.filter((f) => f.name.endsWith(".csv"))).toHaveLength(12);
    const alone = await opened([files[0] as In]);
    const t0 = performance.now();
    const mixed = await opened(files);
    const t1 = performance.now();
    const an = mixed.analyze();
    const t2 = performance.now();
    const a0 = countsOf(alone.analyze(), PLAN);
    expect(a0.data).toBeGreaterThan(0);
    expect(countsOf(an, PLAN)).toEqual(a0);
    // 既定の答えを置いたあとも同じ
    acceptDefaults(alone);
    acceptDefaults(mixed);
    expect(countsOf(mixed.analyze(), PLAN)).toEqual(countsOf(alone.analyze(), PLAN));
    const sv = pageSurvey(mixed.survey(an) as unknown as Record<string, unknown>, { part: "all" });
    process.stdout.write(
      `測った値（100 個）：資料を入れる ${Math.round(t1 - t0)} ms・読み直し ${Math.round(t2 - t1)} ms・答えの無い質問 ${an.open.length}・intake_survey（all）の答え ${jsonBytes(sv)} バイト・作業画面の要約 ${jsonBytes(mixed.survey(an))} バイト\n`,
    );
  });

  test("先の資料に決まっていない機器があっても、名前と機器番号の重ならない機器は待たせない（星取表のデータのセルの数が同じ）", async () => {
    const alone = await opened([file(`${F1}/${PLAN}`)]);
    const an0 = alone.analyze();
    const names = [...new Set(an0.records.assets.filter((a) => a.level > 1 && !a.pending).map((a) => a.name))].slice(0, 2);
    expect(names).toHaveLength(2);
    // 名前の中に機器番号のある台帳（番号を分けるかの答えが無いので、どの機器も決まっていない）。名前で並べると星取表より先に読む
    const csv = ["番号,名称,設置年", `1,${names[0]}（ZQ-1）,2001`, `2,${names[1]}（ZQ-2）,2002`, "3,【架空】試験だけの機器（ZQ-3）,2003"].join("\r\n") + "\r\n";
    const mixed = await opened([{ name: "0-台帳.csv", bytes: new TextEncoder().encode(csv) }, file(`${F1}/${PLAN}`)]);
    const an = mixed.analyze();
    expect(an.records.assets.filter((a) => a.file === "0-台帳.csv").every((a) => a.pending)).toBe(true);
    expect(countsOf(an, PLAN)).toEqual(countsOf(an0, PLAN));
    // 名前の重なる機器（台帳の決定を待つ）と、先の資料に無い機器（「この資料だけの機器か」に答えが無い）は、結ぶかが決まるまで
    // 1 冊のときと同じ節のまま持ち（held）、計画は作らない
    const held = an.linked.clusters.filter((c) => c.held);
    expect(held.map((c) => c.name)).toEqual(expect.arrayContaining(names));
    expect(an.open.some((q) => q.kind === "assetUnmatched")).toBe(true);
    const c = mixed.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("・")).toContain("答えの無い質問");
    // 台帳の番号の分け方に答えると、台帳の機器が決まり、待っていた機器も結ぶかの質問に回る。星取表の読みはそのまま
    const tag = an.open.find((q) => q.kind === "tagSplit");
    expect(tag).toBeDefined();
    mixed.settle([human(tag!.questionId, "yes")]);
    const an2 = mixed.analyze();
    expect(an2.records.assets.filter((a) => a.file === "0-台帳.csv").some((a) => a.pending)).toBe(false);
    expect(an2.open.some((q) => q.kind === "assetUnmatched" && q.items.some((i) => i.file === PLAN))).toBe(true);
    expect(countsOf(an2, PLAN)).toEqual(countsOf(an0, PLAN));
  });
});

describe("CSV の 1 行目が題と抽出の条件なら、見出しにせず 2 行目を見出しにする", () => {
  test("発注明細の一覧 12 本と設備機器の一覧：見出しは 2 行目。題の行の無い同じ資料と、同じ数のデータ・未解決・質問になる（性質の違う 2 つのファイル）", async () => {
    for (const f of [...orders(), file(`${EX}/equipment-list.csv`)]) {
      const s = await opened([f]);
      const an = s.analyze();
      const tables = an.layouts.flatMap((l) => l.tables);
      expect(tables.length, f.name).toBeGreaterThan(0);
      for (const t of tables) expect(t.headerRows, f.name).toEqual([2]);
      expect(an.layouts[0]?.rowRoles.get(1), f.name).not.toBe("header");
    }
    for (const f of [orders()[0] as In, file(`${EX}/equipment-list.csv`)]) {
      const a = (await opened([f])).analyze();
      const b = (await opened([{ name: f.name, bytes: withoutFirstLine(f.bytes) }])).analyze();
      const ca = countsOf(a, f.name);
      const cb = countsOf(b, f.name);
      expect(ca, f.name).toEqual(cb);
      expect(a.open.map((q) => q.kind).sort(), f.name).toEqual(b.open.map((q) => q.kind).sort());
    }
  });

  test("題と条件を 1 行に並べた CSV（題・抽出日時・基準日）：1 行目を見出しにしない", async () => {
    const lines = ["【架空】発注明細一覧（最新状態）,抽出日時：2026/11/01 10:00,基準日：2026/10/31", "発注番号,発注日,件名,機器,数量,完了日,備考"];
    for (let i = 0; i < 12; i++) lines.push(`P-${100 + i},2025/0${1 + (i % 9)}/1${i % 10},定期点検,【架空】ポンプ${i % 4},1,2025/0${1 + (i % 9)}/2${i % 8},`);
    const s = await opened([{ name: "発注.csv", bytes: new TextEncoder().encode(lines.join("\r\n") + "\r\n") }]);
    const an = s.analyze();
    const t = an.layouts[0]?.tables[0];
    expect(t?.headerRows).toEqual([2]);
    expect(t?.cols.find((c) => c.c === 3)?.role).toBe("workTitle");
    expect(an.open.filter((q) => q.kind === "columnRole").map((q) => q.text).join("\n")).not.toContain("抽出日時");
  });
});

describe("同じ様式の CSV の同じ見出しの列は、1 問にまとめて聞き、答えは全部に当てる", () => {
  test("発注明細の一覧 12 本：列の役目の質問の数は 1 本のときと同じ。答えは中身のある 11 本の表のどれにも効く", async () => {
    const one = (await opened([orders()[0] as In])).analyze().open.filter((q) => q.kind === "columnRole");
    const s = await opened(orders());
    const an = s.analyze();
    const roleQs = an.open.filter((q) => q.kind === "columnRole");
    expect(one.length).toBeGreaterThan(0);
    expect(roleQs).toHaveLength(one.length);
    const withRows = an.layouts.filter((l) => l.tables.some((t) => t.rows.some((r) => r.role === "data")));
    for (const q of roleQs) expect(new Set(q.items.map((i) => i.file)).size).toBe(withRows.length);
    s.settle(roleQs.map((q) => human(q.questionId, q.defaultAnswer ?? "remark")));
    const an2 = s.analyze();
    expect(an2.open.filter((q) => q.kind === "columnRole")).toHaveLength(0);
    expect(an2.unusedDecisions).toHaveLength(0);
  });
});

describe("「名前の欄が空」の質問の文に、どの資料のどの行かを添える", () => {
  test("文に資料の名前・シート・行の番号と行の数が入る。質問の番号は前と同じ鍵（表ごと）", async () => {
    const bytes = await xlsxOf((ws) => {
      rows(ws, 1, [["名称", "設置年"]]);
      rows(ws, 2, [["甲設備", 2001], [null, 2002], ["乙設備", 2003], [null, 2004]]);
    });
    const s = await opened([{ name: "台帳.xlsx", bytes }]);
    const q = s.analyze().open.find((x) => x.kind === "stray");
    expect(q?.text).toContain("名前の欄が空で、ほかの欄だけに中身がある行がある");
    expect(q?.text).toContain("台帳.xlsx「表」の 3・5 行目");
    expect(q?.text).toContain("2 行");
    expect(q?.sameShapeRows).toBe(2);
  });
});

describe("intake_survey の答えは上限（60 KB）の内", () => {
  /** 同じ形の質問が多い要約（列の役目を資料ごと・列ごとに聞いた形）。選択肢は同じ並び */
  function bigSurvey(n: number): Record<string, unknown> {
    const options = Array.from({ length: 16 }, (_, i) => ({ id: `role${i}`, label: `役目の選択肢の名前 その ${i}（説明の文）` }));
    const questions = Array.from({ length: n }, (_, i) => ({
      questionId: `q-${i}`,
      kind: i % 7 === 0 ? "eventAssetOne" : "columnRole",
      text: `列 ${String.fromCharCode(65 + (i % 26))}（見出し「【架空】見出しの名前 ${i % 40}」・中身の見本 「【架空】値 ${i}」「【架空】値 ${i + 1}」・表の 3〜${40 + i} 行目）の役目が決まらない`,
      sameShapeRows: 1,
      defaultAnswer: "role0",
      valueKind: "option",
      // 作業画面の要約と同じく、同じ選択肢の並びは先の質問（q-1）だけに書き、後の質問は sameOptionsAs で指す
      ...(i % 7 === 0 ? { options: [...options.slice(0, 2), { id: `c${i}`, label: `候補 ${i}` }] } : i === 1 ? { options } : { options: [], sameOptionsAs: "q-1" }),
    }));
    return {
      files: Array.from({ length: 100 }, (_, i) => ({ fileRef: `【架空】資料の名前_${i}_定期整備工事報告書.pdf`, sheets: 1, rows: 120 })),
      samples: Array.from({ length: 20 }, (_, i) => ({ fileRef: `【架空】資料の名前_${i}.pdf`, row: i + 1, cells: Array.from({ length: 40 }, (_, j) => `【架空】見本のセルの文字 ${i}-${j}`.padEnd(40, "あ")) })),
      legends: [{ mark: "○", meaning: "計画" }],
      notes: Array.from({ length: 61 }, (_, i) => `【架空】資料の名前_${i}.pdf A${i}：頁ごとの頭書きの注記の文 ${i}`),
      questions,
      questionGroups: [
        { kind: "columnRole", shape: "列 X（見出し「…」・中身の見本 「…」「…」・表の n〜n 行目）の役目が決まらない", count: n - Math.ceil(n / 7), rows: n - Math.ceil(n / 7), example: { questionId: "q-1", text: questions[1]?.text ?? "" } },
        { kind: "eventAssetOne", shape: "列 X（見出し「…」）", count: Math.ceil(n / 7), rows: Math.ceil(n / 7), example: { questionId: "q-0", text: questions[0]?.text ?? "" } },
      ],
      unresolvedCells: 7966,
      stuck: Array.from({ length: 20 }, (_, i) => ({
        fileRef: `【架空】資料の名前_${i}.pdf`,
        cells: 100,
        header: [{ row: 1, cells: Array.from({ length: 40 }, (_, j) => `見出し ${j}`) }],
        rows: Array.from({ length: 5 }, (_, r) => ({ sheet: null, row: r + 2, cells: Array.from({ length: 40 }, (_, j) => `【架空】詰まった行のセル ${r}-${j}`), unresolved: Array.from({ length: 40 }, (_, j) => `A${j + 1}`), questionId: null })),
      })),
      compose: { state: "idle", message: null },
      crosswalk: null,
    };
  }

  test("質問 1,200・ほかの欄も厚い要約：どの part も上限の内。分けたときは形の要約と続きの道があり、cursor でたどると全部の質問に 1 回ずつ届く", () => {
    const big = bigSurvey(1200);
    expect(jsonBytes(big)).toBeGreaterThan(SURVEY_MAX_BYTES * 5);
    const first = pageSurvey(big, { part: "all" });
    expect(jsonBytes(first)).toBeLessThanOrEqual(SURVEY_MAX_BYTES);
    expect((first.questionGroups as unknown[]).length).toBeGreaterThan(0);
    expect((first.notes as string[])[0]).toContain("cursor");
    const seen: string[] = [];
    let page = first;
    for (let i = 0; i < 200; i++) {
      const qs = page.questions as { questionId: string; options: unknown[]; sameOptionsAs?: string }[];
      // 選択肢を指す先は、同じ答えの中の先の質問
      for (const [j, q] of qs.entries()) {
        if (q.sameOptionsAs) expect(qs.slice(0, j).some((x) => x.questionId === q.sameOptionsAs && x.options.length > 0)).toBe(true);
        else expect(q.options.length, q.questionId).toBeGreaterThan(0);
      }
      seen.push(...qs.map((q) => q.questionId));
      const p = page.questionsPage as { nextCursor: number | null; total: number };
      expect(p.total).toBe(1200);
      if (p.nextCursor === null) break;
      expect(qs.length).toBeGreaterThan(0);
      page = pageSurvey(big, { part: "questions", cursor: p.nextCursor });
      expect(jsonBytes(page)).toBeLessThanOrEqual(SURVEY_MAX_BYTES);
    }
    expect(seen).toEqual((big.questions as { questionId: string }[]).map((q) => q.questionId));
    // limit で数を絞れる
    const five = pageSurvey(big, { part: "questions", cursor: 10, limit: 5 });
    expect((five.questions as { questionId: string }[]).map((q) => q.questionId)).toEqual(["q-10", "q-11", "q-12", "q-13", "q-14"]);
    expect((five.questionsPage as { nextCursor: number | null }).nextCursor).toBe(15);
    for (const part of ["compose", "crosswalk", "questions"]) expect(jsonBytes(pageSurvey(big, { part })), part).toBeLessThanOrEqual(SURVEY_MAX_BYTES);
  });

  test("小さな要約はそのまま返す（分けない・短くしない）", () => {
    const small = { ...bigSurvey(3), files: [], samples: [], notes: [], stuck: [] };
    const out = pageSurvey(small, { part: "all" });
    expect(out.questionsPage).toBeUndefined();
    expect(out.questionGroups).toBeUndefined();
    expect((out.questions as unknown[]).length).toBe(3);
    expect(out.notes).toEqual([]);
  });

  test("100 個の資料の要約：all と questions の答えが上限の内で、質問は cursor でどれも読める", async () => {
    const s = await opened(hundred());
    const an = s.analyze();
    const sv = s.survey(an) as unknown as Record<string, unknown>;
    for (const part of ["all", "questions", "compose"]) expect(jsonBytes(pageSurvey(sv, { part })), part).toBeLessThanOrEqual(SURVEY_MAX_BYTES);
    const ids: string[] = [];
    let cursor: number | undefined;
    for (let i = 0; i < 100; i++) {
      const p = pageSurvey(sv, { part: "questions", ...(cursor === undefined ? {} : { cursor }) });
      ids.push(...(p.questions as { questionId: string }[]).map((q) => q.questionId));
      const next = (p.questionsPage as { nextCursor: number | null } | undefined)?.nextCursor ?? null;
      if (next === null) break;
      cursor = next;
    }
    // 並びは、既定の答えの無い質問が先（同じ組の中は出てきた順）
    expect(ids).toEqual([...an.open.filter((q) => q.defaultAnswer === null), ...an.open.filter((q) => q.defaultAnswer !== null)].map((q) => q.questionId));
  });
});
