// 網の外側の守り：Host・Origin・Sec-Fetch-Site。DNS リバインディングは Host で断る。
// これは Web ページへの対策で、同じ PC のプロセスは防がない（curl も Node も Origin を偽れる）。
import type { ErrorCode } from "../shared/errors";

export function allowedHosts(port: number): string[] {
  return [`127.0.0.1:${port}`, `localhost:${port}`];
}

export function allowedOrigins(port: number): string[] {
  return allowedHosts(port).map((h) => `http://${h}`);
}

/** Host の見出しが自分の名前とポートか。違えば DNS リバインディングか、別の宛先への要求。 */
export function checkHost(host: string | undefined, port: number): ErrorCode | null {
  if (!host) return "host_not_allowed";
  return allowedHosts(port).includes(host.toLowerCase()) ? null : "host_not_allowed";
}

/**
 * Origin を確かめる。required のときは無ければ断る（POST と WebSocket）。
 * あれば、Host と同じ名前の自分の出どころでなければ断る。
 */
export function checkOrigin(origin: string | undefined, host: string | undefined, port: number, required: boolean): ErrorCode | null {
  if (!origin) return required ? "origin_missing" : null;
  const expected = `http://${String(host ?? "").toLowerCase()}`;
  return allowedOrigins(port).includes(origin) && origin === expected ? null : "origin_not_allowed";
}

/**
 * Sec-Fetch-Site を確かめる。ブラウザはこれを偽らせない。
 * 人だけの経路は same-origin だけ。静的ファイルは same-origin と none（人がアドレスを打った）を受ける。
 * 見出しが無いのはブラウザでない呼び手で、ここでは断らず、Origin と秘密で断る。
 */
export function checkFetchSite(value: string | undefined, allowNone: boolean, page?: { method: string; mode: string | undefined; dest: string | undefined }): ErrorCode | null {
  if (value === undefined) return null;
  if (value === "same-origin") return null;
  if (allowNone && value === "none") return null;
  // 人がリンクで開いたページ（メールのリンクなど）：静的ファイルの経路だけ、ほかのサイトからでも GET の navigate・document を受ける（台帳の中-16）。
  // 人だけの経路と WebSocket は渡さないので、今のまま same-origin とタブの秘密を求める
  if (page && page.method === "GET" && page.mode === "navigate" && page.dest === "document") return null;
  return "fetch_site_not_allowed";
}
