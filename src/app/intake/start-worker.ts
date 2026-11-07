// 画面のタブで、取り込みの worker を起こす（App が 1 回だけ呼ぶ）。worker を作れなければ undefined（作業場は同じスレッドの受け手を使う）。
// Vite はこの new Worker(new URL(...)) の形を見て、worker を別のファイルにビルドする。
// worker が起きたあとに止まったら（terminate・落ちた）、見張りの lock（alive.ts）で知り、作業場に「取り込み停止」を出させる。
import { localLocks, watchAlive } from "./alive";
import { WorkerEngine, type IntakeEngine } from "./engine";
import { IntakeHost } from "./intake-host";
import type { FromHost } from "./worker-protocol";

export function startIntakeWorker(): IntakeEngine | undefined {
  if (typeof Worker !== "function") return undefined;
  let w: Worker;
  try {
    w = new Worker(new URL("./intake.worker.ts", import.meta.url), { type: "module", name: "moyai-intake" });
  } catch {
    return undefined;
  }
  return new WorkerEngine(
    {
      post: (msg, transfer) => w.postMessage(msg, transfer),
      listen: (on, fail, gone) => {
        w.addEventListener("message", (e: MessageEvent<FromHost>) => {
          // 起きたら、worker が持つ見張りの lock を頼んで待つ（通ったら worker が止まった。alive.ts）
          if (e.data.kind === "ready" && e.data.alive) watchAlive(localLocks(), e.data.alive, gone);
          on(e.data);
        });
        w.addEventListener("error", (e) => {
          e.preventDefault();
          fail();
        });
      },
    },
    () => new IntakeHost(),
  );
}
