// 共有の芯の試験の材料。計画の書類・公開語彙・輪はすべて架空で、試験の中で小さく作る。
// 全国の表だけは、パックの national/table.json（施設名を持たない数の表）をそのまま使う。
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetNodeT, Plan, WorkDetailT, WorkT } from "../../../src/shared/plan";
import { CIRCLE_V, envelopeText, makeMemberBody, makeRulesDocBody, ringIdOf, type ShareContext } from "../../../src/share/bundle";
import { loadNational, loadVocab, type ProfileSpec, type ShareVocab } from "../../../src/share/k";
import { baseRules, type Rules } from "../../../src/share/rules";
import { generateKeyPair, keyIdOf, sha256Hex, signBody, wrapPrivateKey, type KeyPair, type WrappedKey } from "../../../src/share/sign";
import type { SendInput } from "../../../src/share/seal";

export const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
export const TABLE_TEXT = readFileSync(join(ROOT, "packs", "waste-incineration", "national", "table.json"), "utf8");
export const table = loadNational(TABLE_TEXT);

/** 架空の公開語彙（試験のための分類。軸の名前とコードは全国の表のもの） */
export const VOCAB: ShareVocab = {
  pack: "waste-incineration",
  classes: [
    { code: "T.FEED", parent: null, universal: true, source: "TEST-SOURCE-1", implies: {} },
    { code: "T.FEED.LIFT", parent: "T.FEED", universal: true, source: "TEST-SOURCE-1", implies: {} },
    { code: "T.FEED.ODD", parent: "T.FEED", universal: false, source: null, implies: {} },
    { code: "T.POWER", parent: null, universal: false, source: null, implies: { turbine: "YES" } },
    { code: "T.POWER.GEN", parent: "T.POWER", universal: false, source: null, implies: { turbine: "YES" } },
    { code: "T.RESIDUE", parent: null, universal: true, source: "TEST-SOURCE-2", implies: {} },
    { code: "T.RESIDUE.MELT", parent: "T.RESIDUE", universal: false, source: null, implies: { ash: "MELT" } },
    { code: "T.GAS.FILTER", parent: null, universal: false, source: null, implies: { dust: "BAG" } },
    { code: "T.LONE", parent: null, universal: false, source: null, implies: {} },
    { code: "T.UNIV.NOSRC", parent: null, universal: true, source: null, implies: {} },
  ],
};
export const VOCAB_TEXT = JSON.stringify(VOCAB);
export const vocab = loadVocab(VOCAB_TEXT);

/** 架空のパックの見え方（軸の名前は全国の表の列。dust は全国の表に無い軸） */
export const SPEC: ProfileSpec = {
  axes: [
    { key: "furnace", tier: "primary" },
    { key: "capacity_t_per_day", tier: "primary" },
    { key: "turbine", tier: "secondary" },
    { key: "dust", tier: "secondary" },
    { key: "ash", tier: "secondary" },
    { key: "contract", tier: "refine" },
  ],
};

export const FACILITY_COMMON = { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" };

// ─── 計画の書類 ─────────────────────────────────────────────

const src = [{ file: "架空の保全記録.xlsx", sheet: "履歴", page: null, cell: "A1", box: null }];

export function asset(nodeKey: string, commonItem: string | null, o: Partial<AssetNodeT> = {}): AssetNodeT {
  return {
    nodeKey,
    tag: null,
    name: `架空の機器 ${nodeKey}`,
    level: 2,
    parentKey: null,
    classCode: null,
    commonItem,
    commonItemAuthor: "human",
    commonItemBasis: "人が画面で受けた",
    commonItemAccepted: true,
    specs: [],
    installedOn: "2001-04-01",
    removedOn: null,
    replacedOn: null,
    series: null,
    sources: src,
    ...o,
  };
}

export function work(workKey: string, attribute: WorkT["attribute"], targets: string[], o: Partial<WorkT> = {}): WorkT {
  return {
    workKey,
    kind: "架空の作業",
    attribute,
    // 属性があれば、人が画面で受けたもの（資産の節の既定と同じ）
    attributeAuthor: attribute === null ? null : "human",
    attributeBasis: attribute === null ? null : "人が画面で受けた",
    attributeAccepted: attribute !== null,
    strategy: "time_based",
    targets,
    trigger: null,
    checkIds: [],
    contractor: null,
    parentWorkKey: null,
    tagRange: null,
    tagList: [],
    ...o,
  };
}

export function detail(detailKey: string, workKey: string, fiscalYear: number, o: Partial<WorkDetailT> = {}): WorkDetailT {
  return {
    detailKey,
    workKey,
    planOrActual: "actual",
    step: null,
    startDate: null,
    endDate: null,
    fiscalYear,
    cost: null,
    manDays: null,
    days: null,
    resultScale: null,
    resultValue: null,
    measuredValue: null,
    previousValue: null,
    performer: null,
    sources: src,
    basis: "架空の記録",
    author: "human",
    needsReview: false,
    ...o,
  };
}

export function plan(parts: { assets: AssetNodeT[]; works: WorkT[]; details: WorkDetailT[]; name?: string }): Plan {
  return {
    schema: "moyai.plan/0",
    planId: "plan-test",
    displayName: "【架空】試験の計画",
    packId: "waste-incineration",
    version: 1,
    levelNames: ["設備", "機器"],
    facility: {
      facilityKey: "fac-test",
      name: parts.name ?? "【架空】試験の施設",
      fiscalYearStartMonth: 4,
      scale: 150,
      scaleUnit: "t/日",
      legalFlags: [],
      fictional: true,
      inNationalTable: true,
    },
    assets: parts.assets,
    works: parts.works,
    details: parts.details,
  };
}

/** 小さな計画：分類 2 つ、作業 3 つ */
export function smallPlan(): Plan {
  return plan({
    assets: [asset("a1", "T.FEED.LIFT"), asset("a2", "T.POWER.GEN", { installedOn: "2003-06-01" })],
    works: [work("w1", "OVERHAUL", ["a1"]), work("w2", "INSPECT", ["a2"])],
    details: [
      detail("d1", "w1", 2016, { manDays: 12, days: 5 }),
      detail("d2", "w1", 2019, { manDays: 14, days: 6 }),
      detail("d3", "w2", 2018, { manDays: 2, days: 1 }),
    ],
  });
}

// ─── 輪 ────────────────────────────────────────────────────

export interface Ring {
  founder: KeyPair;
  nonce: string;
  ringId: string;
  rules: Rules;
  circleText: string;
  ctx: ShareContext;
}

export function makeRing(rulesPatch: Partial<Rules> = {}, nonce = randomBytes(16).toString("hex")): Ring {
  const founder = generateKeyPair();
  return makeRingWith(founder, nonce, rulesPatch, 1);
}

export function makeRingWith(founder: KeyPair, nonce: string, rulesPatch: Partial<Rules>, version: number): Ring {
  const rules = { ...baseRules(vocab.pack, vocab.hash, table.hash), ...rulesPatch };
  const body = makeRulesDocBody(CIRCLE_V, founder.pub, nonce, version, "2026-11", rules);
  const circleText = envelopeText(body, signBody(body, founder.privateKey));
  const ringId = ringIdOf(body);
  return {
    founder,
    nonce,
    ringId,
    rules,
    circleText,
    ctx: { table, vocab, rules, rulesHash: sha256Hex(circleText), to: { kind: "ring", id: ringId } },
  };
}

export interface Member {
  pair: KeyPair;
  key: string;
  wrapped: WrappedKey;
  passphrase: string;
  memberText: string;
}

const wrappedCache = new Map<string, WrappedKey>();

export function makeMember(ring: Ring, passphrase = "架空の合言葉 試験"): Member {
  const pair = generateKeyPair();
  const key = keyIdOf(pair.pub);
  const body = makeMemberBody(ring.ringId, key, pair.pub, "2026-11");
  const memberText = envelopeText(body, signBody(body, pair.privateKey));
  let wrapped = wrappedCache.get(pair.pub);
  if (!wrapped) {
    wrapped = wrapPrivateKey(pair, passphrase);
    wrappedCache.set(pair.pub, wrapped);
  }
  return { pair, key, wrapped, passphrase, memberText };
}

export function sendInput(ring: Ring, m: Member, p: Plan, o: Partial<SendInput> = {}): SendInput {
  return {
    ctx: ring.ctx,
    plan: p,
    spec: SPEC,
    facility: FACILITY_COMMON,
    group: "NATIONAL",
    pub: m.pair.pub,
    seq: 1,
    prev: null,
    month: "2026-11",
    ...o,
  };
}
