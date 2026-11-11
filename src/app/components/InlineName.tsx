// HOSHITORI の見出しの施設の名前：その場で直す（mushitaro/moyai#56。窓・ボタンは足さない）。
// 名前を押すと同じ字の大きさの入力になり、Enter で決め、Esc か外を押すと戻す。直した名前は作業中の計画に入り、次に署名した版から効く
// （前の版は前の名前のまま）。架空の施設は【架空】の印を外せない（外しても付け直す。src/plan/facility-name.ts）。
import { useState } from "react";
import { renameByHuman } from "../../plan/facility-name";
import { getWorkingPlan, updateWorkingPlan } from "../state/plan-store";

export function InlineName({ name, editable, label }: { name: string; editable: boolean; label: string }) {
  const [editing, setEditing] = useState<string | null>(null);
  if (editing === null) {
    return (
      <h1
        className="moyai-merge-name"
        data-testid="plan-name"
        data-editable={editable ? "true" : undefined}
        tabIndex={editable ? 0 : undefined}
        aria-label={editable ? label : undefined}
        onClick={editable ? () => setEditing(name) : undefined}
        onKeyDown={editable ? (e) => (e.key === "Enter" ? setEditing(name) : undefined) : undefined}
      >
        {name}
      </h1>
    );
  }
  const commit = () => {
    const wp = getWorkingPlan();
    const next = wp ? renameByHuman(wp.plan, editing) : null;
    if (wp && next && next !== wp.plan) updateWorkingPlan(next, wp.proposals);
    setEditing(null);
  };
  return (
    <input
      className="moyai-merge-name moyai-merge-name-input"
      data-testid="plan-name-input"
      aria-label={label}
      autoFocus
      maxLength={40}
      value={editing}
      size={Math.max(8, [...editing].length + 2)}
      onChange={(e) => setEditing(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") setEditing(null);
      }}
      onBlur={() => setEditing(null)}
    />
  );
}
