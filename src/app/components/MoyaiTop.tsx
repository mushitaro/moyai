// MOYAI（トップ）のもやいの星取表（docs/screens.md 3.1、絵は Main.dc.html）：どの施設の、どの版から始めるかを選ぶ。主ボタンは無い。
// 行は保管先の施設、列は今月までの 20 か月、印は版（● は署名して確定・承認した版、朱の ○ は渡して編集中か承認待ちの版、朱の × は確かめで合わない版）。
// 行の名前の右に、いちばん新しい版（「第 7 版」、等幅）と状態（編集中・承認待ち・差し戻し、朱）。入口は行の右端の「＋ 次の版」（その施設のいちばん新しい版を MERGE で開く）と、
// 星取表の下の「＋ 新しい施設」（MERGE の白紙）。トップでは資料を受けない。版の印のメニュー（派生）・派生の線・後任の添え書きは P2。
import { Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { BridgeClient } from "../bridge-client";
import { useConnection } from "../state/bridge";
import { STAGE_HASH } from "../stages";
import { TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = TEXT.top;
const MONTHS = 20;

interface ListedPlan {
  planId: string;
  displayName: string;
  fictional: boolean;
  versions: { version: number; at: string; contentHash: string; roles: string[]; problem: string | null; legacy: boolean }[];
  turn: { version: number; state: "editing" | "awaitingApproval" | "approved" | "returned" } | null;
}

/** 時刻（ISO）の、日本時間の年月（"2026-11"） */
const monthOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);

function monthsUpTo(now: Date, n: number): string[] {
  const out: string[] = [];
  const [y, m] = monthOf(now.toISOString()).split("-").map(Number) as [number, number];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

export function MoyaiTop({ client }: { client: BridgeClient }) {
  const { state } = useConnection();
  const [plans, setPlans] = useState<ListedPlan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 開いたときと、タブに戻ったときに読み直す（ほかの人がメールのリンクで承認した版を、開いたままのトップにも出すため）
  useEffect(() => {
    if (state.kind !== "open") return;
    const load = async () => {
      const r = readHuman<{ ok: boolean; reason?: string; plans: ListedPlan[] }>(await client.callHuman("plans_list", ROUTES.plansList.path, {}));
      if (!r.ok) return setError(r.message);
      setError(null);
      setPlans(r.body.plans);
    };
    const onVisible = () => document.visibilityState === "visible" && void load();
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state.kind, client]);
  const months = monthsUpTo(new Date(), MONTHS);
  const anyProblem = !!plans?.some((p) => p.versions.some((v) => v.problem));

  return (
    <div className="moyai-top" data-testid="moyai-top">
      <h1 className="moyai-top-title">{T.title}</h1>
      {error && (
        <Text size="sm" c="var(--shu-text)">
          {error}
        </Text>
      )}
      {plans && plans.length > 0 && (
        <div className="moyai-top-grid" data-testid="moyai-table">
          {/* 年は、最初の列と 1 月の列にだけ出す */}
          <div className="moyai-top-head">
            <span className="moyai-top-name" />
            <span className="moyai-top-months">
              {months.map((m, i) => (
                <span key={m} className="moyai-top-cell">
                  {i === 0 || m.endsWith("-01") ? m.slice(0, 4) : ""}
                </span>
              ))}
            </span>
          </div>
          <div className="moyai-top-head">
            <span className="moyai-top-name" />
            <span className="moyai-top-months">
              {months.map((m) => (
                <span key={m} className="moyai-top-cell" title={T.yearMonth(m)}>
                  {T.month(m)}
                </span>
              ))}
            </span>
          </div>
          {plans.map((p) => {
            const latest = p.versions.at(-1);
            const open = !!p.turn && latest?.version === p.turn.version && (p.turn.state === "editing" || p.turn.state === "awaitingApproval" || p.turn.state === "returned");
            return (
              <div key={p.planId} className="moyai-top-row" data-testid="moyai-row" data-plan={p.planId}>
                <span className="moyai-top-name" title={p.displayName}>
                  <span className="moyai-top-facility">{p.displayName}</span>
                  {latest && (
                    <span className="moyai-top-ver" data-testid="moyai-version">
                      {T.version(latest.version)}
                    </span>
                  )}
                  {open && p.turn && (
                    <span className="moyai-top-state" data-testid="moyai-state">
                      {T.state[p.turn.state]}
                    </span>
                  )}
                </span>
                <span className="moyai-top-months">
                  {months.map((m) => {
                    const here = p.versions.filter((v) => monthOf(v.at) === m);
                    return (
                      <span key={m} className="moyai-top-cell" title={here.map((v) => T.version(v.version)).join("・")}>
                        {here.map((v) => {
                          const signed = v.roles.includes("confirm") || v.roles.includes("approve");
                          const kind = v.problem ? "problem" : (open && v.version === latest?.version) || !signed ? "open" : "signed";
                          return (
                            <span key={v.version} className="moyai-top-mk" data-kind={kind} data-testid="moyai-mark" data-version={v.version}>
                              {kind === "problem" ? "×" : kind === "open" ? "○" : "●"}
                            </span>
                          );
                        })}
                      </span>
                    );
                  })}
                </span>
                {latest && !latest.problem && (
                  <a className="moyai-top-add" href={`${STAGE_HASH.merge}?open=${encodeURIComponent(p.planId)}&v=${latest.version}&h=${latest.contentHash.slice(0, 16)}`} data-testid="moyai-next">
                    {T.next}
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
      <a className="moyai-top-add moyai-top-new" href={STAGE_HASH.merge} data-testid="moyai-new">
        {T.newFacility}
      </a>
      {plans && plans.length > 0 && (
        <div className="moyai-top-legend">
          <span>
            <span className="moyai-top-mk" data-kind="signed" /> {T.legend.signed}
          </span>
          <span className="moyai-top-legend-open">
            <span className="moyai-top-mk" data-kind="open" /> {T.legend.open}
          </span>
          {anyProblem && (
            <span className="moyai-top-legend-open">
              <span className="moyai-top-mk" data-kind="problem">
                ×
              </span>{" "}
              {T.legend.problem}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
