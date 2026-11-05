// MERGE（版に重ねる。docs/screens.md 3.2・3.3、絵は Review.dc.html）：資料・Claude の案・人の答えを、次の版に重ねる段。
// 上は 2 行だけ（運営者の指示：データを広く）：見出しの 1 行（施設の名前・版・状態、右に施設の設定）と、シートのタブの 1 行。その下はすぐデータ。
// シートのタブ：星取表｜読み方｜検査｜決定 n｜資料｜＋ 資料を足す。前の画面（星取表・検査・取り込み）を、そのままシートとして入れる。
// 右の横の板は 1 枚で、切り替えは「決まっていない所 n（0 なら出さない）/ 署名 n / 出どころ（星取表のとき）」。印を選ぶと出どころへ。
// 下の帯は、止め札（決まっていない所・受けていない決定・橋渡しが切れている）とボタンだけ。画面の説明と「Claude に話す」の例は置かない（説明は Claude がする）。
// 画面のどこに資料を落としても受ける（引きずって入ったときだけ、全面に「第 n 版に重ねます」）。版の下書きが無いあいだは、資料のシートだけ（白紙。新しい施設）。
import { Button, FileButton, Group, Text } from "@mantine/core";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { ConfirmDialog, HistoryDialog, readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { ROUTES } from "../../shared/routes";
import { SignDialog } from "../components/SignDialog";
import { KeyWarnLine, untrustedSigners, type TrustSig } from "../components/KeyWarn";
import { RequestRenewDialog } from "../components/RequestRenewDialog";
import { SignaturesPanel, type PanelVersion } from "../components/SignaturesPanel";
import { DecisionsSheet, usePending } from "../components/DecisionsSheet";
import { ReadingsSheet, unapprovedReadings } from "../components/ReadingsSheet";
import { MatchSheet } from "../components/MatchSheet";
import { FictionMark } from "../components/FictionMark";
import type { IntakeWorkspace } from "../intake/workspace";
import { useConnection } from "../state/bridge";
import { useAccepted } from "../state/decisions";
import { MergeCompareContext, MergePeersContext, MergeSideContext, commentMarkKey, type CommentRow, type MergeCompare, type MergeSide } from "../state/merge-side";
import { CommentsPanel, commentNumber, type ListedComment } from "../components/CommentsPanel";
import { Switch } from "../components/Switch";
import { getWorkingPlan, setWorkingPlan, useWorkingPlan } from "../state/plan-store";
import { setCrosswalkBase } from "../state/crosswalk";
import type { Decision } from "../../import/questions";
import { STAGE_HASH, sheetHash, type MergeSheet } from "../stages";
import { HUMAN_TEXT, TEXT } from "../text";
import { FacilityDialog } from "../components/FacilityDialog";
import { setFacilityDialog } from "../state/facility-dialog";
import { Intake, Questions, useWorkspace } from "./Intake";

const T = TEXT.merge;
const SIDE_WIDTH = 340;
const SIDE_MIN = 280;
const SIDE_MAX = 560;
const SIDE_PREF = "moyai.mergeSide";
/** 横の板の開け閉めと幅（localStorage。読めなければ既定） */
function readSidePref(): { folded: boolean; width: number } {
  try {
    const v = JSON.parse(localStorage.getItem(SIDE_PREF) ?? "null") as { folded?: unknown; width?: unknown } | null;
    const w = typeof v?.width === "number" ? Math.min(SIDE_MAX, Math.max(SIDE_MIN, v.width)) : SIDE_WIDTH;
    return { folded: v?.folded === true, width: w };
  } catch {
    return { folded: false, width: SIDE_WIDTH };
  }
}
function writeSidePref(p: { folded: boolean; width: number }): void {
  try {
    localStorage.setItem(SIDE_PREF, JSON.stringify(p));
  } catch {
    /* 覚えられなくても動く */
  }
}
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
  const [side, setSide] = useState<"open" | "signatures" | "source" | "comments">("open");
  // 横の板の開け閉めと幅（この PC に 1 つだけ覚える。シートごとではない）
  const [sideFolded, setSideFolded] = useState<boolean>(() => readSidePref().folded);
  const [sideWidth, setSideWidth] = useState<number>(() => readSidePref().width);
  useEffect(() => writeSidePref({ folded: sideFolded, width: sideWidth }), [sideFolded, sideWidth]);
  // キー ］ で、たたむ・開く（字を打っている欄では効かせない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "]" || e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      setSideFolded((f) => !f);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const x0 = e.clientX;
    const w0 = sideWidth;
    const move = (m: MouseEvent) => setSideWidth(Math.min(SIDE_MAX, Math.max(SIDE_MIN, w0 + (x0 - m.clientX))));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  const [sourceEl, setSourceEl] = useState<HTMLElement | null>(null);
  // コメント：保管先から読み、星取表で選んだ行に付ける
  const [comments, setComments] = useState<ListedComment[]>([]);
  const [selectedRow, setSelectedRow] = useState<CommentRow | null>(null);
  const commentMarks = useMemo(() => {
    const m = new Map<string, string>();
    comments.forEach((c, i) => {
      if (!c.row) return;
      const k = commentMarkKey(c.row.mode, c.row.id);
      m.set(k, (m.get(k) ?? "") + commentNumber(i));
    });
    return m;
  }, [comments]);
  const sideCtx = useMemo<MergeSide>(() => ({ el: sourceEl, show: () => setSide("source"), select: setSelectedRow, commentMarks }), [sourceEl, commentMarks]);
  const [notice, setNotice] = useState<string | null>(null);
  // 開いた版に資料の記録が無い（その版と、そのときの資料の数。資料を足すと消す）
  const [noSources, setNoSources] = useState<{ version: number; files: number } | null>(null);
  // リンクを開いたとき、頼みをほかの鍵がもう受け取っていた・頼みが取り下げられていた（見るだけで開く。Wire の B1）
  // 合言葉がどの効いている頼みにも当たらない（その版を作った鍵でない頼みなど）ときも、見るだけで開く
  const [receive, setReceive] = useState<{ state: "takenByOther"; requester: string; receiver: { by: string; fingerprint: string } } | { state: "withdrawn" | "unknown" } | null>(null);
  const [renew, setRenew] = useState<{ version: number; to: string } | null>(null);
  // 似た施設を重ねるか（見出しの右。既定は外す）
  const [peersOn, setPeersOn] = useState(false);

  // 版を開くリンク（#/merge?open=<計画ID>&v=<版>&h=<中身のハッシュの頭>[&next=1]）：メール・トップの「＋ 次の版」・版の印のメニューから。
  // 保管先の版を読み、署名と鎖とハッシュを確かめてから置く。いちばん新しい版はそのまま、古い版は見るだけ（next=1 なら、その版の中身から次の版を作る）
  const open = new URLSearchParams(location.hash.split("?")[1] ?? "");
  const openId = open.get("open");
  const openV = Number(open.get("v"));
  const openNext = open.get("next") === "1";
  const openKey = openId ? `${openId}|${openV}|${open.get("h") ?? ""}|${openNext ? 1 : 0}` : null;
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const pendingOpen = !!openKey && doneKey !== openKey;
  // 版を開いて、その版の資料と決定を戻し終えるまでは作り直させない（前の版の資料なしで組み直して、明細を消さない）
  useEffect(() => {
    if (pendingOpen) ws.blockRestore(T.opening(openV));
    // 開き終える前にほかのシートへ移ったら、開くのはやめる（止め札だけを残さない）
    else ws.clearBlock(T.opening(openV));
  }, [pendingOpen]);
  // 古い版を見ているあいだは、その版の番号（見るだけ。確定はできない）
  const [oldView, setOldView] = useState<{ planId: string; version: number } | null>(null);
  const statusId = pendingOpen ? (openId ?? "") : (plan?.planId ?? "");
  const [status, reloadStatus] = usePlanStatus(client, statusId, !!statusId && conn.kind === "open");
  const st = status.kind === "ready" ? status.status : null;
  useEffect(() => {
    if (!pendingOpen || !st || !openKey || !openId) return;
    const fail = (k: string) => {
      ws.blockRestore(null);
      setNotice(T.openFailed(T.openWhat[k] ?? ""));
      setDoneKey(openKey);
    };
    const latest = st.latest;
    if (!latest || latest.plan.planId !== openId) return fail("missing");
    const info = st.versions?.find((x) => x.version === openV) as { contentHash?: string; problem?: string | null } | undefined;
    if (!info) return fail("version");
    if (!info.contentHash?.startsWith(open.get("h") ?? "\u0000")) return fail("hash");
    if (info.problem) return fail("broken");
    if (openV === latest.version) {
      setWorkingPlan(latest.plan, "intake");
      void restoreFrom(openId, latest).catch((e: unknown) => ws.blockRestore(T.sourcesFailed(latest.version, e instanceof Error ? e.message : String(e))));
      setOldView(null);
      setNotice(null);
      setDoneKey(openKey);
      // メールのリンクの使い捨ての合言葉：頼みと照らし、自分の鍵で受け取りに署名する（監査 B1）。ほかの鍵が受け取っていた・取り下げられていたら、見るだけ
      const token = open.get("t");
      if (token) {
        void (async () => {
          const r = readHuman<{ ok: boolean; reason?: string; state: string; requester?: string; receiver?: { by: string; fingerprint: string } }>(
            await client.callHuman("request_receive", ROUTES.requestReceive.path, { planId: openId, version: openV, token }),
          );
          if (r.ok && r.body.state === "takenByOther" && r.body.receiver) {
            setReceive({ state: "takenByOther", requester: r.body.requester ?? "", receiver: r.body.receiver });
            setOldView({ planId: openId, version: openV });
          } else if (r.ok && (r.body.state === "withdrawn" || r.body.state === "unknown")) {
            setReceive({ state: r.body.state });
            setOldView({ planId: openId, version: openV });
          } else setReceive(null);
          reloadStatus();
        })();
      } else setReceive(null);
      return;
    }
    void (async () => {
      const r = readHuman<{ ok: boolean; reason?: string; plan: Plan }>(await client.callHuman("plan_version_read", ROUTES.planVersionRead.path, { planId: openId, version: openV }));
      if (!r.ok) return fail("version");
      // この版から次の版：もとにした版は、保管先のいちばん新しい版（古い版の中身を、その上に重ねる）
      setWorkingPlan(r.body.plan, "intake", [], openNext ? latest.version : openV);
      setOldView(openNext ? null : { planId: openId, version: openV });
      // 古い版から次の版を作るときは、その版の資料をまだ戻さない（このタブの資料だけで組み直す）。計画 ID は固定する（台帳の新-9）
      ws.pinPlanId(openId);
      ws.blockRestore(null);
      setNotice(null);
      setDoneKey(openKey);
    })();
  }, [pendingOpen, st]);
  // 開いた版を組んだ資料と決定を画面に戻し、その版をもとにした版にする（1C・重-2）。資料が 1 つでも読めなければ戻さず、作り直しを止める
  const restoreFrom = async (planId: string, latest: NonNullable<NonNullable<typeof st>["latest"]>) => {
    setCrosswalkBase({ version: latest.version, plan: latest.plan, crosswalk: latest.crosswalk ?? [] });
    ws.pinPlanId(planId);
    ws.blockRestore(T.opening(latest.version));
    setNoSources(null);
    if (!latest.sources) {
      ws.blockRestore(null);
      // ふつうの字の 1 行。資料を足すと消える（Wire）
      return setNoSources({ version: latest.version, files: ws.fileCount });
    }
    const files: { name: string; bytes: Uint8Array }[] = [];
    for (const s of latest.sources) {
      const r = readHuman<{ ok: boolean; name: string; base64: string }>(await client.callHuman("plan_source_read", ROUTES.planSourceRead.path, { planId, version: latest.version, sha256: s.sha256 }));
      if (!r.ok) return ws.blockRestore(T.sourcesFailed(latest.version, r.message));
      files.push({ name: r.body.name, bytes: Uint8Array.from(atob(r.body.base64), (c) => c.charCodeAt(0)) });
    }
    await ws.restoreVersion(
      latest.version,
      files,
      (latest.decisions ?? []).map((d) => ({ questionId: d.questionId, answer: d.answer, author: d.author as Decision["author"], reason: d.reason })),
    );
  };
  // 確定したら、その版をもとにした版に置き直し、計画 ID を固定する（同じタブで次の版を作ると「第 n+1 版と同じ」になる。台帳の新-9）
  const onConfirmed = (p: Plan) => {
    nextPlan.current = p;
    const crosswalk = (getWorkingPlan()?.proposals ?? []).filter((x) => x.state === "accepted").map((x) => ({ rule: x.rule, basis: x.basis }));
    setCrosswalkBase({ version: p.version, plan: p, crosswalk });
    ws.pinPlanId(p.planId);
  };
  const loadComments = async (planId: string) => {
    const r = readHuman<{ ok: boolean; reason?: string; comments: ListedComment[] }>(await client.callHuman("comments_list", ROUTES.commentsList.path, { planId }));
    setComments(r.ok ? r.body.comments : []);
  };
  useEffect(() => {
    if (!plan || conn.kind !== "open") return setComments([]);
    void loadComments(plan.planId);
  }, [plan?.planId, conn.kind]);
  // タブに戻ったときに、保管先の版を読み直す（ほかの人が足した版に気づくため）
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      reloadStatus();
      if (plan) void loadComments(plan.planId);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reloadStatus]);
  // 作業中の計画がほかの計画に替われば、古い版を見ている印を外す
  const viewingOld = oldView && plan && plan.planId === oldView.planId && plan.version === oldView.version ? oldView.version : null;
  const turn = st?.turn ?? null;
  const me = st?.name ?? null;
  // 承認を頼まれた人（頼みを受け取った鍵の人）には、承認と差し戻しを出す（監査 B1）
  const req = st?.request ?? null;
  const awaitingMe = !!req && req.kind === "approve" && req.receivedByMe && !req.done && req.version === st?.latest?.version;
  // 頼んだ人（まだ済んでいない頼み）：受け取った人を下の帯に出し、頼み直せる
  const askedByMe = !!req && req.mine && !req.done && req.version === st?.latest?.version;
  // 承認を頼んだあいだは、頼んだ版を見る。自分では確定しない（頼みと食い違うため。Wire の B1）
  const askedApprove = askedByMe && req?.kind === "approve";
  // 見るだけで開いたとき（古い版・ほかの鍵が受け取った頼み・取り下げられた頼み）は、主ボタンも押せない理由も出さない（Wire の B1）
  const viewOnly = viewingOld !== null;

  // 版の下書きが無いあいだは白紙（資料のシートだけ）。開発と試験の見本（?plan=）は、星取表のシートが読んで作業中の計画に置く
  const devSample = new URLSearchParams(location.search).has("plan");
  const current: MergeSheet = !plan ? (devSample && (sheet ?? "chart") === "chart" ? "chart" : "files") : (sheet ?? "chart");
  // 見出しの版：承認を頼まれた人には、頼まれた版（いちばん新しい版）を、ほかは次につくる版を出す
  const latestNo = st?.latest && plan && st.latest.plan.planId === plan.planId ? st.latest.version : null;
  // 2 人が同時に書こうとしたとき（docs/screens.md 4 の 6）：この編集がもとにした版より新しい版が保管先にあれば、知らせて署名を止める
  const base = working?.base ?? null;
  const staleBy = !viewingOld && latestNo !== null && (base === null || latestNo > base) ? (st?.versions?.at(-1) ?? null) : null;
  // つくる版は、もとにした版の次（ほかの人が足した版があっても、この編集がつくるつもりの版を出す。署名は止まる）
  const nextVersion = viewingOld ?? ((awaitingMe || askedApprove) && latestNo !== null ? latestNo : (base ?? latestNo ?? plan?.version ?? 0) + 1);
  const an = ws.fileCount ? ws.analysis() : null;
  const openQuestions = an ? an.open.length : 0;
  const leftDecisions = pending.filter((d) => !accepted.has(`${d.id}\u0000${d.hash}`)).length;
  // 白紙のあいだに「第 1 版をつくる」を止めている理由（取り込みと同じもの）
  const composeBlocks = !plan ? ws.composeBlockers() : [];
  const blocks = [
    !plan ? T.block.noPlan : null,
    staleBy ? T.block.stale : null,
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
  // 承認を頼まれた人に知らせる、頼まれた版を作った鍵のうち、まだ確かめていないもの（KeyWarn.dc.html の 1）
  const latestUntrusted = latestInfo ? untrustedSigners([latestInfo as { signatures: TrustSig[] }]) : [];
  // 効かない頼み（Wire の B1 の追い）：鎖の行は開いた全員に。別の鍵の頼みがあれば、署名の切り替えに朱の「!」、
  // 版を作った人（この PC の鍵で作った版）には下の帯にも 1 行
  const ignored = st?.requestsIgnored ?? [];
  const ignoredOther = ignored.some((q) => q.why === "otherKey");
  const madeByMe = !!latestInfo?.signatures.some((x) => (x.role === "confirm" || x.role === "edit" || x.role === "revert") && x.trust === "own");
  // 詳しく：どのシートでも、本体で選んだ行・印・セルの全文と根拠を出す所（前の「出どころ」。Wire、2026-11-05）
  const sideSource = !!plan;
  const sideComments = !!plan;
  const can = { open: sideOpen, signatures: !!latestInfo, source: sideSource, comments: sideComments };
  const sideNow: "open" | "signatures" | "source" | "comments" | null = can[side] ? side : sideOpen ? "open" : latestInfo ? "signatures" : sideSource ? "source" : sideComments ? "comments" : null;
  // 見出しの状態と下の帯の左は、いま開いている版（つくっている版）のこと（Wire、2026-11-04）：
  // 編集の番が人に渡っている（編集を頼んだ・承認待ち・差し戻し）ならその番。番が空いている（確定・承認のあと）なら、次の版を編集中。
  // 「確定済み」は、古い版を見るだけで開いたときだけ
  const turnHeld = !!turn && (turn.state === "editing" || turn.state === "awaitingApproval" || turn.state === "returned");
  const stateLabel = viewingOld ? (receive ? T.viewOnlyLabel : T.oldVersionLabel) : turnHeld && turn ? TEXT.top.state[turn.state] : plan ? TEXT.top.state.editing : null;
  const turnLine: { state: string; text: string } | null = viewingOld
    ? { state: "confirmed", text: T.confirmedLine }
    : turnHeld && turn
      ? {
          state: turn.state,
          text: T.turnLine(turn.state, turn.state === "awaitingApproval" ? awaitingMe : turn.holder === me, turn.state === "awaitingApproval" ? (turn.to ?? "") : (turn.holder ?? turn.to ?? "")),
        }
      : plan
        ? { state: "editing", text: T.turnLine("editing", true, "") }
        : null;
  // 比べる版：承認を頼まれた人も頼んだ人も、頼んだ版のひとつ前（無ければ出さない）。ほかは保管先のいちばん新しい版（同じ計画のときだけ）
  const compareWith = viewingOld ? null : awaitingMe || askedApprove ? (st?.previous ?? null) : (st?.latest ?? null);
  const compare = useMemo<MergeCompare | null>(
    () => (plan && compareWith && compareWith.plan.planId === plan.planId ? { version: compareWith.version, plan: compareWith.plan } : null),
    [plan, compareWith],
  );
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
        {stateLabel && (
          <span className="moyai-merge-state" data-view-only={viewOnly ? "true" : "false"} data-testid="merge-state">
            {stateLabel}
          </span>
        )}
        {fictional && <FictionMark />}
        <div className="moyai-merge-head-end">
          {current === "chart" && plan && (
            <Group gap={8} wrap="nowrap" align="center">
              <span className="moyai-merge-head-label">{T.peersLabel}</span>
              <Switch<"on" | "off">
                aria-label={T.peersLabel}
                value={peersOn ? "on" : "off"}
                onChange={(v) => setPeersOn(v === "on")}
                data-testid="merge-peers"
                data={[
                  { value: "on", label: T.peersOn },
                  { value: "off", label: T.peersOff },
                ]}
              />
            </Group>
          )}
          {compare && (
            <span data-testid="merge-compare" data-version={compare.version}>
              <span className="moyai-merge-head-label">{T.compareLabel}　</span>
              {T.version(compare.version)}
            </span>
          )}
          {plan ? (
            <button type="button" className="moyai-merge-link" onClick={() => setFacilityDialog(true)} data-testid="facility-settings">
              {T.facilitySettings}
            </button>
          ) : (
            <a href={sheetHash("files")} className="moyai-merge-link" data-testid="facility-settings">
              {T.facilitySettings}
            </a>
          )}
        </div>
      </div>
      {notice && (
        <Text size="sm" c="var(--shu-text)" px={32} data-testid="merge-notice">
          {notice}
        </Text>
      )}
      {noSources && ws.fileCount <= noSources.files && (
        <Text size="sm" px={32} data-testid="merge-no-sources">
          {T.noSources(noSources.version)}
        </Text>
      )}
      {staleBy && plan && (
        <Text size="sm" c="var(--shu-text)" px={32} data-testid="merge-stale">
          {T.stale(staleBy.version, (staleBy as { signatures?: { by: string }[] }).signatures?.[0]?.by ?? "")}{" "}
          <a className="moyai-merge-link" href={`${STAGE_HASH.merge}?open=${encodeURIComponent(plan.planId)}&v=${staleBy.version}&h=${((staleBy as { contentHash?: string }).contentHash ?? "").slice(0, 16)}`} data-testid="merge-reopen">
            {T.reopen}
          </a>
        </Text>
      )}

      <Group justify="space-between" px={32} pt={4} wrap="nowrap" className="moyai-sheet-tabs">
        <Group gap={0} wrap="nowrap" role="tablist">
          {tabs.map((s) => (
            <a key={s} role="tab" className="moyai-sheet-tab" href={sheetHash(s)} aria-selected={current === s} data-testid={`sheet-${s}`}>
              {T.sheets[s]}
              {s === "readings" && unapproved > 0 && <span className="moyai-sheet-n moyai-num">{unapproved}</span>}
              {s === "decisions" && leftDecisions > 0 && <span className="moyai-sheet-n moyai-num">{leftDecisions}</span>}
            </a>
          ))}
          {plan && fileNames.length > 0 && (
            <>
              <span className="moyai-sheet-label">{T.filesLabel}</span>
              {fileNames.map((f) => (
                <a key={f} role="tab" className="moyai-sheet-tab" href={`${sheetHash("files")}?f=${encodeURIComponent(f)}`} aria-selected={current === "files" && fileParam === f} data-testid="sheet-file" data-file={f}>
                  {f}
                </a>
              ))}
            </>
          )}
          <FileButton multiple onChange={(fs) => void addFiles(fs)}>
            {(props) => (
              <button type="button" className="moyai-sheet-tab" {...props} data-testid="merge-add-files">
                {T.addFiles}
              </button>
            )}
          </FileButton>
        </Group>
      </Group>

      <MergePeersContext.Provider value={peersOn}>
      <MergeCompareContext.Provider value={compare}>
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
            <Intake ws={ws} embedded file={fileParam} composeLabel={plan ? T.composeNext(nextVersion) : T.composeFirst} composeInBar={!plan} />
          </div>
        </div>
        {sideNow && sideFolded && (
          <aside className="moyai-merge-side-band" data-testid="merge-side-band">
            <button type="button" className="moyai-side-band-open" onClick={() => setSideFolded(false)} aria-label={T.side.unfold} data-testid="side-unfold">
              ‹
            </button>
            {(
              [
                ["open", sideOpen, T.side.open(openQuestions), true],
                ["source", sideSource, T.side.source, false],
                ["signatures", !!latestInfo, T.side.signatures(latestInfo?.signatures.length ?? 0), false],
                ["comments", sideComments, T.side.comments(comments.length), false],
              ] as const
            )
              .filter(([, on]) => on)
              .map(([k, , label, shu]) => (
                <button
                  type="button"
                  key={k}
                  className="moyai-side-band-item"
                  data-shu={shu ? "true" : undefined}
                  onClick={() => {
                    setSide(k);
                    setSideFolded(false);
                  }}
                  data-testid={`side-band-${k}`}
                >
                  {label}
                </button>
              ))}
          </aside>
        )}
        {sideNow && !sideFolded && (
          <div
            className="moyai-side-resize"
            role="separator"
            aria-orientation="vertical"
            onMouseDown={startResize}
            onDoubleClick={() => setSideWidth(SIDE_WIDTH)}
            data-testid="side-resize"
          />
        )}
        {sideNow && !sideFolded && (
          <aside className="moyai-merge-side" style={{ width: sideWidth }} data-testid="merge-side">
            <button type="button" className="moyai-side-fold" onClick={() => setSideFolded(true)} aria-label={T.side.fold} data-testid="side-fold">
              ›
            </button>
            {/* 切り替え：決まっていない所（n が 0 なら出さない）・署名（確定した版があるとき）・出どころ（星取表のとき） */}
            <Group gap={0} mb="md" wrap="nowrap">
              {sideOpen && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "open"} onClick={(e) => (e.preventDefault(), setSide("open"))} data-testid="side-open">
                  {T.side.open(openQuestions)}
                </a>
              )}
              {sideSource && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "source"} onClick={(e) => (e.preventDefault(), setSide("source"))} data-testid="side-source">
                  {T.side.source}
                </a>
              )}
              {latestInfo && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "signatures"} onClick={(e) => (e.preventDefault(), setSide("signatures"))} data-testid="side-signatures">
                  {T.side.signatures(latestInfo.signatures.length)}
                  {ignoredOther && (
                    <span className="moyai-sheet-n" data-testid="side-signatures-ignored">
                      !
                    </span>
                  )}
                </a>
              )}
              {sideComments && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "comments"} onClick={(e) => (e.preventDefault(), setSide("comments"))} data-testid="side-comments">
                  {T.side.comments(comments.length)}
                </a>
              )}
            </Group>
            {sideNow === "open" && an && (
              <>
                <Questions ws={ws} an={an} />
              </>
            )}
            {sideNow === "signatures" && latestInfo && <SignaturesPanel v={latestInfo} readings={ws.currentReadings()} onKeyConfirmed={reloadStatus} request={req && !req.done && req.version === latestInfo.version ? req : null} ignored={ignored} />}
            {sideNow === "comments" && plan && (
              <CommentsPanel
                client={client}
                planId={plan.planId}
                version={nextVersion}
                comments={comments}
                row={selectedRow}
                onAdded={() => void loadComments(plan.planId)}
              />
            )}
            {/* 詳しくは、星取表・検査のシートがここへ描く。見ていないあいだも場所は残す。何も選んでいなければ 1 行 */}
            {sideSource && (
              <div style={{ display: sideNow === "source" ? undefined : "none" }}>
                <div ref={setSourceEl} className="moyai-side-detail" />
                <Text size="sm" c="dimmed" className="moyai-side-detail-empty" data-testid="side-detail-empty">
                  {T.side.detailEmpty}
                </Text>
              </div>
            )}
          </aside>
        )}
      </div>
      </MergeSideContext.Provider>
      </MergeCompareContext.Provider>
      </MergePeersContext.Provider>

      <Group justify="space-between" px={32} py="xs" wrap="nowrap" className="moyai-merge-bar">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          {receive ? (
            <Text size="xs" data-testid="request-other" data-state={receive.state}>
              {receive.state === "takenByOther" ? `${HUMAN_TEXT.request.takenByOther}　${receive.receiver.by}　${receive.receiver.fingerprint}` : HUMAN_TEXT.request[receive.state]}
              {receive.state === "takenByOther" && (
                <a
                  className="moyai-inline-act"
                  href={`mailto:?subject=${encodeURIComponent(HUMAN_TEXT.request.notifySubject(st?.latest?.version ?? 0))}&body=${encodeURIComponent(HUMAN_TEXT.request.notifyBody(st?.latest?.version ?? 0, receive.receiver.by, receive.receiver.fingerprint))}`}
                  data-testid="request-notify"
                >
                  {HUMAN_TEXT.request.notify(receive.requester)}
                </a>
              )}
            </Text>
          ) : askedByMe && req ? (
            <Text size="xs" style={{ whiteSpace: "nowrap" }} data-testid="request-asked" data-received={req.received ? "true" : "false"}>
              {HUMAN_TEXT.request.asked[req.kind]}　{req.received ? `${HUMAN_TEXT.request.receivedBy}　${req.received.by}　${req.received.fingerprint}` : `${req.to}　${HUMAN_TEXT.request.notOpened}`}
            </Text>
          ) : (
            turnLine && (
              <Text size="xs" data-testid="merge-turn" data-state={turnLine.state}>
                {turnLine.text}
              </Text>
            )
          )}
          {askedByMe && req?.received && (req.received.trust === "unconfirmed" || req.received.trust === "changed") && (
            <KeyWarnLine
              signers={[{ role: "confirm", by: req.received.by, pub: req.received.pub, fingerprint: req.received.fingerprint, trust: req.received.trust, previous: req.received.previous }]}
              onConfirmed={reloadStatus}
              named={false}
            />
          )}
          {awaitingMe && st?.latest && <KeyWarnLine signers={latestUntrusted} onConfirmed={reloadStatus} onShow={() => setSide("signatures")} />}
          {madeByMe && ignoredOther && !viewOnly && (
            <Text size="xs" c="var(--shu-text)" style={{ whiteSpace: "nowrap" }} data-testid="request-ignored">
              {HUMAN_TEXT.request.ignoredBar}
              <button type="button" className="moyai-inline-act" onClick={() => setSide("signatures")} data-testid="request-ignored-show">
                {HUMAN_TEXT.request.ignoredShow}
              </button>
            </Text>
          )}
        </Group>
        {/* 白紙のあいだ（版の下書きが無い）：主ボタンは「第 1 版をつくる」の 1 つだけ（MergeNew.dc.html） */}
        {!plan ? (
          <Group gap="sm" wrap="nowrap" style={{ flex: "none" }}>
            {composeBlocks.length > 0 && ws.compose.state !== "running" && (
              <Text size="xs" c="dimmed" maw={560} lineClamp={2} title={composeBlocks.join("・")} data-testid="compose-disabled-reason">
                {TEXT.intake.reasonsPrefix}
                {composeBlocks.join("・")}
              </Text>
            )}
            <Button
              onClick={() => ws.startCompose("human")}
              disabled={composeBlocks.length > 0 || ws.compose.state === "running"}
              loading={ws.compose.state === "running"}
              data-testid="compose"
            >
              {T.composeFirst}
            </Button>
          </Group>
        ) : (
        <Group gap="sm" wrap="nowrap" style={{ flex: "none" }}>
          {!viewOnly && blocks.length > 0 && (
            <Text size="xs" c="dimmed" data-testid="confirm-disabled-reason">
              {T.blockPrefix}
              {blocks.join("・")}
            </Text>
          )}
          {askedByMe && req && !viewOnly && (
            <Button variant="default" onClick={() => setRenew({ version: req.version, to: req.to })} disabled={conn.kind !== "open"} data-testid="request-renew">
              {HUMAN_TEXT.request.renew}
            </Button>
          )}
          <Button variant="default" onClick={() => setHistoryOpen(true)} disabled={!plan || conn.kind !== "open"} data-testid="history-open">
            {T.history}
          </Button>
          {viewOnly || askedApprove ? null : awaitingMe && st?.latest ? (
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
        )}
      </Group>

      {plan && (
        <>
          <FacilityDialog plan={plan} readOnly={viewingOld !== null || awaitingMe} />
          <ConfirmDialog client={client} plan={plan} opened={confirmOpen} onClose={closeAnd(() => setConfirmOpen(false))} onConfirmed={onConfirmed} sources={() => ws.sourcesForCommit()} intake={() => ws.intakeStats()} />
          <HistoryDialog client={client} planId={plan.planId} opened={historyOpen} onClose={closeAnd(() => setHistoryOpen(false))} onReverted={(p) => (nextPlan.current = p)} />
          {/* 頼み直す相手は開いたときに覚える（読み直しの間に状態が消えても、出したメールの文を消さない） */}
          <RequestRenewDialog client={client} planId={plan.planId} version={renew?.version ?? 0} to={renew?.to ?? ""} opened={!!renew} onClose={() => setRenew(null)} onRenewed={reloadStatus} />
          {st?.latest && signRole && (
            <SignDialog
              client={client}
              planId={plan.planId}
              version={st.latest.version}
              role={signRole}
              hasKey={!!st.hasKey}
              untrusted={signRole === "approve" ? latestUntrusted : []}
              onKeyConfirmed={reloadStatus}
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
