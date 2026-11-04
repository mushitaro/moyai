// 読み方（3 段目の Skill）の保管先（docs/plan.md §2.17）。置き場所が範囲を決める：
//   <保管先>/skills/会社/<名前>/            会社の読み方
//   <保管先>/skills/担当/<呼び名>/<名前>/    担当者の読み方
//   <保管先>/<施設>/skills/<名前>/           施設の読み方
// 1 つの読み方は SKILL.md（人と Claude が読む文。手で編集してよい）と rules.json（moyai.reading/0）。中身のハッシュが版で、前の版は versions/ に足すだけ（消さない）。
// 書いた読み方は未承認。その読み方を使った版に人が署名したとき承認される（どの版が承認済みかは、呼ぶ側が渡す）。
import { createHash } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { ReadingSkill, type LoadedReading, type ReadingScope } from "../import/reading";

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

const SCOPE_LABEL: Record<ReadingScope, string> = { facility: "施設", person: "担当", company: "会社" };

/** SKILL.md の文：題・範囲・使い方・規則の一覧（人の言葉の 1 文） */
export function skillMarkdown(skill: ReadingSkill): string {
  const L = [
    `# 読み方：${skill.name}`,
    "",
    `範囲：${SCOPE_LABEL[skill.scope]}。MOYAI の取り込みが、資料を読むときに先に当てる決まり（3 段目の Skill。docs/plan.md §2.17）。`,
    "規則は rules.json にある。この文と rules.json は、手で編集してよい。編集すると版が変わり、その版を使った版に人が署名するまで、ほかの人の MOYAI では効かない。",
    "",
    "## 規則",
    "",
    ...skill.rules.map((r) => {
      const where = [r.when?.file ? `資料「${r.when.file}」` : null, r.when?.headers?.length ? `見出しに「${r.when.headers.join("」「")}」` : null].filter(Boolean).join("・");
      return `- ${r.text}${where ? `（効く資料：${where}）` : ""}`;
    }),
    "",
  ];
  return L.join("\n");
}

/** 版：SKILL.md と rules.json の中身のハッシュ（16 文字） */
export function readingVersion(md: string, rules: string): string {
  return createHash("sha256").update(md, "utf8").update("\u0000").update(rules, "utf8").digest("hex").slice(0, 16);
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
  const md = skillMarkdown(skill);
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
    out.push({ name: p.data.name, scope: p.data.scope, path: relPath(root, dir), version, rules: p.data.rules.length, approved: approvedVersions.has(version), approvedIn: approvedVersions.get(version) ?? null, skill: p.data });
  }
  return out;
}

/** 承認済みの読み方の版：保管先の確定（署名）した版の記録が使った読み方の版 → その読み方の版を最初に使った星取表の版の番号 */
export async function approvedReadingVersions(root: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const planId of subdirs(join(root, "plans"))) {
    const vdir = join(root, "plans", planId, "versions");
    let files: string[] = [];
    try {
      files = readdirSync(vdir).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      const n = Number(f.replace(/\.json$/, ""));
      try {
        const rec = JSON.parse(await readFile(join(vdir, f), "utf8")) as { readingSkills?: { version?: unknown }[] };
        for (const r of rec.readingSkills ?? []) if (typeof r.version === "string" && Number.isInteger(n) && !(out.get(r.version)! <= n)) out.set(r.version, n);
      } catch {
        // 読めない記録は数えない
      }
    }
  }
  return out;
}

/** 作業画面に渡す、承認済みの読み方 */
export function loadedOf(list: readonly ListedReading[]): LoadedReading[] {
  return list.filter((x) => x.approved).map((x) => ({ skill: x.skill, version: x.version, path: x.path, approved: true, approvedIn: x.approvedIn, draft: false }));
}
