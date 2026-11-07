// 取り込みの worker（画面のタブの主のスレッドの外）。IntakeSession を持つ受け手（intake-host.ts）に、届いた通信を順に渡す。
// 起きたら ready を送る（主のスレッドは、それまで通信を持っておく）。通信の型は worker-protocol.ts。
// ready の前に、止まったことの見張りの lock を取る（alive.ts）。取れたら、その名前を ready に添える。
import { aliveName, holdAlive, localLocks } from "./alive";
import { IntakeHost } from "./intake-host";
import type { FromHost, ToHost } from "./worker-protocol";

interface WorkerScope {
  postMessage(msg: FromHost): void;
  onmessage: ((e: MessageEvent<ToHost>) => void) | null;
}

const scope = self as unknown as WorkerScope;
const host = new IntakeHost();

scope.onmessage = (e) => {
  void host.receive(e.data).then((r) => {
    if (r) scope.postMessage(r);
  });
};
holdAlive(localLocks(), aliveName(), (alive) => scope.postMessage(alive ? { kind: "ready", alive } : { kind: "ready" }));
