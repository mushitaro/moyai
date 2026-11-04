// 読み方（3 段目の Skill）の保管先（docs/plan.md §2.17）。置き場所が範囲を決める：
//   <保管先>/skills/会社/<名前>/            会社の読み方
//   <保管先>/skills/担当/<呼び名>/<名前>/    担当者の読み方
//   <保管先>/<施設>/skills/<名前>/           施設の読み方
// 1 つの読み方は SKILL.md（人と Claude が読む文。手で編集してよい）と rules.json（moyai.reading/0）。中身のハッシュが版で、前の版は versions/ に足すだけ（消さない）。
// 書いた読み方は未承認。その読み方を使った版に人が署名したとき承認される。数えるのは、確かめた確定か承認の署名で、
// この PC が信じる鍵（自分の鍵か、指紋を読み合わせて確認済みの鍵）のものだけ（docs/plan.md §2.18.2）。
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ReadingSkill, handWritten, skillMarkdown, type LoadedReading, type ReadingScope } from "../import/reading";
import { PLAN_ID, readHistory, type PlanHistory, type SignatureInfo } from "../plan/store";

const SKILLS = "skills";
const COMPANY = "会社";
const PERSON = "担当";
const SKILL_MD = "SKILL.md";
const RULES = "rules.json";

/** 道の 1 つの段に使える名前か（区切り・予約の文字・. で始まる名前を使わない） */
export function safeSegment(s: string): boolean {
  return /^[^\\/:*?"<>|\x00-\x1f.][^\\/:*?"<>|\x00-\x1f]{0,79}$/u.test(s) && s.trim() === s;
}

/** 範囲ごとの置き場所。名前が使えなければ null */
export function readingDir(root: string, scope: ReadingScope, name: string, by: string | null, facilityKey: string | null): string | null {
  if (!safeSegment(name)) return null;
  if (scope === "company") return join(root, SKILLS, COMPANY, name);
  if (scope === "person") return by && safeSegment(by) ? join(root, SKILLS, PERSON, by, name) : null;
  return facilityKey && safeSegment(facilityKey) ? join(root, facilityKey, SKILLS, name) : null;
}

/** 版：SKILL.md と rules.json の中身の SHA-256（全長。16 文字に切ると衝突を作れるため） */
export function readingVersion(md: string, rules: string): string {
  return createHash("sha256").update(md, "utf8").update("\u0000").update(rules, "utf8").digest("hex");
}

/** 一時の名前で書いてから置き換える（書きかけを読ませない） */
async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

export type RegisterResult = { ok: true; path: string; version: string; rules: number } | { ok: false; reason: "nameInvalid" | "skillInvalid" };

/** 読み方を書く（未承認）。同じ中身なら書き直さない。前の版は versions/<版>/ に写す */
export async function registerReading(root: string, skillIn: unknown, by: string | null, facilityKey: string | null): Promise<RegisterResult> {
  const p = ReadingSkill.safeParse(skillIn);
  if (!p.success) return { ok: false, reason: "skillInvalid" };
  const skill = p.data;
  const dir = readingDir(root, skill.scope, skill.name, by, facilityKey);
  if (!dir) return { ok: false, reason: "nameInvalid" };
  const rules = `${JSON.stringify(skill, null, 1)}\n`;
  // 人が手で書いた「## 補い」の節は、規則から作り直しても残す
  const prevMd = existsSync(join(dir, SKILL_MD)) ? await readFile(join(dir, SKILL_MD), "utf8") : null;
  const md = skillMarkdown(skill, prevMd ? handWritten(prevMd) : null);
  const version = readingVersion(md, rules);
  await mkdir(dir, { recursive: true });
  const oldRules = existsSync(join(dir, RULES)) ? await readFile(join(dir, RULES), "utf8") : null;
  const oldMd = existsSync(join(dir, SKILL_MD)) ? await readFile(join(dir, SKILL_MD), "utf8") : null;
  if (oldRules !== null) {
    const oldVersion = readingVersion(oldMd ?? "", oldRules);
    if (oldVersion === version) return { ok: true, path: relPath(root, dir), version, rules: skill.rules.length };
    const keep = join(dir, "versions", oldVersion);
    await mkdir(keep, { recursive: true });
    if (!existsSync(join(keep, RULES))) await writeFile(join(keep, RULES), oldRules, "utf8");
    if (oldMd !== null && !existsSync(join(keep, SKILL_MD))) await writeFile(join(keep, SKILL_MD), oldMd, "utf8");
  }
  await writeAtomic(join(dir, SKILL_MD), md);
  await writeAtomic(join(dir, RULES), rules);
  return { ok: true, path: relPath(root, dir), version, rules: skill.rules.length };
}

const relPath = (root: string, dir: string) => relative(root, dir).split(sep).join("/");

const subdirs = (d: string): string[] => {
  try {
    return readdirSync(d, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name !== "versions")
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
};

export interface ListedReading {
  name: string;
  scope: ReadingScope;
  path: string;
  version: string;
  rules: number;
  approved: boolean;
  /** 承認した星取表の版の番号（その読み方の版を最初に使った、署名した版。未承認は null） */
  approvedIn: number | null;
  skill: ReadingSkill;
  /** SKILL.md の文（読めなければ空） */
  text: string;
}

/** 保管先の読み方の一覧（形の外れたものは数えない）。approvedVersions：署名した版が使った読み方の版 → 承認した星取表の版の番号 */
export async function listReadings(root: string, approvedVersions: ReadonlyMap<string, number>): Promise<ListedReading[]> {
  const dirs: string[] = [];
  for (const n of subdirs(join(root, SKILLS, COMPANY))) dirs.push(join(root, SKILLS, COMPANY, n));
  for (const who of subdirs(join(root, SKILLS, PERSON))) for (const n of subdirs(join(root, SKILLS, PERSON, who))) dirs.push(join(root, SKILLS, PERSON, who, n));
  for (const f of subdirs(root)) if (f !== SKILLS) for (const n of subdirs(join(root, f, SKILLS))) dirs.push(join(root, f, SKILLS, n));
  const out: ListedReading[] = [];
  for (const dir of dirs) {
    if (!existsSync(join(dir, RULES))) continue;
    const rules = await readFile(join(dir, RULES), "utf8");
    const md = existsSync(join(dir, SKILL_MD)) ? await readFile(join(dir, SKILL_MD), "utf8") : "";
    let v: unknown;
    try {
      v = JSON.parse(rules);
    } catch {
      continue;
    }
    const p = ReadingSkill.safeParse(v);
    if (!p.success) continue;
    const version = readingVersion(md, rules);
    out.push({ name: p.data.name, scope: p.data.scope, path: relPath(root, dir), version, rules: p.data.rules.length, approved: approvedVersions.has(version), approvedIn: approvedVersions.get(version) ?? null, skill: p.data, text: md });
  }
  return out;
}

/** 承認済みの読み方の版：確かめた確定か承認の署名があり、その署名の鍵をこの PC が信じる版が使った読み方の版 → その読み方の版を最初に使った星取表の版の番号。
 * 確かめで合わない版（鎖・署名）から先と、署名の無い前の形の版は数えない。trusted：署名の鍵を信じるか（橋渡しが覚えた鍵と照らす） */
export async function approvedReadingVersions(root: string, trusted: (sig: SignatureInfo) => boolean): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const planId of subdirs(join(root, "plans"))) {
    if (!PLAN_ID.test(planId)) continue;
    let hist: PlanHistory;
    try {
      hist = await readHistory(root, planId);
    } catch {
      continue; // 読めない計画は数えない
    }
    const bad = hist.versions.findIndex((v) => v.problem !== null);
    for (const v of bad < 0 ? hist.versions : hist.versions.slice(0, bad)) {
      if (v.legacy || !v.signatures.some((x) => (x.role === "confirm" || x.role === "approve") && trusted(x))) continue;
      const rec = JSON.parse(await readFile(join(root, "plans", planId, "versions", `${String(v.version).padStart(6, "0")}.json`), "utf8")) as { readingSkills?: { version?: unknown }[] };
      for (const r of rec.readingSkills ?? []) if (typeof r.version === "string" && !(out.get(r.version)! <= v.version)) out.set(r.version, v.version);
    }
  }
  return out;
}

/** 作業画面に渡す、承認済みの読み方 */
export function loadedOf(list: readonly ListedReading[]): LoadedReading[] {
  return list.filter((x) => x.approved).map((x) => ({ skill: x.skill, version: x.version, path: x.path, approved: true, approvedIn: x.approvedIn, draft: false }));
}
