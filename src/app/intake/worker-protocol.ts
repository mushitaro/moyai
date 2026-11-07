// 取り込みの worker と主のスレッドの間で行き来する通信の型（ここに 1 つだけ置く）。
// どの値も構造化複製できる形だけにする（クラス・関数・Map を入れない。Map は [鍵, 値] の配列にする）。
// 受け手（intake-host.ts の IntakeHost）は、worker の中（intake.worker.ts）でも、worker の無い所（vitest の node）の同じスレッドでも、同じ通信を受ける。
import type { FileCounts, CellStatus } from "../../import/compose";
import type { RejectedFile, SheetGrid } from "../../import/grid";
import type { Match } from "../../import/match";
import type { PhotoCellRead, PhotoInput, PhotoReview } from "../../import/photo";
import type { Decision, QuestionState } from "../../import/questions";
import type { LoadedReading } from "../../import/reading";
import type { IntakeOptions, Survey } from "../../import/session";
import type { Plan } from "../../shared/plan";

/** 写真の一覧への人と AI の操作（主のスレッドの写真の一覧と同じ操作を、worker の中の一覧にもする） */
export type PhotoCall =
  | { call: "place"; name: string; reading: { width: number; height: number; cells: Omit<PhotoCellRead, "aiText" | "author">[] }; at: string; conversation: string | null }
  | { call: "correct"; name: string; row: number; col: number; text: string }
  | { call: "discard"; name: string }
  | { call: "confirm"; name: string; reason: string; at: string }
  | { call: "unconfirm"; name: string }
  | { call: "exclude"; name: string; at: string }
  | { call: "include"; name: string };

/** 主のスレッド → 受け手 */
export type IntakeRequest =
  /** 施設の設定で取り込みを始める（資料・決定は空） */
  | { op: "open"; options: IntakeOptions }
  /** 計画の ID・パック・施設の名前を変える（reread：資料の読み方に効くので読み直す） */
  | { op: "options"; options: IntakeOptions; reread: boolean }
  /** 当てる読み方を置き換える（reread：資料の読み方が変わったので読み直す） */
  | { op: "readings"; readings: LoadedReading[]; reread: boolean }
  /** 資料を 1 つ読む */
  | { op: "read"; name: string; bytes: Uint8Array }
  /**
   * 取り込みを作り直す。files があればその資料で（版を開いたとき）、無ければ今の資料で（年度の始まりを変えたとき）。
   * decisions があればその決定を、無ければ今の決定を置き直す
   */
  | { op: "reset"; options: IntakeOptions; readings: LoadedReading[]; files?: { name: string; bytes: Uint8Array }[]; decisions?: Decision[] }
  /** 決定を置く（どれか 1 つでも当てはまらなければ、どれも置かない） */
  | { op: "settle"; decisions: Decision[] }
  /** 決定を取り消す */
  | { op: "undo"; questionId: string }
  /** 写真の一覧への操作 */
  | { op: "photo"; photo: PhotoCall }
  /** 主のスレッドが写真の一覧を変えた（同じスレッドの受け手は一覧を共にするので、読み直しの印だけを送る） */
  | { op: "touch" }
  /** 画面が同期で読む写し */
  | { op: "view" }
  /** AI に渡す要約（取り込みの分。作業画面の分は主のスレッドが足す） */
  | { op: "survey" }
  /** 計画を作る */
  | { op: "compose" }
  /** 1 つの資料のシート（セルと行き先）。画面が開いた資料だけを読む */
  | { op: "sheets"; file: string }
  /** 次の未解決のセル（file があればその資料の中の最初） */
  | { op: "nextUnresolved"; after: CellPos | null; file: string | null }
  /** 突き合せの行 */
  | { op: "match"; noDate: string }
  /** 確定のときに版の記録に残す資料と、質問ごとに掛かった資料 */
  | { op: "commit" };

export interface CellPos {
  file: string;
  sheetIndex: number;
  r: number;
  c: number;
}

/** 資料を 1 つ読んだ答え */
export interface ReadReply {
  name: string;
  /** 取り込みが外したもの（同じ名前・読めない形式など。理由つき） */
  rejected: RejectedFile[];
  /** 資料として持った（設定を変えて読み直すときに使う） */
  accepted: boolean;
  /** 資料ごとの覚えから返した（読み手を走らせていない） */
  cached: boolean;
  /** 写真の一覧に新しく並んだもの（写真と、文字の無い PDF の頁） */
  listed: PhotoInput[];
}

/** 作り直した答え */
export interface ResetReply {
  /** 資料として持ったものの名前 */
  accepted: string[];
  listed: PhotoInput[];
}

export type SettleReply =
  | { ok: true; cellsAffected: number; rowsAffected: number; unresolved: number }
  | { ok: false; code: "unknown_question" | "answer_not_offered" | "human_decided"; questionId: string };

/** 画面に出す質問（取り込みの質問から、かかるセルの一覧を除いたもの） */
export type QuestionView = Omit<QuestionState, "items">;

/** 画面とツールが同期で読む写し（worker の取り込みの、ある時点の要約） */
export interface IntakeView {
  /** この写しに入っている、主のスレッドの資料と決定の版（受け手が最後に受けた要求の版） */
  at: number;
  /** 読めた資料の名前（写真で読み取りを置いたものも入る） */
  files: string[];
  rejected: RejectedFile[];
  counts: FileCounts[];
  /** 計画を作れない理由（取り込みの分） */
  blockers: string[];
  questions: QuestionView[];
  /** 答えの要る質問の ID（questions の順） */
  open: string[];
  decisions: Decision[];
  unusedDecisions: Decision[];
  unresolvedCells: number;
  /** 資料のどこかに「架空」の印がある */
  fictionalMark: boolean;
  /** 読み方の規則ごとの、効いたセルの数と見本 */
  ruleHits: Record<string, { count: number; sample: { file: string; ref: string; text: string } | null }>;
  photoReview: PhotoReview;
  /** 資料のシートの一覧（並びは取り込みの順） */
  sheets: { file: string; sheetIndex: number; sheet: string | null }[];
}

/** 1 つのシート（セルの行き先は、そのシートのセルの位置ごと） */
export interface SheetWire {
  file: string;
  sheet: string | null;
  sheetIndex: number;
  grid: SheetGrid;
  /**
   * セルの行き先。データ・除外のセルには、そのセルを決めた質問の ID の並び（qs）が付く（答えが効いているものだけ）。
   * 答えた時刻は作業場（workspace.ts の answeredAt）が持つ。worker の形でも同じスレッドの形でも同じ値
   */
  status: [ref: string, status: CellStatus][];
}

export interface CommitReply {
  files: { name: string; bytes: Uint8Array; sha256: string }[];
  /** 質問の ID → その質問のかかる資料の名前 */
  questionFiles: [questionId: string, files: string[]][];
  decisions: Decision[];
}

/** 要求ごとの答えの型 */
export interface IntakeReplies {
  open: null;
  options: null;
  readings: null;
  read: ReadReply;
  reset: ResetReply;
  settle: SettleReply;
  undo: { cellsAffected: number; rowsAffected: number; unresolved: number };
  photo: null;
  touch: null;
  view: IntakeView;
  survey: Survey;
  compose: { plan: Plan | null; blockers: string[] };
  sheets: SheetWire[];
  nextUnresolved: CellPos | null;
  match: Match;
  commit: CommitReply;
}

export type IntakeOp = IntakeRequest["op"];
export type ReplyOf<R extends IntakeRequest> = IntakeReplies[R["op"]];

/** 主のスレッド → 受け手の 1 通。id 0 は答えを待たない。v は送ったときの主のスレッドの資料と決定の版 */
export interface ToHost {
  id: number;
  v: number;
  req: IntakeRequest;
}

/** 受け手 → 主のスレッドの 1 通 */
export type FromHost =
  /** 起きた。alive は、止まるまで持っている見張りの lock の名前（alive.ts。Web Locks が無ければ無い） */
  | { kind: "ready"; alive?: string }
  | { kind: "reply"; id: number; ok: true; reply: IntakeReplies[IntakeOp] }
  | { kind: "reply"; id: number; ok: false; error: string };
