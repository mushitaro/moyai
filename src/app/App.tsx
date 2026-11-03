// 画面の外枠：Mantine の設定、hash での画面の切り替え、右下のビルドの印。
import { MantineProvider, createTheme } from "@mantine/core";
import { useEffect, useState } from "react";
import { BridgeClient } from "./bridge-client";
import { BuildStamp } from "./components/BuildStamp";
import { Home } from "./pages/Home";
import { SelfTest } from "./pages/SelfTest";
import { APP_PAGES } from "../shared/routes";

const theme = createTheme({
  fontFamily: "var(--moyai-font)",
  headings: { fontFamily: "var(--moyai-font)" },
  primaryColor: "teal",
  defaultRadius: "sm",
});

// タブの秘密を持つ接続は、このタブで 1 つだけ作る
const client = new BridgeClient(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
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
      {hash === APP_PAGES.selftest ? <SelfTest /> : <Home client={client} />}
      <BuildStamp />
    </MantineProvider>
  );
}
