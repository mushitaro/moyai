// 公開の台帳の試験の材料。決まり（ledger.json）・鍵・束は試験の中で作り、台帳のリポジトリは一時のフォルダに書く。
// 束は本物の写し取りと署名（previewBundle・sealBundle）で作る。わざと外れた束は、本物の署名の関数で body に署名し直して作る
// （送る側の封は外れた束に署名しないので、台帳に PR を出す人が手で作る束の代わり）。
import { LEDGER_DIR } from "../../../src/share/ledger";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEDGER_V, bundleFileName, envelopeText, fileHash, makeLedgerRetiredBody, makeRulesDocBody, ringIdOf, type ShareContext } from "../../../src/share/bundle";
import type { Plan } from "../../../src/shared/plan";
import { baseRules, type Rules } from "../../../src/share/rules";
import { previewBundle, sealBundle, type SendInput } from "../../../src/share/seal";
import { generateKeyPair, keyIdOf, sha256Hex, signBody, type KeyPair } from "../../../src/share/sign";
import { FACILITY_COMMON, SPEC, table, vocab } from "./fixtures";

/** 台帳の決まりの欄：間隔・工数・日数（コードの許可リストのすべて。経過年はどこにも出さない） */
export const LEDGER_FIELDS: Rules["fields"] = ["interval", "manDays", "days"];

export interface Ledger {
  admin: KeyPair;
  nonce: string;
  id: string;
  rules: Rules;
  text: string;
  ctx: ShareContext;
}

export function makeLedger(rulesPatch: Partial<Rules> = {}, o: { admin?: KeyPair; nonce?: string; version?: number } = {}): Ledger {
  const admin = o.admin ?? generateKeyPair();
  const nonce = o.nonce ?? "0123456789abcdef0123456789abcdef";
  const rules: Rules = { ...baseRules(vocab.pack, vocab.hash, table.hash), fields: [...LEDGER_FIELDS], ...rulesPatch };
  const body = makeRulesDocBody(LEDGER_V, admin.pub, nonce, o.version ?? 1, "2026-11", rules);
  const text = envelopeText(body, signBody(body, admin.privateKey));
  const id = ringIdOf(body);
  return { admin, nonce, id, rules, text, ctx: { table, vocab, rules, rulesHash: sha256Hex(text), to: { kind: "ledger", id } } };
}

export interface Signer {
  pair: KeyPair;
  key: string;
}

export function makeSigner(): Signer {
  const pair = generateKeyPair();
  return { pair, key: keyIdOf(pair.pub) };
}

export interface Sealed {
  text: string;
  hash: string;
  fileName: string;
  key: string;
  path: string;
}

export function ledgerInput(L: Ledger, s: Signer, p: Plan, o: Partial<SendInput> = {}): SendInput {
  return { ctx: L.ctx, plan: p, spec: SPEC, facility: FACILITY_COMMON, group: "NATIONAL", pub: s.pair.pub, seq: 1, prev: null, month: "2026-11", ...o };
}

/** 本物の写し取りと封で、台帳向けの束を作る */
export function sealLedger(L: Ledger, s: Signer, p: Plan, o: Partial<SendInput> = {}): Sealed {
  const input = ledgerInput(L, s, p, o);
  const pv = previewBundle(input);
  if (!pv.ok) throw new Error(`プレビューができない: ${pv.reason}`);
  const r = sealBundle(input, {
    previewHash: pv.bodyHash,
    pair: s.pair,
    acceptedRulesHash: L.ctx.rulesHash,
    acceptedRules: L.rules,
    localWords: [],
    cells: [],
    folderPath: "/tmp/ledger",
  });
  if (!r.ok) throw new Error(`封ができない: ${r.reason}`);
  return { text: r.text, hash: r.hash, fileName: r.fileName, key: s.key, path: `${LEDGER_DIR}/bundles/${s.key}/${r.fileName}` };
}

/** 正しい束の body を書き換え、本物の署名の関数で署名し直す（わざと外れた束） */
export function forge(base: Sealed, s: Signer, edit: (body: Record<string, unknown>) => void): Sealed {
  const body = JSON.parse(base.text).body as Record<string, unknown>;
  edit(body);
  const text = envelopeText(body, signBody(body, s.pair.privateKey));
  const hash = fileHash(text);
  const seq = typeof body.seq === "number" ? body.seq : 1;
  const fileName = bundleFileName(seq, hash);
  return { text, hash, fileName, key: s.key, path: `${LEDGER_DIR}/bundles/${s.key}/${fileName}` };
}

/** 台帳を持つリポジトリ（MOYAI の clone の形）を書く（ledger/ledger/ledger.json・TERMS.md・束） */
export function writeRepo(dir: string, L: Ledger | { text: string }, bundles: readonly Sealed[]): void {
  mkdirSync(join(dir, ...LEDGER_DIR.split("/"), "bundles"), { recursive: true });
  writeFileSync(join(dir, ...LEDGER_DIR.split("/"), "ledger.json"), L.text);
  writeFileSync(join(dir, ...LEDGER_DIR.split("/"), "TERMS.md"), "【架空】試験の利用条件\n");
  for (const b of bundles) {
    mkdirSync(join(dir, ...LEDGER_DIR.split("/"), "bundles", b.key), { recursive: true });
    writeFileSync(join(dir, ...b.path.split("/")), b.text);
  }
}

/** 公開台帳の取り下げの印（moyai.retired/0。ring の代わりに ledger）。既定はその鍵自身の署名。by で別の鍵の署名にできる（わざと外れた印） */
export function sealRetired(L: Ledger, s: Signer, last: number, o: { by?: Signer; pub?: string; key?: string; ledger?: string; month?: string } = {}): Sealed {
  const body = makeLedgerRetiredBody(o.ledger ?? L.id, o.key ?? s.key, o.pub ?? s.pair.pub, last, o.month ?? "2026-11");
  const text = envelopeText(body, signBody(body, (o.by ?? s).pair.privateKey));
  return { text, hash: fileHash(text), fileName: "retired.json", key: s.key, path: `${LEDGER_DIR}/bundles/${s.key}/retired.json` };
}
