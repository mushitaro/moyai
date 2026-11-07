// 同じ形の質問を 1 問にまとめる・読めない形の資料を「参考（今回は使わない）」として外す（仕事 intake-group-v1）。
// 資料はどれも試験の中で組む架空のもの。どの施設の資料の語にも依らない。
import ExcelJS from "exceljs";
import { describe, expect, test } from "vitest";
import { pageSurvey } from "../../../src/bridge/survey-page";
import type { Analysis } from "../../../src/import";
import { questionIdOf } from "../../../src/import/questions";
import { REFERENCE_REASON } from "../../../src/import/reference";
import { acceptDefaults, human, session } from "./helpers";

const csv = (lines: string[]) => new TextEncoder().encode(`${lines.join("\r\n")}\r\n`);
const ledger = csv(["名称,備考", "ポンプ,【架空】", "ブロワ,【架空】"]);

const SHEETS = 12;
/** 1 シートの日ごとの塊：1 つ目と 3 つ目は頭書きに日付、2 つ目は日付の無い塊 */
const BLOCKS = 3;

async function bytesOf(wb: ExcelJS.Workbook): Promise<Uint8Array> {
  return new Uint8Array((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/**
 * 作業日報：月ごとのシート 12 枚。シートの中に日ごとの塊（頭書き・空いた行・見出し・作業の行）。
 * どの塊も同じ見出し（同じ様式）で、工数の読めない書き方（「要確認」「未記入」「??」）が塊ごとに散らばる
 */
async function dailyBook(sheets = SHEETS): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "【架空】試験";
  for (let s = 0; s < sheets; s++) {
    const m = ((s + 3) % 12) + 1;
    const ws = wb.addWorksheet(`${m}月`);
    let r = 1;
    ws.getCell(r, 1).value = `【架空】作業日報 令和8年度（2026年度） ${m}月`;
    r += 2;
    for (let d = 1; d <= BLOCKS; d++) {
      if (d === 2) {
        ws.getCell(r, 1).value = "設備名";
        ws.getCell(r, 2).value = "【架空】第1系統";
      } else {
        ws.getCell(r, 1).value = "日付";
        ws.getCell(r, 2).value = `${m}/${d}`;
      }
      r += 2;
      ["機器", "作業", "工数"].forEach((v, i) => (ws.getCell(r, i + 1).value = v));
      r++;
      const lines = [
        ["ポンプ", "点検", "2人日"],
        ["ブロワ", "点検", "要確認"],
        ["ポンプ", "清掃", d === 3 ? "??" : "未記入"],
      ];
      for (const x of lines) {
        x.forEach((v, i) => (ws.getCell(r, i + 1).value = v));
        r++;
      }
      r++;
    }
  }
  return bytesOf(wb);
}

/** 契約の一覧：年度ごとのシートに契約の行（番号・件名・業者・見積と発注の日と金額・工期） */
async function contractBook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const [name, fy] of [["R7", 2025], ["R8", 2026]] as const) {
    const ws = wb.addWorksheet(name);
    ws.getCell(1, 1).value = `【架空】契約の一覧 ${name}年度`;
    const head = ["No.", "契約番号", "件名", "区分", "契約方法", "業者名", "見積取得日", "見積金額（円）", "発注日", "発注金額（円）", "工期（着手）", "工期（完了）"];
    head.forEach((v, i) => (ws.getCell(3, i + 1).value = v));
    for (let k = 0; k < 6; k++) {
      const vals: (string | number | Date)[] = [
        k + 1,
        `K${fy}-${String(k + 1).padStart(3, "0")}`,
        `【架空】${["送風機", "ポンプ", "計装", "受電", "クレーン", "コンベヤ"][k]}点検業務`,
        k % 2 ? "委託" : "工事",
        "随意契約",
        `【架空】${"甲乙丙丁戊己"[k]}社`,
        new Date(Date.UTC(fy, 4, 10 + k)),
        100000 * (k + 1),
        new Date(Date.UTC(fy, 5, 1 + k)),
        98000 * (k + 1),
        new Date(Date.UTC(fy, 6, 1)),
        new Date(Date.UTC(fy, 8, 30)),
      ];
      vals.forEach((v, i) => (ws.getCell(4 + k, i + 1).value = v));
    }
  }
  return bytesOf(wb);
}

/** 週のガント：年度ごとのシートに、機器の行 × 週の列。見出しの 1 段目は月、2 段目は週の始まり（「3/29」「4/5」…） */
async function ganttBook(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  for (const [name, fy] of [["R7", 2025], ["R8", 2026]] as const) {
    const ws = wb.addWorksheet(name);
    ws.getCell(1, 1).value = `【架空】年間工程表 ${name}年度`;
    ["No.", "機器名", "作業内容"].forEach((v, i) => (ws.getCell(3, i + 1).value = v));
    const start = Date.UTC(fy, 2, 29);
    let month = -1;
    for (let w = 0; w < 16; w++) {
      const d = new Date(start + w * 7 * 86400000);
      const m = d.getUTCMonth() + 1;
      if (m !== month) ws.getCell(3, 4 + w).value = `${m}月`;
      month = m;
      ws.getCell(4, 4 + w).value = `${m}/${d.getUTCDate()}`;
    }
    ["送風機", "ポンプ", "計装", "受電", "クレーン"].forEach((x, k) => {
      ws.getCell(5 + k, 1).value = k + 1;
      ws.getCell(5 + k, 2).value = x;
      ws.getCell(5 + k, 3).value = "定期点検";
      for (let w = k; w < k + 3; w++) ws.getCell(5 + k, 4 + w).value = "■";
    });
  }
  return bytesOf(wb);
}

/** 資料の、工数の列の読めないセル（見出しの「工数」の列で、読める「2人日」でないもの） */
function badEffortCells(an: Analysis, file: string): string[] {
  const out: string[] = [];
  for (const lay of an.layouts.filter((l) => l.file === file))
    for (const t of lay.tables) {
      const ec = t.cols.find((c) => c.role === "effort");
      if (!ec) continue;
      for (const r of t.rows) {
        const cell = lay.index.at(r.r, ec.c);
        if (cell && cell.text !== "" && cell.text !== "2人日") out.push(`${lay.file}\u0000${lay.sheetIndex}\u0000${cell.ref}`);
      }
    }
  return out;
}

const statusOf = (an: Analysis, keys: string[]) => keys.map((k) => an.composition.status.get(k));

describe("同じ形の質問を 1 問にまとめる", () => {
  test("同じ様式のシート 12 枚 × 日ごとの塊に散らばる工数の読めない行は 1 問。答えると全部の行に当たり、取り消すと全部戻る", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: await dailyBook() },
    ]);
    const an = s.analyze();
    // 塊ごとに表が分かれ、どれも同じ様式
    const tables = an.layouts.filter((l) => l.file === "日報.xlsx").flatMap((l) => l.tables);
    expect(tables.length).toBe(SHEETS * BLOCKS);
    expect(new Set(tables.map((t) => t.form)).size).toBe(1);
    const bad = badEffortCells(an, "日報.xlsx");
    expect(bad.length).toBe(SHEETS * BLOCKS * 2);
    const effort = an.open.filter((q) => q.kind === "effortUnknown");
    expect(effort.length).toBe(1);
    const q = effort[0]!;
    expect(q.sameShapeRows).toBe(bad.length);
    expect(q.text).toContain(`工数の書き方が読めない（${bad.length} 行）`);
    // まとめる前は塊ごと・書き方ごとの問い（2 つ目までの塊は 1 通り、3 つ目の塊は 2 通り）
    expect(q.text).toContain(`${SHEETS * (BLOCKS + 1)} 問をまとめた`);
    // 見本は代表の数問だけ（セルの番地は 3 問分まで）
    expect(q.items.flatMap((i) => i.cells).length).toBeLessThanOrEqual(30);
    // 未解決のセルは、決める質問を指す（工数のセルは、まとめた質問か、その行が待つ機器の質問）
    const by = statusOf(an, bad).map((x) => (x?.s === "unresolved" ? x.questionId : x?.s));
    expect(by.every((x) => typeof x === "string" && x.startsWith("q-"))).toBe(true);
    expect(by).toContain(q.questionId);

    // intake_survey：まとめた質問は 1 問として載り、形の要約と、分けて返す道もそのまま使える
    const sv = s.survey(an);
    expect(sv.questions.filter((x) => x.kind === "effortUnknown").map((x) => [x.questionId, x.sameShapeRows])).toEqual([[q.questionId, bad.length]]);
    expect(sv.questionGroups?.find((g) => g.kind === "effortUnknown")).toMatchObject({ count: 1, rows: bad.length });
    const page = pageSurvey(sv as unknown as Record<string, unknown>, { part: "questions", limit: 1 }) as { questions: unknown[]; questionsPage?: { total: number; returned: number; nextCursor: number | null } };
    expect(page.questions.length).toBe(1);
    expect(page.questionsPage).toMatchObject({ total: an.open.length, returned: 1, nextCursor: 1 });

    const r = s.settle([human(q.questionId, "exclude")]);
    expect(r.cellsAffected).toBeGreaterThanOrEqual(bad.length);
    const after = s.takeAfter()!;
    expect(after.open.some((x) => x.kind === "effortUnknown")).toBe(false);
    for (const st of statusOf(after, bad)) {
      expect(st?.s).toBe("excluded");
      expect(st?.s === "excluded" ? st.reason : "").toMatch(/工数/u);
    }
    expect(after.questions.find((x) => x.questionId === q.questionId)?.decision?.answer).toBe("exclude");

    s.undo(q.questionId);
    const back = s.takeAfter()!;
    for (const st of statusOf(back, bad)) expect(st?.s).toBe("unresolved");
    const again = back.open.filter((x) => x.kind === "effortUnknown");
    expect(again.map((x) => [x.questionId, x.sameShapeRows])).toEqual([[q.questionId, bad.length]]);
  });

  test("まとめた質問の ID は、まとめる前の鍵から決まって変わらない（読み直し・別のセッション・ほかの決定で変わらない）", async () => {
    const book = await dailyBook();
    const a = session();
    await a.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: book },
    ]);
    const first = a.analyze().open.find((q) => q.kind === "effortUnknown")!.questionId;
    expect(a.analyze().open.find((q) => q.kind === "effortUnknown")!.questionId).toBe(first);
    // ほかの質問（日付の無い塊）に答えても変わらない
    const date = a.analyze().open.find((q) => q.kind === "dateUnknown")!;
    a.settle([human(date.questionId, "exclude")]);
    expect(a.analyze().open.find((q) => q.kind === "effortUnknown")!.questionId).toBe(first);
    const b = session();
    await b.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: book },
    ]);
    expect(b.analyze().open.find((q) => q.kind === "effortUnknown")!.questionId).toBe(first);
  });

  test("まとめる前の ID に置いた決定は、その問いの行にだけ効く（前の決定の照らしが崩れない）", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: await dailyBook() },
    ]);
    const an = s.analyze();
    const merged = an.open.find((q) => q.kind === "effortUnknown")!;
    const t0 = an.layouts.find((l) => l.file === "日報.xlsx")!.tables[0]!;
    // まとめる前の鍵（塊の表と、書き方の形「字」）の問い。前の版で答えた決定の形
    const old = questionIdOf(`effortBad|${t0.id}|字`);
    s.settle([human(old, "exclude")]);
    const after = s.takeAfter()!;
    expect(after.unusedDecisions).toEqual([]);
    const own = after.questions.find((x) => x.questionId === old);
    expect(own?.decision?.answer).toBe("exclude");
    expect(own?.sameShapeRows).toBe(2);
    const rest = after.open.find((x) => x.kind === "effortUnknown");
    expect(rest?.questionId).toBe(merged.questionId);
    expect(rest?.sameShapeRows).toBe(merged.sameShapeRows - 2);
  });

  test("日付の書いていない塊は、シートをまたいで 1 問。答えると、どの塊の行にも当たる", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: await dailyBook() },
    ]);
    const dates = s.analyze().open.filter((q) => q.kind === "dateUnknown");
    expect(dates.length).toBe(1);
    expect(dates[0]!.sameShapeRows).toBe(SHEETS * 3);
    expect(dates[0]!.text).toContain(`作業の行に日付が書いていない（${SHEETS * 3} 行）`);
    s.settle([human(dates[0]!.questionId, "exclude")]);
    const after = s.takeAfter()!;
    const excluded = after.records.events.filter((e) => e.excluded === "日付の書いていない行（決定で外した）");
    expect(excluded.length).toBe(SHEETS * 3);
    expect(new Set(excluded.map((e) => e.sheet)).size).toBe(SHEETS);
  });

  test("まとめた質問に答えて作った計画の版の記録には、まとめた質問が 1 つの決定として入る（行の数は合わせた数）", async () => {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: await dailyBook() },
    ]);
    const an = s.analyze();
    const effort = an.open.find((q) => q.kind === "effortUnknown")!;
    const date = an.open.find((q) => q.kind === "dateUnknown")!;
    s.settle([
      { questionId: effort.questionId, answer: "exclude", author: "ai", reason: "試験の台本が置いた" },
      human(date.questionId, "exclude"),
    ]);
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    const rd = c.plan?.readingDecisions ?? [];
    const e = rd.filter((x) => x.kind === "effortUnknown");
    expect(e.length).toBe(1);
    expect(e[0]?.questionId).toBe(effort.questionId);
    expect(e[0]?.rows).toBe(effort.sameShapeRows);
    expect(e[0]?.author).toBe("ai");
    expect(e[0]?.where).toContain("日報.xlsx");
  });
});

describe("読めない形の資料を、参考として外す", () => {
  async function four() {
    const s = session();
    await s.add([
      { name: "台帳.csv", bytes: ledger },
      { name: "日報.xlsx", bytes: await dailyBook(1) },
      { name: "契約の一覧.xlsx", bytes: await contractBook() },
      { name: "工程表.xlsx", bytes: await ganttBook() },
      { name: "週の工程表.xlsx", bytes: await ganttBook() },
    ]);
    return s;
  }
  /** 読めない形の資料（週のガント 2 冊）。契約の一覧は契約の記録として読める形（仕事 reader-contracts-v1）なので、参考の質問を出さない */
  const GANTTS = ["工程表.xlsx", "週の工程表.xlsx"];
  const refText = (file: string) => `この資料（${file}）は、今回は参考として計画に使わないか`;

  test("週のガントの形の資料に参考の質問が出て、外すと残りの資料で計画が作れる。取り消すと戻る。契約の一覧は読める形なので参考の質問を出さない", async () => {
    const s = await four();
    const an = s.analyze();
    const refs = an.open.filter((q) => q.text.startsWith("この資料（"));
    expect(refs.map((q) => q.text).sort()).toEqual(GANTTS.map(refText).sort());
    // 契約の一覧：契約の記録として読み、質問の無い未解決のセルを残さない
    expect(an.layouts.filter((l) => l.file === "契約の一覧.xlsx").flatMap((l) => l.tables.map((t) => t.shape))).toEqual(["contracts", "contracts"]);
    expect([...an.composition.status.entries()].some(([k, v]) => k.startsWith("契約の一覧.xlsx\u0000") && v.s === "unresolved")).toBe(false);
    for (const q of refs) {
      expect(q.options).toEqual([{ id: "reference", label: "参考として外す" }]);
      expect(q.defaultAnswer).toBeNull();
    }
    // 外さないままでは計画を作れない
    expect(s.compose().plan).toBeNull();

    s.settle(refs.map((q) => human(q.questionId, "reference")));
    const after = s.takeAfter()!;
    for (const file of GANTTS) {
      const mine = [...after.composition.status.entries()].filter(([k]) => k.startsWith(`${file}\u0000`));
      expect(mine.length).toBeGreaterThan(0);
      expect(mine.every(([, v]) => v.s === "excluded" && v.reason === REFERENCE_REASON)).toBe(true);
      // その資料の質問はもう出ない
      expect(after.open.some((q) => q.items.some((i) => i.file === file))).toBe(false);
    }
    // 日報の質問に答えて、計画を作る
    const effort = after.open.find((q) => q.kind === "effortUnknown");
    const date = after.open.find((q) => q.kind === "dateUnknown");
    s.settle([effort, date].filter((q) => !!q).map((q) => human(q!.questionId, "exclude")));
    acceptDefaults(s);
    const c = s.compose();
    expect(c.blockers).toEqual([]);
    expect(c.plan).not.toBeNull();
    // 入れた行＝取り込んだ数＋外した数（参考の資料の行は「参考の資料」に数える）
    for (const file of GANTTS) {
      const fc = c.counts.find((x) => x.file === file)!;
      expect(fc.holds).toBe(true);
      expect(fc.importedRows).toBe(0);
      expect(fc.excludedRows[REFERENCE_REASON]).toBe(fc.inputRows);
    }
    // 契約の一覧の契約の行（2 シート × 6 行）は、契約の記録として取り込んだ行に数える（計画の作業にはしない）
    const cf = c.counts.find((x) => x.file === "契約の一覧.xlsx")!;
    expect(cf.holds).toBe(true);
    expect(cf.importedRows).toBe(12);
    expect(cf.unresolvedRows).toBe(0);
    const sources = [...(c.plan?.assets ?? []), ...(c.plan?.details ?? [])].flatMap((x) => x.sources.map((y) => y.file));
    expect(sources.some((f) => f === "契約の一覧.xlsx" || GANTTS.includes(f))).toBe(false);
    // 版の記録：外した資料は「参考」の決定として残る（署名される字の形は今のまま）
    const rd = (c.plan?.readingDecisions ?? []).filter((x) => x.question.startsWith("この資料（"));
    expect(rd.map((x) => [x.question, x.answer, x.where]).sort()).toEqual(
      [
        [refText("工程表.xlsx"), "参考として外す", "工程表.xlsx"],
        [refText("週の工程表.xlsx"), "参考として外す", "週の工程表.xlsx"],
      ].sort(),
    );

    // 取り消すと、その資料は戻り、質問がまた出て、計画は作れない
    const gantt = refs.find((q) => q.text === refText("工程表.xlsx"))!;
    s.undo(gantt.questionId);
    const back = s.takeAfter()!;
    expect(back.open.map((q) => q.questionId)).toContain(gantt.questionId);
    expect(back.composition.plan).toBeNull();
    expect([...back.composition.status.entries()].some(([k, v]) => k.startsWith("工程表.xlsx\u0000") && v.s === "unresolved")).toBe(true);
  });

  test("どの資料も参考として外したら、空の計画を作らない", async () => {
    const s = session();
    await s.add([{ name: "工程表.xlsx", bytes: await ganttBook() }]);
    const q = s.analyze().open.find((x) => x.text === refText("工程表.xlsx"))!;
    s.settle([human(q.questionId, "reference")]);
    const c = s.compose();
    expect(c.plan).toBeNull();
    expect(c.blockers.join("・")).toContain("計画に使う資料が無い");
  });

  test("読める資料（台帳・日報・契約の一覧）には参考の質問を出さない", async () => {
    const s = await four();
    const an = s.analyze();
    for (const file of ["台帳.csv", "日報.xlsx", "契約の一覧.xlsx"]) expect(an.open.some((q) => q.text === refText(file))).toBe(false);
  });
});
