// 橋渡しの側のツールの受け手の一覧。AI に見せるどのツールにも、受け手（処理か「未実装」）が 1 つある。
// v0 はどれも「未実装」。作ったものから処理に替える。tests/contract/ が数え、未実装の数を報告に出す。
import type { ToolName } from "../shared/tools";

export type ToolReceiver = "not_implemented";

export const BRIDGE_TOOL_RECEIVERS: Record<ToolName, ToolReceiver> = {
  intake_survey: "not_implemented",
  intake_settle: "not_implemented",
  intake_compose: "not_implemented",
  photo_transcribe: "not_implemented",
  crosswalk_propose: "not_implemented",
  chart_rows: "not_implemented",
  chart_propose: "not_implemented",
  check_results: "not_implemented",
  note_for_human: "not_implemented",
  share_preview: "not_implemented",
  peer_reference: "not_implemented",
  skill_eval: "not_implemented",
};
