// MOYAI（トップ）のもやいの星取表（docs/screens.md 3.1）：どの施設の、どの版から始めるかを選ぶ。主ボタンは無い。
// 行は保管先の施設、列は月、印は版（● は署名して確定・承認した版、朱の ○ は渡して編集中か承認待ちの版、朱の × は確かめで合わない版）。
// 行の名前の右に、いちばん新しい版（「第 7 版」）と状態（編集中・承認待ち・差し戻し）。入口は行の右端の「＋ 次の版」（その施設のいちばん新しい版を MERGE で開く）と、
// 星取表の下の「＋ 新しい施設」（MERGE の白紙）。トップでは資料を受けない。版の印のメニュー（派生）と派生の線は P2。
import { Anchor, Stack, Table, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { BridgeClient } from "../bridge-client";
import { useConnection } from "../state/bridge";
import { STAGE_HASH } from "../stages";
import { TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = TEXT.top;
const MONTHS = 12;

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

  return (
    <Stack gap="sm" data-testid="moyai-top">
      <Text size="sm" c="dimmed">
        {T.lead}
      </Text>
      {error && (
        <Text size="sm" c="var(--shu)">
          {error}
        </Text>
      )}
      {plans && plans.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          {/* 列の幅を決めて、今月の列までいつも見えるようにする（施設の列が残りを取る） */}
          <Table layout="fixed" horizontalSpacing={6} className="moyai-num" data-testid="moyai-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{T.facility}</Table.Th>
                {months.map((m, i) => (
                  <Table.Th key={m} style={{ textAlign: "center", whiteSpace: "nowrap", width: 44 }} title={T.yearMonth(m)}>
                    {/* 年は、最初の列と 1 月の列にだけ出す */}
                    {(i === 0 || m.endsWith("-01")) && (
                      <Text span size="xs" c="dimmed" display="block">
                        {m.slice(0, 4)}
                      </Text>
                    )}
                    {T.month(m)}
                  </Table.Th>
                ))}
                <Table.Th style={{ width: 96 }} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {plans.map((p) => {
                const latest = p.versions.at(-1);
                const open = !!p.turn && latest?.version === p.turn.version && (p.turn.state === "editing" || p.turn.state === "awaitingApproval" || p.turn.state === "returned");
                return (
                  <Table.Tr key={p.planId} data-testid="moyai-row" data-plan={p.planId}>
                    <Table.Td style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={p.displayName}>
                      {p.displayName}
                      {latest && (
                        <Text span ml="sm" ff="monospace" data-testid="moyai-version">
                          {T.version(latest.version)}
                        </Text>
                      )}
                      {open && p.turn && (
                        <Text span c="var(--shu)" ml={6} data-testid="moyai-state">
                          {T.state[p.turn.state]}
                        </Text>
                      )}
                    </Table.Td>
                    {months.map((m) => {
                      const here = p.versions.filter((v) => monthOf(v.at) === m);
                      return (
                        <Table.Td key={m} style={{ textAlign: "center" }} title={here.map((v) => T.version(v.version)).join("・")}>
                          {here.map((v) => {
                            const isOpen = open && v.version === latest?.version;
                            const signed = v.roles.includes("confirm") || v.roles.includes("approve");
                            return (
                              <Text span key={v.version} c={v.problem || isOpen ? "var(--shu)" : undefined} data-testid="moyai-mark" data-version={v.version}>
                                {v.problem ? "×" : isOpen || !signed ? "○" : "●"}
                              </Text>
                            );
                          })}
                        </Table.Td>
                      );
                    })}
                    <Table.Td style={{ whiteSpace: "nowrap" }}>
                      {latest && !latest.problem && (
                        <Anchor href={`${STAGE_HASH.merge}?open=${encodeURIComponent(p.planId)}&v=${latest.version}&h=${latest.contentHash.slice(0, 16)}`} size="sm" data-testid="moyai-next">
                          {T.next}
                        </Anchor>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </div>
      )}
      {plans && plans.length === 0 && (
        <Text size="sm" c="dimmed" data-testid="moyai-empty">
          {T.empty}
        </Text>
      )}
      <Anchor href={STAGE_HASH.merge} data-testid="moyai-new">
        {T.newFacility}
      </Anchor>
      <Text size="xs" c="dimmed">
        {T.talk}
      </Text>
    </Stack>
  );
}
