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
import { createFakeConnect } from "./fake";
import { loadPackageBackend } from "./package";
import type { ConnectBackend, LicenseAnswer } from "./types";

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
}

/** 偽の連携を出す環境変数（試験の台だけ）。MOYAI_CONNECT_FAKE_LICENSE は、本番への書き込みの試験用の鍵がある host（, で区切る） */
export const CONNECT_FAKE_ENV = "MOYAI_CONNECT_FAKE";
export const CONNECT_FAKE_LICENSE_ENV = "MOYAI_CONNECT_FAKE_LICENSE";

export class ConnectService {
  private loaded: Promise<ConnectBackend | null> | null = null;

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
      return loadPackageBackend(this.e.stateDir).catch(() => null);
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
    if (!b) return { ok: true, enabled, available: false, fake: false, targets: [] };
    const targets = await Promise.all(b.store.list().map(async (t) => ({ ...t, write: await this.gate(b, t) })));
    return { ok: true, enabled, available: true, fake: b.fake, targets };
  }

  private async open(targetId: string) {
    if (!this.enabled()) return no("connectOff");
    const b = await this.backend();
    if (!b) return no("connectUnavailable");
    const o = b.store.open(targetId);
    if (!o) return no("connectTargetUnknown");
    const c = b.connectors[o.target.kind];
    if (!c) return no("connectKindUnknown");
    return { ok: true as const, b, c, ...o };
  }

  /** 読む：中間形を読み、作業の実績を取り込みの資料（CSV）にして返す。数だけを添える（値はログに出さない） */
  async read(targetId: string): Promise<{ ok: true; name: string; base64: string; counts: EamCounts; target: ConnectTarget; fake: boolean } | No> {
    const o = await this.open(targetId);
    if (!o.ok) return o;
    const r = await o.c.loadRecords(o.target, o.secret).catch(() => null);
    if (!r) return no("connectReadFailed");
    const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(this.e.now()));
    // 偽の連携の資料は【架空】（取り込みが架空の施設として扱う）
    const title = `${o.b.fake && !o.target.label.includes("【架空】") ? "【架空】" : ""}${o.target.label} 作業の実績（連携で読込）`;
    const csv = resultsCsv(r, title);
    return { ok: true, name: connectFileName(o.target.label, ymd), base64: Buffer.from(csv, "utf8").toString("base64"), counts: countsOf(r), target: o.target, fake: o.b.fake };
  }

  /** 書き込みの案：確定・署名した版の保全計画と、今のつなぎ先を突き合わせる。ハッシュは送るときに照らす */
  async plan(
    targetId: string,
    latest: LatestSigned,
  ): Promise<{ ok: true; target: ConnectTarget; version: number; rows: ConnectMatchRow[]; changes: EamWriteChange[]; counts: ReturnType<typeof planWrite>["counts"]; hash: string; write: WriteGate } | No> {
    const o = await this.open(targetId);
    if (!o.ok) return o;
    const current = await o.c.loadRecords(o.target, o.secret).catch(() => null);
    if (!current) return no("connectReadFailed");
    const desired = planLinesOfPlan(latest.plan);
    const view = planWrite(desired, planLinesOfRecords(current));
    // 書く中身は部品の planCommit の答え（偽の連携と芯は planWrite と同じ）
    const changes = o.c.planCommit(o.target, current, desired).changes;
    const hash = sha256Hex(writePlanText(o.target.id, latest.plan.planId, latest.version, changes));
    return { ok: true, target: o.target, version: latest.version, rows: view.rows, changes, counts: view.counts, hash, write: await this.gate(o.b, o.target) };
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
