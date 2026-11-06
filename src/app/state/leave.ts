// 閉じる前の知らせ（docs/plan.md §2.9「タブを閉じる前に、確定前の変更があれば知らせる」）。
// 作業中のもの（資料が 1 つ以上ある・未確定の答えか計画がある）があるときだけ beforeunload で知らせる。確定が済んで何も無いときは知らせない。
// 知らせの字はブラウザが決める（ページからは変えられない）。
import type { WorkingPlan } from "./plan-store";

/** 作業中の計画の状態。none：無い（開発の見本も数えない）／stored：保管先の版のまま／draft：未確定 */
export type PlanState = "none" | "stored" | "draft";

export interface LeaveState {
  /** このタブの資料の数 */
  files: number;
  /** 資料と答えが、保管先の版に入っているか（その版を開いて資料を戻した・このタブで作って確定したあと、資料も答えも変えていない） */
  filesInStored: boolean;
  /** 確定のシートで確定した行の数（確定すると 0 に戻る） */
  accepted: number;
  plan: PlanState;
}

export function planStateOf(w: Pick<WorkingPlan, "origin" | "stored"> | null): PlanState {
  if (!w || w.origin !== "intake") return "none";
  return w.stored ? "stored" : "draft";
}

/** 知らせるか */
export function hasUnsavedWork(s: LeaveState): boolean {
  if (s.plan === "draft") return true;
  if (s.accepted > 0) return true;
  // 資料（と、その答え）は、保管先の版のままの計画に入っているときだけ数えない
  if (s.files > 0 && !(s.plan === "stored" && s.filesInStored)) return true;
  return false;
}

type Target = Pick<Window, "addEventListener" | "removeEventListener">;

/** beforeunload を聞き、知らせるときだけ止める。外すための関数を返す */
export function guardLeave(target: Target, read: () => LeaveState): () => void {
  const on = (e: BeforeUnloadEvent) => {
    if (!hasUnsavedWork(read())) return;
    e.preventDefault();
    // 古い Chrome と Edge（119 より前）は returnValue を置かないと知らせない（置いた値は表示されない）
    e.returnValue = true;
  };
  target.addEventListener("beforeunload", on);
  return () => target.removeEventListener("beforeunload", on);
}
