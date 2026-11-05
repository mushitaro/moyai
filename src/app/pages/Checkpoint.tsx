// SHARE（共有。docs/screens.md 3.6、絵は Share.dc.html。P2 の 2 で引き算した）：
// 出す先（自社の輪 / 公開の台帳）、見え方の答え、相手から見たあなた（見え方の 1 行・何施設のどれかに見えるか・塊ごとの帯。委託先は伏せる）、
// 出元（鍵の指紋と束の鎖）。原本・出ていくバイト列そのもの（ハッシュ・メモ帳で開く）・相手の星取表は「中身を見る」にたたむ。
// 下の帯に、出したあとに起きることと、主ボタン 1 つ「署名して自社の輪へ出す」か「署名して公開の台帳へ出す」。
// 合言葉はやめた（運営者の決定 2026-11-04「パスワードは絶対いやです」、docs/plan.md §2.19）。署名は、人が主ボタンを押したときに決まる。
// 出ていくものは橋渡しが作る（送る処理と同じ関数）。画面は橋渡しが返したバイト列を見せ、そのハッシュを送るときに照らす。
// 公開の台帳（絵は SharePublic.dc.html。運営者の決定 2026-11-04「MOYAI が出す」）：出す先の右に GitHub のアカウント、誰からも見えるあなた、
// 出した束の行方（SHARE を開いたときだけ読む）。PR を出すのは、人が主ボタンを押したときだけ。
import { Alert, Anchor, Button, Code, Container, Group, Modal, NativeSelect, Paper, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROUTES } from "../../shared/routes";
import { emptyCatalog } from "../chart/catalog";
import { CHART_HASH } from "../chart/route";
import { SyncedNotice, readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { KeyCheckDialog, KeyWarnLine, untrustedSigners, type TrustSig } from "../components/KeyWarn";
import { FictionMark } from "../components/FictionMark";
import { GitHubConnect } from "../components/GitHubConnect";
import { Switch } from "../components/Switch";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { HUMAN_TEXT, bandText, reasonText } from "../text";
import { bandShort } from "../../share/stat-text";

const T = HUMAN_TEXT.checkpoint;

interface Synced {
  kind: "onedrive" | "sharepoint";
  base: string;
}
interface Question {
  key: string;
  name: string;
  unit: string | null;
  tier: string;
  codes: { code: string; name: string }[];
  suggested: string | null;
}
interface Counts {
  shape: number;
  properNoun: number;
  money: number;
  freeText: number;
  exactDate: number;
}
interface OriginalRow {
  equipment: string;
  work: string;
  commonItem: string | null;
  lifted: string | null;
  attribute: string | null;
  fiscalYear: number;
  planOrActual: "plan" | "actual";
  date: string | null;
  manDays: number | null;
  days: number | null;
  cost: number | null;
  performer: string | null;
  contractor: string | null;
}
interface View {
  blockers: string[];
  missing: string[];
  tried: { stage: number; coarse: boolean; k: number }[];
  bodyText: string | null;
  bodyHash: string | null;
  bytes: number | null;
  seq: number;
  counts: Counts | null;
  k: number | null;
  minK: number;
  profile: { group: string; stage: number; axes: Record<string, string> } | null;
  steps: { all: number; profile: number; rows: number } | null;
  rowEffects: { class: string; n: number }[];
  copy: { copied: number; rows: number; skipped: Record<string, number>; withheld: Record<string, number>; omitted: Record<string, number> } | null;
  original: OriginalRow[];
  originalTotal: number;
  vanished: boolean;
}
interface RingInfo {
  ringId: string;
  root: string;
  pack: string;
  synced: Synced | null;
}
interface PreviewBody {
  ok: boolean;
  reason?: string;
  plan?: { planId: string; packId: string; version: number; displayName: string; fictional: boolean; inNationalTable: boolean | null; profile: Record<string, string> | null; pending: number };
  questions?: Question[];
  classNames?: Record<string, string>;
  axes?: { key: string; name: string; codes: { code: string; name: string }[] }[];
  rings?: RingInfo[];
  ring?: RingInfo & { key: string; keys?: string[]; fingerprint: string | null; folder: string; rulesChange?: RulesChange | null };
  ringCount?: number;
  view?: View;
  /** 公開の台帳：GitHub の接続（アカウント名だけ。トークンは画面に来ない）と台帳 */
  github?: { login: string | null; ready: boolean };
  ledger?: { id: string; repo: string | null; key: string | null; fingerprint: string | null };
  pending?: { pr: number; url: string } | null;
  /** 公開の台帳の決まりが、この PC が受け入れたものから変わったときの差（台帳の新-3） */
  rulesChange?: Omit<RulesChange, "changer" | "month"> | null;
}
interface LedgerPr {
  pr: number;
  url: string;
  seq: number;
  at: string;
  /** 束にした計画の版 */
  version: number | null;
  login: string;
  status: { state: "open" | "merged" | "closed"; check: "pending" | "ok" | "ng" | "none"; reason: string | null } | null;
}

/** その PC の時刻の日付（YYYY-MM-DD） */
function dayOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function PrLine({ p }: { p: LedgerPr }) {
  const st = p.status;
  return (
    <Group gap="md" wrap="nowrap" className="moyai-num" data-testid="ledger-pr" data-state={st?.state ?? "unread"} data-check={st?.check ?? ""}>
      <Text size="sm" data-testid="ledger-pr-bundle">
        {T.prBundle(p.seq, p.version, dayOf(p.at))}
      </Text>
      <Text size="sm" w={70}>
        {T.prOpen(p.pr)}
      </Text>
      {!st && (
        <Text size="sm" c="dimmed">
          {T.prUnread}
        </Text>
      )}
      {st?.state === "open" && (
        <>
          <Text size="sm">{T.prReview}</Text>
          <Text size="sm" c={st.check === "ng" ? "var(--shu-text)" : "dimmed"}>
            {T.prCheck[st.check]}
          </Text>
          <Text size="sm" c="dimmed">
            {T.prWaiting}
          </Text>
        </>
      )}
      {st?.state === "merged" && <Text size="sm">{T.prMerged}</Text>}
      {st?.state === "closed" && (
        <Text size="sm" c="var(--shu-text)">
          {T.prClosed(st.reason)}
        </Text>
      )}
      <Button component="a" href={p.url} target="_blank" rel="noopener noreferrer" variant="default" size="xs">
        {T.prLink}
      </Button>
    </Group>
  );
}
interface VerifyLine {
  kind: string;
  name: string;
  status: string;
  reasons: string[];
  fingerprint?: string;
  pub?: string;
  month?: string;
  version?: number;
  day?: string;
  short?: true;
}
interface Report {
  ringId: string;
  lines: VerifyLine[];
  notBundleFiles: number;
  ok: boolean;
}
interface Chunk {
  class: string;
  work: string;
  years: string[];
  observed: string;
  interval?: string;
  manDays?: string;
  days?: string;
}

const Sumi = () => <span className="moyai-sumi">■■■■</span>;

/** 輪の決まりが、受け入れたものから変わったときの差（橋渡しの rulesChangeOf） */
interface RulesChange {
  rulesHash: string;
  loosened: number;
  tightened: number;
  rows: { rule: string; before: string; now: string; dir: "loosened" | "tightened" | "changed" }[];
  changer: { pub: string; fingerprint: string; confirmed: boolean } | null;
  month: string | null;
}

/** 輪の決まりの受け入れのダイアログ（Share.dc.html Version 46）：変えた鍵、決まりごとの前と今、結果の文 1 つ、「あとで」「受け入れる」 */
function RulesDialog({
  title,
  change,
  opened,
  onClose,
  onAccept,
  onCheckChanger,
}: {
  /** 題（無ければ共有フォルダの決まり） */
  title?: string;
  change: RulesChange;
  opened: boolean;
  onClose: () => void;
  onAccept: () => Promise<string | null>;
  onCheckChanger: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setError(null);
    const e = await onAccept();
    setBusy(false);
    if (e) return setError(e);
    onClose();
  };
  return (
    <Modal opened={opened} onClose={onClose} title={title ?? T.rulesTitle} size="lg" centered data-testid="rules-dialog">
      <Stack gap="sm">
        {change.changer && (
          <Text size="xs" c="dimmed" ff="monospace" data-testid="rules-changer">
            {T.rulesChanger(change.changer.fingerprint, change.month ?? "")}
            {!change.changer.confirmed && (
              <>
                <Text span c="var(--text)" ff="var(--font-body)">
                  {"　! "}
                  {T.memberUnconfirmed}
                </Text>
                <button type="button" className="moyai-inline-act" style={{ fontFamily: "var(--font-body)" }} onClick={onCheckChanger} data-testid="rules-changer-check">
                  {HUMAN_TEXT.keyWarn.check}
                </button>
              </>
            )}
          </Text>
        )}
        <Table className="moyai-num" verticalSpacing={4} data-testid="rules-table">
          <Table.Thead>
            <Table.Tr>
              {T.rulesHead.map((h, i) => (
                <Table.Th key={i}>{h}</Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {change.rows.map((r, i) => (
              <Table.Tr key={i} data-testid="rules-row" data-dir={r.dir}>
                <Table.Td>{T.ruleName(r.rule)}</Table.Td>
                <Table.Td>{r.before}</Table.Td>
                <Table.Td>{r.now}</Table.Td>
                <Table.Td c={r.dir === "loosened" ? "var(--shu-text)" : "dimmed"}>{T.rulesDir[r.dir]}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Text size="sm" c="var(--shu-text)">
          {T.rulesResult}
        </Text>
        {error && (
          <Text size="sm" c="var(--shu-text)">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {HUMAN_TEXT.keyWarn.later}
          </Button>
          <Button onClick={() => void accept()} loading={busy} data-testid="rules-accept">
            {T.rulesAccept}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function Num({ v }: { v: number | null }) {
  return v === null ? <Text span c="dimmed">—</Text> : <Text span className="moyai-shu">{v}</Text>;
}

/**
 * 受け取った束の表（受け手と同じ関数で確かめた結果）。内部の ID（輪・鍵・ファイルの道）は出さず、
 * 人が電話で読み合わせる鍵の指紋で示す：「決まり」「仲間　指紋（あなた）」「束 n　指紋」と、✓／✗ と理由
 */
function VerifyTable({
  report,
  ownKey,
  rulesChange = null,
  onCheckMember,
  onViewRules,
}: {
  report: Report;
  ownKey: string | null;
  rulesChange?: RulesChange | null;
  onCheckMember?: (l: VerifyLine) => void;
  onViewRules?: () => void;
}) {
  // まだ確かめていないだけの仲間（ほかの理由が無い）と、その束：✗ と朱を使わず、確かめる道を行の右端に置く
  const unconfirmedOnly = (l: VerifyLine) => l.kind === "member" && l.reasons.length === 1 && l.reasons[0] === "member.unconfirmed";
  const notCounted = new Set(report.lines.filter(unconfirmedOnly).map((l) => l.name));
  const fpOf = new Map(report.lines.filter((l) => l.kind === "member" && l.fingerprint).map((l) => [l.name, l.fingerprint!]));
  // 仲間ごとに、その束の行の理由（仲間の行に写ってきたもの）
  const bundleReasons = new Map<string, Set<string>>();
  for (const l of report.lines) {
    const k = l.kind === "bundle" ? /bundles\/([0-9a-f]{16})\//.exec(l.name)?.[1] : undefined;
    if (k) for (const r of l.reasons) (bundleReasons.get(k) ?? bundleReasons.set(k, new Set()).get(k)!).add(r);
  }
  const reasonsOf = (l: VerifyLine): string[] => {
    if (l.kind !== "member") return [...new Set(l.reasons.map(reasonText))];
    const fromBundles = bundleReasons.get(l.name) ?? new Set<string>();
    const own = l.reasons.filter((r) => !fromBundles.has(r)).map(reasonText);
    const mixed = l.reasons.filter((r) => fromBundles.has(r));
    if (mixed.includes("file.notBundleName")) own.push(T.memberNotBundle);
    if (mixed.some((r) => r !== "file.notBundleName")) own.push(T.memberNgBundle);
    return [...new Set(own)];
  };
  const who = (key: string | null) => (key ? `${fpOf.get(key) ?? T.unknownKey}${key === ownKey ? T.you : ""}` : "");
  return (
    <Table className="moyai-num" data-testid="verify-table" data-ok={report.ok} verticalSpacing={6}>
      <Table.Tbody>
        {report.lines.map((l) => {
          const b = l.kind === "bundle" ? /bundles\/([0-9a-f]{16})\/(\d{6})-/.exec(l.name) : null;
          const folder = l.kind === "bundle" ? (/bundles\/([0-9a-f]{16})\//.exec(l.name)?.[1] ?? null) : null;
          const label =
            l.kind === "circle" ? T.verifyKind.circle : l.kind === "member" ? T.verifyKind.member : b ? T.prBundle(Number(b[2]), l.version ?? null, l.day ?? l.month ?? "") : T.notBundleRow;
          const key = l.kind === "member" ? l.name : folder;
          const unconfirmed = unconfirmedOnly(l);
          const short = l.kind === "bundle" && l.status === "ok" && !!l.short;
          const uncounted = short || (l.kind === "bundle" && l.status === "ok" && !!folder && notCounted.has(folder));
          const rulesRow = l.kind === "circle" && !!rulesChange;
          const soft = unconfirmed || rulesRow;
          const mark = soft ? "!" : uncounted ? "―" : (T.verifyStatus[l.status] ?? l.status);
          return (
            <Table.Tr
              key={`${l.kind}:${l.name}`}
              data-testid="verify-line"
              data-status={l.status}
              data-kind={l.kind}
              data-state={unconfirmed ? "unconfirmed" : short ? "peersShort" : uncounted ? "notCounted" : rulesRow ? "rulesChanged" : undefined}
              style={uncounted ? { color: "var(--text-3)" } : undefined}
            >
              <Table.Td w={40}>
                <Text fw={700} c={uncounted ? "var(--text-3)" : l.status === "ok" || soft ? "var(--text)" : "var(--shu-text)"}>
                  {mark}
                </Text>
              </Table.Td>
              <Table.Td style={{ whiteSpace: "nowrap" }}>{label}</Table.Td>
              <Table.Td style={{ whiteSpace: "nowrap" }}>
                <Text size="sm" ff="monospace" c={uncounted ? "var(--text-3)" : undefined}>
                  {who(key)}
                </Text>
              </Table.Td>
              {unconfirmed ? (
                <Table.Td>
                  {T.memberUnconfirmed}
                  <button type="button" className="moyai-inline-act" onClick={() => onCheckMember?.(l)} data-testid="member-check">
                    {HUMAN_TEXT.keyWarn.check}
                  </button>
                </Table.Td>
              ) : uncounted ? (
                <Table.Td c="var(--text-3)">{short ? T.peersShort : T.notCounted}</Table.Td>
              ) : rulesRow && rulesChange ? (
                <Table.Td>
                  {T.rulesChanged}
                  {"　"}
                  <Text span c="var(--shu-text)">
                    {T.rulesCounts(rulesChange.loosened, rulesChange.tightened).loosened}
                  </Text>
                  {`・${T.rulesCounts(rulesChange.loosened, rulesChange.tightened).tightened}`}
                  <button type="button" className="moyai-inline-act" onClick={() => onViewRules?.()} data-testid="rules-view">
                    {T.rulesView}
                  </button>
                </Table.Td>
              ) : (
                <Table.Td c={l.status === "ok" ? undefined : "var(--shu-text)"}>{reasonsOf(l).join("、")}</Table.Td>
              )}
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

export function Checkpoint() {
  const working = useWorkingPlan();
  const { client, state } = useConnection();
  const planId = working?.plan.planId ?? null;
  // 送る版の鎖に、まだ確かめていない鍵があれば、主ボタンの左（押せない理由と同じ所）に 1 行（KeyWarn.dc.html の 4。止めない）
  const [status, reloadStatus] = usePlanStatus(client, planId ?? "", !!planId && state.kind === "open");
  const untrusted = status.kind === "ready" && status.status.versions ? untrustedSigners(status.status.versions) : [];
  const [ringId, setRingId] = useState<string | null>(null);
  const [facility, setFacility] = useState<Record<string, string | null>>({});
  const [national, setNational] = useState<boolean | null>(working?.plan.facility.inNationalTable ?? null);
  const [res, setRes] = useState<PreviewBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ fileName: string; report: Report } | null>(null);
  // 受け取った束（docs/screens.md 3.6。受け取り箱をこの画面の下の節に移した）：輪を受け手と同じ関数で確かめた結果
  const [received, setReceived] = useState<Report | null>(null);
  // 受け取った束の行で直す：仲間の鍵の読み合わせと、輪の決まりの受け入れ（Share.dc.html Version 46。監査 D1）
  const [memberCheck, setMemberCheck] = useState<TrustSig | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ledgerRulesOpen, setLedgerRulesOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [dest, setDest] = useState<"ring" | "ledger">("ring");
  const [connectOpen, setConnectOpen] = useState(false);
  const [prs, setPrs] = useState<LedgerPr[] | null>(null);
  const [sentPr, setSentPr] = useState<{ pr: number; url: string } | null>(null);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);
  const prefilled = useRef(false);

  const answers = useMemo(() => ({ facility, inNationalTable: national }), [facility, national]);

  // 輪・答えが変わるたびに、橋渡しで出ていくものを作り直す（送る処理と同じ関数）。
  // 断られても（輪が無い・見え方が決まらないなど）、聞くこと（輪の一覧と軸）は返ってくるので見せる。
  useEffect(() => {
    if (state.kind !== "open" || !planId) return;
    const n = ++seq.current;
    setLoading(true);
    void (async () => {
      const r =
        dest === "ledger"
          ? await client.callHuman("ledger_preview", ROUTES.ledgerPreview.path, { planId, answers })
          : await client.callHuman("checkpoint_preview", ROUTES.checkpointPreview.path, { planId, ringId, answers });
      if (n !== seq.current) return;
      setLoading(false);
      const h = readHuman<PreviewBody>(r);
      setError(h.ok ? null : h.message);
      if (!r.ok) return;
      const b = r.body as PreviewBody;
      setRes(b);
      if (!prefilled.current && b.questions) {
        prefilled.current = true;
        // 施設の設定の答えを先に入れ、無い軸だけ規模からの見込み（人が直せる）
        const pre: Record<string, string | null> = {};
        for (const q of b.questions) if (q.suggested) pre[q.key] = q.suggested;
        Object.assign(pre, b.plan?.profile ?? {});
        if (b.plan && b.plan.inNationalTable !== null && national === null) setNational(b.plan.inNationalTable);
        if (Object.keys(pre).length > 0) setFacility((f) => ({ ...pre, ...f }));
      }
      if (dest === "ring" && ringId === null && b.rings && b.plan) {
        const first = b.rings.find((x) => x.pack === b.plan!.packId);
        if (first) setRingId(first.ringId);
      }
    })();
  }, [client, state.kind, planId, ringId, answers, dest, reload]);

  // 出した束の行方：公開の台帳を選んで SHARE を開いたときだけ、公開の PR を読む（トークンは使わない）
  const packId = res?.plan?.packId ?? working?.plan.packId ?? null;
  useEffect(() => {
    if (dest !== "ledger" || state.kind !== "open" || !packId) return;
    void (async () => {
      const r = readHuman<{ ok: boolean; reason?: string; prs: LedgerPr[] }>(await client.callHuman("ledger_prs", ROUTES.ledgerPrs.path, { packId }));
      setPrs(r.ok ? r.body.prs : []);
    })();
  }, [client, dest, state.kind, packId, sentPr]);

  const view = res?.ok ? (res.view ?? null) : null;
  const body = useMemo(() => {
    if (!view?.bodyText) return null;
    try {
      return JSON.parse(view.bodyText) as { profile: { group: string; stage: number; axes: Record<string, string> }; chunks: Chunk[]; seq: number; month: string };
    } catch {
      return null;
    }
  }, [view?.bodyText]);
  const workLabels = useMemo(() => emptyCatalog().workLabels as Record<string, string>, []);
  const className = (c: string) => res?.classNames?.[c] ?? c;
  const axisName = (key: string) => res?.axes?.find((a) => a.key === key)?.name ?? key;
  const codeName = (key: string, code: string) => res?.axes?.find((a) => a.key === key)?.codes.find((c) => c.code === code)?.name ?? code;

  const countsZero = !!view?.counts && Object.values(view.counts).every((n) => n === 0);
  const done = dest === "ledger" ? !!sentPr : !!sent;
  const canSend = !!view && view.blockers.length === 0 && !!view.bodyHash && countsZero && view.k !== null && view.k >= view.minK && !sending && !done;
  const login = res?.github?.login ?? null;
  // 止め札は、いま効いている理由を 1 つだけ出す（公開の台帳でつないでいなければ、それがいちばん先）
  const sendReason = !view
    ? T.sendNeeds.noView
    : view.blockers.includes("keysForked")
      ? T.sendNeeds.keysForked
    : view.blockers.includes("chainForked")
      ? T.sendNeeds.chainForked
    : view.blockers.includes("noKey")
      ? T.sendNeeds.noKey
      : view.blockers.includes("pending")
        ? T.sendNeeds.pending
        : view.blockers.length > 0
        ? (T.sendNeeds[view.blockers[0]!] ?? view.blockers[0]!)
        : "";

  const send = async () => {
    if (!canSend || !view?.bodyHash || !res?.plan) return;
    if (dest === "ledger") {
      setSending(true);
      setSendError(null);
      const r = readHuman<{ ok: boolean; reason?: string; pr: number; url: string }>(
        await client.callHuman("ledger_send", ROUTES.ledgerSend.path, { planId, version: res.plan.version, answers, previewHash: view.bodyHash }),
      );
      setSending(false);
      if (!r.ok) return setSendError(r.message);
      setSentPr({ pr: r.body.pr, url: r.body.url });
      setReload((x) => x + 1);
      return;
    }
    if (!ringId) return;
    setSending(true);
    setSendError(null);
    const r = readHuman<{ ok: boolean; reason?: string; fileName: string; report: Report }>(
      await client.callHuman("checkpoint_send", ROUTES.checkpointSend.path, { planId, version: res.plan.version, ringId, answers, previewHash: view.bodyHash }),
    );
    setSending(false);
    if (!r.ok) return setSendError(r.message);
    setSent({ fileName: r.body.fileName, report: r.body.report });
    setReceived(r.body.report);
  };

  const verifyAgain = async () => {
    if (!ringId) return;
    const r = readHuman<{ ok: boolean; reason?: string; report: Report }>(await client.callHuman("ring_verify", ROUTES.ringVerify.path, { ringId }));
    if (r.ok) setReceived(r.body.report);
    else setSendError(r.message);
    // 出ていくものも作り直す（連番・鍵・鎖は輪の今の中身で決まるので）
    setReload((x) => x + 1);
  };

  // 輪を選んだら（開いたとき・輪を替えたとき）、受け取った束を読む
  useEffect(() => {
    if (dest !== "ring" || !ringId || state.kind !== "open") {
      setReceived(null);
      return;
    }
    void (async () => {
      const r = readHuman<{ ok: boolean; reason?: string; report: Report }>(await client.callHuman("ring_verify", ROUTES.ringVerify.path, { ringId }));
      setReceived(r.ok ? r.body.report : null);
    })();
  }, [client, dest, ringId, state.kind]);

  const openText = async () => {
    if (!ringId || !planId) return;
    const r = readHuman<{ ok: boolean; reason?: string; file: string }>(await client.callHuman("checkpoint_open_text", ROUTES.checkpointOpenText.path, { planId, ringId, answers }));
    if (r.ok) setOpened(r.body.file);
    else setSendError(r.message);
  };

  if (!planId) {
    return (
      <Container size="lg" py="lg">
        <Title order={2}>{T.title}</Title>
        <Text mt="md" data-testid="checkpoint-no-plan">
          {T.noPlan}
        </Text>
        <Anchor href={CHART_HASH}>{T.toChart}</Anchor>
      </Container>
    );
  }

  const years = body ? [...new Set(body.chunks.flatMap((c) => c.years))].sort() : [];

  const chain = view ? Array.from({ length: Math.min(3, view.seq) }, (_, i) => view.seq - i) : [];
  const profileLine = body ? Object.entries(body.profile.axes).map(([k, v]) => codeName(k, v)).join("、") : null;

  return (
    <div className="moyai-share-page" data-testid="checkpoint-page">
      <div className="moyai-share-body">
        <div className="moyai-page-head">
          <h1 className="moyai-merge-name">{res?.plan?.displayName ?? working?.plan.displayName}</h1>
          {res?.plan && <span className="moyai-merge-ver">{T.versionOf(res.plan.version)}</span>}
          {(res?.plan?.fictional ?? working?.plan.facility.fictional) && <FictionMark />}
        </div>

        <Stack gap="lg">
          {state.kind !== "open" && <Alert color="orange">{HUMAN_TEXT.notConnected}</Alert>}
          {error && (
            <Alert color="orange" data-testid="checkpoint-refused">
              {error}
            </Alert>
          )}

          {/* 出す先：自社の輪 / 公開の台帳。公開の台帳の右に、PR を出す GitHub のアカウント */}
          <Group gap="md" align="center" data-testid="share-dest">
            <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
              {T.destLabel}
            </Text>
            <Switch<"ring" | "ledger">
              aria-label={T.destLabel}
              value={dest}
              onChange={(v) => {
                setDest(v);
                setRes(null);
                setSent(null);
                setSentPr(null);
                setSendError(null);
              }}
              data={[
                { value: "ring", label: T.dest.ring },
                { value: "ledger", label: T.dest.ledger },
              ]}
            />
            {dest === "ledger" && res?.rulesChange && (
              <Text size="sm" data-testid="ledger-rules-changed">
                {T.ledgerRulesMark}
                {T.ledgerRulesChanged}
                {"　"}
                <Text span c="var(--shu-text)">
                  {T.rulesCounts(res.rulesChange.loosened, res.rulesChange.tightened).loosened}
                </Text>
                {`・${T.rulesCounts(res.rulesChange.loosened, res.rulesChange.tightened).tightened}`}
                <button type="button" className="moyai-inline-act" onClick={() => setLedgerRulesOpen(true)} data-testid="ledger-rules-view">
                  {T.rulesView}
                </button>
              </Text>
            )}
            {dest === "ledger" && (
              <Group gap="xs" align="center" data-testid="github-account">
                <Text size="xs" c="dimmed" style={{ letterSpacing: "0.1em" }}>
                  {T.github}
                </Text>
                <Text size="sm" data-testid="github-login">
                  {login ?? T.githubNone}
                </Text>
                {res?.github?.ready === false ? (
                  <Text size="xs" c="dimmed" data-testid="github-no-client">
                    {T.githubNoClient}
                  </Text>
                ) : (
                  <Button variant="default" size="xs" onClick={() => setConnectOpen(true)} disabled={!packId} data-testid="github-open">
                    {login ? T.githubReconnect : T.githubConnect}
                  </Button>
                )}
              </Group>
            )}
            {dest === "ring" && (res?.rings ?? []).length > 1 && (
              <NativeSelect
                size="xs"
                aria-label={T.ring}
                value={ringId ?? ""}
                onChange={(e) => setRingId(e.currentTarget.value || null)}
                data={[{ value: "", label: T.choose }, ...(res?.rings ?? []).map((r) => ({ value: r.ringId, label: r.ringId }))]}
                data-testid="ring-select"
              />
            )}
            {dest === "ring" && (res?.rings ?? []).length === 0 && res && (
              <Text size="xs" c="var(--shu-text)">
                {T.ringNone}
              </Text>
            )}
          </Group>
          {packId && (
            <GitHubConnect
              opened={connectOpen}
              packId={packId}
              onClose={() => setConnectOpen(false)}
              onConnected={() => setReload((x) => x + 1)}
            />
          )}

          {/* 公開の台帳に出した束（SHARE を開いたときに読んだ行方）。出した束があれば、出す先の行のすぐ下。無ければ節ごと出さない */}
          {dest === "ledger" && prs && prs.length > 0 && (
            <section data-testid="ledger-prs">
              <Title order={2} fz={14} fw={500} mb="xs">
                {T.prsTitle}
              </Title>
              <Stack gap={4}>
                {prs.map((p) => (
                  <PrLine key={p.pr} p={p} />
                ))}
              </Stack>
            </section>
          )}

          {/* 見え方の答え（Claude との会話で決めてもよい。答えがそろうと、相手から見たあなたが出る） */}
          <Group gap="sm" align="flex-end" wrap="wrap">
            <NativeSelect
              size="xs"
              label={T.nationalQ}
              value={national === null ? "" : national ? "yes" : "no"}
              onChange={(e) => setNational(e.currentTarget.value === "" ? null : e.currentTarget.value === "yes")}
              data={[
                { value: "", label: T.choose },
                { value: "yes", label: T.yes },
                { value: "no", label: T.noAnswer },
              ]}
              data-testid="q-national"
            />
            {(res?.questions ?? []).map((q) => (
              <NativeSelect
                size="xs"
                key={q.key}
                label={q.name}
                value={facility[q.key] ?? ""}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setFacility((f) => ({ ...f, [q.key]: v === "" ? null : v }));
                }}
                data={[{ value: "", label: T.choose }, ...q.codes.map((c) => ({ value: c.code, label: c.name }))]}
                data-testid={`q-${q.key}`}
              />
            ))}
          </Group>
          {view && view.missing.length > 0 && (
            <Text size="xs" c="var(--shu-text)">
              {T.missingAxes(view.missing.map(axisName).join("、"))}
            </Text>
          )}

          {/* 相手から見たあなた：見え方の 1 行と、何施設のどれかに見えるか。塊ごとの周期・工数・日数の帯（委託先は伏せる） */}
          <section data-testid="you">
            <Title order={2} fz={14} fw={500} mb="xs">
              {dest === "ledger" ? T.youTitleLedger : T.youTitle}
            </Title>
            {view?.steps ? (
              <Stack gap={4}>
                {profileLine && (
                  <Text size="sm" data-testid="you-profile">
                    {T.profileLine(profileLine)} <span className="moyai-redact" aria-label={T.redacted} />
                  </Text>
                )}
                <Text size="lg" fw={500} className="moyai-num" data-testid="you-steps">
                  {view.profile?.group === "NATIONAL" ? T.youSteps(view.steps.all, view.steps.profile, view.steps.rows) : T.youPeers(view.steps.rows)}
                </Text>
                <Text size="xs" c="dimmed" className="moyai-num" data-testid="you-k" data-k={view.k ?? ""}>
                  {T.kLine(view.k ?? 0, view.minK)}
                  {T.stage(view.profile?.stage ?? 0) ? `　${T.stage(view.profile?.stage ?? 0)}` : ""}
                </Text>
                {view.rowEffects.length > 0 &&
                  view.rowEffects.map((e) => (
                    <Text size="xs" key={e.class} className="moyai-num">
                      {T.rowEffect(className(e.class), e.n)}
                    </Text>
                  ))}
                {body && (
                  <Table verticalSpacing={6} fz="sm" mt="xs" className="moyai-num" style={{ maxWidth: 920 }}>
                    <Table.Thead>
                      <Table.Tr>
                        {T.youHead.map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {body.chunks.map((c, i) => (
                        <Table.Tr key={i} data-testid="plain-chunk">
                          <Table.Td>{T.chunkPath(className(c.class), workLabels[c.work] ?? c.work)}</Table.Td>
                          <Table.Td>{c.interval ? bandShort(c.interval) : T.none}</Table.Td>
                          <Table.Td>{c.manDays ? bandShort(c.manDays) : T.none}</Table.Td>
                          <Table.Td>{c.days ? bandShort(c.days) : T.none}</Table.Td>
                          <Table.Td>
                            <span className="moyai-redact" aria-label={T.redacted} />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                )}
                {dest === "ledger" && (view.copy?.skipped.upgradeLedger ?? 0) > 0 && (
                  <Text size="sm" className="moyai-num" data-testid="not-on-ledger">
                    {T.upgradeRow(view.copy?.skipped.upgradeLedger ?? 0)}
                    <Text span size="xs" c="dimmed">
                      {T.notOnLedger}
                    </Text>
                  </Text>
                )}
                {dest === "ledger" && login && (
                  <Text size="xs" c="var(--shu-text)" data-testid="account-seen">
                    {T.accountSeen(login)}
                  </Text>
                )}
              </Stack>
            ) : (
              <Stack gap={4}>
                <Text size="sm">{loading ? T.loading : T.noBody}</Text>
                {view && view.tried.length > 0 && (
                  <Text size="xs" c="dimmed" className="moyai-num">
                    {T.tried}：{view.tried.map((t) => T.triedRow(t.stage, t.coarse, t.k)).join(" → ")}
                  </Text>
                )}
              </Stack>
            )}
          </section>

          {/* 出元：鍵の指紋と、束の鎖（名前は出ない） */}
          {dest === "ledger" && res?.ledger?.fingerprint && (
            <section data-testid="share-source">
              <Title order={2} fz={14} fw={500} mb="xs">
                {T.sourceTitle}
              </Title>
              <Stack gap={2}>
                <Text size="xs" c="dimmed" className="moyai-num">
                  {T.fingerprint}　{res.ledger.fingerprint}
                </Text>
                {chain.length > 0 && (
                  <Text size="xs" c="dimmed" className="moyai-num" data-testid="share-chain">
                    {chain.map((n) => T.bundleN(n)).join(" ← ")}
                  </Text>
                )}
              </Stack>
            </section>
          )}
          {dest === "ring" && res?.ring && (
            <section data-testid="share-source">
              <Title order={2} fz={14} fw={500} mb="xs">
                {T.sourceTitle}
              </Title>
              <Stack gap={2}>
                {res.ring.fingerprint && (
                  <Text size="xs" c="dimmed" className="moyai-num">
                    {T.fingerprint}　{res.ring.fingerprint}
                  </Text>
                )}
                {chain.length > 0 && (
                  <Text size="xs" c="dimmed" className="moyai-num" data-testid="share-chain">
                    {chain.map((n) => T.bundleN(n)).join(" ← ")}
                  </Text>
                )}
              </Stack>
            </section>
          )}

          <Text size="xs" c="dimmed" className="moyai-num" data-testid="counts">
            {view?.counts ? T.counts(view.counts) : T.counts({ shape: NaN, properNoun: NaN, money: NaN, freeText: NaN, exactDate: NaN }).replace(/NaN/g, "—")}
          </Text>

          {/* 中身を見る：原本・出ていくバイト列そのもの（ハッシュ・メモ帳で開く）・相手の星取表。閉じていても DOM には残す */}
          <details data-testid="share-contents">
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>{T.contentsTitle}</summary>
            <Stack gap="md" mt="sm">
              <Paper withBorder p="sm" data-testid="col-outgoing">
                <Group justify="space-between" align="flex-start">
                  <Title order={4}>{T.col2}</Title>
                  {/* メモ帳で開くのは輪の束だけ（公開の台帳の束は、PR に出たものを GitHub で誰でも開ける） */}
                  {dest === "ring" && (
                    <Button size="xs" variant="default" onClick={openText} disabled={!view?.bodyText} data-testid="open-text">
                      {T.openText}
                    </Button>
                  )}
                </Group>
                {view?.bodyText && view.bodyHash ? (
                  <>
                    <Text size="xs" className="moyai-num">
                      {T.hash}：
                      <Code data-testid="body-hash">{view.bodyHash}</Code>
                    </Text>
                    <Text size="xs" className="moyai-num">
                      {T.bytes(view.bytes ?? 0)} · {T.seq(view.seq)}
                    </Text>
                    <ScrollArea h={240} mt={4}>
                      <Code block data-testid="body-text" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                        {view.bodyText}
                      </Code>
                    </ScrollArea>
                  </>
                ) : (
                  <Text size="sm">{T.noBody}</Text>
                )}
                {opened && (
                  <Text size="xs" c="dimmed" mt={4}>
                    {T.opened(opened)}
                  </Text>
                )}
              </Paper>

              <Paper withBorder p="sm" data-testid="col-original">
                <Title order={4}>{T.col1}</Title>
                {view?.copy && (
                  <Text size="sm" fw={700} className="moyai-num" data-testid="copied">
                    {T.copied(view.copy.copied, view.copy.rows)}
                  </Text>
                )}
                <ScrollArea h={280} type="auto">
                  <Table className="moyai-num" fz="xs" withRowBorders miw={760} style={{ whiteSpace: "nowrap" }}>
                    <Table.Thead>
                      <Table.Tr>
                        {T.col1Head.map((h) => (
                          <Table.Th key={h}>{h}</Table.Th>
                        ))}
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {(view?.original ?? []).map((r, i) => (
                        <Table.Tr key={i}>
                          <Table.Td>
                            <Sumi />
                          </Table.Td>
                          <Table.Td>
                            <Sumi />
                          </Table.Td>
                          <Table.Td>{r.commonItem ? <Text span size="xs" className="moyai-shu">{T.col1Lift(className(r.commonItem), r.lifted ? className(r.lifted) : null)}</Text> : "—"}</Table.Td>
                          <Table.Td>{r.attribute ? (workLabels[r.attribute] ?? r.attribute) : "—"}</Table.Td>
                          <Table.Td>{r.fiscalYear}</Table.Td>
                          <Table.Td>{r.date ? <Sumi /> : "—"}</Table.Td>
                          <Table.Td>
                            <Num v={r.manDays} />
                          </Table.Td>
                          <Table.Td>
                            <Num v={r.days} />
                          </Table.Td>
                          <Table.Td>{r.cost !== null ? <Sumi /> : "—"}</Table.Td>
                          <Table.Td>{r.performer || r.contractor ? <Sumi /> : "—"}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  {view && view.originalTotal > view.original.length && <Text size="xs">{T.col1More(view.originalTotal - view.original.length)}</Text>}
                </ScrollArea>
                {view?.copy && (
                  <Stack gap={0} mt={4}>
                    <Text size="xs" fw={700}>
                      {T.skipped}
                    </Text>
                    {Object.entries(view.copy.skipped)
                      .filter(([, n]) => n > 0)
                      .map(([k, n]) => (
                        <Text size="xs" key={k} className="moyai-num">
                          {HUMAN_TEXT.skip[k] ?? k}：{n}
                        </Text>
                      ))}
                    <Text size="xs" fw={700} mt={4}>
                      {T.withheld}
                    </Text>
                    <Text size="xs" className="moyai-num">
                      {Object.entries(view.copy.withheld)
                        .filter(([, n]) => n > 0)
                        .map(([k, n]) => `${HUMAN_TEXT.withheld[k] ?? k} ${n}`)
                        .join("　")}
                    </Text>
                  </Stack>
                )}
              </Paper>

              {body && (
                <Paper withBorder p="sm">
                  <Title order={4}>{T.chartTitle}</Title>
                  <ScrollArea>
                    <Table className="moyai-num" fz="xs" withTableBorder withColumnBorders data-testid="their-chart">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th />
                          {years.map((y) => (
                            <Table.Th key={y}>{y.slice(2)}</Table.Th>
                          ))}
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {body.chunks.map((c, i) => (
                          <Table.Tr key={i}>
                            <Table.Td style={{ whiteSpace: "nowrap" }}>{T.col3Chunk(className(c.class), workLabels[c.work] ?? c.work)}</Table.Td>
                            {years.map((y) => (
                              <Table.Td key={y} ta="center">
                                {c.years.includes(y) ? "●" : ""}
                              </Table.Td>
                            ))}
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </ScrollArea>
                </Paper>
              )}
            </Stack>
          </details>

          {sendError && (
            <Alert color="red" data-testid="send-error">
              {sendError}
            </Alert>
          )}
          {sentPr && (
            <Alert color="gray" data-testid="ledger-sent">
              {T.prSent(sentPr.pr)}{" "}
              <Button component="a" href={sentPr.url} target="_blank" rel="noopener noreferrer" variant="default" size="xs">
                {T.prLink}
              </Button>
            </Alert>
          )}
          {sent && (
            <Alert color="gray" data-testid="sent">
              {T.sent(sent.fileName)}
            </Alert>
          )}

          {/* 受け取った束：輪の決まり・仲間・束ごとの ✓／✗ と理由（受け手と同じ関数）、検問所を通っていないファイルの数 */}
          {dest === "ring" && received && (
            <section data-testid="received">
              <Group justify="space-between" align="baseline" mb="xs">
                <Title order={2} fz={14} fw={500}>
                  {T.receivedTitle}
                </Title>
                <Button variant="default" size="xs" onClick={() => void verifyAgain()} data-testid="received-again">
                  {T.verifyAgain}
                </Button>
              </Group>
              <VerifyTable
                report={received}
                ownKey={res?.ring?.key ?? null}
                rulesChange={res?.ring?.rulesChange ?? null}
                onCheckMember={(l) => l.pub && setMemberCheck({ role: "member", by: "", pub: l.pub, fingerprint: l.fingerprint ?? "", trust: "unconfirmed" })}
                onViewRules={() => setRulesOpen(true)}
              />
            </section>
          )}
          <KeyCheckDialog
            signer={memberCheck}
            title={T.memberTitle}
            howTo={T.memberHowTo}
            onClose={() => setMemberCheck(null)}
            onMatch={async (m) => {
              const r = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("ring_member_confirm", ROUTES.ringMemberConfirm.path, { ringId, pub: m.pub }));
              return r.ok ? null : r.message;
            }}
            onConfirmed={() => {
              void verifyAgain();
              setReload((x) => x + 1);
            }}
          />
          {dest === "ledger" && res?.rulesChange && res.plan && (
            <RulesDialog
              title={T.ledgerRulesTitle}
              change={{ ...res.rulesChange, changer: null, month: null }}
              opened={ledgerRulesOpen}
              onClose={() => setLedgerRulesOpen(false)}
              onCheckChanger={() => undefined}
              onAccept={async () => {
                const r = readHuman<{ ok: boolean; reason?: string }>(
                  await client.callHuman("ledger_rules_accept", ROUTES.ledgerRulesAccept.path, { packId: res.plan!.packId, rulesHash: res.rulesChange!.rulesHash }),
                );
                if (!r.ok) return r.message;
                setReload((x) => x + 1);
                return null;
              }}
            />
          )}
          {res?.ring?.rulesChange && (
            <RulesDialog
              change={res.ring.rulesChange}
              opened={rulesOpen}
              onClose={() => setRulesOpen(false)}
              onCheckChanger={() => {
                const c = res.ring?.rulesChange?.changer;
                if (c) setMemberCheck({ role: "member", by: "", pub: c.pub, fingerprint: c.fingerprint, trust: "unconfirmed" });
              }}
              onAccept={async () => {
                const r = readHuman<{ ok: boolean; reason?: string }>(
                  await client.callHuman("ring_rules_accept", ROUTES.ringRulesAccept.path, { ringId, rulesHash: res.ring!.rulesChange!.rulesHash }),
                );
                if (!r.ok) return r.message;
                void verifyAgain();
                setReload((x) => x + 1);
                return null;
              }}
            />
          )}
        </Stack>
      </div>

      {/* 下の帯：出したあとに起きること（置き場所が残すもの・仲間に分かること）と、主ボタン 1 つ */}
      <Group justify="space-between" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar" data-testid="leave">
        <Stack gap={0} style={{ minWidth: 0 }}>
          {dest === "ledger" ? (
            <Text size="xs" c="dimmed" style={{ textWrap: "pretty" }} data-testid="ledger-bottom">
              {T.ledgerBottom}
            </Text>
          ) : (
            <>
              <Text size="xs" c="dimmed">
                {T.known}
                {(res?.ringCount ?? 0) > 1 ? ` ${T.twoRings}` : ""}
              </Text>
              <SyncedNotice synced={res?.ring?.synced} kind="ring" />
            </>
          )}
          {dest === "ring" && view?.vanished && (
            <Text size="xs" c="var(--shu-text)">
              {T.vanished}
            </Text>
          )}
          <Text size="xs" c="dimmed" data-testid="key-in-plan">
            {T.keyInPlan}
          </Text>
        </Stack>
        <Group gap="sm" wrap="nowrap" align="center" style={{ flex: "none" }}>
          {!canSend && (dest === "ledger" || !done) && sendReason && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }} data-testid="send-reason">
              {T.reasonHead}
              {dest === "ledger" && sendReason === T.sendNeeds.rules ? T.ledgerRulesNotAccepted : sendReason}
              {dest === "ledger" && sendReason === T.sendNeeds.rules && res?.rulesChange && (
                <button type="button" className="moyai-inline-act" onClick={() => setLedgerRulesOpen(true)} data-testid="send-ledger-rules-view">
                  {T.rulesView}
                </button>
              )}
              {dest === "ring" && (sendReason === T.sendNeeds.keysForked || sendReason === T.sendNeeds.chainForked) && (res?.ring?.keys?.length ?? 0) > 0 && (
                <button type="button" className="moyai-inline-act" onClick={() => setRotateOpen(true)} data-testid="rotate-open">
                  {T.rotate.open}
                </button>
              )}
              {dest === "ring" && sendReason === T.sendNeeds.rules && res?.ring?.rulesChange && (
                <button type="button" className="moyai-inline-act" onClick={() => setRulesOpen(true)} data-testid="send-rules-view">
                  {T.rulesView}
                </button>
              )}
            </Text>
          )}
          {rotateMsg && (
            <Text size="xs" data-testid="rotate-done">
              {rotateMsg}
            </Text>
          )}
          <Modal opened={rotateOpen} onClose={() => setRotateOpen(false)} title={T.rotate.title} centered data-testid="rotate-dialog">
            <Stack gap="sm">
              <Text size="xs" c="dimmed">
                {T.rotate.keys}
              </Text>
              {(res?.ring?.keys ?? []).map((k) => (
                <Text key={k} size="sm" ff="monospace">
                  {k}
                </Text>
              ))}
              <Text size="sm" c="var(--shu-text)">
                {T.rotate.result}
              </Text>
              <Group justify="flex-end" gap="sm">
                <Button variant="default" onClick={() => setRotateOpen(false)}>
                  {T.rotate.later}
                </Button>
                <Button
                  data-testid="rotate-run"
                  onClick={async () => {
                    if (!planId || !ringId || !res?.ring?.keys) return;
                    const r = readHuman<{ ok: boolean; retired: string[]; unsigned: string[] }>(
                      await client.callHuman("facility_key_rotate", ROUTES.facilityKeyRotate.path, { planId, ringId, keys: res.ring.keys }),
                    );
                    setRotateOpen(false);
                    if (!r.ok) return setSendError(r.message);
                    // 作り直したら、新しい鍵で送り直せる（送った知らせは消す）
                    setSent(null);
                    setRotateMsg([T.rotate.done(r.body.retired.length), ...(r.body.unsigned.length ? [T.rotate.unsigned(r.body.unsigned.length)] : [])].join(""));
                    setReload((x) => x + 1);
                  }}
                >
                  {T.rotate.run}
                </Button>
              </Group>
            </Stack>
          </Modal>
          {/* 押せない理由が別にあるときは、押せない理由を先にする */}
          {canSend && <KeyWarnLine signers={untrusted} onConfirmed={reloadStatus} />}
          <Button onClick={send} disabled={!canSend} loading={sending} data-testid="send">
            {dest === "ledger" ? T.sendLedger : T.sendRing}
          </Button>
        </Group>
      </Group>
    </div>
  );
}
