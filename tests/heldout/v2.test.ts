// 工場 v2 の正解を写す道具（v2.ts）の、星取表の写し方の決まり（mushitaro/moyai#14）。資料は読まない（正解の JSON だけ）。
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadV2Facility } from "./v2";

const ROOT = "samples/waste-incineration";
const load = (n: string) => loadV2Facility(join(ROOT, n), n);
const world = (n: string) => JSON.parse(readFileSync(join(ROOT, n, "answer", "world.json"), "utf8"));
const starAnswer = (n: string) =>
  readdirSync(join(ROOT, n, "answer", "files"))
    .map((f) => JSON.parse(readFileSync(join(ROOT, n, "answer", "files", f), "utf8")))
    .find((a) => a.plan === true);

describe("工場 v2 の正解の写し：星取表", () => {
  it("星取表の無い施設（日報と発注台帳だけ）は、印も機器も置かない（出来事だけ）", () => {
    const { set } = load("hotarugawa");
    expect([set.truth.marks.length, set.truth.assets.length]).toEqual([0, 0]);
    expect(set.truth.events.length).toBeGreaterThan(0);
    expect(set.truth.files.some((f) => f.kind === "star")).toBe(false);
  });

  it("印：正解の印を 1 つも黙って捨てない（置いた印＋理由つきで外した印＝正解の印の数）。星取表の行は出来事にしない", () => {
    const stars = readdirSync(ROOT).filter((n) => { try { return !!starAnswer(n); } catch { return false; } });
    expect(stars.length).toBeGreaterThanOrEqual(9);
    for (const n of stars) {
      const { set, dropped } = load(n);
      const a = starAnswer(n);
      let written = 0;
      for (const r of a.records) for (const col of ["marks", "plans"]) for (const v of Object.values(r.fields?.[col] ?? {})) written += (Array.isArray(v) ? v : [v]).filter((x) => String(x) !== "").length;
      const out = Object.entries(dropped)
        .filter(([k]) => k.startsWith("星取表：") && !k.includes("何台もの機器") && !k.includes("年度の無い結び"))
        .reduce((s, [, v]) => s + v, 0);
      expect([n, set.truth.marks.length + out]).toEqual([n, written]);
      // 何台もの機器をまとめた行の印は、置くが数えない
      expect(set.truth.marks.filter((m) => m.measure === false).length).toBe(dropped["星取表：何台もの機器をまとめた行の印"] ?? 0);
      expect(set.truth.events.some((e) => e.file === a.file)).toBe(false);
      // 星取表の結びは、印にしたか、理由つきで外した（年度の無い結び）。出来事にしないぶんを黙って落とさない
      const yearless = (world(n).links as { file: string; year?: number }[]).filter((l) => l.file === a.file && typeof l.year !== "number").length;
      expect([n, dropped["星取表：年度の無い結び（備考の欄に書いた作業など。印ではない）"] ?? 0]).toEqual([n, yearless]);
      expect(set.truth.files.find((f) => f.file === a.file)?.kind).toBe("star");
    }
  });

  it("予定か実績かは、書いてあるもので決める：予定の列（plans）と、実績を書かずに予定のまま残したセル（errata）は予定", () => {
    // 予定と実績を 2 列に分けた表：同じ行・同じ年度に、予定の印と実績の印
    const split = load("nagarebashi").set.truth.marks;
    const byCell = new Map<string, string[]>();
    for (const m of split) byCell.set(`${JSON.stringify("row" in m.at ? m.at.row : m.at)}|${m.fiscal_year}`, [...(byCell.get(`${JSON.stringify("row" in m.at ? m.at.row : m.at)}|${m.fiscal_year}`) ?? []), m.status]);
    expect([...byCell.values()].some((s) => s.includes("planned") && s.includes("actual"))).toBe(true);
    // 予定の列（plans）の印は、どれも予定。実績の列（marks）に予定の記号は無い
    const splitAnswer = starAnswer("nagarebashi");
    const planSymbols = new Set<string>(splitAnswer.records.flatMap((r: { fields?: { plans?: Record<string, string> } }) => Object.values(r.fields?.plans ?? {})));
    expect(planSymbols.size).toBeGreaterThan(0);
    for (const m of split) if (planSymbols.has(m.symbol)) expect([m.symbol, m.status]).toEqual([m.symbol, "planned"]);
    // 1 列の表：書き漏れと記録されたセルの印は、世界の作業が済んでいても予定
    const w = world("hinatano");
    const { set } = load("hinatano");
    const left = (w.errata as { type: string; r: number; year: number; sheet: string }[]).filter((e) => e.type === "omitMark" || e.type === "lastYearUnreflected");
    expect(left.length).toBeGreaterThan(0);
    let seen = 0;
    for (const e of left) {
      const ms = set.truth.marks.filter((m) => "row" in m.at && m.at.row === e.r && m.at.sheet === e.sheet && m.fiscal_year === e.year);
      seen += ms.length;
      for (const m of ms) expect([e.r, e.year, m.status]).toEqual([e.r, e.year, "planned"]);
    }
    expect(seen).toBeGreaterThan(0);
    // 記号の何番目か（列の順＝年度の順）：同じ行の同じ記号は、年度の若い順に 0, 1, 2, …
    const rows = new Map<string, { y: number; nth: number }[]>();
    for (const m of set.truth.marks) if ("row" in m.at) rows.set(`${m.at.sheet}|${m.at.row}|${m.symbol}`, [...(rows.get(`${m.at.sheet}|${m.at.row}|${m.symbol}`) ?? []), { y: m.fiscal_year, nth: m.at.nth ?? 0 }]);
    for (const [k, xs] of rows) expect([k, xs.sort((p, q) => p.y - q.y).map((x) => x.nth)]).toEqual([k, xs.map((_, i) => i)]);
    // しなかった作業（not_done）に残った印は予定
    const sk = world("sakurazaka");
    const notDone = new Set((sk.works as { id: string; status: string }[]).filter((x) => x.status === "not_done").map((x) => x.id));
    const nd = load("sakurazaka").set.truth.marks.filter((m) => m.work_ids.length > 0 && m.work_ids.every((id) => notDone.has(id)));
    expect(nd.length).toBeGreaterThan(0);
    for (const m of nd) expect(m.status).toBe("planned");
  });

  it("機器：行の作業の機器が 1 つに決まる行だけ。シートの中で 1 つの機器に 1 つ。まとまりと同じ行には置かない", () => {
    const { set } = load("hinatano");
    const eq = set.truth.assets.filter((a) => a.kind === "equipment");
    const groups = set.truth.assets.filter((a) => a.kind === "group");
    expect(eq.length).toBeGreaterThan(50);
    expect(groups.length).toBeGreaterThan(5);
    const ids = eq.map((a) => `${"sheet" in a.at ? a.at.sheet : ""}|${a.equipment_id}`);
    expect(new Set(ids).size).toBe(ids.length);
    const rowOf = (a: (typeof eq)[number]) => ("row" in a.at ? `${a.at.sheet}|${a.at.row}` : "");
    const eqRows = new Set(eq.map(rowOf));
    expect(groups.some((g) => eqRows.has(rowOf(g)))).toBe(false);
    // 数える印の機器は、どれも機器として置いてある
    const eqIds = new Set(eq.map((a) => a.equipment_id));
    expect(set.truth.marks.filter((m) => m.measure !== false && !eqIds.has(m.equipment_id))).toEqual([]);
    // 呼び名（name）は、号機だけを書いた行にだけ：同じ名前の機器が、最後の名前だけが違う道に並ぶもの。まとまりの名前を機器の呼び名にしない
    const w = world("hinatano");
    const byId = new Map((w.assets as { id: string; name: string }[]).map((x) => [x.id, x]));
    const named = eq.filter((a) => a.name !== undefined);
    expect(named.length).toBeGreaterThan(0);
    for (const a of named) {
      const sameName = (w.assets as { id: string; name: string }[]).filter((x) => x.id !== a.equipment_id && x.name === byId.get(a.equipment_id!)?.name);
      expect([a.equipment_id, sameName.length > 0]).toEqual([a.equipment_id, true]);
    }
    expect(eq.find((a) => a.name_text === "ごみホッパ" || a.name_text === "トラックスケール")?.name).toBeUndefined();
  });
});
