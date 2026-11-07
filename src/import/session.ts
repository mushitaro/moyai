// 取り込みの入口：資料を入れ、要約と質問を読み、決定を置き（取り消せる）、計画を作る。
// 層 1（読み手）だけが形式を知る。層 2〜4 は決定の一覧とともに毎回はじめから読み直す（同じ入力と決定からはいつも同じ出力）。
// AI に渡すのは要約・行番号つきの見本・凡例・注記・質問の候補だけ（plan §2.13）。行の中身をまとめて渡さない。
// 写真は層 1 で読まず並べるだけ（photo.ts）。AI が読んだ格子を置いた写真だけが、ほかの形式と同じ格子として層 2〜4 に入る。
import type { Plan } from "../shared/plan";
import type { CrosswalkSurvey } from "../shared/tools";
import { readCsv, ENCODING_LABEL, type CsvDelimiter, type CsvEncoding } from "./csv";
import type { RejectedFile, SourceFile } from "./grid";
import { extensionOf, READABLE, readSource, type InputFile, type ReadOutcome } from "./read";
import { layoutFile, type SheetLayout } from "./structure";
import { buildRecords, cellKey, type Records } from "./records";
import { activeRules, RuleHits, type LoadedReading } from "./reading";
import { link, type Linked } from "./link";
import { compose, type Composition } from "./compose";
import { renderPdfPage, type PageImage } from "./pdf";
import { Asker, questionShape, type Decision, type QuestionState } from "./questions";
import { PhotoBook, photoMimeOf, photoState, scannedPageInput, type PhotoInput } from "./photo";
import { referenceFiles } from "./reference";

/** 文字の無い PDF の頁を画像に描く倍率（pt → 画素。A4 の頁で長辺がおよそ 1,700 画素。AI に渡すときは写真の道がさらに描き直す） */
const SCANNED_PAGE_SCALE = 2;

export interface IntakeOptions {
  planId: string;
  displayName: string;
  packId: string;
  facility: Plan["facility"];
  /** パックの階層の名前（pack.json の levelNames）。資料の見出しに名前の無い階層は、この名前にする（docs/plan.md §2.2。無ければ「第 n 階層」） */
  defaultLevelNames?: readonly string[];
}

export interface Analysis {
  sources: SourceFile[];
  rejected: RejectedFile[];
  layouts: SheetLayout[];
  records: Records;
  linked: Linked;
  composition: Composition;
  /** 読み方（3 段目の Skill）と、規則ごとに効いたセル */
  readings: LoadedReading[];
  ruleHits: RuleHits;
  questions: QuestionState[];
  open: QuestionState[];
  unusedDecisions: Decision[];
}

/** intake_survey の返すものと同じ形（src/shared/tools.ts）。当てはめの要約（crosswalk）は作業画面の側が足す（app/state/crosswalk.ts） */
export interface Survey {
  files: { fileRef: string; sheets: number; rows: number }[];
  samples: { fileRef: string; row: number; cells: string[] }[];
  legends: { mark: string; meaning: string }[];
  notes: string[];
  questions: {
    questionId: string;
    /** 質問の種類（読み方の answer の規則の question に書く） */
    kind: string;
    text: string;
    sameShapeRows: number;
    defaultAnswer: string | null;
    valueKind: "option" | "number";
    options: { id: string; label: string }[];
    /** 選択肢が、先の質問（この questionId）と同じ並び（options は空にしてある。同じ並びをくり返して送らない） */
    sameOptionsAs?: string;
  }[];
  /**
   * 答えの無い質問を同じ形ごとにまとめた要約（形・件数・行の数・代表の 1 問）。どの質問も数える（questions の大きさの上限で載せなかったものも）。
   * 答えが大きいとき、橋渡しが質問を分けて返す（src/bridge/survey-page.ts）のに使う
   */
  questionGroups?: { kind: string; shape: string; count: number; rows: number; example: { questionId: string; text: string } }[];
  unresolvedCells: number;
  /** 詰まっている所：未解決のセルのある資料ごとの数と、その行の見本（5 行まで）。questionId はその行を決める質問が分かるときだけ */
  stuck: { fileRef: string; cells: number; header: { row: number; cells: string[] }[]; rows: { sheet: string | null; row: number; cells: string[]; unresolved: string[]; questionId: string | null }[] }[];
  compose: { state: "idle" | "running" | "done" | "failed"; message: string | null };
  /** 取り込みは当てはめを持たないので null。作業画面の側が作業中の計画から足す */
  crosswalk: CrosswalkSurvey | null;
}

const SAMPLE_ROWS = 20;
const SAMPLE_CELLS = 40;
/** AI に渡す見本で、費用のセルの代わりに置く字 */
export const COST_MASK = "（費用）";
const SAMPLE_TEXT = 60;
const STUCK_FILES = 20;
const STUCK_ROWS = 5;
/** 注記の数の上限（帳票を何百頁も入れると、頁ごとの頭書きの注記で要約が埋まるため。止まった表の理由は先に置く） */
const NOTES = 60;
/**
 * 1 回の要約に載せる質問の大きさの上限（UTF-8 のバイト）。橋渡しの 1 通の上限（1 MB）の内に、要約のほかの欄の分を残す。
 * 越える分は載せず、件数を注記の先頭に出す（答えて読み直すと、続きの質問が出る）
 */
const QUESTION_BYTES = 600_000;
/** 選択肢の並びを sameOptionsAs で指す下限の数（短い並びはそのまま書く） */
const SHARED_OPTIONS_MIN = 3;
/** 質問の形の要約の数の上限（多い形から） */
const QUESTION_GROUPS = 200;
/** 形の要約の代表の 1 問の文の長さ（字） */
const GROUP_EXAMPLE_TEXT = 200;

export class IntakeSession {
  private readonly files: InputFile[] = [];
  /** 資料 → 中身の SHA-256（質問の鍵に使う。中身の違うファイルに前の答えを当てない） */
  private readonly digests = new WeakMap<InputFile, string>();
  private readonly xlsx = new Map<string, SourceFile>();
  private readonly rejectedFiles: RejectedFile[] = [];
  private decisions = new Map<string, Decision>();
  private composed: Composition | null = null;
  /** 当てる読み方（承認済みの読み方と、作業中の版の下書き） */
  private readings: LoadedReading[] = [];
  /**
   * 写真（photo.ts）。層 1 では読まず並べるだけで、AI が読んだ格子を置いたものだけを層 2〜4 に渡す。
   * 読み直し（セッションを作り直す）をまたいで同じものを使えるよう、外から渡せる。
   */
  readonly photos: PhotoBook;
  /** 写真の一覧に並べた、文字の無い PDF の頁（"<資料>#<頁>"） */
  private readonly toPhotoBook = new Set<string>();
  constructor(
    readonly options: IntakeOptions,
    photos?: PhotoBook,
    /** Excel と PDF の読み手（取り込みの worker が、資料ごとの覚えを挟むときに渡す。無ければ readSource） */
    private readonly read: (f: InputFile) => Promise<ReadOutcome> = readSource,
  ) {
    this.photos = photos ?? new PhotoBook();
  }

  /** 文字の無い頁（写真の道に回す頁）：資料と頁の番号 */
  scannedPages(): { file: string; page: number }[] {
    return [...this.xlsx.values()].flatMap((s) => (s.pages ?? []).filter((p) => p.scanned).map((p) => ({ file: s.file, page: p.page })));
  }

  /** PDF の頁を描いた画像（PNG）。文字の無い頁を写真の道の入口に渡すためのもの（つなぐのは呼ぶ側） */
  async pageImage(file: string, page: number, scale?: number): Promise<PageImage> {
    const f = this.files.find((x) => x.name === file);
    if (!f || this.xlsx.get(file)?.format !== "pdf") throw new Error(`PDF の資料ではない：${file}`);
    return renderPdfPage(f.bytes, page, scale === undefined ? {} : { scale });
  }

  /** 写真を並べる（読まない）。文字の無い PDF の頁も、photo.ts の scannedPageInput で作ってここへ渡す */
  async addPhotos(inputs: PhotoInput[]): Promise<RejectedFile[]> {
    const rejected = await this.listPhotos(inputs);
    this.rejectedFiles.push(...rejected);
    this.composed = null;
    return rejected;
  }

  private async listPhotos(inputs: PhotoInput[]): Promise<RejectedFile[]> {
    const rejected: RejectedFile[] = [];
    for (const p of inputs) {
      const r = await this.photos.list(p);
      if (r) rejected.push(r);
    }
    return rejected;
  }

  /** 資料を入れる（Excel と PDF はここで読む。CSV は文字コードと区切りの決定があるので読み直しのたびに読む。写真は並べるだけ） */
  async add(files: InputFile[]): Promise<RejectedFile[]> {
    const rejected: RejectedFile[] = [];
    for (const f of files) {
      if (this.files.some((x) => x.name === f.name)) {
        rejected.push({ file: f.name, reason: "同じ名前の資料がもう入っている" });
        continue;
      }
      const mime = photoMimeOf(f.name);
      if (mime) {
        rejected.push(...(await this.listPhotos([{ name: f.name, bytes: f.bytes, mimeType: mime, origin: { kind: "file" } }])));
        continue;
      }
      const ext = extensionOf(f.name);
      if ((READABLE as Record<string, string>)[ext] === "csv") {
        this.digests.set(f, await sha256Hex(f.bytes));
        this.files.push(f);
        continue;
      }
      const r = await this.read(f);
      if (r.rejected) rejected.push(r.rejected);
      else if (r.source) {
        this.files.push(f);
        this.xlsx.set(f.name, r.source);
        // 文字の無い頁（スキャン）：頁を画像に描き、写真の一覧に並べる（人が 1 枚ずつ許して AI クライアントに読ませるか、外す）。
        // 描けなかった頁だけは、写真の道に渡せないので質問に残す（黙って落とさない）
        for (const p of (r.source.pages ?? []).filter((x) => x.scanned)) {
          const key = `${f.name}#${p.page}`;
          // 読み直し（同じ写真の一覧を渡したセッション）では、もう並んでいる
          if (this.photos.get(scannedPageInput(f.name, p.page, { bytes: new Uint8Array(), mimeType: "image/png" }).name)) {
            this.toPhotoBook.add(key);
            continue;
          }
          try {
            const img = await renderPdfPage(f.bytes, p.page, { scale: SCANNED_PAGE_SCALE });
            rejected.push(...(await this.listPhotos([scannedPageInput(f.name, p.page, { bytes: img.png, mimeType: "image/png" })])));
            this.toPhotoBook.add(key);
          } catch {
            // 描けない頁（復号に wasm の要る画像など）：質問に残す
          }
        }
      }
    }
    this.rejectedFiles.push(...rejected);
    this.composed = null;
    return rejected;
  }

  private digestOf(f: InputFile): string {
    const d = this.digests.get(f);
    if (d === undefined) throw new Error("資料の指紋が無い（add を通っていない資料）");
    return d;
  }

  decisionList(): Decision[] {
    return [...this.decisions.values()];
  }

  /** 決定を置く。同じ質問に置き直すと前の決定と入れ替わる。効いたセルと行の数を返す */
  // 置く前の読み取り（before）を呼ぶ側が持っていれば、それを使う（厚い資料では analyze 1 回が数秒。settle 1 回で analyze を 1 回にする。Architect の 63）
  settle(ds: Decision[], before?: Analysis): { cellsAffected: number; rowsAffected: number; unresolved: number } {
    const b = (before ?? this.analyze()).composition.status;
    for (const d of ds) this.decisions.set(d.questionId, d);
    this.composed = null;
    this.after = this.analyze();
    return diff(b, this.after.composition.status);
  }

  /** 決定を取り消す */
  undo(questionId: string, before?: Analysis): { cellsAffected: number; rowsAffected: number; unresolved: number } {
    const b = (before ?? this.analyze()).composition.status;
    this.decisions.delete(questionId);
    this.composed = null;
    this.after = this.analyze();
    return diff(b, this.after.composition.status);
  }

  /** 直前の settle・undo のあとの読み取り（呼ぶ側が読み直さずに使えるように）。取ると空にする */
  takeAfter(): Analysis | null {
    const a = this.after;
    this.after = null;
    return a;
  }
  private after: Analysis | null = null;

  /** 当てる読み方を置き換える（承認済みの読み方と、作業中の版の下書き）。次の analyze から効く */
  setReadings(readings: readonly LoadedReading[]): void {
    this.readings = [...readings];
  }
  getReadings(): LoadedReading[] {
    return [...this.readings];
  }

  analyze(): Analysis {
    const rules = activeRules(this.readings);
    const hits = new RuleHits();
    const ask = new Asker(this.decisions, rules, hits);
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
        const a = ask.ask(`${amb.what}|${f.name}|${this.digestOf(f)}`, {
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
    // 文字の無い頁（スキャン）のうち、画像に描けず写真の一覧に並べられなかった頁：推し量って読まず、人が外すと決めるまで計画を作らない
    const toPhoto: string[] = [];
    for (const s of sources) {
      const scanned = (s.pages ?? []).filter((p) => p.scanned && !this.toPhotoBook.has(`${s.file}#${p.page}`)).map((p) => p.page);
      if (!scanned.length) continue;
      const a = ask.ask(`photoRoute|${s.file}|${scanned.join(",")}`, {
        kind: "photoRoute",
        text: `${s.file} の ${scanned.join("・")} 頁は文字が無い（スキャンの頁）が、画像に描けなかったので写真の道に渡せない。推し量って読まない。どうするか`,
        options: [{ id: "exclude", label: "この頁を読まずに外す（理由を残す）" }],
        valueKind: "option",
        defaultAnswer: null,
        sameShapeRows: scanned.length,
        items: [{ file: s.file, sheet: null, cells: [], note: scanned.map((p) => `${p} 頁`).join("・") }],
      });
      if (a !== "exclude") toPhoto.push(`${s.file}（${scanned.join("・")} 頁）`);
    }
    // 写真：AI が読んだ格子を置いたものだけを、ほかの形式と同じ格子として渡す。人が読まずに外したものは理由つきで数える
    sources.push(...this.photos.sources());
    rejected.push(...this.photos.excludedFiles());
    const layouts = sources.flatMap((s) => layoutFile(s, rules, hits));
    const date1904 = new Map(sources.map((s) => [s.file, s.date1904]));
    // 参考として外すと決めた資料（reference.ts）：記録を作らず、セルは「参考の資料」として外す。計画は残りの資料で作る
    const reference = referenceFiles(sources, ask);
    const used = reference.size ? layouts.filter((l) => !reference.has(l.file)) : layouts;
    const records = buildRecords(used, ask, { fiscalYearStartMonth: this.options.facility.fiscalYearStartMonth }, (f) => date1904.get(f) ?? false);
    const linked = link(records, ask, rules, hits);
    const composition = compose(sources, layouts, records, linked, ask, this.decisions, this.options, reference);
    if (unreadable.length) {
      composition.blockers.push(`読めなかった資料 ${unreadable.length}（${unreadable.join("・")}）`);
      composition.plan = null;
    }
    if (toPhoto.length) {
      composition.blockers.push(`画像に描けなかった文字の無い頁 ${toPhoto.length}（${toPhoto.join("・")}）`);
      composition.plan = null;
    }
    // 読んでいない写真（人が AI に渡して読ませるか、読まずに外すまで）。黙って落とさない
    const unreadPhotos = this.photos.unread();
    if (unreadPhotos.length) {
      composition.blockers.push(`読んでいない写真 ${unreadPhotos.length}（${unreadPhotos.map((e) => e.input.name).join("・")}）`);
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
      readings: [...this.readings],
      ruleHits: hits,
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

  /** AI に渡す要約（行の中身は見本の 20 行まで）。読み取り（an）を呼ぶ側が持っていれば、それを使う（読み直さない） */
  survey(an: Analysis = this.analyze()): Survey {
    const files = an.sources.map((s) => ({ fileRef: s.file, sheets: s.sheets.length, rows: s.sheets.reduce((a, g) => a + new Set(g.cells.map((c) => c.r)).size, 0) }));
    // 見本は資料ごとに分けて取る（1 つの資料の表が多くても、ほかの資料の見出しが見えるように）。資料ごとの枠に余りが出たら、次の巡で足す
    const samples: Survey["samples"] = [];
    // 費用の列のセルは、見出しの行のほかは字を伏せる（AI に費用の値を渡さない。運営者の決定 A 案・Architect の注文 1。列の見出しと件数だけが渡る）
    const costCols = new Map<SheetLayout, { top: number; bottom: number; head: Set<number>; c: number }[]>();
    for (const lay of an.layouts)
      costCols.set(
        lay,
        lay.tables.flatMap((t) => t.cols.filter((c) => c.role === "cost").map((c) => ({ top: t.top, bottom: t.bottom, head: new Set(t.headerRows), c: c.c }))),
      );
    const masked = (lay: SheetLayout, r: number, c: number) => (costCols.get(lay) ?? []).some((x) => x.c === c && r >= x.top && r <= x.bottom && !x.head.has(r));
    const rowText = (lay: SheetLayout, r: number) => lay.index.rowCells(r).slice(0, SAMPLE_CELLS).map((c) => (masked(lay, r, c.c) ? COST_MASK : c.text.slice(0, SAMPLE_TEXT)));
    const perFile = new Map<string, { lay: SheetLayout; r: number }[]>();
    for (const lay of an.layouts) {
      const xs = perFile.get(lay.file) ?? [];
      perFile.set(lay.file, xs);
      for (const t of lay.tables) for (const r of [...t.headerRows, ...t.rows.filter((r) => r.role === "data" || r.role === "parent").slice(0, 2).map((r) => r.r)]) xs.push({ lay, r });
    }
    const queues = [...perFile.entries()];
    for (let i = 0; samples.length < SAMPLE_ROWS && queues.some(([, xs]) => xs.length > i); i++) {
      for (const [file, xs] of queues) {
        const x = xs[i];
        if (!x || samples.length >= SAMPLE_ROWS) continue;
        samples.push({ fileRef: file, row: x.r, cells: rowText(x.lay, x.r) });
      }
    }
    samples.sort((a, b) => queues.findIndex(([f]) => f === a.fileRef) - queues.findIndex(([f]) => f === b.fileRef));
    // 凡例：表に付けたものと、付ける星取表の形の表が無かったもの（年度の列が読めないなど。読み手は記号の意味を知っている）
    const legends = an.layouts.flatMap((l) => [...l.tables.flatMap((t) => t.legend), ...l.looseLegends].map((e) => ({ mark: e.symbol, meaning: e.meaning })));
    const notes = [
      ...an.layouts.flatMap((l) => l.notes.map((n) => `${l.file} ${n.ref}：${n.text.slice(0, SAMPLE_TEXT)}`)),
      ...an.sources.flatMap((s) => s.ledger.map((e) => `${s.file}${e.sheet ? `「${e.sheet}」` : ""}：${e.detail}（${e.count}）`)),
      // 契約・発注の一覧として読んだ資料：契約の件数だけ（件名・業者・金額は渡さない）
      ...[...an.records.contracts.filter((c) => !c.line).reduce((m, c) => m.set(c.file, (m.get(c.file) ?? 0) + 1), new Map<string, number>())].map(
        ([file, n]) => `${file}：契約の一覧として読んだ（契約 ${n} 件。作業にはしない。件名と期間の合う作業と結ぶかは、まとめた 1 問で聞く）`,
      ),
      // 発注明細として読んだ資料：明細の行の数と、号炉・機器・作業を取り出せた行の数だけ（品名・業者・金額は渡さない）
      ...[
        ...an.records.contracts
          .filter((c) => !!c.line)
          .reduce((m, c) => {
            const x = m.get(c.file) ?? { n: 0, t: 0 };
            return m.set(c.file, { n: x.n + 1, t: x.t + (c.line?.target ? 1 : 0) });
          }, new Map<string, { n: number; t: number }>()),
      ].map(
        ([file, x]) =>
          `${file}：発注明細として読んだ（明細 ${x.n} 行。品名・仕様から号炉・機器・作業を取り出せた行 ${x.t}。ほかの資料の機器と名前と号炉が同じ行だけ、結ぶかをまとめた 1 問で聞く。取り出せない行は作業にしない）`,
      ),
      ...an.rejected.map((r) => `${r.file}：${r.reason}`),
      ...this.photos
        .entries()
        .filter((e) => photoState(e) === "unread")
        .map((e) => `${e.input.name}：写真（まだ読んでいない。人が画面で AI クライアントに渡すことを許した写真だけを、photo_transcribe で受け取れる）`),
    ];
    const unresolved = [...an.composition.status.values()].filter((s) => s.s === "unresolved").length;
    const stuck = new Map<string, Survey["stuck"][number]>();
    for (const lay of an.layouts) {
      const byRow = new Map<number, { refs: string[]; q: string | null }>();
      for (const cell of lay.grid.cells) {
        const st = an.composition.status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref }));
        if (st?.s !== "unresolved") continue;
        const e = stuck.get(lay.file) ?? { fileRef: lay.file, cells: 0, header: [], rows: [] };
        stuck.set(lay.file, e);
        e.cells++;
        const r = byRow.get(cell.r) ?? { refs: [], q: st.questionId };
        byRow.set(cell.r, r);
        r.refs.push(cell.ref);
      }
      const e = stuck.get(lay.file);
      if (!e) continue;
      for (const [r, x] of [...byRow].sort((a, b) => a[0] - b[0])) {
        if (e.rows.length >= STUCK_ROWS) break;
        // 最初に見本にした行の表の見出し（無ければ表の外の行）
        if (!e.rows.length) for (const h of lay.tables.find((t) => r >= t.top && r <= t.bottom)?.headerRows.slice(0, 3) ?? []) e.header.push({ row: h, cells: rowText(lay, h) });
        e.rows.push({ sheet: lay.sheet, row: r, cells: rowText(lay, r), unresolved: x.refs.slice(0, SAMPLE_CELLS), questionId: x.q });
      }
    }
    // 止まっている表の理由（注記に足す）：表の形と、読めていない欄。質問の無い未解決のセルが残る表だけ
    const why = new Map<string, string>();
    for (const lay of an.layouts)
      for (const t of lay.tables) {
        let silent = 0;
        for (const cell of lay.grid.cells) {
          if (cell.r < t.top || cell.r > t.bottom) continue;
          const st = an.composition.status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref }));
          if (st?.s === "unresolved" && !st.questionId) silent++;
        }
        if (!silent) continue;
        const has = (...rs: string[]) => t.cols.some((c) => rs.includes(c.role)) || !!t.head?.some((h) => rs.includes(h.cue));
        const missing =
          t.shape === "events"
            ? [!has("date", "end") && "日付", !has("assetRef", "tag", "name") && !t.cols.some((c) => c.compound) && "機器", !has("workName", "workTitle") && "作業の名前"].filter(Boolean)
            : t.shape === "tree"
              ? [!has("name", "hier") && "機器の名前"].filter(Boolean)
              : [];
        const shape = t.shape === "events" ? "作業の表" : t.shape === "grid" ? "星取表の形の表" : t.shape === "contracts" ? "契約の一覧" : t.shape === "orderLines" ? "発注明細" : "機器の木の表";
        const key = `${lay.file}\u0000${t.form}`;
        if (why.has(key)) continue;
        why.set(key, `${lay.file}${lay.sheet ? `「${lay.sheet}」` : ""} ${t.top}〜${t.bottom} 行目の表が止まっている：${shape}${missing.length ? `で、${missing.join("・")}の欄が読めていない` : ""}（質問の無い未解決のセル ${silent}）`);
      }
    // 読み方の規則が効かなかった・読み手の読み方を止めたこと（同じ様式の表は 1 つにまとめる）：いちばん先に出す
    const ruleNotes = [...new Set(an.layouts.flatMap((l) => l.tables.flatMap((t) => t.cols.flatMap((c) => (c.ruleNotes ?? []).map((n) => `${l.file}：${n}`)))))].slice(0, STUCK_FILES);
    const shownNotes = [...ruleNotes, ...[...why.values()].slice(0, STUCK_FILES), ...notes];
    const moreNotes = shownNotes.length - NOTES;
    const cappedNotes = moreNotes > 0 ? [...shownNotes.slice(0, NOTES), `注記はほかに ${moreNotes} 件（頁ごとの頭書き・表の下の記入欄など）`] : shownNotes;
    const state: Survey["compose"]["state"] = this.composed ? (this.composed.plan ? "done" : "failed") : "idle";
    // 質問は大きさの上限まで（分けて返す）。載せなかった件数は注記の先頭に。
    // 同じ選択肢の並び（列の役目の選択肢など）は先の質問だけに書き、後の質問は sameOptionsAs で指す（橋渡しが答えごとに書き直す）
    const enc = new TextEncoder();
    const questions: Survey["questions"] = [];
    const firstWithOptions = new Map<string, string>();
    let bytes = 0;
    for (const q of an.open) {
      const options = q.options.map((o) => ({ id: o.id, label: o.label }));
      const ok = options.length >= SHARED_OPTIONS_MIN ? JSON.stringify(options) : null;
      const same = ok === null ? undefined : firstWithOptions.get(ok);
      if (ok !== null && same === undefined) firstWithOptions.set(ok, q.questionId);
      const x = {
        questionId: q.questionId,
        kind: q.kind,
        text: q.text,
        sameShapeRows: q.sameShapeRows,
        defaultAnswer: q.defaultAnswer,
        valueKind: q.valueKind,
        options: same === undefined ? options : [],
        ...(same === undefined ? {} : { sameOptionsAs: same }),
      };
      bytes += enc.encode(JSON.stringify(x)).length + 1;
      if (bytes > QUESTION_BYTES && questions.length) break;
      questions.push(x);
    }
    const restQuestions = an.open.length - questions.length;
    // 同じ形の質問の要約（どの質問も数える）。多い形から
    const groups = new Map<string, NonNullable<Survey["questionGroups"]>[number] & { first: number }>();
    an.open.forEach((q, i) => {
      const shape = questionShape(q.text);
      const k = `${q.kind}\u0000${shape}`;
      const g = groups.get(k);
      if (g) {
        g.count++;
        g.rows += q.sameShapeRows;
      } else groups.set(k, { kind: q.kind, shape, count: 1, rows: q.sameShapeRows, example: { questionId: q.questionId, text: q.text.slice(0, GROUP_EXAMPLE_TEXT) }, first: i });
    });
    const questionGroups = [...groups.values()]
      .sort((a, b) => b.count - a.count || a.first - b.first)
      .slice(0, QUESTION_GROUPS)
      .map(({ first: _first, ...g }) => g);
    return {
      files,
      samples,
      legends,
      notes: restQuestions > 0 ? [`質問はほかに ${restQuestions} 件（1 回の答えの大きさの上限のため。載せた質問に答えて読み直すと、続きが出る）`, ...cappedNotes] : cappedNotes,
      questions,
      questionGroups,
      unresolvedCells: unresolved,
      stuck: [...stuck.values()].sort((a, b) => b.cells - a.cells).slice(0, STUCK_FILES),
      compose: { state, message: this.composed ? (this.composed.plan ? null : this.composed.blockers.join("・")) : null },
      crosswalk: null,
    };
  }
}

/** バイト列の SHA-256（16 進）。ブラウザでも Node でも WebCrypto で取る */
async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
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
