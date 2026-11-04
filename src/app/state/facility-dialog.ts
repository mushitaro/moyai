// 「施設の設定」のダイアログを開け閉めする（MERGE の見出しと、似た施設を重ねた行の「| 見え方を直す」から開く）。
import { useSyncExternalStore } from "react";

let open = false;
const listeners = new Set<() => void>();

export function setFacilityDialog(v: boolean): void {
  open = v;
  for (const l of listeners) l();
}

export function useFacilityDialog(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
    () => open,
  );
}
