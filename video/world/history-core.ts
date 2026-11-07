// 動画の世界（ほたる川クリーンセンター）の版の履歴を、空の保管先に作る芯（video/world/make-history.mjs が呼ぶ。画面の経路は使わない）。
// MOYAI の今の関数（commitPlan・createRequest・receiveRequest・signLatest・writeTurn・registerReading）を直接呼ぶ。
// 計画は、作り手の正解の世界（video/world/hotarugawa/world.truth.json）から、台帳のデモと同じ道具（planFromWorld）で書く。
//
//   ほたる川クリーンセンター：令和 6 年度版（第 1 版）・令和 7 年度版（第 2 版）…署名して承認済み。令和 8 年度版（第 3 版）…承認待ち。
//   しらかば野クリーンセンター：第 2 版（令和 7 年度版）から作った派生の第 1 版。3 段目の Skill（会社の読み方）を使う。
//
// 署名の鍵は、この台本が作った架空の鍵だけ（走らせるたびに作る。秘密鍵はメモリだけ。書かない）。
// 人の呼び名：佐藤（整備の担当。版を作って承認を頼む）・山田（市の環境課。承認する）。版を承認するのは作った人以外（plan/store.ts の決まり）。
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planFromWorld } from "../../scripts/ledger/truth-plan.mjs";
import { catalogFromPack } from "../../src/plan/chart";
import { createRequest, receiveRequest } from "../../src/plan/request";
import { commitPlan, readHistory, signLatest, type ExportCatalogs, type Signer } from "../../src/plan/store";
import { TURN_SCHEMA, handoffMail, writeTurn } from "../../src/plan/turn";
import { registerReading } from "../../src/bridge/readings";
import { READING_SCHEMA, type ReadingSkill } from "../../src/import/reading";
import { generateKeyPair } from "../../src/share/sign";
import { Plan } from "../../src/shared/plan";

export const HOTARU_ID = "plan-hotarugawa";
export const SHIRAKABA_ID = "plan-shirakabano";
export const SATO = "【架空】佐藤";
export const YAMADA = "【架空】山田";
export const YAMADA_MAIL = "yamada@example.jp";
export const SHIRAKABA_NAME = "【架空】しらかば野クリーンセンター";
export const FACILITY_DIR = "video/world/hotarugawa";
const CLIENT = "video-world";
/** 受け取る人の MOYAI で版を開くリンクの頭（src/bridge/human.ts の HANDOFF_ORIGIN と同じ。メールの文を撮るときの見え方をそろえる） */
const ORIGIN = "http://127.0.0.1:43110";

/** 3 段目の Skill（会社の読み方）。ほたる川の第 2 版が使い、しらかば野へ配られる。決まりは作り手の世界の決まり（誘引の呼び名の替え・取替の予定の印）から */
export const SKILL: ReadingSkill = {
  schema: READING_SCHEMA,
  name: "【架空】ほたる保全の読み方",
  scope: "company",
  rules: [
    {
      id: "same-idf",
      text: "「誘引通風機」と「誘引送風機」は同じ機器として読む",
      kind: "sameAsset",
      names: ["誘引通風機", "誘引送風機"],
      author: "human",
      by: SATO,
      reason: "古い資料は「通風機」、今の台帳は「送風機」と書く（呼び名の替え）",
    },
    {
      id: "star-replace",
      text: "星取表の「★」は、取替の予定として読む",
      kind: "markMeaning",
      symbol: "★",
      planOrActual: "plan",
      meaning: "取替の予定",
      author: "human",
      by: SATO,
      reason: "凡例に無い記号。担当者に聞いて決めた",
    },
  ],
};

export interface HistoryInput {
  /** リポジトリの根（video/ と packs/ がある所） */
  repo: string;
  /** 空の保管先（呼ぶ側が checkStore で確かめておく） */
  store: string;
  /** 撮る日（版の日時はここから数える。トップは直近 20 か月の列だけ描くため） */
  now: Date;
  /** 承認待ちの版へのメールを書き出す先（無ければ書かない） */
  mailOut?: string;
}

export interface HistoryResult {
  hotaru: { planId: string; versions: { version: number; fiscalYear: number; state: "approved" | "awaiting"; at: string }[] };
  shirakaba: { planId: string; derivedFrom: { planId: string; version: number }; versions: number[] };
  skill: { name: string; path: string; version: string };
  mail: { to: string; subject: string } | null;
}

/** 月を引く（日本時間でなく UTC。トップの列は日本時間の月なので、月の真ん中に寄せて日付のずれを避ける） */
function monthsBefore(now: Date, n: number, day = 15): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, day, 3, 0, 0));
  return d;
}
const plusDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

/** 書き出しに使うパックの名前の表（commitPlan は同期の関数で受けるので、先に読んでおく） */
const cache = new Map<string, ExportCatalogs>();
function catalogsFor(packId: string): ExportCatalogs {
  const c = cache.get(packId);
  if (!c) throw new Error(`パックの名前の表を先に読んでいない：${packId}`);
  return c;
}
async function loadCatalogs(repo: string, packId: string): Promise<void> {
  const read = async (p: string) => JSON.parse(await readFile(p, "utf8")) as unknown;
  const work = await read(join(repo, "packs", "_kinds", "work.json"));
  cache.set(packId, { catalog: catalogFromPack(await read(join(repo, "packs", packId, "common.json")), work), empty: catalogFromPack({ systems: [] }, work) });
}

/** 年度までの実績・予定だけを持つ計画（版ごとの中身）。明細の無くなった作業は外す */
function upTo(full: Plan, fy: number): Plan {
  const details = full.details.filter((d) => d.fiscalYear <= fy);
  const keep = new Set(details.map((d) => d.workKey));
  return { ...full, details, works: full.works.filter((w) => keep.has(w.workKey)) };
}

export async function makeHistory(i: HistoryInput): Promise<HistoryResult> {
  const world = JSON.parse(await readFile(join(i.repo, FACILITY_DIR, "world.truth.json"), "utf8")) as { facility: { pack: string; name: string } };
  await loadCatalogs(i.repo, world.facility.pack);
  const base = planFromWorld(world, {});
  // 画面の「この版から別の施設をつくる」と同じく、計画の ID は英数字とハイフンだけ。名前は世界のもの
  const full = Plan.parse({ ...base, planId: HOTARU_ID, displayName: world.facility.name, facility: { ...base.facility, facilityKey: HOTARU_ID, name: world.facility.name } });
  const sato: Signer = { by: SATO, pair: generateKeyPair() };
  const yamada: Signer = { by: YAMADA, pair: generateKeyPair() };
  const catalogs = catalogsFor;
  await mkdir(i.store, { recursive: true });

  // 3 段目の Skill を、会社の読み方として保管先に置く（署名した版が使うと、その版の署名で承認済みになる）
  const reg = await registerReading(i.store, SKILL, null, null);
  if (!reg.ok) throw new Error(`Skill を置けない：${reg.reason}`);
  const readingSkills = [{ name: SKILL.name, path: reg.path, version: reg.version }];

  const t1 = monthsBefore(i.now, 10);
  const t2 = monthsBefore(i.now, 5);
  const tb = monthsBefore(i.now, 3);
  const t3 = plusDays(i.now, -10);
  const out: HistoryResult["hotaru"]["versions"] = [];

  /** 佐藤が版を作って山田に承認を頼む（頼みに署名して置く）。承認する版は山田が受け取って署名する */
  const handOff = async (fy: number, at: Date, reason: string, basedOn: number | null, approve: boolean, skills: typeof readingSkills) => {
    const r = await commitPlan({ root: i.store, signer: sato, role: "edit", plan: upTo(full, fy), reason, acceptances: [], basedOn, client: CLIENT, now: at, catalogs, readingSkills: skills });
    if (!r.ok) throw new Error(`令和 ${fy - 2018} 年度版を確定できない：${r.reason}`);
    const hist = await readHistory(i.store, HOTARU_ID);
    const v = hist.versions.at(-1)!;
    const q = await createRequest({ root: i.store, planId: HOTARU_ID, version: r.version, contentHash: v.contentHash, kind: "approve", to: YAMADA_MAIL, by: SATO, pair: sato.pair, now: at });
    await writeTurn(i.store, { schema: TURN_SCHEMA, planId: HOTARU_ID, version: r.version, state: "awaitingApproval", holder: null, to: YAMADA_MAIL, from: SATO, note: reason, at: at.toISOString() });
    if (!approve) {
      const mail = handoffMail({
        name: r.record.plan.displayName,
        version: r.version,
        contentHash: v.contentHash,
        kind: "approve",
        to: YAMADA_MAIL,
        note: reason,
        by: SATO,
        planId: HOTARU_ID,
        link: `${ORIGIN}/#/merge?open=${encodeURIComponent(HOTARU_ID)}&v=${r.version}&h=${v.contentHash.slice(0, 16)}&t=${q.token}`,
      });
      out.push({ version: r.version, fiscalYear: fy, state: "awaiting", at: at.toISOString() });
      return mail;
    }
    const at2 = plusDays(at, 2);
    const got = await receiveRequest({ root: i.store, planId: HOTARU_ID, version: v, token: q.token, by: YAMADA, pair: yamada.pair, now: at2 });
    if (got.state !== "received") throw new Error(`頼みを受け取れない：${got.state}`);
    const s = await signLatest({ root: i.store, planId: HOTARU_ID, version: r.version, role: "approve", reason: "内容を確かめた。承認する", signer: yamada, now: at2 });
    if (!s.ok) throw new Error(`承認できない：${s.reason}`);
    await writeTurn(i.store, { schema: TURN_SCHEMA, planId: HOTARU_ID, version: r.version, state: "approved", holder: YAMADA, to: null, from: YAMADA, note: "内容を確かめた。承認する", at: at2.toISOString() });
    out.push({ version: r.version, fiscalYear: fy, state: "approved", at: at.toISOString() });
    return null;
  };

  await handOff(2024, t1, "令和 6 年度版。令和 6 年度の実績を入れた。承認をお願いします", null, true, []);
  await handOff(2025, t2, "令和 7 年度版。令和 7 年度の実績を足した。読み方（ほたる保全）を使った。承認をお願いします", 1, true, readingSkills);

  // しらかば野へ：第 2 版（承認済み）から派生した施設の第 1 版。同じ Skill を使う（画面の派生と同じ形：名前と計画の ID と施設の鍵だけを替える）
  const v2 = (await readHistory(i.store, HOTARU_ID)).versions.find((v) => v.version === 2)!;
  const src = upTo(full, 2025);
  const branchPlan: Plan = { ...src, planId: SHIRAKABA_ID, displayName: SHIRAKABA_NAME, version: 0, facility: { ...src.facility, facilityKey: SHIRAKABA_ID, name: SHIRAKABA_NAME, fictional: true } };
  const b = await commitPlan({
    root: i.store,
    signer: sato,
    role: "confirm",
    plan: branchPlan,
    reason: "ほたる川の令和 7 年度版から作った、しらかば野の第 1 版。読み方（ほたる保全）を配る",
    acceptances: [],
    basedOn: null,
    client: CLIENT,
    now: tb,
    catalogs,
    readingSkills,
    derivedFrom: { planId: HOTARU_ID, version: 2, contentHash: v2.contentHash },
  });
  if (!b.ok) throw new Error(`しらかば野の第 1 版を確定できない：${b.reason}`);
  await writeTurn(i.store, { schema: TURN_SCHEMA, planId: SHIRAKABA_ID, version: b.version, state: "approved", holder: SATO, to: null, from: SATO, note: "", at: tb.toISOString() });

  const mail = await handOff(2026, t3, "令和 8 年度版。令和 8 年度の予定を入れた。承認をお願いします", 2, false, []);
  if (mail && i.mailOut) await writeFile(i.mailOut, `宛先：${mail.to}\n件名：${mail.subject}\n\n${mail.body}\n`, { encoding: "utf8", flag: "wx" });

  return {
    hotaru: { planId: HOTARU_ID, versions: out },
    shirakaba: { planId: SHIRAKABA_ID, derivedFrom: { planId: HOTARU_ID, version: 2 }, versions: [b.version] },
    skill: { name: SKILL.name, path: reg.path, version: reg.version },
    mail: mail ? { to: mail.to, subject: mail.subject } : null,
  };
}
