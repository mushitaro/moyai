// 取り込みの worker が止まったことの見張り（Web Locks）。docs/screens.md 3.3「止まった知らせ」の「取り込み停止」に使う。
// worker は起きたら、自分だけの名前の lock を取り、持ったまま ready を送る（離さない）。主のスレッドは同じ名前の lock を頼んで待つ。
// worker が止まる（terminate・落ちる）と lock が離れ、主のスレッドの頼みが通る。通ったら止まったとみなす。
// 重い読み取りで worker が答えないあいだも lock は持ったままなので、止まったとみなさない（時間の上限では決めない）。

/** Web Locks のうち、ここで使う形（ブラウザの navigator.locks。試験は同じ形の偽物を渡す） */
export interface AliveLocks {
  request(name: string, callback: () => unknown): Promise<unknown>;
}

/** worker ごとの lock の名前（タブの中でも、ほかのタブとも重ならない） */
export function aliveName(): string {
  const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `moyai-intake-alive-${id}`;
}

/**
 * worker の側：lock を取ってから held(name) を呼ぶ。取った lock は worker が止まるまで離さない。
 * locks が無い（Web Locks の無いブラウザ・安全でない場所）か取れなければ held(null)（見張りなしで続ける）
 */
export function holdAlive(locks: AliveLocks | undefined, name: string, held: (name: string | null) => void): void {
  if (!locks) return held(null);
  let granted = false;
  locks
    .request(name, () => {
      granted = true;
      held(name);
      return new Promise<never>(() => undefined);
    })
    .catch(() => {
      if (!granted) held(null);
    });
}

/** 主のスレッドの側：worker が持つ lock を頼み、通ったら（worker が止まった）gone を呼ぶ。locks が無ければ見張らない */
export function watchAlive(locks: AliveLocks | undefined, name: string, gone: () => void): void {
  if (!locks) return;
  locks.request(name, () => gone()).catch(() => undefined);
}

/** この場所の Web Locks（無ければ undefined） */
export function localLocks(): AliveLocks | undefined {
  const nav = (globalThis as { navigator?: { locks?: AliveLocks } }).navigator;
  return nav?.locks && typeof nav.locks.request === "function" ? nav.locks : undefined;
}
