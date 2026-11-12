// MERGE の横の板の「署名」（docs/screens.md 3.2）：いちばん新しい版の中身のハッシュ（4 文字 × 2 組を 4 つ）、使った読み方、結び目の鎖（確定・渡す・承認・差し戻し）。
// 署名ごとに、この PC が覚えた鍵と照らした信じ方（✓ この PC の鍵・✓ 確認済み・! 未確認・! 鍵が替わった）を出す。確かめで合わない版は朱で出す。
// 未確認はふつうの字、替わったは朱。! の行の右端に「| 指紋を読み合わせる」（KeyWarn.dc.html の 5）。
// 古い版を見るだけで開いたとき（Wire、11-07 夜。動画 C14）は、その版の署名を出す（いちばん新しい版のものは出さない）：
// 版の名前「令和 8 年度版（第 5 版）」、署名ごとに 1 行「確定　山田　2026-06-12 14:20　✓ 照合済み」、その下に「適用 Skill」
// （版の記録から。基本操作・Skillパック・ルールを 1 つ 1 行。ルールの行を押すと、ルールのシートでそのルールを選んで開く）。記録が無い版は「適用 Skill の記録なし」。
import { Stack, Text } from "@mantine/core";
import { useState } from "react";
import type { IgnoredRequest } from "./ConfirmDialog";
import { KeyCheckDialog, type TrustSig } from "./KeyWarn";
import { showContentHash } from "../../plan/signature";
import type { LoadedReading } from "../../import/reading";
import { shortVersion } from "../../import/reading";
import { HUMAN_TEXT } from "../text";

const T = HUMAN_TEXT.signatures;
const H = HUMAN_TEXT.history;

export interface PanelVersion {
  version: number;
  contentHash?: string;
  problem: string | null;
  legacy: boolean;
  signatures: (TrustSig & { at?: string })[];
  /** 様式で書き出した Excel への署名（鎖の行は「書出　山田　〇〇市様式」。版を作る署名ではない。3C） */
  exports?: (Omit<TrustSig, "role"> & { template: { name: string } })[];
}

/** 古い版を開いたときの見せ方（Merge が版の記録から作る） */
export interface PanelOld {
  /** 版の名前（署名した版は「令和 8 年度版（第 5 版）」、ほかは「第 5 版」） */
  name: string;
  /** その版の計画の Skillパックの名前 */
  pack: string;
  /** その版の記録の読み方（null は記録なし）。no はルールの版の番号（v n。来歴を読むまでは null） */
  skills: { name: string; path: string; version: string; no: number | null }[] | null;
  /** ルールの行を押したとき（ルールのシートでそのルールを選んで開く） */
  onRule: (path: string) => void;
}

/** 版の履歴の 1 行（plan_status の版の一覧から。理由と署名した人は版の記録にある） */
export interface PanelHistoryRow {
  version: number;
  at: string;
  reason: string;
  problem: string | null;
  signatures: { role: string; by: string }[];
}

/** 版の履歴（新しい順）。行を押すと、その版を比較版にする（選びの欄は足さない。#29、Wire の TimeMap5） */
export interface PanelHistory {
  rows: readonly PanelHistoryRow[];
  /** いま比べている版 */
  compare: number | null;
  onCompare: (version: number) => void;
}

/** 版をつくった署名（承認があれば承認、無ければ確定・戻す・渡す） */
function makerOf(r: PanelHistoryRow): { role: string; by: string } | null {
  return r.signatures.find((x) => x.role === "approve") ?? r.signatures.find((x) => x.role === "confirm" || x.role === "revert" || x.role === "edit") ?? null;
}

/** 頼み（まだ済んでいないもの）：鎖の行に「承認　宛先　まだ開かれていません」か「承認　受け取った人　信じ方」（Wire の B1） */
export interface PanelRequest {
  kind: "approve" | "edit";
  to: string;
  received: { by: string; pub: string; fingerprint: string; trust: string; previous: { fingerprint: string; at: string } | null } | null;
}

export function SignaturesPanel({
  v,
  readings,
  onKeyConfirmed,
  request = null,
  ignored = [],
  old = null,
  history = null,
}: {
  v: PanelVersion;
  readings: readonly LoadedReading[];
  onKeyConfirmed?: () => void;
  request?: PanelRequest | null;
  /** 効かない頼み：頼みの行のすぐ下に 1 つ 1 行。別の鍵は朱で「!」と名乗りと指紋、版を作った鍵のほかの中身に宛てた頼みは淡い字（Wire の B1 の追い） */
  ignored?: readonly IgnoredRequest[];
  /** 古い版を見るだけで開いているとき（その版の署名と適用 Skill を出す） */
  old?: PanelOld | null;
  /** 版の履歴（いちばん新しい版を見ているときだけ） */
  history?: PanelHistory | null;
}) {
  const [check, setCheck] = useState<TrustSig | null>(null);
  if (old)
    return (
      <Stack gap="xs" data-testid="signatures-panel" data-old="true" data-version={v.version}>
        <Text size="sm" fw={700} data-testid="signatures-version">
          {old.name}
        </Text>
        {v.contentHash && (
          <Text size="xs" ff="monospace" className="moyai-num" data-testid="signatures-hash">
            {showContentHash(v.contentHash)}
          </Text>
        )}
        {v.problem && (
          <Text size="sm" c="var(--shu)" data-testid="signatures-problem">
            {H.problem[v.problem]}
          </Text>
        )}
        {v.legacy && (
          <Text size="xs" c="dimmed">
            {H.legacy}
          </Text>
        )}
        {v.signatures.map((s) => (
          <Text size="xs" key={`${s.role}|${s.fingerprint}`} data-testid="signature" data-role={s.role} data-trust={s.trust}>
            {T.role[s.role] ?? s.role}　{s.by}
            {s.at ? `　${T.at(s.at)}` : ""}　<Text span c={s.trust === "changed" ? "var(--shu-text)" : undefined}>{T.trust[s.trust] ?? ""}</Text>
            {(s.trust === "unconfirmed" || s.trust === "changed") && s.pub && (
              <button type="button" className="moyai-inline-act" onClick={() => setCheck(s)} data-testid="signature-check">
                {HUMAN_TEXT.keyWarn.check}
              </button>
            )}
          </Text>
        ))}
        {(v.exports ?? []).map((x) => (
          <Text size="xs" key={`export|${x.fingerprint}|${x.template.name}`} data-testid="signature" data-role="export" data-trust={x.trust}>
            {T.role.export}　{x.by}　{x.template.name}　<Text span c={x.trust === "changed" ? "var(--shu-text)" : undefined}>{T.trust[x.trust] ?? ""}</Text>
          </Text>
        ))}
        <Text size="xs" fw={700} mt="xs">
          {T.applied}
        </Text>
        {old.skills === null ? (
          <Text size="xs" c="var(--text-3)" data-testid="applied-none">
            {T.appliedNone}
          </Text>
        ) : (
          <>
            {/* 基本操作と Skillパックの版は版の記録に無い（今の版は出さない） */}
            <Text size="xs" data-testid="applied-skill" data-tier="base">
              {T.tier.base}　<Text span c="var(--text-3)">{T.notRecorded}</Text>
            </Text>
            <Text size="xs" data-testid="applied-skill" data-tier="pack">
              {T.tier.pack}　{old.pack}　<Text span c="var(--text-3)">{T.notRecorded}</Text>
            </Text>
            {old.skills.map((r) => (
              <Text
                size="xs"
                key={`${r.path}|${r.version}`}
                className="moyai-pick-row"
                role="button"
                tabIndex={0}
                style={{ cursor: "pointer" }}
                onClick={() => old.onRule(r.path)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") old.onRule(r.path);
                }}
                data-testid="applied-skill"
                data-tier="rule"
                data-path={r.path}
              >
                {T.tier.rule}　{r.name}
                {r.no !== null && (
                  <Text span ff="monospace" fz={11} c="var(--text-3)" ml={6}>
                    {HUMAN_TEXT.readings.ruleVersion(r.no)}
                  </Text>
                )}
              </Text>
            ))}
          </>
        )}
        <KeyCheckDialog signer={check} onClose={() => setCheck(null)} onConfirmed={() => onKeyConfirmed?.()} />
      </Stack>
    );
  return (
    <Stack gap="xs" data-testid="signatures-panel">
      <Text size="sm" fw={700}>
        {T.version(v.version)}
      </Text>
      {v.contentHash && (
        <Text size="xs" ff="monospace" className="moyai-num" data-testid="signatures-hash">
          {showContentHash(v.contentHash)}
        </Text>
      )}
      {v.problem && (
        <Text size="sm" c="var(--shu)" data-testid="signatures-problem">
          {H.problem[v.problem]}
        </Text>
      )}
      {v.legacy && (
        <Text size="xs" c="dimmed">
          {H.legacy}
        </Text>
      )}
      <Text size="xs" fw={700} mt="xs">
        {T.readings}
      </Text>
      {readings.length === 0 ? (
        <Text size="xs" c="dimmed">
          {T.noReadings}
        </Text>
      ) : (
        readings.map((r) => (
          <Text size="xs" key={`${r.skill.name}|${r.version}`}>
            {r.skill.name}　{r.draft ? <Text span c="var(--shu)">{T.draft}</Text> : `版 ${shortVersion(r.version)}`}
          </Text>
        ))
      )}
      <Text size="xs" fw={700} mt="xs">
        {T.chain}
      </Text>
      {v.signatures.map((s) => (
        <Text size="xs" key={`${s.role}|${s.fingerprint}`} data-testid="signature" data-role={s.role} data-trust={s.trust}>
          {T.role[s.role] ?? s.role}　{s.by}　<Text span c={s.trust === "changed" ? "var(--shu-text)" : undefined}>{H.trust[s.trust] ?? ""}</Text>
          {(s.trust === "unconfirmed" || s.trust === "changed") && s.pub && (
            <>
              <button type="button" className="moyai-inline-act" onClick={() => setCheck(s)} data-testid="signature-check">
                {HUMAN_TEXT.keyWarn.check}
              </button>
            </>
          )}
        </Text>
      ))}
      {(v.exports ?? []).map((x) => (
        <Text size="xs" key={`export|${x.fingerprint}|${x.template.name}`} data-testid="signature" data-role="export" data-trust={x.trust}>
          {T.role.export}　{x.by}　{x.template.name}　<Text span c={x.trust === "changed" ? "var(--shu-text)" : undefined}>{H.trust[x.trust] ?? ""}</Text>
          {(x.trust === "unconfirmed" || x.trust === "changed") && x.pub && (
            <button type="button" className="moyai-inline-act" onClick={() => setCheck({ ...x, role: "export" })}>
              {HUMAN_TEXT.keyWarn.check}
            </button>
          )}
        </Text>
      ))}
      {request && (
        <Text size="xs" data-testid="signature-request" data-received={request.received ? "true" : "false"}>
          {HUMAN_TEXT.request.role[request.kind]}　{request.received ? request.received.by : request.to}
          {"　"}
          {request.received ? (
            <>
              <Text span c={request.received.trust === "changed" ? "var(--shu-text)" : undefined}>
                {H.trust[request.received.trust] ?? ""}
              </Text>
              {(request.received.trust === "unconfirmed" || request.received.trust === "changed") && (
                <>
                  <button
                    type="button"
                    className="moyai-inline-act"
                    onClick={() => setCheck({ role: "confirm", by: request.received!.by, pub: request.received!.pub, fingerprint: request.received!.fingerprint, trust: request.received!.trust, previous: request.received!.previous })}
                  >
                    {HUMAN_TEXT.keyWarn.check}
                  </button>
                </>
              )}
            </>
          ) : (
            <Text span c="dimmed">
              {HUMAN_TEXT.request.notOpened}
            </Text>
          )}
        </Text>
      )}
      {ignored.map((q) => {
        const R = HUMAN_TEXT.request;
        const other = q.why === "otherKey";
        return (
          // 2 行：1 行目に効かない理由（別の鍵は朱で「!」）、2 行目に置いた人・指紋・時刻（淡い字 11px）
          <div key={`${q.fingerprint}|${q.at}`} data-testid="signature-ignored" data-why={q.why}>
            <Text size="xs" c={other ? "var(--shu-text)" : "var(--text-3)"}>
              {other ? "! " : ""}
              {R.ignored}　{R.ignoredWhy[q.why]}
            </Text>
            <Text c="var(--text-3)" fz={11} className="moyai-num">
              {other ? `${q.by}${R.ignoredSelfNamed}　${q.fingerprint}` : q.by}　{R.ignoredAt(q.at)}
            </Text>
          </div>
        );
      })}
      {history && history.rows.length > 0 && (
        <>
          <Text size="xs" fw={700} mt="xs">
            {T.history}
          </Text>
          {[...history.rows]
            .sort((a, b) => b.version - a.version)
            .map((r) => {
              const m = makerOf(r);
              const line = `${T.historyDay(r.at)}　${m ? `${m.by}　${T.role[m.role] ?? m.role}` : ""}`;
              // 確かめで合わない版は読めないので、押せない行にする（比べられない）
              if (r.problem)
                return (
                  <div key={r.version} className="moyai-hist" data-testid="history-row" data-version={r.version} data-problem="true">
                    <span className="moyai-num">{H.versionNo(r.version)}</span>　{line}
                    <Text span size="xs" c="var(--shu)" display="block">
                      {H.problem[r.problem]}
                    </Text>
                  </div>
                );
              return (
                <button
                  type="button"
                  key={r.version}
                  className="moyai-hist"
                  aria-pressed={history.compare === r.version}
                  data-active={history.compare === r.version ? "true" : undefined}
                  onClick={() => history.onCompare(r.version)}
                  data-testid="history-row"
                  data-version={r.version}
                >
                  <span>
                    <span className="moyai-num">{H.versionNo(r.version)}</span>　{line}
                  </span>
                  <span className="moyai-hist-reason" data-testid="history-reason">
                    {r.reason}
                  </span>
                </button>
              );
            })}
        </>
      )}
      <KeyCheckDialog signer={check} onClose={() => setCheck(null)} onConfirmed={() => onKeyConfirmed?.()} />
    </Stack>
  );
}
