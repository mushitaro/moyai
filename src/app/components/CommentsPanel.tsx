// MERGE の横の板の「コメント」（docs/screens.md 3.2、絵は Review.dc.html）：①② の番号・行・文・呼び名・時刻と、書く欄。
// 星取表の行を選んでから書くと、その行に付く（行の名前の右にも ①②）。行を選ばなければ計画そのものに付く。
// 保管先に置く（人だけの経路 comment_add。書いた人は、この PC の呼び名）。署名はしない。
import { Button, Group, Stack, Text, Textarea } from "@mantine/core";
import { useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { BridgeClient } from "../bridge-client";
import type { CommentRow } from "../state/merge-side";
import { TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = TEXT.merge.comments;
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** コメントの番号の字（1 から。20 を越えたら括弧の数） */
export const commentNumber = (i: number): string => CIRCLED[i] ?? `(${i + 1})`;

export interface ListedComment {
  version: number;
  row: CommentRow | null;
  by: string;
  at: string;
  text: string;
}

export function CommentsPanel({
  client,
  planId,
  version,
  comments,
  row,
  onAdded,
}: {
  client: BridgeClient;
  planId: string;
  version: number;
  comments: ListedComment[];
  row: CommentRow | null;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("comment_add", ROUTES.commentAdd.path, { planId, version, row, text }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setError(null);
    setText("");
    onAdded();
  };
  return (
    <Stack gap="md" data-testid="comments-panel">
      {comments.length === 0 ? (
        <Text size="xs" c="dimmed">
          {T.none}
        </Text>
      ) : (
        comments.map((c, i) => (
          <Stack gap={2} key={`${c.at}|${i}`} data-testid="comment">
            <Text size="xs" c="dimmed">
              {commentNumber(i)}　{c.row ? c.row.label : T.plan}
            </Text>
            <Text size="sm" style={{ whiteSpace: "pre-wrap" }}>
              {c.text}
            </Text>
            <Text size="xs" c="var(--text-2)">
              {c.by}
              {"　"}
              <Text span size="xs" c="dimmed">
                {T.when(c.at)}
              </Text>
            </Text>
          </Stack>
        ))
      )}
      <Stack gap={4}>
        <Textarea label={T.label} placeholder={T.placeholder} value={text} onChange={(e) => setText(e.currentTarget.value)} autosize minRows={2} maxLength={2000} data-testid="comment-text" />
        <Text size="xs" c="dimmed" data-testid="comment-to">
          {row ? T.to(row.label) : T.toPlan}
        </Text>
        {error && (
          <Text size="xs" c="var(--shu-text)">
            {error}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="default" size="xs" onClick={() => void add()} disabled={!text.trim()} loading={busy} data-testid="comment-add">
            {T.add}
          </Button>
        </Group>
      </Stack>
    </Stack>
  );
}
