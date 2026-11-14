// 作業画面の作業中の写し（mushitaro/moyai#82。src/app/state/work.ts）：変わるたびに間を置いてまとめて書く・資料は 1 回だけ送る・
// 写真は写さない・資料ごと戻す（戻す途中は書かない）。保存のボタンは無い。
import { afterEach, describe, expect, it } from "vitest";
import { WorkKeeper, type WorkPort, type WorkSource, type WorkState } from "../../src/app/state/work";
import { clearWorkingPlan, getWorkingPlan, setWorkingPlan } from "../../src/app/state/plan-store";
import { acceptedList, clearAccepted } from "../../src/app/state/decisions";
import { truthToPlan } from "../fixtures/chart/truth-to-plan.mjs";
import type { Plan } from "../../src/shared/plan";

const FICTIONAL_1 = truthToPlan("fictional-1") as Plan;
/** 試験の指紋（中身ごとに違う 64 字の数字） */
const shaOf = (b: Uint8Array) => [...b].join("").slice(-64).padStart(64, "0");

afterEach(() => {
  clearWorkingPlan();
  clearAccepted();
});

function fakes(names: string[] = ["日報.xlsx", "台帳.xlsx"]) {
  const puts: string[] = [];
  const saves: WorkState[] = [];
  const store = new Map<string, Uint8Array>();
  let saved: WorkState | null = null;
  const port: WorkPort = {
    putSource: async (_p, bytes) => {
      const sha = shaOf(bytes);
      puts.push(sha);
      store.set(sha, bytes);
      return { ok: true, sha256: sha, size: bytes.length };
    },
    save: async (s) => {
      saves.push(s);
      saved = s;
      return { ok: true };
    },
    read: async () => saved,
    source: async (_p, sha) => store.get(sha) ?? null,
  };
  const listeners = new Set<() => void>();
  const restored: unknown[] = [];
  const ws: WorkSource & { names: string[]; photos: boolean; key: string } = {
    names,
    photos: false,
    settings: { packId: "waste-incineration", facilityName: "【架空】", fiscalYearStartMonth: 4, fictional: true },
    get fileNames() {
      return this.names;
    },
    get userFileNames() {
      return this.names.filter((n) => n !== "デモ.xlsx");
    },
    decisions: () => [{ questionId: "q1", answer: "a", author: "human", reason: "" }] as never,
    filesVersion: 0,
    marksVersion: 0,
    sourcesForWork: async function () {
      const keep = this.names;
      return { files: keep.map((n) => ({ name: n, bytes: new TextEncoder().encode(n), sha256: shaOf(new TextEncoder().encode(n)) })), skipped: this.names.length - keep.length };
    },
    subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    pinPlanId: () => {},
    derivedOf: () => null,
    key: FICTIONAL_1.planId,
    facilityKey() {
      return this.key;
    },
    restoreWork: async (...a) => {
      restored.push(a);
    },
  };
  let timer: (() => void) | null = null;
  const delays: number[] = [];
  const k = new WorkKeeper({ port, ws, build: "t", setTimer: (fn, ms) => ((timer = fn), delays.push(ms), 1 as never), clearTimer: () => (timer = null) });
  const seed = (st: WorkState) => (saved = st);
  return { k, ws, puts, saves, restored, seed, delays, fire: () => timer?.(), pending: () => timer !== null, poke: () => listeners.forEach((l) => l()) };
}

describe("作業中の写し", () => {
  it("変わったら間を置いて 1 回書く。資料は名前の並びが変わったときだけ送る。未確定の数と名前を添える", async () => {
    const f = fakes();
    f.k.start();
    setWorkingPlan(FICTIONAL_1, "intake");
    f.poke();
    expect(f.pending()).toBe(true);
    f.fire();
    await f.k.idle();
    expect(f.saves).toHaveLength(1);
    const s = f.saves[0]!;
    expect(s.planId).toBe(FICTIONAL_1.planId);
    expect(s.files.map((x) => x.name)).toEqual(["日報.xlsx", "台帳.xlsx"]);
    expect(s.open).toBeGreaterThanOrEqual(0);
    expect(s.changed).toBe(true);
    expect(f.puts).toHaveLength(2);
    // 計画だけが変わった：資料は送り直さない
    f.poke();
    f.fire();
    await f.k.idle();
    expect(f.puts).toHaveLength(2);
    expect(f.saves).toHaveLength(2);
    // 資料が増えた：送る
    f.ws.names = [...f.ws.names, "デモ.xlsx"];
    f.poke();
    f.fire();
    await f.k.idle();
    expect(f.saves.at(-1)!.files.find((x) => x.name === "デモ.xlsx")?.demo).toBe(true);
    f.k.stop();
  });

  it("写真も写す。計画を作る前でも資料と答えを残す。資料も計画も無ければ書かない", async () => {
    const none = fakes([]);
    await none.k.flush();
    expect(none.saves).toHaveLength(0);
    const before = fakes();
    await before.k.flush();
    expect(before.saves[0]).toMatchObject({ planId: FICTIONAL_1.planId, plan: null, open: 0, changed: true });
    expect(before.saves[0]!.files).toHaveLength(2);
    expect(before.saves[0]!.decisions).toHaveLength(1);
    // 写真も資料として写す（資料の紐づきを切らない）
    const f = fakes(["日報.xlsx", "台帳.xlsx", "写真.jpg"]);
    f.ws.photos = true;
    await f.k.flush();
    expect(f.saves[0]!.files.map((x) => x.name)).toEqual(["日報.xlsx", "台帳.xlsx", "写真.jpg"]);
    expect(f.saves[0]!.skipped).toBe(0);
  });

  it("資料ごと戻す：資料・答え・計画・確定を戻し、戻す途中は書かない", async () => {
    const f = fakes();
    setWorkingPlan(FICTIONAL_1, "intake");
    await f.k.flush();
    clearWorkingPlan();
    f.k.start();
    const r = await f.k.restore(FICTIONAL_1.planId);
    expect(r.ok).toBe(true);
    expect(f.restored).toHaveLength(1);
    const [base, files, decisions, demo] = f.restored[0] as [number | null, { name: string }[], unknown[], string[]];
    expect(base).toBeNull();
    expect(files.map((x) => x.name)).toEqual(["日報.xlsx", "台帳.xlsx"]);
    expect(decisions).toHaveLength(1);
    expect(demo).toEqual([]);
    expect(getWorkingPlan()?.plan.planId).toBe(FICTIONAL_1.planId);
    expect(getWorkingPlan()?.stored).toBe(false);
    expect(acceptedList()).toEqual([]);
    expect(f.saves).toHaveLength(1);
    f.k.stop();
  });

  it("計画と資料が別の施設のもの（版を開く途中）なら書かない。ほかのタブの作業中（未確定あり）は、戻すか消すまで上書きしない。消したら書き直さない", async () => {
    const f = fakes();
    // 計画は FICTIONAL_1、資料の施設は別
    f.ws.key = "intake-other";
    setWorkingPlan(FICTIONAL_1, "intake");
    await f.k.flush();
    expect(f.saves).toHaveLength(0);
    // 同じ施設になった：保管先に、ほかで作った未確定の作業中がある → 書かない
    f.ws.key = FICTIONAL_1.planId;
    f.seed({ planId: FICTIONAL_1.planId, changed: true, open: 5, files: [], skipped: 0, plan: null, proposals: [], accepted: [], decisions: [], base: null, settings: f.ws.settings } as unknown as WorkState);
    await f.k.flush();
    expect(f.saves).toHaveLength(0);
    // 戻したら、このタブの作業中として書く
    await f.k.restore(FICTIONAL_1.planId);
    setWorkingPlan(FICTIONAL_1, "intake");
    await f.k.flush();
    expect(f.saves).toHaveLength(1);
    // 人が消したら、このタブに残っていても書き直さない
    f.k.forget(FICTIONAL_1.planId);
    await f.k.flush();
    expect(f.saves).toHaveLength(1);
  });
});

describe("計画を作る前に計画 ID が替わったとき（資料を入れたあとにパックが決まった）", () => {
  /** 計画 ID ごとに作業中を持つ保管先の代わり（move は橋渡しと同じ条件を見る） */
  function store() {
    const works = new Map<string, WorkState>();
    const moves: [string, string][] = [];
    const f = fakes();
    const port = (f.k as unknown as { o: { port: WorkPort } }).o.port;
    port.save = async (s) => (works.set(s.planId, s), { ok: true });
    port.read = async (id) => works.get(id) ?? null;
    port.move = async (from, to, writer) => {
      const a = works.get(from);
      const b = works.get(to);
      if (!a || !b || a.writer !== writer || b.writer !== writer || a.plan !== null) return { ok: false };
      moves.push([from, to]);
      works.delete(from);
      return { ok: true };
    };
    return { ...f, works, moves };
  }

  it("このタブが書いた仮の写しは、新しい ID に資料と答えごと書いて読み直してから、前の ID を片づける", async () => {
    const f = store();
    f.ws.key = "intake--abc";
    f.ws.settings = { ...f.ws.settings, packId: "" };
    await f.k.flush();
    expect([...f.works.keys()]).toEqual(["intake--abc"]);
    f.ws.key = "intake-waste-incineration-abc";
    f.ws.settings = { ...f.ws.settings, packId: "waste-incineration" };
    await f.k.flush();
    expect(f.moves).toEqual([["intake--abc", "intake-waste-incineration-abc"]]);
    const w = f.works.get("intake-waste-incineration-abc")!;
    expect([...f.works.keys()]).toEqual(["intake-waste-incineration-abc"]);
    // 資料の紐づきを切らない：資料と答えは新しい写しにある
    expect(w.files.map((x) => x.name)).toEqual(["日報.xlsx", "台帳.xlsx"]);
    expect(w.decisions).toHaveLength(1);
    expect(w.writer).toBe(f.k.writer);
  });

  it("仮の写しのあとで計画 ID が替わったら、間を置かずに書いて移す（続けて変わっても延ばさない）。替わらなければいつもの間", async () => {
    const f = store();
    f.k.start();
    f.ws.key = "intake--abc";
    f.poke();
    expect(f.delays.at(-1)).toBe(1500);
    f.fire();
    await f.k.idle();
    expect([...f.works.keys()]).toEqual(["intake--abc"]);
    // 同じ ID のまま変わる：いつもの間
    f.poke();
    expect(f.delays.at(-1)).toBe(1500);
    // パックが決まって ID が替わる：すぐ書く。続けて変わっても、すぐのまま
    f.ws.key = "intake-waste-incineration-abc";
    f.poke();
    f.poke();
    expect(f.delays.slice(-2)).toEqual([0, 0]);
    f.fire();
    await f.k.idle();
    expect([...f.works.keys()]).toEqual(["intake-waste-incineration-abc"]);
    // 移し終えたら、いつもの間に戻る
    f.poke();
    expect(f.delays.at(-1)).toBe(1500);
    f.k.stop();
  });

  it("ほかのタブ・前の作業の作業中（このタブが書き始めたのでない）には触れない。計画を作ったあとの写しも移さない", async () => {
    const f = store();
    // ほかのタブが前に書いた、変更の無い作業中（このタブは上書きしてよいが、書き始めたのではない）
    f.works.set("intake--abc", { schema: "moyai.work/1", writer: "other-tab-writer-0001", savedAt: "", build: "", planId: "intake--abc", displayName: "", fictional: true, open: 0, changed: false, base: null, settings: f.ws.settings, files: [], skipped: 0, decisions: [], plan: null, proposals: [], accepted: [] });
    f.ws.key = "intake--abc";
    await f.k.flush();
    f.ws.key = "intake-waste-incineration-abc";
    await f.k.flush();
    expect(f.moves).toEqual([]);
    expect([...f.works.keys()].sort()).toEqual(["intake--abc", "intake-waste-incineration-abc"]);
    // 計画を作ったあと（版の ID）で書いた写しは、仮の写しではない
    const g = store();
    setWorkingPlan(FICTIONAL_1, "intake");
    await g.k.flush();
    clearWorkingPlan();
    g.ws.key = "intake-waste-incineration-other";
    await g.k.flush();
    expect(g.moves).toEqual([]);
  });
});
