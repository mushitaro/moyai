// 取り込みの作業場（このタブのメモリだけ）。取り込みの画面と、AI のツールの受け手（tab-tools.ts）が同じ 1 つを使う。
// 資料・決定・計画を作る進みを持ち、計画ができたら作業中の計画の置き場（state/plan-store.ts）に置く。
// 決定は、人の答えも AI の答えも、ここの同じ確かめ（その質問が今出している選択肢か）を通す。
// React を持たない純粋な TS にして、試験（vitest）から工場の資料で動かせるようにする。
import { IntakeSession, type Analysis, type IntakeOptions, type Survey } from "../../import";
import { PhotoBook, photoMimeOf } from "../../import/photo";
import type { LoadedReading, ReadingRule, ReadingScope } from "../../import/reading";
import { setCurrentReadings } from "../state/readings";
import type { Decision, QuestionKind, QuestionState } from "../../import/questions";
import type { InputFile } from "../../import/read";
import { PhotoDesk } from "./photos";
import type { TabSentCode } from "../../shared/errors";
import type { Plan } from "../../shared/plan";
import { placeComposedPlan } from "../state/crosswalk";
import { TEXT } from "../text";

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

/** 落とされたファイル（File API の File と同じ形の一部） */
export interface DroppedFile {
  name: string;
  size: number;
  bytes(): Promise<Uint8Array>;
}

export type SettleOutcome =
  | { ok: true; cellsAffected: number; rowsAffected: number; unresolved: number }
  | { ok: false; code: Extract<TabSentCode, "unknown_question" | "answer_not_offered" | "human_decided">; questionId: string };

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

/** 答えがその質問の今出している選択肢に入っているか（valueKind が number なら正の数か） */
export function answerOffered(q: Pick<QuestionState, "valueKind" | "options">, answer: string): boolean {
  if (q.valueKind === "number") {
    const n = Number(answer);
    return answer.trim() !== "" && Number.isFinite(n) && n > 0;
  }
  return q.options.some((o) => o.id === answer);
}

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

export class IntakeWorkspace {
  private session: IntakeSession;
  private inputs: InputFile[] = [];
  private tooLarge: { file: string; reason: string }[] = [];
  private cache: { version: number; analysis: Analysis } | null = null;
  private composeRun: Promise<void> = Promise.resolve();
  private noticeSeq = 0;
  private readonly listeners = new Set<() => void>();
  /** 変わるたびに 1 つ増える（画面はこれで描き直す） */
  version = 0;
  compose: ComposeState = { state: "idle" };
  notices: Notice[] = [];
  /** 写真の一覧と読み取り（読み直しで取り込みを作り直しても、同じものを使う） */
  readonly photoBook = new PhotoBook();
  /** 写真を AI に渡す記録と、写真のツールの受け手・人の確かめの操作 */
  readonly photos: PhotoDesk;

  /** 当てる読み方：承認済みの読み方（保管先から）と、作業中の版の下書き（会話で置いたもの） */
  private readings: LoadedReading[] = [];

  constructor(public settings: WorkspaceSettings) {
    this.session = new IntakeSession(this.optionsOf(settings), this.photoBook);
    this.photos = new PhotoDesk(
      () => this.photoBook,
      (data) => this.changed(data, data),
      (kind, text) => this.note(kind, text),
    );
  }

  private optionsOf(s: WorkspaceSettings): IntakeOptions {
    // 計画の ID は、パックと施設の名前から作る（同じパックの別の施設とぶつからない。同じ施設は版を重ねる）
    const key = `intake-${s.packId}-${nameKey(s.facilityName)}`;
    return {
      planId: key,
      displayName: s.facilityName,
      packId: s.packId,
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
    return this.session.options.planId;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** 資料と決定が変わるたびに 1 つ増える（読み直しはこれで決める。名前の変更では読み直さない） */
  private dataVersion = 0;

  private changed(resetCompose = true, data = false): void {
    if (resetCompose && this.compose.state !== "running") this.compose = { state: "idle" };
    if (data) this.dataVersion++;
    this.version++;
    for (const l of this.listeners) l();
  }

  get fileCount(): number {
    return this.inputs.length;
  }

  /** 大きすぎて読まなかったファイル（理由つき） */
  get skippedFiles(): { file: string; reason: string }[] {
    return [...this.tooLarge];
  }

  /** 資料を入れる。64 MB を越えるものは読まずに理由を残す。読めないものは取り込みが理由つきで外す */
  async addFiles(list: DroppedFile[]): Promise<void> {
    const read: InputFile[] = [];
    for (const f of list) {
      if (f.size > MAX_FILE_BYTES) {
        this.tooLarge.push({ file: f.name, reason: `1 ファイル 64 MB までなので読まなかった（${Math.ceil(f.size / 1024 / 1024)} MB）` });
        continue;
      }
      read.push({ name: f.name, bytes: await f.bytes() });
    }
    const rejected = await this.session.add(read);
    const out = new Set(rejected.map((r) => r.file));
    // 取り込みが外したもの（同じ名前・読めない形式）は持たない。設定を変えて読み直すときに使う
    this.inputs.push(...read.filter((f) => !out.has(f.name)));
    this.changed(true, true);
  }

  /** パック・施設の名前・架空の印を変える。パックは読み方（手がかりの語）に効くので、変えたら読み直す */
  setFacility(patch: Partial<Pick<WorkspaceSettings, "packId" | "facilityName" | "fictional">>): void {
    const packChanged = patch.packId !== undefined && patch.packId !== this.settings.packId;
    this.settings = { ...this.settings, ...patch };
    const next = this.optionsOf(this.settings);
    const o = this.session.options;
    o.planId = next.planId;
    o.packId = next.packId;
    o.displayName = next.displayName;
    o.facility = { ...next.facility, fiscalYearStartMonth: o.facility.fiscalYearStartMonth };
    this.changed(true, packChanged);
  }

  /** 資料のどこかに「【架空】」の印があるか（あれば画面は架空の資料として扱う） */
  sourcesMarkedFictional(): boolean {
    return this.analysis().sources.some((s) => s.sheets.some((g) => g.cells.some((c) => c.text.includes(TEXT.fictionMark))));
  }

  /**
   * 計画を作れない理由（§2.3 の止める決まりと、施設の設定）。空なら作れる。
   * 画面の主ボタンの横に出し、AI の intake_compose もこれで止める。
   */
  composeBlockers(): string[] {
    const out: string[] = [];
    if (this.inputs.length === 0) out.push(TEXT.intake.needFiles);
    if (!this.settings.packId) out.push(TEXT.intake.needPack);
    if (!this.settings.facilityName.trim()) out.push(TEXT.intake.needName);
    if (this.inputs.length) out.push(...this.analysis().composition.blockers);
    return out;
  }

  /** 施設の設定を変える。年度の始まりは読み方に効くので、入れた資料と決定で読み直す */
  async configure(next: WorkspaceSettings): Promise<void> {
    const decisions = this.session.decisionList();
    // 写真は同じ一覧をそのまま使う（並べ直さない）
    const s = new IntakeSession(this.optionsOf(next), this.photoBook);
    await s.add(this.inputs.filter((f) => photoMimeOf(f.name) === null));
    for (const d of decisions) s.settle([d]);
    s.setReadings(this.readings);
    this.session = s;
    this.settings = next;
    this.cache = null;
    this.changed(true, true);
  }

  /** 承認済みの読み方を置き換える（保管先から読んだもの）。作業中の下書きは残す */
  setApprovedReadings(list: readonly LoadedReading[]): void {
    this.readings = [...this.readings.filter((r) => r.draft), ...list.filter((r) => !r.draft)];
    this.session.setReadings(this.readings);
    setCurrentReadings(this.readings, this.facilityKey());
    this.changed(true, true);
  }

  /**
   * 会話で決めた規則を、作業中の版の下書きの読み方に置く（同じ id の規則は置き換え、ほかは足す）。読み直して、規則ごとに効いたセルを返す。
   * 保管先には書かない（書くのは reading_skill_register）
   */
  proposeReading(name: string, scope: ReadingScope, rules: readonly ReadingRule[]): { id: string; text: string; hits: number }[] {
    const prev = this.readings.find((r) => r.draft && r.skill.name === name);
    const merged = [...(prev?.skill.rules ?? []).filter((x) => !rules.some((y) => y.id === x.id)), ...rules];
    const draft: LoadedReading = { skill: { schema: "moyai.reading/0", name, scope, rules: merged }, version: "", path: null, approved: false, draft: true };
    this.readings = [...this.readings.filter((r) => r !== prev), draft];
    this.session.setReadings(this.readings);
    setCurrentReadings(this.readings, this.facilityKey());
    this.changed(true, true);
    const hits = this.analysis().ruleHits;
    return merged.map((x) => ({ id: x.id, text: x.text, hits: hits.count(x.id) }));
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
    return [...this.readings];
  }

  analysis(): Analysis {
    if (this.cache?.version !== this.dataVersion) this.cache = { version: this.dataVersion, analysis: this.session.analyze() };
    return this.cache.analysis;
  }

  decisions(): Decision[] {
    return this.session.decisionList();
  }

  /**
   * 決定を置く。どれか 1 つでも当てはまらなければ、どれも置かない。
   * 当てはまるのは、今出ている質問で、答えがその質問の選択肢に入っているもの。人が答えた質問は、人だけが変えられる。
   */
  settle(ds: Decision[]): SettleOutcome {
    const an = this.analysis();
    const byId = new Map(an.questions.map((q) => [q.questionId, q]));
    for (const d of ds) {
      const q = byId.get(d.questionId);
      if (!q) return { ok: false, code: "unknown_question", questionId: d.questionId };
      if (!answerOffered(q, d.answer)) return { ok: false, code: "answer_not_offered", questionId: d.questionId };
      if (q.decision?.author === "human" && d.author !== "human") return { ok: false, code: "human_decided", questionId: d.questionId };
    }
    const r = this.session.settle(ds.map((d) => (byId.get(d.questionId)?.valueKind === "number" ? { ...d, answer: String(Number(d.answer)) } : d)));
    this.changed(true, true);
    return { ok: true, ...r };
  }

  /** 人が画面で答える */
  answerAsHuman(questionId: string, answer: string, reason: string): SettleOutcome {
    return this.settle([{ questionId, answer, author: "human", reason }]);
  }

  undo(questionId: string): { cellsAffected: number; rowsAffected: number; unresolved: number } {
    const r = this.session.undo(questionId);
    this.changed(true, true);
    return r;
  }

  /**
   * 計画を作り始める。すぐに「作り始めた」印を返し、作るのはこのあと（タブの次の番）。
   * もう作っている最中なら、始めずにその始めた時刻を返す。
   */
  startCompose(by: "human" | "ai"): { started: boolean; startedAt: string } {
    if (this.compose.state === "running") return { started: false, startedAt: this.compose.startedAt };
    const startedAt = now();
    this.compose = { state: "running", startedAt, by };
    this.changed(false);
    this.composeRun = new Promise((resolve) =>
      setTimeout(() => {
        try {
          const pre = this.composeBlockers();
          const c = pre.length ? { plan: null, blockers: pre } : this.session.compose();
          if (c.plan) {
            // 作り直したときは、前の当てはめ（人が受けたもの・人が直に当てたもの・AI の案）を引き継ぎ、数を知らせる
            const carried = placeComposedPlan(c.plan);
            if (carried) this.note("info", TEXT.crosswalk.carried(carried));
            this.compose = { state: "done", startedAt, by, plan: c.plan };
          } else this.compose = { state: "failed", startedAt, by, blockers: c.blockers };
        } catch (e) {
          this.compose = { state: "failed", startedAt, by, blockers: [`計画を作る途中で誤りが起きた（${e instanceof Error ? e.name : "誤り"}）`] };
        }
        this.changed(false);
        resolve();
      }, 0),
    );
    return { started: true, startedAt };
  }

  /** 今の計画づくりが終わるのを待つ（試験と画面の確かめ用） */
  whenComposed(): Promise<void> {
    return this.composeRun;
  }

  /** AI に渡す要約（質問には選択肢と答えの型が付く。AI が出していない答えを置かないように）。計画を作る進みはここが持つ */
  survey(): Survey {
    const base = this.session.survey();
    const c = this.compose;
    const compose: Survey["compose"] =
      c.state === "idle"
        ? { state: "idle", message: null }
        : c.state === "running"
          ? { state: "running", message: null }
          : c.state === "done"
            ? { state: "done", message: `作った：機器の節 ${c.plan.assets.length}・作業 ${c.plan.works.length}・明細 ${c.plan.details.length}` }
            : { state: "failed", message: c.blockers.join("・") };
    return { ...base, notes: [...base.notes, ...this.tooLarge.map((r) => `${r.file}：${r.reason}`), ...this.photos.surveyNotes()], compose };
  }

  /** AI だけで結んだもの（作者が AI か、AI が会話から写した人の答えの、結ぶ質問の決定）。人が画面で受けるまで確定できない */
  aiOnlyLinks(): { question: QuestionState; decision: Decision }[] {
    const an = this.analysis();
    return an.questions
      .filter((q) => q.decision && (q.decision.author === "ai" || q.decision.author === "ai_relayed_human") && LINK_KINDS.has(q.kind))
      .map((q) => ({ question: q, decision: q.decision as Decision }));
  }

  note(kind: Notice["kind"], text: string): void {
    this.notices = [{ id: ++this.noticeSeq, at: now(), kind, text }, ...this.notices].slice(0, NOTICES_MAX);
    this.changed(false);
  }
}
