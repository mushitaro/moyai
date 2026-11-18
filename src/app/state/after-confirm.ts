// 署名して確定したあと（運営者の判断 2026-11-18 夜、Wire の AfterConfirm の view）：確定のダイアログを閉じたら、HOSHITORI のまま、
// 確定した版（第 n 版）の星取を見るだけで出し続ける。トップへは戻らない。編集できる次の版（作業中の写し）は作らない・開かない。
// 出力・共有のシートはこの版のまま使える。次の版は、人が「＋ 次の版」を押したときだけ開く。
// 確定した版は作業中の中身をすべて持つので、その施設の作業中の写しは消す（トップに「作業中」を残さない）。
// 写しを書く手を止め、確定した版を見るだけで開くリンク（see=1）に替えて読み込み直す（このタブの資料と作業中の計画をメモリから外す。
// 読み込み直しても、確定した版を見るだけで開く）。
import type { BridgeClient } from "../bridge-client";
import { ROUTES } from "../../shared/routes";
import { readHuman } from "../components/ConfirmDialog";
import { sheetHash } from "../stages";
import { workKeeper } from "./work";

/** 署名して確定した直後：作業中の写しを書く手を止める（確定のあとに受けた決定を消すなどで、写しを書き直さない） */
export function stopWorkAfterConfirm(): void {
  workKeeper()?.stop();
}

/** 確定した版を見るだけで開くリンク（星取表のシート） */
export function confirmedViewHash(planId: string, version: number, contentHash: string): string {
  return `${sheetHash("chart")}?open=${encodeURIComponent(planId)}&v=${version}&h=${contentHash.slice(0, 16)}&see=1`;
}

/** 確定のダイアログを閉じたとき：その施設の作業中の写しを消し、確定した版を見るだけで開き直す */
export async function showConfirmed(client: BridgeClient, planId: string): Promise<void> {
  workKeeper()?.stop();
  try {
    await client.callHuman("work_discard", ROUTES.workDiscard.path, { planId });
  } catch {
    // 消せなくても続ける（トップの「作業中」から人が消せる）
  }
  const r = readHuman<{ ok: boolean; versions: { version: number; contentHash: string }[] }>(await client.callHuman("plan_status", ROUTES.planStatus.path, { planId }));
  const top = r.ok ? r.body.versions.at(-1) : undefined;
  location.hash = top ? confirmedViewHash(planId, top.version, top.contentHash) : "#/";
  location.reload();
}
