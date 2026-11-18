// 困りごとの付き物の「画面の名前」（2026-11-18）：設定を開く前にいた画面。決まった語だけ（src/share/app-feedback.ts の APP_FEEDBACK_SCREENS）。
// 道（hash）のほかの字（施設・版・資料の名前）は入れない。
import { APP_FEEDBACK_SCREENS, type AppFeedbackScreen } from "../../share/app-feedback";
import { routeOf } from "../stages";

/** 道（hash）→ 画面の名前 */
export function appScreenOf(hash: string): AppFeedbackScreen {
  const r = routeOf(hash || "#/");
  if (r.stage === "top") return "top";
  if (r.stage === "settings") return "settings";
  if (r.stage === "industries") return "industries";
  if (r.stage === "merge") {
    if (r.sheet === null) return "hoshitori";
    const name = `hoshitori.${r.sheet}`;
    return (APP_FEEDBACK_SCREENS as readonly string[]).includes(name) ? (name as AppFeedbackScreen) : "hoshitori";
  }
  return "other";
}

let last: AppFeedbackScreen = typeof location === "undefined" ? "top" : appScreenOf(location.hash);

/** 道が変わるたびに覚える（設定の画面は覚えない：設定を開く前の画面を残す） */
export function noteAppScreen(hash: string): void {
  const s = appScreenOf(hash);
  if (s !== "settings") last = s;
}

/** 設定を開く前にいた画面（設定から開いたなら settings） */
export function lastAppScreen(): AppFeedbackScreen {
  return last;
}

if (typeof window !== "undefined") window.addEventListener("hashchange", () => noteAppScreen(location.hash));
