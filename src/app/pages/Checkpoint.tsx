// SHARE（共有。docs/screens.md 3.6、絵は ShareOne.dc.html。2026-11-10 に引き算した：運営者「足すのではなく引く。画面を人に操作させない。結果を見せて、ボタンを 1 つ押させる」）。
// 1 つの目的（相手から見たあなたを確かめる）と、人の操作 1 つ（主ボタン「署名して共有フォルダへ送信」か「署名して公開台帳へ送信」）。
// - 共有先は字で出す（共有フォルダ　フォルダの名前　n 施設／公開台帳　送信経路 …）。切り替えは、もう一方の共有先があるときだけ。送信経路は shareRouteOf が決め、
//   GitHub につないでいて受け口もあるときだけ切り替えを出す。GitHub につなぐのは、押せない理由「GitHub　未接続」の右の 1 つだけ。
// - 見え方の答えは画面で選ばない：施設の答えと規模からの見込みに、Claude が会話で聞いて share_preview の answers で置いた答えを重ねる（shareAnswersOf）。
//   Claude の答えなら「- Claude の入力」。足りなければ朱で「見え方 未確定 n（軸）」と押せない理由だけ（推測で埋めない）。
// - 数え直しの数は 0 でないときだけ。数えた段・原本・出ていくバイト列そのもの（ハッシュ・メモ帳で開く）・相手の星取表は「共有ファイルの中身」にたたむ。
// - 受信した共有ファイルは 1 行にたたみ、人が要る行（未照合・ルール変更・✗）があれば開いておく。
// - 下の帯の左は状態の 1 行（送ったあとは「✓ 送信　共有ファイル n　…」）。
// 署名は、人が主ボタンを押したときに決まる（合言葉はやめた。docs/plan.md §2.19）。出ていくものは橋渡しが作る（送る処理と同じ関数）。
// 公開の台帳へ PR を出すのは、人が主ボタンを押したときだけ（GitHub［名］か、受け口が運営者のアカウントで出す MOYAI 経由）。
// 断られたとき：台帳の検証で外れた → 送信履歴の行に朱で「受付不可　（理由）」、1 時間の上限 → 押せない理由「送信の上限（1 時間）　14:20 以降」、
// 受け口に届かない → 下の帯の左に朱で「受け口の応答なし」（押し直せば再送信）。取り下げのボタンが入るまで、下の帯で取り下げを約束しない。
import { Alert, Button, Code, Container, Group, Modal, NativeSelect, Paper, ScrollArea, Stack, Table, Text, Title } from "@mantine/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { APP_PAGES, ROUTES } from "../../shared/routes";
import { emptyCatalog } from "../chart/catalog";
import { readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { KeyCheckDialog, KeyWarnLine, untrustedSigners, type TrustSig } from "../components/KeyWarn";
import { FictionMark } from "../components/FictionMark";
import { GitHubConnect } from "../components/GitHubConnect";
import { Switch } from "../components/Switch";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { ringLabels, routeBlockers, shareRouteOf, type ShareRoute } from "../state/share-route";
import { HUMAN_TEXT, bandText, reasonText } from "../text";
import { bandShort } from "../../share/stat-text";
import { defaultRingId, defaultShareDest, shareAnswersOf } from "../../share/share-preview";
import { setShareChoice, useClaudeShare } from "../state/share";
import { sheetHash } from "../stages";

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
  synced?: Synced | null;
}
interface PreviewBody {
  ok: boolean;
  reason?: string;
  plan?: { planId: string; packId: string; version: number; displayName: string; fictional: boolean; inNationalTable: boolean | null; profile: Record<string, string> | null; pending: number };
  questions?: Question[];
  classNames?: Record<string, string>;
  axes?: { key: string; name: string; codes: { code: string; name: string }[] }[];
  rings?: RingInfo[];
  /** 台帳の clone を設定で選んであるか（共有先の切り替えを出すかを決める） */
  ledgerSet?: boolean;
  ring?: RingInfo & {
    key: string;
    keys?: string[];
    keyInfo?: { key: string; fingerprint: string | null; month: string | null }[];
    retiredCount?: number;
    fingerprint: string | null;
    folder: string;
    rulesChange?: RulesChange | null;
  };
  ringCount?: number;
  view?: View;
  /** 公開の台帳：GitHub の接続（アカウント名だけ。トークンは画面に来ない）と台帳 */
  github?: { login: string | null; ready: boolean };
  ledger?: { id: string; repo: string | null; key: string | null; fingerprint: string | null };
  pending?: { pr: number; url: string } | null;
  /** MOYAI 経由の道（公開台帳の受け口）があるか */
  intake?: boolean;
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
  /** 出した道（intake は MOYAI 経由） */
  via?: "github" | "intake";
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
      {p.via === "intake" && (
        <Text size="xs" c="dimmed" data-testid="ledger-pr-intake">
          {T.prViaIntake}
        </Text>
      )}
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
  retired?: true;
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

/** 受け取った束の行ごとの分け方（表の印とたたんだ 1 行の数で同じ） */
function lineMarks(report: Report, rulesChange: RulesChange | null) {
  // まだ確かめていないだけの仲間（ほかの理由が無い）と、その束：✗ と朱を使わず、確かめる道を行の右端に置く
  const unconfirmedOnly = (l: VerifyLine) => l.kind === "member" && l.reasons.length === 1 && l.reasons[0] === "member.unconfirmed";
  const notCounted = new Set(report.lines.filter(unconfirmedOnly).map((l) => l.name));
  return report.lines.map((line) => {
    const folder = line.kind === "bundle" ? (/bundles\/([0-9a-f]{16})\//.exec(line.name)?.[1] ?? null) : null;
    const unconfirmed = unconfirmedOnly(line);
    const short = line.kind === "bundle" && line.status === "ok" && !!line.short;
    // 失効した鍵の仲間と束は、集計に入れないので ✓ を付けない（薄い字で「失効」。Wire）
    const retired = !!line.retired;
    const uncounted = retired || short || (line.kind === "bundle" && line.status === "ok" && !!folder && notCounted.has(folder));
    const rulesRow = line.kind === "circle" && !!rulesChange;
    return { line, folder, unconfirmed, short, retired, uncounted, rulesRow, soft: unconfirmed || rulesRow };
  });
}

/**
 * 受け取った束の表（受け手と同じ関数で確かめた結果）。内部の ID（輪・鍵・ファイルの道）は出さず、
 * 人が電話で読み合わせる鍵の指紋で示す：「決まり」「仲間　指紋（あなた）」「束 n　指紋」と、✓／✗ と理由
 */
function VerifyTable({
  report,
  ownKey,
  retiredCount = 0,
  rulesChange = null,
  onCheckMember,
  onViewRules,
}: {
  report: Report;
  ownKey: string | null;
  /** 当施設の失効した鍵の数（今の鍵の右に「失効 n」） */
  retiredCount?: number;
  rulesChange?: RulesChange | null;
  onCheckMember?: (l: VerifyLine) => void;
  onViewRules?: () => void;
}) {
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
        {lineMarks(report, rulesChange).map(({ line: l, folder, unconfirmed, short, retired, uncounted, rulesRow, soft }) => {
          const b = l.kind === "bundle" ? /bundles\/([0-9a-f]{16})\/(\d{6})-/.exec(l.name) : null;
          const label =
            l.kind === "circle" ? T.verifyKind.circle : l.kind === "member" ? T.verifyKind.member : b ? T.prBundle(Number(b[2]), l.version ?? null, l.day ?? l.month ?? "") : T.notBundleRow;
          const key = l.kind === "member" ? l.name : folder;
          const mark = soft ? "!" : uncounted ? "―" : (T.verifyStatus[l.status] ?? l.status);
          return (
            <Table.Tr
              key={`${l.kind}:${l.name}`}
              data-testid="verify-line"
              data-status={l.status}
              data-kind={l.kind}
              data-state={retired ? "retired" : unconfirmed ? "unconfirmed" : short ? "peersShort" : uncounted ? "notCounted" : rulesRow ? "rulesChanged" : undefined}
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
                  {l.kind === "member" && key === ownKey && retiredCount > 0 && (
                    <Text span size="xs" c="var(--text-3)" ff="var(--font-body)" ml={8} data-testid="own-retired">
                      {T.retiredOwn(retiredCount)}
                    </Text>
                  )}
                </Text>
              </Table.Td>
              {retired ? (
                <Table.Td c="var(--text-3)">{l.kind === "member" ? T.retiredMember : T.retiredBundle}</Table.Td>
              ) : unconfirmed ? (
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

type Route = ShareRoute;
const routeKey = (planId: string) => `moyai.share.route.${planId}`;

/** 覚えた送信経路（施設＝計画ごと。localStorage。読めなければ null） */
function readRoute(planId: string | null): Route | null {
  if (!planId) return null;
  try {
    const v = localStorage.getItem(routeKey(planId));
    return v === "github" || v === "intake" ? v : null;
  } catch {
    return null;
  }
}

function saveRoute(planId: string | null, v: Route): void {
  if (!planId) return;
  try {
    localStorage.setItem(routeKey(planId), v);
  } catch {
    /* 覚えられなくても、選んだ経路はこの画面で効く */
  }
}

/** 理由のコードの並びを、台帳の検証と同じ言葉にする */
function reasonsTextOf(reasons: unknown): string {
  return Array.isArray(reasons) ? [...new Set(reasons.filter((x): x is string => typeof x === "string").map(reasonText))].join("、") : "";
}

/** その PC の時刻の時と分（14:20） */
function hourMinute(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 受信した共有ファイルの数（たたんだ 1 行）。表の印と同じ分け方（✓・! 未照合・! ルール変更・✗。集計対象外と失効は数えない） */
function receivedCounts(report: Report, rulesChange: RulesChange | null) {
  const c = { ok: 0, unconfirmed: 0, rules: false, ng: 0 };
  for (const m of lineMarks(report, rulesChange)) {
    if (m.unconfirmed) c.unconfirmed++;
    else if (m.rulesRow) c.rules = true;
    else if (m.uncounted) continue;
    else if (m.line.status === "ok") c.ok++;
    else c.ng++;
  }
  return c;
}

/**
 * 見え方の 1 行（画面に選びは置かない。2026-11-10）：「施設 ― ストーカ炉、…　同区分の施設 38（全国 844）」。
 * 答えが足りなければ朱で「施設 ― 見え方 未確定 n（軸）」だけ。Claude が置いた答えなら右に朱の小さな字「- Claude の入力」
 */
export function YouProfile({
  undetermined,
  profile,
  k,
  loading,
  ai,
}: {
  /** 決まらない軸の名前（決まっていれば null） */
  undetermined: string[] | null;
  /** 見え方の 1 行（施設 ― …、所在） */
  profile: string | null;
  k: { k: number; minK: number; all: number | null } | null;
  loading: boolean;
  ai: boolean;
}) {
  return (
    <Text size="sm" c="var(--text-2)" className="moyai-num">
      {undetermined ? (
        <Text span c="var(--shu-text)" data-testid="you-profile" data-state="undetermined">
          {T.profileUndetermined(undetermined.length, undetermined.join("・"))}
        </Text>
      ) : profile && k ? (
        <>
          <Text span data-testid="you-profile">
            {profile} <span className="moyai-redact" aria-label={T.redacted} />
          </Text>
          {"　"}
          <Text span c={k.k < k.minK ? "var(--shu-text)" : "var(--text)"} data-testid="you-k" data-k={k.k}>
            {k.k < k.minK ? T.kLineShort(k.k, k.minK) : T.kLine(k.k, k.all)}
          </Text>
        </>
      ) : (
        <Text span>{loading ? T.loading : T.noBody}</Text>
      )}
      {ai && (
        <Text span size="xs" c="var(--shu-text)" ml={16} style={{ letterSpacing: "0.1em" }} data-testid="ai-answers-mark">
          {T.aiMark}
        </Text>
      )}
    </Text>
  );
}

const Label = ({ children }: { children: ReactNode }) => (
  <Text span size="xs" c="var(--text-3)" style={{ letterSpacing: "0.1em" }}>
    {children}
  </Text>
);

/** embedded：HOSHITORI の共有のシートの中（施設の名前と版は HOSHITORI の見出しが出す。mushitaro/moyai#30） */
export function Checkpoint({ embedded = false }: { embedded?: boolean } = {}) {
  const working = useWorkingPlan();
  const { client, state } = useConnection();
  const planId = working?.plan.planId ?? null;
  // 送る版の鎖に、まだ確かめていない鍵があれば、主ボタンの左（押せない理由と同じ所）に 1 行（KeyWarn.dc.html の 4。止めない）
  const [status, reloadStatus] = usePlanStatus(client, planId ?? "", !!planId && state.kind === "open");
  const untrusted = status.kind === "ready" && status.status.versions ? untrustedSigners(status.status.versions) : [];
  // このタブで Claude が会話で聞いて置いた見え方の答えと共有先（share_preview。画面の今の選びになるだけ）
  const claude = useClaudeShare(planId);
  const [ringId, setRingId] = useState<string | null>(null);
  // 見え方の答えのもと（橋渡しが返した軸と、確定した版の施設の答え）。答えは画面に選びを置かず、shareAnswersOf で決める
  const [qs, setQs] = useState<{ questions: Question[]; profile: Record<string, string> | null; national: boolean | null } | null>(null);
  const [res, setRes] = useState<PreviewBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 断られた理由のコード（設定で直すもの：共有フォルダなし・台帳の clone が未設定。設定への道を添える）
  const [errorReason, setErrorReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ seq: number; at: string } | null>(null);
  // 受け取った束（docs/screens.md 3.6）：輪を受け手と同じ関数で確かめた結果。ふだんは 1 行にたたむ（人が要る行があれば開く）
  const [received, setReceived] = useState<Report | null>(null);
  const [recvOpen, setRecvOpen] = useState<boolean | null>(null);
  // 受け取った束の行で直す：仲間の鍵の読み合わせと、輪の決まりの受け入れ（Share.dc.html Version 46。監査 D1）
  const [memberCheck, setMemberCheck] = useState<TrustSig | null>(null);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ledgerRulesOpen, setLedgerRulesOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateMsg, setRotateMsg] = useState<string | null>(null);
  const [rotateUnsigned, setRotateUnsigned] = useState(0);
  const [sendError, setSendError] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [dest, setDest] = useState<"ring" | "ledger">(claude?.dest ?? "ring");
  // 人か Claude が共有先を選んだか（選んでいなければ、この Skillパックの共有フォルダが無く台帳の clone があるとき公開台帳にする）
  const destChosen = useRef(!!claude?.dest);
  // 選べる共有先（最後に読めた答えから。共有先の切り替えは、もう一方があるときだけ出す）
  const [avail, setAvail] = useState<{ ring: boolean; ledger: boolean } | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [prs, setPrs] = useState<LedgerPr[] | null>(null);
  const [sentPr, setSentPr] = useState<{ pr: number; url: string; seq: number } | null>(null);
  // 送信経路（施設＝計画ごとに覚える。null は人がまだ選んでいない）と、MOYAI 経由で断られたときの 3 つ
  const [route, setRoute] = useState<Route | null>(null);
  const [refusedRow, setRefusedRow] = useState<{ seq: number; version: number | null; at: string; reasons: string } | null>(null);
  const [limitUntil, setLimitUntil] = useState<number | null>(null);
  const [noAnswer, setNoAnswer] = useState(false);
  const [reload, setReload] = useState(0);
  const seq = useRef(0);

  const packOfPlan = working?.plan.packId ?? null;
  // 見え方の答え：規模からの見込み＋Claude の答え＋施設の答え（橋渡しの share_preview と同じ関数）。全国の表に載るかは作業中の計画の答えを先に
  const shared = useMemo(
    () =>
      shareAnswersOf({
        questions: qs?.questions ?? [],
        profile: qs?.profile ?? null,
        national: working?.plan.facility.inNationalTable ?? qs?.national ?? null,
        ai: claude?.answers ?? null,
      }),
    [qs, claude?.answers, working?.plan.facility.inNationalTable],
  );
  const answers = shared.answers;

  const switchDest = (v: "ring" | "ledger") => {
    setDest(v);
    setRes(null);
    setSent(null);
    setSentPr(null);
    setSendError(null);
    setRefusedRow(null);
    setNoAnswer(false);
  };

  // 画面を閉じたら、AI の share_preview に渡す選びを消す（Claude の置いた答えはこのタブの間残る）
  useEffect(() => () => setShareChoice(null), []);
  // Claude が共有先を置いたら、それにする（人があとで切り替えられる）
  useEffect(() => {
    if (!claude?.dest || claude.destSeq === 0) return;
    destChosen.current = true;
    if (claude.dest !== dest) switchDest(claude.dest);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claude?.destSeq]);
  // 送信経路は施設（計画）ごとに覚える
  useEffect(() => setRoute(readRoute(planId)), [planId]);
  // 1 時間の上限：その時刻まで押せない。過ぎたら押せる
  useEffect(() => {
    if (limitUntil === null) return;
    const ms = limitUntil - Date.now();
    if (ms <= 0) return setLimitUntil(null);
    const t = setTimeout(() => setLimitUntil(null), Math.min(ms, 2 ** 31 - 1));
    return () => clearTimeout(t);
  }, [limitUntil]);

  // 共有先・共有フォルダ・答えが変わるたびに、橋渡しで出ていくものを作り直す（送る処理と同じ関数）。
  // 断られても（共有フォルダが無い・見え方が決まらないなど）、共有フォルダの一覧と軸は返ってくるので使う。
  useEffect(() => {
    if (state.kind !== "open" || !planId) return;
    // 画面の選びを、AI の share_preview にも渡す（画面と同じ数を返すため。src/app/state/share.ts）
    setShareChoice({ planId, dest, ringId });
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
      setErrorReason(!h.ok && r.ok && typeof (r.body as PreviewBody).reason === "string" ? ((r.body as PreviewBody).reason as string) : null);
      if (!r.ok) return;
      const b = r.body as PreviewBody;
      setRes(b);
      if (b.questions) setQs((q) => q ?? { questions: b.questions!, profile: b.plan?.profile ?? null, national: b.plan?.inNationalTable ?? null });
      const pack = b.plan?.packId ?? packOfPlan;
      const hasRing = !!b.rings && b.rings.some((x) => x.pack === pack);
      if (b.rings && typeof b.ledgerSet === "boolean") setAvail({ ring: hasRing, ledger: b.ledgerSet });
      // 共有先の既定：この Skillパックの共有フォルダが無く、台帳の clone があれば公開台帳（橋渡しの share_preview と同じ関数）
      if (!destChosen.current && b.rings && typeof b.ledgerSet === "boolean") {
        destChosen.current = true;
        const d = defaultShareDest(hasRing, b.ledgerSet);
        if (d !== dest) return switchDest(d);
      }
      if (dest === "ring" && ringId === null && b.rings && pack) {
        const first = defaultRingId(b.rings, pack);
        if (first) setRingId(first);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, state.kind, planId, ringId, answers, dest, reload]);

  // 出した束の行方：公開の台帳を選んで SHARE を開いたときだけ、公開の PR を読む（トークンは使わない）
  const packId = res?.plan?.packId ?? packOfPlan;
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

  const ringsForPack = (res?.rings ?? []).filter((r) => r.pack === packId);
  const noRings = !!res?.rings && ringsForPack.length === 0;
  const labels = useMemo(() => ringLabels(res?.rings ?? []), [res?.rings]);
  const countsZero = !!view?.counts && Object.values(view.counts).every((n) => n === 0);
  const done = dest === "ledger" ? !!sentPr : !!sent;
  const login = res?.github?.login ?? null;
  // 送信経路：MOYAI 経由は受け口があるときだけ。GitHub につないでいなければ MOYAI 経由、つないでいれば覚えた経路（既定は GitHub［名］）
  const intakeAvail = dest === "ledger" && res?.intake === true;
  const viaIntake = dest === "ledger" && shareRouteOf({ login, intake: intakeAvail, chosen: route }) === "intake";
  // MOYAI 経由では、GitHub に未接続（noKey）は押せない理由にしない
  const blockers = view ? routeBlockers(viaIntake ? "intake" : "github", view.blockers) : [];
  const limited = viaIntake && limitUntil !== null && limitUntil > Date.now();
  const canPress = !!view && blockers.length === 0 && !!view.bodyHash && countsZero && view.k !== null && view.k >= view.minK && !sending && !done && !limited;
  // 送ったあと：ほかに押せない理由が無ければ「送信済み」（台帳の「まだ載っていません」は送ったことの続きなので、この画面の間は「送信済み」）。
  // 送ったあとに署名鍵の重複などが出たら、そちらを出す（再発行の道を添えるため）
  const afterSend = done && blockers.every((b) => b === "pending");
  // 止め札は、いま効いている理由を 1 つだけ出す（公開の台帳でつないでいなければ、それが先）
  const sendReason = afterSend
    ? T.sendNeeds.sent!
    : !view
      ? T.sendNeeds.noView
      : blockers.includes("keysForked")
        ? T.sendNeeds.keysForked
        : blockers.includes("chainForked")
          ? T.sendNeeds.chainForked
          : blockers.includes("keyRetired")
            ? T.sendNeeds.keyRetired
            : blockers.includes("noKey")
              ? T.sendNeeds.noKey
              : blockers.includes("pending")
                ? T.sendNeeds.pending
                : blockers.length > 0
                  ? (T.sendNeeds[blockers[0]!] ?? blockers[0]!)
                  : limited
                    ? T.intakeRateLimited(hourMinute(limitUntil!))
                    : "";
  const chooseRoute = (v: Route) => {
    setRoute(v);
    saveRoute(planId, v);
    setNoAnswer(false);
    setSendError(null);
  };

  const send = async () => {
    if (dest === "ledger" && viaIntake) return sendIntake();
    if (!canPress || !view?.bodyHash || !res?.plan) return;
    if (dest === "ledger") {
      setSending(true);
      setSendError(null);
      setRefusedRow(null);
      const raw = await client.callHuman("ledger_send", ROUTES.ledgerSend.path, { planId, version: res.plan.version, answers, previewHash: view.bodyHash });
      const r = readHuman<{ ok: boolean; reason?: string; pr: number; url: string }>(raw);
      setSending(false);
      if (!r.ok) {
        // 台帳の検証で外れた：送信履歴の行に「受付不可　（理由）」（clone で先に確かめたときと同じ字）
        const b = raw.ok ? (raw.body as { reason?: unknown; reasons?: unknown }) : null;
        if (b?.reason === "ledgerNg") return setRefusedRow({ seq: view.seq, version: res.plan.version, at: new Date().toISOString(), reasons: reasonsTextOf(b.reasons) });
        return setSendError(r.message);
      }
      setSentPr({ pr: r.body.pr, url: r.body.url, seq: view.seq });
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
    const at = new Date();
    setSent({ seq: view.seq, at: `${dayOf(at.toISOString())} ${hourMinute(at.getTime())}` });
    setReceived(r.body.report);
  };

  // MOYAI 経由で送る：束に署名し、受け口に送る（受け口が運営者の GitHub アカウントで PR を出す）
  const sendIntake = async () => {
    if (!viaIntake || !canPress || !view?.bodyHash || !res?.plan) return;
    setSending(true);
    setSendError(null);
    setRefusedRow(null);
    setNoAnswer(false);
    const raw = await client.callHuman("ledger_intake_send", ROUTES.ledgerIntakeSend.path, { planId, version: res.plan.version, answers, previewHash: view.bodyHash });
    const r = readHuman<{ ok: boolean; reason?: string; pr: number; url: string }>(raw);
    setSending(false);
    if (!r.ok) {
      const b = raw.ok ? (raw.body as { reason?: unknown; reasons?: unknown; retryAt?: unknown }) : null;
      const reason = typeof b?.reason === "string" ? b.reason : "";
      // 台帳の検証で外れた（clone で先に確かめたときも、受け口が断ったときも）：送信履歴の行に「受付不可　（理由）」。直せばもう一度押せる
      if (reason === "ledgerNg" || reason === "intake.refused" || reason === "intake.tooLarge") {
        return setRefusedRow({ seq: view.seq, version: res.plan.version, at: new Date().toISOString(), reasons: reasonsTextOf(b?.reasons) });
      }
      // 1 時間の上限：その時刻まで押せない（送信履歴には行を足さない）
      if (reason === "intake.rateLimited") {
        const at = typeof b?.retryAt === "string" ? Date.parse(b.retryAt) : NaN;
        return setLimitUntil(Number.isNaN(at) ? Date.now() + 60 * 60 * 1000 : at);
      }
      // 受け口に届かない：下の帯の左に「受け口の応答なし」。押せる主ボタンはそのまま（押し直せば再送信）
      if (!raw.ok || reason === "intake.network" || reason === "intake.unavailable") return setNoAnswer(true);
      return setSendError(r.message);
    }
    setSentPr({ pr: r.body.pr, url: r.body.url, seq: view.seq });
    setReload((x) => x + 1);
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

  // 計画が無いとき：EXPORT と同じ形と言葉（作業中の計画がありません。HOSHITORI へ）
  if (!planId) {
    return (
      <div className="moyai-share-page" data-testid="checkpoint-page">
        <div className="moyai-share-body">
          <Text size="sm" data-testid="checkpoint-no-plan">
            {T.noPlan} <a href={sheetHash("files")}>{T.toMerge}</a>
          </Text>
        </div>
      </div>
    );
  }

  const years = body ? [...new Set(body.chunks.flatMap((c) => c.years))].sort() : [];
  const chain = view ? Array.from({ length: Math.min(3, view.seq) }, (_, i) => view.seq - i) : [];
  // 見え方の 1 行：共有ファイルの body と同じ軸の順（JCS。鍵の順）。送れないあいだ（GitHub に未接続など）も、見え方が決まっていれば出す
  const profileAxes = body?.profile.axes ?? view?.profile?.axes ?? null;
  const profileLine = profileAxes
    ? Object.keys(profileAxes)
        .sort()
        .map((k) => codeName(k, profileAxes[k]!))
        .join("、")
    : null;
  // 見え方が決まらない：全国の表に載るかと、足りない軸（画面に選びは置かない。Claude が会話で聞いて置く）
  const undetermined = !!view && (view.blockers.includes("groupUnknown") || view.blockers.includes("profileIncomplete"));
  const undeterminedNames = [...(answers.inNationalTable === null ? [T.nationalQ] : []), ...(view?.missing ?? []).map(axisName)];
  const aiShown = shared.aiAxes.length > 0 && !done;
  // 共有先の切り替えは、もう一方の共有先があるときだけ
  const other = dest === "ring" ? avail?.ledger : avail?.ring;
  const ringLabel = ringId ? (labels.get(ringId) ?? null) : null;
  const members = received ? received.lines.filter((l) => l.kind === "member" && !l.retired).length : null;
  const recvCounts = received ? receivedCounts(received, res?.ring?.rulesChange ?? null) : null;
  const recvNeedsPerson = !!recvCounts && (recvCounts.unconfirmed > 0 || recvCounts.rules || recvCounts.ng > 0);
  const recvIsOpen = recvOpen ?? recvNeedsPerson;
  const countsNonZero = !!view?.counts && !countsZero;

  return (
    <div className="moyai-share-page" data-testid="checkpoint-page">
      <div className="moyai-share-body">
        {!embedded && (
          <div className="moyai-page-head">
            <h1 className="moyai-merge-name">{res?.plan?.displayName ?? working?.plan.displayName}</h1>
            {res?.plan && <span className="moyai-merge-ver">{T.versionOf(res.plan.version)}</span>}
            {(res?.plan?.fictional ?? working?.plan.facility.fictional) && <FictionMark />}
          </div>
        )}

        <Stack gap="lg">
          {state.kind !== "open" && <Alert color="orange">{HUMAN_TEXT.notConnected}</Alert>}
          {/* 共有フォルダが 1 つも無いときの「選んでください」は、共有先の右の「共有フォルダがありません　| 設定へ」と同じことなので重ねない */}
          {error && !(errorReason === "noRingChosen" && noRings) && (
            <Alert color="orange" data-testid="checkpoint-refused">
              {error}
              {errorReason === "ledger.notChosen" && (
                <a className="moyai-inline-act" href={APP_PAGES.settings} data-testid="checkpoint-to-settings">
                  {T.toSettings}
                </a>
              )}
            </Alert>
          )}

          {/* 共有先の 1 行（字。切り替えは、もう一方の共有先があるときだけ）：「共有先　共有フォルダ　北部ブロック　8 施設」「共有先　公開台帳　送信経路 GitHub［名］」 */}
          <Group align="center" data-testid="share-dest-line" style={{ fontSize: 13, columnGap: 16, rowGap: 4 }}>
            <Label>{T.destLabel}</Label>
            {other ? (
              <Switch<"ring" | "ledger">
                aria-label={T.destLabel}
                value={dest}
                onChange={(v) => {
                  destChosen.current = true;
                  switchDest(v);
                }}
                data={[
                  { value: "ring", label: T.dest.ring },
                  { value: "ledger", label: T.dest.ledger },
                ]}
                data-testid="share-dest"
              />
            ) : (
              <Text span size="sm" fw={500} data-testid="dest-name">
                {T.dest[dest]}
              </Text>
            )}
            {dest === "ring" && ringsForPack.length > 1 && (
              <NativeSelect
                size="xs"
                aria-label={T.ring}
                value={ringId ?? ""}
                onChange={(e) => setRingId(e.currentTarget.value || null)}
                data={[{ value: "", label: T.choose }, ...ringsForPack.map((r) => ({ value: r.ringId, label: labels.get(r.ringId) ?? r.ringId }))]}
                data-testid="ring-select"
              />
            )}
            {dest === "ring" && ringsForPack.length === 1 && ringLabel && (
              <Text span size="sm" c="var(--text-2)" data-testid="ring-label">
                {ringLabel}
              </Text>
            )}
            {dest === "ring" && members !== null && (
              <Text span size="sm" c="var(--text-2)" className="moyai-num" data-testid="ring-members">
                {T.ringMembers(members)}
              </Text>
            )}
            {dest === "ring" && noRings && (
              <Text span size="xs" c="var(--shu-text)" data-testid="ring-none">
                {T.ringNone}
                <a className="moyai-inline-act" href={APP_PAGES.settings} data-testid="ring-none-to-settings">
                  {T.toSettings}
                </a>
              </Text>
            )}
            {/* 送信経路：決まった経路を字で。GitHub につないでいて受け口もあるときだけ切り替え（docs/screens.md §3.6） */}
            {dest === "ledger" && (
              <Group gap="xs" align="center" data-testid="share-route" data-route={viaIntake ? "intake" : "github"}>
                <Label>{T.routeLabel}</Label>
                {login && intakeAvail ? (
                  <Switch<Route>
                    aria-label={T.routeLabel}
                    value={viaIntake ? "intake" : "github"}
                    onChange={chooseRoute}
                    data={[
                      { value: "github", label: T.routeGitHub(login) },
                      { value: "intake", label: T.routeIntake },
                    ]}
                    data-testid="route-switch"
                  />
                ) : (
                  <Text span size="sm" c="var(--text-2)" data-testid="github-login">
                    {viaIntake ? T.routeIntake : login ? T.routeGitHub(login) : T.routeGitHubNone}
                  </Text>
                )}
                {viaIntake && (
                  <Text span size="xs" c="var(--text-3)" data-testid="intake-ip">
                    {T.intakeIp}
                  </Text>
                )}
              </Group>
            )}
            {dest === "ledger" && res?.rulesChange && (
              <Text span size="sm" data-testid="ledger-rules-changed">
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
          </Group>
          {packId && <GitHubConnect opened={connectOpen} packId={packId} onClose={() => setConnectOpen(false)} onConnected={() => setReload((x) => x + 1)} />}

          {/* 相手から見たあなた：見え方の 1 行（施設 ― …　同区分の施設 m（全国 n））と、塊ごとの周期・工数・日数の帯（委託先は伏せる）。
              答えが足りなければ、朱で「見え方 未確定 n（軸）」だけ（表は出さない。選びも置かない） */}
          <section data-testid="you" style={{ background: "var(--layer-1)", padding: 24 }}>
            <Title order={2} fz={14} fw={500} mb="sm">
              {dest === "ledger" ? T.youTitleLedger : T.youTitle}
            </Title>
            <YouProfile
              undetermined={undetermined ? undeterminedNames : null}
              profile={view?.steps && profileLine ? T.profileLine(profileLine) : null}
              k={view?.steps && view.k !== null ? { k: view.k, minK: view.minK, all: view.profile?.group === "NATIONAL" ? view.steps.all : null } : null}
              loading={loading}
              ai={aiShown}
            />
            {body && !undetermined && (
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
            {dest === "ledger" && view?.steps && (view.copy?.skipped.upgradeLedger ?? 0) > 0 && (
              <Text size="sm" className="moyai-num" mt="xs" data-testid="not-on-ledger">
                {T.upgradeRow(view.copy?.skipped.upgradeLedger ?? 0)}
                <Text span size="xs" c="dimmed">
                  {T.notOnLedger}
                </Text>
              </Text>
            )}
          </section>

          {/* 提供元の 1 行：鍵番号・共有ファイルの連番・（公開台帳）PR のアカウント */}
          {((dest === "ledger" && res?.ledger?.fingerprint) || (dest === "ring" && res?.ring)) && (
            <Group align="baseline" data-testid="share-source" style={{ fontSize: 13, columnGap: 16, rowGap: 4 }}>
              <Label>{T.sourceTitle}</Label>
              {(dest === "ledger" ? res?.ledger?.fingerprint : res?.ring?.fingerprint) && (
                <Text span size="sm" ff="monospace" className="moyai-num">
                  {T.fingerprint} {dest === "ledger" ? res?.ledger?.fingerprint : res?.ring?.fingerprint}
                </Text>
              )}
              {chain.length > 0 && (
                <Text span size="sm" ff="monospace" c="var(--text-3)" className="moyai-num" data-testid="share-chain">
                  {chain.map((n) => T.bundleN(n)).join(" ← ")}
                </Text>
              )}
              {/* 「PR の GitHub アカウント　［名］」。GitHub［名］なら名前を朱、MOYAI 経由は運営の名をふつうの字で */}
              {dest === "ledger" && (viaIntake || login) && (
                <Text span size="xs" c="var(--text-3)" data-testid="account-seen">
                  {T.prAccount}
                  {"　"}
                  <Text span c={viaIntake ? undefined : "var(--shu-text)"} data-testid="account-name">
                    {viaIntake ? T.prAccountIntake : login}
                  </Text>
                </Text>
              )}
            </Group>
          )}

          {/* 数え直しの数：どれかが 0 でないときだけ（そのときは押せない理由） */}
          {countsNonZero && (
            <Text size="xs" c="var(--shu-text)" className="moyai-num" data-testid="counts">
              {T.counts(view!.counts!)}
            </Text>
          )}

          {/* 公開の台帳に出した束（SHARE を開いたときに読んだ行方）。無ければ出さない。
              台帳の検証で外れた束は、この画面の間だけ「受付不可　（理由）」の行を出す（PR は無い。まだ載っていないものには数えない） */}
          {dest === "ledger" && ((prs && prs.length > 0) || refusedRow) && (
            <section data-testid="ledger-prs">
              <Title order={2} fz={14} fw={500} mb="xs">
                {T.prsTitle}
              </Title>
              <Stack gap={4}>
                {refusedRow && (
                  <Group gap="md" wrap="nowrap" className="moyai-num" data-testid="ledger-refused">
                    <Text size="sm">{T.prBundle(refusedRow.seq, refusedRow.version, dayOf(refusedRow.at))}</Text>
                    <Text size="sm" c="var(--shu-text)">
                      {T.intakeRefused(refusedRow.reasons)}
                    </Text>
                  </Group>
                )}
                {(prs ?? []).map((p) => (
                  <PrLine key={p.pr} p={p} />
                ))}
              </Stack>
            </section>
          )}

          {/* 受信した共有ファイル：ふだんは 1 行（✓ 7　! 未照合 1）。人が要る行（未照合・ルール変更・✗）があれば開いておく */}
          {dest === "ring" && received && recvCounts && (
            <section data-testid="received" data-open={recvIsOpen}>
              <button
                type="button"
                onClick={() => setRecvOpen(!recvIsOpen)}
                aria-expanded={recvIsOpen}
                data-testid="received-summary"
                style={{ all: "unset", cursor: "pointer", display: "flex", gap: 16, alignItems: "baseline", fontSize: 13, minHeight: 40 }}
              >
                <Label>{T.receivedTitle}</Label>
                <Text span size="sm" c="var(--text-2)" className="moyai-num">
                  {T.receivedSummary(recvCounts)}
                </Text>
              </button>
              {recvIsOpen && (
                <Stack gap="xs">
                  <VerifyTable
                    report={received}
                    ownKey={res?.ring?.key ?? null}
                    retiredCount={res?.ring?.retiredCount ?? 0}
                    rulesChange={res?.ring?.rulesChange ?? null}
                    onCheckMember={(l) => l.pub && setMemberCheck({ role: "member", by: "", pub: l.pub, fingerprint: l.fingerprint ?? "", trust: "unconfirmed" })}
                    onViewRules={() => setRulesOpen(true)}
                  />
                  <Group justify="flex-end">
                    <Button variant="default" size="xs" onClick={() => void verifyAgain()} data-testid="received-again">
                      {T.verifyAgain}
                    </Button>
                  </Group>
                </Stack>
              )}
            </section>
          )}

          {/* 共有ファイルの中身（ここから PC の外へ出るものの証拠）：数えた段・出ていくバイト列（ハッシュ・メモ帳で開く）・原本・相手の星取表。閉じていても DOM には残す */}
          <details data-testid="share-contents">
            <summary style={{ cursor: "pointer", fontSize: 13, color: "var(--text-3)" }}>{T.contentsTitle}</summary>
            <Stack gap="md" mt="sm">
              {view?.steps && (
                <Stack gap={2}>
                  <Text size="sm" className="moyai-num" data-testid="you-steps">
                    {view.profile?.group === "NATIONAL" ? T.youSteps(view.steps.all, view.steps.profile, view.steps.rows) : T.youPeers(view.steps.rows)}
                  </Text>
                  {T.stage(view.profile?.stage ?? 0) && (
                    <Text size="xs" c="dimmed">
                      {T.stage(view.profile?.stage ?? 0)}
                    </Text>
                  )}
                  {view.rowEffects.map((e) => (
                    <Text size="xs" key={e.class} className="moyai-num">
                      {T.rowEffect(className(e.class), e.n)}
                    </Text>
                  ))}
                </Stack>
              )}
              {view && !view.steps && view.tried.length > 0 && (
                <Text size="xs" c="dimmed" className="moyai-num">
                  {T.tried}：{view.tried.map((t) => T.triedRow(t.stage, t.coarse, t.k)).join(" → ")}
                </Text>
              )}
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
                    {view.counts && (
                      <Text size="xs" c="dimmed" className="moyai-num" data-testid="counts-all">
                        {T.counts(view.counts)}
                      </Text>
                    )}
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

      {/* 下の帯：左に状態の 1 行（送ったあとは結果）、右に押せない理由と主ボタン 1 つ */}
      <Group justify="space-between" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar" data-testid="leave">
        <Stack gap={0} style={{ minWidth: 0 }}>
          {done ? (
            <Text size="xs" c="var(--text)" className="moyai-num" data-testid={dest === "ledger" ? "ledger-sent" : "sent"}>
              {dest === "ledger" && sentPr ? T.sentLedger(sentPr.seq, sentPr.pr) : sent ? T.sentRing(sent.seq, sent.at) : ""}
            </Text>
          ) : dest === "ledger" && viaIntake && noAnswer ? (
            <Text size="xs" c="var(--shu-text)" data-testid="intake-no-answer">
              {T.intakeNoAnswer}
            </Text>
          ) : dest === "ring" && view?.vanished ? (
            <Text size="xs" c="var(--shu-text)">
              {T.vanished}
            </Text>
          ) : (
            <Text size="xs" c="var(--text-3)" data-testid="share-note">
              {dest === "ledger" ? T.ledgerNote : ringLabel ? T.ringNote(ringLabel, members) : ""}
            </Text>
          )}
        </Stack>
        <Group gap="sm" wrap="nowrap" align="center" style={{ flex: "none" }}>
          {!canPress && sendReason && (
            <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }} data-testid="send-reason" data-state={afterSend ? "sent" : undefined}>
              {T.reasonHead}
              {dest === "ledger" && sendReason === T.sendNeeds.rules ? T.ledgerRulesNotAccepted : sendReason}
              {/* GitHub につなぐのは、この理由の右の 1 つだけ（つなぐ道が用意できていなければ出さない） */}
              {dest === "ledger" && sendReason === T.sendNeeds.noKey && res?.github?.ready !== false && (
                <button type="button" className="moyai-inline-act" onClick={() => setConnectOpen(true)} disabled={!packId} data-testid="github-open">
                  {T.githubConnect}
                </button>
              )}
              {dest === "ledger" && sendReason === T.sendNeeds.rules && res?.rulesChange && (
                <button type="button" className="moyai-inline-act" onClick={() => setLedgerRulesOpen(true)} data-testid="send-ledger-rules-view">
                  {T.rulesView}
                </button>
              )}
              {dest === "ring" && (sendReason === T.sendNeeds.keysForked || sendReason === T.sendNeeds.chainForked || sendReason === T.sendNeeds.keyRetired) && (res?.ring?.keys?.length ?? 0) > 0 && (
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
            <Text size="xs" c="var(--text-3)" data-testid="rotate-done">
              {rotateMsg}
              {rotateUnsigned > 0 && (
                <Text span c="var(--shu-text)" ml={8}>
                  {T.rotate.unsigned(rotateUnsigned)}
                </Text>
              )}
            </Text>
          )}
          <Modal opened={rotateOpen} onClose={() => setRotateOpen(false)} title={T.rotate.title} centered data-testid="rotate-dialog">
            <Stack gap="sm">
              <Text size="xs" c="dimmed">
                {T.rotate.keys}
              </Text>
              {(res?.ring?.keyInfo ?? []).map((k) => (
                <Text key={k.key} size="sm" ff="monospace" data-testid="rotate-key">
                  {k.fingerprint ?? T.unknownKey}
                  {k.month ? `　${k.month}` : ""}
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
                    setRotateMsg(T.rotate.done(r.body.retired.length));
                    setRotateUnsigned(r.body.unsigned.length);
                    setReload((x) => x + 1);
                  }}
                >
                  {T.rotate.run}
                </Button>
              </Group>
            </Stack>
          </Modal>
          {/* 押せない理由が別にあるときは、押せない理由を先にする */}
          {canPress && <KeyWarnLine signers={untrusted} onConfirmed={reloadStatus} />}
          <Button onClick={send} disabled={!canPress} loading={sending} data-testid="send" data-route={dest === "ledger" ? (viaIntake ? "intake" : "github") : undefined}>
            {dest === "ledger" ? T.sendLedger : T.sendRing}
          </Button>
        </Group>
      </Group>
    </div>
  );
}
