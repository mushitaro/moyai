// EXPORT の様式の欄の、画面の中だけの置き場（仕事 template-layout-v1）：
// - Claude が intake_add_files（source: template）で入れた様式（まだ保存していない）と、画面が保存先から読んだ様式のバイト列
// - Claude が screen_set の templateLayout で置いた写し方の案（下書き。人が EXPORT で見本を見て「この写し方で出力」を押すまで使わない）
// 保存（template_save）と出力は、人が押したときだけ（pages/Export.tsx）。このタブを閉じると、保存していない様式と案は消える。
import { useSyncExternalStore } from "react";
import type ExcelJS from "exceljs";
import type { TemplateLayout } from "../../shared/template-layout";

export interface KnownTemplate {
  name: string;
  bytes: Uint8Array;
  /** 案を確かめるために読んだブック（書き換えない。書くときは bytes から読み直す） */
  probe: ExcelJS.Workbook;
  /** 保存先の様式なら、その版。Claude が入れてまだ保存していない様式は null */
  saved: { version: string } | null;
  at: string;
}

export interface LayoutDraft {
  template: string;
  layout: TemplateLayout;
  /** 置いたのは AI（人が受けるまで使わない） */
  author: "ai";
  at: string;
}

export interface TemplateDrafts {
  known: readonly KnownTemplate[];
  drafts: ReadonlyMap<string, LayoutDraft>;
}

type Listener = () => void;
const listeners = new Set<Listener>();
/** Claude が入れて、まだ保存していない様式（名前 → 様式） */
let pending = new Map<string, KnownTemplate>();
/** 画面が保存先から読んだ様式（名前 → いちばん新しく読んだ版） */
let saved = new Map<string, KnownTemplate>();
let drafts = new Map<string, LayoutDraft>();
let snapshot: TemplateDrafts = { known: [], drafts: new Map() };
/** Claude が置いたものを EXPORT で選ばせる頼み（画面が 1 回だけ受け取る） */
let selectRequest: string | null = null;

function emit(): void {
  snapshot = { known: [...pending.values(), ...saved.values()], drafts: new Map(drafts) };
  for (const l of [...listeners]) l();
}
function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/**
 * 様式を置く。Claude が入れた様式（saved: null）は、同じ名前の前の案を捨て（様式が変われば案は合わない）、EXPORT で選ばせる。
 * 保存先から読んだ様式は、保存先の様式として持つ（Claude が入れた同じ名前の様式は消さない）
 */
export function offerTemplate(t: Omit<KnownTemplate, "at">): void {
  const k = { ...t, at: new Date().toISOString() };
  if (t.saved === null) {
    pending.set(t.name, k);
    drafts.delete(t.name);
    selectRequest = t.name;
  } else saved.set(t.name, k);
  emit();
}

/** 名前で様式を引く（Claude が入れてまだ保存していないものを先に） */
export function knownTemplate(name: string): KnownTemplate | null {
  return pending.get(name) ?? saved.get(name) ?? null;
}

/** Claude が入れてまだ保存していない様式 */
export function pendingTemplates(s: TemplateDrafts): KnownTemplate[] {
  return s.known.filter((k) => k.saved === null);
}

/** 写し方の案を置く（下書き）。同じ様式の前の案と入れ替える */
export function proposeLayout(template: string, layout: TemplateLayout): void {
  drafts.set(template, { template, layout, author: "ai", at: new Date().toISOString() });
  selectRequest = template;
  emit();
}

export function layoutDraft(template: string): LayoutDraft | null {
  return drafts.get(template) ?? null;
}

/** 人が案を捨てる */
export function discardLayout(template: string): void {
  if (drafts.delete(template)) emit();
}

/** 人が「この写し方で出力」を押して保存した：案を捨て、様式は保存先の版として持つ */
export function markSaved(template: string, version: string): void {
  const k = knownTemplate(template);
  drafts.delete(template);
  pending.delete(template);
  if (k) saved.set(template, { ...k, saved: { version } });
  emit();
}

/** EXPORT が、Claude の置いた様式を選ぶ頼みを受け取る（1 回だけ） */
export function takeSelectRequest(): string | null {
  const r = selectRequest;
  selectRequest = null;
  return r;
}

export function useTemplateDrafts(): TemplateDrafts {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** 試験用 */
export function resetTemplateDraftsForTest(): void {
  pending = new Map();
  saved = new Map();
  drafts = new Map();
  selectRequest = null;
  snapshot = { known: [], drafts: new Map() };
}
