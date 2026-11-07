// 取り込みの作業場（このタブのメモリだけ）。取り込みの画面と、AI のツールの受け手（tab-tools.ts）が同じ 1 つを使う。
// 資料・決定・計画を作る進みを持ち、計画ができたら作業中の計画の置き場（state/plan-store.ts）に置く。
// 決定は、人の答えも AI の答えも、受け手の同じ確かめ（その質問が今出している選択肢か）を通す。
// 資料を読み、読み取る（IntakeSession）のは受け手（intake-host.ts）。画面のタブでは受け手を worker に置き、主のスレッドを止めない。
// 画面が同期で読む所（質問の一覧・数・要約）は、受け手から返った最新の写し（view）を読み、写しが変わったら知らせる。
// worker の無い所（vitest の node）では、受け手を同じスレッドに置き、今までと同じ同期の形（analysis・settle・survey など）でも読める。
// React を持たない純粋な TS にして、試験（vitest）から工場の資料で動かせるようにする。
import type { Analysis, IntakeOptions, Survey } from "../../import";
import { PhotoBook, photoMimeOf, type PhotoCellRead, type PhotoInput, type ReviewOutcome, type PlaceOutcome } from "../../import/photo";
import { CellIndex, type SheetGrid } from "../../import/grid";
import type { CellStatus } from "../../import/compose";
import type { Match } from "../../import/match";
import { isPlanRule, type LoadedReading, type ReadingRule, type ReadingScope } from "../../import/reading";
import { setCurrentReadings } from "../state/readings";
import type { Decision, QuestionKind } from "../../import/questions";
import { PhotoDesk } from "./photos";
import type { TabSentCode } from "../../shared/errors";
import type { Plan } from "../../shared/plan";
import { placeComposedPlan } from "../state/crosswalk";
import { packLevelNames } from "../chart/catalog";
import { TEXT } from "../text";
import { SameThreadEngine, type IntakeEngine } from "./engine";
import { IntakeHost } from "./intake-host";
import type { CellPos, IntakeRequest, IntakeView, PhotoCall, QuestionView, ReplyOf } from "./worker-protocol";

export { answerOffered } from "./intake-host";
export type { IntakeView, QuestionView, CellPos } from "./worker-protocol";

/** 1 ファイルの上限（§2.12） */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;

export interface WorkspaceSettings {
  packId: string;
  facilityName: string;
  fiscalYearStartMonth: number;
  fictional: boolean;
}

export type ComposeState =
  | { state: "idle" }
  | { state: "running"; startedAt: string; by: "human" | "ai" }
  | { state: "done"; startedAt: string; by: "human" | "ai"; plan: Plan }
  | { state: "failed"; startedAt: string; by: "human" | "ai"; blockers: string[] };

export interface Notice {
  id: number;
  at: string;
  /** ai：AI がツールで何かをした／unknown：AI に「結果不明」と返した／info：画面が自分でしたこと（当てはめの引き継ぎなど） */
  kind: "ai" | "unknown" | "info";
  text: string;
}

/** 落とされたファイル（File API の File と同じ形の一部）。bytes は呼ぶたびに新しい配列を返す（worker へ移すので） */
export interface DroppedFile {
  name: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

export type SettleOutcome =
  | { ok: true; cellsAffected: number; rowsAffected: number; unresolved: number }
  | { ok: false; code: Extract<TabSentCode, "unknown_question" | "answer_not_offered" | "human_decided">; questionId: string };

/** 画面が開いた 1 つのシート（セルを位置で引く表と、セルの位置ごとの行き先） */
export interface SheetData {
  file: string;
  sheet: string | null;
  sheetIndex: number;
  grid: SheetGrid;
  index: CellIndex;
  /** セルの位置 → 行き先（データ・除外のセルには、決めた質問の ID の並び qs。SheetWire の status と同じ値） */
  status: Map<string, CellStatus>;
}

/** 結ぶ質問の種類（AI だけで結んだものの一覧に出す） */
export const LINK_KINDS: ReadonlySet<QuestionKind> = new Set<QuestionKind>([
  "assetLink",
  "assetLinkOne",
  "assetUnmatched",
  "eventAsset",
  "eventAssetOne",
  "workLink",
  "workLinkOne",
  "workJoin",
  "duplicateAsset",
]);

const NOTICES_MAX = 50;

/** 同じスレッドの受け手なら値、worker なら Promise（試験は同期の形を使い、画面とツールは待つ形を使う） */
export type Maybe<T> = T | Promise<T>;

export function andThen<T, U>(x: Maybe<T>, f: (v: T) => Maybe<U>): Maybe<U> {
  return x instanceof Promise ? x.then(f) : f(x);
}

function sync<T>(x: Maybe<T>): T {
  if (x instanceof Promise) throw new Error("同期の呼び出しは、受け手が同じスレッドのときだけ（worker のときは Async の形を使う）");
  return x;
}

/** 資料がまだ無いときの写し */
const EMPTY_VIEW: IntakeView = {
  at: -1,
  files: [],
  rejected: [],
  counts: [],
  blockers: [],
  questions: [],
  open: [],
  decisions: [],
  unusedDecisions: [],
  unresolvedCells: 0,
  fictionalMark: false,
  ruleHits: {},
  photoReview: { assets: 0, details: 0, photos: 0, byFile: {} },
  sheets: [],
};

/** 施設の名前から作る短い鍵（FNV-1a。秘密ではなく、ぶつかりにくい名前を作るだけ） */
function nameKey(name: string): string {
  let h = 0x811c9dc5;
  for (const ch of name.normalize("NFKC").trim()) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

function now(): string {
  return new Date().toISOString();
}

/**
 * 主のスレッドの写真の一覧（受け手を worker に置くとき）。人と AI の操作は、ここで確かめて答え、通ったものを worker の中の一覧にも同じ引数でする
 * （同じ操作を同じ順にするので、2 つの一覧は同じになる）
 */
class MirroredPhotoBook extends PhotoBook {
  constructor(private readonly forward: (p: PhotoCall) => void) {
    super();
  }
  private pass<T extends string>(r: T, p: PhotoCall): T {
    if (r === "ok") this.forward(p);
    return r;
  }
  override place(name: string, reading: { width: number; height: number; cells: Omit<PhotoCellRead, "aiText" | "author">[] }, at: string, conversation: string | null): PlaceOutcome {
    return this.pass(super.place(name, reading, at, conversation), { call: "place", name, reading, at, conversation });
  }
  override correct(name: string, row: number, col: number, text: string): ReviewOutcome {
    return this.pass(super.correct(name, row, col, text), { call: "correct", name, row, col, text });
  }
  override discard(name: string): ReviewOutcome {
    return this.pass(super.discard(name), { call: "discard", name });
  }
  override confirm(name: string, reason: string, at: string): ReviewOutcome {
    return this.pass(super.confirm(name, reason, at), { call: "confirm", name, reason, at });
  }
  override unconfirm(name: string): ReviewOutcome {
    return this.pass(super.unconfirm(name), { call: "unconfirm", name });
  }
  override exclude(name: string, at: string): ReviewOutcome {
    return this.pass(super.exclude(name, at), { call: "exclude", name, at });
  }
  override include(name: string): ReviewOutcome {
    return this.pass(super.include(name), { call: "include", name });
  }
}

export class IntakeWorkspace {
  private readonly engine: IntakeEngine;
  /** 受け手の取り込みに渡した設定（計画の ID・パック・施設） */
  private opts: IntakeOptions;
  /** 資料として持ったものの名前 */
  private inputs: string[] = [];
  /** AI がデモ（source: demo）で入れた資料の名前（userFileNames） */
  private readonly demoInputs = new Set<string>();
  private tooLarge: { file: string; reason: string }[] = [];
  /** 受け手から返った最新の写し */
  private copy: IntakeView | null = null;
  private composeRun: Promise<void> = Promise.resolve();
  private noticeSeq = 0;
  private readonly listeners = new Set<() => void>();
  /** 変わるたびに 1 つ増える（画面はこれで描き直す） */
  version = 0;
  compose: ComposeState = { state: "idle" };
  notices: Notice[] = [];
  /** 写真の一覧と読み取り（読み直しで取り込みを作り直しても、同じものを使う） */
  readonly photoBook: PhotoBook;
  /** 写真を AI に渡す記録と、写真のツールの受け手・人の確かめの操作 */
  readonly photos: PhotoDesk;
  /** 資料の読込の進み（読んでいる間だけ。画面の下の帯に出す） */
  readProgress: { done: number; total: number } | null = null;
  private readChain: Promise<void> = Promise.resolve();

  /** 当てる読み方：承認済みの読み方（保管先から）と、作業中の版の下書き（会話で置いたもの） */
  private readings: LoadedReading[] = [];

  /** engine が無ければ、受け手を同じスレッドに置く（試験と、worker の無い所） */
  constructor(
    public settings: WorkspaceSettings,
    engine?: IntakeEngine,
  ) {
    if (engine) {
      this.engine = engine;
      this.photoBook = new MirroredPhotoBook((photo) => this.engine.post({ op: "photo", photo }, this.dataVersion));
      engine.onFault((why) => this.note("info", why === "fallback" ? TEXT.intake.workerFallback : TEXT.intake.workerStopped));
    } else {
      this.photoBook = new PhotoBook();
      this.engine = new SameThreadEngine(new IntakeHost(this.photoBook));
    }
    this.opts = this.optionsOf(settings);
    this.engine.post({ op: "open", options: this.opts }, this.dataVersion);
    this.photos = new PhotoDesk(
      () => this.photoBook,
      // 写真の読み取りが変わったら読み直させる（同じスレッドの受け手は一覧を共にする。worker には一覧の操作そのものも届いている）
      (data) => {
        if (data) this.send({ op: "touch" }, true);
        this.changed(data);
      },
      (kind, text) => this.note(kind, text),
    );
  }

  /** 開いた版の計画の ID（版 1 で一度だけ作り、そのあとは施設の名前から作り直さない。台帳の中-8） */
  private pinnedPlanId: string | null = null;
  /** 開いた版の資料を戻せなかった理由（戻せないまま作り直すと、前の版の明細が消えるので、計画を作らせない） */
  private restoreFailed: string | null = null;

  /** 開いた版の計画の ID に固定する（名前を変えても、同じ計画に版を重ねる） */
  pinPlanId(planId: string): void {
    this.pinnedPlanId = planId;
    this.opts = { ...this.opts, planId, facility: { ...this.opts.facility, facilityKey: planId } };
    this.send({ op: "options", options: this.opts, reread: false }, false);
    this.changed(false);
  }

  /** 開いた版の資料を戻せなかった（理由を出し、計画を作らせない。黙って残りの資料だけで組み直さない。Architect の縛り 5） */
  blockRestore(reason: string | null): void {
    this.restoreFailed = reason;
    this.changed(true);
  }

  /** その理由で止めているときだけ外す（版を開くのをやめたとき） */
  clearBlock(reason: string): void {
    if (this.restoreFailed === reason) this.blockRestore(null);
  }

  private optionsOf(s: WorkspaceSettings): IntakeOptions {
    // 計画の ID は、パックと施設の名前から作る（同じパックの別の施設とぶつからない。同じ施設は版を重ねる）。版を開いたら、その版の ID に固定する
    const key = this.pinnedPlanId ?? `intake-${s.packId}-${nameKey(s.facilityName)}`;
    return {
      planId: key,
      displayName: s.facilityName,
      packId: s.packId,
      defaultLevelNames: packLevelNames(s.packId),
      facility: {
        facilityKey: key,
        name: s.facilityName,
        fiscalYearStartMonth: s.fiscalYearStartMonth,
        scale: null,
        scaleUnit: null,
        legalFlags: [],
        fictional: s.fictional,
        inNationalTable: null,
      },
    };
  }

  /** 今の計画の ID（試験で、施設ごとに違うことを確かめる） */
  planIdForTest(): string {
    return this.opts.planId;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    this.version++;
    this.notify();
  }

  /** 知らせるだけ（版を進めない）。読込の進みは下の帯だけが読むので、画面の全体を描き直させない */
  private notify(): void {
    for (const l of this.listeners) l();
  }

  /** 資料と決定が変わるたびに 1 つ増える（読み直しはこれで決める。名前の変更では読み直さない） */
  private dataVersion = 0;

  /** 変わったことを知らせる。data なら資料と決定の版を進め、写しを取り直す */
  private changed(resetCompose = true, data = false): void {
    if (resetCompose && this.compose.state !== "running") this.compose = { state: "idle" };
    if (data) {
      this.dataVersion++;
      this.scheduleRefresh();
    }
    this.emit();
  }

  /** 受け手に答えを待たない要求を送る。data なら先に資料と決定の版を進め、写しを取り直す（知らせるのは呼ぶ側の changed） */
  private send(req: IntakeRequest, data: boolean): void {
    if (data) this.dataVersion++;
    this.engine.post(req, this.dataVersion);
    if (data) this.scheduleRefresh();
  }

  // ─── 写し ────────────────────────────────────────────────────

  /**
   * 画面とツールが同期で読む写し。同じスレッドの受け手なら、古ければその場で作り直す。
   * worker なら最後に受けた写し（資料と決定が変わってから新しい写しが届くまでは、ひとつ前のもの）
   */
  get view(): IntakeView {
    const h = this.engine.local;
    if (h) {
      if (this.copy?.at !== this.dataVersion) this.copy = h.applySync({ op: "view" }, this.dataVersion);
      return this.copy;
    }
    return this.copy ?? EMPTY_VIEW;
  }

  private refreshing = false;
  private readonly waiters: { min: number; force: boolean; resolve: () => void; reject: (e: Error) => void }[] = [];

  /** 写しを取り直す（worker のとき）。読込の途中は、待っている呼び出しが無ければ、読み終わるまで取り直さない（間を詰める） */
  private scheduleRefresh(): void {
    if (this.engine.local || this.refreshing) return;
    this.refreshing = true;
    queueMicrotask(() => void this.refreshLoop());
  }

  private needRefresh(): boolean {
    const at = this.copy?.at ?? -1;
    if (at >= this.dataVersion) return false;
    return !this.readProgress || this.waiters.some((w) => w.force && w.min > at);
  }

  private async refreshLoop(): Promise<void> {
    try {
      while (this.needRefresh()) {
        const v = await this.engine.request({ op: "view" }, this.dataVersion);
        if (v.at >= (this.copy?.at ?? -1)) {
          this.copy = v;
          this.wake();
          this.emit();
        }
      }
    } catch (e) {
      // 受け手が答えない：待っている呼び出しを誤りで終える（次に資料や決定が変わるまで、取り直さない）
      const err = e instanceof Error ? e : new Error(String(e));
      for (const w of this.waiters.splice(0)) w.reject(err);
      this.refreshing = false;
      return;
    }
    this.refreshing = false;
    // 取り直している間に、待つ呼び出しが来たか読み終わった
    if (this.needRefresh()) this.scheduleRefresh();
  }

  private wake(): void {
    const at = this.copy?.at ?? -1;
    for (let i = this.waiters.length - 1; i >= 0; i--) {
      const w = this.waiters[i]!;
      if (w.min <= at) {
        this.waiters.splice(i, 1);
        w.resolve();
      }
    }
  }

  /**
   * 写しが、今までの資料と決定の変わりを含むまで待つ（ツールは古い写しで答えない）。
   * force：読込の途中でも取り直す（ツール）。false なら読み終わってからの 1 回を待つ（画面）
   */
  fresh(min = this.dataVersion, force = true): Promise<void> {
    if (this.engine.local || (this.copy?.at ?? -1) >= min) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.waiters.push({ min, force, resolve, reject });
      this.scheduleRefresh();
    });
  }

  /** 新しい写し（worker なら、今までの変わりを含む写しが届くのを待つ） */
  viewWith(): Maybe<IntakeView> {
    return this.engine.local ? this.view : this.fresh().then(() => this.view);
  }

  /** 1 つの資料のシート（画面が開いた資料だけ。セルと行き先） */
  async sheets(file: string): Promise<SheetData[]> {
    const ws = await this.engine.request({ op: "sheets", file }, this.dataVersion);
    return ws.map((w) => ({ file: w.file, sheet: w.sheet, sheetIndex: w.sheetIndex, grid: w.grid, index: new CellIndex(w.grid), status: new Map(w.status) }));
  }

  /** 次の未解決のセル（file があれば、その資料の中の最初） */
  nextUnresolved(after: CellPos | null, file: string | null = null): Promise<CellPos | null> {
    return this.engine.request({ op: "nextUnresolved", after, file }, this.dataVersion);
  }

  /** 突き合せの行（資料ごとの書き方を並べたもの） */
  matchRows(noDate: string): Promise<Match> {
    return this.engine.request({ op: "match", noDate }, this.dataVersion);
  }

  // ─── 資料 ────────────────────────────────────────────────────

  get fileCount(): number {
    return this.inputs.length;
  }

  /** 入れた資料の名前（読み終えて取り込みが受けたもの。写し） */
  get fileNames(): string[] {
    return [...this.inputs];
  }

  /**
   * 利用者の資料の名前：AI がデモ（intake_add_files の source: demo）で入れたもののほか。人が落とした・フォルダから入れた・版から戻した資料。
   * 資料に【架空】とあっても、デモで入れたものでなければ利用者の資料（デモの資料と混ぜない。仕事 chat-prompts-v1）
   */
  get userFileNames(): string[] {
    return this.inputs.filter((n) => !this.demoInputs.has(n));
  }

  /** AI がデモで入れた資料に印を付ける（取り込みが受けた名前だけ） */
  markDemoFiles(names: Iterable<string>): void {
    for (const n of names) if (this.inputs.includes(n)) this.demoInputs.add(n);
  }

  /** 大きすぎて読まなかったファイル（理由つき） */
  get skippedFiles(): { file: string; reason: string }[] {
    return [...this.tooLarge];
  }

  /**
   * 資料を入れる。64 MB を越えるものは読まずに理由を残す。読めないものは取り込みが理由つきで外す。
   * 1 つずつ受け手に送り、読み終わるごとに進み（readProgress）を知らせる。読み終わったら 1 回だけ読み取り直す。
   * 前に入れた資料を読んでいる間に呼ばれたら、そのあとに続けて読む（進みの数は足す）
   */
  addFiles(list: DroppedFile[]): Promise<void> {
    if (list.length === 0) {
      const run = this.readChain.then(() => this.changed(true, true));
      this.readChain = run.catch(() => undefined);
      return run;
    }
    this.readProgress = { done: this.readProgress?.done ?? 0, total: (this.readProgress?.total ?? 0) + list.length };
    this.notify();
    const run = this.readChain.then(() => this.readBatch(list));
    this.readChain = run.catch(() => undefined);
    return run;
  }

  private step(): void {
    const p = this.readProgress;
    if (!p) return;
    this.readProgress = p.done + 1 >= p.total ? null : { done: p.done + 1, total: p.total };
    this.notify();
  }

  private async readBatch(list: DroppedFile[]): Promise<void> {
    for (const f of list) {
      try {
        if (f.size > MAX_FILE_BYTES) {
          this.tooLarge.push({ file: f.name, reason: `1 ファイル 64 MB までなので読まなかった（${Math.ceil(f.size / 1024 / 1024)} MB）` });
          continue;
        }
        const bytes = await f.bytes();
        // worker へはバイト列を移す（写さない）。読んだあとは主のスレッドでは持たない
        const r = await this.engine.request({ op: "read", name: f.name, bytes }, this.dataVersion + 1, this.engine.local ? [] : [bytes.buffer]);
        this.dataVersion++;
        // 取り込みが外したもの（同じ名前・読めない形式）は持たない
        if (r.accepted) this.inputs.push(f.name);
        await this.listPhotos(r.listed);
      } catch {
        this.tooLarge.push({ file: f.name, reason: TEXT.intake.drop.failed });
      } finally {
        this.step();
      }
    }
    this.changed(true, true);
    // 読み終わったあとの写しを待つ（画面は、資料に「架空」の印があるかなどを写しで見る）
    if (!this.readProgress) await this.fresh(this.dataVersion, false).catch(() => undefined);
  }

  /** worker の中の写真の一覧に新しく並んだものを、主のスレッドの一覧にも並べる（同じスレッドの受け手は一覧を共にする） */
  private async listPhotos(listed: PhotoInput[]): Promise<void> {
    if (this.engine.local) return;
    for (const p of listed) await this.photoBook.list(p);
  }

  /** パック・施設の名前・架空の印を変える。パックは読み方（手がかりの語）に効くので、変えたら読み直す */
  setFacility(patch: Partial<Pick<WorkspaceSettings, "packId" | "facilityName" | "fictional">>): void {
    const packChanged = patch.packId !== undefined && patch.packId !== this.settings.packId;
    this.settings = { ...this.settings, ...patch };
    const next = this.optionsOf(this.settings);
    this.opts = {
      ...this.opts,
      planId: next.planId,
      packId: next.packId,
      displayName: next.displayName,
      facility: { ...next.facility, fiscalYearStartMonth: this.opts.facility.fiscalYearStartMonth },
    };
    this.send({ op: "options", options: this.opts, reread: packChanged }, packChanged);
    this.changed(true);
  }

  /** 資料のどこかに「【架空】」の印があるか（あれば画面は架空の資料として扱う） */
  sourcesMarkedFictional(): boolean {
    return this.view.fictionalMark;
  }

  /**
   * 計画を作れない理由（§2.3 の止める決まりと、施設の設定）。空なら作れる。
   * 画面の主ボタンの横に出し、AI の intake_compose もこれで止める。
   */
  composeBlockers(): string[] {
    const out: string[] = [];
    if (this.restoreFailed) out.push(this.restoreFailed);
    if (this.inputs.length === 0) out.push(TEXT.intake.needFiles);
    if (!this.settings.packId) out.push(TEXT.intake.needPack);
    if (!this.settings.facilityName.trim()) out.push(TEXT.intake.needName);
    if (this.inputs.length) out.push(...this.view.blockers);
    return out;
  }

  /** 施設の設定を変える。年度の始まりは読み方に効くので、入れた資料と決定で読み直す */
  async configure(next: WorkspaceSettings): Promise<void> {
    const opts = this.optionsOf(next);
    // 決定はまとめて 1 回で置く（1 つずつ置くと置くたびに資料を読み直し、厚い施設ではタブが 45 秒を越えて固まって、橋渡しが切れたと見なした）
    const r = await this.engine.request({ op: "reset", options: opts, readings: forFacility(this.readings, opts.facility.facilityKey) }, this.dataVersion + 1);
    this.opts = opts;
    this.settings = next;
    await this.listPhotos(r.listed);
    setCurrentReadings(forFacility(this.readings, this.facilityKey()), this.facilityKey());
    this.changed(true, true);
  }

  /** 承認済みの読み方を置き換える（保管先から読んだもの）。作業中の下書きは残す */
  setApprovedReadings(list: readonly LoadedReading[]): void {
    this.readings = [...this.readings.filter((r) => r.draft), ...list.filter((r) => !r.draft)];
    this.send({ op: "readings", readings: forFacility(this.readings, this.facilityKey()), reread: true }, true);
    setCurrentReadings(forFacility(this.readings, this.facilityKey()), this.facilityKey());
    this.changed(true);
  }

  /**
   * 会話で決めた規則を、作業中の版の下書きの読み方に置く（同じ id の規則は置き換え、ほかは足す）。読み直して、規則ごとに効いたセルを返す。
   * 保管先には書かない（書くのは reading_skill_register）
   */
  proposeReadingWith(name: string, scope: ReadingScope, rules: readonly ReadingRule[]): Maybe<{ id: string; text: string; hits: number }[]> {
    const prev = this.readings.find((r) => r.draft && r.skill.name === name);
    const merged = [...(prev?.skill.rules ?? []).filter((x) => !rules.some((y) => y.id === x.id)), ...rules];
    const draft: LoadedReading = { skill: { schema: "moyai.reading/0", name, scope, rules: merged }, version: "", path: null, approved: false, draft: true };
    // 資料の読み方が変わらない（計画ルールだけが変わった）ときは読み直さない。計画を作り直さずに、周期の案（R）だけが出し直される（state/cycles.ts）
    const readingPart = (rs: readonly ReadingRule[]) => JSON.stringify(rs.filter((x) => !isPlanRule(x)));
    const reread = prev?.skill.scope !== scope || readingPart(prev?.skill.rules ?? []) !== readingPart(merged);
    this.readings = [...this.readings.filter((r) => r !== prev), draft];
    this.send({ op: "readings", readings: forFacility(this.readings, this.facilityKey()), reread }, reread);
    setCurrentReadings(forFacility(this.readings, this.facilityKey()), this.facilityKey());
    this.changed(reread);
    return andThen(this.viewWith(), (v) => merged.map((x) => ({ id: x.id, text: x.text, hits: v.ruleHits[x.id]?.count ?? 0 })));
  }

  proposeReading(name: string, scope: ReadingScope, rules: readonly ReadingRule[]): { id: string; text: string; hits: number }[] {
    return sync(this.proposeReadingWith(name, scope, rules));
  }

  /** 施設の鍵（施設の読み方の置き場所の名前に使う） */
  facilityKey(): string {
    return this.optionsOf(this.settings).facility.facilityKey;
  }

  /** 作業中の版の下書きの読み方（名前で） */
  draftReading(name: string): LoadedReading | null {
    return this.readings.find((r) => r.draft && r.skill.name === name) ?? null;
  }

  /** 当てている読み方（「読み方」のタブ） */
  currentReadings(): LoadedReading[] {
    return forFacility(this.readings, this.facilityKey());
  }

  /** 読み取りのすべて（受け手が同じスレッドのときだけ。試験が使う。画面は view を読む） */
  analysis(): Analysis {
    const h = this.engine.local;
    if (!h) throw new Error("取り込みの読み取りは worker の中にある（画面は view を読む）");
    return h.analysis();
  }

  decisions(): Decision[] {
    return this.engine.local ? this.engine.local.decisionList() : this.view.decisions;
  }

  /**
   * 聞いた数（2A）：いまの取り込みで出た質問の数と、作者ごとの決定の数。資料が無ければ null。
   * 作者「AI（読み取り）」は写真の格子のセルの作者で、質問の答えには付かないので数えない
   */
  intakeStats(): { questions: number; decisions: { human: number; ai: number; ai_relayed_human: number; rule_code: number } } | null {
    if (this.inputs.length === 0) return null;
    const v = this.view;
    const decisions = { human: 0, ai: 0, ai_relayed_human: 0, rule_code: 0 };
    for (const q of v.questions) {
      const a = q.decision?.author;
      if (a === "human" || a === "ai" || a === "ai_relayed_human" || a === "rule_code") decisions[a]++;
    }
    return { questions: v.questions.length, decisions };
  }

  /** 作業中の計画を作ったときの取り込みの版（作ったか版を開いて資料を戻したときに置く。無ければ照らさない） */
  private composedAt: number | null = null;

  /** 作ったか戻した計画の ID（composedAt と組。uncomposed で、ほかの計画の版を開いているかを見る） */
  private composedFor: string | null = null;

  /** 作業中の計画を作ったあと、資料・決定・読み方・写真が変わったか（変わっていれば作り直すまで署名を止める。台帳の中-6） */
  notRecomposed(): boolean {
    return this.composedAt !== null && this.composedAt !== this.dataVersion;
  }

  /**
   * 計画 planId の版に入っていない、このタブの資料・決定・読み方・写真の変更があるか（版があるときの「| 資料を重ねて第 n 版をつくる」は、
   * このときだけ出す。docs/screens.md 3.3 の末尾「写しの照らし」）。資料が無ければ無い。
   * このタブでその計画を作ったか、その版の資料を戻したあとなら、そのあとに変わったか。どちらでもなければ、このタブの資料はその版に入っていない
   */
  uncomposed(planId: string): boolean {
    if (this.inputs.length === 0) return false;
    return this.composedAt === null || this.composedFor !== planId || this.composedAt !== this.dataVersion;
  }

  /** 戻した版（次の版に重ねるとき、その版を組んだ資料と決定を戻した。資料のタブで「第 n 版の資料」と出す） */
  restoredFrom: { version: number; files: ReadonlySet<string> } | null = null;

  /**
   * 版を組んだ資料と、その資料への決定を戻す（1C・重-2。次の版はこれに新しい資料を足して組み直す）。
   * 今のタブの資料と決定は置き換える。決定は作者のまま戻す（署名した版を組み直すための記録で、引き継ぎではない）
   */
  async restoreVersion(version: number, files: readonly { name: string; bytes: Uint8Array }[], decisions: readonly Decision[]): Promise<void> {
    const opts = this.optionsOf(this.settings);
    // 決定はまとめて 1 回で置く（1 つずつ置くと置くたびに資料を読み直し、厚い施設ではタブが 45 秒を越えて固まって、橋渡しが切れたと見なした）
    const r = await this.engine.request(
      {
        op: "reset",
        options: opts,
        readings: forFacility(this.readings, this.facilityKey()),
        files: files.map((f) => ({ name: f.name, bytes: f.bytes })),
        decisions: [...decisions],
      },
      this.dataVersion + 1,
    );
    this.opts = opts;
    this.inputs = r.accepted;
    // 版から戻した資料は利用者の資料（デモで入れた印は消す）
    this.demoInputs.clear();
    this.tooLarge = [];
    // 決定は版の記録のものに置き換わった（答えた時刻は版の記録に無いので、分からないものとして持たない）
    this.answered.clear();
    this.restoredFrom = { version, files: new Set(this.inputs) };
    this.restoreFailed = null;
    await this.listPhotos(r.listed);
    this.changed(true, true);
    // 戻した資料と決定は、開いた版の計画と同じ（作り直していないことにしない）
    this.composedAt = this.dataVersion;
    this.composedFor = opts.planId;
  }

  /**
   * 確定のときに版の記録に残す資料と決定（1C・重-2）。資料の SHA-256 と、決定ごとに掛かった資料の SHA-256。
   * 写真のある版は残さない（写真の読み取りの格子はこのタブにしか無いので、次の版はこのタブの資料だけで組み直す）。資料が無ければ null
   */
  async sourcesForCommit(): Promise<{ files: { name: string; bytes: Uint8Array; sha256: string }[]; decisions: (Decision & { sources: string[] })[] } | null> {
    if (this.inputs.length === 0 || this.inputs.some((n) => photoMimeOf(n) !== null) || this.photoBook.entries().length > 0) return null;
    const r = await this.engine.request({ op: "commit" }, this.dataVersion);
    const shaOf = new Map(r.files.map((f) => [f.name, f.sha256]));
    const filesOf = new Map(r.questionFiles);
    const decisions = r.decisions
      .map((d) => ({ ...d, sources: (filesOf.get(d.questionId) ?? []).map((n) => shaOf.get(n)).filter((x): x is string => !!x) }))
      .filter((d) => d.sources.length > 0);
    return { files: r.files, decisions };
  }

  // ─── 決定 ────────────────────────────────────────────────────

  private asking = 0;

  /**
   * 質問の ID → 答えた時刻（ISO）。このタブで置いた決定だけ。settle で書き、undo で消す。
   * 資料のシートの詳細の「答え　{答えの字}　{作者}　{日時}」に使う。Decision には足さない（版の記録・署名される字に入れない）
   */
  private readonly answered = new Map<string, string>();

  /** その質問に答えた時刻（ISO）。版から戻した決定など、このタブで置いていなければ null */
  answeredAt(questionId: string): string | null {
    return this.answered.get(questionId) ?? null;
  }

  /** 決定を置く・取り消す途中（worker の答えと、そのあとの写しが届くまで）。画面は答えと取り消しのボタンを押せなくする */
  get busy(): boolean {
    return this.asking > 0;
  }

  private async track<T>(f: () => Promise<T>): Promise<T> {
    this.asking++;
    this.emit();
    try {
      return await f();
    } finally {
      this.asking--;
      this.emit();
    }
  }

  /** 決定を置くか取り消し、worker なら、そのあとの写しが届くまで待つ（画面とツールは、置いたあとの値を読む） */
  private decide<R extends Extract<IntakeRequest, { op: "settle" | "undo" }>>(req: R, applied: (r: ReplyOf<R>) => boolean): Maybe<ReplyOf<R>> {
    const h = this.engine.local;
    if (h) {
      const r = h.applySync(req, this.dataVersion);
      if (applied(r)) this.changed(true, true);
      return r;
    }
    return this.track(async () => {
      const r = await this.engine.request(req, this.dataVersion);
      if (applied(r)) {
        this.changed(true, true);
        await this.fresh().catch(() => undefined);
      }
      return r;
    });
  }

  /**
   * 決定を置く。どれか 1 つでも当てはまらなければ、どれも置かない。
   * 当てはまるのは、今出ている質問で、答えがその質問の選択肢に入っているもの。人が答えた質問は、人だけが変えられる（確かめるのは受け手）。
   */
  settleWith(ds: Decision[]): Maybe<SettleOutcome> {
    // 時刻は置こうとしたとき（worker の答えを待つ間ではない）。置けたときだけ書く
    const at = now();
    return this.decide({ op: "settle", decisions: ds }, (r) => {
      if (r.ok) for (const d of ds) this.answered.set(d.questionId, at);
      return r.ok;
    });
  }

  settle(ds: Decision[]): SettleOutcome {
    return sync(this.settleWith(ds));
  }

  async settleAsync(ds: Decision[]): Promise<SettleOutcome> {
    return this.settleWith(ds);
  }

  /** 人が画面で答える */
  answerAsHuman(questionId: string, answer: string, reason: string): SettleOutcome {
    return this.settle([{ questionId, answer, author: "human", reason }]);
  }

  async answerAsHumanAsync(questionId: string, answer: string, reason: string): Promise<SettleOutcome> {
    return this.settleWith([{ questionId, answer, author: "human", reason }]);
  }

  undoWith(questionId: string): Maybe<{ cellsAffected: number; rowsAffected: number; unresolved: number }> {
    return this.decide({ op: "undo", questionId }, () => {
      this.answered.delete(questionId);
      return true;
    });
  }

  undo(questionId: string): { cellsAffected: number; rowsAffected: number; unresolved: number } {
    return sync(this.undoWith(questionId));
  }

  async undoAsync(questionId: string): Promise<{ cellsAffected: number; rowsAffected: number; unresolved: number }> {
    return this.undoWith(questionId);
  }

  // ─── 計画 ────────────────────────────────────────────────────

  /**
   * 計画を作り始める。すぐに「作り始めた」印を返し、作るのはこのあと（タブの次の番。worker なら worker の中）。
   * もう作っている最中なら、始めずにその始めた時刻を返す。
   */
  startCompose(by: "human" | "ai"): { started: boolean; startedAt: string } {
    if (this.compose.state === "running") return { started: false, startedAt: this.compose.startedAt };
    const startedAt = now();
    this.compose = { state: "running", startedAt, by };
    // 作り始めたときの資料・決定・読み方・写真の版（このあと変われば、作り直すまで署名を止める。台帳の中-6）
    const at = this.dataVersion;
    this.changed(false);
    this.composeRun = (async () => {
      await new Promise((r) => setTimeout(r, 0));
      try {
        // 止める決まりは、作り始めたときまでの変わりを含む写しで見る
        await this.fresh(at);
        const pre = this.composeBlockers();
        const c = pre.length ? { plan: null, blockers: pre } : await this.engine.request({ op: "compose" }, this.dataVersion);
        if (c.plan) {
          // 作り直したときは、前の当てはめ（人が受けたもの・人が直に当てたもの・AI の案）を引き継ぎ、数を知らせる
          const carried = placeComposedPlan(c.plan);
          if (carried) this.note("info", TEXT.crosswalk.carried(carried));
          this.compose = { state: "done", startedAt, by, plan: c.plan };
          this.composedAt = at;
          this.composedFor = c.plan.planId;
        } else this.compose = { state: "failed", startedAt, by, blockers: c.blockers };
      } catch (e) {
        this.compose = { state: "failed", startedAt, by, blockers: [`計画を作る途中で誤りが起きた（${e instanceof Error ? e.name : "誤り"}）`] };
      }
      this.changed(false);
    })();
    return { started: true, startedAt };
  }

  /** 今の計画づくりが終わるのを待つ（試験と画面の確かめ用） */
  whenComposed(): Promise<void> {
    return this.composeRun;
  }

  /** AI に渡す要約（質問には選択肢と答えの型が付く。AI が出していない答えを置かないように）。計画を作る進みはここが持つ */
  surveyWith(): Maybe<Survey> {
    const h = this.engine.local;
    const asked: Maybe<Survey> = h ? h.applySync({ op: "survey" }, this.dataVersion) : this.engine.request({ op: "survey" }, this.dataVersion);
    return andThen(asked, (base) => {
      const c = this.compose;
      const compose: Survey["compose"] =
        c.state === "idle"
          ? { state: "idle", message: null }
          : c.state === "running"
            ? { state: "running", message: null }
            : c.state === "done"
              ? { state: "done", message: `作った：機器の節 ${c.plan.assets.length}・作業 ${c.plan.works.length}・明細 ${c.plan.details.length}` }
              : { state: "failed", message: c.blockers.join("・") };
      const p = this.readProgress;
      const reading = p ? [TEXT.intake.ai.readingNote(p.done, p.total)] : [];
      return { ...base, notes: [...reading, ...base.notes, ...this.tooLarge.map((r) => `${r.file}：${r.reason}`), ...this.photos.surveyNotes()], compose };
    });
  }

  survey(): Survey {
    return sync(this.surveyWith());
  }

  /** AI だけで結んだもの（作者が AI か、AI が会話から写した人の答えの、結ぶ質問の決定）。人が画面で受けるまで確定できない */
  aiOnlyLinks(): { question: QuestionView; decision: Decision }[] {
    return this.view.questions
      .filter((q) => q.decision && (q.decision.author === "ai" || q.decision.author === "ai_relayed_human") && LINK_KINDS.has(q.kind))
      .map((q) => ({ question: q, decision: q.decision as Decision }));
  }

  note(kind: Notice["kind"], text: string): void {
    this.notices = [{ id: ++this.noticeSeq, at: now(), kind, text }, ...this.notices].slice(0, NOTICES_MAX);
    this.changed(false);
  }
}

/** 当てる読み方：下書きと、会社・担当者の読み方と、今の施設の読み方（ほかの施設の読み方は当てない。Db の重-5） */
function forFacility(readings: readonly LoadedReading[], facilityKey: string): LoadedReading[] {
  return readings.filter((r) => r.draft || r.skill.scope !== "facility" || r.owner === facilityKey);
}
