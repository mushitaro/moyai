// 今の言語を React の部品から読む（言語が変わると描き直る）。i18n.ts は React を持たない（橋渡しの出力・契約の試験からも読む）。
import { useSyncExternalStore } from "react";
import { getLang, subscribeLang, type Lang } from "./i18n";

/** 今の言語。変わると、使っている部品が描き直る */
export function useLang(): Lang {
  return useSyncExternalStore(subscribeLang, getLang, getLang);
}
