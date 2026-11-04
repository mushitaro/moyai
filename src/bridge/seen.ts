// この PC が見た版と署名（docs/plan.md §2.18.2。監査 A5）：計画ごとに、見た最大の版とその中身のハッシュ、見た署名のファイルの SHA-256 を、
// 状態フォルダ（seen.json）に覚える。保管先から末尾の版がまるごと消された・同じ番号の版が差し替えられた・承認や差し戻しの署名が消されたことに、
// 鎖だけでは気づけない（鎖は前の版を作った署名しか持たない）。覚えたものより下回ったら、確定・承認・戻す・送るを止める。
// 覚えるのは、確かめで合う版と署名だけ。止めたあとに戻す道（人が受け入れて覚え直す）は未実装。
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { PlanHistory } from "../plan/store";
import { readJson, writeJson } from "./places";

const FILE = "seen.json";

interface SeenPlan {
  version: number;
  contentHash: string;
  signatures: string[];
}

interface SeenFile {
  v: 1;
  plans: Record<string, SeenPlan>;
}

/** 保管先が違えば、同じ計画 ID でも別に覚える */
function slot(root: string, planId: string): string {
  return `${planId}@${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
}

function readSeen(stateDir: string): SeenFile {
  const f = readJson<SeenFile>(join(stateDir, FILE));
  return f && f.v === 1 && f.plans && typeof f.plans === "object" ? f : { v: 1, plans: {} };
}

export interface Vanished {
  /** 前に見た版（番号と中身のハッシュ）が無い・差し替えられた */
  version: number | null;
  /** 前に見た署名のファイルのうち、無くなった数 */
  signatures: number;
}

/**
 * 保管先の履歴を、前に見たものと照らす。消えたものがあれば Vanished を返し、覚え直さない。
 * 無ければ、確かめで合う版と署名を足して覚え、null を返す。
 */
export function checkSeen(stateDir: string, root: string, planId: string, h: PlanHistory): Vanished | null {
  const all = readSeen(stateDir);
  const key = slot(root, planId);
  const before = all.plans[key];
  const sigsNow = new Set(h.versions.flatMap((v) => v.signatures.map((s) => s.fileHash)));
  if (before) {
    const same = h.versions.find((v) => v.version === before.version);
    const versionGone = !same || same.contentHash !== before.contentHash ? before.version : null;
    const sigsGone = before.signatures.filter((x) => !sigsNow.has(x)).length;
    if (versionGone !== null || sigsGone > 0) return { version: versionGone, signatures: sigsGone };
  }
  const ok = h.versions.filter((v) => v.problem === null && !v.legacy);
  const top = ok.at(-1);
  if (!top) return null;
  const next: SeenPlan = {
    version: Math.max(top.version, before?.version ?? 0),
    contentHash: top.version >= (before?.version ?? 0) ? top.contentHash : before!.contentHash,
    signatures: [...new Set([...(before?.signatures ?? []), ...ok.flatMap((v) => v.signatures.map((s) => s.fileHash))])].sort(),
  };
  if (!before || before.version !== next.version || before.contentHash !== next.contentHash || before.signatures.length !== next.signatures.length) {
    writeJson(stateDir, FILE, { ...all, plans: { ...all.plans, [key]: next } });
  }
  return null;
}
