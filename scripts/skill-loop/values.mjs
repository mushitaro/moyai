// 行の値らしきものの数え（柱 C）。毎日の回し（feedback.mjs）と、公開の台帳の受け口の POST /feedback（services/ledger-intake）が同じものを使う。
// node: のものを使わない（Workers でも動く）。値そのものは返さない（種類ごとの数だけ）。
// 公開のリポジトリに行の値（金額・日付・番号・会社や施設の名前）を書かない決まり。迷えば数える（返して人に消してもらう）
const GENERIC_PREFIX = /^(ごみ|し尿|汚泥|下水|廃棄物|一般廃棄物|資源化|リサイクル)$/u;
const FACILITY = /([\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}A-Za-zー]{2,})(清掃工場|クリーンセンター|クリーンプラザ|環境センター|衛生センター|処理センター|浄化センター|処理場|焼却場)/gu;
export const VALUE_KINDS = {
  money: "金額",
  groupedNumber: "桁区切りの数",
  exactDate: "日付",
  code: "番号（契約・機器の番号の形）",
  longNumber: "4 桁以上の数",
  decimal: "小数",
  company: "会社の名前",
  facility: "施設の名前",
  contact: "連絡先",
};
const PATTERNS = {
  money: [/[¥￥]\s*\d/g, /\d\s*(?:円|万円|千円|百万円)/g],
  groupedNumber: [/\d{1,3}(?:,\d{3})+/g],
  exactDate: [/\d{2,4}\s*[/.\-年]\s*\d{1,2}\s*[/.\-月]\s*\d{1,2}/g, /(?:令和|平成|昭和|[RHS])\s*(?:\d{1,2}|元)\s*[.年]\s*\d{1,2}/g],
  code: [/[A-Za-z]{1,4}\d{0,4}-\d{2,}/g],
  longNumber: [/\d{4,}/g],
  decimal: [/\d+\.\d+/g],
  company: [/株式会社|有限会社|合同会社|合資会社|\(株\)|\(有\)|㈱|㈲/g],
  contact: [/[\w.+-]+@[\w-]+\.[\w.]+/g, /\d{2,4}-\d{2,4}-\d{4}/g],
};

/** 文の中の行の値らしきものを、種類ごとに数える（値そのものは返さない） */
export function countValues(texts) {
  const counts = Object.fromEntries(Object.keys(VALUE_KINDS).map((k) => [k, 0]));
  for (const raw of texts) {
    const t = String(raw ?? "").normalize("NFKC");
    for (const [k, res] of Object.entries(PATTERNS)) for (const re of res) counts[k] += (t.match(re) ?? []).length;
    for (const m of t.matchAll(FACILITY)) if (!GENERIC_PREFIX.test(m[1])) counts.facility++;
  }
  return counts;
}

/** 規則の中の、人の字の入る欄（数えるもの）。kind・id・author・役目などの決まった語と、公の分類の番号は数えない */
export function ruleTexts(rule) {
  const out = [];
  const add = (v) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(add);
  };
  for (const k of ["text", "reason", "by", "match", "column", "names", "words", "symbol", "meaning"]) add(rule?.[k]);
  if (rule?.when) {
    add(rule.when.headers);
    add(rule.when.file);
  }
  return out;
}


/**
 * 「会話で作ったルール」の欄の、数える字。アプリから書き出したファイル（moyai.reading-feedback/0）の "cells"（効いたセルの数）は
 * アプリが数えた数で行の値ではないので、0 に置き換えてから数える（1,000 セル以上に効いたルールを「4 桁以上の数」と数えない）。ほかはそのまま
 */
export function countableRuleBlock(text) {
  const t = String(text ?? "");
  return t.includes('"moyai.reading-feedback/0"') ? t.replace(/"cells"\s*:\s*\d+/g, '"cells": 0') : t;
}

/** 人の一言（アプリの困りごと。src/share/app-feedback.ts）に入れないもの（行の値のほかに）：ファイルの道・鍵やトークンらしき字・URL */
export const NOTE_KINDS = {
  path: "ファイルの道",
  secret: "鍵やトークンらしき字",
  url: "URL",
};
const NOTE_PATTERNS = {
  path: [/[A-Za-z]:[\\/]/g, /\\\\[^\\\s]+\\/g, /(?:^|[^\w.])(?:~|\/(?:Users|home|mnt|Volumes|var|etc|tmp|opt|private))\/[^\s]*/g, /\.\.\//g],
  secret: [/(?:github_pat_|gh[pousr]_|sk-|xox[abp]-|AKIA)[A-Za-z0-9_-]{8,}/g, /[A-Za-z0-9+/_=-]{32,}/g],
  url: [/\b[a-z][a-z0-9+.-]*:\/\//gi, /\bwww\.[\w-]+/gi],
};

/**
 * 人の一言の中の、送らないものらしき字を種類ごとに数える（行の値〔countValues〕とファイルの道・鍵・URL）。0 の種類は返さない。値そのものは返さない。
 * 画面・橋渡し・受け口の POST /app-feedback・毎日の回し（app-feedback.mjs）が同じものを使う
 */
export function countNote(text) {
  const t = String(text ?? "").normalize("NFKC");
  const counts = { ...countValues([t]) };
  for (const [k, res] of Object.entries(NOTE_PATTERNS)) counts[k] = res.reduce((n, re) => n + (t.match(re) ?? []).length, 0);
  return Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
}
