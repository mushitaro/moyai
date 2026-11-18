// アプリの困りごと・要望（運営者 2026-11-18「作ってください」。絵は Wire Frame の「AppFeedback」）。
// 読み方のフィードバック（reading-feedback.ts。ルールの形）とは別の道：人が設定の「困りごと」に書いた一言と、決まった付き物だけを送る。
// 入れるもの：人の一言（note。400 字まで）・MOYAI の版（ビルドのコミットの頭）・設定を開く前の画面の名前（決まった語）・OS の種類（決まった語）・言語。
// 入れないもの：資料の中身・行の値・施設や会社の名前・鍵・トークン・ファイルの道（どの欄もそれを持てない形。一言は、送る前に数えて当たれば送らない）。
// 画面（設定）・橋渡し（人だけの経路 app_feedback_send）・受け口（POST /app-feedback）・毎日の回し（scripts/skill-loop/app-feedback.mjs）が同じ形と数えを使う。
// 画面でも Workers でも読むので node: のものを使わない。
import { countNote } from "../../scripts/skill-loop/values.mjs";
import { parseJsonStrict } from "./jcs";

export const APP_FEEDBACK_SCHEMA = "moyai.app-feedback/0";
/** 人の一言の上限（字。NFC にそろえたあと） */
export const APP_FEEDBACK_NOTE_MAX = 400;
/** 一言の行の上限 */
export const APP_FEEDBACK_NOTE_LINES = 20;

/** 画面の名前（設定を開く前にいた画面。HOSHITORI はシートまで） */
export const APP_FEEDBACK_SCREENS = [
  "top",
  "hoshitori",
  "hoshitori.chart",
  "hoshitori.cost",
  "hoshitori.match",
  "hoshitori.readings",
  "hoshitori.check",
  "hoshitori.decisions",
  "hoshitori.export",
  "hoshitori.share",
  "hoshitori.connect",
  "hoshitori.files",
  "industries",
  "settings",
  "other",
] as const;
export type AppFeedbackScreen = (typeof APP_FEEDBACK_SCREENS)[number];

export const APP_FEEDBACK_OS = ["windows", "mac", "linux", "other"] as const;
export type AppFeedbackOs = (typeof APP_FEEDBACK_OS)[number];

export const APP_FEEDBACK_LANGS = ["ja", "en"] as const;
export type AppFeedbackLang = (typeof APP_FEEDBACK_LANGS)[number];

/** MOYAI の版：ビルドのコミットの頭（7〜40 字の 16 進。作業ツリーに変更があれば末尾に +）か unknown */
export const APP_FEEDBACK_VERSION = /^(?:[0-9a-f]{7,40}\+?|unknown)$/;

export interface AppFeedbackFile {
  schema: typeof APP_FEEDBACK_SCHEMA;
  note: string;
  version: string;
  screen: AppFeedbackScreen;
  os: AppFeedbackOs;
  lang: AppFeedbackLang;
}

const KEYS = ["schema", "note", "version", "screen", "os", "lang"] as const;
/** 改行のほかの制御文字・書式の字（見えない字で文を隠させない） */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f​-‏‪-‮⁠-⁤﻿]/u;

/** 一言をそろえる（NFC・改行は \n・前後の空白を落とす） */
export function normalizeNote(raw: string): string {
  return raw.normalize("NFC").replace(/\r\n?/g, "\n").trim();
}

/** 一言の形の外れ（null は通る） */
export function noteProblem(note: string): "empty" | "tooLong" | "tooManyLines" | "control" | null {
  if (note.length === 0) return "empty";
  if ([...note].length > APP_FEEDBACK_NOTE_MAX) return "tooLong";
  if (note.split("\n").length > APP_FEEDBACK_NOTE_LINES) return "tooManyLines";
  if (CONTROL.test(note)) return "control";
  return null;
}

/** 送る全文（画面が見せる字そのもの。橋渡しと受け口は、この形と同じ字だけを受ける） */
export function appFeedbackText(f: AppFeedbackFile): string {
  return `${JSON.stringify({ schema: f.schema, note: f.note, version: f.version, screen: f.screen, os: f.os, lang: f.lang }, null, 2)}\n`;
}

export type AppFeedbackBuild = { ok: true; file: AppFeedbackFile; text: string } | { ok: false; reason: NonNullable<ReturnType<typeof noteProblem>> };

export function buildAppFeedback(i: { note: string; version: string; screen: AppFeedbackScreen; os: AppFeedbackOs; lang: AppFeedbackLang }): AppFeedbackBuild {
  const note = normalizeNote(i.note);
  const p = noteProblem(note);
  if (p) return { ok: false, reason: p };
  const file: AppFeedbackFile = { schema: APP_FEEDBACK_SCHEMA, note, version: APP_FEEDBACK_VERSION.test(i.version) ? i.version : "unknown", screen: i.screen, os: i.os, lang: i.lang };
  return { ok: true, file, text: appFeedbackText(file) };
}

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/** 全文を厳しく読む（重複したキー・余計な欄・形の外れは null）。canonical が true なら、appFeedbackText と同じ字のときだけ通す */
export function parseAppFeedback(text: string, opts: { canonical?: boolean } = {}): AppFeedbackFile | null {
  const p = parseJsonStrict(text);
  if (!p.ok || p.bom || p.duplicateKeys > 0 || p.protoKeys > 0 || p.loneSurrogates > 0) return null;
  const v = p.value;
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== KEYS.length || !KEYS.every((k) => keys.includes(k))) return null;
  if (o.schema !== APP_FEEDBACK_SCHEMA) return null;
  if (typeof o.note !== "string" || normalizeNote(o.note) !== o.note || noteProblem(o.note) !== null) return null;
  if (typeof o.version !== "string" || !APP_FEEDBACK_VERSION.test(o.version)) return null;
  if (!oneOf(APP_FEEDBACK_SCREENS, o.screen) || !oneOf(APP_FEEDBACK_OS, o.os) || !oneOf(APP_FEEDBACK_LANGS, o.lang)) return null;
  const file: AppFeedbackFile = { schema: APP_FEEDBACK_SCHEMA, note: o.note, version: o.version, screen: o.screen, os: o.os, lang: o.lang };
  if (opts.canonical && appFeedbackText(file) !== text) return null;
  return file;
}

/** 一言の中の、送らないものらしき字（行の値・ファイルの道・鍵・URL）を種類ごとに数える（値は返さない。0 の種類は返さない。scripts/skill-loop/values.mjs の countNote） */
export function appFeedbackCounts(note: string): Record<string, number> {
  return countNote(note);
}

/** OS の種類（ブラウザの navigator か、Node の process.platform から） */
export function osOf(platform: string | undefined | null): AppFeedbackOs {
  const p = (platform ?? "").toLowerCase();
  if (p.startsWith("win")) return "windows";
  if (p === "darwin" || p.startsWith("mac")) return "mac";
  if (p.startsWith("linux")) return "linux";
  return "other";
}
