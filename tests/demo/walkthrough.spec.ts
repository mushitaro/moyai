// デモの通し（日本語の画面）。台本の中身は walkthrough-flow.ts。
// 使い方：npm run build のあと、MOYAI_SHOTS_DIR=docs/progress/shots/<日付>/demo npx playwright test -c playwright.demo.config.ts tests/demo/walkthrough.spec.ts
import { test } from "@playwright/test";
import { walkthrough } from "./walkthrough-flow";

test.use({ locale: "ja-JP" });
walkthrough("ja");
