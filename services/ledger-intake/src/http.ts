// 受け口の答えの形と、体の読み方（/submit と /feedback で同じ）。
import { reasonText } from "../../../src/app/text/reasons";

/** fine-grained のトークンの形（中身は見ない。空や改行入りを断るだけ） */
export const TOKEN_SHAPE = /^[A-Za-z0-9_]{20,255}$/;

export const HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function jsonReply(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
}

/** 断る：理由のコードと、その言葉 */
export function refuseWith(status: number, reasons: readonly string[], extra: Record<string, string> = {}): Response {
  const rs = [...new Set(reasons)];
  return jsonReply(status, { ok: false, reasons: rs, reasonsText: [...new Set(rs.map(reasonText))] }, extra);
}

/** 体を上限まで読む。上限を越えれば null（その先は読まない） */
export async function readLimited(req: Request, limit: number): Promise<Uint8Array | null> {
  const len = req.headers.get("content-length");
  if (len !== null && (!/^\d{1,12}$/.test(len) || Number(len) > limit)) return null;
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}
