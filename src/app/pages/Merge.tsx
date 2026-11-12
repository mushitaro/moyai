// MERGE（版に重ねる。docs/screens.md 3.2・3.3、絵は Review.dc.html）：資料・Claude の案・人の答えを、次の版に重ねる段。
// 上は 2 行だけ（運営者の指示：データを広く）：見出しの 1 行（施設の名前・版・状態、右に施設の設定）と、シートのタブの 1 行。その下はすぐデータ。
// シートのタブ：星取表｜読み方｜検査｜決定 n｜「資料」の札・資料の選び・シートの選び｜＋ 資料を足す。白紙（第 1 版の前）は「資料」の札・資料の選び・シートの選び｜＋ 資料を足す。
// 資料ごとのタブは並べない（200 ファイル・1 ファイル 12 シートを前提に。docs/screens.md 3.2「資料の選び」、Wire、11-07）。
// 右の横の板は 1 枚で、切り替えは「決まっていない所 n（0 なら出さない）/ 署名 n / 出どころ（星取表のとき）」。印を選ぶと出どころへ。
// 古い版を見るだけで開いたときの「署名 n」は、その版の署名と適用 Skill（いちばん新しい版のものは出さない）。ルールのシートは、その版で当てていたルール（Wire、11-07 夜）。
// 下の帯は、止め札（決まっていない所・受けていない決定・橋渡しが切れている）とボタンだけ。画面の説明と「Claude に話す」の例は置かない（説明は Claude がする）。
// 画面のどこに資料を落としても受ける（引きずって入ったときだけ、全面に「第 n 版に重ねます」）。版の下書きが無いあいだは、資料のシートだけ（白紙。新しい施設）。
import { setRemovedInHistory } from "../state/stars";
import { Button, FileButton, Group, Text } from "@mantine/core";
import { Suspense, lazy, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { ConfirmDialog, HistoryDialog, readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { ROUTES } from "../../shared/routes";
import { SignDialog, signResultLine } from "../components/SignDialog";
import { KeyWarnLine, untrustedSigners, type TrustSig } from "../components/KeyWarn";
import { RequestRenewDialog } from "../components/RequestRenewDialog";
import { SignaturesPanel, type PanelVersion } from "../components/SignaturesPanel";
import { DecisionsSheet, cycleConflicts, usePending } from "../components/DecisionsSheet";
import { CostSheet } from "../components/CostSheet";
import { ReadingsSheet, ruleHash, unapprovedReadings, type OldReadings } from "../components/ReadingsSheet";
import { ReadingOutButton, useReadingOut } from "../components/ReadingOut";
import { placeOf, ruleVersionNo, signaturesVersion, type Lineage, type RecordedReading } from "../state/rule-lineage";
import { catalogFor, packChoices } from "../chart/catalog";
import { versionName } from "../version-name";
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
import { CONFIRMED_SHEETS, STAGE_HASH, sheetHash, type MergeSheet } from "../stages";
import { HUMAN_TEXT, TEXT } from "../text";
import { InlineName } from "../components/InlineName";
import { FacilityDialog } from "../components/FacilityDialog";
import { setFacilityDialog } from "../state/facility-dialog";
import { Intake, IntakeFacilityDialog, Questions, StopNoticeDetail, StopNotices, composeReasons, stopNotices, useSheets, useWorkspace, type StopKind } from "./Intake";
import { RejectedDetail, SheetPicker, SourcePicker, defaultSource, sourceRows, type SheetRow, type SourceOrder, type SourceRow } from "../components/SourcePicker";

const T = TEXT.merge;
/** 横の板の幅：320px に固定し、本体は残りの幅（docs/screens.md 3.2「資料の選び」の幅、Wire、11-07） */
export const SIDE_WIDTH = 320;
// 前の鍵（moyai.mergeSide）は、開いたままの folded: false を人が選ばなくても書いていたので読まない（既定をたたむに替えた。Wire、11-06）
const SIDE_PREF = "moyai.mergeSide.2";
/**
 * 横の板の開け閉め（localStorage。読めなければ既定）。開け閉めは人が開け閉めしたときだけ覚える（folded が無ければ人はまだ選んでいない）。
 * 既定はたたむ（Wire、11-06。本体の年度の欄を広くとるため）。幅は固定なので覚えない（前に覚えた幅は読まない）
 */
function readSidePref(): { folded: boolean | null } {
  try {
    const v = JSON.parse(localStorage.getItem(SIDE_PREF) ?? "null") as { folded?: unknown } | null;
    return { folded: typeof v?.folded === "boolean" ? v.folded : null };
  } catch {
    return { folded: null };
  }
}
function writeSidePref(p: { folded: boolean | null }): void {
  try {
    localStorage.setItem(SIDE_PREF, JSON.stringify(p));
  } catch {
    /* 覚えられなくても動く */
  }
}
// 星取表と検査は AG Grid や検査の関数を含むので、開いたときに読む
const StarTable = lazy(() => import("./StarTable").then((m) => ({ default: m.StarTable })));
const Review = lazy(() => import("./Review").then((m) => ({ default: m.Review })));
// 出力と共有のシート（確定した版を Excel で落とす・共有フォルダと公開台帳に送る。開いたときに読む）
const Export = lazy(() => import("./Export").then((m) => ({ default: m.Export })));
const Checkpoint = lazy(() => import("./Checkpoint").then((m) => ({ default: m.Checkpoint })));

/**
 * 読込の途中だけ、選びの右に text-3 の「読込 120 / 200」（済んだら消す。docs/screens.md 3.2「資料の選び」）。
 * 作業場は進みを知らせるだけで版を進めないので、この字だけが読み、画面の全体は描き直さない
 */
function SourceReading({ ws }: { ws: IntakeWorkspace }) {
  const p = useSyncExternalStore(
    (cb) => ws.subscribe(cb),
    () => ws.readProgress,
    () => ws.readProgress,
  );
  if (!p) return null;
  return (
    <span className="moyai-srcpick-reading moyai-num" data-testid="source-reading" data-done={p.done} data-total={p.total}>
      {T.picker.reading(p.done, p.total)}
    </span>
  );
}

export function Merge({ ws, client, sheet }: { ws: IntakeWorkspace; client: BridgeClient; sheet: MergeSheet | null }) {
  useWorkspace(ws);
  const working = useWorkingPlan();
  const plan = working?.plan ?? null;
  const { state: conn } = useConnection();
  const accepted = useAccepted();
  const { pending, openRules, openRemovals, ready: pendingReady, problem: pendingProblem } = usePending(client, plan);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [over, setOver] = useState(false);
  const nextPlan = useRef<Plan | null>(null);
  const [signRole, setSignRole] = useState<"approve" | "return" | null>(null);
  const [side, setSide] = useState<"open" | "signatures" | "source" | "comments">("open");
  // 横の板の開け閉め（この PC に 1 つだけ覚える。シートごとではない）。既定はたたむ。幅は 320px に固定（Wire、11-07）。
  // 本体の行・印・セルを選ぶ・開いた版に未回答があるときは開くが、それは覚えない（覚えるのは人が開け閉めしたときだけ。Wire、11-06）
  const [sideFoldPref, setSideFoldPref] = useState<boolean | null>(() => readSidePref().folded);
  const [sideFolded, setSideFolded] = useState<boolean>(() => readSidePref().folded ?? true);
  useEffect(() => writeSidePref({ folded: sideFoldPref }), [sideFoldPref]);
  /** 「| 見る」などで、その切り替えで板を開く（たたんでいたら開く。覚えない） */
  const showSide = (k: "open" | "signatures" | "source" | "comments") => {
    setSide(k);
    setSideFolded(false);
  };
  /** 人が開け閉めした（覚える） */
  const foldSide = (folded: boolean) => {
    setSideFolded(folded);
    setSideFoldPref(folded);
  };
  // キー ］ で、たたむ・開く（字を打っている欄では効かせない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key !== "]" || e.ctrlKey || e.metaKey || e.altKey || (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))) return;
      setSideFolded((f) => {
        setSideFoldPref(!f);
        return !f;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [sourceEl, setSourceEl] = useState<HTMLElement | null>(null);
  // 下の帯の止まった知らせを押したとき、詳細にその記録を出す（本体の行・星取・セルを選ぶと、そちらに戻る）
  const [stop, setStop] = useState<StopKind | null>(null);
  // 資料の一覧で選んだ読込不可の行：詳細にその理由を出す（本体の行・星取・セルを選ぶと、そちらに戻る）
  const [rejectedShown, setRejectedShown] = useState<SourceRow | null>(null);
  // 資料のセルの詳細の「| 決める」で開いた質問（seq は押すたびに増やし、同じ質問でも見える所へ送り直す）
  const [focusQuestion, setFocusQuestion] = useState<{ questionId: string; seq: number } | null>(null);
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
  // 本体で選ぶと、板を詳しくで開く（たたんでいたら開く。覚えない）
  const sideCtx = useMemo<MergeSide>(
    () => ({
      el: sourceEl,
      show: () => {
        setStop(null);
        setRejectedShown(null);
        setFocusQuestion(null);
        setSide("source");
        setSideFolded(false);
      },
      // 未確定のセルの詳細の「| 決める」：板を「未回答」で開き、その質問へ（たたんでいたら開く。覚えない）
      openQuestion: (questionId: string) => {
        setStop(null);
        setRejectedShown(null);
        setFocusQuestion((f) => ({ questionId, seq: (f?.seq ?? 0) + 1 }));
        setSide("open");
        setSideFolded(false);
      },
      select: setSelectedRow,
      commentMarks,
    }),
    [sourceEl, commentMarks],
  );
  const [notice, setNotice] = useState<string | null>(null);
  // 開いた版に資料の記録が無い（その版と、そのときの資料の数。資料を足すと消す）
  const [noSources, setNoSources] = useState<{ version: number; files: number } | null>(null);
  // リンクを開いたとき、頼みをほかの鍵がもう受け取っていた・頼みが取り下げられていた（見るだけで開く。Wire の B1）
  // 合言葉がどの効いている頼みにも当たらない（その版を作った鍵でない頼みなど）ときも、見るだけで開く
  const [receive, setReceive] = useState<{ state: "takenByOther"; requester: string; receiver: { by: string; fingerprint: string } } | { state: "withdrawn" | "unknown" } | null>(null);
  // メールのリンクの使い捨ての合言葉（まだ受け取っていない頼み）。開いただけでは受け取らず、下の帯の「受け取る」を押したときだけ使う（Security の点検 11-08 の中6）
  const [link, setLink] = useState<{ planId: string; version: number; token: string } | null>(null);
  const [receiving, setReceiving] = useState(false);
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
  // 見るだけで開いた古い版の記録（その版の計画と、その版をつくったときに当てていた読み方。読むだけ。Wire、11-07 夜）
  const [oldRecord, setOldRecord] = useState<{ planId: string; version: number; plan: Plan; skills: RecordedReading[] | null } | null>(null);
  const statusId = pendingOpen ? (openId ?? "") : (plan?.planId ?? "");
  const [status, reloadStatus] = usePlanStatus(client, statusId, !!statusId && conn.kind === "open");
  const st = status.kind === "ready" ? status.status : null;
  // 版の履歴で人が確定した星取の削除：資料から計画を作り直しても外したままにする（下の版を開く処理より先に置く。Architect の 70）
  useEffect(() => {
    if (st?.latest) setRemovedInHistory(st.latest.plan.planId, st.latest.version, st.accepted ?? []);
  }, [st]);
  useEffect(() => {
    if (!pendingOpen || !st || !openKey || !openId) return;
    setLink(null);
    const fail = (k: string) => {
      ws.blockRestore(null);
      setNotice(T.openFailed(T.openWhat[k] ?? ""));
      setDoneKey(openKey);
    };
    const latest = st.latest;
    if (!latest || latest.plan.planId !== openId) return fail("missing");
    const info = st.versions?.find((x) => x.version === openV) as { contentHash?: string; problem?: string | null } | undefined;
    if (!info) return fail("version");
    // h が無いか 16 字に満たなければ開かない（空の h は、どのハッシュの頭にも合ってしまう。Security の点検 11-08 の中6）
    const h = open.get("h") ?? "";
    if (h.length < 16 || !info.contentHash?.startsWith(h)) return fail("hash");
    if (info.problem) return fail("broken");
    if (openV === latest.version) {
      setWorkingPlan(latest.plan, "intake");
      setOldRecord(null);
      void restoreFrom(openId, latest).catch((e: unknown) => ws.blockRestore(T.sourcesFailed(latest.version, e instanceof Error ? e.message : String(e))));
      setOldView(null);
      setNotice(null);
      setDoneKey(openKey);
      // メールのリンクの使い捨ての合言葉：開いただけでは受け取らない。見るだけで開き、下の帯の「受け取る」を押したときだけ、
      // 頼みと照らして自分の鍵で受け取りに署名する（監査 B1・Security の点検 11-08 の中6）
      const token = open.get("t");
      setReceive(null);
      if (token) setLink({ planId: openId, version: openV, token });
      return;
    }
    void (async () => {
      const r = readHuman<{ ok: boolean; reason?: string; plan: Plan; readingSkills?: RecordedReading[] | null }>(
        await client.callHuman("plan_version_read", ROUTES.planVersionRead.path, { planId: openId, version: openV }),
      );
      if (!r.ok) return fail("version");
      setOldRecord(openNext ? null : { planId: openId, version: openV, plan: r.body.plan, skills: r.body.readingSkills ?? null });
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
    // 作り直しより先に、版の履歴の確定した削除を置く（下の useEffect を待たない。Architect の 70 の残り）
    setRemovedInHistory(planId, latest.version, st?.accepted ?? []);
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
  // メールのリンクで開いて、まだ受け取っていない頼み：見るだけで開き、下の帯の右に「受け取る」だけを置く（Security の点検 11-08 の中6）。
  // 頼んだ本人と、もう受け取った人には出さない（頼んだ人の帯・承認と差し戻しのまま）
  const toReceive =
    link && plan && plan.planId === link.planId && st?.latest?.plan.planId === link.planId && st.latest.version === link.version && !viewingOld && !(req && req.version === link.version && (req.mine || req.receivedByMe))
      ? link
      : null;
  // 見るだけで開いたとき（古い版・ほかの鍵が受け取った頼み・取り下げられた頼み・まだ受け取っていない頼み）は、主ボタンも押せない理由も出さない（Wire の B1）
  const viewOnly = viewingOld !== null || toReceive !== null;
  // 「受け取る」を押したときだけ、合言葉を頼みと照らし、自分の鍵で受け取りに署名する（監査 B1・Security の点検 11-08 の中6）。
  // この PC に鍵がまだ無ければ、押したときに鍵を作ってから受け取る（承認のダイアログと同じ人だけの経路。橋渡しの受け取りは鍵を作らない）。
  // ほかの鍵が受け取っていた・取り下げられていた・効いていない頼みなら、見るだけ
  const receiveNow = async () => {
    if (!toReceive || receiving) return;
    const { planId, version, token } = toReceive;
    setReceiving(true);
    try {
      if (!st?.hasKey) {
        const k = readHuman<{ ok: boolean; reason?: string }>(await client.callHuman("person_key_create", ROUTES.personKeyCreate.path, {}));
        if (!k.ok) return setNotice(k.message);
      }
      const r = readHuman<{ ok: boolean; reason?: string; state: string; requester?: string; receiver?: { by: string; fingerprint: string } }>(
        await client.callHuman("request_receive", ROUTES.requestReceive.path, { planId, version, token }),
      );
      if (!r.ok) return setNotice(r.message);
      setNotice(null);
      setLink(null);
      if (r.body.state === "takenByOther" && r.body.receiver) {
        setReceive({ state: "takenByOther", requester: r.body.requester ?? "", receiver: r.body.receiver });
        setOldView({ planId, version });
      } else if (r.body.state === "withdrawn" || r.body.state === "unknown") {
        setReceive({ state: r.body.state });
        setOldView({ planId, version });
      } else setReceive(null);
    } finally {
      setReceiving(false);
      reloadStatus();
    }
  };

  // 版の下書きが無いあいだは白紙（資料のシートだけ）。開発と試験の見本（?plan=）は、星取表のシートが読んで作業中の計画に置く
  const devSample = new URLSearchParams(location.search).has("plan");
  const current: MergeSheet = !plan ? (devSample && (sheet ?? "chart") === "chart" ? "chart" : "files") : (sheet ?? "chart");
  // 出力と共有のシートは、確定した版を見る（見出しの版はその版。資料を落とす場所ではない）
  const outSheet = current === "export" || current === "share";
  // 見出しの版：承認を頼まれた人には、頼まれた版（いちばん新しい版）を、ほかは次につくる版を出す
  const latestNo = st?.latest && plan && st.latest.plan.planId === plan.planId ? st.latest.version : null;
  // 2 人が同時に書こうとしたとき（docs/screens.md 4 の 6）：この編集がもとにした版より新しい版が保管先にあれば、知らせて署名を止める
  const base = working?.base ?? null;
  const staleBy = !viewingOld && latestNo !== null && (base === null || latestNo > base) ? (st?.versions?.at(-1) ?? null) : null;
  // つくる版は、もとにした版の次（ほかの人が足した版があっても、この編集がつくるつもりの版を出す。署名は止まる）
  const nextVersion = viewingOld ?? ((awaitingMe || askedApprove || toReceive) && latestNo !== null ? latestNo : (base ?? latestNo ?? plan?.version ?? 0) + 1);
  // 取り込みは受け手から返った写しを読む（取り込みは worker の中。読み取りの間も画面は止まらない）
  const view = ws.fileCount ? ws.view : null;
  const openQuestions = view ? view.open.length : 0;
  // 開いた版に未回答があれば、横の板を決まっていない所で開く（下の帯の「未回答 n」と同じ行き先。Wire、11-06）。
  // 版を開いたときと、未回答が 0 から増えたときだけ（人がたたんだあとに開き直さない）
  const questionsKey = `${plan?.planId ?? ""}|${nextVersion}`;
  const questionsSeen = useRef<{ key: string; any: boolean } | null>(null);
  useEffect(() => {
    const any = openQuestions > 0;
    const prev = questionsSeen.current;
    questionsSeen.current = { key: questionsKey, any };
    if (any && (!prev || prev.key !== questionsKey || !prev.any)) {
      setSide("open");
      setSideFolded(false);
    }
  }, [questionsKey, openQuestions]);
  // 受けていない決定と、案のままの当てはめの規則（規則が当てている行は決定に二重に数えない。台帳の新-4）
  // 星取の削除の案（計画に無い案。state/stars.ts）も、案のままなら確定を止める
  const leftDecisions = pending.filter((d) => !accepted.has(`${d.id}\u0000${d.hash}`)).length + openRules + openRemovals;
  // 同じ作業に年数の違う周期の案を受けている（確定を止める。Architect の 44、Wire、11-06）
  const cycleDup = useMemo(() => cycleConflicts(plan, accepted).length, [plan, accepted]);
  // 白紙のあいだに「第 1 版をつくる」を止めている理由（未回答があれば「未回答 n」。セルの数は出さない。Wire、11-07）
  const composeBlocks = !plan ? composeReasons(ws) : [];
  const blocks = [
    !plan ? T.block.noPlan : null,
    staleBy ? T.block.stale : null,
    // 計画を作ったあとに資料・決定・読み方・写真が変わった（作り直していない計画のまま署名しない。台帳の中-6）
    plan && !viewOnly && ws.notRecomposed() ? T.block.notRecomposed : null,
    openQuestions > 0 ? T.block.open(openQuestions) : null,
    leftDecisions > 0 ? T.block.pending(leftDecisions) : null,
    // 受けた決定をまだ読めていない・読めない（保存先が無いなど）あいだは、未確定を 0 と見なして押せるようにしない（mushitaro/moyai#36）
    plan && conn.kind === "open" && !pendingReady ? (pendingProblem ?? T.block.reading) : null,
    cycleDup > 0 ? T.block.cycleDup(cycleDup) : null,
    conn.kind !== "open" ? T.block.notConnected : null,
  ].filter((x): x is string => x !== null);
  const name = plan?.displayName || ws.settings.facilityName || T.newFacility;
  const fictional = plan ? plan.facility.fictional : ws.settings.fictional;

  // 読込中の資料の名前（この画面から入れたもので、読み終わるまで。資料の一覧の「読込中」の行）
  const [readingNames, setReadingNames] = useState<string[]>([]);
  /** 資料を入れる（シートのタブの「＋ 資料を追加」・画面に落とす・資料が無いときの落とし場所） */
  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    const names = files.map((f) => f.name);
    setReadingNames((r) => [...r, ...names]);
    try {
      await ws.addFiles(files.map((f) => ({ name: f.name, size: f.size, bytes: async () => new Uint8Array(await f.arrayBuffer()) })));
      // 「架空」の印は、読み終わったあとの写しで見る
      await ws.fresh(undefined, false).catch(() => undefined);
    } finally {
      setReadingNames((r) => {
        const left = [...r];
        for (const n of names) {
          const i = left.indexOf(n);
          if (i >= 0) left.splice(i, 1);
        }
        return left;
      });
    }
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
  // 突き合せは、このタブに資料が 2 つ以上あるとき
  const fileNames = view ? view.files : [];
  // 費用のシートは星取表のすぐ右（docs/screens.md 3.8）。白紙のシートのタブは「資料」の札と資料の選び・シートの選びと「＋ 資料を足す」だけ
  // 出力と共有は、確定した版があるときだけ（確定のすぐ右。mushitaro/moyai#30）
  const confirmedVersion = st?.latest && plan && st.latest.plan.planId === plan.planId ? st.latest.version : null;
  // パックなし（初めて読む資料。mushitaro/moyai#67）：照査と共有は、要るもの（パックの基準・輪と台帳）が無いので出さない
  const packed = !!plan?.packId;
  const tabs: MergeSheet[] = plan
    ? [
        "chart",
        "cost",
        ...(fileNames.length >= 2 ? (["match"] as const) : []),
        "readings",
        ...(packed ? (["check"] as const) : []),
        "decisions",
        ...(confirmedVersion !== null ? CONFIRMED_SHEETS.filter((x) => packed || x !== "share") : []),
      ]
    : [];
  // 資料の一覧の行（読めた資料・読込中・読込不可。資料ごとのタブは並べない。docs/screens.md 3.2「資料の選び」）
  const skipped = ws.skippedFiles;
  const rows = useMemo(
    () => sourceRows({ files: fileNames, sheets: view?.sheets ?? [], counts: view?.counts ?? [], rejected: [...skipped, ...(view?.rejected ?? [])], reading: readingNames }),
    [view, readingNames, skipped.length],
  );
  const [order, setOrder] = useState<SourceOrder>("name");
  const fileParam = current === "files" ? new URLSearchParams(location.hash.split("?")[1] ?? "").get("f") : null;
  // 開く資料：?f= の資料、無ければこの画面で前に開いた資料、無ければ既定（第 1 版の前は未確定のいちばん多い資料、版のあとは名前順の最初）。
  // 前に開いた資料を覚えるのは、答えて未確定の数が変わっても、見ている資料を替えないため
  const [pinnedFile, setPinnedFile] = useState<string | null>(null);
  const readySet = useMemo(() => new Set(fileNames), [fileNames]);
  const pickedFile = fileParam && readySet.has(fileParam) ? fileParam : pinnedFile && readySet.has(pinnedFile) ? pinnedFile : defaultSource(rows, !plan);
  const shownFile = current === "files" ? pickedFile : null;
  useEffect(() => {
    if (current === "files" && pickedFile && pickedFile !== pinnedFile) setPinnedFile(pickedFile);
  }, [current, pickedFile, pinnedFile]);
  // シートの選び：資料ごとに、この画面で選んだシート（並びは取り込みの順。無ければ最初のシート）
  const [sheetOf, setSheetOf] = useState<Record<string, number>>({});
  const sheetNames = useMemo(() => (pickedFile ? (view?.sheets ?? []).filter((s) => s.file === pickedFile).map((s) => s.sheet ?? s.file) : []), [view, pickedFile]);
  const sheetIndex = pickedFile ? Math.min(sheetOf[pickedFile] ?? 0, Math.max(0, sheetNames.length - 1)) : 0;
  // 資料のシートを見ているときは、開いている資料のシート（セルと行き先）を読む。シートの一覧の「未確定 n」はここから数える
  const sheetsOf = useSheets(ws, shownFile);
  const sheetRows = useMemo<SheetRow[]>(
    () =>
      sheetNames.map((name, i) => {
        const lay = sheetsOf && sheetsOf.length === sheetNames.length && sheetsOf[0]?.file === pickedFile ? sheetsOf[i] : undefined;
        if (!lay) return { name, open: null };
        const open = new Set<number>();
        for (const c of lay.grid.cells) if (lay.status.get(c.ref)?.s === "unresolved") open.add(c.r);
        return { name, open: open.size };
      }),
    [sheetNames, sheetsOf, pickedFile],
  );
  const toFile = (name: string) => {
    setPinnedFile(name);
    location.hash = `${sheetHash("files")}?f=${encodeURIComponent(name)}`;
  };
  const chooseSource = (r: SourceRow) => {
    if (r.state === "ready") {
      setRejectedShown(null);
      return toFile(r.name);
    }
    // 読込不可：理由は詳細に（Wire、11-07）
    setStop(null);
    setRejectedShown(r);
    showSide("source");
  };
  const chooseSheet = (i: number) => {
    if (!pickedFile) return;
    setSheetOf((m) => ({ ...m, [pickedFile]: i }));
    if (current !== "files") toFile(pickedFile);
  };
  // 白紙で資料が入ったら、道を資料のシートにしておく（第 1 版をつくったあとも、資料のタブを選んだ形で開く。Wire、11-07）。
  // 版を開くリンク（?open=）と開発の見本（?plan=）のときは替えない
  useEffect(() => {
    if (!plan && !openId && !devSample && fileNames.length > 0 && sheet !== "files") location.hash = sheetHash("files");
  }, [plan, openId, devSample, fileNames.length, sheet]);
  // 横の板：選んだ切り替えが出せればそれ。無ければ、決まっていない所 → 署名 → 出どころ の順
  const sideOpen = !!view && openQuestions > 0;
  const latestInfo = (st?.versions?.at(-1) as PanelVersion | undefined) ?? null;
  // 署名の切り替えに出す版：古い版を見るだけで開いているあいだは、その版（いちばん新しい版の署名は出さない。Wire、11-07 夜）
  const sigOf = signaturesVersion(st?.versions as PanelVersion[] | undefined, viewingOld);
  const oldOpen = sigOf.old && oldRecord && plan && oldRecord.planId === plan.planId && oldRecord.version === viewingOld ? oldRecord : null;
  const panelInfo = oldOpen ? sigOf.info : latestInfo;
  // 承認を頼まれた人に知らせる、頼まれた版を作った鍵のうち、まだ確かめていないもの（KeyWarn.dc.html の 1）
  const latestUntrusted = latestInfo ? untrustedSigners([latestInfo as { signatures: TrustSig[] }]) : [];
  // 効かない頼み（Wire の B1 の追い）：鎖の行は開いた全員に。別の鍵の頼みがあれば、署名の切り替えに朱の「!」、
  // 版を作った人（この PC の鍵で作った版）には下の帯にも 1 行
  const ignored = st?.requestsIgnored ?? [];
  const ignoredOther = ignored.some((q) => q.why === "otherKey");
  const madeByMe = !!latestInfo?.signatures.some((x) => (x.role === "confirm" || x.role === "edit" || x.role === "revert") && x.trust === "own");
  // 詳しく：どのシートでも、本体で選んだ行・印・セルの全文と根拠を出す所（前の「出どころ」。Wire、2026-11-05）
  const stopShown = stop !== null && stopNotices(ws.notices)[stop].length > 0 ? stop : null;
  const sideSource = !!plan || (current === "files" && fileNames.length > 0) || stopShown !== null || rejectedShown !== null;
  // 詳細に、シートが描いたものの代わりに出す記録（止まった知らせ・読込不可の資料の理由）。シートが描いた詳細は隠して残す
  const sideNote = stopShown ? <StopNoticeDetail notices={ws.notices} kind={stopShown} /> : rejectedShown ? <RejectedDetail row={rejectedShown} /> : null;
  const sideComments = !!plan;
  const can = { open: sideOpen, signatures: !!panelInfo, source: sideSource, comments: sideComments };
  const sideNow: "open" | "signatures" | "source" | "comments" | null = can[side] ? side : sideOpen ? "open" : panelInfo ? "signatures" : sideSource ? "source" : sideComments ? "comments" : null;
  // 見出しの状態と下の帯の左は、いま開いている版（つくっている版）のこと（Wire、2026-11-04）：
  // 編集の番が人に渡っている（編集を頼んだ・承認待ち・差し戻し）ならその番。番が空いている（確定・承認のあと）なら、次の版を編集中。
  // 「確定済み」は、古い版を見るだけで開いたときだけ
  const turnHeld = !!turn && (turn.state === "editing" || turn.state === "awaitingApproval" || turn.state === "returned");
  const stateLabel = viewingOld ? (receive ? T.viewOnlyLabel : T.oldVersionLabel) : toReceive ? T.viewOnlyLabel : turnHeld && turn ? TEXT.top.state[turn.state] : plan ? TEXT.top.state.editing : null;
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
  const compareWith = viewingOld ? null : awaitingMe || askedApprove || toReceive ? (st?.previous ?? null) : (st?.latest ?? null);
  const compare = useMemo<MergeCompare | null>(
    () => (plan && compareWith && compareWith.plan.planId === plan.planId ? { version: compareWith.version, plan: compareWith.plan } : null),
    [plan, compareWith],
  );
  // 古い版を見ているあいだのタブの「ルール n」は出さない（その版のルールは見るだけで、承認するものが無い）
  const unapproved = oldOpen ? 0 : unapprovedReadings(ws);
  // ルールの来歴（ルールの詳細の適用先と、適用 Skill のルールの版 v n）：ルールのシートか古い版を開いたときに、保管先の版の記録から読む
  const [lineage, setLineage] = useState<Lineage | null>(null);
  const wantLineage = conn.kind === "open" && (current === "readings" || !!oldOpen);
  useEffect(() => {
    if (!wantLineage) return;
    let live = true;
    void (async () => {
      const r = readHuman<{ ok: boolean; reason?: string; places?: Lineage["places"]; applied?: Lineage["applied"] }>(await client.callHuman("readings_lineage", ROUTES.readingsLineage.path, {}));
      if (live && r.ok) setLineage({ places: r.body.places ?? [], applied: r.body.applied ?? [] });
    })();
    return () => {
      live = false;
    };
  }, [wantLineage, st]);
  const readingOut = useReadingOut(ws, client, plan);
  const oldReadings = useMemo<OldReadings | null>(() => (oldOpen ? { version: oldOpen.version, skills: oldOpen.skills, plan: oldOpen.plan } : null), [oldOpen]);
  // 古い版の署名の見せ方：版の名前、Skillパックの名前、適用 Skill（版の記録の読み方。ルールの版は来歴から v n）
  const panelOld = oldOpen && panelInfo
    ? {
        name: versionName(
          oldOpen.version,
          (panelInfo.signatures.find((x) => x.role === "approve") ?? panelInfo.signatures.find((x) => x.role === "confirm"))?.at ?? null,
          oldOpen.plan.facility.fiscalYearStartMonth,
        ),
        pack: packChoices().find((p) => p.id === oldOpen.plan.packId)?.name ?? oldOpen.plan.packId,
        skills: oldOpen.skills?.map((x) => ({ name: x.name, path: x.path, version: x.version, no: ruleVersionNo(lineage, placeOf(x.path), x.version) })) ?? null,
        onRule: (path: string) => {
          location.hash = ruleHash(placeOf(path));
        },
      }
    : null;

  return (
    <div
      className="moyai-merge"
      data-testid="merge-page"
      data-sheet={current}
      data-over={over ? "true" : "false"}
      onDragOver={(e) => {
        if (outSheet) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!outSheet) onDrop(e);
      }}
    >
      {over && (
        <div className="moyai-merge-over" aria-hidden="true">
          {T.dropHere(nextVersion)}
        </div>
      )}
      <div className="moyai-merge-head">
        {/* 施設の名前：作業中の計画があり、見るだけでないときは、押してその場で直せる（#56。次に署名した版から効く） */}
        <InlineName name={name} editable={!!plan && viewingOld === null && !awaitingMe && toReceive === null} label={T.renameLabel} />
        {/* 第 1 版をつくる前は施設の名前だけ（まだ版が無い。つくる版の番号は下の帯の「第 1 版をつくる」にある。docs/screens.md 3.3 の末尾「写しの照らし」） */}
        {/* 出力・共有のシートは確定した版の番号（確定した版が無ければ版を出さない） */}
        {plan && !(outSheet && confirmedVersion === null) && (
          <span className="moyai-merge-ver" data-testid="merge-version">
            {T.version(outSheet && confirmedVersion !== null ? confirmedVersion : nextVersion)}
          </span>
        )}
        {stateLabel && !outSheet && (
          <span className="moyai-merge-state" data-view-only={viewOnly ? "true" : "false"} data-testid="merge-state">
            {stateLabel}
          </span>
        )}
        {fictional && <FictionMark />}
        <div className="moyai-merge-head-end">
          {current === "chart" && plan && catalogFor(plan.packId) !== null && (
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
          {/* 白紙で資料が入ったあとは、施設の欄は資料のシートに無いので、ダイアログで開く */}
          {/* 版ができたあとの施設設定（似た施設の見え方と全国の表）は、パックなしでは使わないので出さない（mushitaro/moyai#67） */}
          {plan && !packed ? null : plan || ws.fileCount > 0 ? (
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

      {/* シートのタブの 1 行：折り返さない。入らないときは資料の名前から切る（docs/screens.md 3.2「資料の選び」の幅） */}
      <div className="moyai-sheet-tabs moyai-merge-tabs" data-testid="merge-tabs">
        <div className="moyai-merge-tablist" role="tablist">
          {tabs.map((s) => (
            <a key={s} role="tab" className="moyai-sheet-tab" href={sheetHash(s)} aria-selected={current === s} data-testid={`sheet-${s}`}>
              {T.sheets[s]}
              {s === "readings" && unapproved > 0 && <span className="moyai-sheet-n moyai-num">{unapproved}</span>}
              {s === "decisions" && leftDecisions > 0 && <span className="moyai-sheet-n moyai-num">{leftDecisions}</span>}
            </a>
          ))}
          {rows.length > 0 && (
            <>
              <span className="moyai-sheet-label">{T.filesLabel}</span>
              <SourcePicker rows={rows} current={pickedFile} selected={current === "files"} order={order} onOrder={setOrder} onChoose={chooseSource} />
              {sheetRows.length >= 2 && <SheetPicker key={pickedFile ?? ""} rows={sheetRows} current={sheetIndex} onChoose={chooseSheet} />}
            </>
          )}
          <SourceReading ws={ws} />
          <FileButton multiple onChange={(fs) => void addFiles(fs)}>
            {(props) => (
              <button type="button" className="moyai-sheet-tab" {...props} data-testid="merge-add-files">
                {T.addFiles}
              </button>
            )}
          </FileButton>
        </div>
      </div>

      {/* 出力と共有のシート：中身と下の帯はそのシートが持つ（11-10 の引き算のまま。横の板は出さない。mushitaro/moyai#30） */}
      {outSheet ? (
        <Suspense fallback={null}>{current === "export" ? <Export embedded /> : packed ? <Checkpoint embedded /> : null}</Suspense>
      ) : (
      <>
      <MergePeersContext.Provider value={peersOn}>
      <MergeCompareContext.Provider value={compare}>
      <MergeSideContext.Provider value={sideCtx}>
      <div className="moyai-merge-body">
        <div className="moyai-merge-main">
          <Suspense fallback={null}>
            {current === "chart" && <StarTable embedded />}
            {current === "cost" && plan && <CostSheet plan={plan} />}
            {current === "check" && packed && <Review embedded />}
            {current === "match" && <MatchSheet ws={ws} />}
            {current === "readings" && <ReadingsSheet ws={ws} old={oldReadings} lineage={lineage} out={readingOut} />}
            {current === "decisions" && plan && <DecisionsSheet client={client} plan={plan} />}
          </Suspense>
          {/* 資料のシートは、見ていないあいだも取り込みの状態を持つので、隠すだけにする */}
          <div style={{ display: current === "files" ? undefined : "none" }}>
            <Intake
              ws={ws}
              file={shownFile}
              layouts={sheetsOf}
              sheetIndex={sheetIndex}
              onAddFiles={addFiles}
              composeLabel={plan ? T.composeNext(nextVersion) : T.composeFirst}
              composeInBar={!plan}
              composeOffered={!!plan && ws.uncomposed(plan.planId)}
            />
          </div>
        </div>
        {sideNow && sideFolded && (
          <aside className="moyai-merge-side-band" data-testid="merge-side-band">
            <button type="button" className="moyai-side-band-open" onClick={() => foldSide(false)} aria-label={T.side.unfold} data-testid="side-unfold">
              ‹
            </button>
            {(
              [
                ["open", sideOpen, T.side.open(openQuestions), true],
                ["source", sideSource, T.side.source, false],
                ["signatures", !!panelInfo, T.side.signatures(panelInfo?.signatures.length ?? 0), false],
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
                    foldSide(false);
                  }}
                  data-testid={`side-band-${k}`}
                >
                  {label}
                </button>
              ))}
          </aside>
        )}
        {sideNow && !sideFolded && (
          <aside className="moyai-merge-side" style={{ width: SIDE_WIDTH }} data-testid="merge-side">
            <button type="button" className="moyai-side-fold" onClick={() => foldSide(true)} aria-label={T.side.fold} data-testid="side-fold">
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
              {panelInfo && (
                <a className="moyai-sheet-tab" href="#" aria-selected={sideNow === "signatures"} onClick={(e) => (e.preventDefault(), setSide("signatures"))} data-testid="side-signatures">
                  {T.side.signatures(panelInfo.signatures.length)}
                  {ignoredOther && !oldOpen && (
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
            {sideNow === "open" && view && <Questions ws={ws} view={view} focus={focusQuestion} />}
            {sideNow === "signatures" && panelInfo && (
              <SignaturesPanel
                v={panelInfo}
                readings={ws.currentReadings()}
                onKeyConfirmed={reloadStatus}
                request={req && !req.done && req.version === panelInfo.version ? req : null}
                ignored={oldOpen ? [] : ignored}
                old={panelOld}
              />
            )}
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
                {/* 止まった知らせ・読込不可の資料を押したあいだは、その記録だけ（シートが描いた詳細は隠して残す） */}
                {sideNote}
                <div ref={setSourceEl} className="moyai-side-detail" style={sideNote ? { display: "none" } : undefined} />
                {!sideNote && (
                  <Text size="sm" c="dimmed" className="moyai-side-detail-empty" data-testid="side-detail-empty">
                    {T.side.detailEmpty}
                  </Text>
                )}
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
          {/* 止まった知らせ（編集者の右、朱の字）：結果不明と取り込みの停止だけ。ふつうに終わった作業は出さない */}
          <StopNotices
            notices={ws.notices}
            onShow={(k) => {
              setStop(k);
              setRejectedShown(null);
              showSide("source");
            }}
          />
          {askedByMe && req?.received && (req.received.trust === "unconfirmed" || req.received.trust === "changed") && (
            <KeyWarnLine
              signers={[{ role: "confirm", by: req.received.by, pub: req.received.pub, fingerprint: req.received.fingerprint, trust: req.received.trust, previous: req.received.previous }]}
              onConfirmed={reloadStatus}
              named={false}
            />
          )}
          {awaitingMe && st?.latest && <KeyWarnLine signers={latestUntrusted} onConfirmed={reloadStatus} onShow={() => showSide("signatures")} />}
          {madeByMe && ignoredOther && !viewOnly && (
            <Text size="xs" c="var(--shu-text)" style={{ whiteSpace: "nowrap" }} data-testid="request-ignored">
              {HUMAN_TEXT.request.ignoredBar}
              <button type="button" className="moyai-inline-act" onClick={() => showSide("signatures")} data-testid="request-ignored-show">
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
          {/* ルールのシートだけ：読み方を書き出す（Wire の ReadingOut。古い版を見ているあいだは出さない） */}
          {current === "readings" && !oldReadings && <ReadingOutButton out={readingOut} disabled={conn.kind !== "open"} />}
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
          {toReceive && !st?.hasKey && (
            <Text size="xs" c="dimmed" data-testid="request-receive-new-key">
              {HUMAN_TEXT.confirm.keyNew}
            </Text>
          )}
          <Button variant="default" onClick={() => setHistoryOpen(true)} disabled={!plan || conn.kind !== "open"} data-testid="history-open">
            {T.history}
          </Button>
          {toReceive ? (
            // 承認と差し戻しの前の段階：押したときだけ受け取る（Security の点検 11-08 の中6）
            <Button onClick={() => void receiveNow()} loading={receiving} disabled={conn.kind !== "open"} data-testid="request-receive">
              {HUMAN_TEXT.request.receive}
            </Button>
          ) : viewOnly || askedApprove ? null : awaitingMe && st?.latest ? (
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
      </>
      )}

      {!plan && ws.fileCount > 0 && <IntakeFacilityDialog ws={ws} />}
      {plan && (
        <>
          <FacilityDialog plan={plan} readOnly={viewingOld !== null || awaitingMe || toReceive !== null} />
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
              onSigned={(at) => {
                // 承認した版は、承認の署名の時刻と施設の年度の始まりで年度を付けて呼ぶ（見せ方だけ。差し戻しは「第 n 版」のまま）
                setNotice(signResultLine(signRole, st.latest!.version, at, st.latest!.plan.facility.fiscalYearStartMonth));
                reloadStatus();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
