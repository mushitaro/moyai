// 取り込みの入口：資料を入れ、要約と質問を読み、決定を置き（取り消せる）、計画を作る。
// 層 1（読み手）だけが形式を知る。層 2〜4 は決定の一覧とともに毎回はじめから読み直す（同じ入力と決定からはいつも同じ出力）。
// AI に渡すのは要約・行番号つきの見本・凡例・注記・質問の候補だけ（plan §2.13）。行の中身をまとめて渡さない。
import type { Plan } from "../shared/plan";
import { readCsv, ENCODING_LABEL, type CsvDelimiter, type CsvEncoding } from "./csv";
import type { RejectedFile, SourceFile } from "./grid";
import { extensionOf, READABLE, readSource, type InputFile } from "./read";
import { layoutFile, type SheetLayout } from "./structure";
import { buildRecords, type Records } from "./records";
import { link, type Linked } from "./link";
import { compose, type Composition } from "./compose";
import { Asker, type Decision, type QuestionState } from "./questions";

export interface IntakeOptions {
  planId: string;
  displayName: string;
  packId: string;
  facility: Plan["facility"];
}

export interface Analysis {
  sources: SourceFile[];
  rejected: RejectedFile[];
  layouts: SheetLayout[];
  records: Records;
  linked: Linked;
  composition: Composition;
  questions: QuestionState[];
  open: QuestionState[];
  unusedDecisions: Decision[];
}

/** intake_survey の返すものと同じ形（src/shared/tools.ts） */
export interface Survey {
  files: { fileRef: string; sheets: number; rows: number }[];
  samples: { fileRef: string; row: number; cells: string[] }[];
  legends: { mark: string; meaning: string }[];
  notes: string[];
  questions: {
    questionId: string;
    text: string;
    sameShapeRows: number;
    defaultAnswer: string | null;
    valueKind: "option" | "number";
    options: { id: string; label: string }[];
  }[];
  unresolvedCells: number;
  compose: { state: "idle" | "running" | "done" | "failed"; message: string | null };
}

const SAMPLE_ROWS = 20;
const SAMPLE_CELLS = 40;
const SAMPLE_TEXT = 60;

export class IntakeSession {
  private readonly files: InputFile[] = [];
  private readonly xlsx = new Map<string, SourceFile>();
  private readonly rejectedFiles: RejectedFile[] = [];
  private decisions = new Map<string, Decision>();
  private composed: Composition | null = null;
  constructor(readonly options: IntakeOptions) {}

  /** 資料を入れる（Excel はここで読む。CSV は文字コードと区切りの決定があるので読み直しのたびに読む） */
  async add(files: InputFile[]): Promise<RejectedFile[]> {
    const rejected: RejectedFile[] = [];
    for (const f of files) {
      if (this.files.some((x) => x.name === f.name)) {
        rejected.push({ file: f.name, reason: "同じ名前の資料がもう入っている" });
        continue;
      }
      const ext = extensionOf(f.name);
      if ((READABLE as Record<string, string>)[ext] === "csv") {
        this.files.push(f);
        continue;
      }
      const r = await readSource(f);
      if (r.rejected) rejected.push(r.rejected);
      else if (r.source) {
        this.files.push(f);
        this.xlsx.set(f.name, r.source);
      }
    }
    this.rejectedFiles.push(...rejected);
    this.composed = null;
    return rejected;
  }

  decisionList(): Decision[] {
    return [...this.decisions.values()];
  }

  /** 決定を置く。同じ質問に置き直すと前の決定と入れ替わる。効いたセルと行の数を返す */
  settle(ds: Decision[]): { cellsAffected: number; rowsAffected: number; unresolved: number } {
    const before = this.analyze().composition.status;
    for (const d of ds) this.decisions.set(d.questionId, d);
    this.composed = null;
    const after = this.analyze().composition.status;
    return diff(before, after);
  }

  /** 決定を取り消す */
  undo(questionId: string): { cellsAffected: number; rowsAffected: number; unresolved: number } {
    const before = this.analyze().composition.status;
    this.decisions.delete(questionId);
    this.composed = null;
    const after = this.analyze().composition.status;
    return diff(before, after);
  }

  analyze(): Analysis {
    const ask = new Asker(this.decisions);
    const sources: SourceFile[] = [];
    const rejected: RejectedFile[] = [...this.rejectedFiles];
    const unreadable: string[] = [];
    for (const f of this.files) {
      const x = this.xlsx.get(f.name);
      if (x) {
        sources.push(x);
        continue;
      }
      // CSV：文字コードと区切りが決まらなければ質問にする。読めないまま終わったら、黙って落とさず理由つきで外すか止める
      let encoding: CsvEncoding | undefined;
      let delimiter: CsvDelimiter | undefined;
      let singleColumn = false;
      let done = false;
      let why = "";
      for (let pass = 0; pass < 3 && !done; pass++) {
        const r = readCsv(f.name, f.bytes, { ...(encoding ? { encoding } : {}), ...(delimiter ? { delimiter } : {}), singleColumn });
        if (r.source) {
          sources.push(r.source);
          done = true;
          break;
        }
        const amb = r.ambiguity[0];
        if (!amb) {
          why = "読めない";
          break;
        }
        why = amb.detail;
        const reject = { id: "reject", label: "この資料を外す（読めないため）" };
        const what = amb.what === "encoding" ? "文字コード" : "区切り";
        const single = amb.what === "delimiter" && amb.candidates.length === 0 ? [{ id: "single", label: "区切りの無い 1 列の表として読む" }] : [];
        // 質問の鍵はファイルの名前と中身の指紋と問いの種類（何回目の読み直しで出たかに依らない。中身の違うファイルには前の答えを当てない）
        const a = ask.ask(`${amb.what}|${f.name}|${fingerprint(f.bytes)}`, {
          kind: amb.what,
          text: `${f.name} の${what}が決まらない（${amb.detail}）`,
          options: [
            ...amb.candidates.map((c) =>
              amb.what === "encoding" ? { id: c, label: ENCODING_LABEL[c as CsvEncoding] ?? c } : { id: c === "\t" ? "tab" : c, label: c === "\t" ? "タブ" : `「${c}」` },
            ),
            ...single,
            reject,
          ],
          valueKind: "option",
          defaultAnswer: amb.what === "delimiter" ? (amb.candidates[0] ? (amb.candidates[0] === "\t" ? "tab" : amb.candidates[0]) : "single") : null,
          sameShapeRows: 1,
          items: [{ file: f.name, sheet: null, cells: [] }],
        });
        if (!a) break;
        if (a === "reject") {
          rejected.push({ file: f.name, reason: `読めないので外した（決定）：${amb.detail}` });
          done = true;
          break;
        }
        if (amb.what === "encoding") encoding = a as CsvEncoding;
        else if (a === "single") singleColumn = true;
        else delimiter = (a === "tab" ? "\t" : a) as CsvDelimiter;
      }
      if (!done) unreadable.push(`${f.name}（${why || "読めない"}）`);
    }
    const layouts = sources.flatMap((s) => layoutFile(s));
    const date1904 = new Map(sources.map((s) => [s.file, s.date1904]));
    const records = buildRecords(layouts, ask, { fiscalYearStartMonth: this.options.facility.fiscalYearStartMonth }, (f) => date1904.get(f) ?? false);
    const linked = link(records, ask);
    const composition = compose(sources, layouts, records, linked, ask, this.decisions, this.options);
    if (unreadable.length) {
      composition.blockers.push(`読めなかった資料 ${unreadable.length}（${unreadable.join("・")}）`);
      composition.plan = null;
    }
    const questions = [...ask.asked.values()];
    return {
      sources,
      rejected,
      layouts,
      records,
      linked,
      composition,
      questions,
      open: ask.open(),
      unusedDecisions: ask.unusedDecisions(),
    };
  }

  /** 計画を作る（止める決まりに当たれば作らず、理由を返す） */
  compose(): Composition {
    this.composed = this.analyze().composition;
    return this.composed;
  }

  /** AI に渡す要約（行の中身は見本の 20 行まで） */
  survey(): Survey {
    const an = this.analyze();
    const files = an.sources.map((s) => ({ fileRef: s.file, sheets: s.sheets.length, rows: s.sheets.reduce((a, g) => a + new Set(g.cells.map((c) => c.r)).size, 0) }));
    const samples: Survey["samples"] = [];
    for (const lay of an.layouts) {
      for (const t of lay.tables) {
        const rows = [...t.headerRows, ...t.rows.filter((r) => r.role === "data" || r.role === "parent").slice(0, 2).map((r) => r.r)];
        for (const r of rows) {
          if (samples.length >= SAMPLE_ROWS) break;
          samples.push({ fileRef: lay.file, row: r, cells: lay.index.rowCells(r).slice(0, SAMPLE_CELLS).map((c) => c.text.slice(0, SAMPLE_TEXT)) });
        }
      }
    }
    const legends = an.layouts.flatMap((l) => l.tables.flatMap((t) => t.legend.map((e) => ({ mark: e.symbol, meaning: e.meaning }))));
    const notes = [
      ...an.layouts.flatMap((l) => l.notes.map((n) => `${l.file} ${n.ref}：${n.text.slice(0, SAMPLE_TEXT)}`)),
      ...an.sources.flatMap((s) => s.ledger.map((e) => `${s.file}${e.sheet ? `「${e.sheet}」` : ""}：${e.detail}（${e.count}）`)),
      ...an.rejected.map((r) => `${r.file}：${r.reason}`),
    ];
    const unresolved = [...an.composition.status.values()].filter((s) => s.s === "unresolved").length;
    const state: Survey["compose"]["state"] = this.composed ? (this.composed.plan ? "done" : "failed") : "idle";
    return {
      files,
      samples,
      legends,
      notes,
      questions: an.open.map((q) => ({
        questionId: q.questionId,
        text: q.text,
        sameShapeRows: q.sameShapeRows,
        defaultAnswer: q.defaultAnswer,
        valueKind: q.valueKind,
        options: q.options.map((o) => ({ id: o.id, label: o.label })),
      })),
      unresolvedCells: unresolved,
      compose: { state, message: this.composed ? (this.composed.plan ? null : this.composed.blockers.join("・")) : null },
    };
  }
}

/** バイト列の指紋（長さと FNV-1a）。中身が同じなら同じ */
function fingerprint(b: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < b.length; i++) {
    h ^= b[i] ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${b.length}.${h.toString(36)}`;
}

function diff(before: Map<string, { s: string }>, after: Map<string, { s: string }>) {
  let cells = 0;
  const rows = new Set<string>();
  for (const [k, v] of after) {
    const b = before.get(k);
    if (!b || b.s !== v.s) {
      cells++;
      const [file, sheet, ref] = k.split("\u0000");
      rows.add(`${file}\u0000${sheet}\u0000${/\d+$/.exec(ref ?? "")?.[0]}`);
    }
  }
  const unresolved = [...after.values()].filter((v) => v.s === "unresolved").length;
  return { cellsAffected: cells, rowsAffected: rows.size, unresolved };
}
