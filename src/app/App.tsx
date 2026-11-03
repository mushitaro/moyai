// 画面の外枠：Mantine の設定、hash での画面の切り替え（作業画面・取り込み・星取表・Ed25519 の試験）、右下のビルドの印。
// 取り込みの作業場はこのタブで 1 つだけ作り、画面と AI のツールの受け手（intake/tab-tools.ts）が同じものを使う。
import { MantineProvider, createTheme } from "@mantine/core";
import { Suspense, lazy, useEffect, useState } from "react";
import { BuildStamp } from "./components/BuildStamp";
import { bridgeClient } from "./state/bridge";
import { Home } from "./pages/Home";
import { Intake } from "./pages/Intake";
import { IntakeWorkspace } from "./intake/workspace";
import { connectTabTools } from "./intake/tab-tools";
import { SelfTest } from "./pages/SelfTest";
import { CHART_HASH } from "./chart/route";
import { APP_PAGES } from "../shared/routes";

// 星取表は AG Grid を含むので、開いたときに読む
const StarTable = lazy(() => import("./pages/StarTable").then((m) => ({ default: m.StarTable })));

const theme = createTheme({
  fontFamily: "var(--moyai-font)",
  headings: { fontFamily: "var(--moyai-font)" },
  primaryColor: "teal",
  defaultRadius: "sm",
});

// 検問所と設定は人だけの画面（開いたときに読む）
const Checkpoint = lazy(() => import("./pages/Checkpoint").then((m) => ({ default: m.Checkpoint })));
const Settings = lazy(() => import("./pages/Settings").then((m) => ({ default: m.Settings })));
// 検査（開いたときに読む）
const Review = lazy(() => import("./pages/Review").then((m) => ({ default: m.Review })));

// タブの秘密を持つ接続は、このタブで 1 つだけ作る（state/bridge.ts。星取表・検問所・設定も同じ接続を使う）
// AI のツールの受け手は、つなぐ前に登録する
const workspace = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
const client = bridgeClient((c) => connectTabTools(c, workspace));

function useHash(): string {
  const [hash, setHash] = useState(location.hash || APP_PAGES.home);
  useEffect(() => {
    const on = () => setHash(location.hash || APP_PAGES.home);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}

export function App() {
  const hash = useHash();
  return (
    <MantineProvider theme={theme} defaultColorScheme="light">
      {hash === APP_PAGES.selftest ? (
        <SelfTest />
      ) : hash === APP_PAGES.checkpoint || hash === APP_PAGES.settings ? (
        <Suspense fallback={null}>{hash === APP_PAGES.checkpoint ? <Checkpoint /> : <Settings />}</Suspense>
      ) : hash === APP_PAGES.review ? (
        <Suspense fallback={null}>
          <Review />
        </Suspense>
      ) : hash === APP_PAGES.intake ? (
        <Intake ws={workspace} />
      ) : hash === CHART_HASH ? (
        <Suspense fallback={null}>
          <StarTable />
        </Suspense>
      ) : (
        <Home client={client} />
      )}
      <BuildStamp />
    </MantineProvider>
  );
}
