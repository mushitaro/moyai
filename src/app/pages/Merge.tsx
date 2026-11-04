// MERGE（版に重ねる。docs/screens.md 3.2・3.3、絵は Review.dc.html）：資料・Claude の案・人の答えを、次の版に重ねる段。
// 上は 2 行だけ（運営者の指示：データを広く）：見出しの 1 行（施設の名前・版・状態、右に施設の設定）と、シートのタブの 1 行。その下はすぐデータ。
// シートのタブ：星取表｜読み方｜検査｜決定 n｜資料｜＋ 資料を足す。前の画面（星取表・検査・取り込み）を、そのままシートとして入れる。
// 右の横の板は 1 枚で、切り替えは「決まっていない所 n（0 なら出さない）/ 署名 n / 出どころ（星取表のとき）」。印を選ぶと出どころへ。
// 下の帯は、止め札（決まっていない所・受けていない決定・橋渡しが切れている）とボタンだけ。「Claude に話す」の例は状態の帯（Shell）。
// 画面のどこに資料を落としても受ける（引きずって入ったときだけ、全面に「第 n 版に重ねます」）。版の下書きが無いあいだは、資料のシートだけ（白紙。新しい施設）。
import { Anchor, Button, FileButton, Group, Text } from "@mantine/core";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { ConfirmDialog, HistoryDialog, usePlanStatus } from "../components/ConfirmDialog";
import { SignDialog } from "../components/SignDialog";
import { SignaturesPanel, type PanelVersion } from "../components/SignaturesPanel";
import { DecisionsSheet, usePending } from "../components/DecisionsSheet";
import { ReadingsSheet, unapprovedReadings } from "../components/ReadingsSheet";
import { MatchSheet } from "../components/MatchSheet";
import { FictionMark } from "../components/FictionMark";
import type { IntakeWorkspace } from "../intake/workspace";
import { useConnection } from "../state/bridge";
import { useAccepted } from "../state/decisions";
import { MergeSideContext, type MergeSide } from "../state/merge-side";
import { setWorkingPlan, useWorkingPlan } from "../state/plan-store";
import { sheetHash, type MergeSheet } from "../stages";
import { TEXT } from "../text";
import { Intake, Questions, useWorkspace } from "./Intake";

const T = TEXT.merge;
// 星取表と検査は AG Grid や検査の関数を含むので、開いたときに読む
const StarTable = lazy(() => import("./StarTable").then((m) => ({ default: m.StarTable })));
const Review = lazy(() => import("./Review").then((m) => ({ default: m.Review })));

export function Merge({ ws, client, sheet }: { ws: IntakeWorkspace; client: BridgeClient; sheet: MergeSheet | null }) {
  useWorkspace(ws);
  const working = useWorkingPlan();
  const plan = working?.plan ?? null;
  const { state: conn } = useConnection();
  const accepted = useAccepted();
  const { pending } = usePending(client, plan);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [over, setOver] = useState(false);
  const nextPlan = useRef<Plan | null>(null);
  const [signRole, setSignRole] = useState<"approve" | "return" | null>(null);
  const [side, setSide] = useState<"open" | "signatures" | "source">("open");
  const [sourceEl, setSourceEl] = useState<HTMLElement | null>(null);
  const sideCtx = useMemo<MergeSide>(() => ({ el: sourceEl, show: () => setSide("source") }), [sourceEl]);
  const [notice, setNotice] = useState<string | null>(null);

  // メールのリンク（#/merge?open=<計画ID>&v=<版>&h=<中身のハッシュの頭>）で開いたら、保管先の版を読み、署名と鎖とハッシュを確かめてから置く
  const open = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const openId = open.get("open");
  const wantOpen = !!openId && plan?.planId !== openId;
  const [status, reloadStatus] = usePlanStatus(client, plan?.planId ?? openId ?? "", (!!plan || !!openId) && conn.kind === "open");
  const st = status.kind === "ready" ? status.status : null;
  useEffect(() => {
    if (!wantOpen || !st) return;
    const latest = st.latest;
    const info = st.versions?.at(-1);
    const fail = (k: string) => setNotice(T.openFailed(T.openWhat[k] ?? ""));
    if (!latest || !info) return fail("missing");
    if (String(latest.version) !== open.get("v")) return fail("version");
    if (!(info as { contentHash?: string }).contentHash?.startsWith(open.get("h") ?? "\u0000")) return fail("hash");
    if ((info as { problem?: string | null }).problem) return fail("broken");
    setWorkingPlan(latest.plan, "intake");
    setNotice(null);
  }, [wantOpen, st]);
  const turn = st?.turn ?? null;
  const me = st?.name ?? null;
  // 承認を頼まれた人（いちばん新しい版を渡した人でない人）には、承認と差し戻しを出す
  const awaitingMe = !!turn && turn.state === "awaitingApproval" && !!me && turn.from !== me && turn.version === st?.latest?.version;

  // 版の下書きが無いあいだは白紙（資料のシートだけ）。開発と試験の見本（?plan=）は、星取表のシートが読んで作業中の計画に置く
  const devSample = new URLSearchParams(location.search).has("plan");
  const current: MergeSheet = !plan ? (devSample && (sheet ?? "chart") === "chart" ? "chart" : "files") : (sheet ?? "chart");
  // 見出しの版：承認を頼まれた人には、頼まれた版（いちばん新しい版）を、ほかは次につくる版を出す
  const nextVersion = awaitingMe && st?.latest ? st.latest.version : (plan?.version ?? 0) + 1;
  const an = ws.fileCount ? ws.analysis() : null;
  const openQuestions = an ? an.open.length : 0;
  const leftDecisions = pending.filter((d) => !accepted.has(`${d.id}\u0000${d.hash}`)).length;
  const blocks = [
    !plan ? T.block.noPlan : null,
    openQuestions > 0 ? T.block.open(openQuestions) : null,
    leftDecisions > 0 ? T.block.pending(leftDecisions) : null,
    conn.kind !== "open" ? T.block.notConnected : null,
  ].filter((x): x is string => x !== null);
  const name = plan?.displayName || ws.settings.facilityName || T.newFacility;
  const fictional = plan ? plan.facility.fictional : ws.settings.fictional;

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    await ws.addFiles(files.map((f) => ({ name: f.name, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) })));
    if (!ws.settings.fictional && ws.sourcesMarkedFictional()) ws.setFacility({ fictional: true });
    location.hash = sheetHash("files");
  };
  const onDrop = (e: DragEvent) => {
    // 資料のシートの中の落とし場所は、取り込みが自分で受ける
    if ((e.target as HTMLElement).closest('[data-testid="drop"]')) return;
    e.preventDefault();
    setOver(false);
    void addFiles([...e.dataTransfer.files]);
  };
  const closeAnd = (close: () => void) => () => {
    close();
    if (nextPlan.current && working) setWorkingPlan(nextPlan.current, working.origin);
    nextPlan.current = null;
    reloadStatus();
  };
  // 突き合せは、このタブに資料が 2 つ以上あるとき。資料は、重ねた資料ごとのタブ（無ければ「資料」の 1 枚）
  const fileNames = an ? an.sources.map((x) => x.file) : [];
  const tabs: MergeSheet[] = plan ? ["chart", ...(fileNames.length >= 2 ? (["match"] as const) : []), "readings", "check", "decisions"] : ["files"];
  const fileParam = current === "files" ? new URLSearchParams(location.hash.split("?")[1] ?? "").get("f") : null;
  // 横の板：選んだ切り替えが出せればそれ。無ければ、決まっていない所 → 署名 → 出どころ の順
  const sideOpen = !!an && openQuestions > 0;
  const latestInfo = (st?.versions?.at(-1) as PanelVersion | undefined) ?? null;
  const sideSource = current === "chart";
  const can = { open: sideOpen, signatures: !!latestInfo, source: sideSource };
  const sideNow: "open" | "signatures" | "source" | null = can[side] ? side : sideOpen ? "open" : latestInfo ? "signatures" : sideSource ? "source" : null;
  const stateLabel = turn && (turn.state === "editing" || turn.state === "awaitingApproval" || turn.state === "returned") ? TEXT.top.state[turn.state] : null;
  const unapproved = unapprovedReadings(ws);

  return (
    <div
      className="moyai-merge"
      data-testid="merge-page"
      data-sheet={current}
      data-over={over ? "true" : "false"}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {over && (
        <div className="moyai-merge-over" aria-hidden="true">
          {T.dropHere(nextVersion)}
        </div>
      )}
      <div className="moyai-merge-head">
        <h1 className="moyai-merge-name" data-testid="plan-name">
          {name}
        </h1>
        <span className="moyai-merge-ver" data-testid="merge-version">
          {T.version(nextVersion)}
        </span>
        {stateLabel && <span className="moyai-merge-state">{stateLabel}</span>}
        {fictional && <FictionMark />}
        <div className="moyai-merge-head-end">
          <a href={sheetHash("files")} className="moyai-merge-link" data-testid="facility-settings">
            {T.facilitySettings}
          </a>
        </div>
      </div>
      {notice && (
        <Text size="sm" c="var(--shu-text)" px={32} data-testid="merge-notice">
          {notice}
        </Text>
      )}

      <Group justify="space-between" px={32} pt={4} wrap="nowrap" className="moyai-sheet-tabs">
        <Group gap="lg" wrap="nowrap" role="tablist">
          {tabs.map((s) => (
            <a key={s} role="tab" className="moyai-sheet-tab" href={sheetHash(s)} aria-selected={current === s} data-testid={`sheet-${s}`}>
              {T.sheets[s]}
              {s === "readings" && unapproved > 0 && (
                <Text span c="var(--shu)" className="moyai-num" ml={6}>
                  {unapproved}
                </Text>
              )}
              {s === "decisions" && leftDecisions > 0 && (
                <Text span c="var(--shu)" className="moyai-num" ml={6}>
                  {leftDecisions}
                </Text>
              )}
            </a>
          ))}
          {plan && fileNames.length > 0 && (
            <>
              <Text span size="xs" c="var(--text-disabled)" pl={12}>
                {T.filesLabel}
              </Text>
              {fileNames.map((f) => (
                <a key={f} role="tab" className="moyai-sheet-tab" href={`${sheetHash("files")}?f=${encodeURIComponent(f)}`} aria-selected={current === "files" && fileParam === f} data-testid="sheet-file" data-file={f}>
                  {f}
                </a>
              ))}
            </>
          )}
          <FileButton multiple onChange={(fs) => void addFiles(fs)}>
            {(props) => (
              <Anchor component="button" size="sm" {...props} data-testid="merge-add-files">
                {T.addFiles}
              </Anchor>
            )}
          </FileButton>
        </Group>
      </Group>

      <MergeSideContext.Provider value={sideCtx}>
      <div className="moyai-merge-body">
        <div className="moyai-merge-main">
          <Suspense fallback={null}>
            {current === "chart" && <StarTable embedded />}
            {current === "check" && <Review embedded />}
            {current === "match" && <MatchSheet ws={ws} />}
            {current === "readings" && <ReadingsSheet ws={ws} />}
            {current === "decisions" && plan && <DecisionsSheet client={client} plan={plan} />}
          </Suspense>
          {/* 資料のシートは、見ていないあいだも取り込みの状態を持つので、隠すだけにする */}
          <div style={{ display: current === "files" ? undefined : "none" }}>
            <Intake ws={ws} embedded file={fileParam} composeLabel={plan ? T.composeNext(nextVersion) : T.composeFirst} />
          </div>
        </div>
        {sideNow && (
          <aside className="moyai-merge-side" data-testid="merge-side">
            {/* 切り替え：決まっていない所（n が 0 なら出さない）・署名（確定した版があるとき）・出どころ（星取表のとき） */}
            <Group gap="sm" mb="md" wrap="nowrap">
              {sideOpen && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "open"} onClick={(e) => (e.preventDefault(), setSide("open"))} data-testid="side-open">
                  {T.side.open(openQuestions)}
                </a>
              )}
              {latestInfo && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "signatures"} onClick={(e) => (e.preventDefault(), setSide("signatures"))} data-testid="side-signatures">
                  {T.side.signatures(latestInfo.signatures.length)}
                </a>
              )}
              {sideSource && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "source"} onClick={(e) => (e.preventDefault(), setSide("source"))} data-testid="side-source">
                  {T.side.source}
                </a>
              )}
            </Group>
            {sideNow === "open" && an && (
              <>
                <Questions ws={ws} an={an} />
              </>
            )}
            {sideNow === "signatures" && latestInfo && <SignaturesPanel v={latestInfo} readings={ws.currentReadings()} />}
            {/* 出どころは星取表のシートがここへ描く。見ていないあいだも場所は残す */}
            {sideSource && <div ref={setSourceEl} style={{ display: sideNow === "source" ? undefined : "none" }} />}
          </aside>
        )}
      </div>
      </MergeSideContext.Provider>

      <Group justify="space-between" px={32} py="xs" wrap="nowrap" className="moyai-merge-bar">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {turn && (
            <Text size="xs" data-testid="merge-turn" data-state={turn.state}>
              {T.turnLine(turn.state, turn.state === "awaitingApproval" ? awaitingMe : turn.holder === me, turn.state === "awaitingApproval" ? (turn.to ?? "") : (turn.holder ?? turn.to ?? ""))}
            </Text>
          )}
        </Group>
        <Group gap="sm" wrap="nowrap" style={{ flex: "none" }}>
          {blocks.length > 0 && (
            <Text size="xs" c="dimmed" data-testid="confirm-disabled-reason">
              {T.blockPrefix}
              {blocks.join("・")}
            </Text>
          )}
          <Button variant="default" onClick={() => setHistoryOpen(true)} disabled={!plan || conn.kind !== "open"} data-testid="history-open">
            {T.history}
          </Button>
          {awaitingMe && st?.latest ? (
            <>
              <Button variant="default" onClick={() => setSignRole("return")} disabled={conn.kind !== "open"} data-testid="return-open">
                {T.returnBack}
              </Button>
              <Button onClick={() => setSignRole("approve")} disabled={conn.kind !== "open"} data-testid="approve-open">
                {T.approve}
              </Button>
            </>
          ) : (
            <Button onClick={() => setConfirmOpen(true)} disabled={blocks.length > 0} data-testid="confirm-open">
              {T.sign}
            </Button>
          )}
        </Group>
      </Group>

      {plan && (
        <>
          <ConfirmDialog client={client} plan={plan} opened={confirmOpen} onClose={closeAnd(() => setConfirmOpen(false))} onConfirmed={(p) => (nextPlan.current = p)} />
          <HistoryDialog client={client} planId={plan.planId} opened={historyOpen} onClose={closeAnd(() => setHistoryOpen(false))} onReverted={(p) => (nextPlan.current = p)} />
          {st?.latest && signRole && (
            <SignDialog
              client={client}
              planId={plan.planId}
              version={st.latest.version}
              role={signRole}
              hasKey={!!st.hasKey}
              opened={!!signRole}
              onClose={() => setSignRole(null)}
              onSigned={() => {
                setNotice(T.signed(signRole, st.latest!.version));
                reloadStatus();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
