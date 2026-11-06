// 画面のタブで、取り込みの worker を起こす（App が 1 回だけ呼ぶ）。worker を作れなければ undefined（作業場は同じスレッドの受け手を使う）。
// Vite はこの new Worker(new URL(...)) の形を見て、worker を別のファイルにビルドする。
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
      listen: (on, fail) => {
        w.addEventListener("message", (e: MessageEvent<FromHost>) => on(e.data));
        w.addEventListener("error", (e) => {
          e.preventDefault();
          fail();
        });
      },
    },
    () => new IntakeHost(),
  );
}
