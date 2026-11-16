// 読み方のフィードバックの受け口（運営者 2026-11-16「早く利用者が使える状態に」）：GitHub のアカウントを持たない人が、
// HOSHITORI のルールのシートで保存した moyai.reading-feedback/0（src/share/reading-feedback.ts）を受け、
// 変数 FEEDBACK_REPO（固定。mushitaro/moyai）に、ラベル feedback の Issue を出す。毎日の回し（scripts/skill-loop/feedback.mjs）がそのまま拾う形。
// 道は POST /feedback。確かめの順：
//   1. 方法・設定（FEEDBACK_REPO・トークン・KV）。トークンは FEEDBACK_TOKEN（推す：FEEDBACK_REPO だけ・Issues の書き込み）か、無ければ GITHUB_TOKEN
//   2. 濫用の防ぎ：/submit と同じ数え方（同じ IP から 1 時間に 10 件・まわりの網から 30 件。断った件も数える）。数える名前は /submit と別（台帳の枠を食わない）
//   3. Content-Type（application/json）と大きさ（64 KB まで）
//   4. JSON の形（UTF-8・入れ子 8 段まで・キーの重複なし）と、moyai.reading-feedback/0 の形（parseReadingFeedback。文・理由・人・資料の名前・id の欄があれば断る）
//      と業種（Issue の型の選択肢にあるパックだけ）
//   5. 行の値らしきもの（金額・日付・番号・会社や施設の名前・連絡先。scripts/skill-loop/values.mjs の countValues。毎日の回しと同じ数え方）が 1 つでもあれば断る。
//      その PC の語（固有名詞の網 2）は受け口に送らない（語そのものが固有名詞なので）。網 2 はアプリが送る前に照らす（src/bridge/human.ts の reading_feedback_send）
//   ここまでは GitHub を呼ばない
//   6. 同じ中身の Issue（ラベル feedback の Issue の本文のルールの欄が同じ）があれば、それを返す。受け口が出した開いた Issue が 20 あれば断る（運営者が読むまで）
//   7. Issue を出す（題は機械的。本文は .github/ISSUE_TEMPLATE/reading-feedback.yml の見出し。送り手の字は、ルールの形のほかに入らない）
// トークンに FEEDBACK_REPO の Issues の権限が無ければ（GitHub が 403・404）、503 intake.feedbackNoPermission で理由を返す。
// トークンと IP は、ログにも答えにも出さない（console に何も書かない）。
import { CHECK_LABEL, HEAD, PACK_OF } from "../../../scripts/skill-loop/form.mjs";
import { countValues, countableRuleBlock, ruleTexts } from "../../../scripts/skill-loop/values.mjs";
import { parseJsonStrict } from "../../../src/share/jcs";
import { LEDGER_LIMITS, jsonDepth } from "../../../src/share/ledger";
import { parseReadingFeedback, type ReadingFeedbackFile } from "../../../src/share/reading-feedback";
import { feedbackIssues, openIssue, repoOf, type Gh, type IssueRef } from "./github";
import type { IntakeDeps, IntakeEnv } from "./handler";
import { TOKEN_SHAPE, jsonReply, readLimited, refuseWith } from "./http";
import { RATE_LIMIT, bucketKey, clientBucket, networkBucket, takeSlot } from "./limit";
import { reasonText } from "../../../src/app/text/reasons";

export const FEEDBACK_PATH = "/feedback";

export const FEEDBACK_LIMITS = {
  /** 体の大きさ（規則 500 件の書き出しで 60 KB ほど） */
  bodyBytes: 64 * 1024,
  /** 受け口が出した、開いたフィードバックの Issue の数。越えたら運営者が読むまで出さない */
  openIssues: 20,
} as const;

/** Issue に付けるラベル（型と同じ）。毎日の回しは feedback を見る */
export const FEEDBACK_LABELS = ["feedback", "area:skill-loop"] as const;

/** 題の頭（受け口が出した Issue を数える印） */
export const FEEDBACK_TITLE_HEAD = "読み方のフィードバック（受け口から";

/** パックの id → 型の「業種」の選択肢 */
const LABEL_OF: Record<string, string> = Object.fromEntries(Object.entries(PACK_OF).map(([label, id]) => [id, label]));

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** 題（機械的。数字は 3 桁まで：毎日の回しの「4 桁以上の数」に当てない） */
export function feedbackTitle(f: ReadingFeedbackFile): string {
  return `${FEEDBACK_TITLE_HEAD}・${f.pack}・ルール ${f.rules.length} 件）`;
}

/** ルールの欄に貼る字（受けた字ではなく、読んだ形から作り直す：余計な字を運ばない） */
export function feedbackRuleText(f: ReadingFeedbackFile): string {
  return JSON.stringify({ schema: f.schema, pack: f.pack, rules: f.rules }, null, 2);
}

/** 本文の「どう読まれて…」の欄（決まった文。送り手の字は入れない） */
export const FEEDBACK_WHAT = "アプリの「ルール」のシートから、受け口を通して送られました（GitHub のアカウントなし）。送り手の文は無く、ルールの形と効いたセルの数だけです。";

/** Issue の本文（.github/ISSUE_TEMPLATE/reading-feedback.yml の見出し。scripts/skill-loop/feedback.mjs の readForm で読める形） */
export function feedbackBody(f: ReadingFeedbackFile): string {
  return [
    `### ${HEAD.pack}`,
    "",
    LABEL_OF[f.pack] ?? "そのほか",
    "",
    `### ${HEAD.source}`,
    "",
    "そのほか",
    "",
    `### ${HEAD.what}`,
    "",
    FEEDBACK_WHAT,
    "",
    `### ${HEAD.rule}`,
    "",
    "```json",
    feedbackRuleText(f),
    "```",
    "",
    `### ${HEAD.check}`,
    "",
    // 人が全文を見てから「送る」を押した（アプリ）。行の値らしきものと業種は、この受け口が機械で確かめた
    `- [X] ${CHECK_LABEL}`,
    "",
  ].join("\n");
}

/** 本文から、ルールの欄の字だけを取り出す（同じ中身の Issue を探すため） */
function ruleBlockOf(body: string): string | null {
  const m = /```json\n([\s\S]*?)\n```/.exec(body.replace(/\r\n/g, "\n"));
  return m ? m[1]! : null;
}

/**
 * 体を確かめる（GitHub を呼ぶ前）。通れば読んだ形、通らなければ理由のコード。
 * 行の値らしきものは、毎日の回し（feedback.mjs の screen）と同じ字（題・決まった文・ルールの欄・規則の人の字の欄）で数える
 */
export function feedbackOf(bytes: Uint8Array): { ok: true; file: ReadingFeedbackFile } | { ok: false; reasons: string[]; counts?: Record<string, number> } {
  let text: string;
  try {
    text = UTF8.decode(bytes);
  } catch {
    return { ok: false, reasons: ["shape.notUtf8"] };
  }
  if (jsonDepth(text) > LEDGER_LIMITS.jsonDepth) return { ok: false, reasons: ["file.tooDeep"] };
  const p = parseJsonStrict(text);
  if (!p.ok) return { ok: false, reasons: [p.truncated ? "shape.truncated" : "shape.syntax"] };
  const strict: string[] = [];
  if (p.bom) strict.push("shape.bom");
  if (p.duplicateKeys > 0) strict.push("shape.duplicateKey");
  if (p.protoKeys > 0) strict.push("shape.protoKey");
  if (p.loneSurrogates > 0) strict.push("shape.loneSurrogate");
  if (strict.length) return { ok: false, reasons: strict };
  const file = parseReadingFeedback(text);
  if (!file) return { ok: false, reasons: ["feedback.shape"] };
  if (!LABEL_OF[file.pack]) return { ok: false, reasons: ["feedback.packUnknown"] };
  const block = feedbackRuleText(file);
  const counts = countValues([feedbackTitle(file), FEEDBACK_WHAT, countableRuleBlock(block), ...file.rules.flatMap((r) => ruleTexts(r))]);
  const found = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  if (Object.keys(found).length) return { ok: false, reasons: ["feedback.rowValues"], counts: found };
  return { ok: true, file };
}

const accepted = (issue: IssueRef): Response => jsonReply(200, { ok: true, issue: { number: issue.number, url: issue.url } });

export async function handleFeedback(req: Request, env: IntakeEnv, deps: IntakeDeps): Promise<Response> {
  // 1. 方法・設定
  if (req.method !== "POST") return refuseWith(405, ["intake.method"], { allow: "POST" });
  const repo = repoOf(env.FEEDBACK_REPO);
  const token = env.FEEDBACK_TOKEN ?? env.GITHUB_TOKEN ?? "";
  const kv = env.INTAKE_KV;
  if (!repo || !TOKEN_SHAPE.test(token) || !kv) return refuseWith(503, ["intake.notConfigured"]);

  // 2. /submit と同じ数え方（数える名前は別）
  const ip = req.headers.get("cf-connecting-ip");
  const bucket = clientBucket(ip);
  const net = networkBucket(ip);
  if (!bucket || !net) return refuseWith(400, ["intake.noClient"]);
  let slot;
  try {
    slot = await takeSlot(
      kv,
      [
        { key: bucketKey(token, `feedback:${bucket}`), max: RATE_LIMIT.max },
        { key: bucketKey(token, `feedback:net:${net}`), max: RATE_LIMIT.networkMax },
      ],
      deps.now(),
    );
  } catch {
    return refuseWith(503, ["intake.unavailable"]);
  }
  if (!slot.ok)
    return jsonReply(429, { ok: false, reasons: ["intake.rateLimited"], reasonsText: [reasonText("intake.rateLimited")], retryAfter: slot.retryAfter }, { "retry-after": String(slot.retryAfter) });

  // 3. 形式と大きさ
  const ct = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (ct !== "application/json") return refuseWith(415, ["intake.contentType"]);
  const bytes = await readLimited(req, FEEDBACK_LIMITS.bodyBytes);
  if (!bytes) return refuseWith(413, ["file.tooLarge"]);

  // 4・5. 形・業種・行の値らしきもの（GitHub を呼ぶ前）。行の値の種類ごとの数だけを返す（値そのものは返さない）
  const f = feedbackOf(bytes);
  if (!f.ok) {
    if (!f.counts) return refuseWith(400, f.reasons);
    return jsonReply(400, { ok: false, reasons: f.reasons, reasonsText: f.reasons.map(reasonText), counts: f.counts });
  }
  const gh: Gh = { fetch: deps.fetch, token, repo };

  // 6. 同じ中身の Issue があれば、それを返す。受け口の開いた Issue が多ければ断る
  const block = feedbackRuleText(f.file);
  const list = await feedbackIssues(gh, FEEDBACK_LABELS[0]);
  if (list === "noPermission") return refuseWith(503, ["intake.feedbackNoPermission"]);
  if (list === "error") return refuseWith(502, ["intake.github"]);
  if (list === "tooMany") return refuseWith(503, ["intake.busy"]);
  const same = list.find((i) => ruleBlockOf(i.body) === block);
  if (same) return accepted(same.ref);
  if (list.filter((i) => i.open && i.title.startsWith(FEEDBACK_TITLE_HEAD)).length >= FEEDBACK_LIMITS.openIssues) return refuseWith(503, ["intake.busy"]);

  // 7. Issue を出す
  const r = await openIssue(gh, { title: feedbackTitle(f.file), body: feedbackBody(f.file), labels: FEEDBACK_LABELS });
  if (!r.ok) {
    if (r.why === "noPermission") return refuseWith(503, ["intake.feedbackNoPermission"]);
    if (r.why === "unlabeled") return refuseWith(503, ["intake.feedbackLabel"]);
    return refuseWith(502, ["intake.github"]);
  }
  return accepted(r);
}
