// 受け口の濫用の防ぎ：同じ IP から 1 時間に 10 件まで（Workers の KV で数える）。
// - Rate Limiting の束縛は数える幅が 10 秒か 60 秒だけで、1 時間を数えられないので KV にした。
// - IP は残さない：鍵つきのハッシュ（HMAC-SHA256。鍵は GITHUB_TOKEN から作る）にして KV の名前に使い、値は受けた時刻の並びだけ。
//   KV の項目は、最後に受けてから 1 時間で消える（expirationTtl）。IP そのものは KV にもログにも答えにも出さない。
// - IPv6 は /64 を 1 つの送り手として数える（1 つの回線が持つ多くのアドレスで数をすり抜けさせない）。
// - あわせて、まわりの網（IPv4 は /24、IPv6 は /48）も 1 時間に 30 件までで数える。/48 を持つ人は /64 を 65,536 個持てるので、
//   /64 だけで数えると、署名だけ合わせた束で運営者のトークンの GitHub の呼び出しの上限を使い切れる（Security の点検 11-10 の中 2）。
// - KV は結果整合なので、別の拠点から同時に来ると 10 件を少し越えることがある（越える数は未確認）。PR の数は、別に GitHub の開いた PR で数える（handler.ts）。
import { createHmac } from "node:crypto";

export const RATE_LIMIT = {
  /** 1 つの送り手が数える幅の中で出せる件数 */
  max: 10,
  /** まわりの網（IPv4 の /24・IPv6 の /48）が数える幅の中で出せる件数 */
  networkMax: 30,
  /** 数える幅（ミリ秒） */
  windowMs: 60 * 60 * 1000,
} as const;

/** KV の読み書き（Workers の KVNamespace のうち、使うところだけ） */
export interface KvLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function v4(ip: string): string | null {
  const m = V4.exec(ip);
  if (!m) return null;
  const parts = m.slice(1, 5).map(Number);
  return parts.every((n) => n >= 0 && n <= 255) ? parts.join(".") : null;
}

/** IPv6 の 8 つの組（小文字・4 桁）。IPv4 を写した IPv6（::ffff:a.b.c.d）は IPv4 の字。読めなければ null */
function v6groups(ip: string): string[] | string | null {
  const s = ip.toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(s) || !s.includes(":")) return null;
  // IPv4 を写した IPv6（::ffff:a.b.c.d）は IPv4 として数える
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return v4(mapped[1]!);
  if (s.includes(".")) return null;
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 && fill < 1) return null;
  const all = [...head, ...Array<string>(fill).fill("0"), ...tail];
  if (all.length !== 8 || all.some((h) => !/^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => h.padStart(4, "0"));
}

function v6prefix(ip: string): string | null {
  const g = v6groups(ip);
  return g === null || typeof g === "string" ? g : `${g.slice(0, 4).join(":")}::/64`;
}

/** 数える単位：IPv4 はそのまま、IPv6 は /64。読めなければ null（数えられないので受けない） */
export function clientBucket(ip: string | null): string | null {
  if (!ip) return null;
  const t = ip.trim();
  return v4(t) ?? v6prefix(t);
}

/** まわりの網の単位：IPv4 は /24、IPv6 は /48。読めなければ null */
export function networkBucket(ip: string | null): string | null {
  if (!ip) return null;
  const t = ip.trim();
  const g = v4(t) ?? v6groups(t);
  if (g === null) return null;
  if (typeof g === "string") return `${g.split(".").slice(0, 3).join(".")}.0/24`;
  return `${g.slice(0, 3).join(":")}::/48`;
}

/** KV の名前：送り手の単位の鍵つきハッシュ（IP を戻せない形）。鍵が替わると数え直しになる */
export function bucketKey(secret: string, bucket: string): string {
  return `ip:${createHmac("sha256", secret).update(`moyai-ledger-intake/ip/1\n${bucket}`).digest("hex").slice(0, 32)}`;
}

export type Slot = { ok: true } | { ok: false; retryAfter: number };

/** 数える 1 つ：KV の名前と、幅の中で出せる件数 */
export interface SlotKey {
  key: string;
  max: number;
}

function seenOf(raw: string | null, now: number): number[] {
  let seen: number[] = [];
  if (raw !== null) {
    try {
      const j: unknown = JSON.parse(raw);
      if (Array.isArray(j)) seen = j.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    } catch {
      seen = [];
    }
  }
  return seen.filter((t) => t > now - RATE_LIMIT.windowMs && t <= now).sort((a, b) => a - b);
}

/**
 * 1 件を数える。どれか 1 つでも幅の中で上限に届いていれば、どれも数えずに断り、次に受けられるまでの秒を返す。
 * 届いていなければ、どれにも 1 件を足す
 */
export async function takeSlot(kv: KvLike, keys: readonly SlotKey[], now: number): Promise<Slot> {
  const seen = await Promise.all(keys.map(async (k) => seenOf(await kv.get(k.key), now)));
  let wait = 0;
  keys.forEach((k, i) => {
    const s = seen[i]!;
    // 上限に届いた数え方では、古い順に (件数 − 上限 + 1) 件が幅の外へ出たときに次を受けられる
    if (s.length >= k.max) wait = Math.max(wait, Math.ceil((s[s.length - k.max]! + RATE_LIMIT.windowMs - now) / 1000));
  });
  if (wait > 0 || keys.some((k, i) => seen[i]!.length >= k.max)) return { ok: false, retryAfter: Math.max(1, wait) };
  await Promise.all(
    keys.map((k, i) => kv.put(k.key, JSON.stringify([...seen[i]!, now].slice(-k.max)), { expirationTtl: Math.ceil(RATE_LIMIT.windowMs / 1000) })),
  );
  return { ok: true };
}
