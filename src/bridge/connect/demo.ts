// デモの架空の Maximo（運営者の困りごと 2026-11-24「Maximo との連携のデモができない」）。橋渡しのメモリの中だけにあり、どこにも通信しない。
// - つなぎ先は 1 つ（テスト環境・鍵なし）。行き先は予約のオリジン（DEMO_ORIGIN。.invalid は DNS に出ない。RFC 2606）だけで、
//   部品の MaximoClient に渡す fetch が、ほかのオリジンへの要求を送る前に断る。橋渡しの網（globalThis.fetch）は使わない。
// - 部品（@mxstage/eam-connectors）と、その /testing の偽の Maximo（createFakeMaximo）があれば、それを本物のつなぎ先と同じ
//   Maximo の読み書き（package.ts の maximoConnector）で読む・書く。無ければ、芯のメモリの中の架空の Maximo で同じ形を読む・書く。
// - 中身は Skillパックの demo/maximo.json（【架空】の施設に合う資産・PM・作業の実績）。AI の道具 connect_demo が足す
//   （架空・通信なし・鍵なしなので AI がしてよい。本物のつなぎ先を足すのは今までどおり人だけ：connect_add）。
// - 現場の Maximo には施設の資産の木がもうある。その代わりに、書き込みの案を作る前に、確定した版の資産の道を架空の Maximo の資産の木に足す（align）。
// - 状態フォルダにも部品の接続の保存（~/.config/mxstage）にも書かない。橋渡しを起こし直すと消える（もう一度 connect_demo で足す）。
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { CONNECT_PATH_SEP, planLinesOfRecords, planWrite, type ConnectTarget, type EamRecords, type PlanLine } from "../../shared/connect";
import { applyChange } from "./fake";
import { fiscalYearStart, maximoConnector, type EamPackage, type FetchLike } from "./package";
import type { ConnectSecret, EamConnector } from "./types";

export const DEMO_TARGET_ID = "demo-maximo";
/** 予約のホスト（.invalid は DNS に出ない） */
export const DEMO_HOST = "demo-maximo.moyai.invalid";
export const DEMO_ORIGIN = `https://${DEMO_HOST}`;
/** Skillパックの demo/ の中の、架空の Maximo の中身 */
export const DEMO_SEED_FILE = "maximo.json";
/** 偽の Maximo が要求に求める合言葉（本物の鍵ではない。どこにも保存しない） */
const DEMO_PASS = "moyai-demo-fictional-maximo";

/** 予約のオリジン（https://demo-maximo.moyai.invalid）か */
export function isDemoOrigin(url: string): boolean {
  try {
    const u = new URL(url);
    return u.origin === DEMO_ORIGIN && !u.username && !u.password;
  } catch {
    return false;
  }
}

const path = z.string().min(1).max(400);
const seedSchema = z
  .object({
    v: z.literal("moyai.connect-demo/0"),
    /** つなぎ先の名前（【架空】の印が要る） */
    label: z.string().min(1).max(80).refine((s) => s.includes("【架空】")),
    site: z.string().regex(/^[A-Z0-9]{1,8}$/),
    /** 資産の道（上から「 › 」でつなぐ） */
    assets: z.array(path).max(500),
    plans: z.array(z.object({ asset: path, work: z.string().min(1).max(100), fiscalYears: z.array(z.number().int().min(2000).max(2100)).min(1).max(50) }).strict()).max(500),
    results: z.array(z.object({ asset: path, work: z.string().min(1).max(100), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict()).max(2000),
  })
  .strict();
export type DemoSeed = z.infer<typeof seedSchema>;

/** demo/maximo.json のあるパック（名前の順） */
export function demoSeedPacks(packsDir: string): string[] {
  try {
    return readdirSync(packsDir)
      .filter((d) => /^[a-z][a-z0-9-]{0,63}$/.test(d) && existsSync(join(packsDir, d, "demo", DEMO_SEED_FILE)))
      .sort();
  } catch {
    return [];
  }
}

/** パックの架空の Maximo の中身。無い・形が違えば null */
export function readDemoSeed(packsDir: string, pack: string): DemoSeed | null {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(pack)) return null;
  try {
    const p = seedSchema.safeParse(JSON.parse(readFileSync(join(packsDir, pack, "demo", DEMO_SEED_FILE), "utf8")));
    return p.success ? p.data : null;
  } catch {
    return null;
  }
}

/** 道と、その上の節の道（上から） */
function prefixes(p: string): string[] {
  const names = p.split(CONNECT_PATH_SEP).map((s) => s.trim());
  return names.map((_, i) => names.slice(0, i + 1).join(CONNECT_PATH_SEP));
}
const lastName = (p: string) => p.split(CONNECT_PATH_SEP).at(-1)!.trim();
const parentPath = (p: string) => {
  const names = p.split(CONNECT_PATH_SEP);
  return names.length > 1 ? names.slice(0, -1).join(CONNECT_PATH_SEP) : null;
};

export interface DemoMaximo {
  target: ConnectTarget;
  /** 部品の偽の Maximo で読み書きするか（false なら芯のメモリの架空の Maximo） */
  viaPackage: boolean;
  connector: EamConnector;
  secret: ConnectSecret;
  /** 資産の木に、この道（と上の節）を足す（現場の Maximo にはもうある施設の資産の木の代わり） */
  align(paths: readonly string[]): void;
  /** 架空の Maximo に向けた要求の URL（部品の道だけ。試験が予約のオリジンにしか行かないことを確かめる） */
  requests(): readonly string[];
  /** 書いた回数 */
  writes(): number;
}

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Attrs = Record<string, string | number | boolean | null>;

const s = (o: Record<string, string>) => Object.fromEntries(Object.entries(o).map(([k, t]) => [k, { type: t }]));
/** 部品が読む 4 つの構造（資産・場所・PM・作業指示）の形（tests/helpers/fake-maximo.ts の maximoSeed と同じ） */
const STRUCTURES = {
  MXAPIASSET: { keyAttrs: ["assetnum", "siteid"], attrs: s({ assetnum: "string", siteid: "string", description: "string", status: "string", parent: "string", location: "string", assettype: "string" }) },
  MXAPIOPERLOC: {
    keyAttrs: ["location", "siteid"],
    attrs: s({ location: "string", siteid: "string", description: "string", status: "string", type: "string" }),
    children: { lochierarchy: { idAttr: "systemid", attrs: s({ parent: "string", systemid: "string" }) } },
  },
  MXAPIPM: {
    keyAttrs: ["pmnum", "siteid"],
    attrs: { ...s({ pmnum: "string", siteid: "string", description: "string", status: "string", assetnum: "string", location: "string", jpnum: "string", frequnit: "string" }), frequency: { type: "integer" }, nextdate: { type: "datetime" } },
  },
  MXAPIWODETAIL: {
    keyAttrs: ["wonum", "siteid"],
    attrs: {
      ...s({ wonum: "string", siteid: "string", description: "string", status: "string", worktype: "string", assetnum: "string", location: "string", pmnum: "string", jpnum: "string" }),
      schedstart: { type: "datetime" },
      actstart: { type: "datetime" },
      actfinish: { type: "datetime" },
      actlabhrs: { type: "number" },
    },
  },
} as const;
type Os = keyof typeof STRUCTURES;
const OSES = Object.keys(STRUCTURES) as Os[];

function objectStructures(records: Record<Os, Attrs[]>): Any {
  return Object.fromEntries(OSES.map((os) => [os, { ...STRUCTURES[os], records: records[os].map((attrs) => ({ attrs })) }]));
}

/** 資産の木（道 → 番号）。足した節を返す */
class Tree {
  readonly num = new Map<string, string>();
  constructor(private readonly site: string) {}
  add(p: string): { path: string; num: string; parent: string | null }[] {
    const added: { path: string; num: string; parent: string | null }[] = [];
    for (const q of prefixes(p)) {
      if (this.num.has(q)) continue;
      const n = `${this.site}${String(this.num.size + 1).padStart(4, "0")}`;
      this.num.set(q, n);
      const pp = parentPath(q);
      added.push({ path: q, num: n, parent: pp === null ? null : this.num.get(pp)! });
    }
    return added;
  }
}

/**
 * デモの架空の Maximo を作る。pkg と testing（部品と、その /testing）があれば部品の偽の Maximo、無ければ芯のメモリの架空の Maximo
 */
export function createDemoMaximo(seed: DemoSeed, o: { pkg?: EamPackage | null; testing?: Any | null } = {}): DemoMaximo {
  const target: ConnectTarget = { id: DEMO_TARGET_ID, label: seed.label, kind: "maximo", host: DEMO_HOST, env: "test" };
  const secret: ConnectSecret = { opaque: "demo" };
  const all = [...seed.assets, ...seed.plans.map((p) => p.asset), ...seed.results.map((r) => r.asset)];
  return o.pkg && o.testing?.createFakeMaximo ? viaPackage(seed, target, secret, all, o.pkg, o.testing) : inMemory(seed, target, secret, all);
}

function viaPackage(seed: DemoSeed, target: ConnectTarget, secret: ConnectSecret, all: string[], pkg: EamPackage, testing: Any): DemoMaximo {
  const tree = new Tree(seed.site);
  const assetRow = (a: { path: string; num: string; parent: string | null }): Attrs => ({ assetnum: a.num, siteid: seed.site, description: lastName(a.path), ...(a.parent ? { parent: a.parent } : {}) });
  const assets = all.flatMap((p) => tree.add(p)).map(assetRow);
  let pm = 0;
  const pms = seed.plans.flatMap((p) =>
    p.fiscalYears.map((fy): Attrs => ({ pmnum: `${seed.site}PM${String(++pm).padStart(3, "0")}`, siteid: seed.site, description: p.work, assetnum: tree.num.get(p.asset)!, nextdate: fiscalYearStart(fy) })),
  );
  const wos = seed.results.map((r, i): Attrs => ({ wonum: `${seed.site}WO${String(i + 1).padStart(3, "0")}`, siteid: seed.site, description: r.work, assetnum: tree.num.get(r.asset)!, actfinish: `${r.date}T17:00:00+09:00` }));
  const make = (records: Record<Os, Attrs[]>) => testing.createFakeMaximo({ objectStructures: objectStructures(records), baseUrl: DEMO_ORIGIN, apiKey: DEMO_PASS });
  let fake: Any = make({ MXAPIASSET: assets, MXAPIOPERLOC: [], MXAPIPM: pms, MXAPIWODETAIL: wos });
  let writesBefore = 0;
  const requests: string[] = [];
  // 予約のオリジンのほかへは、要求を作る前に断る（本物の Maximo・ほかの host にはつながない）
  const fetchImpl: FetchLike = async (input, init) => {
    requests.push(input);
    if (!isDemoOrigin(input)) throw new Error("demo: not the demo origin");
    return fake.fetch(input, init);
  };
  const connector = maximoConnector(pkg, async () => new pkg.main.MaximoClient({ baseUrl: DEMO_ORIGIN, apiKey: () => DEMO_PASS, via: "direct", fetchImpl }));
  /** 今の偽の Maximo の行（型にある欄だけ） */
  const current = (os: Os): Attrs[] => {
    const keys = Object.keys(STRUCTURES[os].attrs);
    return ((fake.records(os) ?? []) as { attrs: Attrs }[]).map((r) => Object.fromEntries(keys.filter((k) => r.attrs[k] !== undefined && r.attrs[k] !== null).map((k) => [k, r.attrs[k]!])));
  };
  return {
    target,
    viaPackage: true,
    connector,
    secret,
    align: (paths) => {
      const added = paths.flatMap((p) => tree.add(p));
      if (!added.length) return;
      // 偽の Maximo に資産を足す：今の行（書いた PM も）を写して作り直す
      writesBefore += Number(fake.writeCount?.() ?? 0);
      fake = make({ MXAPIASSET: [...current("MXAPIASSET"), ...added.map(assetRow)], MXAPIOPERLOC: current("MXAPIOPERLOC"), MXAPIPM: current("MXAPIPM"), MXAPIWODETAIL: current("MXAPIWODETAIL") });
    },
    requests: () => requests,
    writes: () => writesBefore + Number(fake.writeCount?.() ?? 0),
  };
}

function inMemory(seed: DemoSeed, target: ConnectTarget, secret: ConnectSecret, all: string[]): DemoMaximo {
  const tree = new Tree(seed.site);
  const r: EamRecords = { assets: [], plans: [], results: [] };
  const addAll = (paths: readonly string[]) => {
    for (const a of paths.flatMap((p) => tree.add(p))) r.assets.push({ ref: a.num, parentRef: a.parent, name: lastName(a.path), tag: null });
  };
  addAll(all);
  seed.plans.forEach((p, i) => r.plans.push({ ref: `PM${i + 1}`, assetRef: tree.num.get(p.asset)!, work: p.work, fiscalYears: [...p.fiscalYears].sort((a, b) => a - b) }));
  seed.results.forEach((x, i) => r.results.push({ ref: `WO${i + 1}`, assetRef: tree.num.get(x.asset)!, work: x.work, date: x.date.replace(/-/g, "/"), manDays: null }));
  let writes = 0;
  const connector: EamConnector = {
    loadRecords: async () => JSON.parse(JSON.stringify(r)) as EamRecords,
    // 部品の道と同じく、資産の木に無い資産の変更は書かない（unwritable。橋渡しは差分ごと止める）
    planCommit: (_t, current, desired: readonly PlanLine[]) => {
      const changes = planWrite(desired, planLinesOfRecords(current)).changes;
      return { changes, unwritable: changes.filter((c) => !tree.num.has(c.assetPath)).length };
    },
    executeCommit: async (_t, _s, changes) => {
      for (const c of changes) {
        applyChange(r, c);
        writes++;
      }
      return { applied: changes.length };
    },
  };
  return { target, viaPackage: false, connector, secret, align: addAll, requests: () => [], writes: () => writes };
}
