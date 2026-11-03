// 画面の外枠：Mantine の設定、hash での画面の切り替え（作業画面・取り込み・星取表・Ed25519 の試験）、右下のビルドの印。
// 取り込みの作業場はこのタブで 1 つだけ作り、画面と AI のツールの受け手（intake/tab-tools.ts）が同じものを使う。
import { MantineProvider, createTheme } from "@mantine/core";
import { Suspense, lazy, useEffect, useState } from "react";
import { BridgeClient } from "./bridge-client";
import { BuildStamp } from "./components/BuildStamp";
import { Home } from "./pages/Home";
import { Intake } from "./pages/Intake";
import { IntakeWorkspace } from "./intake/workspace";
import { runTabTool } from "./intake/tab-tools";
import { TEXT } from "./text";
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

// タブの秘密を持つ接続は、このタブで 1 つだけ作る
const client = new BridgeClient(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
const workspace = new IntakeWorkspace({ packId: "", facilityName: "", fiscalYearStartMonth: 4, fictional: false });
client.setToolHandlers({
  call: async (name, args, ctx) => runTabTool(workspace, name, args, ctx),
  unknown: (name) => workspace.note("unknown", TEXT.intake.activity.unknown(name)),
});
client.connect();

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
