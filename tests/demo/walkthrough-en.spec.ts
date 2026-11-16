// デモの通し（英語の画面。2026-11-16、運営者「グローバル対応」）。台本の中身は walkthrough-flow.ts（日本語の通しと同じ）。
// ブラウザの言語を英語にし、設定に言語を置かない：画面は PC の言語（navigator.languages[0]）から英語を選ぶ。期待する字は画面と同じ表の英語。
// 使い方：npm run build のあと、npx playwright test -c playwright.demo.config.ts tests/demo/walkthrough-en.spec.ts
import { test } from "@playwright/test";
import { walkthrough } from "./walkthrough-flow";

test.use({ locale: "en-US" });
walkthrough("en");
