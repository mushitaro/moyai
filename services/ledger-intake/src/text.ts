// 受け口が GitHub に出す PR の題・本文・commit の文。施設の名前も人の名前も入れない。
// 本文の頭の 1 行は運営者の決定（2026-11-07）のとおり「受け口から（GitHub のアカウントなし）」。
import { fingerprint } from "../../../src/share/sign";

export const INTAKE_PR_TEXT = {
  title: (key: string, seq: number) => `共有ファイルを足す：鍵 ${key}・連番 ${seq}（受け口から）`,
  commitMessage: (key: string, seq: number) => `共有ファイルを足す：鍵 ${key}・連番 ${seq}（受け口から）`,
  body: (o: { key: string; pub: string; seq: number; hash: string; path: string; ledgerId: string }) =>
    [
      "受け口から（GitHub のアカウントなし）",
      "",
      `台帳 \`${o.ledgerId}\` に、共有ファイルを 1 つ足します。`,
      "",
      `- 共有ファイル：\`${o.path}\``,
      `- 鍵 ID \`${o.key}\`（鍵番号 \`${fingerprint(o.pub)}\`）・連番 ${o.seq}・ファイルの SHA-256 \`${o.hash}\``,
      "",
      "受け口が、受ける前に台帳の検証と同じ関数（形・署名・鎖・粒度・禁止語・数え直し・紛れる数 k）で確かめ、✓ でした。PR は、受け口が運営者の GitHub のアカウントで出しました。",
      "鍵 ID と出した人の結びつきは共有ファイルの署名で決まり、この PR を出したアカウントの名前は使いません。",
      "",
    ].join("\n"),
  // 取り下げ（Architect の 72）：その鍵自身の署名の取り下げの印を受けたとき
  retiredTitle: (key: string) => `失効記録を足す：鍵 ${key}（受け口から）`,
  retiredCommitMessage: (key: string) => `失効記録を足す：鍵 ${key}（受け口から）`,
  retiredBody: (o: { key: string; pub: string; last: number; hash: string; path: string; ledgerId: string; closed: number[] }) =>
    [
      "受け口から（GitHub のアカウントなし）",
      "",
      `台帳 \`${o.ledgerId}\` に、鍵 \`${o.key}\` の失効記録を 1 つ足します。`,
      "",
      `- 失効記録：\`${o.path}\``,
      `- 鍵 ID \`${o.key}\`（鍵番号 \`${fingerprint(o.pub)}\`）・最後の連番 ${o.last}・ファイルの SHA-256 \`${o.hash}\``,
      ...(o.closed.length ? [`- まだ載っていなかった共有ファイルの PR ${o.closed.map((n) => `#${n}`).join("・")} は、本人が取り下げたので閉じました`] : []),
      "",
      "失効記録はその鍵自身の署名です。受け口が、受ける前に台帳の検証と同じ関数で確かめ、✓ でした。載ると、この鍵の共有ファイルは集計対象外になり、最後の連番より大きい共有ファイルは ✗ になります。載った共有ファイルは消さず、掲載済みの複製は残ります。",
      "",
    ].join("\n"),
  /** まだ載っていない束の PR を閉じるときに書く文 */
  withdrawn: (key: string) =>
    [
      `本人が取り下げました（鍵 \`${key}\` 自身の署名の失効記録を、受け口が確かめました）。`,
      "",
      "この PR の共有ファイルはまだ台帳に載っていないので、載せずに閉じます。",
      "",
    ].join("\n"),
};
