// 橋渡しの側のツールの受け手の一覧。AI に見せるどのツールにも、受け手（作業画面へ渡すか「未実装」）が 1 つある。
// 作ったものから "tab" に替える。tests/contract/ が数え、未実装の数を報告に出す。
// 作業画面へ渡すときの守り（§2.12）：渡すのは 1 回だけ、待ちの上限は種類ごと、答えは出力の型で確かめる。
// 星取表の行は、会話（中継の 1 つの接続）ごとにここで数える（タブを読み込み直しても数は戻らない）。
// 写真（photo_transcribe の receive）は、人だけの経路で人が許した画像（タブの回とハッシュに結んだもの）だけを渡し、
// 渡したら許しを使い終える。許しの無い画像・ほかのツールに添えた画像は渡さない。
import { createHash, randomBytes } from "node:crypto";
import { errorBody, type ErrorBody, type ErrorCode } from "../shared/errors";
import {
  INTAKE_ADD_MAX_REFUSED,
  INTAKE_ADD_NOTE,
  intakeAddFilesFromTabSchema,
  ROWS_PER_CONVERSATION,
  TOOL_TIMEOUTS,
  photoAllowSchema,
  photoImageSchema,
  toolDef,
  type PhotoImage,
  type ToolKind,
  type ToolName,
} from "../shared/tools";
import type { IntakeCollection } from "./intake-files";
import type { TabHub } from "./tab";

/**
 * tab：作業画面が答える。bridge：橋渡しが答える。tab_then_bridge：作業画面が渡した中身を、橋渡しが書く（読み方を保管先に書く）。
 * bridge_then_tab：橋渡しが選んだものを作業画面に渡し、作業画面が答える（資料を作業画面に入れる）
 */
export type ToolReceiver = "not_implemented" | "tab" | "bridge" | "tab_then_bridge" | "bridge_then_tab";

/** 橋渡しが答えるツール（保管先を読む・書く）。誤りは誤りの名前で返す */
export interface BridgeTools {
  /** 作業画面が今の施設を渡し、橋渡しが保管先を読む（本文は今の施設・自分の担当・会社の範囲だけ。台帳の中-4） */
  reading_skills_list?: (fromTab: Record<string, unknown>, args: Record<string, unknown>) => Promise<Record<string, unknown> | ErrorCode>;
  reading_skill_register?: (fromTab: Record<string, unknown>, args: Record<string, unknown>) => Promise<Record<string, unknown> | ErrorCode>;
  /** 作業画面が人の開いた比べを返したらそのまま、公開の台帳だけを読む頼みなら橋渡しが台帳を読んで比べる */
  peer_reference?: (fromTab: Record<string, unknown>, args: Record<string, unknown>) => Promise<Record<string, unknown> | ErrorCode>;
  /** 今の公開の台帳の clone の版（台帳を根拠にした周期の案を照らす。台帳の中-5） */
  ledger_version?: () => Promise<string | null>;
  /** 資料を作業画面に入れる：道を確かめて読む資料を選ぶ（中身は読まない。src/bridge/intake-files.ts） */
  intake_add_files?: (args: Record<string, unknown>) => Promise<IntakeCollection | ErrorCode>;
}

/** 作業画面に渡した資料の印が効く時間の余り（ツールの待ちの上限に足す） */
const STAGED_MARGIN_MS = 5_000;

/** 周期の案の根拠にしてよい似た施設の数（中央の帯が出る数。送る側の下限と同じ） */
export const LEDGER_BASIS_MIN_N = 5;

export const BRIDGE_TOOL_RECEIVERS: Record<ToolName, ToolReceiver> = {
  intake_survey: "tab",
  intake_settle: "tab",
  intake_compose: "tab",
  intake_add_files: "bridge_then_tab",
  photo_transcribe: "tab",
  crosswalk_propose: "tab",
  chart_rows: "tab",
  chart_propose: "tab",
  check_results: "tab",
  note_for_human: "not_implemented",
  share_preview: "not_implemented",
  peer_reference: "tab_then_bridge",
  reading_rules_propose: "tab",
  reading_skill_register: "tab_then_bridge",
  reading_skills_list: "tab_then_bridge",
  skill_eval: "not_implemented",
};

/** image は photo_transcribe の receive だけ（中継が MCP の画像の中身として添える） */
export type ToolAnswer = { ok: true; data: Record<string, unknown>; image?: PhotoImage } | ErrorBody;
const isOk = (a: ToolAnswer): a is { ok: true; data: Record<string, unknown>; image?: PhotoImage } => "ok" in a && a.ok === true;

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
  /** 添えた画像のバイト数（photo_transcribe の receive だけ） */
  imageBytes: number | null;
}

/** 台帳に持つ行の数の上限（橋渡しのメモリだけ。古いものから捨てる。会話ごとの合計は捨てない） */
export const OUTBOUND_MAX = 2000;

/** 人が許した写真 1 枚（人だけの経路 photo_allow で置く。タブの回のメモリだけ） */
interface PhotoPermit {
  sha256: string;
  bytes: number;
  width: number;
  height: number;
  at: string;
}

/** photo_allow の答え（人だけの経路。断るときは { ok: false, reason }） */
export type PhotoAllowOut = { ok: true; imageRef: string; sha256: string; at: string } | { ok: false; reason: "payloadInvalid" };

export class ToolRelay {
  /** 会話 → 読んだ星取表の行の数（答えを待つ間は、頼んだ数を先に取っておく） */
  private readonly rowsRead = new Map<string, number>();
  private readonly outbound: OutboundEntry[] = [];
  private readonly totals = new Map<string, { calls: number; bytes: number; rows: number; imageBytes: number }>();
  /** 会話 → この会話で読んだ公開の台帳の集計（版と、中央の帯が出た「項目|作業」）。台帳を根拠にした周期の案を照らす */
  /** 会話ごとに読んだ台帳の版と、中央の帯（似た施設 5 以上）が出た行の集計（項目|作業分類 → 数と帯） */
  private readonly ledgerRead = new Map<string, { version: string | null; median: Map<string, { n: number; median: string; q1: string; q3: string }> }>();
  /** タブの回 → 写真の imageRef → 人の許し */
  private readonly permits = new Map<string, Map<string, PhotoPermit>>();
  /** 作業画面に渡した資料の印 → その回・実体の道・大きさ（1 回取りに来ると使い終わる。呼び出しが終われば捨てる） */
  private readonly staged = new Map<string, { session: string; path: string; size: number; until: number }>();

  /** 外へ出た台帳（新しいものが後ろ） */
  outboundLog(): readonly OutboundEntry[] {
    return this.outbound;
  }

  /** 会話ごとの合計 */
  outboundTotals(conversation: string): { calls: number; bytes: number; rows: number; imageBytes: number } {
    return this.totals.get(conversation) ?? { calls: 0, bytes: 0, rows: 0, imageBytes: 0 };
  }

  private record(conversation: string, tool: ToolName, answer: ToolAnswer, rows: number | null): ToolAnswer {
    const ok = isOk(answer);
    const bytes = new TextEncoder().encode(JSON.stringify(ok ? answer.data : answer)).length;
    const imageBytes = ok && answer.image ? base64Bytes(answer.image.data) : null;
    this.outbound.push({ at: new Date().toISOString(), conversation, tool, ok, bytes, rows, imageBytes });
    if (this.outbound.length > OUTBOUND_MAX) this.outbound.splice(0, this.outbound.length - OUTBOUND_MAX);
    const t = this.outboundTotals(conversation);
    this.totals.set(conversation, { calls: t.calls + 1, bytes: t.bytes + bytes, rows: t.rows + (rows ?? 0), imageBytes: t.imageBytes + (imageBytes ?? 0) });
    return answer;
  }

  constructor(
    private readonly tabs: TabHub,
    private readonly timeouts: Partial<Record<ToolKind, number>> = {},
    private readonly bridgeTools: BridgeTools = {},
  ) {}

  rowsReadIn(conversation: string): number {
    return this.rowsRead.get(conversation) ?? 0;
  }

  /**
   * 人だけの経路（photo_allow）：人が画面で押した写真 1 枚を、そのタブの回と画像のハッシュに結んで許す。
   * ほかの回の許しは捨てる（タブは 1 つだけで、読み込み直すと回が変わる）。同じ写真を許し直すと入れ替わる。
   */
  allowPhoto(session: string, payload: string): PhotoAllowOut {
    let v: unknown;
    try {
      v = JSON.parse(payload);
    } catch {
      return { ok: false, reason: "payloadInvalid" };
    }
    const p = photoAllowSchema.safeParse(v);
    if (!p.success) return { ok: false, reason: "payloadInvalid" };
    for (const s of [...this.permits.keys()]) if (s !== session) this.permits.delete(s);
    const mine = this.permits.get(session) ?? new Map<string, PhotoPermit>();
    const at = new Date().toISOString();
    mine.set(p.data.imageRef, { sha256: p.data.sha256, bytes: p.data.bytes, width: p.data.width, height: p.data.height, at });
    this.permits.set(session, mine);
    return { ok: true, imageRef: p.data.imageRef, sha256: p.data.sha256, at };
  }

  /** 今の許しの数（試験と台帳の確かめ用。中身は返さない） */
  permitsIn(session: string): number {
    return this.permits.get(session)?.size ?? 0;
  }

  /**
   * 作業画面が経路 tabIntakeFile で資料を取りに来た：その回に渡した印で、まだ使っていないものだけ。1 回で使い終わる。
   * 中身は返さず、実体の道と大きさを返す（読むのは server.ts。選んだときと形が変わっていれば読まない）
   */
  takeStagedFile(session: string, fileId: string): { path: string; size: number } | null {
    const f = this.staged.get(fileId);
    if (!f) return null;
    this.staged.delete(fileId);
    if (f.session !== session || Date.now() > f.until) return null;
    return { path: f.path, size: f.size };
  }

  /** 今効いている資料の印の数（試験用。中身は返さない） */
  stagedCount(): number {
    return this.staged.size;
  }

  /** 公開の台帳の集計を読んだら、版と、中央の帯（似た施設 5 以上）が出た行を覚える（同じ会話の周期の案を照らす） */
  private rememberLedger(conversation: string, data: Record<string, unknown>): void {
    const aggs = (data.aggregates ?? []) as { place: string; commonItem: string; work: string; interval: { shown: string; n?: number; median?: string; q1?: string; q3?: string } }[];
    const median = new Map(
      aggs
        .filter((a) => a.place === "ledger" && a.interval.shown === "median" && (a.interval.n ?? 0) >= LEDGER_BASIS_MIN_N && a.interval.median && a.interval.q1 && a.interval.q3)
        .map((a) => [`${a.commonItem}|${a.work}`, { n: a.interval.n!, median: a.interval.median!, q1: a.interval.q1!, q3: a.interval.q3! }] as const),
    );
    const prev = this.ledgerRead.get(conversation);
    const version = typeof data.ledgerVersion === "string" ? data.ledgerVersion : null;
    // 同じ版なら足し合わせる（項目を絞って何度か読むため）。版が変わったら読み直したものだけ
    if (prev && prev.version === version) for (const [k, v] of median) prev.median.set(k, v);
    else this.ledgerRead.set(conversation, { version, median });
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
    const finish = (r: Record<string, unknown> | ErrorCode): ToolAnswer => {
      if (typeof r === "string") return fail(r);
      const p = def.output.safeParse(r);
      return p.success ? { ok: true, data: p.data as Record<string, unknown> } : fail("tab_bad_result");
    };
    if (BRIDGE_TOOL_RECEIVERS[name] === "bridge_then_tab") return this.addFiles(args, conversation);
    if (BRIDGE_TOOL_RECEIVERS[name] === "bridge") {
      const h = (this.bridgeTools as Record<string, ((a: Record<string, unknown>) => Promise<Record<string, unknown> | ErrorCode>) | undefined>)[name];
      return h ? finish(await h(args)) : fail("not_implemented");
    }

    // 台帳を根拠にした周期の案：今の台帳の版と、この会話で読んだ集計（似た施設が 5 以上）を照らしてから渡す（台帳の中-5）
    if (name === "chart_propose" && args.ledger) {
      const l = args.ledger as { ledgerVersion: string; commonItem: string; work: string };
      const seen = this.ledgerRead.get(conversation);
      const now = this.bridgeTools.ledger_version ? await this.bridgeTools.ledger_version() : null;
      const checked = seen?.median.get(`${l.commonItem}|${l.work}`);
      if (!seen || now === null || seen.version !== now || l.ledgerVersion !== now || !checked) return fail("ledger_basis_unchecked");
      // 照らした集計を作業画面に渡す（作業画面が、項目・作業分類・年数の合う作業にだけ L の案を置き、数を根拠に書く。Architect の 52）
      args = { ...args, ledger: { ...l, checked } };
    }

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
    if (BRIDGE_TOOL_RECEIVERS[name] === "tab_then_bridge") {
      const h =
        name === "reading_skill_register"
          ? this.bridgeTools.reading_skill_register
          : name === "peer_reference"
            ? this.bridgeTools.peer_reference
            : name === "reading_skills_list"
              ? this.bridgeTools.reading_skills_list
              : undefined;
      if (!h) return fail("not_implemented");
      const answer = finish(await h(out.data as Record<string, unknown>, args));
      if (name === "peer_reference" && isOk(answer) && answer.data.mode === "ledger") this.rememberLedger(conversation, answer.data);
      return answer;
    }

    const parsed = def.output.safeParse(out.data);
    if (!parsed.success) return fail("tab_bad_result");
    const data = parsed.data as Record<string, unknown>;
    // 取り込みの見本の行（見本・詰まっている所の行と見出し）も、会話の行の上限に数える（台帳の中-11）。残りを越える分は渡さない
    if (name === "intake_survey") {
      type Stuck = { header: unknown[]; rows: unknown[] };
      let left = Math.max(0, ROWS_PER_CONVERSATION - this.rowsReadIn(conversation));
      const take = <T>(xs: readonly T[]): T[] => {
        const kept = xs.slice(0, left);
        left -= kept.length;
        return kept;
      };
      const samples = take(data.samples as unknown[]);
      const stuck = (data.stuck as Stuck[]).map((x) => ({ ...x, header: take(x.header), rows: take(x.rows) }));
      const n = samples.length + stuck.reduce((m, x) => m + x.header.length + x.rows.length, 0);
      this.rowsRead.set(conversation, this.rowsReadIn(conversation) + n);
      data.samples = samples;
      data.stuck = stuck;
      setRows(n);
    }
    if (name === "chart_rows") {
      const n = (data.rows as unknown[]).length;
      // タブが上限を越えて返した・残りの数を違えて返したものは渡さない
      if (n > Number(sendArgs.limit) || data.remainingInConversation !== remaining - n) return fail("tab_bad_result");
      setRows(n);
    }
    // 画像は photo_transcribe の receive だけ。ほかのツールに添えたもの、receive に添えていないものは渡さない
    const wantsImage = name === "photo_transcribe" && args.mode === "receive";
    if (!wantsImage) return out.image ? fail("tab_bad_result") : { ok: true, data };
    const image = photoImageSchema.safeParse(out.image);
    const shape = data.image as { width: number; height: number; bytes: number } | null;
    if (!image.success || !shape || typeof data.imageRef !== "string") return fail("tab_bad_result");
    const bytes = Buffer.from(image.data.data, "base64");
    if (bytes.length !== shape.bytes) return fail("tab_bad_result");
    // 人が許した画像か：答えたタブの回の、その写真の許しと、ハッシュ・大きさ・形が合うものだけ
    const mine = this.permits.get(out.session);
    const permit = mine?.get(data.imageRef);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (!permit || permit.sha256 !== sha256 || permit.bytes !== bytes.length || permit.width !== shape.width || permit.height !== shape.height) {
      return fail("photo_permission_mismatch");
    }
    // 1 回渡すと使い終わる（もう一度渡すには、人がもう一度許す）
    mine?.delete(data.imageRef);
    return { ok: true, data, image: image.data };
  }

  /**
   * 資料を作業画面に入れる（intake_add_files）：橋渡しが道を確かめて資料を選び、資料ごとに 1 回きりの印を作って作業画面に渡す。
   * 作業画面は印で中身を取りに来て（経路 tabIntakeFile。タブの秘密とその回が要る）、人が落とした資料と同じ道で取り込み、
   * 入れた資料の名前と件数・断った名前と理由だけを返す。AI へは、それに大きさと、橋渡しで断ったものを足して返す（中身は返さない）。
   */
  private async addFiles(args: Record<string, unknown>, conversation: string): Promise<ToolAnswer> {
    const name = "intake_add_files" as const;
    const def = toolDef(name);
    const h = this.bridgeTools.intake_add_files;
    if (!h) return errorBody("not_implemented");
    const session = this.tabs.session;
    if (!session) return errorBody("work_screen_not_open");
    const c = await h(args);
    if (typeof c === "string") return errorBody(c);
    const ms = this.timeouts[def.kind] ?? TOOL_TIMEOUTS[def.kind].ms;
    const until = Date.now() + ms + STAGED_MARGIN_MS;
    const ids = c.files.map((f) => {
      const id = randomBytes(16).toString("base64url");
      this.staged.set(id, { session, path: f.path, size: f.size, until });
      return id;
    });
    try {
      const toTab = { source: c.source, pack: c.pack, facilityName: c.facilityName, files: c.files.map((f, i) => ({ fileId: ids[i]!, name: f.name, size: f.size })) };
      const remaining = Math.max(0, ROWS_PER_CONVERSATION - this.rowsReadIn(conversation));
      const out = await this.tabs.callTool(name, toTab, conversation, remaining, ms, true);
      if (out.kind === "no_tab") return errorBody("work_screen_not_open");
      if (out.kind === "no_answer") return errorBody("tab_no_answer");
      if (out.kind === "error") return errorBody(out.code);
      if (out.image) return errorBody("tab_bad_result");
      const tab = intakeAddFilesFromTabSchema.safeParse(out.data);
      if (!tab.success) return errorBody("tab_bad_result");
      // 作業画面が答えるのは、渡した資料の名前だけ（ほかの名前・同じ名前の重なりは型違い）
      const sizes = new Map(c.files.map((f) => [f.name, f.size]));
      const named = [...tab.data.added.map((a) => a.name), ...tab.data.refused.map((r) => r.name)];
      if (named.some((n) => !sizes.has(n)) || new Set(named).size !== named.length) return errorBody("tab_bad_result");
      const refused = [...c.refused, ...tab.data.refused];
      const data = {
        source: c.source,
        pack: c.pack,
        added: tab.data.added.map((a) => ({ name: a.name, bytes: sizes.get(a.name)!, sheets: a.sheets, rows: a.rows })),
        refused: refused.slice(0, INTAKE_ADD_MAX_REFUSED),
        refusedTotal: c.refusedTotal + tab.data.refused.length,
        others: c.others,
        note: INTAKE_ADD_NOTE,
      };
      const p = def.output.safeParse(data);
      return p.success ? { ok: true, data: p.data as Record<string, unknown> } : errorBody("tab_bad_result");
    } finally {
      for (const id of ids) this.staged.delete(id);
    }
  }
}

/** base64 の文字から、元のバイト数を数える */
function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}
