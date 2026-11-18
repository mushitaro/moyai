// 署名して確定したあと（運営者の判断 2026-11-18、Wire の AfterConfirm）：確定のダイアログを閉じたら、MOYAI のトップへ戻る。
// 作業中の計画を開いたままにしない（署名した計画をそのまま次の版にしない）。次の版は、人がトップの「＋ 次の版」を押したときだけ開く。
// 確定した版は作業中の中身をすべて持つので、その施設の作業中の写しは消す（トップに「作業中」を残さない）。
// 写しを書く手を止めてから、トップを読み込み直す（このタブの資料・作業中の計画をメモリから外す。署名した版は保管先にある）。
import type { BridgeClient } from "../bridge-client";
import { ROUTES } from "../../shared/routes";
import { workKeeper } from "./work";

/** 署名して確定した直後：作業中の写しを書く手を止める（確定のあとに受けた決定を消すなどで、写しを書き直さない） */
export function stopWorkAfterConfirm(): void {
  workKeeper()?.stop();
}

/** 確定のダイアログを閉じたとき：その施設の作業中の写しを消し、トップを読み込み直す */
export async function leaveToTop(client: BridgeClient, planId: string): Promise<void> {
  workKeeper()?.stop();
  try {
    await client.callHuman("work_discard", ROUTES.workDiscard.path, { planId });
  } catch {
    // 消せなくても、トップには戻る（トップの「作業中」から人が消せる）
  }
  location.hash = "#/";
  location.reload();
}
