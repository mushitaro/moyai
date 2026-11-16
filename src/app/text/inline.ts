// 部品やページに残っていた小さな字（区切り・括弧・「理由：」の頭など）。言語ごとの書き方をここに寄せる（2026-11-16）。
import { defineMessages } from "./i18n";

const EN_INLINE_TEXT = {
  /** 並べるときの区切り（「A・B」） */
  list: ", ",
  /** 見本などを並べる区切り（「A／B」） */
  alt: " / ",
  /** 名前に括弧で添える（「名前（添え）」） */
  paren: (s: string, inner: string) => `${s} (${inner})`,
  /** 「見出し：中身」 */
  colon: (head: string, body: string) => `${head}: ${body}`,
  /** 値を引用する（「「値」」） */
  quote: (s: string) => `“${s}”`,
  /** 日付の範囲 */
  range: (from: string, to: string) => `${from}–${to}`,
  /** 見出しと値の間の空き（日本語は全角の空き） */
  gap: " ",
  /** 押せない理由の頭 */
  reasonHead: "Reason: ",
  /** 確定のシートの星取の行：計画・実績の追加と削除 */
  star: { plan: "Plan", actual: "Actual", removed: (kind: string) => `${kind} removed`, added: (kind: string) => `${kind} added` },
  /** ルールの版（下書きでないとき） */
  ruleVersion: (v: string) => `v${v}`,
  /** Skill の名前に添える下書き */
  draft: (name: string) => `${name} (draft)`,
  /** 項目の欄の名前（「機器の名前」） */
  fieldOf: (entity: string, field: string) => `${entity} ${field.charAt(0).toLowerCase()}${field.slice(1)}`,
  /** ルールの適用先の字 */
  ruleTarget: { plan: "Plan", file: (f: string) => `Source file “${f}”`, headers: (hs: readonly string[]) => `Headers ${hs.map((h) => `“${h}”`).join(" ")}` },
};

export const INLINE_TEXT = defineMessages(EN_INLINE_TEXT, {
  list: "・",
  alt: "／",
  paren: (s: string, inner: string) => `${s}（${inner}）`,
  colon: (head: string, body: string) => `${head}：${body}`,
  quote: (s: string) => `「${s}」`,
  range: (from: string, to: string) => `${from}〜${to}`,
  gap: "　",
  reasonHead: "理由：",
  star: { plan: "計画", actual: "実績", removed: (kind: string) => `${kind}の削除`, added: (kind: string) => `${kind}の追加` },
  ruleVersion: (v: string) => `版 ${v}`,
  draft: (name: string) => `${name}（下書き）`,
  fieldOf: (entity: string, field: string) => `${entity}の${field}`,
  ruleTarget: { plan: "計画", file: (f: string) => `資料「${f}」`, headers: (hs: readonly string[]) => `見出しに「${hs.join("」「")}」` },
});
