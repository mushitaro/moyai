// 試験の輪のフォルダの置き場所。輪のフォルダの道は、送るときの固有名詞の数え（src/share/recount.ts の countProperNouns）の照らす相手なので、
// mkdtemp の乱数の文字（計画の語と偶然重なる）を入れない：tmpdir の下の決まった名前と、プロセスの番号・時刻・連番だけにする。
// 消すのは呼ぶ側（afterEach で rmSync）。
import { tmpdir } from "node:os";
import { join } from "node:path";

let seq = 0;

/** 輪のフォルダを置く、乱数の文字の無いフォルダの道（まだ作らない） */
export function ringBaseDir(tag: string): string {
  return join(tmpdir(), `moyai-${tag}-ring-${process.pid}-${Date.now()}-${++seq}`);
}
