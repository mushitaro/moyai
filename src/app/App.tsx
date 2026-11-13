// 画面の外枠：Mantine の設定、hash での段の切り替え（トップ・HOSHITORI・設定・Ed25519 の試験。src/app/stages.ts。出力と共有は HOSHITORI のシート）、右下のビルドの印。
// 取り込みの作業場はこのタブで 1 つだけ作り、画面と AI のツールの受け手（intake/tab-tools.ts）が同じものを使う。
// 資料を読み、読み取るのは worker（intake/intake.worker.ts）。主のスレッドは写しを読むので、資料が多くても画面は止まらない。
import { MantineProvider, useComputedColorScheme } from "@mantine/core";
import { Suspense, lazy, useEffect, useState } from "react";
import { Shell } from "./components/Shell";
import { ERROR_TEXT } from "./text";
import { bridgeClient, useConnection } from "./state/bridge";
import type { LoadedReading } from "../import/reading";
import { Home } from "./pages/Home";
import { Merge } from "./pages/Merge";
import { routeOf } from "./stages";
import { IntakeWorkspace } from "./intake/workspace";
import { connectTabTools } from "./intake/tab-tools";
import { startIntakeWorker } from "./intake/start-worker";
import { SelfTest } from "./pages/SelfTest";
import { APP_PAGES, ROUTES } from "../shared/routes";
import { moyaiCssVariables, moyaiTheme } from "../ui/mantine-theme";
import { WorkKeeper, installWorkKeeper, type WorkState } from "./state/work";
import { guardLeave, planStateOf, type LeaveState } from "./state/leave";
import { getWorkingPlan, subscribeWorkingPlan } from "./state/plan-store";
import { acceptedList } from "./state/decisions";
import { STAGE_HASH, canonicalHash } from "./stages";

// 設定は人だけの画面（開いたときに読む。共有と出力は HOSHITORI のシートが開いたときに読む）
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
// 【業種】（設定からのリンク。設備の地図。開いたときに読む）
const Industries = lazy(() => import("./pages/Industries").then((m) => ({ default: m.Industries })));

// タブの秘密を持つ接続は、このタブで 1 つだけ作る（state/bridge.ts。星取表・検問所・設定も同じ接続を使う）
// AI のツールの受け手は、つなぐ前に登録する
const workspace = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false }, startIntakeWorker());
const client = bridgeClient((c) => connectTabTools(c, workspace));

// 施設ごとの作業中（#82）：資料の写し・答え・作業中の計画・確定のシートの確定を、変わるたびに保管先へ残す（作業画面だけの道。src/bridge/work.ts）。
// 前の作業を戻す帯（IndexedDB の写し・資料なし）は引いた。戻すのはトップの「作業中」から
const b64 = (bytes: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
installWorkKeeper(
  new WorkKeeper({
    ws: workspace,
    build: `${__MOYAI_BUILD__.time} ${__MOYAI_BUILD__.commit}`,
    port: {
      putSource: async (planId, bytes) => {
        const r = await client.workCall(ROUTES.tabWorkSource.path, { planId, base64: b64(bytes) });
        return r?.ok === true && typeof r.sha256 === "string" && typeof r.size === "number" ? { ok: true, sha256: r.sha256, size: r.size } : { ok: false, reason: String(r?.reason ?? "network") };
      },
      save: async (state) => {
        const r = await client.workCall(ROUTES.tabWorkSave.path, { state });
        return { ok: r?.ok === true, ...(typeof r?.reason === "string" ? { reason: r.reason } : {}) };
      },
      read: async (planId) => {
        const r = await client.workCall(ROUTES.tabWorkRead.path, { planId });
        return r?.ok === true ? (r.state as WorkState) : null;
      },
      source: (planId, sha256) => client.workSource(planId, sha256),
    },
  }),
);

/** 閉じる前の知らせに使う、今の作業（資料・答え・作業中の計画・確定のシートの確定） */
function leaveState(): LeaveState {
  const plan = planStateOf(getWorkingPlan());
  return {
    files: workspace.fileCount,
    // 資料と答えが保管先の版に入っている：その版の資料を戻したか、このタブで作ったあと、資料も答えも変えていない
    filesInStored: !workspace.notRecomposed() && (workspace.restoredFrom !== null || workspace.compose.state === "done"),
    accepted: acceptedList().length,
    plan,
  };
}
guardLeave(window, leaveState);

// 作業（資料か作業中の計画）があるかを橋渡しに知らせる。作業のあるタブは、あとから開いたタブに渡さない（#46。作業はタブのメモリにある）
const reportWork = () => client.setWork(workspace.fileCount > 0 || getWorkingPlan() !== null);
workspace.subscribe(reportWork);
subscribeWorkingPlan(reportWork);
reportWork();

/** 前の段の道（#/export・#/share・#/checkpoint）は、HOSHITORI のシートの道に置き換える（履歴は増やさない） */
function currentHash(): string {
  const now = location.hash || APP_PAGES.home;
  const to = canonicalHash(now);
  if (!to) return now;
  history.replaceState(history.state, "", to);
  return to;
}

/**
 * 今の hash と、版の画面（merge）の外へ出た回数。外へ出て戻ったら、版の画面は前の状態を持ち越さず開き直す（key に使う）。
 * 外へ出る移動と戻る移動が描き直しの前に続いても（hash だけの移動が 2 つ続くと、描き直しは 1 回にまとまる）、外へ出たことは数える。
 * 数えないと、前に開いたリンクの状態（受け取った・ほかの鍵が受け取っていた）が残り、同じリンクを開き直しても「受け取る」が出ない
 */
function useHash(): { hash: string; left: number } {
  const [state, setState] = useState(() => ({ hash: currentHash(), left: 0 }));
  useEffect(() => {
    const on = (e: HashChangeEvent) => {
      const hash = currentHash();
      // 外へ出たかは、その移動の行き先（newURL）で見る。今の location.hash は、続いた移動の最後の行き先になっている
      const out = routeOf(new URL(e.newURL).hash || "#/").stage !== "merge";
      setState((s) => ({ hash, left: out ? s.left + 1 : s.left }));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return state;
}

// 役割のトークン（src/ui/tokens.css）は暗が既定で、明は html の data-theme="light" で入れ替える
function ThemeSync() {
  const scheme = useComputedColorScheme("dark", { getInitialValueInEffect: false });
  useEffect(() => {
    document.documentElement.dataset.theme = scheme;
  }, [scheme]);
  return null;
}

/** 橋渡しとつながったら、保管先の承認済みの読み方（3 段目の Skill）を作業画面に読み込む（docs/plan.md §2.17） */
function ReadingsSync() {
  const { state } = useConnection();
  useEffect(() => {
    if (state.kind !== "open") return;
    void (async () => {
      const r = await client.callHuman("readings_read", ROUTES.readingsRead.path, {});
      if (r.ok && (r.body as { ok?: boolean }).ok) workspace.setApprovedReadings(((r.body as { readings?: LoadedReading[] }).readings ?? []) as LoadedReading[]);
    })();
  }, [state.kind]);
  return null;
}

export function App() {
  const { hash, left } = useHash();
  const route = routeOf(hash);
  const { state } = useConnection();
  // 作業のあるタブがほかに開いている（#46）：このタブは 1 行だけにする（中身を出さない。操作できるものを置かない）
  if (state.kind === "refused" && state.code === "tab_elsewhere") {
    return (
      <MantineProvider theme={moyaiTheme} cssVariablesResolver={moyaiCssVariables} defaultColorScheme="auto">
        <ThemeSync />
        <p className="moyai-elsewhere" data-testid="refused" data-code="tab_elsewhere">
          {ERROR_TEXT.tab_elsewhere}
        </p>
      </MantineProvider>
    );
  }
  return (
    <MantineProvider theme={moyaiTheme} cssVariablesResolver={moyaiCssVariables} defaultColorScheme="auto">
      <ThemeSync />
      <ReadingsSync />
      <Shell client={client} hash={hash} workspace={workspace}>
      {route.stage === "selftest" ? (
        <SelfTest />
      ) : route.stage === "settings" ? (
        <Suspense fallback={null}>
          <Settings />
        </Suspense>
      ) : route.stage === "industries" ? (
        <Suspense fallback={null}>
          <Industries />
        </Suspense>
      ) : route.stage === "merge" ? (
        <Merge key={left} ws={workspace} client={client} sheet={route.sheet} />
      ) : (
        <Home client={client} />
      )}
      </Shell>
    </MantineProvider>
  );
}
