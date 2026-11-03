// 取り込み → 写し取りの層をまたぐ試験（docs/plan.md §4「層をまたぐ試験を置く」）。§5.1 の cross-layer（きっかけの次回）とは別のもの。
// 工場の資料を取り込んで作った計画を、そのまま写し取りに渡す。
// 取り込みの書き方（年だけの設置年、まとめ工事の子の作業）を、写し取りが黙って落とさないことを確かめる。
// 経過年は 2026-11-03 にどこにも出さないと決めた：設置年は塊に写らず、欄ごと写さなかった数（installed）に数える。
// 当てはめ（1 段目の項目と作業の属性）は、人の代わりに試験の台本が正解の世界から置く（src/ は正解を読まない）。
// 作者を「人」にするのは、試験の台本が人の操作の代わりに押すため（tests/unit/import/ の台本と同じ。根拠の文に台本と書く）。
// 分類を上げる表（lift）は、この試験では項目をそのまま使う（数えられるかは share.k の試験が見る）。
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { IntakeSession } from "../../../src/import";
import { REMOVED_CHUNK_FIELDS, candidateClasses, copyOut } from "../../../src/share/copyout";
import { canonicalize } from "../../../src/share/jcs";
import { chooseProfile, isCountable, loadNational, loadVocab, type ProfileSpec } from "../../../src/share/k";
import type { Plan } from "../../../src/shared/plan";
import { Entities, loadTruth, runScript } from "../import/truth";

const PACK = "waste-incineration";
const FACILITY = "fictional-1";
const FILES = ["equipment-ledger.xlsx", "plan-hoshitori.xlsx", "daily-report.csv"];

async function importedPlan(): Promise<Plan> {
  const t = loadTruth(PACK, FACILITY);
  const s = new IntakeSession({
    planId: `plan-${FACILITY}`,
    displayName: t.world.facility.name,
    packId: PACK,
    facility: {
      facilityKey: FACILITY,
      name: t.world.facility.name,
      fiscalYearStartMonth: 4,
      scale: null,
      scaleUnit: null,
      legalFlags: [],
      fictional: true,
      inNationalTable: null,
    },
  });
  const dir = `samples/out/${PACK}/${FACILITY}/`;
  await s.add(FILES.map((n) => ({ name: n, bytes: new Uint8Array(readFileSync(dir + n)) })));
  runScript(s, t);
  const plan = s.compose().plan;
  if (!plan) throw new Error("計画ができない");
  // 試験の台本が当てはめを置き、人の代わりに受ける
  const ents = new Entities(t);
  const codeOf: Record<string, string> = t.world.equipment_to_code;
  const assets = plan.assets.map((a) => {
    const hit = a.sources.map((x) => (x.cell ? ents.of(x.file, x.cell) : null)).find((k) => k?.startsWith("e:"));
    const code = hit ? (codeOf[hit.slice(2)] ?? null) : null;
    return code
      ? { ...a, commonItem: code, commonItemAuthor: "human" as const, commonItemBasis: "試験の台本が押した（正解の世界から）", commonItemAccepted: true }
      : a;
  });
  const attrOf = new Map<string, string>((t.world.works as { label: string; attr: string }[]).map((w) => [w.label, w.attr]));
  const works = plan.works.map((w) => {
    const attribute = (attrOf.get(w.kind) ?? null) as Plan["works"][number]["attribute"];
    return attribute
      ? { ...w, attribute, attributeAuthor: "human" as const, attributeBasis: "試験の台本が押した（正解の世界から）", attributeAccepted: true }
      : w;
  });
  return { ...plan, assets, works };
}

describe("層をまたぐ：取り込み → 写し取り", () => {
  test("取り込んだ計画の設置年（年だけ）とまとめ工事の子が、写し取りで別の理由に落ちない", async () => {
    const plan = await importedPlan();
    const lift = new Map(plan.assets.filter((a) => a.commonItem).map((a) => [a.commonItem!, a.commonItem!]));
    const r = copyOut({ plan, lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r.chunks.length).toBeGreaterThan(0);
    // まとめ工事の子は「まとめ工事」に数え、「人・日に直せない」に数えない
    const children = plan.works.filter((w) => w.parentWorkKey !== null);
    expect(children.length).toBeGreaterThan(0);
    expect(r.omitted.manDaysBundled).toBeGreaterThan(0);
    const childDetails = plan.details.filter((d) => children.some((w) => w.workKey === d.workKey) && d.planOrActual === "actual");
    expect(childDetails.length).toBeGreaterThan(0);
    // 子の入れ子を外した計画と比べ、子の空の工数の分だけ「直せない」が「まとめ工事」に移っている
    const flat = { ...plan, works: plan.works.map((w) => ({ ...w, parentWorkKey: null })) };
    const parents = new Set(children.map((w) => w.parentWorkKey));
    const flatR = copyOut({ plan: { ...flat, works: flat.works.filter((w) => !parents.has(w.workKey)) }, lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(flatR.omitted.manDaysUnconvertible).toBeGreaterThan(r.omitted.manDaysUnconvertible);
    // 取り込みの設置年は年だけ（"2002"）。輪にも台帳にも経過年は出ず、設置年は欄ごと写さなかった数に数える（黙って捨てない）
    const yearOnly = plan.assets.filter((a) => a.commonItemAccepted && a.installedOn !== null && /^\d{4}$/.test(a.installedOn));
    expect(yearOnly.length).toBeGreaterThan(0);
    const ledger = copyOut({ plan, lift, to: { kind: "ledger", id: "0123456789abcdef" } });
    for (const out of [r, ledger]) {
      for (const c of out.chunks) for (const f of REMOVED_CHUNK_FIELDS) expect(Object.hasOwn(c, f)).toBe(false);
      expect(canonicalize(out.chunks)).not.toContain("ageAtWork");
      expect(out.withheld.installed).toBe(plan.assets.filter((a) => a.installedOn !== null).length);
    }
  });

  test("パックの公開語彙と見え方で、取り込んだ計画の段が決まり、塊が出る", async () => {
    const dir = `packs/${PACK}/`;
    const vocab = loadVocab(readFileSync(dir + "vocab.json", "utf8"));
    const table = loadNational(readFileSync(dir + "national/table.json", "utf8"));
    const spec = (JSON.parse(readFileSync(dir + "pack.json", "utf8")) as { profile: ProfileSpec }).profile;
    // 共通の設備項目のどのコードも公開語彙にある
    const common = JSON.parse(readFileSync(dir + "common.json", "utf8")) as unknown;
    const codes = JSON.stringify(common).match(/"code":"WI\.[A-Z0-9_.]+"/g)?.map((x) => x.slice(8, -1)) ?? [];
    expect(codes.length).toBe(44);
    for (const c of codes) expect(vocab.byCode.has(c)).toBe(true);
    for (const c of vocab.byCode.values()) if (c.universal) expect(c.source).not.toBeNull();
    const plan = await importedPlan();
    // 施設の見え方の値：炉の型は正解の世界（ストーカ式）、ほかは試験の台本が置く（架空）
    const facility = { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "OUT", contract: "SINGLE" };
    const c = chooseProfile({ table, vocab, spec, facility, group: "NATIONAL", classes: candidateClasses(plan) });
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const r = copyOut({ plan, lift: c.lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r.chunks.length).toBeGreaterThan(0);
    // 出る分類はどれも、全国の表で数えられるもの（出典つきの universal か、推せる軸がすべて表にある）
    for (const ch of r.chunks) expect(isCountable(vocab, table, ch.class), ch.class).toBe(true);
    // 数えられない項目（例：計量機・余熱利用設備の群）は塊に出ない。上の群へ上がるか、上がり先が無ければ理由に数える
    expect(r.chunks.some((ch) => ch.class === "WI.RECV.SCALE")).toBe(false);
    expect(r.chunks.some((ch) => ch.class === "WI.HEAT")).toBe(false);
    expect(r.chunks.some((ch) => ch.class === "WI.RECV")).toBe(true);
    // implies を持つ分類は、出典と読み方を持つ
    for (const cl of vocab.byCode.values()) if (Object.keys(cl.implies).length) expect(cl.source, cl.code).not.toBeNull();
  });
});

