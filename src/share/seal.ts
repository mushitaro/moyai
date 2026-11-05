// 送る前の 2 つの処理：プレビュー（検問所に出す束のバイト列）と封（施設の鍵で署名する）。
// どちらも previewBundle で同じ body を作り、ハッシュが違えば送らない。
// 署名するのは、形の外れ・自由記述・金額・正確な日付・固有名詞が 0、k が下限以上、決まりを人が受け入れた、がそろったときだけ。
// 合言葉はやめた（運営者の決定 2026-11-04、docs/plan.md §2.19）。呼ぶのは人だけの経路（人が［送る］を押したとき）だけ。
import type { Plan } from "../shared/plan";
import { bundleFileName, envelopeText, fileHash, makeBundleBody, publicWords, type BundleBody, type ShareContext } from "./bundle";
import { candidateClasses, copyOut, type CopyResult } from "./copyout";
import { canonicalize } from "./jcs";
import { chooseProfile, countPeers, kNational, type Group, type KChoice, type ProfileSpec } from "./k";
import { countProperNouns, isClean, isContentClean, recount, type ProperNounResult, type RecountResult } from "./recount";
import { copyRulesOf, rulesGate, type Rules, type RulesGate } from "./rules";
import { keyIdOf, sha256Hex, signBody, type KeyPair } from "./sign";

export interface SendInput {
  ctx: ShareContext;
  plan: Plan;
  /** 見え方の軸とその順（パック） */
  spec: ProfileSpec;
  /** 施設の軸の値（人が答えたもの） */
  facility: Record<string, string | null>;
  group: Group | null;
  /** 送る人の公開鍵（16 進） */
  pub: string;
  seq: number;
  prev: string | null;
  /** 送る月（YYYY-MM） */
  month: string;
  /** 人が粗くした段の位置 */
  fromRung?: number;
}

const PLACEHOLDER_SIG = "0".repeat(128);
const PLACEHOLDER_HASH = "0".repeat(64);

export type Preview =
  | {
      ok: true;
      body: BundleBody;
      /** 正規化した body のハッシュ（人が見たものと送るものを照らす） */
      bodyHash: string;
      copy: CopyResult;
      choice: Extract<KChoice, { ok: true }>;
      /** 署名の前の数え直し（署名と鎖は見ない） */
      recount: RecountResult;
      /** 署名と鎖のほかが 0 か */
      contentClean: boolean;
    }
  | { ok: false; reason: "groupUnknown" | "profileIncomplete" | "kShort" | "nothingToCopy"; choice: KChoice; copy: CopyResult | null };

/** 束のプレビュー。送る処理も同じこの関数で body を作る。 */
export function previewBundle(i: SendInput): Preview {
  const { ctx, plan } = i;
  const self = keyIdOf(i.pub);
  const choice = chooseProfile({
    table: ctx.table,
    vocab: ctx.vocab,
    spec: i.spec,
    facility: i.facility,
    group: i.group,
    classes: candidateClasses(plan),
    minK: ctx.rules.minK,
    ...(i.fromRung !== undefined ? { fromRung: i.fromRung } : {}),
    peers: ctx.peers ?? [],
    self,
  });
  if (!choice.ok) return { ok: false, reason: choice.reason, choice, copy: null };
  const ringK = ctx.to.kind === "ring" ? countPeers(ctx.table, ctx.peers ?? [], self, choice.profile.group, choice.profile.axes) : 0;
  const copy = copyOut({ plan, lift: choice.lift, to: ctx.to, ringK, rules: copyRulesOf(ctx.rules) });
  if (copy.chunks.length === 0) return { ok: false, reason: "nothingToCopy", choice, copy };
  // 束に入れる k は、受ける側の数え直しと同じ数え方（写した塊の分類だけで数える）
  const classes = [...new Set(copy.chunks.map((c) => c.class))];
  const k =
    choice.profile.group === "NATIONAL"
      ? kNational(ctx.table, ctx.vocab, choice.profile.axes, classes, choice.profile.stage)
      : countPeers(ctx.table, ctx.peers ?? [], self, choice.profile.group, choice.profile.axes);
  const body = makeBundleBody({ ctx, key: self, pub: i.pub, seq: i.seq, prev: i.prev, month: i.month, profile: choice.profile, k, chunks: copy.chunks });
  const r = recount(envelopeText(body, PLACEHOLDER_SIG), ctx);
  return { ok: true, body, bodyHash: sha256Hex(canonicalize(body)), copy, choice, recount: r, contentClean: isContentClean(r) };
}

export interface SealInput {
  /** 人が検問所で見たプレビューのハッシュ */
  previewHash: string;
  /** 送る人の鍵（開いたもの。呼ぶ側は署名のあとに持ち続けない） */
  pair: KeyPair;
  /** 人が受け入れた決まりのハッシュと、その決まり（差を出すため） */
  acceptedRulesHash: string | null;
  acceptedRules: Rules | null;
  /** 固有名詞の網 2・網 3 */
  localWords: readonly string[];
  cells: readonly string[];
  folderPath: string;
}

export type SealResult =
  | { ok: true; text: string; hash: string; fileName: string; recount: RecountResult }
  | {
      ok: false;
      reason: "preview" | "previewChanged" | "rules" | "content" | "properNoun" | "keyMismatch" | "afterSign";
      rules?: RulesGate;
      properNoun?: ProperNounResult;
      recount?: RecountResult;
    };

/** 署名して、場に置く文字列を作る（置くのは ring.ts か ledger-send.ts）。 */
export function sealBundle(i: SendInput, s: SealInput): SealResult {
  const pv = previewBundle(i);
  if (!pv.ok) return { ok: false, reason: "preview" };
  if (pv.bodyHash !== s.previewHash) return { ok: false, reason: "previewChanged" };
  const g = rulesGate(i.ctx.rules, i.ctx.rulesHash, s.acceptedRulesHash, s.acceptedRules);
  if (!g.ok) return { ok: false, reason: "rules", rules: g };
  if (!pv.contentClean) return { ok: false, reason: "content", recount: pv.recount };
  const pn = countProperNouns({
    bundleText: envelopeText(pv.body, PLACEHOLDER_SIG),
    fileName: bundleFileName(pv.body.seq, PLACEHOLDER_HASH),
    folderPath: s.folderPath,
    localWords: s.localWords,
    cells: s.cells,
    publicWords: publicWords(i.ctx),
  });
  if (pn.total > 0) return { ok: false, reason: "properNoun", properNoun: pn };
  if (s.pair.pub !== i.pub) return { ok: false, reason: "keyMismatch" };
  const sig = signBody(pv.body, s.pair.privateKey);
  const text = envelopeText(pv.body, sig);
  const r = recount(text, i.ctx);
  if (!isClean(r) || r.peersShort) return { ok: false, reason: "afterSign", recount: r };
  const hash = fileHash(text);
  return { ok: true, text, hash, fileName: bundleFileName(pv.body.seq, hash), recount: r };
}
