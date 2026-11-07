// ヘッダの「Claude と並べる」（docs/screens.md §1。Wire、11-07）。
// - 出すのは、外のブラウザで、Windows で、橋渡しに接続中のときだけ。中のブラウザ（Claude Desktop の組み込み）・Windows 以外・未接続では出さない。
//   押せない理由の字は置かない（未接続は下の帯に出ている）。
// - 中のブラウザの見分け：User-Agent に「Electron」か「Claude」を含む。Windows の見分け：User-Agent Client Hints の platform が「Windows」か、User-Agent に「Windows」を含む。
// - 押すと橋渡しが窓を並べる（src/bridge/window-arrange.ts）。Claude Desktop の窓が無ければ、ボタンの右に text-3 で「Claude の窓なし」を 4 秒。
//   並べたときは字を出さない（窓が動くのが結果）。もう一度押せば並べ直す。元の位置には戻さない。
import { useEffect, useState, useSyncExternalStore } from "react";
import type { BridgeClient, ConnectionState } from "../bridge-client";
import type { WindowArrangeResult } from "../../shared/window-arrange";
import { TEXT } from "../text";

const S = TEXT.shell;

/** 「Claude の窓なし」を出しておく時間 */
export const NO_CLAUDE_NOTICE_MS = 4000;

/** ブラウザの見分けに使うもの（navigator の一部） */
export interface BrowserInfo {
  userAgent: string;
  userAgentData?: { platform?: string } | undefined;
}

/** 中のブラウザ（Claude Desktop の組み込み）か。User-Agent に Electron か Claude を含めば中と見る */
export function isInnerBrowser(b: BrowserInfo): boolean {
  return /Electron|Claude/.test(b.userAgent);
}

/** Windows で開いているか */
export function isWindowsBrowser(b: BrowserInfo): boolean {
  return b.userAgentData?.platform === "Windows" || /Windows/.test(b.userAgent);
}

/** ボタンを出すか：外のブラウザ・Windows・橋渡しに接続中のときだけ */
export function showArrangeButton(b: BrowserInfo, connection: ConnectionState): boolean {
  return connection.kind === "open" && isWindowsBrowser(b) && !isInnerBrowser(b);
}

function currentBrowser(): BrowserInfo {
  const n = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { userAgentData?: { platform?: string } });
  return { userAgent: n?.userAgent ?? "", userAgentData: n?.userAgentData };
}

export interface ArrangeView {
  /** 橋渡しの答えを待っている（その間に押しても、もう一度は頼まない） */
  busy: boolean;
  /** 「Claude の窓なし」を出している */
  noClaude: boolean;
}

/** 押したときの動き（React を持たない。試験は時計を進めて確かめる） */
export class ArrangeControl {
  private view: ArrangeView = { busy: false, noClaude: false };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly arrange: () => Promise<WindowArrangeResult>) {}

  readonly subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  readonly snapshot = (): ArrangeView => this.view;

  /** 押した。答えを返す（待っている間に押したときは null） */
  async press(): Promise<WindowArrangeResult | null> {
    if (this.view.busy) return null;
    this.clearTimer();
    this.set({ busy: true, noClaude: false });
    let r: WindowArrangeResult;
    try {
      r = await this.arrange();
    } catch {
      r = { ok: false, reason: "failed" };
    }
    const noClaude = !r.ok && r.reason === "no_claude_window";
    this.set({ busy: false, noClaude });
    if (noClaude) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.set({ ...this.view, noClaude: false });
      }, NO_CLAUDE_NOTICE_MS);
    }
    return r;
  }

  /** 画面から外れたとき（時計を止める） */
  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private set(v: ArrangeView): void {
    this.view = v;
    for (const fn of this.listeners) fn();
  }
}

/** ボタンと、その右の「Claude の窓なし」。字と大きさは「暗 / 明」と同じ（moyai-switch-item） */
export function ArrangeButtonView({ view, onPress }: { view: ArrangeView; onPress: () => void }) {
  return (
    <span className="moyai-arrange">
      <button type="button" className="moyai-switch-item" onClick={onPress} aria-busy={view.busy || undefined} data-testid="window-arrange">
        {S.arrange}
      </button>
      {view.noClaude && (
        <span className="moyai-arrange-note" role="status" data-testid="window-arrange-note">
          {S.arrangeNoClaude}
        </span>
      )}
    </span>
  );
}

/** ヘッダの右に置く。出す条件に合わなければ何も描かない。browser は試験だけが渡す */
export function ArrangeButton({ client, browser }: { client: BridgeClient; browser?: BrowserInfo }) {
  const connection = useSyncExternalStore(
    (cb) => {
      const off = client.subscribe(() => cb());
      return () => {
        off();
      };
    },
    () => client.connection,
    () => client.connection,
  );
  const [ctl] = useState(() => new ArrangeControl(() => client.arrangeWindows()));
  const view = useSyncExternalStore(ctl.subscribe, ctl.snapshot, ctl.snapshot);
  useEffect(() => () => ctl.dispose(), [ctl]);
  if (!showArrangeButton(browser ?? currentBrowser(), connection)) return null;
  return <ArrangeButtonView view={view} onPress={() => void ctl.press()} />;
}
