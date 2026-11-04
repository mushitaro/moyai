// peer_reference（docs/plan.md §2.13 の 11）：人が星取表で開いた比べだけを読み、下限を守った集計と匿名の札だけを返す。
// 開いていなければ断る。場をまたいで混ぜない。鍵・見え方の値・年度・施設ごとの帯は返さない。立場と輪を選ぶ引数は無い（公開の台帳だけは、開かずに読める）。
import { afterEach, describe, expect, it } from "vitest";
import { runTabTool } from "../../../src/app/intake/tab-tools";
import type { IntakeWorkspace } from "../../../src/app/intake/workspace";
import { setPeerView } from "../../../src/app/state/peers";
import { BRIDGE_TOOL_RECEIVERS } from "../../../src/bridge/tools";
import type { PeerBundle } from "../../../src/share/aggregate";
import type { BundleBody } from "../../../src/share/bundle";
import type { Chunk } from "../../../src/share/copyout";
import type { Profile } from "../../../src/share/k";
import { compare, type Place } from "../../../src/share/receive";
import { keyIdOf, sha256Hex } from "../../../src/share/sign";
import { MCP_INSTRUCTIONS } from "../../../src/shared/instructions";
import { TOOLS } from "../../../src/shared/tools";
import { FACILITY_COMMON, table } from "./fixtures";

const CTX = { conversation: "c-peers", rowsRemaining: 2000 };
const WS = {} as IntakeWorkspace;
const FULL: Profile = { group: "NATIONAL", stage: 0, axes: { ...FACILITY_COMMON } };
const ch = (o: Partial<Chunk> = {}): Chunk => ({ class: "T.FEED", work: "INSPECT", years: ["FY2018", "FY2019"], observed: "N2", interval: "I1", manDays: "W1_9", days: "D1_3", ...o });
function peer(tag: string, chunks: Chunk[]): PeerBundle {
  const pub = sha256Hex(`架空の鍵 ${tag}`);
  const key = keyIdOf(pub);
  return { key, pub, body: { v: "moyai.bundle/0", key, pub, seq: 1, profile: FULL, chunks } as unknown as BundleBody };
}
const many = (tag: string, n: number, chunks: Chunk[]) => Array.from({ length: n }, (_, i) => peer(`${tag}${i}`, chunks));

afterEach(() => setPeerView(null));

describe("peer_reference", () => {
  it("受け手は作業画面（人が開いた比べ）と、橋渡し（公開の台帳だけ。運営者の決定 §2.18.4）。立場と輪を選ぶ引数は無い", () => {
    expect(BRIDGE_TOOL_RECEIVERS.peer_reference).toBe("tab_then_bridge");
    // 場は「公開の台帳」だけを選べる（輪は人が開いたときだけ）。立場は引数に無い（台帳だけを読むときは市町村に固める）
    expect(Object.keys(TOOLS.peer_reference.input.shape).sort()).toEqual(["answers", "commonItem", "place"]);
    expect(TOOLS.peer_reference.input.safeParse({ place: "ring" }).success).toBe(false);
    expect(TOOLS.peer_reference.kind).toBe("read");
    expect(MCP_INSTRUCTIONS).toContain("peer_reference");
    expect(MCP_INSTRUCTIONS.length).toBeLessThanOrEqual(4096);
  });

  it("人が比べを開いていなければ断る", () => {
    expect(runTabTool(WS, "peer_reference", {}, CTX)).toEqual({ ok: false, code: "no_peer_view" });
  });

  it("場ごとの集計と札だけを返す。鍵・見え方の値・年度・施設ごとの帯は返さない", () => {
    const ledger: Place = { kind: "ledger", id: "317f291617ec26bb", peers: many("台帳", 5, [ch(), ch({ class: "T.POWER", work: "OVERHAUL", interval: "I3" })]), self: [] };
    const ring: Place = { kind: "ring", id: "0123456789abcdef", peers: many("輪", 3, [ch({ interval: "I2" })]), self: [] };
    const small: Place = { kind: "ring", id: "fedcba9876543210", peers: many("少ない", 2, [ch()]), self: [] };
    const c = compare({ table, position: "subsidiary", profile: FULL, places: [ledger, ring, small] });
    setPeerView({ comparison: c, packId: "waste-incineration" });

    const r = runTabTool(WS, "peer_reference", {}, CTX);
    if (!r.ok) throw new Error(r.code);
    expect(TOOLS.peer_reference.output.safeParse(r.data).success).toBe(true);
    const d = r.data as any;
    expect(d.position).toBe("subsidiary");
    expect(d.floorK).toBe(3);
    expect(d.places).toEqual([
      { place: "ring", status: "shown", similar: 3 },
      { place: "ring", status: "belowShow", similar: 2 },
      { place: "ledger", status: "shown", similar: 5 },
    ]);
    // 場をまたいで混ぜない：同じ塊でも場ごとに 1 行
    const feed = d.aggregates.filter((a: any) => a.commonItem === "T.FEED");
    expect(feed.map((a: any) => [a.place, a.interval])).toEqual([
      ["ring", { shown: "range", n: 3, low: "I2", high: "I2" }],
      ["ledger", { shown: "median", n: 5, median: "I1", q1: "I1", q3: "I1" }],
    ]);
    expect(d.cards.filter((x: any) => x.place === "ledger" && x.commonItem === "T.FEED")).toHaveLength(5);
    // 下限に届かない場の札は無い
    expect(d.cards.filter((x: any) => x.place === "ring")).toHaveLength(3);

    const text = JSON.stringify(d);
    for (const p of [...ledger.peers, ...ring.peers]) {
      expect(text).not.toContain(p.key);
      expect(text).not.toContain(p.pub);
    }
    expect(text).not.toContain("FY2018");
    expect(text).not.toContain("STOKER");
    expect(text).not.toContain("317f291617ec26bb");
    expect(text).not.toContain("W1_9\",\"days");

    // 項目で絞れる
    const one = runTabTool(WS, "peer_reference", { commonItem: "T.POWER" }, CTX);
    if (!one.ok) throw new Error(one.code);
    expect((one.data as any).aggregates.map((a: any) => [a.place, a.commonItem, a.work])).toEqual([["ledger", "T.POWER", "OVERHAUL"]]);
  });
});
