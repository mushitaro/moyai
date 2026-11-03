// 公開の台帳の決まり（ledger/ledger.json）を作り、管理者の鍵で署名する（docs/plan.md §2.8 場 2）。
// 呼ぶのは人だけのコマンド `moyai ledger init`（端末でなければ断る）。AI のツールには無い。
// 管理者の鍵は、台帳ごとに作り、合言葉から scrypt で作った鍵で包んで状態フォルダ（keys/<台帳ID>.json）に置く。秘密鍵は台帳に書かない。
// 決まりは輪の circle.json と同じ形で、欄・帯・下限はコードの基本の決まり（baseRules）のまま。厳しくする向きの変更は未実装。
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readWrappedKey, writeWrappedKey } from "../bridge/places";
import { LEDGER_V, envelopeText, makeRulesDocBody, ringIdOf } from "./bundle";
import { PASSPHRASE_MIN } from "./checkpoint";
import { LEDGER_DIR, LEDGER_FILE, ledgerContext } from "./ledger";
import type { SharePack } from "./pack";
import { baseRules } from "./rules";
import { fingerprint, generateKeyPair, signBody, wrapPrivateKey } from "./sign";

export interface LedgerInitInput {
  /** 台帳のリポジトリの根（その下に ledger/ledger.json を書く） */
  root: string;
  pack: SharePack;
  passphrase: string;
  stateDir: string;
  /** 決まりの月（YYYY-MM） */
  month: string;
}

export type LedgerInitResult =
  | { ok: true; ledgerId: string; fingerprint: string; path: string }
  | { ok: false; reason: "exists" | "passphraseShort" | "monthInvalid" | "keyExists" | "selfCheck" };

/** 台帳の決まりを作り、管理者の鍵で署名して書く。前の ledger.json があれば書かない（足すだけの台帳を上書きしない） */
export function createLedger(i: LedgerInitInput): LedgerInitResult {
  if (i.passphrase.length < PASSPHRASE_MIN) return { ok: false, reason: "passphraseShort" };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month)) return { ok: false, reason: "monthInvalid" };
  const dir = join(i.root, LEDGER_DIR);
  const path = join(dir, LEDGER_FILE);
  if (existsSync(path)) return { ok: false, reason: "exists" };
  const admin = generateKeyPair();
  const rules = baseRules(i.pack.vocab.pack, i.pack.vocab.hash, i.pack.table.hash);
  const body = makeRulesDocBody(LEDGER_V, admin.pub, randomBytes(16).toString("hex"), 1, i.month, rules);
  const text = envelopeText(body, signBody(body, admin.privateKey));
  // 受け手と同じ関数で読めることを確かめてから書く
  if (!ledgerContext(Buffer.from(text, "utf8"), i.pack)) return { ok: false, reason: "selfCheck" };
  const ledgerId = ringIdOf(body);
  if (readWrappedKey(i.stateDir, ledgerId)) return { ok: false, reason: "keyExists" };
  if (!writeWrappedKey(i.stateDir, ledgerId, wrapPrivateKey(admin, i.passphrase))) return { ok: false, reason: "keyExists" };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
  return { ok: true, ledgerId, fingerprint: fingerprint(admin.pub), path };
}
