// 画面の骨組み（デザイン定義 §5.2）：上にヘッダ、下に状態の帯、その間を主の面がすべて使う。
// - ヘッダ（docs/screens.md 1）：左にしるし（飾り）、その右に段の列 MOYAI › MERGE › EXPORT › SHARE（今いる段だけ大きく墨、ほかは小さく淡い字）、
// 右に「Claude と並べる」（外のブラウザ・Windows・接続中だけ。ArrangeButton.tsx）、表示の明暗の切り替えと設定。しるしと「MOYAI」の間は、トップでは 10px（組み）、ほかの段では 40px。
// - 状態の帯（§10.21）：左に【架空】と橋渡しとのつながり（前の作業の写しが残っていれば、その右に「前の作業を戻す｜捨てる」）、右にビルドの印。画面の説明と「Claude に話す」の例は置かない（説明は Claude がする。運営者、2026-11-04）。
//   資料を読んでいる間だけ、つながりの右に読込の進み（「読込 37/200」）を出す。
// 【架空】は各画面が <FictionMark /> を置くと、ここの枠に出る（架空のデータの画面には常に出す）。
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { BridgeClient, ConnectionState } from "../bridge-client";
import type { IntakeWorkspace } from "../intake/workspace";
import { TEXT } from "../text";
import { APP_PAGES } from "../../shared/routes";
import { STAGE_HASH, routeOf, type Stage } from "../stages";
import { ArrangeButton } from "./ArrangeButton";
import { BrandMark } from "./BrandMark";
import { BuildStamp } from "./BuildStamp";

const S = TEXT.shell;

/** 状態の帯の【架空】の枠。画面の FictionMark がここへ描く。undefined は骨組みの外（その場に描く）、null は枠を作っている途中 */
export const FictionSlot = createContext<HTMLElement | null | undefined>(undefined);

const TABS: { stage: Stage; hash: string; en: string; ja: string }[] = [
  { stage: "merge", hash: STAGE_HASH.merge, ...S.tabs.merge },
  { stage: "export", hash: STAGE_HASH.export, ...S.tabs.export },
  { stage: "share", hash: STAGE_HASH.share, ...S.tabs.share },
];

function useConnection(client: BridgeClient): ConnectionState {
  const [state, setState] = useState<ConnectionState>({ kind: "connecting" });
  useEffect(() => client.subscribe((s) => setState(s)), [client]);
  return state;
}

function ThemeSwitch() {
  const { setColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("dark");
  const item = (value: "dark" | "light", label: string) => (
    <button
      type="button"
      className="moyai-switch-item"
      aria-pressed={scheme === value}
      onClick={() => setColorScheme(value)}
      data-testid={`theme-${value}`}
    >
      {label}
    </button>
  );
  return (
    <div className="moyai-switch" role="group" aria-label={S.themeLabel}>
      {item("dark", S.themeDark)}
      <span className="moyai-switch-sep" aria-hidden="true" />
      {item("light", S.themeLight)}
    </div>
  );
}

function Header({ client, hash }: { client: BridgeClient; hash: string }) {
  const stage = routeOf(hash).stage;
  return (
    <header className="moyai-header" data-top={stage === "top" ? "true" : "false"}>
      <span className="moyai-logo" aria-hidden="true">
        <BrandMark height={20} />
      </span>
      <nav className="moyai-tabs" aria-label={S.tabsLabel}>
        <a className="moyai-tab" href={APP_PAGES.home} title={S.home} data-testid="brand" aria-current={stage === "top" ? "page" : undefined}>
          {TEXT.appName}
        </a>
        {TABS.map((t) => (
          <span key={t.stage} className="moyai-stage">
            <span className="moyai-stage-sep" aria-hidden="true">
              ›
            </span>
            <a
              className="moyai-tab"
              href={t.hash}
              title={t.ja}
              aria-current={stage === t.stage ? "page" : undefined}
              data-testid={`tab-${t.stage}`}
            >
              {t.en}
            </a>
          </span>
        ))}
      </nav>
      <div className="moyai-header-end">
        <ArrangeButton client={client} />
        <ThemeSwitch />
        <a className="moyai-text-button" href={APP_PAGES.settings} aria-current={hash === APP_PAGES.settings || hash === APP_PAGES.industries ? "page" : undefined}>
          {S.settings}
        </a>
      </div>
    </header>
  );
}

/** 資料の読込の進み（読んでいる間だけ） */
function ReadProgress({ ws }: { ws: IntakeWorkspace }) {
  const p = useSyncExternalStore(
    (cb) => ws.subscribe(cb),
    () => ws.readProgress,
    () => ws.readProgress,
  );
  if (!p) return null;
  return (
    <span className="moyai-status-reading moyai-num" data-testid="read-progress" data-done={p.done} data-total={p.total}>
      {S.reading(p.done, p.total)}
    </span>
  );
}

function StatusBar({ client, workspace, onSlot, extra }: { client: BridgeClient; workspace?: IntakeWorkspace; onSlot: (el: HTMLElement | null) => void; extra?: ReactNode }) {
  const state = useConnection(client);
  return (
    <footer className="moyai-status">
      <div className="moyai-status-start">
        <span ref={onSlot} className="moyai-status-fiction" />
        {/* つなぎ直している間は text-3（Wire、11-06） */}
        <span className="moyai-status-connection" data-testid="connection" data-state={state.kind} style={state.kind === "reconnecting" ? { color: "var(--text-3)" } : undefined}>
          {TEXT.connection[state.kind]}
        </span>
        {extra}
        {workspace && <ReadProgress ws={workspace} />}
      </div>
      <BuildStamp />
    </footer>
  );
}

/** status：状態の帯の左に足すもの（前の作業を戻す帯。App.tsx） */
export function Shell({ client, hash, workspace, children, status }: { client: BridgeClient; hash: string; workspace?: IntakeWorkspace; children: ReactNode; status?: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <FictionSlot.Provider value={slot}>
      <div className="moyai-shell">
        <Header client={client} hash={hash} />
        <main className="moyai-main">{children}</main>
        <StatusBar client={client} workspace={workspace} onSlot={setSlot} extra={status} />
      </div>
    </FictionSlot.Provider>
  );
}

export function useFictionSlot(): HTMLElement | null | undefined {
  return useContext(FictionSlot);
}
