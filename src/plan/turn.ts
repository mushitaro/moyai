// 編集の番と、渡すメールの文（docs/plan.md §2.18.2・docs/screens.md 3.4）。
// 編集の番は保管先の plans/<計画ID>/turn.json（いま誰か・どの版から・頼んだこと）。渡す・承認・差し戻すで替わる。
// メールは MOYAI が文を用意し、Claude が利用者の連携したメールから送るか、人が自分のメーラーで開く（MOYAI 自身は送らない。決まり 1 の例外の 1 つめ）。
// メールが運ぶのは版の場所とハッシュだけで、計画の中身は運ばない。
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { planDir } from "./store";

export const TURN_SCHEMA = "moyai.turn/0";

/** editing：編集中（holder が番）、awaitingApproval：承認を頼んだ、approved：承認された、returned：差し戻された（holder に番が戻る） */
export type TurnState = "editing" | "awaitingApproval" | "approved" | "returned";

export interface Turn {
  schema: typeof TURN_SCHEMA;
  planId: string;
  version: number;
  state: TurnState;
  /** 番の人の呼び名（頼んだ相手の呼び名がまだ分からなければ null） */
  holder: string | null;
  /** 頼んだ相手のメールの宛先（無ければ null） */
  to: string | null;
  /** 渡した人・承認した人・差し戻した人の呼び名 */
  from: string;
  note: string;
  at: string;
}

export async function readTurn(root: string, planId: string): Promise<Turn | null> {
  try {
    const t = JSON.parse(await readFile(join(planDir(root, planId), "turn.json"), "utf8")) as Turn;
    return t.schema === TURN_SCHEMA && t.planId === planId ? t : null;
  } catch {
    return null;
  }
}

export async function writeTurn(root: string, t: Turn): Promise<void> {
  const file = join(planDir(root, t.planId), "turn.json");
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(t, null, 1)}\n`, "utf8");
  await rename(tmp, file);
}

export const MAIL_TEXT = {
  subject: (name: string, n: number, kind: "edit" | "approve") => `【MOYAI】${name} 第 ${n} 版の${kind === "edit" ? "編集" : "承認"}のお願い`,
  ask: { edit: "この版の編集をお願いします。", approve: "この版の承認をお願いします。" },
  open: "MOYAI で、同じ保管先を開いてから、次のリンクを開いてください（MOYAI が版の署名を確かめてから見せます）。",
  where: "版の場所（保管先から）",
  hash: "版の中身のハッシュ",
  carries: "このメールが運ぶのは、版の場所とハッシュだけです。計画の中身は運びません。",
  from: (by: string) => `${by}（MOYAI の署名）`,
};

/** 渡すメールの文。link は受け取る人の MOYAI で開くリンク */
export function handoffMail(i: { name: string; version: number; contentHash: string; kind: "edit" | "approve"; to: string; note: string; by: string; planId: string; link: string }): { to: string; subject: string; body: string } {
  const T = MAIL_TEXT;
  const body = [
    T.ask[i.kind],
    ...(i.note.trim() ? ["", i.note.trim()] : []),
    "",
    T.open,
    i.link,
    "",
    `${T.where}：plans/${i.planId}/versions/${String(i.version).padStart(6, "0")}.json`,
    `${T.hash}：${i.contentHash}`,
    "",
    T.carries,
    "",
    T.from(i.by),
  ].join("\n");
  return { to: i.to, subject: T.subject(i.name, i.version, i.kind), body };
}
