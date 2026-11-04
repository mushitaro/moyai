// 署名の鍵をまだ確かめていないときの知らせ（Wire の KeyWarn.dc.html、運営者の決定「止めずに警告だけ」）。
// 知らせるのは、人の署名を信じて何かをするとき（承認する・次の版を重ねて渡す・送る）だけ。その操作のボタンのすぐ左（ダイアログでは上）に、
// 1 行と「| 指紋を読み合わせる」を置く。開いて見るだけのときは出さない。止めず、確かめる道はその場に置く。
// 未確認はふつうの字、替わったは朱（朱は「あなたの判断が要る」）。確認済みにするのは、どこからでも同じ読み合わせのダイアログ 1 つ。
import { Anchor, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { ROUTES } from "../../shared/routes";
import { useConnection } from "../state/bridge";
import { HUMAN_TEXT } from "../text";
import { readHuman } from "./ConfirmDialog";

const T = HUMAN_TEXT.keyWarn;

/** 知らせに使う署名の形（plan_status の versions[].signatures） */
export interface TrustSig {
  role: string;
  by: string;
  key?: string;
  pub?: string;
  fingerprint: string;
  trust: string;
  previous?: { fingerprint: string; at: string } | null;
}

/** 版を作る署名の役目（確定・渡す・戻す）。承認・差し戻しは、版への独立の署名 */
const CREATION = new Set(["confirm", "edit", "revert"]);

/** まだ確かめていない鍵（版を作った署名のうち、未確認か替わったもの。鍵ごとに 1 つ）。替わったを先に並べる */
export function untrustedSigners(versions: readonly { signatures: readonly TrustSig[] }[]): TrustSig[] {
  const out = new Map<string, TrustSig>();
  for (const v of versions)
    for (const s of v.signatures) {
      if (!CREATION.has(s.role) || (s.trust !== "unconfirmed" && s.trust !== "changed")) continue;
      out.set(s.pub ?? s.fingerprint, s);
    }
  return [...out.values()].sort((a, b) => (a.trust === b.trust ? 0 : a.trust === "changed" ? -1 : 1));
}

/** 警告の 1 行と「| 指紋を読み合わせる」。2 つ以上なら「| 見る」（onShow があれば横の板へ、無ければ 1 つ目の読み合わせ） */
export function KeyWarnLine({ signers, onConfirmed, onShow }: { signers: readonly TrustSig[]; onConfirmed: () => void; onShow?: () => void }) {
  const [open, setOpen] = useState<TrustSig | null>(null);
  if (signers.length === 0) return null;
  const first = signers[0]!;
  const changed = signers.some((s) => s.trust === "changed");
  const text = signers.length > 1 ? T.many(signers.length) : first.trust === "changed" ? T.changed(first.by) : T.unconfirmed(first.by);
  return (
    <>
      <Text size="xs" c={changed ? "var(--shu-text)" : "var(--text)"} style={{ whiteSpace: "nowrap" }} data-testid="key-warn" data-trust={changed ? "changed" : "unconfirmed"}>
        {text}
        <Text span c="dimmed">
          {"　| "}
        </Text>
        <Anchor
          component="button"
          type="button"
          size="xs"
          onClick={() => (signers.length > 1 && onShow ? onShow() : setOpen(first))}
          data-testid="key-warn-check"
        >
          {signers.length > 1 && onShow ? T.show : T.check}
        </Anchor>
      </Text>
      <KeyCheckDialog signer={open} onClose={() => setOpen(null)} onConfirmed={onConfirmed} />
    </>
  );
}

/**
 * 指紋を読み合わせるダイアログ：指紋を大きく出し、16 文字が合えば「合った」で確認済みにする（人だけの経路）。
 * 輪の仲間（呼び名が無い）は、題・文・確認済みにする経路を差し替えて同じものを使う（Share.dc.html Version 46）
 */
export function KeyCheckDialog({
  signer,
  onClose,
  onConfirmed,
  title,
  howTo,
  onMatch,
}: {
  signer: TrustSig | null;
  onClose: () => void;
  onConfirmed: () => void;
  title?: string;
  howTo?: string;
  /** 「合った」を押したときの人だけの経路（無ければ人の鍵を確認済みにする）。誤りがあれば、その文を返す */
  onMatch?: (s: TrustSig) => Promise<string | null>;
}) {
  const { client } = useConnection();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matched = async () => {
    if (!signer?.pub) return;
    setBusy(true);
    setError(null);
    let err: string | null;
    if (onMatch) err = await onMatch(signer);
    else {
      const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("person_key_confirm", ROUTES.personKeyConfirm.path, { pub: signer.pub }));
      err = r.ok ? null : r.message;
    }
    setBusy(false);
    if (err) return setError(err);
    onConfirmed();
    onClose();
  };
  return (
    <Modal opened={!!signer} onClose={onClose} title={signer ? (title ?? T.title(signer.by)) : ""} centered data-testid="key-check">
      {signer && (
        <Stack gap="sm">
          <Text ff="monospace" fw={700} className="moyai-num" style={{ fontSize: 24, letterSpacing: "0.08em" }} data-testid="key-check-fingerprint">
            {signer.fingerprint}
          </Text>
          {signer.trust === "changed" && signer.previous && (
            <Text size="xs" c="dimmed" ff="monospace" data-testid="key-check-previous">
              {T.previous(signer.previous.fingerprint, signer.previous.at.slice(0, 10))}
            </Text>
          )}
          <Text size="sm">{howTo ?? T.howTo(signer.by)}</Text>
          {error && (
            <Text size="sm" c="var(--shu-text)">
              {error}
            </Text>
          )}
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={onClose}>
              {T.later}
            </Button>
            <Button onClick={() => void matched()} loading={busy} disabled={!signer.pub} data-testid="key-check-matched">
              {T.matched}
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
