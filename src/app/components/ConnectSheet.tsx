// HOSHITORI のシート「連携」（業務システムとの読み書き。運営者の判断 2026-11-16。絵は Wire Frame の ConnectSheet）。
// 見せるもの：つなぎ先（設定で人が置いたもの。選ぶだけ。キーは出さない）・読んだ件数・突合（突合のシートと同じ形）・書き込みの差分の数。
// 人の操作は主ボタン 1 つ：確定・署名した版が無ければ「読む」、あれば差分を見せて「送る」。
// 本番への書き込みで、その host の有効な鍵が無ければ、主ボタンの左に「理由：」の 1 行だけ（押せない）。鍵の確かめは橋渡しが送る直前にも必ず通す。
// 読んだものは資料のシートに「資料」として入り、そのあとは今の道（当てはめ・星取表・確定・署名）を通る。
import { Button, Group, Table, Text } from "@mantine/core";
import { useEffect, useState } from "react";
import type { BridgeClient } from "../bridge-client";
import type { IntakeWorkspace } from "../intake/workspace";
import type { ConnectMatchResult, ConnectMatchRow } from "../../shared/connect";
import { chooseTarget, planNow, readNow, sendNow, useConnectView } from "../state/connect";
import { HUMAN_TEXT, TEXT } from "../text";
import { Switch } from "./Switch";

const T = HUMAN_TEXT.connect;
const M = TEXT.match;
const SHOWN_MAX = 500;
type Filter = "diff" | "one" | "all";

const years = (ys: number[] | null) => (ys && ys.length ? ys.join("・") : T.none);
const resultColor = (k: ConnectMatchResult) => (k === "diff" ? "var(--shu-text)" : k === "one" ? "var(--text-2)" : "var(--text-3)");

/** 送る主ボタンのそばの 1 行（押せない理由・戻せない操作の前の結果）と、押せるか */
export function connectPrimary(v: ReturnType<typeof useConnectView>, signedVersion: number | null): { label: "read" | "send"; stop: string | null; note: string | null } {
  if (signedVersion === null) return { label: "read", stop: null, note: null };
  const p = v.plan && v.plan.version === signedVersion && v.plan.targetId === v.chosen ? v.plan : null;
  // 差分を読み終えるまで（読めなければ、その理由）は押せない
  if (!p) return { label: "send", stop: v.planBlocked ?? T.loadingDiff, note: null };
  if (v.sent && v.sent.version === p.version && v.sent.targetId === p.targetId) return { label: "send", stop: T.sentReason, note: null };
  if (p.write.needed && !p.write.ok) return { label: "send", stop: `${T.reasonPrefix}${HUMAN_TEXT.refused[`connectLicense.${p.write.reason}`] ?? p.write.reason}`, note: null };
  if (p.counts.add + p.counts.change === 0) return { label: "send", stop: T.nothingReason, note: null };
  return { label: "send", stop: null, note: T.sendNote };
}

export function ConnectSheet({ client, ws, planId, signedVersion, connected }: { client: BridgeClient; ws: IntakeWorkspace; planId: string | null; signedVersion: number | null; connected: boolean }) {
  const v = useConnectView();
  const [filter, setFilter] = useState<Filter | null>(null);
  // 確定・署名した版があれば、つなぎ先を選ぶたび・版が進むたびに突合と差分を読む（書かない）
  useEffect(() => {
    if (!connected || !planId || signedVersion === null || !v.chosen) return;
    void planNow(client, planId, v.chosen);
  }, [client, connected, planId, signedVersion, v.chosen]);
  const primary = connectPrimary(v, signedVersion);
  const p = v.plan && signedVersion !== null && v.plan.version === signedVersion && v.plan.targetId === v.chosen ? v.plan : null;
  const first: Filter = p && p.counts.diff > 0 ? "diff" : p && p.counts.one > 0 ? "one" : "all";
  const f = filter ?? first;
  const rows: ConnectMatchRow[] = p ? (f === "all" ? p.rows : p.rows.filter((r) => r.result === f)) : [];
  const press = () => {
    if (primary.label === "read") void readNow(client, ws);
    else void sendNow(client);
  };
  const resultText = (r: ConnectMatchRow) => (r.result === "ok" ? T.ok : r.result === "diff" ? T.diff : r.onlyIn === "moyai" ? T.onlyMoyai(p!.version) : T.onlyTarget);
  const sent = p && v.sent && v.sent.version === p.version && v.sent.targetId === p.targetId ? v.sent : null;
  return (
    <div className="moyai-share-page" data-testid="connect-sheet" data-target={v.chosen ?? ""} data-step={primary.label}>
      <div className="moyai-share-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Group gap="md" align="baseline" wrap="nowrap">
          <Text size="xs" c="var(--text-3)" component="label" htmlFor="connect-target">
            {T.target}
          </Text>
          {v.targets.length === 0 ? (
            <Text size="sm" c="var(--text-3)">
              {v.loaded ? T.noTargets : T.loading}
            </Text>
          ) : (
            <select
              id="connect-target"
              className="moyai-select"
              value={v.chosen ?? ""}
              onChange={(e) => chooseTarget(e.currentTarget.value)}
              data-testid="connect-target"
              style={{ height: 32, background: "var(--layer-1)", color: "var(--text)", border: "1px solid var(--line-strong)", padding: "0 8px", font: "inherit", fontSize: 13 }}
            >
              {v.targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {`${t.label}・${t.host}（${T.envs[t.env]}）`}
                </option>
              ))}
            </select>
          )}
        </Group>
        {v.read && v.read.targetId === v.chosen && (
          <Text size="sm" c="var(--text-2)" className="moyai-num" data-testid="connect-read">
            {T.readDone(v.read.counts.assets, v.read.counts.plans, v.read.counts.results, v.read.file)}
          </Text>
        )}
        {signedVersion === null || (v.planBlocked && !p) ? (
          <Text size="sm" c="var(--text-3)" data-testid="connect-no-signed">
            {v.planBlocked ?? T.noSigned}
          </Text>
        ) : p ? (
          <>
            <Switch<Filter>
              aria-label={M.filterLabel}
              value={f}
              onChange={setFilter}
              data-testid="connect-filter"
              data={[
                { value: "diff", label: M.filterDiff(p.counts.diff) },
                { value: "one", label: M.filterOne(p.counts.one) },
                { value: "all", label: M.filterAll(p.rows.length) },
              ]}
            />
            <div style={{ overflowX: "auto" }}>
              <Table verticalSpacing={6} fz="sm" data-testid="connect-match" style={{ minWidth: 760 }}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{T.head}</Table.Th>
                    <Table.Th ta="center">{T.version(p.version)}</Table.Th>
                    <Table.Th ta="center">{T.targetCol}</Table.Th>
                    <Table.Th>{M.resultHead}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rows.slice(0, SHOWN_MAX).map((r) => (
                    <Table.Tr key={r.key} data-testid="connect-row" data-result={r.result}>
                      <Table.Td>{`${r.assetPath} › ${r.work}`}</Table.Td>
                      <Table.Td ta="center" className="moyai-num" c="var(--text-2)">
                        {years(r.moyai)}
                      </Table.Td>
                      <Table.Td ta="center" className="moyai-num" c="var(--text-2)">
                        {years(r.target)}
                      </Table.Td>
                      <Table.Td c={resultColor(r.result)}>{resultText(r)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </div>
            {rows.length > SHOWN_MAX && (
              <Text size="xs" c="dimmed">
                {M.more(rows.length - SHOWN_MAX)}
              </Text>
            )}
            <Text size="sm" c="var(--text-2)" className="moyai-num" data-testid="connect-diff" data-add={p.counts.add} data-change={p.counts.change}>
              {T.diffLine(p.counts.add, p.counts.change)}
            </Text>
          </>
        ) : null}
        {sent && (
          <Text size="sm" data-testid="connect-sent">
            {T.sent(sent.applied)}
          </Text>
        )}
        {v.error && (
          <Text size="sm" c="var(--shu-text)" data-testid="connect-error">
            {v.error}
          </Text>
        )}
      </div>
      {/* 下の帯：主ボタン 1 つ。そのすぐ左に、押せない理由か、戻せない操作の前の結果の 1 行だけ */}
      <Group justify="flex-end" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar">
        {primary.stop && (
          <Text size="xs" c="var(--text-3)" style={{ whiteSpace: "nowrap" }} data-testid="connect-reason">
            {primary.stop}
          </Text>
        )}
        {!primary.stop && primary.note && (
          <Text size="xs" c="var(--text-3)" style={{ whiteSpace: "nowrap" }} data-testid="connect-send-note">
            {primary.note}
          </Text>
        )}
        <Button onClick={press} loading={v.busy} disabled={!connected || !v.chosen || !!primary.stop} data-testid="connect-primary" data-step={primary.label}>
          {primary.label === "read" ? T.read : T.send}
        </Button>
      </Group>
    </div>
  );
}
