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
  crosswalk_propose: "tab",
  chart_rows: "tab",
  chart_propose: "not_implemented",
  check_results: "tab",
  note_for_human: "not_implemented",
  share_preview: "not_implemented",
  peer_reference: "not_implemented",
  skill_eval: "not_implemented",
};

export type ToolAnswer = { ok: true; data: Record<string, unknown> } | ErrorBody;
const isOk = (a: ToolAnswer): a is { ok: true; data: Record<string, unknown> } => "ok" in a && a.ok === true;

/** 外へ出た台帳の 1 行（AI に返した結果の種類・件数・大きさ。中身は残さない。§2.12） */
export interface OutboundEntry {
  at: string;
  conversation: string;
  tool: ToolName;
  ok: boolean;
  /** 返した JSON の UTF-8 のバイト数 */
  bytes: number;
  /** 星取表の行の数（chart_rows だけ） */
  rows: number | null;
}

/** 台帳に残す行の数の上限（古いものから捨てる。会話ごとの合計は捨てない） */
const OUTBOUND_MAX = 2000;

export class ToolRelay {
  /** 会話 → 読んだ星取表の行の数（答えを待つ間は、頼んだ数を先に取っておく） */
  private readonly rowsRead = new Map<string, number>();
  private readonly outbound: OutboundEntry[] = [];
  private readonly totals = new Map<string, { calls: number; bytes: number; rows: number }>();

  /** 外へ出た台帳（新しいものが後ろ） */
  outboundLog(): readonly OutboundEntry[] {
    return this.outbound;
  }

  /** 会話ごとの合計 */
  outboundTotals(conversation: string): { calls: number; bytes: number; rows: number } {
    return this.totals.get(conversation) ?? { calls: 0, bytes: 0, rows: 0 };
  }

  private record(conversation: string, tool: ToolName, answer: ToolAnswer, rows: number | null): ToolAnswer {
    const bytes = new TextEncoder().encode(JSON.stringify(isOk(answer) ? answer.data : answer)).length;
    this.outbound.push({ at: new Date().toISOString(), conversation, tool, ok: isOk(answer), bytes, rows });
    if (this.outbound.length > OUTBOUND_MAX) this.outbound.splice(0, this.outbound.length - OUTBOUND_MAX);
    const t = this.outboundTotals(conversation);
    this.totals.set(conversation, { calls: t.calls + 1, bytes: t.bytes + bytes, rows: t.rows + (rows ?? 0) });
    return answer;
  }

  constructor(
    private readonly tabs: TabHub,
    private readonly timeouts: Partial<Record<ToolKind, number>> = {},
  ) {}

  rowsReadIn(conversation: string): number {
    return this.rowsRead.get(conversation) ?? 0;
  }

  /** 型を確かめた引数でツールを動かす。答えはいつも ToolAnswer（誤りも型どおり）。 */
  async run(name: ToolName, args: Record<string, unknown>, conversation: string): Promise<ToolAnswer> {
    let reserved = 0;
    let rows: number | null = null;
    const answer = await this.runInner(name, args, conversation, (n) => (reserved = n), (n) => (rows = n));
    // 取っておいた行の数を、実際に返した行の数に置き換える（誤りなら 0）
    if (reserved) this.rowsRead.set(conversation, this.rowsReadIn(conversation) - reserved + (isOk(answer) ? (rows ?? 0) : 0));
    return this.record(conversation, name, answer, isOk(answer) ? rows : null);
  }

  private async runInner(
    name: ToolName,
    args: Record<string, unknown>,
    conversation: string,
    reserve: (n: number) => void,
    setRows: (n: number) => void,
  ): Promise<ToolAnswer> {
    if (BRIDGE_TOOL_RECEIVERS[name] === "not_implemented") return errorBody("not_implemented");
    const def = toolDef(name);
    const fail = (code: ErrorCode) => errorBody(code);

    let sendArgs = args;
    const used = this.rowsReadIn(conversation);
    const remaining = Math.max(0, ROWS_PER_CONVERSATION - used);
    if (name === "chart_rows") {
      if (remaining === 0) return fail("rows_limit_reached");
      // 1 回の上限は型が縛る。会話の残りより多くは渡させない。並べて呼ばれても越えないよう、頼む数を先に取っておく
      const limit = Math.min(Number(args.limit), remaining);
      sendArgs = { ...args, limit };
      this.rowsRead.set(conversation, used + limit);
      reserve(limit);
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
      const n = (data.rows as unknown[]).length;
      // タブが上限を越えて返した・残りの数を違えて返したものは渡さない
      if (n > Number(sendArgs.limit) || data.remainingInConversation !== remaining - n) return fail("tab_bad_result");
      setRows(n);
    }
    return { ok: true, data };
  }
}
