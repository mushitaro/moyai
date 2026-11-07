// 受け口が台帳の検証に使うパックの部品（全国の表と公開語彙）。packs.gen.ts の文字列を、アプリと同じ関数で読む。
// ハッシュは文字列のバイト列で決まり、台帳の決まり（ledger.json）の national・vocab と照らす（違えば台帳の検証が ✗ にする）。
import { loadNational, loadVocab } from "../../../src/share/k";
import type { LedgerPack } from "./handler";
import { PACK_TEXTS } from "./packs.gen";

const cache = new Map<string, LedgerPack | null>();

export function packOf(id: string): LedgerPack | null {
  if (cache.has(id)) return cache.get(id)!;
  const t = Object.hasOwn(PACK_TEXTS, id) ? PACK_TEXTS[id] : undefined;
  let made: LedgerPack | null = null;
  if (t) {
    try {
      const vocab = loadVocab(t.vocab);
      const table = loadNational(t.table);
      made = vocab.pack === id && table.pack === id ? { vocab, table } : null;
    } catch {
      made = null;
    }
  }
  cache.set(id, made);
  return made;
}

/** 入れたパックの ID（試験が packs/ と照らす） */
export const PACK_IDS: readonly string[] = Object.keys(PACK_TEXTS);
