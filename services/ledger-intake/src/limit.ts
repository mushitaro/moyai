// 受け口の濫用の防ぎ：同じ IP から 1 時間に 10 件まで（Workers の KV で数える）。
// - Rate Limiting の束縛は数える幅が 10 秒か 60 秒だけで、1 時間を数えられないので KV にした。
// - IP は残さない：鍵つきのハッシュ（HMAC-SHA256。鍵は GITHUB_TOKEN から作る）にして KV の名前に使い、値は受けた時刻の並びだけ。
//   KV の項目は、最後に受けてから 1 時間で消える（expirationTtl）。IP そのものは KV にもログにも答えにも出さない。
// - IPv6 は /64 を 1 つの送り手として数える（1 つの回線が持つ多くのアドレスで数をすり抜けさせない）。
// - KV は結果整合なので、別の拠点から同時に来ると 10 件を少し越えることがある（越える数は未確認）。
import { createHmac } from "node:crypto";

export const RATE_LIMIT = {
  /** 1 つの送り手が数える幅の中で出せる件数 */
  max: 10,
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

function v6prefix(ip: string): string | null {
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
  return `${all
    .slice(0, 4)
    .map((h) => h.padStart(4, "0"))
    .join(":")}::/64`;
}

/** 数える単位：IPv4 はそのまま、IPv6 は /64。読めなければ null（数えられないので受けない） */
export function clientBucket(ip: string | null): string | null {
  if (!ip) return null;
  const t = ip.trim();
  return v4(t) ?? v6prefix(t);
}

/** KV の名前：送り手の単位の鍵つきハッシュ（IP を戻せない形）。鍵が替わると数え直しになる */
export function bucketKey(secret: string, bucket: string): string {
  return `ip:${createHmac("sha256", secret).update(`moyai-ledger-intake/ip/1\n${bucket}`).digest("hex").slice(0, 32)}`;
}

export type Slot = { ok: true } | { ok: false; retryAfter: number };

/** 1 件を数える。幅の中で上限に届いていれば数えずに断り、次に受けられるまでの秒を返す */
export async function takeSlot(kv: KvLike, key: string, now: number): Promise<Slot> {
  const raw = await kv.get(key);
  let seen: number[] = [];
  if (raw !== null) {
    try {
      const j: unknown = JSON.parse(raw);
      if (Array.isArray(j)) seen = j.filter((t): t is number => typeof t === "number" && Number.isFinite(t));
    } catch {
      seen = [];
    }
  }
  seen = seen.filter((t) => t > now - RATE_LIMIT.windowMs && t <= now).sort((a, b) => a - b);
  if (seen.length >= RATE_LIMIT.max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((seen[0]! + RATE_LIMIT.windowMs - now) / 1000)) };
  }
  seen.push(now);
  await kv.put(key, JSON.stringify(seen), { expirationTtl: Math.ceil(RATE_LIMIT.windowMs / 1000) });
  return { ok: true };
}
