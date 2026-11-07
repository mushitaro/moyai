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
};
