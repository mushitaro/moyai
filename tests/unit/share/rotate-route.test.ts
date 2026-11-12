// 署名鍵を作り直す人だけの経路（facility_key_rotate）を、橋渡しの HumanService から通す（Architect の 41）：
// 画面に見せる鍵（rotateKeysOf）と経路が照らす鍵は同じ関数。前に移したのに輪に印の無い鍵だけが残る保管先でも、画面の鍵で作り直すと印が置かれる
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { HumanService } from "../../../src/bridge/human";
import { writeSettings } from "../../../src/bridge/places";
import { loadRing, rotateKeysOf, unmarkedRetired } from "../../../src/share/checkpoint";
import { retireFacilityKeys, storeFacilityKey } from "../../../src/share/facility";
import { loadSharePack } from "../../../src/share/pack";
import { generateKeyPair, keyIdOf } from "../../../src/share/sign";
import { ringBaseDir } from "../../helpers/ring-dir";

const REPO = fileURLToPath(new URL("../../../", import.meta.url));
let dir = "";
let ringBase = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  if (ringBase) rmSync(ringBase, { recursive: true, force: true });
  dir = "";
  ringBase = "";
});

describe("facility_key_rotate（橋渡しの経路）", () => {
  it("前に移したのに輪に印の無い鍵だけの保管先：画面の鍵で作り直すと印が置かれ、送る止めが解ける", async () => {
    dir = mkdtempSync(join(tmpdir(), "moyai-rotate-route-"));
    const sd = join(dir, "state");
    mkdirSync(sd, { recursive: true });
    const storage = join(dir, "保管先");
    writeSettings(sd, { v: 1, root: storage, ledger: null, name: "【架空】試験の台本" });
    const human = new HumanService({ stateDir: sd, packsDir: join(REPO, "packs"), now: () => Date.parse("2026-11-06T00:00:00Z") });
    const call = async (action: string, payload: unknown) => human.handle({ action: action as never, payload: JSON.stringify(payload), session: "s" });

    // 輪のフォルダの道は固有名詞の数えの照らす相手なので、乱数の文字を入れない（tests/helpers/ring-dir.ts）
    ringBase = ringBaseDir("rotate-route");
    const made = await call("ring_create", { root: join(ringBase, "輪のフォルダ"), packId: "waste-incineration" });
    expect(made.ok).toBe(true);
    const ringId = made.ringId as string;
    const facility = { root: storage, planId: "fixture-fictional-1" };
    const old = generateKeyPair();
    expect(storeFacilityKey(facility, ringId, old)).toBe("ok");
    // 前の作り直しが、鍵を移したところで落ちた（輪に印が無い）
    retireFacilityKeys(facility, ringId);

    const loaded = loadSharePack(join(REPO, "packs"), "waste-incineration");
    if (!loaded.ok) throw new Error(loaded.reason);
    const pack = loaded.pack;
    const ring = await loadRing(sd, ringId, pack);
    if (!ring.ok) throw new Error(ring.reason);
    expect(unmarkedRetired(ring, facility)).toEqual([keyIdOf(old.pub)]);
    const keys = rotateKeysOf(ring, facility);
    expect(keys).toEqual([keyIdOf(old.pub)]);

    // 画面が見せた鍵と違えば断る
    expect(await call("facility_key_rotate", { planId: facility.planId, ringId, keys: ["0".repeat(16)] })).toMatchObject({ ok: false, reason: "previewChanged" });
    // 画面の鍵で作り直すと、印が置かれる
    expect(await call("facility_key_rotate", { planId: facility.planId, ringId, keys })).toMatchObject({ ok: true, retired: keys });
    const after = await loadRing(sd, ringId, pack);
    if (!after.ok) throw new Error(after.reason);
    // 一度も出していない鍵なので仲間の行は無いが、印は受けている
    expect(after.read.retired[keys[0]!]).toBe(0);
    expect(unmarkedRetired(after, facility)).toEqual([]);
  });
});
