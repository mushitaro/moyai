// cross-layer（docs/plan.md §4「層をまたぐ試験を置く」）：工場の資料を取り込んで作った計画を、そのまま写し取りに渡す。
// 取り込みの書き方（年だけの設置年、まとめ工事の子の作業）を、写し取りが黙って落とさないことを確かめる。
// 当てはめ（1 段目の項目と作業の属性）は、人の代わりに試験の台本が正解の世界から置く（src/ は正解を読まない）。
// 分類を上げる表（lift）は、この試験では項目をそのまま使う（数えられるかは share.k の試験が見る）。
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { IntakeSession } from "../../../src/import";
import { candidateClasses, copyOut } from "../../../src/share/copyout";
import { chooseProfile, loadNational, loadVocab, type ProfileSpec } from "../../../src/share/k";
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
  const works = plan.works.map((w) => ({ ...w, attribute: (attrOf.get(w.kind) ?? null) as Plan["works"][number]["attribute"] }));
  return { ...plan, assets, works };
}

describe("cross-layer：取り込み → 写し取り", () => {
  test("取り込んだ計画の設置年（年だけ）とまとめ工事の子が、写し取りで別の理由に落ちない", async () => {
    const plan = await importedPlan();
    const lift = new Map(plan.assets.filter((a) => a.commonItem).map((a) => [a.commonItem!, a.commonItem!]));
    const r = copyOut({ plan, lift, to: { kind: "ring", id: "0123456789abcdef" } });
    expect(r.chunks.length).toBeGreaterThan(0);
    // 年だけの設置年でも、帯が割れない塊では ageAtWork が出る。設置が分からないとは数えない
    expect(r.omitted.ageInstalledUnknown).toBe(0);
    expect(r.chunks.some((c) => c.ageAtWork !== undefined)).toBe(true);
    // まとめ工事の子は「まとめ工事」に数え、「人・日に直せない」に数えない
    const children = plan.works.filter((w) => w.parentWorkKey !== null);
    expect(children.length).toBeGreaterThan(0);
    expect(r.omitted.manDaysBundled).toBeGreaterThan(0);
    const childDetails = plan.details.filter((d) => children.some((w) => w.workKey === d.workKey) && d.planOrActual === "actual");
    expect(childDetails.length).toBeGreaterThan(0);
    // 子の明細の工数は親にあるので、子は直せないに入らない（直せないは、子でない明細の空の工数だけ）
    const nonChildNull = plan.details.filter(
      (d) => d.planOrActual === "actual" && d.manDays === null && !children.some((w) => w.workKey === d.workKey) && !plan.works.some((w) => w.parentWorkKey === d.workKey),
    ).length;
    expect(r.omitted.manDaysUnconvertible).toBeLessThanOrEqual(nonChildNull);
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
    // 数えられない項目は群へ上がり、出る分類はどれも語彙で数えられるもの
    for (const ch of r.chunks) expect(vocab.byCode.has(ch.class)).toBe(true);
  });
});

