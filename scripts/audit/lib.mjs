// 監査の道具の純粋な部分（試験する）。API を呼ぶ部分は audit.mjs。
import { z } from "zod";

/** 監査に回さない差分（生成物・固定の依存の一覧・バイナリ）。 */
export const SKIP_PATTERNS = [/^package-lock\.json$/, /\.(xlsx|xlsm|pdf|png|jpe?g|woff2?)$/i, /^samples\/out\//, /^docs\/trend\.md$/];

/** 1 回の監査に入れる差分の上限（文字数）。越えた分は黙って捨てず「見ていない差分」として返す。 */
export const DIFF_CHAR_LIMIT = 300_000;

/**
 * git diff の全文をファイルごとに分け、監査に入れるものと入れないもの（理由つき）に分ける。
 * @param {string} diff
 */
export function planDiff(diff, limit = DIFF_CHAR_LIMIT) {
  const parts = diff.split(/^(?=diff --git )/m).filter((p) => p.startsWith("diff --git "));
  const included = [];
  const skipped = [];
  let used = 0;
  for (const part of parts) {
    const m = /^diff --git a\/(.+?) b\/(.+)$/m.exec(part);
    const file = m ? m[2] : "（名前を読めない差分）";
    if (SKIP_PATTERNS.some((re) => re.test(file))) {
      skipped.push({ file, reason: "監査に回さない種類（生成物・依存の固定・バイナリ）" });
      continue;
    }
    if (used + part.length > limit) {
      skipped.push({ file, reason: `差分が上限（${limit} 文字）を越えたので、この回では見ていない` });
      continue;
    }
    used += part.length;
    included.push({ file, text: part });
  }
  return { included, skipped, chars: used };
}

/** 監査の結果の型（構造化出力で受ける）。 */
export const AuditResult = z.object({
  summary: z.string(),
  findings: z.array(
    z.object({
      severity: z.enum(["blocker", "major", "minor"]),
      file: z.string(),
      line: z.number().int().nullable(),
      rule: z.string(),
      problem: z.string(),
      fix: z.string(),
    }),
  ),
  unchecked: z.array(z.string()),
});

/**
 * 使ったトークンから費用（米ドル）を出す。
 * @param {{input_tokens?: number, output_tokens?: number, cache_read_input_tokens?: number|null, cache_creation_input_tokens?: number|null}} usage
 * @param {{input: number, output: number, cacheRead: number, cacheWrite: number}} price
 */
export function costUsd(usage, price) {
  const m = 1_000_000;
  return (
    ((usage.input_tokens ?? 0) * price.input +
      (usage.output_tokens ?? 0) * price.output +
      (usage.cache_read_input_tokens ?? 0) * price.cacheRead +
      (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite) /
    m
  );
}

/**
 * 回ごとの結果の記録（.cache/audit/ に出し、CI では artifact に上げる）。モデルの識別子は書かない。
 * runKey は「回の番号-試みの番号」。手元の回は null。called は API を呼んだか。
 */
export function resultRecord({ base, head, role, runKey, called, pendingCount, result, skipped, usage, cost, stopReason }) {
  return { base, head, role, runKey, called, pendingCiRuns: pendingCount, result, skipped, usage, costUsd: cost, stopReason };
}

/** 結果を Markdown にする（Actions の要約に出す）。モデルの識別子は書かない。 */
export function renderMarkdown({ role, base, head, result, skipped, usage, cost, stopReason }) {
  const lines = [];
  lines.push(`## 監査（${role}）${base.slice(0, 7)}..${head.slice(0, 7)}`);
  lines.push("");
  if (!result) {
    lines.push(`監査の結果を受け取れませんでした（止まった理由：${stopReason}）。この差分は見ていません。`);
  } else {
    lines.push(result.summary);
    lines.push("");
    const order = { blocker: 0, major: 1, minor: 2 };
    const fs = [...result.findings].sort((a, b) => order[a.severity] - order[b.severity]);
    lines.push(`指摘 ${fs.length} 件（blocker ${fs.filter((f) => f.severity === "blocker").length}・major ${fs.filter((f) => f.severity === "major").length}・minor ${fs.filter((f) => f.severity === "minor").length}）`);
    lines.push("");
    for (const f of fs) {
      lines.push(`- **${f.severity}** \`${f.file}${f.line ? `:${f.line}` : ""}\` — ${f.problem}（決まり：${f.rule}）`);
      lines.push(`  - 直し：${f.fix}`);
    }
    if (result.unchecked.length) {
      lines.push("");
      lines.push("監査役が確かめられなかったこと：");
      for (const u of result.unchecked) lines.push(`- ${u}`);
    }
  }
  if (skipped.length) {
    lines.push("");
    lines.push("監査に入れなかった差分：");
    for (const s of skipped) lines.push(`- \`${s.file}\` — ${s.reason}`);
  }
  lines.push("");
  lines.push(
    `使ったトークン：入力 ${usage.input_tokens ?? 0}・キャッシュ読み ${usage.cache_read_input_tokens ?? 0}・キャッシュ書き ${usage.cache_creation_input_tokens ?? 0}・出力 ${usage.output_tokens ?? 0}。費用の見込み ${cost === null ? "計れない（値段の表に無い）" : `$${cost.toFixed(4)}`}`,
  );
  return lines.join("\n");
}
