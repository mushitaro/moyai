// 取り込みの受け手：IntakeSession を持ち、worker-protocol.ts の通信を 1 通ずつ順に処理する。
// 画面のタブでは worker の中（intake.worker.ts）に置き、主のスレッドを止めない。worker の無い所（vitest の node）では、
// 作業場（workspace.ts）が同じスレッドに置き、同じ通信を同期で処理する。
// - 資料ごとの覚え：同じ名前・同じ大きさ・同じ中身のハッシュの資料は、読み手を走らせずに前の結果を使う（Map。タブを閉じれば消える）。
// - 読み取り（analyze）は、資料・決定・読み方・写真が変わるまで覚えて使い回す。
// - 写しの要求は間を詰める：後ろに写しの要求か資料の読み込みが待っていれば、この要求はそれらのあとにまとめて 1 回で答える。
import { type Analysis, IntakeSession, type IntakeOptions } from "../../import/session";
import { cellKey } from "../../import/records";
import { matchRows } from "../../import/match";
import { readSource, type InputFile, type ReadOutcome } from "../../import/read";
import { PhotoBook, photoMimeOf, type PhotoInput } from "../../import/photo";
import type { Decision, QuestionState } from "../../import/questions";
import { TEXT } from "../text";
import type {
  CellPos,
  CommitReply,
  FromHost,
  IntakeReplies,
  IntakeRequest,
  IntakeView,
  PhotoCall,
  ReadReply,
  ResetReply,
  SettleReply,
  SheetWire,
  ToHost,
} from "./worker-protocol";

/** 答えがその質問の今出している選択肢に入っているか（valueKind が number なら正の数か） */
export function answerOffered(q: Pick<QuestionState, "valueKind" | "options">, answer: string): boolean {
  if (q.valueKind === "number") {
    const n = Number(answer);
    return answer.trim() !== "" && Number.isFinite(n) && n > 0;
  }
  return q.options.some((o) => o.id === answer);
}

/** 同期で処理できない要求（資料のバイト列を読む・ハッシュを取る） */
type AsyncOp = "read" | "reset" | "commit";
export type SyncRequest = Exclude<IntakeRequest, { op: AsyncOp }>;

interface Waiting {
  msg: ToHost;
  /** 同じ答えを待つ要求（写しの要求をまとめたとき 2 つ以上） */
  waiters: { id: number; done: (r: FromHost | null) => void }[];
}

/** バイト列の SHA-256（16 進）。ブラウザでも worker でも Node でも WebCrypto で取る */
async function sha256Hex(b: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", b as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export class IntakeHost {
  readonly photos: PhotoBook;
  private session: IntakeSession | null = null;
  /** 資料として持ったもの（設定を変えて読み直すときに使う） */
  private inputs: InputFile[] = [];
  /** 資料ごとの覚え（名前・大きさ・中身のハッシュ → 読み手の結果） */
  private readonly memo = new Map<string, Promise<ReadOutcome>>();
  /** 資料・決定・読み方・写真が変わるたびに 1 つ増える（読み取りの覚えの鍵） */
  private hv = 0;
  private cache: { hv: number; an: Analysis } | null = null;
  private viewCache: { hv: number; view: Omit<IntakeView, "at"> } | null = null;
  /** 最後に受けた要求の、主のスレッドの版 */
  private applied = 0;
  private lastCached = false;
  private readonly queue: Waiting[] = [];
  private busy = false;
  /** 読み手を走らせた回数・覚えから返した回数・読み取りの回数（試験と報告に使う） */
  readonly stats = { reads: 0, cached: 0, analyses: 0 };

  constructor(photos: PhotoBook = new PhotoBook()) {
    this.photos = photos;
  }

  private readonly reader = async (f: InputFile): Promise<ReadOutcome> => {
    const key = `${f.name}\u0000${f.bytes.byteLength}\u0000${await sha256Hex(f.bytes)}`;
    const hit = this.memo.get(key);
    if (hit) {
      this.stats.cached++;
      this.lastCached = true;
      return hit;
    }
    this.stats.reads++;
    const p = readSource(f);
    this.memo.set(key, p);
    p.catch(() => this.memo.delete(key));
    return p;
  };

  private newSession(options: IntakeOptions): IntakeSession {
    return new IntakeSession(options, this.photos, this.reader);
  }

  private get s(): IntakeSession {
    if (!this.session) throw new Error("取り込みが始まっていない（open を先に送る）");
    return this.session;
  }

  /** 資料・決定・読み方・写真が変わった。直後の読み取り（after）があれば、それを覚える */
  private bump(after: Analysis | null = null): void {
    this.hv++;
    this.cache = after ? { hv: this.hv, an: after } : null;
    this.viewCache = null;
  }

  /** 今の読み取り（変わっていなければ覚えたもの） */
  analysis(): Analysis {
    if (this.cache?.hv !== this.hv) {
      this.stats.analyses++;
      this.cache = { hv: this.hv, an: this.s.analyze() };
    }
    return this.cache.an;
  }

  decisionList(): Decision[] {
    return this.s.decisionList();
  }

  // ─── 通信を受ける ─────────────────────────────────────────────

  /**
   * 1 通を受け、順に処理する（worker の onmessage と、同じスレッドの受け手が使う）。
   * id 0 の要求には、誤りのときだけ答える
   */
  receive(msg: ToHost): Promise<FromHost | null> {
    return new Promise((done) => {
      this.queue.push({ msg, waiters: [{ id: msg.id, done }] });
      if (!this.busy) void this.pump();
    });
  }

  private async pump(): Promise<void> {
    this.busy = true;
    try {
      for (let item = this.queue.shift(); item; item = this.queue.shift()) {
        if (item.msg.req.op === "view") {
          // 間を詰める：後ろに写しの要求があれば、そこにまとめる。後ろに資料の読み込みが待っていれば、そのあとへ回す
          const later = this.queue.find((x) => x.msg.req.op === "view");
          if (later) {
            later.waiters.unshift(...item.waiters);
            continue;
          }
          if (this.queue.some((x) => x.msg.req.op === "read" || x.msg.req.op === "reset")) {
            this.queue.push(item);
            continue;
          }
        }
        this.applied = Math.max(this.applied, item.msg.v);
        let out: { ok: true; reply: IntakeReplies[keyof IntakeReplies] } | { ok: false; error: string };
        try {
          out = { ok: true, reply: await this.handle(item.msg.req) };
        } catch (e) {
          out = { ok: false, error: e instanceof Error ? e.name : "Error" };
        }
        for (const w of item.waiters) {
          if (w.id === 0 && out.ok) w.done(null);
          else w.done(out.ok ? { kind: "reply", id: w.id, ok: true, reply: out.reply } : { kind: "reply", id: w.id, ok: false, error: out.error });
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async handle(req: IntakeRequest): Promise<IntakeReplies[keyof IntakeReplies]> {
    switch (req.op) {
      case "read":
        return this.read(req.name, req.bytes);
      case "reset":
        return this.reset(req);
      case "commit":
        return this.commit();
      default:
        return this.handleSync(req);
    }
  }

  /** 同じスレッドの受け手が、同期で 1 通を処理する（版は主のスレッドの資料と決定の版） */
  applySync<R extends SyncRequest>(req: R, v: number): IntakeReplies[R["op"]] {
    this.applied = Math.max(this.applied, v);
    return this.handleSync(req) as IntakeReplies[R["op"]];
  }

  private handleSync(req: SyncRequest): IntakeReplies[keyof IntakeReplies] {
    switch (req.op) {
      case "open":
        this.session = this.newSession(req.options);
        this.inputs = [];
        this.bump();
        return null;
      case "options": {
        const o = this.s.options;
        o.planId = req.options.planId;
        o.packId = req.options.packId;
        o.displayName = req.options.displayName;
        o.facility = req.options.facility;
        if (req.options.defaultLevelNames !== undefined) o.defaultLevelNames = req.options.defaultLevelNames;
        if (req.reread) this.bump();
        return null;
      }
      case "readings":
        this.s.setReadings(req.readings);
        if (req.reread) this.bump();
        return null;
      case "settle":
        return this.settle(req.decisions);
      case "undo": {
        const r = this.s.undo(req.questionId, this.analysis());
        this.bump(this.s.takeAfter());
        return r;
      }
      case "photo":
        if (this.photo(req.photo) === "ok") this.bump();
        return null;
      case "touch":
        this.bump();
        return null;
      case "view":
        return this.view();
      case "survey":
        return this.s.survey(this.analysis());
      case "compose": {
        // 計画は毎回読み直して作る（施設の名前や計画の ID の変わったものを、前の読み取りのまま使わない）
        const c = this.s.compose();
        return { plan: c.plan, blockers: c.blockers };
      }
      case "sheets":
        return this.sheets(req.file);
      case "nextUnresolved":
        return this.nextUnresolved(req.after, req.file);
      case "match":
        return matchRows(this.analysis().linked, req.noDate);
    }
  }

  // ─── 資料 ────────────────────────────────────────────────────

  private listedSince(before: ReadonlySet<string>): PhotoInput[] {
    return this.photos
      .entries()
      .filter((e) => !before.has(e.input.name))
      .map((e) => e.input);
  }

  private async read(name: string, bytes: Uint8Array): Promise<ReadReply> {
    const before = new Set(this.photos.entries().map((e) => e.input.name));
    const f: InputFile = { name, bytes };
    this.lastCached = false;
    const rejected = await this.s.add([f]);
    const accepted = !rejected.some((r) => r.file === name);
    if (accepted) this.inputs.push(f);
    this.bump();
    return { name, rejected, accepted, cached: this.lastCached, listed: this.listedSince(before) };
  }

  private async reset(req: Extract<IntakeRequest, { op: "reset" }>): Promise<ResetReply> {
    const before = new Set(this.photos.entries().map((e) => e.input.name));
    const decisions = req.decisions ?? this.s.decisionList();
    // 写真は同じ一覧をそのまま使う（並べ直さない）
    const files: InputFile[] = req.files ? req.files.map((f) => ({ name: f.name, bytes: f.bytes })) : this.inputs.filter((f) => photoMimeOf(f.name) === null);
    const s = this.newSession(req.options);
    const rejected = new Set((await s.add(files)).map((r) => r.file));
    s.setReadings(req.readings);
    // 決定はまとめて 1 回で置く（1 つずつ置くと置くたびに資料を読み直す）
    if (decisions.length > 0) s.settle([...decisions]);
    this.session = s;
    if (req.files) this.inputs = files.filter((f) => !rejected.has(f.name));
    this.bump(s.takeAfter());
    return { accepted: this.inputs.map((f) => f.name), listed: this.listedSince(before) };
  }

  private async commit(): Promise<CommitReply> {
    const files = await Promise.all(this.inputs.map(async (f) => ({ name: f.name, bytes: f.bytes, sha256: await sha256Hex(f.bytes) })));
    const questionFiles: CommitReply["questionFiles"] = this.analysis().questions.map((q) => {
      const set = new Set<string>();
      for (const it of q.items) {
        set.add(it.file);
        for (const t of it.target ?? []) set.add(t.file);
      }
      return [q.questionId, [...set]];
    });
    return { files, questionFiles, decisions: this.s.decisionList() };
  }

  // ─── 決定・写真 ──────────────────────────────────────────────

  /**
   * 決定を置く。どれか 1 つでも当てはまらなければ、どれも置かない。
   * 当てはまるのは、今出ている質問で、答えがその質問の選択肢に入っているもの。人が答えた質問は、人だけが変えられる。
   */
  private settle(ds: Decision[]): SettleReply {
    const an = this.analysis();
    const byId = new Map(an.questions.map((q) => [q.questionId, q]));
    for (const d of ds) {
      const q = byId.get(d.questionId);
      if (!q) return { ok: false, code: "unknown_question", questionId: d.questionId };
      if (!answerOffered(q, d.answer)) return { ok: false, code: "answer_not_offered", questionId: d.questionId };
      if (q.decision?.author === "human" && d.author !== "human") return { ok: false, code: "human_decided", questionId: d.questionId };
    }
    const r = this.s.settle(
      ds.map((d) => (byId.get(d.questionId)?.valueKind === "number" ? { ...d, answer: String(Number(d.answer)) } : d)),
      an,
    );
    this.bump(this.s.takeAfter());
    return { ok: true, ...r };
  }

  private photo(p: PhotoCall): string {
    const b = this.photos;
    switch (p.call) {
      case "place":
        return b.place(p.name, p.reading, p.at, p.conversation);
      case "correct":
        return b.correct(p.name, p.row, p.col, p.text);
      case "discard":
        return b.discard(p.name);
      case "confirm":
        return b.confirm(p.name, p.reason, p.at);
      case "unconfirm":
        return b.unconfirm(p.name);
      case "exclude":
        return b.exclude(p.name, p.at);
      case "include":
        return b.include(p.name);
    }
  }

  // ─── 写し ────────────────────────────────────────────────────

  private view(): IntakeView {
    if (this.viewCache?.hv !== this.hv) this.viewCache = { hv: this.hv, view: viewOf(this.analysis(), this.s.decisionList()) };
    return { at: this.applied, ...this.viewCache.view };
  }

  private sheets(file: string): SheetWire[] {
    const an = this.analysis();
    return an.layouts
      .filter((l) => l.file === file)
      .map((l) => ({
        file: l.file,
        sheet: l.sheet,
        sheetIndex: l.sheetIndex,
        grid: l.grid,
        status: l.grid.cells.flatMap((c): SheetWire["status"] => {
          const st = an.composition.status.get(cellKey({ file: l.file, sheetIndex: l.sheetIndex, ref: c.ref }));
          return st ? [[c.ref, st]] : [];
        }),
      }));
  }

  /** 未解決のセルを資料・シート・行・列の順に並べ、after の次（無ければ最初）を返す。file があればその資料の中だけ */
  private nextUnresolved(after: CellPos | null, file: string | null): CellPos | null {
    const an = this.analysis();
    const all: CellPos[] = [];
    for (const lay of an.layouts) {
      if (file && lay.file !== file) continue;
      for (const cell of lay.grid.cells) {
        const st = an.composition.status.get(cellKey({ file: lay.file, sheetIndex: lay.sheetIndex, ref: cell.ref }));
        if (st?.s === "unresolved") all.push({ file: lay.file, sheetIndex: lay.sheetIndex, r: cell.r, c: cell.c });
      }
    }
    if (!all.length) return null;
    if (!after) return all[0] ?? null;
    const i = all.findIndex(
      (x) => x.file === after.file && (x.sheetIndex > after.sheetIndex || (x.sheetIndex === after.sheetIndex && (x.r > after.r || (x.r === after.r && x.c > after.c)))),
    );
    return all[i >= 0 ? i : 0] ?? null;
  }
}

/** 読み取りから、画面とツールが同期で読む写しを作る（かかるセルの一覧・格子・行の中身は入れない） */
export function viewOf(an: Analysis, decisions: Decision[]): Omit<IntakeView, "at"> {
  const ruleHits: IntakeView["ruleHits"] = {};
  for (const r of an.readings.flatMap((x) => x.skill.rules)) {
    const s = an.ruleHits.sample(r.id);
    const cell = s ? an.sources.find((x) => x.file === s.file)?.sheets.flatMap((g) => g.cells).find((c) => c.ref === s.ref) : null;
    ruleHits[r.id] = { count: an.ruleHits.count(r.id), sample: s ? { file: s.file, ref: s.ref, text: cell?.text ?? "" } : null };
  }
  let unresolved = 0;
  for (const st of an.composition.status.values()) if (st.s === "unresolved") unresolved++;
  return {
    files: an.sources.map((s) => s.file),
    rejected: an.rejected,
    counts: an.composition.counts,
    blockers: an.composition.blockers,
    questions: an.questions.map(({ items: _items, ...q }) => q),
    open: an.open.map((q) => q.questionId),
    decisions,
    unusedDecisions: an.unusedDecisions,
    unresolvedCells: unresolved,
    fictionalMark: an.sources.some((s) => s.sheets.some((g) => g.cells.some((c) => c.text.includes(TEXT.fictionMark)))),
    ruleHits,
    photoReview: an.composition.photoReview,
    sheets: an.layouts.map((l) => ({ file: l.file, sheetIndex: l.sheetIndex, sheet: l.sheet })),
  };
}
