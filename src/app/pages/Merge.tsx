// MERGE（版に重ねる。docs/screens.md 3.2・3.3）：資料・Claude の案・人の答えを、次の版に重ねる段。
// シートのタブ：星取表｜検査｜決定 n｜資料｜＋ 資料を足す。前の画面（星取表・検査・取り込み）を、そのままシートとして入れる。
// 右の横の板は「決まっていない所 n」（取り込みの質問。n が 0 なら出さない）。署名とコメントの切り替えは P1・P2 で足す。
// 下の帯：左に止め札（決まっていない所・受けていない決定・橋渡しが切れている）、右に主ボタン「署名して確定する…」（署名のダイアログ）。
// 画面のどこに資料を落としても受ける。版の下書きが無いあいだは、資料のシートだけ（白紙。新しい施設）。
import { Anchor, Button, FileButton, Group, Stack, Text, Title } from "@mantine/core";
import { Suspense, lazy, useRef, useState, type DragEvent } from "react";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { ConfirmDialog, HistoryDialog } from "../components/ConfirmDialog";
import { DecisionsSheet, usePending } from "../components/DecisionsSheet";
import { FictionMark } from "../components/FictionMark";
import type { IntakeWorkspace } from "../intake/workspace";
import { useConnection } from "../state/bridge";
import { useAccepted } from "../state/decisions";
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

  // 版の下書きが無いあいだは白紙（資料のシートだけ）。開発と試験の見本（?plan=）は、星取表のシートが読んで作業中の計画に置く
  const devSample = new URLSearchParams(location.search).has("plan");
  const current: MergeSheet = !plan ? (devSample && (sheet ?? "chart") === "chart" ? "chart" : "files") : (sheet ?? "chart");
  const nextVersion = (plan?.version ?? 0) + 1;
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
  };
  const tabs: MergeSheet[] = plan ? ["chart", "check", "decisions", "files"] : ["files"];

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
      <Stack gap={4} px="md" pt="sm">
        <Group gap="sm" wrap="nowrap" align="baseline">
          <Title order={2} style={{ whiteSpace: "nowrap" }} data-testid="plan-name">
            {name}
          </Title>
          <Text fw={700} className="moyai-num" data-testid="merge-version">
            {T.version(nextVersion)}
          </Text>
          {fictional && <FictionMark />}
          <Anchor href={sheetHash("files")} size="sm" data-testid="facility-settings">
            {T.facilitySettings}
          </Anchor>
        </Group>
        <Text size="sm" c="dimmed">
          {plan ? T.lead(nextVersion) : T.leadNew}
        </Text>
      </Stack>

      <Group justify="space-between" px="md" pt="xs" wrap="nowrap" className="moyai-sheet-tabs">
        <Group gap="lg" wrap="nowrap" role="tablist">
          {tabs.map((s) => (
            <a key={s} role="tab" className="moyai-sheet-tab" href={sheetHash(s)} aria-selected={current === s} data-testid={`sheet-${s}`}>
              {T.sheets[s]}
              {s === "decisions" && leftDecisions > 0 && (
                <Text span c="var(--shu)" className="moyai-num" ml={6}>
                  {leftDecisions}
                </Text>
              )}
            </a>
          ))}
          <FileButton multiple onChange={(fs) => void addFiles(fs)}>
            {(props) => (
              <Anchor component="button" size="sm" {...props} data-testid="merge-add-files">
                {T.addFiles}
              </Anchor>
            )}
          </FileButton>
        </Group>
        <Text size="xs" c="dimmed">
          {T.dropAnywhere(nextVersion)}
        </Text>
      </Group>

      <div className="moyai-merge-body">
        <div className="moyai-merge-main">
          <Suspense fallback={null}>
            {current === "chart" && <StarTable embedded />}
            {current === "check" && <Review embedded />}
            {current === "decisions" && plan && <DecisionsSheet client={client} plan={plan} />}
          </Suspense>
          {/* 資料のシートは、見ていないあいだも取り込みの状態を持つので、隠すだけにする */}
          <div style={{ display: current === "files" ? undefined : "none" }}>
            <Intake ws={ws} embedded composeLabel={plan ? T.composeNext(nextVersion) : T.composeFirst} />
          </div>
        </div>
        {an && openQuestions > 0 && (
          <aside className="moyai-merge-side" data-testid="merge-side">
            <Text fw={700} mb="xs">
              {T.side.open(openQuestions)}
            </Text>
            <Questions ws={ws} an={an} />
            <Text size="xs" c="dimmed" mt="xs">
              {T.sideNote}
            </Text>
          </aside>
        )}
      </div>

      <Group justify="space-between" px="md" py="xs" wrap="nowrap" className="moyai-merge-bar">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="xs" c="dimmed">
            {T.talk}
          </Text>
          <Text size="xs" truncate>
            {T.talkExample}
          </Text>
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
          <Button onClick={() => setConfirmOpen(true)} disabled={blocks.length > 0} data-testid="confirm-open">
            {T.sign}
          </Button>
        </Group>
      </Group>

      {plan && (
        <>
          <ConfirmDialog client={client} plan={plan} opened={confirmOpen} onClose={closeAnd(() => setConfirmOpen(false))} onConfirmed={(p) => (nextPlan.current = p)} />
          <HistoryDialog client={client} planId={plan.planId} opened={historyOpen} onClose={closeAnd(() => setHistoryOpen(false))} onReverted={(p) => (nextPlan.current = p)} />
        </>
      )}
    </div>
  );
}
