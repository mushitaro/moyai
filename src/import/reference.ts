// 参考の資料：読めていない未解決のセルが多く残る資料（週のガントなど、読み手が読めない形の資料。契約の一覧は契約の記録として読む）は、
// 資料ごとに「今回は参考として計画に使わないか」を 1 問聞く。人が外すと決めたら、その資料からは記録を作らず、
// どのセルも「参考の資料」として外したセルに数え、計画は残りの資料で作る。決定は版の記録の読み方の決定の 1 つとして残る。
import type { SourceFile } from "./grid";
import { questionIdOf, type Asker, type Question, type QuestionItem } from "./questions";
import { cellKey } from "./records";
import type { SheetLayout } from "./structure";

/**
 * 参考の質問を出す目安：読めていない未解決のセルが、その資料のセルのこの割合を越える。
 * 読めていないセルは、決める質問の無い未解決のセルと、列の役目の決まらない列のセル（読み手が列の意味を読めていない）
 */
export const REFERENCE_SHARE = 0.5;
/** 参考として外したセルの理由（行き先の字） */
export const REFERENCE_REASON = "参考の資料";
export const REFERENCE_OPTION = { id: "reference", label: "参考として外す" } as const;
/** 見本に出す、読めていない未解決のセルの数（シートごと） */
const SAMPLE_CELLS = 10;

/** 参考の質問の鍵（資料ごと） */
export const referenceKey = (file: string) => `referenceOnly|${file}`;

/** 資料の行の数（シートごとの、中身のある行の数の和） */
function rowsOf(s: SourceFile): number {
  return s.sheets.reduce((a, g) => a + new Set(g.cells.map((c) => c.r)).size, 0);
}

// 種類は「意味の決まらないセル」（読み手が意味を決められないセルを、資料ごと外すかを聞く）。画面の種類の名前は今のまま使う
function question(file: string, rows: number, items: QuestionItem[]): Omit<Question, "questionId"> {
  return {
    kind: "stray",
    text: `この資料（${file}）は、今回は参考として計画に使わないか`,
    options: [{ ...REFERENCE_OPTION }],
    valueKind: "option",
    defaultAnswer: null,
    sameShapeRows: rows,
    items,
  };
}

/**
 * 記録を作る前に：参考として外すと決めた資料。決定（か読み方の規則の答え）のある資料にだけ質問を置き、答えを読む
 * （答えの無い資料は、記録を作ってから askReference が目安で聞く）
 */
export function referenceFiles(sources: readonly SourceFile[], ask: Asker): Set<string> {
  const out = new Set<string>();
  for (const s of sources) {
    const q = question(s.file, rowsOf(s), [{ file: s.file, sheet: null, cells: [] }]);
    if (!ask.hasAnswer(referenceKey(s.file), q)) continue;
    if (ask.ask(referenceKey(s.file), q) === REFERENCE_OPTION.id) out.add(s.file);
  }
  return out;
}

/** セルの行き先を数えたあとに：読めていない未解決のセルが、資料のセルの半分を越える資料に、参考の質問を出す */
export function askReference(
  sources: readonly SourceFile[],
  layouts: readonly SheetLayout[],
  status: ReadonlyMap<string, { s: string; questionId?: string | null }>,
  ask: Asker,
  reference: ReadonlySet<string>,
): void {
  for (const s of sources) {
    if (reference.has(s.file) || ask.asked.has(questionIdOf(referenceKey(s.file)))) continue;
    let total = 0;
    let unread = 0;
    const items: QuestionItem[] = [];
    for (const lay of layouts.filter((l) => l.file === s.file)) {
      const cells: string[] = [];
      for (const cell of lay.grid.cells) {
        total++;
        const st = status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref }));
        // 決める質問の無いセルと、列の役目の決まらない列のセル（決める質問の ID は、まとめた質問の ID に直してある）
        if (st?.s !== "unresolved" || (st.questionId && ask.asked.get(st.questionId)?.kind !== "columnRole")) continue;
        unread++;
        if (cells.length < SAMPLE_CELLS) cells.push(cell.ref);
      }
      if (cells.length) items.push({ file: lay.file, sheet: lay.sheet, cells });
    }
    if (!total || unread <= total * REFERENCE_SHARE) continue;
    const it = items[0];
    if (it) it.note = `読めていない未解決のセル ${unread}（資料のセル ${total}）`;
    ask.ask(referenceKey(s.file), question(s.file, rowsOf(s), items));
  }
}

