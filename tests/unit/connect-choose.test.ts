// 連携のシートのつなぎ先の選び：同じつなぎ先を選び直しても、読んだ差分を消さない（消すと読み直しが走らず、主ボタンが「差分を読んでいます」で止まる）
import { afterEach, describe, expect, it } from "vitest";
import { chooseTarget, getConnect, loadConnect, planNow, resetConnect } from "../../src/app/state/connect";
import type { BridgeClient } from "../../src/app/bridge-client";

const target = (id: string) => ({ id, kind: "maximo", label: id, host: `${id}.example`, env: "test", write: { needed: false } });
const client = {
  async workCall(path: string) {
    if (path.includes("connect-state")) return { ok: true, enabled: true, available: true, fake: true, targets: [target("a"), target("b")] };
    return { ok: true, target: target("a"), version: 1, rows: [], counts: { ok: 0, diff: 0, one: 0, add: 1, change: 0 }, hash: "h".repeat(64), write: { needed: false } };
  },
} as unknown as BridgeClient;

describe("連携のつなぎ先の選び", () => {
  afterEach(() => resetConnect());

  it("同じつなぎ先を選び直しても差分は残り、別のつなぎ先を選べば消えて読み直しを待つ", async () => {
    await loadConnect(client);
    expect(getConnect().chosen).toBe("a");
    const r = await planNow(client, "p1", "a");
    expect(r.ok).toBe(true);
    chooseTarget("a");
    expect(getConnect().plan?.targetId).toBe("a");
    chooseTarget("b");
    expect(getConnect().chosen).toBe("b");
    expect(getConnect().plan).toBeNull();
  });
});
