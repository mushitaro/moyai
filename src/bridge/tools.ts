// 橋渡しの側のツールの受け手の一覧。AI に見せるどのツールにも、受け手（作業画面へ渡すか「未実装」）が 1 つある。
// 作ったものから "tab" に替える。tests/contract/ が数え、未実装の数を報告に出す。
// 作業画面へ渡すときの守り（§2.12）：渡すのは 1 回だけ、待ちの上限は種類ごと、答えは出力の型で確かめる。
// 星取表の行は、会話（中継の 1 つの接続）ごとにここで数える（タブを読み込み直しても数は戻らない）。
import { errorBody, type ErrorBody, type ErrorCode } from "../shared/errors";
import { ROWS_PER_CONVERSATION, TOOL_TIMEOUTS, toolDef, type ToolKind, type ToolName } from "../shared/tools";
import type { TabHub } from "./tab";

export type ToolReceiver = "not_implemented" | "tab";

export const BRIDGE_TOOL_RECEIVERS: Record<ToolName, ToolReceiver> = {
  intake_survey: "tab",
  intake_settle: "tab",
  intake_compose: "tab",
  photo_transcribe: "not_implemented",
  crosswalk_propose: "not_implemented",
  chart_rows: "tab",
  chart_propose: "not_implemented",
  check_results: "not_implemented",
  note_for_human: "not_implemented",
  share_preview: "not_implemented",
  peer_reference: "not_implemented",
  skill_eval: "not_implemented",
};

export type ToolAnswer = { ok: true; data: Record<string, unknown> } | ErrorBody;

export class ToolRelay {
  /** 会話 → 読んだ星取表の行の数 */
  private readonly rowsRead = new Map<string, number>();

  constructor(
    private readonly tabs: TabHub,
    private readonly timeouts: Partial<Record<ToolKind, number>> = {},
  ) {}

  rowsReadIn(conversation: string): number {
    return this.rowsRead.get(conversation) ?? 0;
  }

  /** 型を確かめた引数でツールを動かす。答えはいつも ToolAnswer（誤りも型どおり）。 */
  async run(name: ToolName, args: Record<string, unknown>, conversation: string): Promise<ToolAnswer> {
    if (BRIDGE_TOOL_RECEIVERS[name] === "not_implemented") return errorBody("not_implemented");
    const def = toolDef(name);
    const fail = (code: ErrorCode) => errorBody(code);

    let sendArgs = args;
    const used = this.rowsReadIn(conversation);
    const remaining = Math.max(0, ROWS_PER_CONVERSATION - used);
    if (name === "chart_rows") {
      if (remaining === 0) return fail("rows_limit_reached");
      // 1 回の上限は型が縛る。会話の残りより多くは渡させない
      sendArgs = { ...args, limit: Math.min(Number(args.limit), remaining) };
    }

    const ms = this.timeouts[def.kind] ?? TOOL_TIMEOUTS[def.kind].ms;
    const out = await this.tabs.callTool(name, sendArgs, conversation, remaining, ms, def.kind !== "read");
    if (out.kind === "no_tab") return fail("work_screen_not_open");
    if (out.kind === "no_answer") return fail("tab_no_answer");
    if (out.kind === "error") return fail(out.code);

    const parsed = def.output.safeParse(out.data);
    if (!parsed.success) return fail("tab_bad_result");
    const data = parsed.data as Record<string, unknown>;
    if (name === "chart_rows") {
      const rows = (data.rows as unknown[]).length;
      // タブが上限を越えて返した・残りの数を違えて返したものは渡さない
      if (rows > Number(sendArgs.limit) || data.remainingInConversation !== remaining - rows) return fail("tab_bad_result");
      this.rowsRead.set(conversation, used + rows);
    }
    return { ok: true, data };
  }
}
