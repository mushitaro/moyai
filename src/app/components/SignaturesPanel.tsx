// MERGE の横の板の「署名」（docs/screens.md 3.2）：いちばん新しい版の中身のハッシュ（4 文字 × 2 組を 4 つ）、使った読み方、結び目の鎖（確定・渡す・承認・差し戻し）。
// 署名ごとに、この PC が覚えた鍵と照らした信じ方（✓ この PC の鍵・✓ 確認済み・! 未確認・! 鍵が替わった）を出す。確かめで合わない版は朱で出す。
// 未確認はふつうの字、替わったは朱。! の行の右端に「| 指紋を読み合わせる」（KeyWarn.dc.html の 5）。
import { Anchor, Stack, Text } from "@mantine/core";
import { useState } from "react";
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
}

/** 頼み（まだ済んでいないもの）：鎖の行に「承認　宛先　まだ開かれていません」か「承認　受け取った人　信じ方」（Wire の B1） */
export interface PanelRequest {
  kind: "approve" | "edit";
  to: string;
  received: { by: string; pub: string; fingerprint: string; trust: string; previous: { fingerprint: string; at: string } | null } | null;
}

export function SignaturesPanel({ v, readings, onKeyConfirmed, request = null }: { v: PanelVersion; readings: readonly LoadedReading[]; onKeyConfirmed?: () => void; request?: PanelRequest | null }) {
  const [check, setCheck] = useState<TrustSig | null>(null);
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
              <Text span c="dimmed">
                {"　| "}
              </Text>
              <Anchor component="button" type="button" size="xs" onClick={() => setCheck(s)} data-testid="signature-check">
                {HUMAN_TEXT.keyWarn.check}
              </Anchor>
            </>
          )}
        </Text>
      ))}
      {request && (
        <Text size="xs" data-testid="signature-request" data-received={request.received ? "true" : "false"}>
          {HUMAN_TEXT.request.role[request.kind]}　{request.received ? request.received.by : request.to}
          {request.received ? (
            <>
              <Text span c={request.received.trust === "changed" ? "var(--shu-text)" : undefined}>
                {H.trust[request.received.trust] ?? ""}
              </Text>
              {(request.received.trust === "unconfirmed" || request.received.trust === "changed") && (
                <>
                  <Text span c="dimmed">
                    {"　| "}
                  </Text>
                  <Anchor
                    component="button"
                    type="button"
                    size="xs"
                    onClick={() => setCheck({ role: "confirm", by: request.received!.by, pub: request.received!.pub, fingerprint: request.received!.fingerprint, trust: request.received!.trust, previous: request.received!.previous })}
                  >
                    {HUMAN_TEXT.keyWarn.check}
                  </Anchor>
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
      <KeyCheckDialog signer={check} onClose={() => setCheck(null)} onConfirmed={() => onKeyConfirmed?.()} />
    </Stack>
  );
}
