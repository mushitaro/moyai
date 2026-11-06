// 速さの試験（intake-200.test.ts）が node の worker_threads で起こす、取り込みの worker。
// 画面のタブの worker（src/app/intake/intake.worker.ts）と同じ受け手を、parentPort につなぐだけ。
import { parentPort } from "node:worker_threads";
import { IntakeHost } from "../../src/app/intake/intake-host";
import type { FromHost, ToHost } from "../../src/app/intake/worker-protocol";

const port = parentPort;
if (!port) throw new Error("worker_threads の中で起こす");
const host = new IntakeHost();
port.on("message", (msg: ToHost) => {
  void host.receive(msg).then((r) => {
    if (r) port.postMessage(r);
  });
});
port.postMessage({ kind: "ready" } satisfies FromHost);
