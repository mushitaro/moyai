// 公開の台帳を計画に使う（docs/plan.md §2.18.4）：橋渡しが台帳の clone だけを、計画の見え方（立場は市町村）で読む。
// 人が比べを開かなくてよい（運営者の決定）。見え方の答えが無ければ比べずに聞くことを返し、輪は読まない。台帳の版を添える。
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { HumanService } from "../../src/bridge/human";
import { writeSettings } from "../../src/bridge/places";
import { buildLedgerDemo } from "../../scripts/ledger/demo-core";

const extra = join(tmpdir(), `moyai-ledger-ref-${process.pid}-${Date.now()}`);
afterAll(() => rmSync(extra, { recursive: true, force: true }));
const REPO = fileURLToPath(new URL("../../", import.meta.url));

describe("公開の台帳だけを、計画の見え方で読む", () => {
  it("台帳が無ければ no_ledger。答えが無ければ聞くこと。答えれば台帳の似た施設の集計と匿名の札と版", async () => {
    mkdirSync(extra, { recursive: true });
    const sd = join(extra, "state");
    mkdirSync(sd, { recursive: true });
    const human = new HumanService({ stateDir: sd, packsDir: join(REPO, "packs"), now: () => Date.parse("2026-11-04T06:00:00Z") });
    const facility = { scale: 300, scaleUnit: "t/日" };
    expect(await human.ledgerReference({ packId: "waste-incineration", facility, answers: null })).toBe("no_ledger");
    expect(await human.ledgerReference({ packId: "no-such-pack", facility, answers: null })).toBe("ledger_pack_not_ready");

    const repo = join(extra, "台帳");
    const demo = buildLedgerDemo({ repo: REPO, out: repo, state: join(extra, "demo-state"), month: "2026-11" });
    // clone の版（git の HEAD）を読めるよう、.git の形を置く
    mkdirSync(join(repo, ".git", "refs", "heads"), { recursive: true });
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(repo, ".git", "refs", "heads", "main"), `${"ab12cd34ef56".padEnd(40, "0")}\n`);
    writeSettings(sd, { v: 1, root: null, ledger: repo, name: null });

    const asked = (await human.ledgerReference({ packId: "waste-incineration", facility, answers: null })) as Record<string, any>;
    expect(asked).toMatchObject({ mode: "ledger", reason: "answersMissing", aggregates: [], ledgerVersion: "ab12cd34ef56" });
    expect(asked.needs.map((q: { key: string }) => q.key)).toContain("furnace");
    // 規模から処理能力の帯を推した既定がある
    expect(asked.needs.find((q: { key: string }) => q.key === "capacity_t_per_day")?.suggested).toBe("C200_400");

    const answers = { facility: { furnace: "STOKER", capacity_t_per_day: "C200_400", turbine: "YES", ash: "OUT", contract: "SINGLE" }, inNationalTable: true };
    const r = (await human.ledgerReference({ packId: "waste-incineration", facility, answers })) as Record<string, any>;
    expect(r).toMatchObject({ mode: "ledger", position: "municipal", reason: null, needs: [], ledgerVersion: "ab12cd34ef56" });
    // 場は台帳だけ（輪は読まない）
    expect(r.places.map((p: { place: string }) => p.place)).toEqual(["ledger"]);
    expect(r.places[0]).toMatchObject({ place: "ledger", status: "shown" });
    expect(r.aggregates.length).toBeGreaterThan(0);
    for (const a of r.aggregates) {
      expect(a.place).toBe("ledger");
      // 施設ごとの帯・年度・鍵は渡さない（統計だけ）
      expect(Object.keys(a).sort()).toEqual(["commonItem", "days", "interval", "manDays", "place", "work"]);
    }
    expect(r.cards.every((c: { card: string }) => /^類似施設/.test(c.card))).toBe(true);
    expect(demo.ledgerId).toMatch(/^[0-9a-f]{16}$/);
  });
});
