// 写真の欄（取り込みの画面）と、写真のツールの結果の文の言葉。内部の言葉（型の名前など）を利用者に見せない。
export const PHOTO_TEXT = {
  title: "写真（AI クライアントに渡して読む）",
  lead:
    "写真（JPEG・PNG）は読まずに並べます。読むのは、人が 1 枚ずつ［AI クライアントに渡して読む］を押した写真だけです。" +
    "その画像は、AI クライアント（Claude Code・Claude Desktop）と、その先の AI の提供者に渡ります。" +
    "AI が読んだ格子は「要確認」で、人が画像と並べて確かめるまで計画は作れません。",
  none: "写真はありません。資料の受け口に JPEG か PNG をドロップすると、ここに並びます。",
  size: (kb: number) => `${kb.toLocaleString("ja-JP")} KB`,
  pages: (file: string, page: number) => `${file} の ${page} 頁（文字の無い頁）`,
  state: {
    unread: "読んでいない",
    allowed: "許した（AI の受け取り待ち）",
    sent: "AI に渡した（読み取り待ち）",
    read: "要確認",
    confirmed: "人が確かめた",
    excluded: "読まずに外した",
  },
  allow: "AI クライアントに渡して読む",
  allowAgain: "もう一度渡す",
  allowDisabled: "理由：ブリッジ未接続",
  exclude: "読まずに外す",
  include: "戻す",
  excludedNote: "読まずに外しました。計画には入りません（読まなかった資料に理由つきで数えます）。",
  allowedNote: (at: string) => `${at} に、人が AI クライアントに渡すことを許しました。AI が photo_transcribe（receive）で受け取るのを待っています。`,
  sentNote: (at: string) => `${at} に AI クライアントへ渡しました。AI が読んだ格子を置くのを待っています。`,
  unreadNote: "まだ読んでいません。読むか外すまで、計画は作れません。",
  dialog: {
    title: "写真を AI クライアントに渡す",
    preparing: "渡す画像を作っています（この画面の中で小さくし、JPEG にします）",
    lead: (name: string) => `「${name}」を、下の画像の形で AI クライアントに 1 回渡します。`,
    shape: (w: number, h: number, kb: number, q: number | null) => `${w} × ${h} 画素・JPEG ${kb.toLocaleString("ja-JP")} KB${q === null ? "" : `（品質 ${Math.round(q * 100)}）`}`,
    from: (w: number, h: number) => `元の画像 ${w} × ${h} 画素から作りました（切り抜いていません。位置などの付け足しの情報は落としました）。`,
    overTarget: (kb: number) => `目安の 100 KB に収まりませんでした（${kb.toLocaleString("ja-JP")} KB）。そのまま渡せます。`,
    where: "渡した画像は、AI クライアントと、その先の AI の提供者に渡ります。渡したあとで取り戻すことはできません。",
    once: "許しはこの画像に 1 回だけ効きます。AI が受け取ると使い終わります。",
    failed: "この画像を開けませんでした（壊れているか、ブラウザが読めない形です）。",
    tooLarge: (kb: number) => `小さくしても ${kb.toLocaleString("ja-JP")} KB あり、渡せる上限を越えるので渡せません。`,
    previewAlt: (name: string) => `AI クライアントに渡す画像（${name}）`,
    cancel: "やめる",
    submit: "渡すことを許す",
  },
  review: {
    title: "読み取りを画像と並べて確かめる",
    reviewCount: (cells: number, records: number | null) => (records ? `要確認 ${cells} セル（この写真から作った記録 ${records}）` : `要確認 ${cells} セル`),
    by: (at: string) => `AI（読み取り）が ${at} に置いた格子`,
    imageAlt: (name: string) => `${name}（AI に渡した画像。枠は読んだセルの位置）`,
    pick: "表か画像のセルを押すと、その位置と、AI が読んだ文字・確からしさをここに出します。",
    cell: (row: number, col: number) => `行 ${row + 1}・列 ${col + 1}`,
    aiText: (t: string) => `AI が読んだ文字：「${t}」`,
    confidence: (c: number) => `確からしさ ${c.toFixed(2)}`,
    low: "確からしさが低い",
    human: "人が直した",
    cleared: "（人が消した）",
    fix: "直す",
    fixLabel: "このセルの文字",
    fixHint: "空にすると、このセルを格子から外します。",
    reasonLabel: "確かめた理由",
    reasonPlaceholder: "例：画像の表と 1 行ずつ並べて、文字と数が合っている",
    confirm: "確かめた",
    confirmNeedsReason: "理由：理由が未入力",
    confirmed: (at: string, reason: string) => `人が ${at} に確かめました（理由：${reason}）。この写真から作った記録は要確認でなくなりました。`,
    unconfirm: "確かめを取り消す",
    discard: "読み取りを捨てる",
    discardHint: "人の直しも捨て、AI がもう一度置けるようにします。",
    refused: {
      unknown: "この写真は、もうありません。",
      no_reading: "まだ読み取りがありません。",
      confirmed: "確かめたあとは直せません。先に確かめを取り消してください。",
      no_cell: "そのセルは、読み取りにありません。",
      reason_empty: "理由が空です。",
    } as Record<string, string>,
  },
  // AI の作業の欄（取り込みの画面）
  ai: {
    received: (name: string) => `AI が写真「${name}」を受け取りました（人の許しを使い終えました）`,
    receiveRefused: "AI が写真を受け取ろうとしましたが、人が許した写真が無いので断りました",
    placed: (name: string, cells: number) => `AI が写真「${name}」に読んだ格子を置きました（${cells} セル。人が確かめるまで要確認）`,
    placeRefused: (name: string) => `AI が写真「${name}」に置こうとした格子を断りました（どのセルも置いていません）`,
    allowed: (name: string) => `人が写真「${name}」を AI クライアントに渡すことを許しました`,
  },
  // ツールの結果の文（AI に渡る。Claude Desktop では instructions が効かないので、次にすることを書く）
  tool: {
    received: (w: number, h: number) =>
      `画像（${w} × ${h} 画素の JPEG）をこの結果に添えました。画像を自分で読み、表の格子を photo_transcribe（mode: place）で置いてください。` +
      "行と列は 0 から、box は この画像の画素（左上が原点）で書きます。見えたとおりに書き、読めない所は推測で埋めず、置かないか確からしさを低くします。" +
      "置いたものは、人が画面で画像と並べて確かめるまで要確認で、計画は作れません。",
    placed: (cells: number) =>
      `${cells} セルを置きました。どれも要確認です。人が取り込みの画面で画像と並べて確かめるまで、計画は作れません（確かめるツールはありません）。` +
      "intake_survey で、この写真から増えた質問を読んでください。",
  },
} as const;
