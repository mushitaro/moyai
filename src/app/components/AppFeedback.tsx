// 困りごとを送る（運営者 2026-11-18「作ってください」。絵は Wire Frame の「AppFeedback」）：設定の「困りごと」の 1 行。
// 文の欄 1 つと主ボタン「送る」1 つ。書くと、その下に送る全文（src/share/app-feedback.ts：人の一言と、版・画面・OS・言語）がそのまま出る。
// その PC の語（固有名詞の網 2）か、行の値・ファイルの道・鍵・URL らしき字に当たれば「送る」を押せず、理由の 1 行だけ（当たった字は出さない）。
// 押すと、見せた全文だけを人だけの経路 app_feedback_send で橋渡しに渡し、橋渡しが照らし直して受け口に送る → 受け口が MOYAI のリポジトリに公開の Issue（feedback:app）。
// Claude は会話で文の案を欄に置くまで（screen_set の feedbackDraft。「- Claude の入力」）。送るのは人。AI のツールからは送れない。説明の文は置かない。
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import type { BridgeClient } from "../bridge-client";
import { ROUTES } from "../../shared/routes";
import { APP_FEEDBACK_NOTE_MAX, appFeedbackCounts, buildAppFeedback, osOf } from "../../share/app-feedback";
import { localHits } from "../../share/reading-feedback";
import { lastAppScreen } from "../state/app-screen";
import { takeFeedbackDraft, useFeedbackDraftOffer } from "../state/screen";
import { HUMAN_TEXT } from "../text";
import { useLang } from "../text/use-lang";
import { readHuman } from "./ConfirmDialog";

const T = HUMAN_TEXT.settings;

/** ブラウザの OS の種類（決まった語だけ。版の番号や機種は入れない） */
function navigatorOs(): string {
  if (typeof navigator === "undefined") return "";
  const ua = navigator as Navigator & { userAgentData?: { platform?: string } };
  return ua.userAgentData?.platform || navigator.platform || "";
}

type Sent = { kind: "sent"; issue: number; text: string } | { kind: "failed"; message: string; text: string } | null;

export function AppFeedback({ client, words }: { client: BridgeClient; words: readonly string[] }) {
  const lang = useLang();
  const [note, setNote] = useState("");
  const [claude, setClaude] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<Sent>(null);

  // Claude が screen_set の feedbackDraft で置いた文の案（人が書き替えたら、Claude の入力ではなくなる）
  const offered = useFeedbackDraftOffer();
  useEffect(() => {
    if (offered === null) return;
    const t = takeFeedbackDraft();
    if (t === null) return;
    setNote(t);
    setClaude(t);
    setSent(null);
  }, [offered]);

  const built = useMemo(
    () => (note.trim() === "" ? null : buildAppFeedback({ note, version: __MOYAI_BUILD__.commit, screen: lastAppScreen(), os: osOf(navigatorOs()), lang })),
    [note, lang],
  );
  const text = built?.ok ? built.text : null;
  const blocked = built?.ok === true && (localHits(built.file.note, words) > 0 || Object.keys(appFeedbackCounts(built.file.note)).length > 0);
  const done = sent?.kind === "sent" && sent.text === text;
  const failed = sent?.kind === "failed" && sent.text === text ? sent.message : null;

  const send = () => {
    if (!text || blocked || busy || done) return;
    setBusy(true);
    void client
      .callHuman("app_feedback_send", ROUTES.appFeedbackSend.path, { text, words: [...words] })
      .then((res) => {
        const r = readHuman<{ ok: boolean; reason?: string; issue: number }>(res);
        setSent(r.ok ? { kind: "sent", issue: r.body.issue, text } : { kind: "failed", message: r.message, text });
      })
      .finally(() => setBusy(false));
  };

  return (
    <Stack gap={8} maw={720} data-testid="app-feedback">
      <Textarea
        aria-label={T.troubleTitle}
        placeholder={T.troublePlaceholder}
        value={note}
        onChange={(e) => {
          setNote(e.currentTarget.value);
          if (claude !== null && e.currentTarget.value !== claude) setClaude(null);
        }}
        autosize
        minRows={2}
        maxLength={APP_FEEDBACK_NOTE_MAX}
        data-testid="app-feedback-note"
      />
      {claude !== null && claude === note && (
        <Text size="xs" c="var(--text-3)" data-testid="app-feedback-claude">
          {T.rootOfferedMark}
        </Text>
      )}
      {text && (
        <div data-testid="app-feedback-preview">
          <Text size="xs" c="var(--text-3)" pb={4}>
            {T.troubleFullText}
          </Text>
          <pre className="moyai-reading-out" data-testid="app-feedback-text">
            {text}
          </pre>
        </div>
      )}
      <Group justify="flex-end" gap={16}>
        {text && !blocked && !done && (
          <Text size="xs" c="var(--text-3)" data-testid="app-feedback-send-note">
            {T.troubleNote}
          </Text>
        )}
        {blocked && (
          <Text size="xs" c="var(--text-3)" data-testid="app-feedback-blocked">
            {T.troubleBlocked}
          </Text>
        )}
        {built && !built.ok && (
          <Text size="xs" c="var(--text-3)" data-testid="app-feedback-too-long">
            {T.troubleTooLong}
          </Text>
        )}
        {done && (
          <Text size="xs" c="var(--text-3)" data-testid="app-feedback-sent-reason">
            {T.troubleSentReason}
          </Text>
        )}
        <Button onClick={send} loading={busy} disabled={!text || blocked || done} data-testid="app-feedback-send">
          {T.troubleSend}
        </Button>
      </Group>
      {done && sent?.kind === "sent" && (
        <Text size="sm" data-testid="app-feedback-sent">
          {T.troubleSent(sent.issue)}
        </Text>
      )}
      {failed && (
        <Text size="sm" c="var(--shu-text)" data-testid="app-feedback-failed">
          {failed}
        </Text>
      )}
    </Stack>
  );
}
