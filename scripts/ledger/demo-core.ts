// 公開の台帳のデモの束を作る道具の芯（docs/plan.md §2.5・§2.8、docs/sharing.md §6）。scripts/ledger/build-bundles.mjs が呼ぶ。
// - 架空の 10 施設の正解の世界（samples/truth/<pack>/ledger-NN/world.json。工場の samples/factory/ledger_worlds.py が組む）から、
//   取り込みを通さずに計画を直接書き（truth-plan.mjs）、本物の写し取り・数え直し・封（previewBundle・sealBundle）で束にする。
//   固有名詞の網（施設名・業者）も本物の関数（properNounSources・countProperNouns）が封の中で照らす。
// - 台帳の決まり（ledger.json）と各施設の鍵は、走らせるたびに作る。秘密鍵は状態のフォルダ（一時のフォルダ）にだけ書き、出す台帳には書かない。
// - わざと外れた束（PR で ✗ になることを示すため）を 3 つ作る：k < 5・費用の欄・施設名。どれも本物の署名の関数で署名し、
//   外れは中身だけにする（道と鎖は正しい）。封はこれらに署名しないので、body を手で作って signBody で署名する。
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { planFromWorld } from "./truth-plan.mjs";
import { LEDGER_V, bundleFileName, envelopeText, fileHash, makeRulesDocBody, ringIdOf, type ShareContext } from "../../src/share/bundle";
import { properNounSources } from "../../src/share/checkpoint";
import { kNational } from "../../src/share/k";
import { LEDGER_DIR, LEDGER_FILE, ledgerContext, verifyLedgerFiles, type LedgerFile, type LedgerRead } from "../../src/share/ledger";
import { loadSharePack, type SharePack } from "../../src/share/pack";
import { baseRules, type Rules } from "../../src/share/rules";
import { previewBundle, sealBundle, type SendInput } from "../../src/share/seal";
import { fingerprint, generateKeyPair, keyIdOf, sha256Hex, signBody, type KeyPair } from "../../src/share/sign";
import { Plan } from "../../src/shared/plan";

export const DEMO_PACK = "waste-incineration";
/** 台帳の決まりの欄：間隔・工数・日数（コードの許可リストのすべて。経過年はどこにも出さないので、許可リストにも無い） */
export const DEMO_FIELDS: Rules["fields"] = ["interval", "manDays", "days"];

export interface DemoInput {
  /** リポジトリの根（samples/ と packs/ がある所） */
  repo: string;
  /** 出す台帳のリポジトリの根（ledger/ を作る。空のフォルダか無いフォルダ） */
  out: string;
  /** 状態のフォルダ（秘密鍵と、施設と鍵の対応を書く。一時のフォルダ） */
  state: string;
  /** 送った月（束の month） */
  month: string;
  /** わざと外れた束を書くフォルダ（無ければ作らない） */
  rejects?: string;
  /** 前に作った ledger.json を使う（管理者の鍵は要らない） */
  ledgerJson?: string;
}

export interface DemoFacility {
  id: string;
  key: string;
  fingerprint: string;
  path: string;
  profile: unknown;
  k: number;
  chunks: number;
}

export interface DemoReject {
  case: "kBelow5" | "costField" | "facilityName";
  key: string;
  path: string;
  reasons: string[];
}

export interface DemoResult {
  ledgerId: string;
  ledgerHash: string;
  facilities: DemoFacility[];
  rejects: DemoReject[];
  read: LedgerRead;
}

function pem(k: KeyPair): string {
  return k.privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

/** 秘密鍵を状態のフォルダに書く（出す台帳には書かない） */
function keepKey(state: string, name: string, k: KeyPair): void {
  mkdirSync(join(state, "keys"), { recursive: true });
  writeFileSync(join(state, "keys", `${name}.pem`), pem(k), { encoding: "utf8", mode: 0o600, flag: "wx" });
}

function writeBundle(root: string, key: string, fileName: string, text: string): string {
  const dir = join(root, LEDGER_DIR, "bundles", key);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fileName), text, { encoding: "utf8", flag: "wx" });
  return `${LEDGER_DIR}/bundles/${key}/${fileName}`;
}

function readTree(root: string): LedgerFile[] {
  const out: LedgerFile[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(p, r);
      else if (e.isFile()) out.push({ path: r, kind: "file", bytes: new Uint8Array(readFileSync(p)) });
    }
  };
  walk(join(root, LEDGER_DIR), LEDGER_DIR);
  return out;
}

/** 架空の施設の正解の世界（ledger-NN）の一覧 */
export function demoWorlds(repo: string): { id: string; world: { facility: { answers: Record<string, string>; capacity_t_per_day: number; name: string } } }[] {
  const base = join(repo, "samples", "truth", DEMO_PACK);
  return readdirSync(base, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^ledger-\d{2}$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((id) => ({ id, world: JSON.parse(readFileSync(join(base, id, "world.json"), "utf8")) }));
}

function sendInputOf(ctx: ShareContext, pack: SharePack, plan: Plan, answers: Record<string, string>, pub: string, month: string): SendInput {
  return { ctx, plan, spec: pack.spec, facility: answers, group: "NATIONAL", pub, seq: 1, prev: null, month };
}

/**
 * 本物の写し取りと封で 1 施設の束を作る（鍵はメモリの中だけ。どこにも書かない）。
 * 固有名詞の網が照らす置き場所の道は、台帳で人に見える道（ledger/bundles/<鍵ID>）にする（手元の clone の道は公開されない）。
 */
function sealFacility(ctx: ShareContext, rules: Rules, pack: SharePack, plan: Plan, answers: Record<string, string>, pair: KeyPair, month: string) {
  const folderPath = `${LEDGER_DIR}/bundles/${keyIdOf(pair.pub)}`;
  const input = sendInputOf(ctx, pack, plan, answers, pair.pub, month);
  const pv = previewBundle(input);
  if (!pv.ok) throw new Error(`プレビューができない（${pv.reason}）`);
  const words = properNounSources(plan);
  const s = sealBundle(input, {
    previewHash: pv.bodyHash,
    pair,
    acceptedRulesHash: ctx.rulesHash,
    acceptedRules: rules,
    localWords: words.localWords,
    cells: words.cells,
    folderPath,
  });
  if (!s.ok) throw new Error(`封ができない（${s.reason}）`);
  return { pv, s };
}

/** わざと外れた束：正しい束の body を書き換え、本物の署名の関数で署名する */
function forged(body: Record<string, unknown>, pair: KeyPair): { text: string; fileName: string } {
  const text = envelopeText(body, signBody(body, pair.privateKey));
  return { text, fileName: bundleFileName(body.seq as number, fileHash(text)) };
}

export function buildLedgerDemo(i: DemoInput): DemoResult {
  if (existsSync(join(i.out, LEDGER_DIR))) throw new Error(`出す先にもう ${LEDGER_DIR}/ がある（足すだけの台帳を上書きしない）`);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month)) throw new Error("月の形でない（YYYY-MM）");
  const p = loadSharePack(join(i.repo, "packs"), DEMO_PACK);
  if (!p.ok) throw new Error(`Skillパックを読めない（${p.reason}）`);
  const pack = p.pack;
  mkdirSync(i.state, { recursive: true });

  // 台帳の決まり（管理者の鍵で署名）。前の ledger.json があればそれを使う
  let ledgerText: string;
  if (i.ledgerJson) ledgerText = readFileSync(i.ledgerJson, "utf8");
  else {
    const admin = generateKeyPair();
    keepKey(i.state, "ledger-admin", admin);
    const rules: Rules = { ...baseRules(pack.vocab.pack, pack.vocab.hash, pack.table.hash), fields: [...DEMO_FIELDS] };
    const body = makeRulesDocBody(LEDGER_V, admin.pub, randomBytes(16).toString("hex"), 1, i.month, rules);
    ledgerText = envelopeText(body, signBody(body, admin.privateKey));
  }
  const ctx = ledgerContext(Buffer.from(ledgerText, "utf8"), pack);
  if (!ctx) throw new Error("ledger.json を読めない");
  const rules = ctx.rules;
  mkdirSync(join(i.out, LEDGER_DIR), { recursive: true });
  writeFileSync(join(i.out, LEDGER_DIR, LEDGER_FILE), ledgerText, { encoding: "utf8", flag: "wx" });

  const facilities: DemoFacility[] = [];
  const firstPlans: { id: string; plan: Plan; answers: Record<string, string> }[] = [];
  for (const { id, world } of demoWorlds(i.repo)) {
    const plan = Plan.parse(planFromWorld(world, { scale: world.facility.capacity_t_per_day, scaleUnit: "t/日" }));
    const pair = generateKeyPair();
    const key = keyIdOf(pair.pub);
    keepKey(i.state, `${id}-${key}`, pair);
    const { pv, s } = sealFacility(ctx, rules, pack, plan, world.facility.answers, pair, i.month);
    const path = writeBundle(i.out, key, s.fileName, s.text);
    facilities.push({ id, key, fingerprint: fingerprint(pair.pub), path, profile: pv.body.profile, k: pv.body.counts.k, chunks: pv.body.chunks.length });
    firstPlans.push({ id, plan, answers: world.facility.answers });
  }

  // わざと外れた束（それぞれ新しい鍵の連番 1。外れは中身だけ）
  const rejects: DemoReject[] = [];
  if (i.rejects) {
    const src = firstPlans[0]!;
    const make = (c: DemoReject["case"], edit: (body: Record<string, unknown>) => void) => {
      const pair = generateKeyPair();
      const key = keyIdOf(pair.pub);
      keepKey(i.state, `reject-${c}-${key}`, pair);
      const { s } = sealFacility(ctx, rules, pack, src.plan, src.answers, pair, i.month);
      const body = JSON.parse(s.text).body as Record<string, unknown>;
      edit(body);
      const f = forged(body, pair);
      const root = join(i.rejects!, c);
      const path = writeBundle(root, key, f.fileName, f.text);
      // 台帳に足したときの理由（受け手と同じ関数）
      const read = verifyLedgerFiles([...readTree(i.out), { path, kind: "file", bytes: Buffer.from(f.text, "utf8") }], pack);
      rejects.push({ case: c, key, path, reasons: read.bundles.find((b) => b.path === path)!.reasons });
    };
    // k < 5：全国の表で 3 施設しかない見え方（送る側の k も数え直しと同じ値にして、外れを「下限に届かない」だけにする）
    make("kBelow5", (body) => {
      const axes = { furnace: "STOKER", capacity_t_per_day: "C100_200", turbine: "YES", ash: "CEMENT", contract: "SINGLE" };
      (body.profile as Record<string, unknown>).axes = axes;
      const classes = [...new Set((body.chunks as { class: string }[]).map((c) => c.class))];
      (body.counts as Record<string, unknown>).k = kNational(pack.table, pack.vocab, axes, classes, 0);
    });
    // 費用の欄（帯にもしない欄を、塊に足す）
    make("costField", (body) => {
      (body.chunks as Record<string, unknown>[])[0]!.cost = "1,200,000円";
    });
    // 施設名（body に名前の欄を足す。架空の施設の名前）
    make("facilityName", (body) => {
      body.facility = src.plan.facility.name;
    });
  }

  const read = verifyLedgerFiles(readTree(i.out), pack);
  const manifest = {
    note: "【架空】公開の台帳のデモの状態。秘密鍵（keys/）と、架空の施設と鍵の対応を持つ。リポジトリに入れない",
    ledgerId: ctx.to.id,
    ledgerHash: sha256Hex(ledgerText),
    month: i.month,
    facilities,
    rejects,
  };
  writeFileSync(join(i.state, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  return { ledgerId: ringIdOf(JSON.parse(ledgerText).body), ledgerHash: sha256Hex(ledgerText), facilities, rejects, read };
}
