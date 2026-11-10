// EXPORT の下の帯の押せない理由（docs/screens.md 3.5・§4 の 5）。押せないボタンには、いつも「理由：」の 1 行をボタンのすぐ左に出す。
// 画面の決め方を純粋な関数にする（試験で縛るため）。順は、ブリッジ → 計画 → 版の読込 → 確定版 → 署名と鎖。

export type ExportBlock =
  | { kind: "notConnected" }
  | { kind: "noPlan" }
  | { kind: "loading" }
  | { kind: "loadError"; message: string }
  | { kind: "notConfirmed" }
  | { kind: "broken" };

export interface ExportBlockInput {
  connected: boolean;
  hasPlan: boolean;
  /** 版の一覧（plan_status）の読込 */
  load: { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready" };
  hasLatest: boolean;
  broken: boolean;
}

/** 標準の出力・差分の出力を止めている理由（無ければ null） */
export function exportBlockOf(i: ExportBlockInput): ExportBlock | null {
  if (!i.connected) return { kind: "notConnected" };
  if (!i.hasPlan) return { kind: "noPlan" };
  if (i.load.kind === "loading") return { kind: "loading" };
  if (i.load.kind === "error") return { kind: "loadError", message: i.load.message };
  if (!i.hasLatest) return { kind: "notConfirmed" };
  if (i.broken) return { kind: "broken" };
  return null;
}

/** 理由の字（頭に「理由：」を付ける。すでに付いていれば重ねない） */
export function withReasonHead(text: string): string {
  return text.startsWith("理由：") ? text : `理由：${text}`;
}

// ─── 様式の行と、主ボタン 1 つ（docs/screens.md 3.5、運営者 2026-11-10「引き算」）───────────────
// 様式の欄の行が、画面の唯一の選び。主ボタンは 1 つで、字は「Excel を出力」か「署名して出力」の 2 つだけ。
// 列対応を決める・直すのは Claude（screen_set の templateLayout）。画面は見せて、人が 1 つ押す。

/** 列対応で、まだ決まっていない列の数（列の役目が「- 未定」の列。案〔layout〕のある列対応は案で決まっているので 0） */
export function undecidedOf(columns: { roles: readonly { kind: string }[]; layout?: unknown }): number {
  if (columns.layout) return 0;
  return columns.roles.filter((r) => r.kind === "none").length;
}

/** 選んだ行 */
export type ExportChoice =
  | { kind: "standard" }
  | { kind: "diff" }
  /** 保存先の様式（Claude の案が置かれていないもの） */
  | { kind: "template"; exported: boolean; approved: boolean; undecided: number }
  /** Claude が置いた列対応（Claude が入れた様式か、保存先の様式に置いた案）。hasLayout が false なら列対応はまだ無い。ready は様式のファイルを読んだか */
  | { kind: "claude"; hasLayout: boolean; ready: boolean };

/** 主ボタンを止める理由（前の段から） */
export type ExportStop = ExportBlock | { kind: "returned" } | { kind: "undecided"; n: number | null } | { kind: "reading" };

/**
 * 主ボタンがすること：plan 標準の Excel・report 差分・read 署名済みの書き出しを読む・sign 署名して書き出してから読む・
 * layout Claude の列対応と様式を保存先に置き、署名して書き出してから読む
 */
export type ExportAction = "plan" | "report" | "read" | "sign" | "layout";

export interface ExportPrimary {
  action: ExportAction;
  /** 字：excel「Excel を出力」、sign「署名して出力」 */
  label: "excel" | "sign";
  testid: "export-excel" | "export-sign" | "layout-output";
  stop: ExportStop | null;
}

/** 主ボタンの中身と、押せない理由。base は標準・差分と同じ止め方（exportBlockOf）。returned はいちばん新しい版が差し戻されたか */
export function exportPrimaryOf(choice: ExportChoice, base: ExportBlock | null, returned: boolean): ExportPrimary {
  switch (choice.kind) {
    case "standard":
      return { action: "plan", label: "excel", testid: "export-excel", stop: base };
    case "diff":
      return { action: "report", label: "excel", testid: "export-excel", stop: base };
    case "template": {
      if (choice.exported) return { action: "read", label: "excel", testid: "export-excel", stop: base };
      const stop: ExportStop | null = base ?? (returned ? { kind: "returned" } : choice.undecided > 0 ? { kind: "undecided", n: choice.undecided } : null);
      // 承認済みの列対応は「Excel を出力」（書き出しの署名は残す）。下書きは「署名して出力」
      return { action: "sign", label: choice.approved ? "excel" : "sign", testid: "export-sign", stop };
    }
    case "claude": {
      const stop: ExportStop | null = base ?? (returned ? { kind: "returned" } : !choice.hasLayout ? { kind: "undecided", n: null } : !choice.ready ? { kind: "reading" } : null);
      return { action: "layout", label: "sign", testid: "layout-output", stop };
    }
  }
}
