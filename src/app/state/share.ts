// SHARE の画面で人が選んでいる共有先・共有フォルダ・見え方の答え（このタブのメモリにだけ置く）。
// AI の share_preview は、SHARE の画面が開いていればこの選びで数える（画面と同じ数を返すため）。
// 画面を閉じると消す：開き直した画面は既定の選びから始めるので、橋渡しも既定の選び（src/share/share-preview.ts）で数える。

export interface ShareChoice {
  planId: string;
  dest: "ring" | "ledger";
  ringId: string | null;
  answers: { facility: Record<string, string | null>; inNationalTable: boolean | null };
}

let current: ShareChoice | null = null;

export function setShareChoice(c: ShareChoice | null): void {
  current = c;
}

export function getShareChoice(): ShareChoice | null {
  return current;
}
