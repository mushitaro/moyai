// 読み方の書き出し（柱 C・S-C3。運営者の判断 #23 の 1、2026-11-12。絵は Wire Frame の「ReadingOut」）：
// HOSHITORI のルールのシートの下の帯に「読み方を書き出す」の 1 つ → 押すとシートの本体に書き出す全文 → 主ボタンが「保存する」→「保存済み　ファイル名」の 1 行。
// 固有名詞（網 2）に当たれば作らず、主ボタンの左に理由の 1 行だけ（押せない）。説明の文・選びの欄は置かない。
// 中身は src/share/reading-feedback.ts（ルールの形と数だけ）。保存は人だけの経路（callHuman の reading_feedback_save）。AI のツールからは書き出せない。送るのは人。
// 受け口があるとき（運営者 2026-11-16「早く利用者が使える状態に」。絵は Wire Frame の「ReadingOutSend」）：保存のあと、主ボタンが「送る」に替わる（主ボタンは 1 つのまま）。
// 押すと、保存した全文を受け口に送り（人だけの経路 reading_feedback_send）、受け口が MOYAI のリポジトリに公開の Issue を出す →「✓ 送信　Issue #n」。
// 主ボタンの左には、戻せない操作の前の結果の 1 行（公開の Issue になる）だけ。受け口の無い版では「送る」を出さない（保存のあとは「ルールを書き出す」に戻る）。
import { Button, Text } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { BridgeClient } from "../bridge-client";
import type { IntakeWorkspace } from "../intake/workspace";
import { readingHitsOf } from "../state/reading-tab";
import { ROUTES } from "../../shared/routes";
import type { Plan } from "../../shared/plan";
import { buildReadingFeedback, localWordsOf } from "../../share/reading-feedback";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = HUMAN_TEXT.readings.out;

export type ReadingOutState =
  | { kind: "list" }
  | { kind: "preview"; text: string }
  | { kind: "saved"; file: string; text: string; canSend: boolean; sendError: string | null }
  | { kind: "sent"; file: string; issue: number }
  | { kind: "failed"; reason: string };

export interface ReadingOut {
  state: ReadingOutState;
  /** 書き出せるか（null は出さない：Skillパックの無い計画・3 段目の読み方が無い）。"properNoun" は当たったので作らない */
  ready: "ok" | "properNoun" | null;
  busy: boolean;
  press: () => void;
}

export function useReadingOut(ws: IntakeWorkspace, client: BridgeClient, plan: Plan | null): ReadingOut {
  const words = useMemo(() => localWordsOf(plan), [plan]);
  const built = useMemo(() => {
    if (!plan?.packId || !ws.fileCount) return null;
    const hits = readingHitsOf(ws.view);
    return buildReadingFeedback({ pack: plan.packId, readings: ws.currentReadings(), cellsOf: (id) => hits.ruleHits.count(id), localWords: words });
  }, [ws, ws.version, plan, words]);
  const [state, setState] = useState<ReadingOutState>({ kind: "list" });
  const [busy, setBusy] = useState(false);
  // 読み方が変われば、見せた全文は古い：一覧に戻す
  useEffect(() => setState({ kind: "list" }), [built?.ok ? built.text : null]);
  const ready = !built || (!built.ok && built.reason === "noRules") ? null : built.ok ? "ok" : "properNoun";
  const press = () => {
    if (!built?.ok || busy) return;
    if (state.kind === "sent") return;
    if (state.kind === "saved" && state.canSend) {
      // 保存した全文だけを送る（橋渡しは保管先の feedback/ に同じ中身があるときだけ送る）
      const saved = state;
      setBusy(true);
      void client
        .callHuman("reading_feedback_send", ROUTES.readingFeedbackSend.path, { text: saved.text, words })
        .then((res) => {
          const r = readHuman<{ ok: boolean; reason?: string; issue: number }>(res);
          setState(r.ok ? { kind: "sent", file: saved.file, issue: r.body.issue } : { ...saved, sendError: r.message });
        })
        .finally(() => setBusy(false));
      return;
    }
    if (state.kind !== "preview") return setState({ kind: "preview", text: built.text });
    const text = state.text;
    setBusy(true);
    void client
      .callHuman("reading_feedback_save", ROUTES.readingFeedbackSave.path, { text, words })
      .then((res) => {
        const r = readHuman<{ ok: boolean; reason?: string; file: string; canSend?: boolean }>(res);
        setState(r.ok ? { kind: "saved", file: r.body.file, text, canSend: r.body.canSend === true, sendError: null } : { kind: "failed", reason: r.message });
      })
      .finally(() => setBusy(false));
  };
  return { state, ready, busy, press };
}

/** シートの本体：全文（preview）か、保存の 1 行（saved・failed）。一覧のときは何も出さない */
export function ReadingOutBody({ out }: { out: ReadingOut }) {
  const s = out.state;
  if (s.kind === "preview")
    return (
      <div data-testid="reading-out-preview">
        <Text size="xs" c="var(--text-3)" pb={4}>
          {T.fullText}
        </Text>
        <pre className="moyai-reading-out" data-testid="reading-out-text">
          {s.text}
        </pre>
      </div>
    );
  if (s.kind === "saved" || s.kind === "sent")
    return (
      <>
        <Text size="sm" c="var(--text-2)" data-testid="reading-out-saved">
          {T.saved(s.file)}
        </Text>
        {s.kind === "sent" && (
          <Text size="sm" data-testid="reading-out-sent">
            {T.sent(s.issue)}
          </Text>
        )}
        {s.kind === "saved" && s.sendError && (
          <Text size="sm" c="var(--shu-text)" data-testid="reading-out-send-failed">
            {s.sendError}
          </Text>
        )}
      </>
    );
  if (s.kind === "failed")
    return (
      <Text size="sm" c="var(--shu-text)" data-testid="reading-out-failed">
        {s.reason}
      </Text>
    );
  return null;
}

/** 下の帯の主ボタン（と、当たったときの理由の 1 行・送る前の結果の 1 行・送ったあとの理由の 1 行） */
export function ReadingOutButton({ out, disabled }: { out: ReadingOut; disabled: boolean }) {
  if (out.ready === null) return null;
  const s = out.state;
  const sending = (s.kind === "saved" && s.canSend) || s.kind === "sent";
  return (
    <>
      {out.ready === "properNoun" && (
        <Text size="xs" c="var(--text-3)" data-testid="reading-out-blocked">
          {T.properNoun}
        </Text>
      )}
      {s.kind === "saved" && s.canSend && (
        <Text size="xs" c="var(--text-3)" data-testid="reading-out-send-note">
          {T.sendNote}
        </Text>
      )}
      {s.kind === "sent" && (
        <Text size="xs" c="var(--text-3)" data-testid="reading-out-send-reason">
          {T.sentReason}
        </Text>
      )}
      <Button onClick={out.press} loading={out.busy} disabled={disabled || out.ready !== "ok" || s.kind === "sent"} data-testid="reading-out" data-step={sending ? "send" : s.kind === "preview" ? "save" : "start"}>
        {sending ? T.send : s.kind === "preview" ? T.save : T.start}
      </Button>
    </>
  );
}
