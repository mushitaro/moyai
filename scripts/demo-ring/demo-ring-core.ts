// デモの輪を作る道具の芯（docs/plan.md §2.8「デモの輪は 7 拠点」・§2.15・§5.1 `verify demo-ring`）。scripts/demo-ring/build.mjs が呼ぶ。
// - 架空の 7 拠点：公開の台帳のデモと同じ正解の世界（samples/truth/<pack>/ledger-01〜07。工場の samples/factory/ledger_worlds.py が組む）から、
//   取り込みを通さずに計画を直接書き（scripts/ledger/truth-plan.mjs）、本物の写し取り・数え直し・封（previewBundle・sealBundle）で束にする。
//   1 拠点の束は 1 つの世界だけから作る（施設をまたいで混ぜない）。固有名詞の網も本物の関数が封の中で照らす。
// - 輪の決まり（circle.json）・仲間のファイル・束は、本物の輪の書き手（writeCircle・writeMember・writeBundle）で置く。
//   拠点は 1 つずつ送り、送る前に受け手と同じ readRing で、それまでの確認済みの仲間の最新の束を読む（検問所の loadRing と同じ）。
// - わざと外れた束を 1 つ入れる：8 つめの鍵（ledger-08 の世界）が、本物の封で作った body の塊に費用の欄を足し、本物の署名の関数で署名したもの。
//   外れは中身だけ（道・名前・鎖は正しい）。本物の書き手は数え直しが 0 でない束を置かないので、この 1 つだけは手で置く。
// - 鍵は走らせるたびに作る。秘密鍵と、拠点と世界の対応は状態のフォルダ（一時のフォルダ）にだけ書き、出す輪には書かない。
// - 輪の決まりは、拠点 01 の鍵で署名する（デモでは輪を作った人と拠点 01 を同じ鍵にする）。
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planFromWorld } from "../ledger/truth-plan.mjs";
import { CIRCLE_V, bundleFileName, envelopeText, fileHash, makeMemberBody, makeRulesDocBody, ringIdOf, type ShareContext } from "../../src/share/bundle";
import { properNounSources, verifyRing, type VerifyReport } from "../../src/share/checkpoint";
import { loadSharePack, type SharePack } from "../../src/share/pack";
import { BUNDLES_DIR, readRing, writeBundle, writeCircle, writeMember } from "../../src/share/ring";
import { baseRules } from "../../src/share/rules";
import { previewBundle, sealBundle, type SendInput } from "../../src/share/seal";
import { HEX16, fingerprint, generateKeyPair, keyIdOf, sha256Hex, signBody, type KeyPair } from "../../src/share/sign";
import { Plan } from "../../src/shared/plan";
import { DEMO_RING_FILE, DEMO_RING_V, type DemoRingManifest } from "../../src/share/demo-ring";

export const DEMO_RING_PACK = "waste-incineration";
/** 7 拠点の正解の世界（公開の台帳のデモの 10 施設のうち、見え方がそろう 7 つ） */
export const DEMO_RING_WORLDS = ["ledger-01", "ledger-02", "ledger-03", "ledger-04", "ledger-05", "ledger-06", "ledger-07"] as const;
/** わざと外れた束を作る世界（7 拠点と混ぜない） */
export const DEMO_RING_REJECT_WORLD = "ledger-08";

export interface DemoRingInput {
  /** リポジトリの根（samples/ と packs/ がある所） */
  repo: string;
  /** 出す先（<出す先>/<輪ID>/ と demo-ring.json を作る。輪がまだ無いフォルダ） */
  out: string;
  /** 状態のフォルダ（秘密鍵と、拠点と世界の対応を書く。一時のフォルダ） */
  state: string;
  /** 送った月（束の month） */
  month: string;
}

export interface DemoRingResult {
  ringId: string;
  manifest: DemoRingManifest;
  report: VerifyReport;
  sites: { world: string; key: string; chunks: number; k: number }[];
}

type World = { facility: { answers: Record<string, string>; capacity_t_per_day: number; name: string } };

function readWorld(repo: string, id: string): World {
  return JSON.parse(readFileSync(join(repo, "samples", "truth", DEMO_RING_PACK, id, "world.json"), "utf8"));
}

function planOf(w: World): Plan {
  return Plan.parse(planFromWorld(w, { scale: w.facility.capacity_t_per_day, scaleUnit: "t/日" }));
}

/** 秘密鍵を状態のフォルダに書く（出す輪には書かない） */
function keepKey(state: string, name: string, k: KeyPair): void {
  mkdirSync(join(state, "keys"), { recursive: true });
  writeFileSync(join(state, "keys", `${name}.pem`), k.privateKey.export({ format: "pem", type: "pkcs8" }).toString(), { encoding: "utf8", mode: 0o600, flag: "wx" });
}

/** 出す先に、もう輪（<輪ID>/）か約束のファイルがあるか */
function hasRing(out: string): boolean {
  if (!existsSync(out)) return false;
  if (existsSync(join(out, DEMO_RING_FILE))) return true;
  return readdirSync(out, { withFileTypes: true }).some((d) => d.isDirectory() && HEX16.test(d.name));
}

/**
 * 1 拠点の束を本物の封で作る（検問所の sealPlace と同じ順：previewBundle → 人が見たハッシュ → sealBundle）。
 * 人が見たハッシュは、プレビューのハッシュをそのまま渡す（架空の拠点に人はいない）。
 */
function seal(ctx: ShareContext, pack: SharePack, plan: Plan, answers: Record<string, string>, pair: KeyPair, month: string, ringId: string) {
  const input: SendInput = { ctx: { ...ctx, lastSeq: 0 }, plan, spec: pack.spec, facility: answers, group: "NATIONAL", pub: pair.pub, seq: 1, prev: null, month };
  const pv = previewBundle(input);
  if (!pv.ok) throw new Error(`プレビューができない（${pv.reason}）`);
  const words = properNounSources(plan);
  const s = sealBundle(input, {
    previewHash: pv.bodyHash,
    pair,
    acceptedRulesHash: ctx.rulesHash,
    acceptedRules: ctx.rules,
    localWords: words.localWords,
    cells: words.cells,
    // 固有名詞の網が照らす置き場所の道は、リポジトリで人に見える道にする（作った PC の道は公開されない）
    folderPath: `demo-ring/${ringId}/${BUNDLES_DIR}/${keyIdOf(pair.pub)}`,
  });
  if (!s.ok) throw new Error(`封ができない（${s.reason}）`);
  return { pv, s };
}

async function placeMember(out: string, ctx: ShareContext, ringId: string, pair: KeyPair, month: string): Promise<void> {
  const body = makeMemberBody(ringId, keyIdOf(pair.pub), pair.pub, month);
  const m = await writeMember(out, envelopeText(body, signBody(body, pair.privateKey)), ctx);
  if (!m.ok) throw new Error(`メンバーのファイルを置けない（${m.reason}）`);
}

export async function buildDemoRing(i: DemoRingInput): Promise<DemoRingResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month)) throw new Error("月の形でない（YYYY-MM）");
  if (hasRing(i.out)) throw new Error("出す先にもう共有フォルダがある（足すだけの共有フォルダを上書きしない。作り直すときは人が消してから）");
  const p = loadSharePack(join(i.repo, "packs"), DEMO_RING_PACK);
  if (!p.ok) throw new Error(`Skillパックを読めない（${p.reason}）`);
  const pack = p.pack;
  mkdirSync(i.state, { recursive: true });
  mkdirSync(i.out, { recursive: true });

  // 拠点の鍵（走らせるたびに作る）
  const sites = DEMO_RING_WORLDS.map((world) => ({ world, pair: generateKeyPair() }));
  for (const s of sites) keepKey(i.state, `${s.world}-${keyIdOf(s.pair.pub)}`, s.pair);

  // 輪の決まり（コードの決まり＝いちばん緩いもの。拠点 01 の鍵で署名）
  const founder = sites[0]!.pair;
  const rules = baseRules(pack.vocab.pack, pack.vocab.hash, pack.table.hash);
  const circleBody = makeRulesDocBody(CIRCLE_V, founder.pub, randomBytes(16).toString("hex"), 1, i.month, rules);
  const circleText = envelopeText(circleBody, signBody(circleBody, founder.privateKey));
  const ringId = ringIdOf(circleBody);
  const ctx: ShareContext = { table: pack.table, vocab: pack.vocab, rules, rulesHash: sha256Hex(circleText), to: { kind: "ring", id: ringId }, peers: [] };
  const c = await writeCircle(i.out, circleText, ctx);
  if (!c.ok) throw new Error(`決まりを置けない（${c.reason}）`);

  // 拠点を 1 つずつ送る。送る前に、受け手と同じ readRing で、それまでの確認済みの仲間の最新の束を読む
  const confirmed = new Set<string>();
  const out: DemoRingResult["sites"] = [];
  for (const s of sites) {
    const key = keyIdOf(s.pair.pub);
    confirmed.add(key);
    const read = await readRing(i.out, ringId, { table: pack.table, vocab: pack.vocab, confirmed });
    const sendCtx: ShareContext = { ...ctx, peers: read.latest };
    const w = readWorld(i.repo, s.world);
    const { pv, s: sealed } = seal(sendCtx, pack, planOf(w), w.facility.answers, s.pair, i.month, ringId);
    await placeMember(i.out, sendCtx, ringId, s.pair, i.month);
    const placed = await writeBundle(i.out, sealed.text, sendCtx);
    if (!placed.ok) throw new Error(`共有ファイルを置けない（${placed.reason}）`);
    out.push({ world: s.world, key, chunks: pv.body.chunks.length, k: pv.body.counts.k });
  }

  // わざと外れた束：8 つめの鍵。本物の封の body の塊に費用の欄を足し、本物の署名の関数で署名する
  const reject = generateKeyPair();
  const rejectKey = keyIdOf(reject.pub);
  keepKey(i.state, `reject-costField-${rejectKey}`, reject);
  confirmed.add(rejectKey);
  {
    const read = await readRing(i.out, ringId, { table: pack.table, vocab: pack.vocab, confirmed });
    const sendCtx: ShareContext = { ...ctx, peers: read.latest };
    const w = readWorld(i.repo, DEMO_RING_REJECT_WORLD);
    const { s: sealed } = seal(sendCtx, pack, planOf(w), w.facility.answers, reject, i.month, ringId);
    await placeMember(i.out, sendCtx, ringId, reject, i.month);
    const body = JSON.parse(sealed.text).body as Record<string, unknown>;
    (body.chunks as Record<string, unknown>[])[0]!.cost = "1,200,000円";
    const text = envelopeText(body, signBody(body, reject.privateKey));
    const dir = join(i.out, ringId, BUNDLES_DIR, rejectKey);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, bundleFileName(body.seq as number, fileHash(text))), text, { encoding: "utf8", flag: "wx" });
  }

  // 受け手と同じ関数で確かめ、✗ になった行を約束のファイルに書く
  const report = await verifyRing(i.out, ringId, pack, confirmed);
  const ng = report.lines.filter((l) => l.status !== "ok");
  const onlyReject =
    ng.length === 2 && ng.every((l) => (l.kind === "member" && l.name === rejectKey) || (l.kind === "bundle" && l.name.startsWith(`${BUNDLES_DIR}/${rejectKey}/`)));
  if (!onlyReject || ng.some((l) => l.reasons.length === 0) || report.notBundleFiles > 0) throw new Error("わざと外れた共有ファイルのほかに ✗ がある（または理由が無い）");

  const manifest: DemoRingManifest = {
    v: DEMO_RING_V,
    note: "【架空】デモの共有フォルダ（7 拠点）。scripts/demo-ring/build.mjs が作った。秘密鍵はリポジトリに無い",
    ring: ringId,
    month: i.month,
    confirmed: [
      ...sites.map((s) => ({ key: keyIdOf(s.pair.pub), fingerprint: fingerprint(s.pair.pub), role: "site" as const })),
      { key: rejectKey, fingerprint: fingerprint(reject.pub), role: "reject" as const },
    ],
    expectNg: ng.map((l) => ({ kind: l.kind as "member" | "bundle", name: l.name, reasons: [...new Set(l.reasons)].sort() })),
  };
  writeFileSync(join(i.out, DEMO_RING_FILE), JSON.stringify(manifest, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  // 状態のフォルダ：拠点と世界の対応（リポジトリに入れない）
  writeFileSync(
    join(i.state, "manifest.json"),
    JSON.stringify(
      { note: "【架空】デモの共有フォルダの状態。秘密鍵（keys/）と、拠点と世界の対応を持つ。リポジトリに入れない", ringId, sites: out, reject: { world: DEMO_RING_REJECT_WORLD, key: rejectKey } },
      null,
      2,
    ) + "\n",
    { encoding: "utf8", mode: 0o600 },
  );
  return { ringId, manifest, report, sites: out };
}
