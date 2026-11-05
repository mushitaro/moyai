// 新-10：作り直したとき、もとにした版から施設の見え方の答えと、人が受けた周期の案（台帳から置いた計画の印）を引き継ぐ。
// 周期の案は「第 n 版と同じ」の案として並べ直し、決定の中身が変わるので、人がもう一度受けるまで決まらない
import { expect, test } from "vitest";
import { carryFromBase } from "../../src/app/state/crosswalk";
import { aiDecisions, pendingDecisions } from "../../src/plan/diff";
import type { Plan } from "../../src/shared/plan";
import { asset, detail, plan, work } from "./share/fixtures";

test("見え方の答えを写し、受けた周期の案を「第 n 版と同じ」で並べ直す。人が受けるまで決まらない", () => {
  const cy = detail("cy-L1-a1-2030", "w1", 2030, { planOrActual: "plan", author: "ai", basis: "公開の台帳・似た施設 6 の帯" });
  const base: Plan = plan({ assets: [asset("a1", "T.FEED.LIFT")], works: [work("w1", "INSPECT", ["a1"])], details: [detail("d1", "w1", 2020), cy] });
  base.facility = { ...base.facility, profile: { furnace: "STOKER" }, inNationalTable: true };
  const accepted = aiDecisions(base).map((d) => ({ id: d.id, hash: d.hash }));
  expect(pendingDecisions(base, accepted)).toEqual([]);
  // 作り直した計画：資料から作るので、周期の案と見え方の答えが無い
  const next: Plan = { ...base, facility: { ...base.facility, profile: undefined, inNationalTable: null }, details: [detail("d1", "w1", 2020)] };
  delete (next.facility as { profile?: unknown }).profile;
  const carried = carryFromBase(next, base, 1);
  expect(carried.facility.profile).toEqual({ furnace: "STOKER" });
  expect(carried.facility.inNationalTable).toBe(true);
  const c = carried.details.find((d) => d.detailKey === cy.detailKey)!;
  expect(c.basis).toContain("第 1 版で受けた当てはめと同じ");
  // 前の版で受けた決定とは中身が違うので、もう一度受けるまで決まらない
  expect(pendingDecisions(carried, accepted).map((d) => d.id)).toEqual([`detail:${cy.detailKey}`]);
  // 作業が無くなった周期の案は並べない
  expect(carryFromBase({ ...next, works: [] }, base, 1).details.some((d) => d.detailKey === cy.detailKey)).toBe(false);
});
