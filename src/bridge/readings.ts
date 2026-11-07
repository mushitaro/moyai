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
import { ReadingSkill, handWritten, isPlanRule, skillMarkdown, type LoadedReading, type ReadingScope } from "../import/reading";
import { CYCLE_KEY, PLAN_RULE_SOURCE } from "../plan/cycle";
import { PLAN_ID, readHistory, type PlanHistory, type SignatureInfo } from "../plan/store";
import { readTurn } from "../plan/turn";

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

/**
 * 削った中身を、今の下書きのファイルに触らずに versions/<版>/ にだけ書く（Architect の 42 の答え 4）。
 * 確定で、案を受けていない計画ルールを削った読み方を版の記録に載せるとき：保管先の今の下書きは削らずに残し、
 * 版の記録が指す版（削った中身のハッシュ）は versions/ に置く。今のファイルと同じ中身なら何も書かない
 */
export async function recordReadingVersion(root: string, skillIn: unknown, by: string | null, facilityKey: string | null): Promise<RegisterResult> {
  const p = ReadingSkill.safeParse(skillIn);
  if (!p.success) return { ok: false, reason: "skillInvalid" };
  const skill = p.data;
  const dir = readingDir(root, skill.scope, skill.name, by, facilityKey);
  if (!dir) return { ok: false, reason: "nameInvalid" };
  const rules = `${JSON.stringify(skill, null, 1)}\n`;
  const curMd = existsSync(join(dir, SKILL_MD)) ? await readFile(join(dir, SKILL_MD), "utf8") : null;
  const md = skillMarkdown(skill, curMd ? handWritten(curMd) : null);
  const version = readingVersion(md, rules);
  const curRules = existsSync(join(dir, RULES)) ? await readFile(join(dir, RULES), "utf8") : null;
  if (curRules !== null && readingVersion(curMd ?? "", curRules) === version) return { ok: true, path: relPath(root, dir), version, rules: skill.rules.length };
  const keep = join(dir, "versions", version);
  await mkdir(keep, { recursive: true });
  if (!existsSync(join(keep, RULES))) {
    await writeAtomic(join(keep, SKILL_MD), md);
    await writeAtomic(join(keep, RULES), rules);
  }
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
  /** 範囲は置き場所で決まる（rules.json の scope ではない。Db の重-5） */
  scope: ReadingScope;
  /** 施設の読み方なら施設の鍵、担当者の読み方なら呼び名（置き場所の名前）。会社は null */
  owner: string | null;
  /** 置き場所のいちばん上の版か（false は versions/ に残した前の版） */
  current: boolean;
  path: string;
  version: string;
  rules: number;
  approved: boolean;
  /** 承認した星取表の版の番号（その読み方の版を最初に使った、署名した版。未承認は null） */
  approvedIn: number | null;
  /** 使った署名のいちばん新しい時刻（未承認は null） */
  approvedAt: string | null;
  skill: ReadingSkill;
  /** SKILL.md の文（読めなければ空） */
  text: string;
}

/** 承認した記録：その読み方の版を最初に使った星取表の版の番号と、使った署名のいちばん新しい時刻 */
export interface ApprovedReading {
  in: number;
  at: string;
}

/**
 * 保管先の読み方の一覧（形の外れたものは数えない）。approvedVersions：署名した版が使った読み方の版 → 承認の記録。
 * いちばん上の版のほかに、versions/ に残した前の版も並べる（未承認の版を上に書いても、承認済みの前の版が消えないように。Db の重-4）
 */
export async function listReadings(root: string, approvedVersions: ReadonlyMap<string, ApprovedReading>): Promise<ListedReading[]> {
  const dirs: { dir: string; scope: ReadingScope; owner: string | null }[] = [];
  for (const n of subdirs(join(root, SKILLS, COMPANY))) dirs.push({ dir: join(root, SKILLS, COMPANY, n), scope: "company", owner: null });
  for (const who of subdirs(join(root, SKILLS, PERSON))) for (const n of subdirs(join(root, SKILLS, PERSON, who))) dirs.push({ dir: join(root, SKILLS, PERSON, who, n), scope: "person", owner: who });
  for (const f of subdirs(root)) if (f !== SKILLS) for (const n of subdirs(join(root, f, SKILLS))) dirs.push({ dir: join(root, f, SKILLS, n), scope: "facility", owner: f });
  const out: ListedReading[] = [];
  const places = dirs.flatMap((d) => [{ ...d, current: true }, ...subdirs(join(d.dir, "versions")).map((v) => ({ ...d, dir: join(d.dir, "versions", v), current: false }))]);
  for (const { dir, scope, owner, current } of places) {
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
    const a = approvedVersions.get(version);
    out.push({ name: p.data.name, scope, owner, current, path: relPath(root, dir), version, rules: p.data.rules.length, approved: !!a, approvedIn: a?.in ?? null, approvedAt: a?.at ?? null, skill: { ...p.data, scope }, text: md });
  }
  return out;
}

/** AI に本文を渡してよい読み方か：会社の範囲、この PC の呼び名の担当、作業画面の今の施設のものだけ（台帳の中-4） */
export function readingTextShown(x: { scope: ReadingScope; owner: string | null }, facility: string | null, me: string | null): boolean {
  if (x.scope === "company") return true;
  if (x.scope === "person") return me !== null && x.owner === me;
  return facility !== null && x.owner === facility;
}

/** 承認済みの読み方の版：確かめた確定か承認の署名があり、その署名の鍵をこの PC が信じる版が使った読み方の版 → その読み方の版を最初に使った星取表の版の番号。
 * 確かめで合わない版（鎖・署名）から先と、署名の無い前の形の版は数えない。trusted：署名の鍵を信じるか（橋渡しが覚えた鍵と照らす） */
export async function approvedReadingVersions(root: string, trusted: (sig: SignatureInfo) => boolean): Promise<Map<string, ApprovedReading>> {
  const out = new Map<string, ApprovedReading>();
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
      const sigs = v.signatures.filter((x) => (x.role === "confirm" || x.role === "approve") && trusted(x));
      if (v.legacy || sigs.length === 0) continue;
      const at = sigs.map((x) => x.at).sort().at(-1)!;
      const rec = JSON.parse(await readFile(join(root, "plans", planId, "versions", `${String(v.version).padStart(6, "0")}.json`), "utf8")) as { readingSkills?: { version?: unknown }[] };
      for (const r of rec.readingSkills ?? []) {
        if (typeof r.version !== "string") continue;
        const was = out.get(r.version);
        out.set(r.version, { in: was ? Math.min(was.in, v.version) : v.version, at: was && was.at > at ? was.at : at });
      }
    }
  }
  return out;
}

/**
 * 作業画面に渡す、承認済みの読み方：置き場所ごとに 1 つ。いちばん上の版が承認済みならそれ、未承認なら前の版のうちいちばん新しく承認されたもの。
 * 担当者の読み方は、その人（この PC の呼び名）のものだけ。施設の読み方は施設の鍵を付けて渡し、作業画面が今の施設のものだけを当てる（Db の重-4・重-5）
 */
export function loadedOf(list: readonly ListedReading[], who: string | null): LoadedReading[] {
  const byPlace = new Map<string, ListedReading[]>();
  for (const x of list) {
    if (!x.approved || (x.scope === "person" && x.owner !== who)) continue;
    const place = x.current ? x.path : x.path.replace(/\/versions\/[^/]+$/, "");
    byPlace.set(place, [...(byPlace.get(place) ?? []), x]);
  }
  const out: LoadedReading[] = [];
  for (const xs of byPlace.values()) {
    const pick = xs.find((x) => x.current) ?? [...xs].sort((a, b) => (a.approvedAt! < b.approvedAt! ? 1 : -1))[0]!;
    out.push({ skill: pick.skill, version: pick.version, path: pick.path, approved: true, approvedIn: pick.approvedIn, draft: false, owner: pick.scope === "facility" ? pick.owner : null });
  }
  return out;
}

/** 版の記録に載った読み方を、保存先の中身と照らしたもの（古い版のルールのシート）。中身が保存先に見つからなければ scope と skill は null */
export interface RecordedReading {
  name: string;
  path: string;
  version: string;
  scope: ReadingScope | null;
  skill: ReadingSkill | null;
}

/** 版の記録の読み方（名前・道・版）を、保存先の置き場所の今の版か versions/ に残した版と照らす（読むだけ。docs/screens.md 3.2 の古い版を開いたとき） */
export async function recordedReadings(root: string, recorded: readonly { name: string; path: string; version: string }[]): Promise<RecordedReading[]> {
  const list = await listReadings(root, new Map());
  return recorded.map((r) => {
    const hit = list.find((x) => x.version === r.version && (x.path === r.path || x.path === `${r.path}/versions/${r.version}`));
    return { name: r.name, path: r.path, version: r.version, scope: hit?.scope ?? null, skill: hit?.skill ?? null };
  });
}

/** 読み方の置き場所（保存先の今の版のあるところ）。範囲と持ち主は置き場所で決まる */
export interface ReadingPlace {
  path: string;
  name: string;
  scope: ReadingScope;
  owner: string | null;
}

/**
 * ルールの適用先の 1 行：版の記録に読み方の版を載せた版。
 * MOYAI が読める版だけ（保存先の版の記録で、確かめで合うもの）。共有フォルダの共有ファイルは版の記録を持たないので、今は保存先だけ
 */
export interface AppliedVersion {
  planId: string;
  /** 施設の名前（いちばん新しい版の計画のもの） */
  displayName: string;
  fictional: boolean;
  fiscalYearStartMonth: number;
  version: number;
  /** 版の記録の時刻（並べる順） */
  at: string;
  contentHash: string;
  /** 版を確定した署名の時刻（承認があれば承認、無ければ自分で確定）。渡しただけ・戻すは null（版を年度で呼ぶのに使う） */
  signedAt: string | null;
  /** いちばん新しい版で、編集の番が人に渡っている（編集中・承認待ち・差戻し）。ほかは null */
  held: "editing" | "awaitingApproval" | "returned" | null;
  /** 置いた所 */
  from: "store";
  /** この PC で開ける版か（保存先の確かめで合う版は開ける） */
  openable: boolean;
  skills: { name: string; path: string; version: string }[];
}

/**
 * ルールの来歴（ルールの詳細の適用先。docs/screens.md 3.2、Wire、11-07）：保存先の読み方の置き場所と、読み方を版の記録に載せた版の一覧。
 * 読めない計画（版のファイルが読めない）と、確かめで合わない版は数えない（「ほか n」とも言わない）。読むだけで、何も書かない
 */
export async function readingLineage(root: string): Promise<{ places: ReadingPlace[]; applied: AppliedVersion[] }> {
  const places: ReadingPlace[] = (await listReadings(root, new Map())).filter((x) => x.current).map((x) => ({ path: x.path, name: x.name, scope: x.scope, owner: x.owner }));
  const applied: AppliedVersion[] = [];
  for (const planId of subdirs(join(root, "plans"))) {
    if (!PLAN_ID.test(planId)) continue;
    let hist: PlanHistory;
    try {
      hist = await readHistory(root, planId);
    } catch {
      continue; // 読めない施設は数えない
    }
    const latest = hist.latest;
    if (!latest) continue;
    const top = hist.versions.at(-1)!;
    const turn = await readTurn(root, planId);
    for (const v of hist.versions) {
      if (v.problem !== null || v.legacy || !v.readingSkills) continue;
      const held = turn && v === top && turn.version === v.version && (turn.state === "editing" || turn.state === "awaitingApproval" || turn.state === "returned") ? turn.state : null;
      applied.push({
        planId,
        displayName: latest.plan.displayName,
        fictional: latest.plan.facility.fictional,
        fiscalYearStartMonth: latest.plan.facility.fiscalYearStartMonth,
        version: v.version,
        at: v.at,
        contentHash: v.contentHash,
        signedAt: (v.signatures.find((x) => x.role === "approve") ?? v.signatures.find((x) => x.role === "confirm"))?.at ?? null,
        held,
        from: "store",
        openable: true,
        skills: v.readingSkills,
      });
    }
  }
  return { places, applied };
}

/**
 * 計画ルールの承認の照らし（Architect の 42 の 2）：版の記録に載せる読み方の計画ルールは、どれも
 * 承認済みの読み方に同じ中身で入っている（すでに承認済み）か、この署名で人が受けた周期の案（明細の鍵が cy-、出どころが計画ルールのその名前と id）が
 * もとにしたものであること。案を受けていないルールを、版の署名で承認しない（会社の範囲はほかの施設にもそのまま効くため）。
 * 承認は読み方の中身のハッシュ（版）に結ぶので、ここは「載せてよいか」だけを照らす。plan は形を確かめる前の版の計画（明細だけを見る）
 */
export function planRulesBacked(skill: ReadingSkill, plan: unknown, acceptedIds: ReadonlySet<string>, approved: readonly ListedReading[]): boolean {
  const rules = skill.rules.filter(isPlanRule);
  if (rules.length === 0) return true;
  const details = Array.isArray((plan as { details?: unknown } | null)?.details) ? ((plan as { details: unknown[] }).details as { detailKey?: unknown; sources?: unknown }[]) : [];
  const backed = new Set<string>();
  for (const d of details) {
    if (typeof d.detailKey !== "string" || !CYCLE_KEY.test(d.detailKey) || !acceptedIds.has(`detail:${d.detailKey}`) || !Array.isArray(d.sources)) continue;
    for (const s of d.sources as { file?: unknown; sheet?: unknown; cell?: unknown }[]) {
      if (s.file === PLAN_RULE_SOURCE && typeof s.sheet === "string" && typeof s.cell === "string") backed.add(`${s.sheet}\u0000${s.cell}`);
    }
  }
  // 欄の順に依らずに比べる（保管先から読んだルールは型の順、タブから来たルールは送った順）
  const canon = (v: unknown): unknown => (Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v);
  const same = (a: unknown, b: unknown) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
  const already = (r: (typeof rules)[number]) => approved.some((x) => x.approved && x.name === skill.name && x.scope === skill.scope && x.skill.rules.some((y) => same(y, r)));
  return rules.every((r) => backed.has(`${skill.name}\u0000${r.id}`) || already(r));
}
