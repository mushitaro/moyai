// 偽の連携（試験用。MOYAI の芯が持つ）：業務システムの代わりに、橋渡しのメモリだけに【架空】の資産の木・保全計画・作業の実績を持つ。
// どこにも通信しない。つなぎ先はテスト環境と本番の 2 つ。本番への書き込みの鍵の確かめは、試験用の確かめに差し替えられる。
// 部品の /testing（createFakeMaximo）が入ったら、それをここで包んでもよい（今は芯だけで端から端まで通す）。
import { planLinesOfRecords, planWrite, type ConnectTarget, type EamRecords, type EamWriteChange, type PlanLine } from "../../shared/connect";
import type { ConnectBackend, ConnectSecret, EamConnector, LicenseAnswer, LicenseCheck } from "./types";

export const FAKE_TARGETS: readonly ConnectTarget[] = [
  { id: "fake-test", label: "【架空】保全システム（テスト）", kind: "fake", host: "maximo-test.fake.invalid", env: "test" },
  { id: "fake-production", label: "【架空】保全システム（本番）", kind: "fake", host: "maximo.fake.invalid", env: "production" },
];

/** 【架空】の初めの中身（資産の木・保全計画・作業の実績）。どの値も架空 */
export function fakeSeed(): EamRecords {
  const assets = [
    { ref: "A0", parentRef: null, name: "【架空】みなと台清掃工場", tag: null },
    { ref: "A1", parentRef: "A0", name: "ボイラ設備", tag: null },
    { ref: "A11", parentRef: "A1", name: "ボイラ給水ポンプ A", tag: "1号炉" },
    { ref: "A12", parentRef: "A1", name: "ボイラ給水ポンプ B", tag: "1号炉" },
    { ref: "A13", parentRef: "A1", name: "スートブロワ A", tag: "1号炉" },
    { ref: "A2", parentRef: "A0", name: "通風設備", tag: null },
    { ref: "A21", parentRef: "A2", name: "二次押込送風機", tag: "1号炉" },
  ];
  const plans = [
    { ref: "P1", assetRef: "A11", work: "ボイラ給水ポンプの分解整備", fiscalYears: [2028] },
    { ref: "P2", assetRef: "A12", work: "ボイラ給水ポンプの分解整備", fiscalYears: [2028] },
    { ref: "P3", assetRef: "A21", work: "通風補機の点検", fiscalYears: [2026, 2027] },
  ];
  const results = [
    { ref: "R1", assetRef: "A11", work: "ボイラ給水ポンプの分解整備", date: "2024/04/06", manDays: 4 },
    { ref: "R2", assetRef: "A12", work: "ボイラ給水ポンプの分解整備", date: "2024/04/07", manDays: 4 },
    { ref: "R3", assetRef: "A13", work: "スートブロワの分解整備", date: "2024/04/08", manDays: 3 },
    { ref: "R4", assetRef: "A21", work: "通風補機の点検", date: "2024/05/10", manDays: 2 },
    { ref: "R5", assetRef: "A21", work: "通風補機の点検", date: "2025/05/12", manDays: 2 },
  ];
  return { assets, plans, results };
}

const clone = (r: EamRecords): EamRecords => JSON.parse(JSON.stringify(r)) as EamRecords;

export interface FakeConnect {
  backend: ConnectBackend;
  /** つなぎ先ごとの今の中身（試験が書き込みを確かめる） */
  records(id: string): EamRecords;
  /** 書き込みの呼ばれた回数（つなぎ先ごと。カナリアの 1 件目も 1 回と数える） */
  writes(id: string): number;
}

/**
 * 偽の連携を作る。licensedHosts：本番への書き込みの有効な鍵がある host（試験用の確かめ）。license を渡せば、それに差し替える。
 * failAfter：試験で、その件数を書いたあとの書き込みを失敗させる（カナリアの確かめの試験）
 */
export function createFakeConnect(o: { licensedHosts?: readonly string[]; license?: LicenseCheck; failAfter?: number } = {}): FakeConnect {
  const targets: ConnectTarget[] = [...FAKE_TARGETS];
  const data = new Map(FAKE_TARGETS.map((t) => [t.id, fakeSeed()]));
  const writes = new Map<string, number>();
  const hosts = new Set(o.licensedHosts ?? []);
  const license: LicenseCheck =
    o.license ??
    ({
      authorize: async (host: string): Promise<LicenseAnswer> => (hosts.has(host) ? { ok: true } : { ok: false, reason: "noKey" }),
    } satisfies LicenseCheck);
  const connector: EamConnector = {
    loadRecords: async (target) => clone(data.get(target.id) ?? { assets: [], plans: [], results: [] }),
    planCommit: (_target, current, desired: readonly PlanLine[]) => ({ changes: planWrite(desired, planLinesOfRecords(current)).changes }),
    executeCommit: async (target, _secret, changes: readonly EamWriteChange[]) => {
      const r = data.get(target.id);
      if (!r) throw new Error("fake: no target");
      let applied = 0;
      for (const c of changes) {
        const n = (writes.get(target.id) ?? 0) + 1;
        if (o.failAfter !== undefined && n > o.failAfter) throw new Error("fake: write failed");
        writes.set(target.id, n);
        applyChange(r, c);
        applied++;
      }
      return { applied };
    },
  };
  const secret: ConnectSecret = { opaque: "fake" };
  return {
    backend: {
      fake: true,
      store: {
        list: () => [...targets],
        open: (id) => {
          const t = targets.find((x) => x.id === id);
          return t ? { target: t, secret } : null;
        },
        // 人が設定で足す（試験の台）：どこにも通信しない。キーは持たない（形だけ確かめて捨てる）
        add: async (input) => {
          const label = input.label.trim();
          if (!label || label.length > 80) return { ok: false, problem: "name" };
          const host = httpsOrigin(input.url);
          if (!host) return { ok: false, problem: "url" };
          if (!/^[\x21-\x7e]{1,4096}$/.test(input.apiKey)) return { ok: false, problem: "key" };
          if (targets.length >= 50) return { ok: false, problem: "tooMany" };
          const t: ConnectTarget = { id: `fake-added-${targets.length + 1}`, label: label.includes("【架空】") ? label : `【架空】${label}`, kind: "fake", host, env: input.env };
          targets.push(t);
          data.set(t.id, fakeSeed());
          return { ok: true, target: t };
        },
      },
      connectors: { fake: connector },
      license,
    },
    records: (id) => clone(data.get(id) ?? { assets: [], plans: [], results: [] }),
    writes: (id) => writes.get(id) ?? 0,
  };
}

/** https://host[:port] だけを受け、host を返す（パス・問い合わせ・利用者名つきは受けない） */
function httpsOrigin(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || (u.pathname !== "/" && u.pathname !== "")) return null;
  return u.host;
}

/** 1 件を書く：資産の道をたどって（無い節は足して）、同じ作業の保全計画の年度を置き換えるか足す */
export function applyChange(r: EamRecords, c: EamWriteChange): void {
  const names = c.assetPath.split(" › ");
  let parent: string | null = null;
  for (const name of names) {
    let a = r.assets.find((x) => x.parentRef === parent && x.name === name);
    if (!a) {
      a = { ref: `A${r.assets.length + 1}x`, parentRef: parent, name, tag: null };
      r.assets.push(a);
    }
    parent = a.ref;
  }
  const ref = parent!;
  const same = r.plans.filter((p) => p.assetRef === ref && p.work.trim() === c.work);
  if (same.length) {
    same[0]!.fiscalYears = [...c.after];
    r.plans = r.plans.filter((p) => !same.slice(1).includes(p));
  } else r.plans.push({ ref: `P${r.plans.length + 1}x`, assetRef: ref, work: c.work, fiscalYears: [...c.after] });
}
