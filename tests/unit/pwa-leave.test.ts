// 閉じる前の知らせ（pwa-v0・docs/plan.md §2.9）：作業中のもの（資料・未確定の答えか計画）があるときだけ beforeunload で止める。
import { describe, expect, it } from "vitest";
import { guardLeave, hasUnsavedWork, planStateOf, type LeaveState } from "../../src/app/state/leave";

const none: LeaveState = { files: 0, filesInStored: false, accepted: 0, plan: "none" };

/** beforeunload の受け手だけを持つ窓 */
function fakeWindow() {
  const handlers = new Set<(e: BeforeUnloadEvent) => void>();
  return {
    handlers,
    addEventListener: (type: string, h: (e: BeforeUnloadEvent) => void) => {
      if (type === "beforeunload") handlers.add(h);
    },
    removeEventListener: (type: string, h: (e: BeforeUnloadEvent) => void) => {
      if (type === "beforeunload") handlers.delete(h);
    },
    /** 閉じようとする。止められたら true */
    unload(): boolean {
      let prevented = false;
      const e = { preventDefault: () => (prevented = true), returnValue: undefined as unknown } as unknown as BeforeUnloadEvent;
      for (const h of handlers) h(e);
      return prevented;
    },
  };
}

describe("知らせるか", () => {
  it("何も無ければ知らせない", () => {
    expect(hasUnsavedWork(none)).toBe(false);
  });

  it("資料が 1 つ以上あれば知らせる（計画をまだ作っていない・作業中の計画が未確定）", () => {
    expect(hasUnsavedWork({ ...none, files: 1 })).toBe(true);
    expect(hasUnsavedWork({ ...none, files: 1, plan: "draft" })).toBe(true);
    // 保管先の版のままの計画でも、資料と答えがその版に入っていなければ知らせる
    expect(hasUnsavedWork({ ...none, files: 2, plan: "stored", filesInStored: false })).toBe(true);
  });

  it("未確定の計画か、確定のシートで確定した行があれば知らせる", () => {
    expect(hasUnsavedWork({ ...none, plan: "draft" })).toBe(true);
    expect(hasUnsavedWork({ ...none, accepted: 1 })).toBe(true);
    expect(hasUnsavedWork({ ...none, plan: "stored", accepted: 1 })).toBe(true);
  });

  it("確定が済んで、資料と答えも確定した版に入っていれば知らせない", () => {
    expect(hasUnsavedWork({ files: 3, filesInStored: true, accepted: 0, plan: "stored" })).toBe(false);
    expect(hasUnsavedWork({ ...none, plan: "stored" })).toBe(false);
  });

  it("作業中の計画の状態：取り込みの計画だけを数え、開発の見本は数えない", () => {
    expect(planStateOf(null)).toBe("none");
    expect(planStateOf({ origin: "dev", stored: false })).toBe("none");
    expect(planStateOf({ origin: "intake", stored: true })).toBe("stored");
    expect(planStateOf({ origin: "intake", stored: false })).toBe("draft");
  });
});

describe("beforeunload", () => {
  it("作業中のものがあるときだけ止め、外せば止めない", () => {
    const w = fakeWindow();
    let state: LeaveState = none;
    const off = guardLeave(w, () => state);
    expect(w.handlers.size).toBe(1);
    expect(w.unload()).toBe(false);
    state = { ...none, files: 1 };
    expect(w.unload()).toBe(true);
    state = { files: 1, filesInStored: true, accepted: 0, plan: "stored" };
    expect(w.unload()).toBe(false);
    state = { ...none, plan: "draft" };
    expect(w.unload()).toBe(true);
    off();
    expect(w.handlers.size).toBe(0);
    expect(w.unload()).toBe(false);
  });

  it("止めるときは、古い Chrome と Edge のために returnValue も置く", () => {
    const w = fakeWindow();
    guardLeave(w, () => ({ ...none, accepted: 2 }));
    const e = { preventDefault: () => {}, returnValue: undefined as unknown } as unknown as BeforeUnloadEvent;
    for (const h of w.handlers) h(e);
    expect(e.returnValue).toBe(true);
  });
});
