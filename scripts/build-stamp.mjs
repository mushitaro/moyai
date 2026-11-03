// ビルドの印（`MOYAI · build <日時> JST · <コミット>`）の中身を、ビルドのときに作る。
// 画面（vite.config.ts）と CLI（vite.cli.config.ts）の両方がこれを使い、同じ値を埋める。
import { execFileSync } from "node:child_process";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** 日時は日本時間の「YYYY-MM-DD HH:mm」。コミットは短い形で、作業中の変更があれば「+」を付ける。 */
export function buildStamp(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const time = `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
  const commit = git(["rev-parse", "--short=7", "HEAD"]) || "unknown";
  const dirty = git(["status", "--porcelain", "--untracked-files=no"]) !== "";
  return { time, commit: dirty ? `${commit}+` : commit };
}
