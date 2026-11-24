// 連携の裏を束ねる（橋渡しの中だけ）：設定の「連携」のオンとオフ、つなぎ先の一覧、読む・書き込みの案・送る。
// - 読む・書き込みの案は、作業画面だけの経路（タブの秘密）と、AI の道具（作業画面を通る）から呼ぶ。送るのは人だけの経路（connect_send）だけ。
// - 本番への書き込みの鍵の確かめは、ここ（送る直前）で必ず通す。画面や AI の道具から飛ばせない。
// - 送る前に、つなぎ先を読み直して差分を作り直し、人が見た差分と同じとき（ハッシュ）だけ送る。1 件目（カナリア）を送って読み直し、届いたのを確かめてから残りを送る。
// - 通信の例外：行き先は、人が設定したつなぎ先の host だけ（部品の ConnectionStore が持つ）。偽の連携はどこにも通信しない。
// - API キー・行の値をログに出さない。誤りの中身（部品の例外の文）も画面と AI に返さない（理由の名前だけ）。
import { readSettings } from "../places";
import { sha256Hex } from "../../share/sign";
import { connectFileName, countsOf, planLinesOfPlan, planLinesOfRecords, planWrite, resultsCsv, writePlanText, type ConnectMatchRow, type ConnectTarget, type EamCounts, type EamWriteChange } from "../../shared/connect";
import type { Plan } from "../../shared/plan";
import { createDemoMaximo, demoSeedPacks, readDemoSeed, DEMO_TARGET_ID, type DemoMaximo } from "./demo";
import { createFakeConnect } from "./fake";
import { importEamPackage, loadPackageBackend, type EamPackage } from "./package";
import type { ConnectAddInput, ConnectBackend, LicenseAnswer } from "./types";

export type { ConnectBackend } from "./types";

type No = { ok: false; reason: string };
const no = (reason: string): No => ({ ok: false, reason });

/** 書き込みの許し：テスト環境は無償、本番はその host の有効な鍵が要る */
export type WriteGate = { needed: false } | { needed: true; ok: true } | { needed: true; ok: false; reason: Extract<LicenseAnswer, { ok: false }>["reason"] };

export interface ConnectStateOut {
  ok: true;
  enabled: boolean;
  /** 連携の裏があるか（部品か偽の連携）。無ければ、つなぎ先を出さない */
  available: boolean;
  fake: boolean;
  targets: (ConnectTarget & { write: WriteGate })[];
}

export interface LatestSigned {
  version: number;
  plan: Plan;
}

export interface ConnectServiceEnv {
  stateDir: string;
  env?: NodeJS.ProcessEnv;
  now: () => number;
  /** 試験が連携の裏を差し替える（null なら連携の裏なし）。無ければ環境変数と部品から決める */
  backend?: ConnectBackend | null;
  /** Skillパックの置き場（デモの架空の Maximo の中身 demo/maximo.json を読む） */
  packsDir?: string;
  /** デモの架空の Maximo に使う部品と /testing（試験が差し替える。null なら芯のメモリの架空の Maximo）。無ければ部品から読む */
  demoPackage?: { pkg: EamPackage; testing: unknown } | null;
}

/** デモの架空の Maximo を足した答え */
export type DemoOut = { ok: true; target: ConnectTarget; added: boolean; counts: EamCounts; viaPackage: boolean };

/** 偽の連携を出す環境変数（試験の台だけ）。MOYAI_CONNECT_FAKE_LICENSE は、本番への書き込みの試験用の鍵がある host（, で区切る） */
export const CONNECT_FAKE_ENV = "MOYAI_CONNECT_FAKE";
export const CONNECT_FAKE_LICENSE_ENV = "MOYAI_CONNECT_FAKE_LICENSE";
/** "off" なら部品を読まない（試験が、利用者の ~/.config/mxstage を読まないように。vitest と e2e が置く。受け口の MOYAI_LEDGER_INTAKE_URL=off と同じ形） */
export const CONNECT_PACKAGE_ENV = "MOYAI_CONNECT_PACKAGE";

export class ConnectService {
  private loaded: Promise<ConnectBackend | null> | null = null;
  /** デモの架空の Maximo（橋渡しのメモリだけ。AI の道具 connect_demo が足す） */
  private demo: DemoMaximo | null = null;

  constructor(private readonly e: ConnectServiceEnv) {}

  /** 連携の裏（1 回だけ決める） */
  backend(): Promise<ConnectBackend | null> {
    if (this.e.backend !== undefined) return Promise.resolve(this.e.backend);
    this.loaded ??= (async () => {
      const env = this.e.env ?? process.env;
      if (env[CONNECT_FAKE_ENV] === "1") {
        const hosts = (env[CONNECT_FAKE_LICENSE_ENV] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
        return createFakeConnect({ licensedHosts: hosts }).backend;
      }
      if (env[CONNECT_PACKAGE_ENV] === "off") return null;
      // 接続とライセンスの置き場所は部品の既定（~/.config/mxstage。MX Stage と共有）。MOYAI の状態フォルダは使わない
      return loadPackageBackend({ env }).catch(() => null);
    })();
    return this.loaded;
  }

  /** 設定の「連携」がオンか（人だけの経路 settings_save で置く） */
  enabled(): boolean {
    return readSettings(this.e.stateDir).connect === true;
  }

  private async gate(b: ConnectBackend, t: ConnectTarget): Promise<WriteGate> {
    if (t.env !== "production") return { needed: false };
    const a = await b.license.authorize(t.host).catch((): LicenseAnswer => ({ ok: false, reason: "noKey" }));
    return a.ok ? { needed: true, ok: true } : { needed: true, ok: false, reason: a.reason };
  }

  /** 設定と HOSHITORI に出すもの：オンか・裏があるか・つなぎ先（キーは無い）と、書き込みの許し */
  async state(): Promise<ConnectStateOut> {
    const b = await this.backend();
    const enabled = this.enabled();
    // デモの架空の Maximo はテスト環境（書き込みの鍵は要らない）
    const demo = this.demo ? [{ ...this.demo.target, write: { needed: false } as const }] : [];
    // 部品が無くても、デモの架空の Maximo を足せるなら連携の欄は出す（人がオンにしてから AI が connect_demo で足す）
    if (!b) return { ok: true, enabled, available: demo.length > 0 || this.demoPossible(), fake: false, targets: demo };
    const targets = await Promise.all(b.store.list().map(async (t) => ({ ...t, write: await this.gate(b, t) })));
    return { ok: true, enabled, available: true, fake: b.fake, targets: [...targets, ...demo] };
  }

  private async open(targetId: string) {
    if (!this.enabled()) return no("connectOff");
    // デモの架空の Maximo（通信しない。本物のつなぎ先の保存には無い）
    if (targetId === DEMO_TARGET_ID) {
      const d = this.demo;
      if (!d) return no("connectTargetUnknown");
      const b: ConnectBackend = { fake: true, store: { list: () => [d.target], open: () => ({ target: d.target, secret: d.secret }) }, connectors: { maximo: d.connector }, license: { authorize: async () => ({ ok: false, reason: "noKey" }) } };
      return { ok: true as const, b, c: d.connector, demo: d, target: d.target, secret: d.secret };
    }
    const b = await this.backend();
    if (!b) return no("connectUnavailable");
    const o = b.store.open(targetId);
    if (!o) return no("connectTargetUnknown");
    const c = b.connectors[o.target.kind];
    if (!c) return no("connectKindUnknown");
    return { ok: true as const, b, c, demo: null, ...o };
  }

  /**
   * デモの架空の Maximo を、テスト環境のつなぎ先として足す（AI の道具 connect_demo）。架空・通信なし・鍵なし。
   * 連携がオフなら断る（オンにするのは人だけ）。もうあれば、そのまま返す（reset なら中身を初めに戻す）
   */
  async addDemo(o: { pack?: string; reset?: boolean } = {}): Promise<DemoOut | No> {
    if (!this.enabled()) return no("connectOff");
    if (this.demo && !o.reset) return { ok: true, target: this.demo.target, added: false, counts: countsOf(await this.demo.connector.loadRecords(this.demo.target, this.demo.secret)), viaPackage: this.demo.viaPackage };
    const packsDir = this.e.packsDir;
    const pack = o.pack ?? (packsDir ? demoSeedPacks(packsDir)[0] : undefined);
    const seed = packsDir && pack ? readDemoSeed(packsDir, pack) : null;
    if (!seed) return no("connectDemoMissing");
    const p = this.e.demoPackage !== undefined ? this.e.demoPackage : await demoPackage();
    const d = createDemoMaximo(seed, p ? { pkg: p.pkg, testing: p.testing } : {});
    this.demo = d;
    return { ok: true, target: d.target, added: true, counts: countsOf(await d.connector.loadRecords(d.target, d.secret)), viaPackage: d.viaPackage };
  }

  /** デモの架空の Maximo の中身のある Skillパックがあるか */
  private demoPossible(): boolean {
    return !!this.e.packsDir && demoSeedPacks(this.e.packsDir).length > 0;
  }

  /** デモの架空の Maximo（試験が、届いた要求と書いた回数を見る） */
  demoMaximo(): DemoMaximo | null {
    return this.demo;
  }

  /** 読む：中間形を読み、作業の実績を取り込みの資料（CSV）にして返す。数だけを添える（値はログに出さない） */
  async read(targetId: string): Promise<{ ok: true; name: string; base64: string; counts: EamCounts; target: ConnectTarget; fake: boolean; demo: boolean } | No> {
    const o = await this.open(targetId);
    if (!o.ok) return o;
    const r = await o.c.loadRecords(o.target, o.secret).catch(() => null);
    if (!r) return no("connectReadFailed");
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(this.e.now()));
    // 偽の連携の資料は【架空】（取り込みが架空の施設として扱う）
    const title = `${o.b.fake && !o.target.label.includes("【架空】") ? "【架空】" : ""}${o.target.label} 作業の実績（連携で読込）`;
    const csv = resultsCsv(r, title);
    return { ok: true, name: connectFileName(o.target.label, ymd), base64: Buffer.from(csv, "utf8").toString("base64"), counts: countsOf(r), target: o.target, fake: o.b.fake, demo: o.demo !== null };
  }

  /** 書き込みの案：確定・署名した版の保全計画と、今のつなぎ先を突き合わせる。ハッシュは送るときに照らす */
  async plan(
    targetId: string,
    latest: LatestSigned,
  ): Promise<{ ok: true; target: ConnectTarget; version: number; rows: ConnectMatchRow[]; changes: EamWriteChange[]; counts: ReturnType<typeof planWrite>["counts"]; hash: string; write: WriteGate } | No> {
    const o = await this.open(targetId);
    if (!o.ok) return o;
    const desired = planLinesOfPlan(latest.plan);
    // デモの架空の Maximo は、現場の Maximo にもうある施設の資産の木の代わりに、確定した版の資産の道を資産の木に持つ
    if (o.demo) o.demo.align(desired.map((l) => l.assetPath));
    const current = await o.c.loadRecords(o.target, o.secret).catch(() => null);
    if (!current) return no("connectReadFailed");
    const view = planWrite(desired, planLinesOfRecords(current));
    // 書く中身は部品の planCommit の答え（偽の連携と芯は planWrite と同じ）。書けない変更が 1 つでもあれば、差分ごと止めて人に返す
    const pc = o.c.planCommit(o.target, current, desired);
    if ((pc.unwritable ?? 0) > 0) return no("connectUnwritable");
    const changes = pc.changes;
    const hash = sha256Hex(writePlanText(o.target.id, latest.plan.planId, latest.version, changes));
    return { ok: true, target: o.target, version: latest.version, rows: view.rows, changes, counts: view.counts, hash, write: await this.gate(o.b, o.target) };
  }

  /** つなぎ先を足す（人だけの経路 connect_add からだけ呼ぶ）。API キーは裏に渡して捨てる（返さない・ログに出さない） */
  async add(input: ConnectAddInput): Promise<{ ok: true; target: ConnectTarget } | No> {
    if (!this.enabled()) return no("connectOff");
    const b = await this.backend();
    if (!b) return no("connectUnavailable");
    if (!b.store.add) return no("connectAdd.unsupported");
    const r = await b.store.add(input).catch(() => ({ ok: false as const, problem: "unavailable" as const }));
    return r.ok ? { ok: true, target: r.target } : no(`connectAdd.${r.problem}`);
  }

  /**
   * 送る（人だけの経路 connect_send からだけ呼ぶ）：差分を作り直して人が見たものと照らし、本番なら鍵を確かめ、
   * 1 件目を送って読み直して届いたのを確かめてから、残りを送る
   */
  async send(targetId: string, latest: LatestSigned, seenHash: string): Promise<{ ok: true; applied: number; target: ConnectTarget } | (No & { applied?: number })> {
    const p = await this.plan(targetId, latest);
    if (!p.ok) return p;
    if (p.hash !== seenHash) return no("connectStale");
    // 鍵の確かめは、画面の見せ方によらず、送る直前にここで必ず通す
    if (p.write.needed && !p.write.ok) return no(`connectLicense.${p.write.reason}`);
    if (p.changes.length === 0) return no("connectNothing");
    const o = await this.open(targetId);
    if (!o.ok) return o;
    // 本番なら、書く直前にもう一度その host の鍵を確かめる（部品の LicenseStore.authorize。部品の /mx の writeGuard には頼らない）
    if (o.target.env === "production") {
      const a = await o.b.license.authorize(o.target.host).catch((): LicenseAnswer => ({ ok: false, reason: "noKey" }));
      if (!a.ok) return no(`connectLicense.${a.reason}`);
    }
    const [canary, ...rest] = p.changes;
    const first = await o.c.executeCommit(o.target, o.secret, [canary!]).catch(() => null);
    if (!first || first.applied !== 1) return { ...no("connectWriteFailed"), applied: 0 };
    const back = await o.c.loadRecords(o.target, o.secret).catch(() => null);
    const landed = back ? planLinesOfRecords(back).find((l) => l.key === canary!.key) : undefined;
    if (!landed || JSON.stringify(landed.fiscalYears) !== JSON.stringify(canary!.after)) return { ...no("connectCanaryFailed"), applied: 1 };
    if (!rest.length) return { ok: true, applied: 1, target: o.target };
    const done = await o.c.executeCommit(o.target, o.secret, rest).catch(() => null);
    if (!done) return { ...no("connectWriteFailed"), applied: 1 };
    return { ok: true, applied: 1 + done.applied, target: o.target };
  }
}

/** デモの架空の Maximo に使う部品と、その /testing（偽の Maximo）。どちらかが無ければ null（芯のメモリの架空の Maximo を使う） */
async function demoPackage(): Promise<{ pkg: EamPackage; testing: unknown } | null> {
  const pkg = await importEamPackage();
  if (!pkg) return null;
  const name = "@mxstage/eam-connectors/testing";
  const testing: unknown = await import(/* @vite-ignore */ name).catch(() => null);
  return testing ? { pkg, testing } : null;
}
