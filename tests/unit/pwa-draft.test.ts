// 前の作業の写し（pwa-v0）：作業中の計画と確定のシートの確定を、変わるたびに間を詰めて書く・開いたときに戻す・施設か版が違えば戻さない・確定と署名で消す。
// IndexedDB は node に無いので、保存の口（DraftPort）をメモリの口に差し替えて試す。IndexedDB の口そのものは、この試験では走らない。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { acceptDecision, acceptedList, clearAccepted, isAccepted } from "../../src/app/state/decisions";
import { DRAFT_DELAY_MS, DRAFT_SCHEMA, DraftKeeper, draftOf, parseDraft, restoreBlock, type Draft, type DraftPort } from "../../src/app/state/draft";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan, updateWorkingPlan } from "../../src/app/state/plan-store";
import { draftTime } from "../../src/app/components/DraftBand";
import { TEXT } from "../../src/app/text";
import type { Plan } from "../../src/shared/plan";
import { plan as basePlan } from "./share/fixtures";

/** 手で進める時計（間を詰める 1 秒を試すため） */
class Clock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  set = (fn: () => void, ms: number) => {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  };
  clear = (id: unknown) => {
    this.timers = this.timers.filter((x) => x.id !== id);
  };
  advance(ms: number) {
    this.t += ms;
    for (;;) {
      const due = this.timers.filter((x) => x.at <= this.t).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      this.timers = this.timers.filter((x) => x !== due);
      due.fn();
    }
  }
  get pending() {
    return this.timers.length;
  }
}

/** メモリの保存の口（書いた回数も数える） */
class MemoryPort implements DraftPort {
  value: unknown = undefined;
  writes = 0;
  removes = 0;
  async read() {
    return this.value;
  }
  async write(d: Draft) {
    this.writes++;
    this.value = structuredClone(d);
  }
  async remove() {
    this.removes++;
    this.value = undefined;
  }
}

function planOf(planId: string, version: number, name = "【架空】試験の施設"): Plan {
  return { ...basePlan({ assets: [], works: [], details: [], name }), planId, displayName: `【架空】${planId}`, version };
}

let clock: Clock;
let port: MemoryPort;
let keeper: DraftKeeper | null = null;

async function start(p = port): Promise<DraftKeeper> {
  keeper = new DraftKeeper({ port: p, build: "2026-11-03 00:00 test", setTimer: clock.set, clearTimer: clock.clear, now: () => new Date("2026-11-07T05:20:00Z") });
  await keeper.start();
  return keeper;
}

/** 間を詰める 1 秒を進め、書き込みが済むのを待つ */
async function tick(k: DraftKeeper) {
  clock.advance(DRAFT_DELAY_MS);
  await k.idle();
}

beforeEach(() => {
  clearWorkingPlan();
  clearAccepted();
  clock = new Clock();
  port = new MemoryPort();
});
afterEach(() => {
  keeper?.stop();
  keeper = null;
  clearWorkingPlan();
  clearAccepted();
});

describe("写しを書く", () => {
  it("作業中の計画が変わると、1 秒の間の変わりをまとめて 1 回書く", async () => {
    const k = await start();
    setWorkingPlan(planOf("plan-a", 0), "intake");
    updateWorkingPlan(planOf("plan-a", 0, "【架空】名前を直した"), []);
    acceptDecision("D1", "h1", "現場の記録と合う");
    clock.advance(DRAFT_DELAY_MS - 1);
    await k.idle();
    expect(port.writes).toBe(0);
    await tick(k);
    expect(port.writes).toBe(1);
    const d = parseDraft(port.value);
    expect(d).not.toBeNull();
    expect(d!.schema).toBe(DRAFT_SCHEMA);
    expect(d!.working.plan.planId).toBe("plan-a");
    expect(d!.working.plan.facility.name).toBe("【架空】名前を直した");
    expect(d!.accepted).toEqual([{ id: "D1", hash: "h1", reason: "現場の記録と合う" }]);
    expect(d!.savedAt).toBe("2026-11-07T05:20:00.000Z");
    // 変わりが無ければ、もう書かない
    await tick(k);
    expect(port.writes).toBe(1);
  });

  it("保管先の版のまま（開いた・確定した直後）で確定も無ければ書かない。開発の見本も書かない", async () => {
    const k = await start();
    setWorkingPlan(planOf("plan-a", 3), "intake");
    expect(getWorkingPlan()?.stored).toBe(true);
    await tick(k);
    expect(port.writes).toBe(0);
    setWorkingPlan(planOf("plan-dev", 0), "dev");
    await tick(k);
    expect(port.writes).toBe(0);
    // 保管先の版を書き換えれば未確定になり、書く
    setWorkingPlan(planOf("plan-a", 3), "intake");
    updateWorkingPlan(planOf("plan-a", 3, "【架空】直した"), []);
    expect(getWorkingPlan()?.stored).toBe(false);
    await tick(k);
    expect(port.writes).toBe(1);
    expect(parseDraft(port.value)!.working.base).toBe(3);
  });

  it("draftOf：未確定のものが無ければ null", () => {
    const at = new Date(0);
    expect(draftOf(null, [], "b", at)).toBeNull();
    const stored = setWorkingPlan(planOf("plan-a", 2), "intake");
    expect(draftOf(stored, [], "b", at)).toBeNull();
    // 保管先の版のままでも、確定のシートで確定した行があれば書く
    expect(draftOf(stored, [{ id: "D1", hash: "h", reason: "r" }], "b", at)?.accepted).toHaveLength(1);
  });
});

describe("開いたときに戻す", () => {
  async function leftover(planId = "plan-a", base: number | null = null): Promise<void> {
    const k = await start();
    setWorkingPlan(planOf(planId, 0), "intake", [], base);
    acceptDecision("D7", "h7", "台帳の周期と同じ");
    await tick(k);
    k.stop();
    // タブを閉じた：メモリは消える
    clearWorkingPlan();
    clearAccepted();
  }

  it("写しが残っていれば出し、「戻す」で作業中の計画と確定を戻す（保管先の版のままとは見なさない）", async () => {
    await leftover();
    const k = await start();
    expect(k.getView().offer?.working.plan.planId).toBe("plan-a");
    expect(k.getView().block).toBeNull();
    expect(getWorkingPlan()).toBeNull();
    expect(k.restore()).toBeNull();
    expect(getWorkingPlan()?.plan.planId).toBe("plan-a");
    expect(getWorkingPlan()?.origin).toBe("intake");
    expect(getWorkingPlan()?.stored).toBe(false);
    expect(isAccepted("D7", "h7")).toBe(true);
    expect(k.getView().offer).toBeNull();
    // 戻したあとは、また書く
    await tick(k);
    expect(parseDraft(port.value)?.accepted).toHaveLength(1);
  });

  it("施設が違えば戻さない（今の作業を上書きしない）", async () => {
    await leftover("plan-a");
    const k = await start();
    setWorkingPlan(planOf("plan-b", 0), "intake");
    expect(k.getView().block).toBe("facility");
    expect(k.restore()).toBe("facility");
    expect(getWorkingPlan()?.plan.planId).toBe("plan-b");
    expect(acceptedList()).toEqual([]);
    // 選ぶまで、前の作業の写しを上書きしない
    await tick(k);
    expect(parseDraft(port.value)?.working.plan.planId).toBe("plan-a");
  });

  it("版（もとにした版）が違えば戻さない", async () => {
    await leftover("plan-a", 2);
    const k = await start();
    setWorkingPlan(planOf("plan-a", 3), "intake");
    expect(restoreBlock(k.getView().offer!, getWorkingPlan())).toBe("version");
    expect(k.restore()).toBe("version");
    expect(getWorkingPlan()?.base).toBe(3);
  });

  it("「捨てる」で写しを消し、そのあとの作業を書き始める", async () => {
    await leftover("plan-a");
    const k = await start();
    await k.discard();
    expect(port.value).toBeUndefined();
    expect(k.getView().offer).toBeNull();
    setWorkingPlan(planOf("plan-b", 0), "intake");
    await tick(k);
    expect(parseDraft(port.value)?.working.plan.planId).toBe("plan-b");
  });

  it("形の違う写し（ほかの形の名前・壊れた中身）は出さない", async () => {
    port.value = { schema: "moyai.draft/9", working: null };
    const k = await start();
    expect(k.getView().offer).toBeNull();
    expect(parseDraft({ schema: DRAFT_SCHEMA, savedAt: "x", build: "b", working: { plan: { planId: 1 }, origin: "intake", proposals: [], base: null }, accepted: [] })).toBeNull();
  });
});

describe("下の帯の字", () => {
  it("「前の作業を戻す｜捨てる」と、押せない理由。言葉は docs/words.md に従う（印・束・輪・決定のシートを使わない）", () => {
    expect(TEXT.draft.restore).toBe("前の作業を戻す");
    expect(TEXT.draft.discard).toBe("捨てる");
    expect(TEXT.draft.blocked.facility.startsWith("理由：")).toBe(true);
    expect(TEXT.draft.blocked.version.startsWith("理由：")).toBe(true);
    const all = [TEXT.draft.label, TEXT.draft.restore, TEXT.draft.discard, TEXT.draft.blocked.facility, TEXT.draft.blocked.version, TEXT.draft.what("【架空】施設", "2026-11-07 14:20")];
    for (const s of all) expect(s).not.toMatch(/印|束|輪|決定のシート/);
  });

  it("書いた時刻は「YYYY-MM-DD HH:mm」。読めなければ空", () => {
    expect(draftTime("2026-11-07T05:20:00.000Z")).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(draftTime("x")).toBe("");
  });
});

describe("確定・署名で消す", () => {
  it("確定したら写しを消し、確定のダイアログを閉じるまで残る確定の前の計画も書かない", async () => {
    const k = await start();
    setWorkingPlan(planOf("plan-a", 0), "intake");
    acceptDecision("D1", "h1", "理由");
    await tick(k);
    expect(port.value).toBeDefined();
    // 確定のダイアログ：確定を空にし、写しを消す
    clearAccepted();
    await k.settle("plan-a");
    expect(port.value).toBeUndefined();
    await tick(k);
    expect(port.value).toBeUndefined();
    // ダイアログを閉じる：確定した版を置き直す（保管先の版のまま）
    setWorkingPlan(planOf("plan-a", 1), "intake");
    await tick(k);
    expect(port.value).toBeUndefined();
    // 次の版の作業を始めれば、また書く
    updateWorkingPlan(planOf("plan-a", 1, "【架空】次の版"), []);
    await tick(k);
    expect(parseDraft(port.value)?.working.plan.facility.name).toBe("【架空】次の版");
  });

  it("書く前の 1 秒のうちに確定しても、確定の前の計画を書かない", async () => {
    const k = await start();
    setWorkingPlan(planOf("plan-a", 0), "intake");
    expect(clock.pending).toBe(1);
    await k.settle("plan-a");
    await tick(k);
    expect(port.writes).toBe(0);
  });

  it("まだ選んでいないほかの施設の写しは、署名しても消さない", async () => {
    port.value = { schema: DRAFT_SCHEMA, savedAt: "2026-11-07T00:00:00.000Z", build: "b", working: { plan: planOf("plan-a", 0), origin: "intake", proposals: [], base: null }, accepted: [] };
    const k = await start();
    expect(k.getView().offer).not.toBeNull();
    await k.settle("plan-b");
    expect(parseDraft(port.value)?.working.plan.planId).toBe("plan-a");
    expect(k.getView().offer).not.toBeNull();
    // 同じ施設を確定・署名したら消す
    await k.settle("plan-a");
    expect(port.value).toBeUndefined();
    expect(k.getView().offer).toBeNull();
  });
});
