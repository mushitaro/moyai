// 写真の欄（取り込みの画面。plan §2.3・§2.14）：落とした写真を読まずに並べ、人が 1 枚ずつ AI クライアントに渡すことを許し
// （確かめのダイアログで渡す画像を見せ、押したその場で中身に結んだ 1 回きりの印をもらって人だけの経路 photo_allow を呼ぶ）、
// AI が読んだ格子を画像と並べて確かめる（枠で位置を見せ、セルを直し、一言の理由で確かめる）。
// 許す・直す・確かめる・外すは人だけで、AI のツールに無い。window.confirm は使わない。
import { Alert, Badge, Button, Grid, Group, Modal, Paper, Stack, Table, Text, TextInput, Title } from "@mantine/core";
import { useEffect, useMemo, useState } from "react";
import { PHOTO_LOW_CONFIDENCE, photoState, type PhotoCellRead, type PhotoEntry } from "../../import/photo";
import { ROUTES } from "../../shared/routes";
import { prepareForAi, type PreparedImage, type Transfer } from "../intake/photos";
import type { IntakeView, IntakeWorkspace } from "../intake/workspace";
import { useConnection } from "../state/bridge";
import { ERROR_TEXT, HUMAN_TEXT, PHOTO_TEXT } from "../text";

const T = PHOTO_TEXT;

const kb = (bytes: number) => Math.ceil(bytes / 1024);
const time = (iso: string) => new Date(iso).toLocaleTimeString("ja-JP", { timeZone: "Asia/Tokyo" });

function base64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

type CardState = "unread" | "allowed" | "sent" | "read" | "confirmed" | "excluded";

function cardState(e: PhotoEntry, t: Transfer): CardState {
  const s = photoState(e);
  if (s !== "unread") return s;
  return t.kind === "none" ? "unread" : t.kind;
}

const STATE_COLOR: Record<CardState, string> = { unread: "gray", allowed: "blue", sent: "blue", read: "yellow", confirmed: "teal", excluded: "gray" };

// ─── 許す（確かめのダイアログ）──────────────────────────────────────

type Prep = { kind: "preparing" } | { kind: "ready"; image: PreparedImage } | { kind: "error"; message: string };

function AllowDialog({ ws, entry, opened, onClose }: { ws: IntakeWorkspace; entry: PhotoEntry; opened: boolean; onClose: () => void }) {
  const { client, state } = useConnection();
  const [prep, setPrep] = useState<Prep>({ kind: "preparing" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = entry.input.name;

  useEffect(() => {
    if (!opened) return;
    let live = true;
    setPrep({ kind: "preparing" });
    setError(null);
    void (async () => {
      const r = await prepareForAi(entry.input.bytes, entry.input.mimeType);
      if (!live) return;
      if ("error" in r) setPrep({ kind: "error", message: r.error === "decode" ? T.dialog.failed : T.dialog.tooLarge(kb(r.bytes)) });
      else setPrep({ kind: "ready", image: r });
    })();
    return () => {
      live = false;
    };
  }, [opened, entry]);

  const connected = state.kind === "open";
  const submit = async () => {
    if (prep.kind !== "ready" || !connected) return;
    setBusy(true);
    setError(null);
    const img = prep.image;
    // 人だけの経路：押したその場で、この画像のハッシュに結んだ印をもらう（AI のツールにはこの道が無い）
    const r = await client.callHuman("photo_allow", ROUTES.photoAllow.path, { imageRef: name, sha256: img.sha256, bytes: img.bytes, width: img.width, height: img.height });
    setBusy(false);
    if (!r.ok) return setError(r.code === "network" ? HUMAN_TEXT.network : ERROR_TEXT[r.code]);
    const body = r.body as { ok: boolean; reason?: string; at?: string };
    if (!body.ok || typeof body.at !== "string") return setError(HUMAN_TEXT.refused[body.reason ?? ""] ?? HUMAN_TEXT.refused.payloadInvalid ?? "");
    ws.photos.allowed(name, img, body.at);
    onClose();
  };

  return (
    <Modal opened={opened} onClose={onClose} title={T.dialog.title} size="56rem" centered data-testid="photo-allow-dialog">
      <Stack gap="sm">
        <Text size="sm">{T.dialog.lead(name)}</Text>
        {prep.kind === "preparing" && <Text size="sm">{T.dialog.preparing}</Text>}
        {prep.kind === "error" && (
          <Alert color="red" data-testid="photo-allow-error">
            {prep.message}
          </Alert>
        )}
        {prep.kind === "ready" && (
          <>
            <img className="moyai-photo-preview" src={`data:image/jpeg;base64,${prep.image.data}`} alt={T.dialog.previewAlt(name)} data-testid="photo-allow-preview" />
            <Text size="sm" className="moyai-num" data-testid="photo-allow-shape">
              {T.dialog.shape(prep.image.width, prep.image.height, kb(prep.image.bytes), prep.image.quality)}
            </Text>
            <Text size="xs" c="dimmed" className="moyai-num">
              {T.dialog.from(prep.image.source.width, prep.image.source.height)}
            </Text>
            {prep.image.overTarget && (
              <Text size="xs" c="orange">
                {T.dialog.overTarget(kb(prep.image.bytes))}
              </Text>
            )}
            <Alert color="orange" p="xs">
              <Text size="sm">{T.dialog.where}</Text>
              <Text size="sm">{T.dialog.once}</Text>
            </Alert>
          </>
        )}
        {error && (
          <Alert color="red" data-testid="photo-allow-error">
            {error}
          </Alert>
        )}
        <Group justify="flex-end" gap="sm">
          {!connected && (
            <Text size="xs" c="dimmed">
              {T.allowDisabled}
            </Text>
          )}
          <Button variant="default" onClick={onClose}>
            {T.dialog.cancel}
          </Button>
          <Button onClick={submit} disabled={prep.kind !== "ready" || !connected} loading={busy} data-testid="photo-allow-submit">
            {T.dialog.submit}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── 確かめる（画像と読んだ格子を並べる）─────────────────────────────

function Review({ ws, entry, image, records }: { ws: IntakeWorkspace; entry: PhotoEntry; image: string; records: number | null }) {
  const reading = entry.reading!;
  const name = entry.input.name;
  const [sel, setSel] = useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const confirmed = entry.confirmed;
  const cells = reading.cells;
  const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col) ?? null;
  const current = sel ? at(sel.row, sel.col) : null;
  const rows = useMemo(() => Math.max(...cells.map((c) => c.row)) + 1, [cells]);
  const cols = useMemo(() => Math.max(...cells.map((c) => c.col)) + 1, [cells]);
  const shown = cells.filter((c) => c.text !== "").length;

  const pick = (c: PhotoCellRead) => {
    setSel({ row: c.row, col: c.col });
    setDraft(c.text);
    setMsg(null);
  };
  const outcome = (r: string) => setMsg(r === "ok" ? null : (T.review.refused[r] ?? r));
  const flags = (c: PhotoCellRead) => ({
    "data-sel": sel && sel.row === c.row && sel.col === c.col ? "true" : undefined,
    "data-low": c.author === "ai_reading" && c.confidence < PHOTO_LOW_CONFIDENCE ? "true" : undefined,
    "data-human": c.author === "human" ? "true" : undefined,
  });

  return (
    <Stack gap="xs" data-testid="photo-review">
      <Group justify="space-between" gap="sm">
        <Title order={5}>{T.review.title}</Title>
        <Text size="xs" c="dimmed">
          {T.review.by(time(reading.placedAt))}
        </Text>
      </Group>
      <Grid gap="sm">
        <Grid.Col span={{ base: 12, lg: 7 }}>
          <div className="moyai-photo-frame" data-testid="photo-frame">
            <img src={image} alt={T.review.imageAlt(name)} />
            {cells
              .filter((c) => c.text !== "")
              .map((c) => (
                <button
                  key={`${c.row},${c.col}`}
                  type="button"
                  className="moyai-photo-box"
                  {...flags(c)}
                  aria-label={`${T.review.cell(c.row, c.col)}：${c.text}`}
                  style={{
                    left: `${(c.box.x / reading.width) * 100}%`,
                    top: `${(c.box.y / reading.height) * 100}%`,
                    width: `${(c.box.w / reading.width) * 100}%`,
                    height: `${(c.box.h / reading.height) * 100}%`,
                  }}
                  onClick={() => pick(c)}
                  data-testid="photo-box"
                />
              ))}
          </div>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 5 }}>
          <div className="moyai-sheet moyai-photo-grid">
            <Table withTableBorder={false} data-testid="photo-grid">
              <Table.Tbody>
                {Array.from({ length: rows }, (_, r) => (
                  <Table.Tr key={r}>
                    <Table.Th className="moyai-rowhead">{r + 1}</Table.Th>
                    {Array.from({ length: cols }, (_, k) => {
                      const c = at(r, k);
                      return (
                        <Table.Td
                          key={k}
                          {...(c ? flags(c) : {})}
                          title={c ? `${c.text}（${T.review.confidence(c.confidence)}）` : ""}
                          onClick={() => c && pick(c)}
                          data-testid={c ? "photo-cell" : undefined}
                        >
                          {c ? (c.text === "" ? T.review.cleared : c.text) : ""}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
          <Paper withBorder p="xs" mt="xs" data-testid="photo-cell-info">
            {current ? (
              <Stack gap={4}>
                <Group gap="xs">
                  <Text size="sm" fw={700}>
                    {T.review.cell(current.row, current.col)}
                  </Text>
                  <Text size="xs" className="moyai-num">
                    {T.review.confidence(current.confidence)}
                  </Text>
                  {current.author === "ai_reading" && current.confidence < PHOTO_LOW_CONFIDENCE && (
                    <Badge size="xs" color="yellow" variant="light">
                      {T.review.low}
                    </Badge>
                  )}
                  {current.author === "human" && (
                    <Badge size="xs" color="orange" variant="light">
                      {T.review.human}
                    </Badge>
                  )}
                </Group>
                <Text size="xs">{T.review.aiText(current.aiText)}</Text>
                {!confirmed && (
                  <Group align="flex-end" gap="xs">
                    <TextInput
                      size="xs"
                      style={{ flex: 1 }}
                      label={T.review.fixLabel}
                      description={T.review.fixHint}
                      value={draft}
                      onChange={(e) => setDraft(e.currentTarget.value)}
                      maxLength={500}
                      data-testid="photo-fix-text"
                    />
                    <Button size="compact-sm" variant="default" disabled={draft.trim() === current.text} onClick={() => outcome(ws.photos.correct(name, current.row, current.col, draft))} data-testid="photo-fix">
                      {T.review.fix}
                    </Button>
                  </Group>
                )}
              </Stack>
            ) : (
              <Text size="xs" c="dimmed">
                {T.review.pick}
              </Text>
            )}
          </Paper>
        </Grid.Col>
      </Grid>
      {msg && (
        <Text size="xs" c="red">
          {msg}
        </Text>
      )}
      {confirmed ? (
        <Group justify="space-between" gap="sm">
          <Text size="sm" c="teal" data-testid="photo-confirmed">
            {T.review.confirmed(time(confirmed.at), confirmed.reason)}
          </Text>
          <Button size="compact-sm" variant="default" onClick={() => outcome(ws.photos.unconfirm(name))} data-testid="photo-unconfirm">
            {T.review.unconfirm}
          </Button>
        </Group>
      ) : (
        <Group align="flex-end" gap="sm">
          <Badge color="yellow" variant="light" size="lg" className="moyai-num" data-testid="photo-review-count">
            {T.review.reviewCount(shown, records)}
          </Badge>
          <TextInput
            size="xs"
            style={{ flex: 1 }}
            label={T.review.reasonLabel}
            placeholder={T.review.reasonPlaceholder}
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            maxLength={500}
            data-testid="photo-confirm-reason"
          />
          {reason.trim().length === 0 && (
            <Text size="xs" c="dimmed">
              {T.review.confirmNeedsReason}
            </Text>
          )}
          <Button size="compact-sm" variant="default" title={T.review.discardHint} onClick={() => outcome(ws.photos.discard(name))} data-testid="photo-discard">
            {T.review.discard}
          </Button>
          <Button
            size="compact-sm"
            disabled={reason.trim().length === 0}
            onClick={() => {
              const r = ws.photos.confirm(name, reason);
              outcome(r);
              if (r === "ok") setReason("");
            }}
            data-testid="photo-confirm"
          >
            {T.review.confirm}
          </Button>
        </Group>
      )}
    </Stack>
  );
}

// ─── 1 枚 ────────────────────────────────────────────────────────

function PhotoCard({ ws, entry, records }: { ws: IntakeWorkspace; entry: PhotoEntry; records: number | null }) {
  const { state: conn } = useConnection();
  const [allowing, setAllowing] = useState(false);
  const name = entry.input.name;
  const t = ws.photos.transfer(name);
  const st = cardState(entry, t);
  // 確かめるときに見せる画像：AI に渡したもの（位置はこの画像と同じ比で描ける）。無ければ元の画像
  const sent = t.kind !== "none" ? t.image.data : null;
  const hasReading = entry.reading !== null;
  const image = useMemo(
    () => (sent ? `data:image/jpeg;base64,${sent}` : hasReading ? `data:${entry.input.mimeType};base64,${base64(entry.input.bytes)}` : null),
    [sent, hasReading, entry.input],
  );
  const canAllow = st === "unread" || st === "sent";
  const origin = entry.input.origin;
  return (
    <Paper withBorder p="xs" data-testid="photo-item" data-photo={name} data-state={st}>
      <Group justify="space-between" gap="sm" wrap="nowrap">
        <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} truncate>
            {origin.kind === "pdf_page" ? T.pages(origin.file, origin.page) : name}
          </Text>
          <Text size="xs" c="dimmed" className="moyai-num">
            {T.size(kb(entry.input.bytes.length))}
          </Text>
          <Badge color={STATE_COLOR[st]} variant="light" data-testid="photo-state">
            {T.state[st]}
          </Badge>
        </Group>
        <Group gap="xs" wrap="nowrap">
          {st === "excluded" ? (
            <Button size="compact-sm" variant="default" onClick={() => ws.photos.include(name)} data-testid="photo-include">
              {T.include}
            </Button>
          ) : (
            <>
              {(st === "unread" || st === "allowed" || st === "sent") && (
                <Button size="compact-sm" variant="default" onClick={() => ws.photos.exclude(name)} data-testid="photo-exclude">
                  {T.exclude}
                </Button>
              )}
              {canAllow && (
                <Button
                  size="compact-sm"
                  onClick={() => setAllowing(true)}
                  disabled={conn.kind !== "open"}
                  title={conn.kind !== "open" ? T.allowDisabled : undefined}
                  data-testid="photo-allow"
                >
                  {st === "sent" ? T.allowAgain : T.allow}
                </Button>
              )}
            </>
          )}
        </Group>
      </Group>
      {st === "unread" && (
        <Text size="xs" c="dimmed" mt={4}>
          {T.unreadNote}
        </Text>
      )}
      {st === "allowed" && t.kind === "allowed" && (
        <Text size="xs" mt={4} data-testid="photo-allowed">
          {T.allowedNote(time(t.at))}
        </Text>
      )}
      {st === "sent" && t.kind === "sent" && (
        <Text size="xs" mt={4} data-testid="photo-sent">
          {T.sentNote(time(t.at))}
        </Text>
      )}
      {st === "excluded" && (
        <Text size="xs" c="dimmed" mt={4}>
          {T.excludedNote}
        </Text>
      )}
      {(st === "read" || st === "confirmed") && image && (
        <div style={{ marginTop: 8 }}>
          <Review ws={ws} entry={entry} image={image} records={records} />
        </div>
      )}
      {allowing && <AllowDialog ws={ws} entry={entry} opened={allowing} onClose={() => setAllowing(false)} />}
    </Paper>
  );
}

// ─── 欄 ──────────────────────────────────────────────────────────

export function PhotoPanel({ ws, view }: { ws: IntakeWorkspace; view: IntakeView | null }) {
  const entries = ws.photoBook.entries();
  const byFile = view?.photoReview.byFile ?? {};
  return (
    <Stack gap="xs" data-testid="photos">
      <Text size="xs" c="dimmed">
        {T.lead}
      </Text>
      {entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          {T.none}
        </Text>
      ) : (
        entries.map((e) => {
          const r = byFile[e.input.name];
          return <PhotoCard key={e.input.name} ws={ws} entry={e} records={r ? r.assets + r.details : null} />;
        })
      )}
    </Stack>
  );
}
