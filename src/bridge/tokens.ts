// 1 回きりの印。橋渡しが作り、WebSocket でタブに渡す。操作の名前と中身のハッシュと、タブの回に結ぶ。
// 既定で 120 秒で切れ、1 回見たら（合っていても違っていても）消える。
import { randomBytes } from "node:crypto";
import type { ErrorCode } from "../shared/errors";
import type { HumanAction } from "../shared/routes";

export const TOKEN_TTL_MS = 120_000;

interface Entry {
  action: HumanAction;
  payloadHash: string;
  session: string;
  expiresAt: number;
}

export class TokenStore {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number = TOKEN_TTL_MS,
    private readonly now: () => number = Date.now,
  ) {}

  issue(action: HumanAction, payloadHash: string, session: string): { token: string; expiresAt: number } {
    this.purge();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = this.now() + this.ttlMs;
    this.entries.set(token, { action, payloadHash, session, expiresAt });
    return { token, expiresAt };
  }

  /** 使う。合っていれば null、違えば誤りの型。どちらでも印は消える。 */
  consume(token: string | undefined, action: HumanAction, payloadHash: string, session: string): ErrorCode | null {
    if (!token) return "token_missing";
    const e = this.entries.get(token);
    if (!e) return "token_unknown";
    this.entries.delete(token);
    if (this.now() > e.expiresAt) return "token_expired";
    if (e.action !== action || e.payloadHash !== payloadHash || e.session !== session) return "token_mismatch";
    return null;
  }

  /** タブが切れたら、そのタブの印をすべて消す。 */
  dropSession(session: string): void {
    for (const [k, e] of this.entries) if (e.session === session) this.entries.delete(k);
  }

  get size(): number {
    return this.entries.size;
  }

  private purge(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (t > e.expiresAt) this.entries.delete(k);
  }
}
