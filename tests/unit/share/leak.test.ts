// share.leak：原本の全セルに客先名・人名・金額・日付・和暦を混ぜても、束の数（形・固有名詞・金額・自由記述・正確な日付）がすべて 0。
// 数える関数が本当に当たることも、同じ束に混ぜて確かめる（0 が見逃しでないことの確かめ）。
import { describe, expect, it } from "vitest";
import type { Plan } from "../../../src/shared/plan";
import { envelopeText, publicWords } from "../../../src/share/bundle";
import { canonicalize } from "../../../src/share/jcs";
import { countProperNouns, hasExactDate, hasMoney, isClean, recount } from "../../../src/share/recount";
import { previewBundle, sealBundle } from "../../../src/share/seal";
import { generateKeyPair, signBody } from "../../../src/share/sign";
import { asset, detail, makeMember, makeRing, plan, sendInput, work } from "./fixtures";

const FACILITY = "架空市みどり清掃センター";
const CLIENT = "架空環境サービス株式会社";
const PERSON = "架空 花子";
const MONEY = "¥1,234,000";
const DATE = "2016-07-12";
const WAREKI = "平成28年7月12日";
const WAREKI_SHORT = "H28.7.12";
const MIX = `${CLIENT} ${PERSON} ${MONEY} ${DATE} ${WAREKI} ${WAREKI_SHORT}`;

function dirtyPlan(): Plan {
  const src = [{ file: `${FACILITY}_${DATE}.xlsx`, sheet: `${CLIENT}`, page: null, cell: "B7", box: null }];
  return plan({
    name: FACILITY,
    assets: [
      asset("a1", "T.FEED.LIFT", {
        name: `昇降機 ${MIX}`,
        tag: `TAG-${PERSON}`,
        series: `1号 ${CLIENT}`,
        commonItemBasis: MIX,
        specs: [{ key: "納入", value: MIX }],
        installedOn: "1999-04-01",
        sources: src,
      }),
      asset("a2", "T.POWER.GEN", { name: `発電 ${MIX}`, series: `2号 ${PERSON}`, sources: src }),
    ],
    works: [
      work("w1", "OVERHAUL", ["a1"], { kind: `整備 ${MIX}`, contractor: CLIENT, tagList: [] }),
      work("w2", "INSPECT", ["a2"], { kind: `点検 ${MIX}`, contractor: CLIENT }),
    ],
    details: [
      detail("d1", "w1", 2016, {
        startDate: DATE,
        endDate: "2016-07-20",
        cost: 1234000,
        manDays: 15,
        days: 8,
        performer: PERSON,
        resultValue: MIX,
        measuredValue: MONEY,
        previousValue: WAREKI,
        basis: MIX,
        sources: src,
      }),
      detail("d2", "w1", 2020, { startDate: "2020-08-01", cost: 2000000, manDays: 18, days: 9, performer: PERSON, basis: MIX, sources: src }),
      detail("d3", "w2", 2018, { startDate: "2018-05-15", cost: 300000, manDays: 2, days: 1, performer: PERSON, basis: MIX, sources: src }),
    ],
  });
}

/** 原本の全セルの文字列（網 3） */
function allStrings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) allStrings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) allStrings(x, out);
  return out;
}

describe("share.leak", () => {
  const ring = makeRing();
  const m = makeMember(ring);
  const p = dirtyPlan();
  const input = sendInput(ring, m, p);
  const pv = previewBundle(input);
  const sealArgs = {
    previewHash: pv.ok ? pv.bodyHash : "",
    pair: m.pair,
    acceptedRulesHash: ring.ctx.rulesHash,
    acceptedRules: ring.rules,
    localWords: [FACILITY, CLIENT, PERSON],
    cells: allStrings(p),
    folderPath: `/tmp/輪/${ring.ringId}`,
  };
  const sealed = sealBundle(input, sealArgs);

  it("署名まで通り、束の数がすべて 0", () => {
    expect(pv.ok).toBe(true);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;
    const r = sealed.recount;
    expect([r.shape, r.freeText, r.money, r.exactDate, r.kShort, r.chain]).toEqual([0, 0, 0, 0, 0, 0]);
    const pn = countProperNouns({
      bundleText: sealed.text,
      fileName: sealed.fileName,
      folderPath: sealArgs.folderPath,
      localWords: sealArgs.localWords,
      cells: sealArgs.cells,
      publicWords: publicWords(ring.ctx),
    });
    expect(pn.total).toBe(0);
  });

  it("束のバイト列（NFKC）に、混ぜた語・数・日付の文字が 1 つも無い", () => {
    if (!sealed.ok) throw new Error("封ができない");
    const t = sealed.text.normalize("NFKC");
    for (const s of [FACILITY, CLIENT, PERSON, "1,234,000", "1234000", DATE, "2016-07", "平成", "H28", "1号", "TAG"]) {
      expect(t.includes(s.normalize("NFKC")), s).toBe(false);
    }
    expect(/[^\x20-\x7e]/.test(t)).toBe(false);
    // 受ける側も同じ関数で 0
    expect(isClean(recount(sealed.text, ring.ctx))).toBe(true);
  });

  it("数える関数は、混ぜれば当たる（0 が見逃しでない）", () => {
    if (!pv.ok) throw new Error("プレビューができない");
    const body = JSON.parse(canonicalize(pv.body));
    const cases: [string, (b: Record<string, unknown>) => void, "freeText" | "money" | "exactDate"][] = [
      ["施設名", (b) => ((b.chunks as Record<string, unknown>[])[0]!.class = FACILITY), "freeText"],
      ["金額", (b) => (b.month = MONEY), "money"],
      ["日付", (b) => (b.month = DATE), "exactDate"],
      ["和暦", (b) => (b.month = WAREKI), "exactDate"],
      ["和暦の略", (b) => (b.month = WAREKI_SHORT), "exactDate"],
      ["英字の客先", (b) => ((b.profile as Record<string, unknown>).group = "ACME"), "freeText"],
    ];
    for (const [name, mutate, field] of cases) {
      const b = structuredClone(body);
      mutate(b);
      const r = recount(envelopeText(b, signBody(b, m.pair.privateKey)), ring.ctx);
      expect(r[field], name).toBeGreaterThan(0);
      expect(isClean(r), name).toBe(false);
    }
    expect(hasMoney("3,000円")).toBe(true);
    expect(hasMoney("１２０万円")).toBe(true);
    expect(hasExactDate("令和元年")).toBe(true);
    expect(hasExactDate("R6.4.1")).toBe(true);
    expect(hasExactDate("7月12日")).toBe(true);
    expect(hasExactDate("20160712")).toBe(true);
    // 年度と送った月は数えない
    expect(hasExactDate("FY2016")).toBe(false);
    expect(hasExactDate("2026-11")).toBe(false);
  });

  it("固有名詞（送る側だけ）：フォルダのパスやセルの語が束・ファイル名・パスに出たら止める", () => {
    const bad = sealBundle(input, { ...sealArgs, folderPath: `/Users/x/OneDrive/${FACILITY}/輪` });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toBe("properNoun");
    expect(!bad.ok && bad.properNoun?.net2).toBe(1);
    expect(!bad.ok && bad.properNoun?.net3).toBeGreaterThan(0);
    // 英数 3 文字以上の語も照らす（大文字と小文字は区別しない）
    const pn = countProperNouns({
      bundleText: '{"x":"acmeplant"}',
      fileName: "000001-0000000000000000.json",
      folderPath: "/tmp",
      localWords: [],
      cells: ["ACMEPLANT 第 2 系"],
      publicWords: publicWords(ring.ctx),
    });
    expect(pn.net3).toBe(1);
    // 公開語彙の部分・数だけ・16 進の並びは照らさない
    const quiet = countProperNouns({
      bundleText: sealed.ok ? sealed.text : "",
      fileName: sealed.ok ? sealed.fileName : "",
      folderPath: "/tmp/ring",
      localWords: [],
      cells: ["OVERHAUL", "2016", "FY2016", "LIFT", sealed.ok ? sealed.hash : ""],
      publicWords: publicWords(ring.ctx),
    });
    expect(quiet.total).toBe(0);
  });

  it("送る人の鍵と違う鍵では署名しない。プレビューと中身が違えば送らない", () => {
    const wrong = sealBundle(input, { ...sealArgs, pair: generateKeyPair() });
    expect(!wrong.ok && wrong.reason).toBe("keyMismatch");
    const changed = sealBundle(input, { ...sealArgs, previewHash: "0".repeat(64) });
    expect(!changed.ok && changed.reason).toBe("previewChanged");
  });
});
