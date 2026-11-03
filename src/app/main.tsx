// 画面の入口。
import "@mantine/core/styles.css";
// 書体：本文 IBM Plex Sans JP、数字 IBM Plex Mono。見出しと「MOYAI」の字も同じゴシック
import "@fontsource/ibm-plex-sans-jp/400.css";
import "@fontsource/ibm-plex-sans-jp/500.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
// 英字のタブと「MOYAI」の字だけ、横に広い Krona One（I が一本線）
import "@fontsource/krona-one/400.css";
import "../ui/tokens.css";
import "./theme.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
