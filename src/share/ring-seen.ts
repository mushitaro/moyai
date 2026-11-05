// 輪の仲間ごとに見た最大の seq（docs/plan.md §2.8「受け手は仲間ごとに見た最大の seq を覚え、減ったら知らせる」。台帳の D3）。
// 版の seen.json（bridge/seen.ts）と同じ形で、状態フォルダの ring-seen.json に覚える。鎖は前の束しか指さないので、
// 仲間の末尾の束がまるごと消されると鎖だけでは気づけない。覚えた seq より下回った仲間は chain.vanished で ✗ にする。
// 覚えるのは ✓ の束の seq だけで、下回ったときは覚え直さない。止めたあとに人が受け入れて覚え直す道は未実装。
import { createHash } from "node:crypto";
import { join } from "node:path";
import { readJson, writeJson } from "../bridge/places";
import type { RingRead } from "./ring";

const FILE = "ring-seen.json";

interface RingSeenFile {
  v: 1;
  /** `<輪ID>@<保管先のハッシュ先頭16>` → 鍵 ID → 見た最大の seq */
  rings: Record<string, Record<string, number>>;
}

/** 輪のフォルダの場所が違えば、同じ輪 ID でも別に覚える */
function slot(root: string, ringId: string): string {
  return `${ringId}@${createHash("sha256").update(root).digest("hex").slice(0, 16)}`;
}

function readFileOf(stateDir: string): RingSeenFile {
  const f = readJson<RingSeenFile>(join(stateDir, FILE));
  return f && f.v === 1 && f.rings && typeof f.rings === "object" ? f : { v: 1, rings: {} };
}

/** 前に見た、仲間ごとの最大の seq */
export function knownMaxSeq(stateDir: string, root: string, ringId: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const [k, v] of Object.entries(readFileOf(stateDir).rings[slot(root, ringId)] ?? {})) {
    if (/^[0-9a-f]+$/.test(k) && Number.isInteger(v) && v > 0) m.set(k, v);
  }
  return m;
}

/** 読んだ輪の ✓ の束の seq で、覚えた最大を上げる（下げない。消えた仲間は覚え直さない） */
export function rememberSeq(stateDir: string, root: string, ringId: string, read: Pick<RingRead, "bundles" | "members">): void {
  const all = readFileOf(stateDir);
  const key = slot(root, ringId);
  const cur = { ...(all.rings[key] ?? {}) };
  const vanished = new Set(read.members.filter((m) => m.reasons.includes("chain.vanished")).map((m) => m.key));
  let changed = false;
  for (const b of read.bundles) {
    if (b.status !== "ok" || b.seq === null || vanished.has(b.folder)) continue;
    if ((cur[b.folder] ?? 0) < b.seq) {
      cur[b.folder] = b.seq;
      changed = true;
    }
  }
  if (!changed) return;
  all.rings[key] = cur;
  writeJson(stateDir, FILE, all);
}
