// デモの輪（docs/plan.md §2.8「デモの輪は 7 拠点」・§5.1 `verify demo-ring`）の約束のファイル demo-ring.json と、その照らし。
// 束・仲間・決まりを確かめるのは、受け手と同じ verifyRing（ここでは判定を足さない）。ここがするのは 2 つだけ：
// 1. 確認済みに数える鍵を、約束のファイルから読む（デモでは、指紋を電話で読み合わせる代わりに、リポジトリのこのファイルを読み合わせた記録として使う）。
// 2. 受け手の結果が「全員 ✓、わざと入れた ✗ は約束の理由で ✗」かを照らす。約束に無い ✗ も、約束の ✗ が ✓ になるのも、理由が違うのも外れ。
import type { VerifyLine, VerifyReport } from "./checkpoint";
import { parseJsonStrict } from "./jcs";
import { HEX16 } from "./sign";

export const DEMO_RING_FILE = "demo-ring.json";
/**
 * リポジトリのデモの輪の ID（コミットした demo-ring/<輪ID>/）。verify demo-ring は、demo-ring.json の ring がこれと同じときだけ受ける
 * （自分で作った輪に demo-ring.json を置いて「全員 ✓」と出させないため）。道具で輪を作り直したら、ここも同じ変更で直す。
 */
export const DEMO_RING_ID = "280b431a5d3351ca";
export const DEMO_RING_V = "moyai.demo-ring/0";

export interface DemoRingManifest {
  v: typeof DEMO_RING_V;
  note: string;
  ring: string;
  month: string;
  /** 確認済みに数える鍵。拠点（site）と、わざと外れた束を置いた鍵（reject） */
  confirmed: { key: string; fingerprint: string; role: "site" | "reject" }[];
  /** ✗ になるはずの行（それ以外の行はすべて ✓ のはず） */
  expectNg: { kind: "member" | "bundle"; name: string; reasons: string[] }[];
}

const isStrArr = (x: unknown): x is string[] => Array.isArray(x) && x.every((y) => typeof y === "string");

/** 約束のファイルを読む。形が違えば null（推測で補わない） */
export function parseDemoRingManifest(text: string): DemoRingManifest | null {
  const p = parseJsonStrict(text);
  if (!p.ok) return null;
  const m = p.value as Partial<DemoRingManifest> | null;
  if (!m || typeof m !== "object" || m.v !== DEMO_RING_V || typeof m.ring !== "string" || !HEX16.test(m.ring) || typeof m.month !== "string") return null;
  if (!Array.isArray(m.confirmed) || m.confirmed.length === 0) return null;
  for (const c of m.confirmed) {
    if (!c || typeof c.key !== "string" || !HEX16.test(c.key) || typeof c.fingerprint !== "string" || (c.role !== "site" && c.role !== "reject")) return null;
  }
  if (!Array.isArray(m.expectNg)) return null;
  for (const e of m.expectNg) {
    if (!e || (e.kind !== "member" && e.kind !== "bundle") || typeof e.name !== "string" || !isStrArr(e.reasons) || e.reasons.length === 0) return null;
  }
  return m as DemoRingManifest;
}

export interface DemoRingJudge {
  ok: boolean;
  /** 約束に無いのに ✓ でない行 */
  unexpected: VerifyLine[];
  /** 約束の ✗ のうち、✗ にならなかったか、理由が違ったもの */
  unmet: { expect: DemoRingManifest["expectNg"][number]; got: VerifyLine | null }[];
  /** 拠点（site）の仲間のうち ✓ の数 */
  sitesOk: number;
  sites: number;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** 受け手の結果を、約束と照らす */
export function judgeDemoRing(report: VerifyReport, m: DemoRingManifest): DemoRingJudge {
  const key = (kind: string, name: string) => `${kind}\u0000${name}`;
  const expected = new Map(m.expectNg.map((e) => [key(e.kind, e.name), e]));
  const unexpected = report.lines.filter((l) => l.status !== "ok" && !expected.has(key(l.kind, l.name)));
  const unmet: DemoRingJudge["unmet"] = [];
  for (const e of m.expectNg) {
    const got = report.lines.find((l) => l.kind === e.kind && l.name === e.name) ?? null;
    if (!got || got.status !== "ng" || !sameSet(got.reasons, e.reasons)) unmet.push({ expect: e, got });
  }
  const siteKeys = new Set(m.confirmed.filter((c) => c.role === "site").map((c) => c.key));
  const sitesOk = report.lines.filter((l) => l.kind === "member" && siteKeys.has(l.name) && l.status === "ok").length;
  const ok = report.ringId === m.ring && unexpected.length === 0 && unmet.length === 0 && report.notBundleFiles === 0 && sitesOk === siteKeys.size;
  return { ok, unexpected, unmet, sitesOk, sites: siteKeys.size };
}
