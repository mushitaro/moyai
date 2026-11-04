// 受け手の場を読む（公開の台帳の clone と自分の輪）。どちらも受け手の関数で確かめた ✓ の束（鍵ごとに最新の 1 つ）だけを渡し、
// 読めない場は理由つきで返す。輪では自分の束も読むが、集計では自分を数えない（compare の self）。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRing, loadRing, previewCheckpoint, sendCheckpoint, type Answers } from "../../../src/share/checkpoint";
import { facilityKey } from "../../../src/share/facility";
import { keyIdOf } from "../../../src/share/sign";
import type { SharePack } from "../../../src/share/pack";
import { compare } from "../../../src/share/receive";
import { loadLedgerPlace, loadPlaces, loadRingPlaces } from "../../../src/share/receive-load";
import { FACILITY_COMMON, SPEC, smallPlan, table, vocab } from "./fixtures";
import { forge, makeLedger, makeSigner, sealLedger, writeRepo } from "./ledger-fixtures";

const PACK: SharePack = { id: "waste-incineration", name: "架空のパック", spec: SPEC, vocab, table, classNames: {}, axes: [] };
const ANSWERS: Answers = { facility: FACILITY_COMMON, inNationalTable: true };
const NOW = new Date(2026, 10, 4, 12, 0, 0);

let tmp = "";
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "moyai-receive-"));
});
afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

describe("公開の台帳の clone を読む", () => {
  it("✓ の束だけを、鍵ごとに最新の 1 つで渡す。✗ の束は数だけ", async () => {
    const L = makeLedger();
    const signers = Array.from({ length: 4 }, () => makeSigner());
    const ok = signers.map((s) => sealLedger(L, s, smallPlan()));
    const second = sealLedger(L, signers[0]!, smallPlan(), { seq: 2, prev: ok[0]!.hash });
    const bad = forge(sealLedger(L, makeSigner(), smallPlan()), makeSigner(), (b) => {
      b.seq = 1;
    });
    const dir = join(tmp, "台帳");
    writeRepo(dir, L, [...ok, second, bad]);
    const r = await loadLedgerPlace(dir, PACK);
    expect(r.status).toMatchObject({ kind: "ledger", id: L.id, ok: true, reason: null, peers: 4, ng: 1 });
    expect(r.place?.peers).toHaveLength(4);
    expect(r.place?.peers.find((p) => p.key === signers[0]!.key)?.body.seq).toBe(2);
    // 保管先を渡さなければ、自分の鍵は無い（似た施設に数える束を減らさない）
    expect(r.place?.self).toEqual([]);
    expect(r.place?.bands).toEqual(L.rules.bands);
  });

  it("まだ選んでいない・台帳の形でない・ほかのパックの台帳は、理由つきで場にしない", async () => {
    expect((await loadLedgerPlace(null, PACK)).status).toMatchObject({ ok: false, reason: "ledger.notChosen" });
    expect((await loadLedgerPlace(join(tmp, "無いフォルダ"), PACK)).status).toMatchObject({ ok: false, reason: "ledger.noLedgerDir" });
    const other = { ...PACK, id: "night-soil" };
    const dir = join(tmp, "台帳2");
    writeRepo(dir, makeLedger(), []);
    const r = await loadLedgerPlace(dir, other);
    expect(r.place).toBeNull();
    expect(r.status.ok).toBe(false);
  });
});

describe("自分の輪を読む", () => {
  it("✓ の最新の束の body を渡し、保管先の施設の鍵を self にする（集計では自分を数えない）", async () => {
    const stateDir = join(tmp, "state");
    const root = join(tmp, "輪のフォルダ");
    const storage = join(tmp, "保管先");
    const c = await createRing({ stateDir, root, pack: PACK, now: NOW });
    if (!c.ok) throw new Error(c.reason);
    const p = smallPlan();
    const facility = { root: storage, planId: p.planId };
    const k = facilityKey(facility, c.ringId, new Map());
    if (!k.ok) throw new Error(k.reason);
    const sender = { facility, pair: k.pair, stored: k.stored };
    const key = keyIdOf(k.pair.pub);
    const ring = await loadRing(stateDir, c.ringId, PACK, [key]);
    if (!ring.ok) throw new Error(ring.reason);
    const v = previewCheckpoint(ring, sender, PACK, p, ANSWERS, "2026-11");
    const s = await sendCheckpoint(ring, sender, PACK, p, ANSWERS, "2026-11", v.bodyHash!, NOW);
    expect(s.ok).toBe(true);

    const r = await loadRingPlaces(stateDir, PACK, storage);
    expect(r.status).toEqual([{ kind: "ring", id: c.ringId, ok: true, reason: null, peers: 1, ng: 0 }]);
    expect(r.places[0]).toMatchObject({ kind: "ring", id: c.ringId, self: [key] });
    expect(r.places[0]!.peers.map((x) => x.key)).toEqual([key]);

    // 輪には自分しかいないので、保全子会社の立場で比べても似た施設は 0（自分を数えない）
    const all = await loadPlaces({ stateDir, ledgerRoot: null, pack: PACK, storage });
    const cmp = compare({ table, position: "subsidiary", profile: { group: "NATIONAL", stage: 0, axes: { ...FACILITY_COMMON } }, places: all.places });
    expect(cmp.places).toEqual([
      { kind: "ring", id: c.ringId, status: "belowShow", similar: 0 },
      { kind: "ledger", id: null, status: "missing" },
    ]);
    expect(all.status.map((x) => [x.kind, x.ok, x.reason])).toEqual([
      ["ledger", false, "ledger.notChosen"],
      ["ring", true, null],
    ]);
  });

  it("ほかのパックの輪は読まない", async () => {
    const r = await loadRingPlaces(join(tmp, "state"), { ...PACK, id: "night-soil" });
    expect(r).toEqual({ places: [], status: [] });
  });
});
