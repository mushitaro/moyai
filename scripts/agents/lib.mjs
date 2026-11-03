// 開発のエージェント（Managed Agents）の道具のうち、網に出ないで試せる部分。
// 仕事の仕様の読み方、呼ぶ前の止め方、費用の数え方、出力の置き場所、最初の指示の文。
import { createHash } from "node:crypto";
import { basename, resolve, sep } from "node:path";
import { budgetCheck } from "../api-spend.mjs";
import { costUsd } from "../audit/lib.mjs";

export const TASK_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** 1 回の上限として受ける最大の額（打ち間違いで大きな額を置かないため）。 */
export const MAX_SESSION_BUDGET_USD = 50;
/** Managed Agents の走らせた時間の値段（公開の値段、1 時間あたりの米ドル）。 */
export const RUNTIME_USD_PER_HOUR = 0.08;
/** 道具の呼び出しで止める名前。前の製品の名前と置き場所。 */
export const FORBIDDEN_IN_TOOL_INPUT = /hoshutaro|mxstage|woodygaragelab|mx stage/i;
/** モデルの識別子らしい文字列。台帳とファイルに書かない。 */
export const MODEL_ID_LIKE = /claude-[a-z0-9-]+|opus|sonnet|haiku|fable|mythos/i;

/**
 * 仕事の仕様（ops/tasks/*.md）を読む。頭の `---` で囲んだ所が設定、残りが本文。
 * 設定の値は JSON として読めればその値、読めなければ文字列。
 */
export function parseTaskSpec(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!m) throw new Error("仕事の仕様の頭に --- で囲んだ設定が無い");
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i <= 0) throw new Error(`設定の行が読めない：${line}`);
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    if (key in meta) throw new Error(`設定の名前が重なっている：${key}`);
    let value = raw;
    try {
      value = JSON.parse(raw);
    } catch {
      /* 文字列のまま */
    }
    meta[key] = value;
  }
  const body = m[2].trim();
  for (const k of ["id", "role", "agent", "environment", "budgetUsd", "timeoutMin"]) {
    if (meta[k] === undefined || meta[k] === "") throw new Error(`設定に ${k} が無い`);
  }
  if (typeof meta.id !== "string" || !TASK_ID.test(meta.id)) throw new Error(`id の形が違う：${meta.id}`);
  for (const k of ["role", "agent", "environment"]) {
    if (typeof meta[k] !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(meta[k])) throw new Error(`${k} の形が違う：${meta[k]}`);
  }
  if (typeof meta.budgetUsd !== "number" || !(meta.budgetUsd > 0) || meta.budgetUsd > MAX_SESSION_BUDGET_USD) {
    throw new Error(`budgetUsd は 0 より大きく $${MAX_SESSION_BUDGET_USD} 以下の数：${meta.budgetUsd}`);
  }
  if (typeof meta.timeoutMin !== "number" || !(meta.timeoutMin > 0) || meta.timeoutMin > 360) {
    throw new Error(`timeoutMin は 0 より大きく 360 以下の数：${meta.timeoutMin}`);
  }
  if (meta.verify !== undefined && !(Array.isArray(meta.verify) && meta.verify.every((c) => typeof c === "string" && c.trim()))) {
    throw new Error("verify は文字列の配列");
  }
  if (!body) throw new Error("仕事の仕様の本文が空");
  if (MODEL_ID_LIKE.test(text)) throw new Error("仕事の仕様にモデルの名前らしい語がある（config/models.json の役の名前だけを書く）");
  return { meta: { verify: [], ...meta }, body };
}

/** 米ドルを、セッションの上限に渡す形（セントの整数の文字列）にする。 */
export function budgetCents(usd) {
  const cents = Math.round(usd * 100);
  if (!Number.isFinite(cents) || cents <= 0) throw new Error(`上限の額が正しくない：${usd}`);
  return String(cents);
}

/** セッションの上限（hard な額）。 */
export function sessionBudget(usd) {
  return { type: "limit", max_list_cost: { amount: budgetCents(usd), currency: "USD" } };
}

/**
 * 呼ぶ前の確かめ。役が config に無い、または配分に届くなら止める。
 * 見込みには、そのセッションの上限の額をそのまま使う（上限を越えて使うことは、最後の 1 回の呼び出しの分しか無い）。
 * 台帳に読めない行か費用を計れなかった回が 1 件でもあれば止める（flaws は loadLedger の broken と unknown）。
 */
export function gate(config, ledgerRows, spec, flaws = { broken: 0, unknown: 0 }) {
  if (!config.roles?.[spec.role]) return { stop: true, reason: `役「${spec.role}」が config/models.json に無い` };
  return budgetCheck(config.budgetUsd, ledgerRows, spec.role, spec.budgetUsd, flaws);
}

/** 安定した順の JSON（鍵を並べる）。 */
export function stableJson(v) {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function specHash(obj) {
  return createHash("sha256").update(stableJson(obj)).digest("hex");
}

/**
 * エージェントの定義（ops/agents/<名前>.json）と system の文から、作る・直すときの本体を組む。
 * モデルと effort は config の役からだけ取る。定義のファイルに model を書いてはいけない。
 */
export function agentParams(def, config, systemText) {
  if ("model" in def) throw new Error("エージェントの定義に model を書かない（role から config/models.json を引く）");
  const role = config.roles?.[def.role];
  if (!role) throw new Error(`役「${def.role}」が config/models.json に無い`);
  if (!def.name || !Array.isArray(def.tools)) throw new Error("エージェントの定義に name と tools が要る");
  return {
    name: def.name,
    description: def.description ?? undefined,
    model: { id: role.model, effort: role.effort },
    system: systemText,
    tools: def.tools,
    metadata: { role: def.role, managedBy: "scripts/agents/dispatch.mjs" },
  };
}

/** 環境の定義から作る・直すときの本体を組む。 */
export function environmentParams(def) {
  if (!def.name || def.config?.type !== "cloud") throw new Error("環境の定義に name と config.type=cloud が要る");
  return { name: def.name, description: def.description ?? undefined, config: def.config, metadata: { managedBy: "scripts/agents/dispatch.mjs" } };
}

/** API の list_cost（{amount: セントの文字列, currency}）を米ドルにする。無ければ null。 */
export function listCostUsd(listCost) {
  if (!listCost || typeof listCost.amount !== "string") return null;
  if (listCost.currency !== "USD") throw new Error(`米ドルでない額：${listCost.currency}`);
  if (!/^(0|[1-9]\d*)$/.test(listCost.amount)) throw new Error(`額の形が違う：${listCost.amount}`);
  return Number(listCost.amount) / 100;
}

/**
 * トークンと走った時間から、公開の値段で数え直す（API の list_cost を照らすため）。
 * 5 分のキャッシュの書き込みは config の cacheWrite、1 時間のキャッシュの書き込みは入力の 2 倍で数える。
 * 値段が無ければ null（$0 と書かない）。
 */
export function recomputeUsd(usage, price) {
  if (!price) return null;
  const cc = usage?.cache_creation ?? {};
  const tokens = costUsd(
    {
      input_tokens: usage?.input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: cc.ephemeral_5m_input_tokens ?? 0,
    },
    price,
  );
  const oneHour = ((cc.ephemeral_1h_input_tokens ?? 0) * price.input * 2) / 1e6;
  const runtime = ((usage?.active_seconds ?? 0) / 3600) * RUNTIME_USD_PER_HOUR;
  return { tokens: tokens + oneHour, runtime, total: tokens + oneHour + runtime };
}

/**
 * 台帳の 1 行。usd は API が数えた額（list_cost）。無いときだけ数え直しの額を使い、どちらかを how に書く。
 * どちらも無ければ usd を null にする（$0 と書かない。null の行があると、次からは人が直すまで呼ばない）。
 */
export function ledgerRow({ at, role, task, sessionId, base, usage, wallSeconds, stopReason, recomputed, note }) {
  const api = listCostUsd(usage?.list_cost);
  const raw = api ?? recomputed?.total ?? null;
  const usd = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  const row = {
    at,
    role,
    where: "managed-agents",
    task,
    session: sessionId,
    base,
    usd: usd === null ? null : Math.round(usd * 10000) / 10000,
    how:
      api !== null
        ? "session.usage.list_cost（API が公開の値段で数えた額。セントに丸めてある）"
        : usd !== null
          ? "トークン×config の値段＋走った時間（list_cost が無かった）"
          : "計れなかった（list_cost も値段の表も無い）",
    recomputedUsd: recomputed && Number.isFinite(recomputed.total) ? Math.round(recomputed.total * 10000) / 10000 : null,
    usage: {
      input_tokens: usage?.input_tokens ?? 0,
      cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
      cache_creation_5m_input_tokens: usage?.cache_creation?.ephemeral_5m_input_tokens ?? 0,
      cache_creation_1h_input_tokens: usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0,
      output_tokens: usage?.output_tokens ?? 0,
      web_search_requests: usage?.server_tool_use?.web_search_requests ?? 0,
    },
    activeSeconds: usage?.active_seconds ?? null,
    wallSeconds,
    stopReason,
    note: note ?? "",
  };
  if (MODEL_ID_LIKE.test(`${row.note} ${row.how} ${row.role}`)) throw new Error("台帳の行にモデルの名前らしい語がある");
  return row;
}

/** セッションの出力を置く場所。仕事の id とファイル名を確かめ、root の外に出ないようにする。 */
export function outputPath(root, taskId, filename) {
  if (!TASK_ID.test(taskId)) throw new Error(`仕事の id の形が違う：${taskId}`);
  if (typeof filename !== "string" || !filename) throw new Error("ファイル名が空");
  if (/[\\/]/.test(filename) || filename === "." || filename === ".." || !/^[A-Za-z0-9._-]{1,128}$/.test(filename)) {
    throw new Error(`使えないファイル名：${filename}`);
  }
  const name = basename(filename);
  const dir = resolve(root, taskId);
  const p = resolve(dir, name);
  if (!p.startsWith(dir + sep)) throw new Error(`置き場所の外：${filename}`);
  return p;
}

/** 道具の呼び出しを人の代わりに決める（auto が決めきれずに止まったときだけ呼ばれる）。前の製品に触れるものは拒む。 */
export function decideToolUse(event) {
  const text = `${event?.name ?? ""} ${JSON.stringify(event?.input ?? {})}`;
  if (FORBIDDEN_IN_TOOL_INPUT.test(text)) return { allow: false, message: "前の製品の名前と置き場所には触れない決まり。別の道で進めること" };
  return { allow: true };
}

/** 流れの終わりを決める。requires_action は待つ。それ以外の idle と terminated で終わる。 */
export function streamStep(event) {
  if (event?.type === "session.status_terminated") return { done: true, stopReason: "terminated" };
  if (event?.type === "session.status_idle") {
    const t = event.stop_reason?.type ?? "unknown";
    if (t === "requires_action") return { done: false };
    return { done: true, stopReason: t };
  }
  return { done: false };
}

/** サンドボックスに渡す最初の指示。仕様の本文に、clone の仕方と出し方を足す。 */
export function buildKickoff({ spec, repoUrl, sha }) {
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`main の SHA の形が違う：${sha}`);
  const { id } = spec.meta;
  return [
    `# 仕事 ${id}`,
    "",
    "## 始め方（この順に）",
    "",
    `1. 公開のリポジトリを https で、鍵なしで clone する：\`git clone ${repoUrl} /workspace/moyai && cd /workspace/moyai && git checkout -b agent/${id} ${sha}\``,
    "2. `AGENTS.md` と、仕様が名指しする `docs/plan.md` の節を読む。",
    "3. 下の仕様のとおりに作る。試験を走らせ、通るまで直す。`node scripts/run-tests.mjs` と `node scripts/check-publish.mjs` も通す。",
    `4. 作業のコミットを 1 つ以上作る（\`git -c user.name=moyai-agent -c user.email=agent@moyai.invalid commit\`。文の最後の行は \`Co-Authored-By: Claude <noreply@anthropic.com>\`）。`,
    `5. \`mkdir -p /mnt/session/outputs && git format-patch --binary --stdout ${sha}..HEAD > /mnt/session/outputs/${id}.patch\` で、パッチを 1 つのファイルにする。`,
    `6. \`/mnt/session/outputs/report.md\` に、したこと・走らせた試験とその結果（件数）・できなかったこと・未確認のことを短く書く。`,
    "",
    "push はしない（鍵が無い）。パッチと report.md のほかに出力を置かない。",
    "",
    "## 仕様",
    "",
    spec.body,
    "",
  ].join("\n");
}
