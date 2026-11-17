// 連携の約束の型（connector の interface。橋渡しの中だけ）。業務システムごとの読み書きは別の部品が持ち、ここの形に合わせて差し込む。
// つなぎ先の秘密（API キーなど）は ConnectionStore の中だけに置き、この形の外へ出さない（secret は中身を見ない opaque な値）。
import type { ConnectEnv, ConnectTarget, EamRecords, EamWriteChange, PlanLine } from "../../shared/connect";

/** つなぎ先の秘密。中身は部品だけが読む（橋渡しはログにも画面にも AI にも出さない） */
export type ConnectSecret = { readonly opaque: unknown };

/** 人が設定で足すつなぎ先（API キーは人の入力だけ。橋渡しは保存したら捨て、返さない） */
export interface ConnectAddInput {
  label: string;
  /** https://host[:port]（パスは付けない） */
  url: string;
  /** テストか本番かは必ず人が選ぶ（既定は置かない） */
  env: ConnectEnv;
  apiKey: string;
}
/** 足せなかった理由（部品の ConnectionStore の problem を写したもの。値は含めない） */
export type ConnectAddProblem = "name" | "url" | "key" | "tooMany" | "unavailable";

/** つなぎ先の保存（部品の ConnectionStore。偽の連携は試験の台） */
export interface ConnectionStoreLike {
  list(): ConnectTarget[];
  /** つなぎ先を足す（人だけの経路 connect_add からだけ呼ぶ）。無ければ、この裏では足せない */
  add?(input: ConnectAddInput): Promise<{ ok: true; target: ConnectTarget } | { ok: false; problem: ConnectAddProblem }>;
  /** その印のつなぎ先と秘密。無ければ null */
  open(id: string): { target: ConnectTarget; secret: ConnectSecret } | null;
}

/** 本番への書き込みの鍵の確かめ（部品の LicenseStore.authorize。偽の連携は試験の確かめに差し替える） */
export type LicenseAnswer = { ok: true } | { ok: false; reason: "noKey" | "expired" | "otherHost" };
export interface LicenseCheck {
  authorize(host: string): Promise<LicenseAnswer>;
}

/** 業務システム 1 つ分の読み書き（部品の loadRecords・planCommit・executeCommit に当たる） */
export interface EamConnector {
  /** 資産の木・保全計画・作業の実績を読む */
  loadRecords(target: ConnectTarget, secret: ConnectSecret): Promise<EamRecords>;
  /**
   * 書き込みの案（足す・変える）を作る。changes は芯の planWrite と同じ答え。unwritable は、そのつなぎ先には書けない変更の数
   * （資産の木に無い資産など。1 つでもあれば、橋渡しは差分ごと止めて人に返す。黙って一部だけを送らない）
   */
  planCommit(target: ConnectTarget, current: EamRecords, desired: readonly PlanLine[]): { changes: EamWriteChange[]; unwritable?: number };
  /** 書き込む。applied は書いた件数 */
  executeCommit(target: ConnectTarget, secret: ConnectSecret, changes: readonly EamWriteChange[]): Promise<{ applied: number }>;
}

/** 連携の裏：つなぎ先の保存・業務システムの読み書き・鍵の確かめ。無ければ連携のつなぎ先を出さない */
export interface ConnectBackend {
  /** 偽の連携か（試験の台。画面は【架空】として扱う） */
  fake: boolean;
  store: ConnectionStoreLike;
  connectors: Readonly<Record<string, EamConnector>>;
  license: LicenseCheck;
}
