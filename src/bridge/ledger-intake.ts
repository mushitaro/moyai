// 公開の台帳の受け口へ束を出す（GitHub のアカウントが無い人の道。運営者の決定 2026-11-07）。
// 通信の例外（docs/plan.md §2.12）：行き先は受け口の 1 つ（LEDGER_INTAKE_URL）だけ。送るのは、公開の台帳に載せるのと同じ束のファイル 1 つだけ。
// 受け口は運営者の GitHub のアカウントで台帳に PR を出し、PR の番号と URL を返す。行方は今と同じく、公開の PR をトークン無しで読む（github.ts の prStatus）。
// 出すのは、人が SHARE で送信経路「MOYAI 経由」を選び、主ボタン「署名して公開台帳へ送信」を押して束に署名したときだけ（AI のツールにしない）。
// 束の中身をログに出さない。fetch は差し替えられる（試験のため）。
// 転送（3xx）はたどらない：たどると、束が LEDGER_INTAKE_URL の外へ送られうる（行き先は 1 つだけ、の約束が崩れる）。

/**
 * 受け口の URL（https。末尾の /submit は付けない）。運営者が受け口をデプロイしてから入れる。
 * 空の間は、SHARE の送信経路に「MOYAI 経由」を出さない。
 */
export const LEDGER_INTAKE_URL: string = "";

export const INTAKE_SUBMIT_PATH = "/submit";
const TIMEOUT_MS = 60_000;
const LOOPBACK = /^http:\/\/(?:127\.0\.0\.1|localhost):\d{1,5}$/;

/** 受け口の URL を確かめる：https で、利用者名・問い合わせ・断片の無いものだけ。試験のときだけ、環境変数で 127.0.0.1 の試験の台に向けられる */
export function ledgerIntakeUrlOf(configured: string, env: NodeJS.ProcessEnv): string | null {
  const test = env.MOYAI_LEDGER_INTAKE_URL?.replace(/\/+$/, "");
  if (test && LOOPBACK.test(test)) return test;
  const c = configured.trim().replace(/\/+$/, "");
  if (!c) return null;
  try {
    const u = new URL(c);
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return null;
  }
}

export type IntakeFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal; redirect?: "error" },
) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface IntakeIo {
  /** 受け口の URL（ledgerIntakeUrlOf で確かめたもの） */
  url: string;
  fetch: IntakeFetch;
}

export type IntakeSend =
  | { ok: true; number: number; url: string; repo: { owner: string; name: string } }
  | { ok: false; reason: "network" | "refused" | "tooLarge" | "rateLimited" | "unavailable" | "badAnswer"; reasons: string[]; retryAfter?: number };

const PR_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,9})$/;
const CODE = /^[A-Za-z0-9._-]{1,80}$/;

/** 受け口が返した理由のコード（形の合うものだけ、50 まで。言葉はアプリの reasonText で出す） */
function codesOf(j: unknown): string[] {
  const rs = j && typeof j === "object" ? (j as { reasons?: unknown }).reasons : undefined;
  return Array.isArray(rs) ? [...new Set(rs.filter((r): r is string => typeof r === "string" && CODE.test(r)))].slice(0, 50) : [];
}

/** 束のファイル 1 つを受け口に出す。受け口が出した PR の番号・URL・台帳のリポジトリを返す */
export async function sendToIntake(io: IntakeIo, text: string): Promise<IntakeSend> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let status: number;
  let json: unknown = null;
  try {
    const r = await io.fetch(`${io.url}${INTAKE_SUBMIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json", "user-agent": "moyai" },
      body: text,
      signal: ctl.signal,
      redirect: "error",
    });
    status = r.status;
    try {
      json = await r.json();
    } catch {
      json = null;
    }
  } catch {
    return { ok: false, reason: "network", reasons: [] };
  } finally {
    clearTimeout(t);
  }
  const reasons = codesOf(json);
  if (status === 200) {
    const j = json && typeof json === "object" ? (json as { ok?: unknown; pr?: { number?: unknown; url?: unknown } }) : {};
    const number = typeof j.pr?.number === "number" && Number.isInteger(j.pr.number) && j.pr.number > 0 ? j.pr.number : null;
    const url = typeof j.pr?.url === "string" ? j.pr.url : "";
    const m = PR_URL.exec(url);
    if (j.ok !== true || number === null || !m || Number(m[3]) !== number) return { ok: false, reason: "badAnswer", reasons: [] };
    return { ok: true, number, url, repo: { owner: m[1]!, name: m[2]! } };
  }
  if (status === 400) return { ok: false, reason: "refused", reasons };
  if (status === 413) return { ok: false, reason: "tooLarge", reasons };
  if (status === 429) {
    // 次に受けられるまでの秒（受け口の答えの retryAfter。1 秒〜1 時間だけを受ける）
    const ra = json && typeof json === "object" ? (json as { retryAfter?: unknown }).retryAfter : undefined;
    return { ok: false, reason: "rateLimited", reasons, ...(typeof ra === "number" && Number.isInteger(ra) && ra >= 1 && ra <= 3600 ? { retryAfter: ra } : {}) };
  }
  if (status >= 500) return { ok: false, reason: "unavailable", reasons };
  return { ok: false, reason: "badAnswer", reasons };
}
