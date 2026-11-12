// 読み方の書き出し（柱 C・S-C3。運営者の判断 #23 の 1、2026-11-12。絵は Wire Frame の「ReadingOut」）：
// HOSHITORI のルールのシートの下の帯に「読み方を書き出す」の 1 つ → 押すとシートの本体に書き出す全文 → 主ボタンが「保存する」→「保存済み　ファイル名」の 1 行。
// 固有名詞（網 2）に当たれば作らず、主ボタンの左に理由の 1 行だけ（押せない）。説明の文・選びの欄は置かない。
// 中身は src/share/reading-feedback.ts（ルールの形と数だけ）。保存は人だけの経路（callHuman の reading_feedback_save）。AI のツールからは書き出せない。送るのは人。
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

export type ReadingOutState = { kind: "list" } | { kind: "preview"; text: string } | { kind: "saved"; file: string } | { kind: "failed"; reason: string };

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
    if (state.kind !== "preview") return setState({ kind: "preview", text: built.text });
    setBusy(true);
    void client
      .callHuman("reading_feedback_save", ROUTES.readingFeedbackSave.path, { text: state.text, words })
      .then((res) => {
        const r = readHuman<{ ok: boolean; reason?: string; file: string }>(res);
        setState(r.ok ? { kind: "saved", file: r.body.file } : { kind: "failed", reason: r.message });
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
  if (s.kind === "saved")
    return (
      <Text size="sm" c="var(--text-2)" data-testid="reading-out-saved">
        {T.saved(s.file)}
      </Text>
    );
  if (s.kind === "failed")
    return (
      <Text size="sm" c="var(--shu-text)" data-testid="reading-out-failed">
        {s.reason}
      </Text>
    );
  return null;
}

/** 下の帯の主ボタン（と、当たったときの理由の 1 行） */
export function ReadingOutButton({ out, disabled }: { out: ReadingOut; disabled: boolean }) {
  if (out.ready === null) return null;
  return (
    <>
      {out.ready === "properNoun" && (
        <Text size="xs" c="var(--text-3)" data-testid="reading-out-blocked">
          {T.properNoun}
        </Text>
      )}
      <Button onClick={out.press} loading={out.busy} disabled={disabled || out.ready !== "ok"} data-testid="reading-out">
        {out.state.kind === "preview" ? T.save : T.start}
      </Button>
    </>
  );
}
