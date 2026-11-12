// 公開の台帳の置き場所（mushitaro/moyai#20）。設定は config/ledger.json の 1 か所だけ：
//   repo：台帳を持つ GitHub のリポジトリ（owner/name）
//   root：そのリポジトリの中の、台帳の根（README・.gitattributes を置く所）。リポジトリの根そのものなら ""
// 決まり・利用条件・束は、台帳の根の下の ledger/ に置く：
//   <root>/ledger/ledger.json・<root>/ledger/TERMS.md・<root>/ledger/bundles/<鍵ID>/…
// 道の定数と正規表現は、ここから導く。コード・試験・画面の文に、リポジトリの名前と道を直に書かない。
import config from "../../config/ledger.json" with { type: "json" };

export interface LedgerPlaceConfig {
  repo: string;
  root: string;
}

export interface LedgerPlace {
  /** 台帳を持つリポジトリ（owner/name） */
  repo: string;
  /** 台帳の根（リポジトリの根から。根そのものなら ""） */
  root: string;
  /** 決まり・利用条件・束を置くフォルダ（リポジトリの根から） */
  dir: string;
  /** 束の道：<dir>/bundles/<鍵ID 16 桁>/<連番 6 桁>-<ハッシュ先頭 16>.json（ASCII の小文字と数字だけ） */
  bundlePath: RegExp;
  /** 取り下げの印の道：<dir>/bundles/<鍵ID 16 桁>/retired.json */
  retiredPath: RegExp;
  /** 束の道の段の数（<dir>/bundles/<鍵ID>/<名前>） */
  pathDepth: number;
}

/** 台帳の根の下の、決まり・利用条件・束を置くフォルダの名前 */
export const LEDGER_INNER = "ledger";

const REPO_SHAPE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
/** 台帳の根は、無い（""）か、ASCII の小文字・数字・ハイフンの 1 段だけ（正規表現に入れても意味が変わらない字だけ） */
const ROOT_SHAPE = /^(?:[a-z0-9][a-z0-9-]{0,39})?$/;

/** 設定から、道の定数と正規表現を作る。形が違えば投げる（設定の誤りは、動かす前に止める） */
export function ledgerPlace(c: LedgerPlaceConfig): LedgerPlace {
  if (typeof c.repo !== "string" || !REPO_SHAPE.test(c.repo) || /\/\.\.?$/.test(c.repo)) throw new Error("config/ledger.json の repo が owner/name の形ではない");
  if (typeof c.root !== "string" || !ROOT_SHAPE.test(c.root)) throw new Error("config/ledger.json の root が、空か、小文字・数字・ハイフンの 1 段ではない");
  const dir = c.root ? `${c.root}/${LEDGER_INNER}` : LEDGER_INNER;
  const head = dir.replace(/\//g, "\\/");
  return {
    repo: c.repo,
    root: c.root,
    dir,
    bundlePath: new RegExp(`^${head}\\/bundles\\/([0-9a-f]{16})\\/(\\d{6}-[0-9a-f]{16}\\.json)$`),
    retiredPath: new RegExp(`^${head}\\/bundles\\/([0-9a-f]{16})\\/retired\\.json$`),
    pathDepth: dir.split("/").length + 3,
  };
}

/** この版の MOYAI が見る台帳の置き場所（config/ledger.json） */
export const LEDGER_PLACE: LedgerPlace = ledgerPlace(config);
