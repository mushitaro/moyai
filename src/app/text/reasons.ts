// 輪を確かめたときの ✗ の理由の言葉（画面の受け取り・検問所と、CLI の verify ring が同じものを使う）。
// 理由のコードは src/share/recount.ts と src/share/ring.ts が出す。知らないコードは、頭の分け方で言う（黙って捨てない）。

const EXACT: Record<string, string> = {
  freeText: "自由記述（公開語彙に無い文字列）",
  money: "金額の形",
  exactDate: "正確な日付",
  circle: "輪の決まり（circle.json）を確かめられない",
  "circle.kind": "輪の決まりの形でない",
  "member.missing": "仲間のファイルが無い",
  "member.unconfirmed": "未確認の仲間（指紋の読み合わせがまだ）",
  "member.otherFolder": "仲間のファイルが別の鍵の名前に置かれている",
  "member.kind": "仲間のファイルの形でない",
  "file.notBundleName": "束の名前の形でない",
  "file.otherFolder": "別の鍵のフォルダに置かれている",
  "file.nameMismatch": "ファイルの名前が中身（連番とハッシュ）と合わない",
  "chain.badSignature": "署名 ✗",
  "chain.keyMismatch": "鍵が名乗りと合わない",
  "chain.seqMissing": "連番が無い",
  "chain.prevMissing": "前の束のハッシュが無い",
  "chain.prevOnFirst": "最初の束に前の束のハッシュがある",
  "chain.seqBelowKnown": "前に見た連番より小さい",
  "chain.otherDestination": "ほかの行き先の束",
  "chain.oldRules": "古い決まり",
  "chain.nationalMismatch": "全国の表の版が違う",
  "chain.vocabMismatch": "公開語彙の版が違う",
  "chain.packMismatch": "パックが違う",
  "chain.gap": "抜けあり（連番が飛んでいる）",
  "chain.broken": "鎖が切れている（前の束のハッシュが合わない）",
  "chain.duplicateSeq": "同じ連番の束が 2 つある",
  "chain.afterBreak": "切れた鎖のあとの束",
  "chain.vanished": "前に見た束が消えています",
  "k.unreadable": "紛れる数を数えられない",
  "k.stageMismatch": "見え方の段が合わない",
  "k.classNotCountable": "数えられない分類",
  "k.groupUnknown": "集団が分からない",
  "k.belowMin": "紛れる数が下限に届かない",
  "k.mismatch": "送る側の紛れる数と、数え直した数が違う",
  "k.upgradeBelowMin": "基幹改良の塊を出せる紛れる数に届かない",
  "shape.rules": "決まりの形でない",
};

const PREFIX: [string, string][] = [
  ["shape.", "形の外れ"],
  ["rules.", "決まりが緩くなっている"],
  ["chain.", "署名と鎖"],
  ["k.", "紛れる数"],
  ["member.", "仲間のファイル"],
  ["file.", "ファイル"],
];

export function reasonText(code: string): string {
  const e = EXACT[code];
  if (e) return e;
  for (const [p, t] of PREFIX) if (code.startsWith(p)) return `${t}（${code.slice(p.length)}）`;
  return code;
}
