// 検問所の裏（docs/plan.md §2.8）：輪を作る・束のプレビュー・送る（署名して輪に置く）・輪を確かめる。
// プレビューと送るは、同じ sendInputOf と previewBundle で同じ body を作る。送るときは sealBundle が
// 人が見たハッシュと照らし、違えば送らない。署名するのは、数がすべて 0・k が下限以上・合言葉が鍵を開くときだけ（seal.ts）。
// 鍵・合言葉・束の中身・行の値をログに出さない。
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Plan } from "../shared/plan";
import { addRing, appendSent, readRings, readSent, readWrappedKey, writeWrappedKey, type RingEntry } from "../bridge/places";
import { CIRCLE_V, envelopeText, makeMemberBody, makeRulesDocBody, publicWords, ringIdOf, type ShareContext } from "./bundle";
import type { CopyResult, SkipReason, WithheldField, OmitReason } from "./copyout";
import { canonicalize, parseJsonStrict } from "./jcs";
import { SEND_MIN_K, kNational, profileBandOf, type Group, type Profile, type Tried } from "./k";
import type { SharePack } from "./pack";
import { countProperNouns } from "./recount";
import { CIRCLE_FILE, readRing, ringDir, writeBundle, writeCircle, writeMember, type RingRead } from "./ring";
import { baseRules, rulesGate, type Rules } from "./rules";
import { previewBundle, sealBundle, type SendInput } from "./seal";
import { fingerprint, generateKeyPair, keyIdOf, sha256Hex, signBody, wrapPrivateKey } from "./sign";

export const PASSPHRASE_MIN = 8;

/** 送る月（その PC の時刻の YYYY-MM） */
export function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── 輪を作る ──────────────────────────────────────────────

export type CreateRingResult =
  | { ok: true; ringId: string; key: string; fingerprint: string; dir: string }
  | { ok: false; reason: "passphraseShort" | "writeFailed" | "keyExists" };

/**
 * 輪を作る：この輪の鍵の対を作り、合言葉で包んで状態フォルダに置く。決まり（コードの決まり＝いちばん緩いもの）に署名して circle.json を、
 * 自分の仲間のファイルを members/ に置き、輪のフォルダを rings.json に足す（見張りのフックが読む）。作った人はその決まりを受け入れている。
 */
export async function createRing(i: { stateDir: string; root: string; pack: SharePack; passphrase: string; now: Date }): Promise<CreateRingResult> {
  if (i.passphrase.length < PASSPHRASE_MIN) return { ok: false, reason: "passphraseShort" };
  const pair = generateKeyPair();
  const key = keyIdOf(pair.pub);
  const month = monthOf(i.now);
  const rules = baseRules(i.pack.vocab.pack, i.pack.vocab.hash, i.pack.table.hash);
  const body = makeRulesDocBody(CIRCLE_V, pair.pub, randomBytes(16).toString("hex"), 1, month, rules);
  const circleText = envelopeText(body, signBody(body, pair.privateKey));
  const ringId = ringIdOf(body);
  const ctx: ShareContext = { table: i.pack.table, vocab: i.pack.vocab, rules, rulesHash: sha256Hex(circleText), to: { kind: "ring", id: ringId } };
  const memberBody = makeMemberBody(ringId, key, pair.pub, month);
  const memberText = envelopeText(memberBody, signBody(memberBody, pair.privateKey));
  // 鍵を先に包んで置く（輪のファイルだけが残り、鍵が無い状態を作らない）
  if (!writeWrappedKey(i.stateDir, ringId, wrapPrivateKey(pair, i.passphrase))) return { ok: false, reason: "keyExists" };
  // 輪のフォルダを先に一覧に足す（フックが書き込みを見張れるように）
  addRing(i.stateDir, { ringId, root: i.root, pack: i.pack.id, key, acceptedRulesHash: ctx.rulesHash, acceptedRules: rules, createdAt: i.now.toISOString() });
  const c = await writeCircle(i.root, circleText, ctx);
  const m = c.ok ? await writeMember(i.root, memberText, ctx) : c;
  if (!c.ok || !m.ok) return { ok: false, reason: "writeFailed" };
  return { ok: true, ringId, key, fingerprint: fingerprint(pair.pub), dir: ringDir(i.root, ringId) };
}

// ─── 輪を読む ──────────────────────────────────────────────

export type RingLoad =
  | { ok: true; entry: RingEntry; pub: string; circleBytes: Buffer; rules: Rules; ctx: ShareContext; read: RingRead; confirmed: Set<string> }
  | { ok: false; reason: "noRing" | "noKey" | "circleMissing" | "circleInvalid" };

/** 自分の輪を読む：決まり（circle.json）、自分の鍵、仲間ごとの ✓／✗（受け手と同じ readRing）。 */
export async function loadRing(stateDir: string, ringId: string, pack: SharePack): Promise<RingLoad> {
  const rings = readRings(stateDir);
  const entry = rings.rings.find((r) => r.ringId === ringId);
  if (!entry) return { ok: false, reason: "noRing" };
  const w = readWrappedKey(stateDir, ringId);
  if (!w) return { ok: false, reason: "noKey" };
  let circleBytes: Buffer;
  try {
    circleBytes = await readFile(join(ringDir(entry.root, ringId), CIRCLE_FILE));
  } catch {
    return { ok: false, reason: "circleMissing" };
  }
  const p = parseJsonStrict(circleBytes.toString("utf8"));
  const rules = p.ok ? ((p.value as { body?: { rules?: Rules } })?.body?.rules ?? null) : null;
  if (!rules) return { ok: false, reason: "circleInvalid" };
  const confirmed = new Set([...rings.confirmed, ...rings.rings.map((r) => r.key)]);
  const read = await readRing(entry.root, ringId, { table: pack.table, vocab: pack.vocab, confirmed });
  const ctx: ShareContext = {
    table: pack.table,
    vocab: pack.vocab,
    rules,
    rulesHash: sha256Hex(circleBytes),
    to: { kind: "ring", id: ringId },
    peers: read.latest,
  };
  return { ok: true, entry, pub: w.pub, circleBytes, rules, ctx, read, confirmed };
}

// ─── 施設の見え方の答え ──────────────────────────────────────

export interface Answers {
  /** 見え方の軸のコード（全国の表の軸のコード）。人が検問所で選ぶ */
  facility: Record<string, string | null>;
  /** 全国の表に載る施設か（人が答える） */
  inNationalTable: boolean | null;
  /** 人が粗くした段の位置 */
  fromRung?: number;
}

export interface Question {
  key: string;
  name: string;
  unit: string | null;
  tier: string;
  codes: { code: string; name: string }[];
  /** 計画の書類から、コードが読めた値（規模の数から帯など）。人が選び直せる */
  suggested: string | null;
}

/** 検問所で人に聞く軸：パックの見え方の軸のうち、全国の表に列があるもの（順のまま）。 */
export function questionsOf(pack: SharePack, plan: { facility: Pick<Plan["facility"], "scale" | "scaleUnit"> } | null): Question[] {
  const out: Question[] = [];
  for (const a of pack.spec.axes) {
    const info = pack.axes.find((x) => x.key === a.key);
    if (!info) continue;
    let suggested: string | null = null;
    if (plan && info.unit !== null && plan.facility.scale !== null && plan.facility.scaleUnit === info.unit) {
      suggested = profileBandOf(pack.table, a.key, plan.facility.scale);
    }
    out.push({ key: a.key, name: info.name, unit: info.unit, tier: a.tier, codes: info.codes, suggested });
  }
  return out;
}

// ─── 送る中身を組む（プレビューと送るで 1 つ） ─────────────────────

export interface SendSetup {
  input: SendInput;
  /** 持ち出し簿より輪の自分のフォルダの束が少ない（前に置いた束が見えない） */
  vanished: boolean;
}

/** プレビューと送るの両方が使う、送る中身の組み立て。seq と prev は、持ち出し簿と輪の自分のフォルダの大きい方から。 */
export function sendInputOf(stateDir: string, ring: Extract<RingLoad, { ok: true }>, pack: SharePack, plan: Plan, a: Answers, month: string): SendSetup {
  const key = keyIdOf(ring.pub);
  const mine = ring.read.bundles.filter((b) => b.folder === key && b.status === "ok" && b.seq !== null);
  const sent = readSent(stateDir).filter((s) => s.ringId === ring.entry.ringId && s.key === key);
  const ringMax = mine.reduce((m, b) => Math.max(m, b.seq!), 0);
  const sentMax = sent.reduce((m, s) => Math.max(m, s.seq), 0);
  const top = Math.max(ringMax, sentMax);
  const prev = top === 0 ? null : (mine.find((b) => b.seq === top)?.hash ?? sent.find((s) => s.seq === top)?.hash ?? null);
  const group: Group | null = a.inNationalTable === null ? null : a.inNationalTable ? "NATIONAL" : "OUTSIDE";
  return {
    input: {
      ctx: { ...ring.ctx, lastSeq: top },
      plan,
      spec: pack.spec,
      facility: a.facility,
      group,
      pub: ring.pub,
      seq: top + 1,
      prev,
      month,
      ...(a.fromRung !== undefined ? { fromRung: a.fromRung } : {}),
    },
    vanished: sentMax > ringMax,
  };
}

/** 固有名詞の網 2（その PC の語）と網 3（原本の全部の文字列）。送るたびにメモリで作り、残さない。 */
export function properNounSources(plan: Plan): { localWords: string[]; cells: string[] } {
  const localWords = new Set<string>([plan.facility.name, plan.displayName]);
  for (const w of plan.works) if (w.contractor) localWords.add(w.contractor);
  for (const d of plan.details) if (d.performer) localWords.add(d.performer);
  const cells: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") cells.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(plan);
  return { localWords: [...localWords].filter((w) => w.trim().length > 0), cells };
}

// ─── プレビュー ───────────────────────────────────────────

export type Blocker =
  | "rules"
  | "groupUnknown"
  | "profileIncomplete"
  | "kShort"
  | "nothingToCopy"
  | "content"
  | "properNoun";

export interface Counts {
  shape: number;
  properNoun: number;
  money: number;
  freeText: number;
  exactDate: number;
}

export interface OriginalRow {
  equipment: string;
  work: string;
  commonItem: string | null;
  lifted: string | null;
  attribute: string | null;
  fiscalYear: number;
  planOrActual: "plan" | "actual";
  date: string | null;
  manDays: number | null;
  days: number | null;
  cost: number | null;
  performer: string | null;
  contractor: string | null;
}

export interface PreviewView {
  blockers: Blocker[];
  missing: string[];
  tried: Tried[];
  /** 出ていく束の body（JCS のバイト列そのもの）と、その SHA-256。送るときに署名が {body, sig} の sig に入る */
  bodyText: string | null;
  bodyHash: string | null;
  bytes: number | null;
  seq: number;
  counts: Counts | null;
  k: number | null;
  minK: number;
  profile: Profile | null;
  /** 相手から見たあなた：全国の稼働の施設 → 見え方で n → この行（塊の分類）で m */
  steps: { all: number; profile: number; rows: number } | null;
  /** 分類ごとに、見え方の n からどれだけ減らすか（減らす分類だけ） */
  rowEffects: { class: string; n: number }[];
  copy: { copied: number; rows: number; skipped: Record<SkipReason, number>; withheld: Record<WithheldField, number>; omitted: Record<OmitReason, number> } | null;
  original: OriginalRow[];
  originalTotal: number;
  vanished: boolean;
}

const ORIGINAL_MAX = 40;

function originalRows(plan: Plan, lift: ReadonlyMap<string, string | null> | null): { rows: OriginalRow[]; total: number } {
  const assets = new Map(plan.assets.map((x) => [x.nodeKey, x]));
  const works = new Map(plan.works.map((w) => [w.workKey, w]));
  const rows: OriginalRow[] = [];
  let total = 0;
  for (const d of plan.details) {
    const w = works.get(d.workKey);
    if (!w) continue;
    for (const t of w.targets) {
      total++;
      if (rows.length >= ORIGINAL_MAX) continue;
      const a = assets.get(t);
      const ci = a?.commonItemAccepted ? (a.commonItem ?? null) : null;
      rows.push({
        equipment: a?.name ?? t,
        work: w.kind,
        commonItem: a?.commonItem ?? null,
        lifted: ci !== null && lift ? (lift.get(ci) ?? null) : null,
        attribute: w.attribute,
        fiscalYear: d.fiscalYear,
        planOrActual: d.planOrActual,
        date: d.startDate,
        manDays: d.manDays,
        days: d.days,
        cost: d.cost,
        performer: d.performer,
        contractor: w.contractor,
      });
    }
  }
  return { rows, total };
}

/** 検問所に出すもの。送る処理（sendCheckpoint）と同じ sendInputOf・previewBundle で body を作る。 */
export function previewCheckpoint(stateDir: string, ring: Extract<RingLoad, { ok: true }>, pack: SharePack, plan: Plan, a: Answers, month: string): PreviewView {
  const { input, vanished } = sendInputOf(stateDir, ring, pack, plan, a, month);
  const minK = Math.max(SEND_MIN_K, ring.rules.minK);
  const blockers: Blocker[] = [];
  const gate = rulesGate(ring.rules, ring.ctx.rulesHash, ring.entry.acceptedRulesHash, ring.entry.acceptedRules);
  if (!gate.ok) blockers.push("rules");
  const pv = previewBundle(input);
  const base: PreviewView = {
    blockers,
    missing: [],
    tried: pv.choice.tried,
    bodyText: null,
    bodyHash: null,
    bytes: null,
    seq: input.seq,
    counts: null,
    k: null,
    minK,
    profile: null,
    steps: null,
    rowEffects: [],
    copy: null,
    original: [],
    originalTotal: 0,
    vanished,
  };
  const orig = originalRows(plan, pv.ok ? pv.choice.lift : pv.choice.ok ? pv.choice.lift : null);
  base.original = orig.rows;
  base.originalTotal = orig.total;
  const copy = pv.ok ? pv.copy : pv.copy;
  if (copy) base.copy = copySummary(copy);
  if (!pv.ok) {
    blockers.push(pv.reason === "groupUnknown" ? "groupUnknown" : pv.reason === "profileIncomplete" ? "profileIncomplete" : pv.reason === "kShort" ? "kShort" : "nothingToCopy");
    if (!pv.choice.ok) base.missing = pv.choice.missing;
    return base;
  }
  const bodyText = canonicalize(pv.body);
  const words = properNounSources(plan);
  const pn = countProperNouns({
    bundleText: envelopeText(pv.body, "0".repeat(128)),
    fileName: `${String(pv.body.seq).padStart(6, "0")}-${"0".repeat(16)}.json`,
    folderPath: ringDir(ring.entry.root, ring.entry.ringId),
    localWords: words.localWords,
    cells: words.cells,
    publicWords: publicWords(input.ctx),
  });
  const counts: Counts = { shape: pv.recount.shape, properNoun: pn.total, money: pv.recount.money, freeText: pv.recount.freeText, exactDate: pv.recount.exactDate };
  if (!pv.contentClean) blockers.push("content");
  if (pn.total > 0) blockers.push("properNoun");
  const k = pv.body.counts.k;
  if (k < minK && !blockers.includes("content")) blockers.push("kShort");
  const prof = pv.body.profile;
  const classes = [...new Set(pv.copy.chunks.map((c) => c.class))];
  const nat = prof.group === "NATIONAL";
  const profileN = nat ? kNational(pack.table, pack.vocab, prof.axes, [], prof.stage) : k;
  const rowEffects = nat
    ? classes
        .map((c) => ({ class: c, n: kNational(pack.table, pack.vocab, prof.axes, [c], prof.stage) }))
        .filter((e) => e.n < profileN)
        .sort((x, y) => x.n - y.n)
    : [];
  return {
    ...base,
    bodyText,
    bodyHash: pv.bodyHash,
    bytes: Buffer.byteLength(bodyText, "utf8"),
    counts,
    k,
    profile: prof,
    steps: { all: nat ? pack.table.active : k, profile: profileN, rows: k },
    rowEffects,
  };
}

function copySummary(c: CopyResult): NonNullable<PreviewView["copy"]> {
  return { copied: c.copied, rows: c.rows, skipped: c.skipped, withheld: c.withheld, omitted: c.omitted };
}

// ─── 送る ──────────────────────────────────────────────────

export type SendResult =
  | { ok: true; fileName: string; hash: string; path: string; seq: number }
  | { ok: false; reason: "preview" | "previewChanged" | "rules" | "content" | "properNoun" | "passphrase" | "keyMismatch" | "afterSign" | "noKey" | "notClean" | "exists" | "unknown" };

/** 合言葉で署名し、輪の自分のフォルダに置き、持ち出し簿に足す。プレビューと同じ sendInputOf を通る。 */
export async function sendCheckpoint(
  stateDir: string,
  ring: Extract<RingLoad, { ok: true }>,
  pack: SharePack,
  plan: Plan,
  a: Answers,
  month: string,
  previewHash: string,
  passphrase: string,
  now: Date,
): Promise<SendResult> {
  const wrapped = readWrappedKey(stateDir, ring.entry.ringId);
  if (!wrapped) return { ok: false, reason: "noKey" };
  const { input } = sendInputOf(stateDir, ring, pack, plan, a, month);
  const words = properNounSources(plan);
  const s = sealBundle(input, {
    previewHash,
    wrapped,
    passphrase,
    acceptedRulesHash: ring.entry.acceptedRulesHash,
    acceptedRules: ring.entry.acceptedRules,
    localWords: words.localWords,
    cells: words.cells,
    folderPath: ringDir(ring.entry.root, ring.entry.ringId),
  });
  if (!s.ok) return { ok: false, reason: s.reason };
  const placed = await writeBundle(ring.entry.root, s.text, input.ctx);
  if (!placed.ok) return { ok: false, reason: placed.reason };
  appendSent(stateDir, { ringId: ring.entry.ringId, key: keyIdOf(ring.pub), seq: input.seq, hash: s.hash, fileName: s.fileName, month, at: now.toISOString() });
  return { ok: true, fileName: s.fileName, hash: s.hash, path: placed.path, seq: input.seq };
}

// ─── 輪を確かめる（受け手と同じ関数） ───────────────────────────

export interface VerifyLine {
  kind: "circle" | "member" | "bundle";
  /** 輪 ID・鍵 ID・束のファイル（bundles/<鍵ID>/<名前>） */
  name: string;
  status: "ok" | "ng" | "arriving" | "missing";
  reasons: string[];
  fingerprint?: string;
}

export interface VerifyReport {
  ringId: string;
  lines: VerifyLine[];
  notBundleFiles: number;
  ok: boolean;
}

/** readRing の結果を、決まり・仲間・束の行に並べる（画面と CLI が同じものを出す）。 */
export async function verifyRing(root: string, ringId: string, pack: Pick<SharePack, "table" | "vocab">, confirmed: ReadonlySet<string>): Promise<VerifyReport> {
  const r = await readRing(root, ringId, { table: pack.table, vocab: pack.vocab, confirmed });
  const lines: VerifyLine[] = [{ kind: "circle", name: ringId, status: r.circle.status, reasons: r.circle.reasons }];
  const pubs = new Map<string, string>();
  for (const m of r.members) {
    try {
      const t = await readFile(join(ringDir(root, ringId), "members", `${m.key}.json`), "utf8");
      const p = parseJsonStrict(t);
      const pub = p.ok ? (p.value as { body?: { pub?: unknown } })?.body?.pub : undefined;
      if (typeof pub === "string") pubs.set(m.key, pub);
    } catch {
      /* 仲間のファイルが無い（理由は member.missing） */
    }
  }
  for (const m of r.members) {
    const pub = pubs.get(m.key);
    lines.push({ kind: "member", name: m.key, status: m.status, reasons: m.reasons, ...(pub && /^[0-9a-f]{64}$/.test(pub) ? { fingerprint: fingerprint(pub) } : {}) });
  }
  for (const b of r.bundles) lines.push({ kind: "bundle", name: `bundles/${b.folder}/${b.name}`, status: b.status, reasons: b.reasons });
  return { ringId, lines, notBundleFiles: r.notBundleFiles, ok: lines.every((l) => l.status === "ok") && r.notBundleFiles === 0 };
}
