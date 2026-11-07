// AI の share_preview（仕事 share-preview-v1）：SHARE の画面が共有ファイルに書く中身（src/share/checkpoint.ts の PreviewView）から、
// 形と数だけを作る。行の値（機器・作業の名前、年度、階級、費用）と共有ファイルのバイト列は返さない（安全の決まり 3）。
// 言葉は SHARE の画面の言葉（src/app/text）を使い、画面と同じ数を返す。作るのは橋渡し（src/bridge/human.ts の sharePreview）。
// SHARE の画面を開いたときの既定の選び（見え方の答えと共有フォルダ）も、ここの関数で画面と橋渡しが同じに作る。
import type { Plan } from "../shared/plan";
import { SHARE_FILE_COLUMNS, SHARE_NEEDS_TEXT, SHARE_PREVIEW_NOTE, type ShareNeeds, type SharePreviewOut } from "../shared/tools";
import { HUMAN_TEXT } from "../app/text/human";
import { tokyoYmd, versionName } from "../app/version-name";
import { fiscalYearOf } from "../import/era";
import type { PreviewView } from "./checkpoint";
import { WITHHELD_FIELDS } from "./copyout";
import type { SharePack } from "./pack";

const T = HUMAN_TEXT.checkpoint;

/** ハッシュの頭の字数（版を開くリンクの h= と同じ） */
export const HASH_HEAD = 16;

/** SHARE の画面を開いたときの見え方の答えの既定：規模から読んだ値に、施設の設定の答えを重ねる（人が選び直せる） */
export function defaultShareFacility(questions: readonly { key: string; suggested: string | null }[], profile: Record<string, string | null> | null): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const q of questions) if (q.suggested) out[q.key] = q.suggested;
  Object.assign(out, profile ?? {});
  return out;
}

/** SHARE の画面を開いたときの共有フォルダの既定：計画と同じ Skillパックの、一覧の最初の共有フォルダ */
export function defaultRingId(rings: readonly { ringId: string; pack: string }[], packId: string): string | null {
  return rings.find((r) => r.pack === packId)?.ringId ?? null;
}

/** 数えられなかったときの答え（ほかの欄は空） */
export function sharePreviewNeeds(reason: ShareNeeds, screen: boolean): SharePreviewOut {
  return {
    needs: { reason, text: SHARE_NEEDS_TEXT[reason] },
    screen,
    destination: null,
    version: null,
    counts: null,
    copy: null,
    hidden: [],
    you: null,
    missingAxes: [],
    file: null,
    checks: null,
    blocked: [],
    note: SHARE_PREVIEW_NOTE,
  };
}

/** 橋渡しが断った理由（人だけの経路と同じ字）から、AI に返す理由 */
export function shareNeedsOf(reason: string): ShareNeeds {
  if (reason === "notConfirmed") return "not_confirmed";
  if (reason === "noRoot") return "no_root";
  if (reason === "noRingChosen" || reason === "noRing") return "no_ring";
  if (reason.startsWith("ledger.")) return "no_ledger";
  if (reason === "packNotReady") return "pack_not_ready";
  if (reason === "historyBroken") return "history_broken";
  if (reason === "historyVanished") return "history_vanished";
  return "other";
}

export interface SharePreviewInput {
  dest: "ring" | "ledger";
  /** 作業画面を SHARE に切り替えたか */
  screen: boolean;
  /** 共有ファイルにする確定した版の計画（数えるだけ。値は返さない） */
  plan: Plan;
  /** 版の番号・中身のハッシュ・版を確定した署名の時刻（承認があれば承認。無ければ null） */
  version: { number: number; contentHash: string; signedAt: string | null };
  view: PreviewView;
  axes: SharePack["axes"];
}

/** 塊の欄ごとの塊の数（共有ファイルの body から。値は見ない） */
function columnsOf(bodyText: string): { name: string; chunks: number }[] | null {
  let chunks: Record<string, unknown>[];
  try {
    const b = JSON.parse(bodyText) as { chunks?: unknown };
    if (!Array.isArray(b.chunks)) return null;
    chunks = b.chunks as Record<string, unknown>[];
  } catch {
    return null;
  }
  return (Object.keys(SHARE_FILE_COLUMNS) as (keyof typeof SHARE_FILE_COLUMNS)[]).map((k) => ({ name: SHARE_FILE_COLUMNS[k], chunks: chunks.filter((c) => c[k] !== undefined).length }));
}

/**
 * 見え方の 1 行（画面の「施設 ― …、所在」と同じ。所在は伏せる）。画面は共有ファイルの body（JCS。鍵は UTF-16 の順）から読むので、軸も同じ順に並べる
 */
function labelOf(axes: SharePack["axes"], profile: Record<string, string>): string {
  const keys = Object.keys(profile).sort();
  const names = keys.map((k) => axes.find((a) => a.key === k)?.codes.find((c) => c.code === profile[k])?.name ?? profile[k]!);
  return `${T.profileLine(names.join("、"))}（${T.redacted}）`;
}

/** SHARE の画面と同じ数を、形と数だけにする */
export function sharePreviewOf(i: SharePreviewInput): SharePreviewOut {
  const { plan, view } = i;
  const copy = view.copy;
  const startMonth = plan.facility.fiscalYearStartMonth;
  const ymd = i.version.signedAt ? tokyoYmd(i.version.signedAt) : null;
  const fiscalYear = ymd && Number.isInteger(startMonth) && startMonth >= 1 && startMonth <= 12 ? fiscalYearOf(ymd, startMonth) : null;
  const shared = (n: number) => (copy ? n : null);
  const blocked = view.blockers.map((b) => (i.dest === "ledger" && b === "rules" ? T.ledgerRulesNotAccepted : (T.sendNeeds[b] ?? b)));
  const columns = view.bodyText ? columnsOf(view.bodyText) : null;
  return {
    needs: null,
    screen: i.screen,
    destination: { kind: i.dest, name: T.dest[i.dest] },
    version: {
      number: i.version.number,
      fiscalYear,
      name: versionName(i.version.number, i.version.signedAt, startMonth),
      hashHead: i.version.contentHash.slice(0, HASH_HEAD),
    },
    counts: {
      equipment: { inPlan: plan.assets.length, shared: shared(copy?.fromPlan.assets ?? 0) },
      works: { inPlan: plan.works.length, shared: shared(copy?.fromPlan.works ?? 0) },
      yearValues: { inPlan: plan.details.length, shared: shared(copy?.fromPlan.details ?? 0) },
      // 費用の欄は共有ファイルに無い（帯にもしない。docs/plan.md §2.8）
      costRows: { inPlan: plan.details.filter((d) => d.cost !== null).length, shared: 0 },
    },
    copy: copy
      ? {
          copied: copy.copied,
          rows: copy.rows,
          skippedByReason: Object.fromEntries(Object.entries(copy.skipped).filter(([, n]) => n > 0).map(([k, n]) => [HUMAN_TEXT.skip[k] ?? k, n])),
        }
      : null,
    hidden: WITHHELD_FIELDS.map((f) => ({ field: HUMAN_TEXT.withheld[f] ?? f, values: copy ? copy.withheld[f] : null })),
    you:
      view.profile && view.steps && view.k !== null
        ? {
            label: labelOf(i.axes, view.profile.axes),
            group: T.col3Group[view.profile.group] ?? view.profile.group,
            kLevel: view.profile.stage,
            k: view.k,
            minK: view.minK,
            steps: view.steps,
          }
        : null,
    missingAxes: view.missing.map((k) => i.axes.find((a) => a.key === k)?.name ?? k),
    file:
      view.bodyHash && view.bytes !== null && columns
        ? { chunks: copy?.chunks ?? 0, columns, hashHead: view.bodyHash.slice(0, HASH_HEAD), bytes: view.bytes, seq: view.seq }
        : null,
    checks: view.counts,
    blocked,
    note: SHARE_PREVIEW_NOTE,
  };
}
