// MOYAI（トップ）のもやいの星取表（docs/screens.md 3.1、絵は Main.dc.html）：どの施設の、どの版から始めるかを選ぶ。主ボタンは無い。
// 行は保管先の施設（派生した施設は元の施設の下に字下げ）、列は今月までの 20 か月、印は版
// （● は署名して確定・承認した版、朱の ○ は渡して編集中か承認待ちの版、朱の × は確かめで合わない版）。
// - 行の名前の右に、いちばん新しい版（「第 7 版」、等幅）と状態（編集中・承認待ち・差し戻し、朱）。確定した版は年度で呼ぶ（「令和 8 年度版（第 7 版）」。docs/screens.md §3.4 の末尾）。
// - 派生：元の版の印から細い線（--text-3、1px）を下ろし、派生した施設の最初の印へつなぐ。
// - ほかの人が持っていた間：その人が作った版の印の下に 2px の線（印に名前を添える）。
// - 入口は 3 つ：行の右端「＋ 次の版」、版の印のメニュー（開く / この版から次の版 / この版から別の施設をつくる）、星取表の下「＋ 新しい施設」。どれも MERGE へ。
// トップでは資料を受けない。
import { Button, Group, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { ROUTES } from "../../shared/routes";
import type { Plan } from "../../shared/plan";
import type { BridgeClient } from "../bridge-client";
import { useConnection } from "../state/bridge";
import { setPendingDerive } from "../state/derive";
import { setWorkingPlan } from "../state/plan-store";
import { STAGE_HASH, sheetHash } from "../stages";
import { HUMAN_TEXT, TEXT } from "../text";
import { versionName } from "../version-name";
import { readHuman } from "./ConfirmDialog";

const T = TEXT.top;
/** 月の列の数：広い画面で 20 か月、狭い画面では幅に合わせて減らす（「＋ 次の版」がいつも見えるように。最小幅 1024px で 11 か月） */
const MONTHS_MAX = 20;
const MONTHS_MIN = 6;
/** 「＋ 次の版」と左右の余白に取っておく幅 */
const NEXT_W = 96;
const PAD_X = 64;
/** 線を引くための寸法（theme.css の .moyai-top-* とそろえる） */
const NAME_W = 328;
const MONTHS_LEFT = NAME_W + 8 + 1;
const CELL_W = 44;
const HEAD_H = 36;
const ROW_H = 48;

export interface ListedVersion {
  version: number;
  at: string;
  contentHash: string;
  roles: string[];
  /** 版を確定した署名の時刻（承認か自分で確定）。渡しただけ・差し戻し・戻すは null（古い橋渡しには無い） */
  signedAt?: string | null;
  by: string | null;
  /** 版を作った鍵が、前に確かめた鍵と替わっている */
  keyChanged?: boolean;
  problem: string | null;
  legacy: boolean;
}
export interface ListedPlan {
  planId: string;
  displayName: string;
  fictional: boolean;
  /** 施設の年度の始まり（いちばん新しい版の計画から。古い橋渡しには無い） */
  fiscalYearStartMonth?: number;
  versions: ListedVersion[];
  turn: { version: number; state: "editing" | "awaitingApproval" | "approved" | "returned" } | null;
  derivedFrom: { planId: string; version: number; contentHash: string } | null;
}

/** 時刻（ISO）の、日本時間の年月（"2026-11"） */
const monthOf = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" }).format(new Date(iso)).slice(0, 7);

function monthsUpTo(now: Date, n: number): string[] {
  const out: string[] = [];
  const [y, m] = monthOf(now.toISOString()).split("-").map(Number) as [number, number];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** 行の順：元の施設の下に、そこから派生した施設を字下げして並べる（元が保管先に無ければ、いちばん上の段） */
function treeOrder(plans: ListedPlan[]): { p: ListedPlan; depth: number }[] {
  const ids = new Set(plans.map((p) => p.planId));
  const kids = new Map<string, ListedPlan[]>();
  const roots: ListedPlan[] = [];
  for (const p of plans) {
    const parent = p.derivedFrom?.planId;
    if (parent && ids.has(parent) && parent !== p.planId) kids.set(parent, [...(kids.get(parent) ?? []), p]);
    else roots.push(p);
  }
  const out: { p: ListedPlan; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (p: ListedPlan, depth: number) => {
    if (seen.has(p.planId)) return;
    seen.add(p.planId);
    out.push({ p, depth });
    for (const k of kids.get(p.planId) ?? []) walk(k, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  for (const p of plans) walk(p, 0); // 輪になった派生も落とさない
  return out;
}

/** 施設の作業中の要約（橋渡しの /tab/work-list。src/bridge/work.ts の WorkSummary と同じ形） */
interface WorkSummary {
  planId: string;
  displayName: string;
  fictional: boolean;
  open: number;
  changed: boolean;
  base: number | null;
  savedAt: string;
}

/** 作業中を資料ごと続きから開くリンク（#82） */
export const workLink = (planId: string): string => `${STAGE_HASH.merge}?work=${encodeURIComponent(planId)}`;

/** いちばん新しい版が、渡して編集中・承認待ち・差し戻しのままか */
function openLatest(p: ListedPlan): boolean {
  const latest = p.versions.at(-1);
  return !!p.turn && latest?.version === p.turn.version && (p.turn.state === "editing" || p.turn.state === "awaitingApproval" || p.turn.state === "returned");
}

/**
 * 行の名前の右の版（版の履歴の行）。確定した版（自分で確定か承認）は、確定した署名の日の年度で「令和 8 年度版（第 7 版）」。
 * 編集中・承認待ち・差し戻し・確かめで合わない版は「第 7 版」のまま（署名の前の版には年度を付けない）。版が無ければ null
 */
export function rowVersionLabel(p: ListedPlan): string | null {
  const latest = p.versions.at(-1);
  if (!latest) return null;
  const settled = !latest.problem && !openLatest(p);
  return versionName(latest.version, settled ? (latest.signedAt ?? null) : null, p.fiscalYearStartMonth);
}

const openLink = (planId: string, v: ListedVersion, next = false) => `${STAGE_HASH.merge}?open=${encodeURIComponent(planId)}&v=${v.version}&h=${v.contentHash.slice(0, 16)}${next ? "&next=1" : ""}`;

export function MoyaiTop({ client }: { client: BridgeClient }) {
  const { state } = useConnection();
  const [plans, setPlans] = useState<ListedPlan[] | null>(null);
  // 施設ごとの作業中（#82。保管先の plans/<計画ID>/work/。作業画面だけの道で読む）
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [derive, setDerive] = useState<{ p: ListedPlan; v: ListedVersion } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [monthCount, setMonthCount] = useState(MONTHS_MAX);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const n = Math.floor((el.clientWidth - PAD_X - MONTHS_LEFT - NEXT_W) / CELL_W);
      setMonthCount(Math.max(MONTHS_MIN, Math.min(MONTHS_MAX, n)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 開いたときと、タブに戻ったときに読み直す（ほかの人がメールのリンクで承認した版を、開いたままのトップにも出すため）
  useEffect(() => {
    if (state.kind !== "open") return;
    const load = async () => {
      const r = readHuman<{ ok: boolean; reason?: string; plans: ListedPlan[]; name: string | null }>(await client.callHuman("plans_list", ROUTES.plansList.path, {}));
      if (!r.ok) return setError(r.message);
      setError(null);
      setPlans(r.body.plans);
      setMe(r.body.name ?? null);
      const w = await client.workCall(ROUTES.tabWorkList.path, undefined);
      setWorks(Array.isArray(w?.works) ? (w.works as WorkSummary[]) : []);
    };
    const onVisible = () => document.visibilityState === "visible" && void load();
    void load();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [state.kind, client]);
  const months = useMemo(() => monthsUpTo(new Date(), monthCount), [monthCount]);
  // 署名した版が無い施設も、作業中があれば行に出す（版の印は無い）
  const rows = useMemo(() => {
    const listed = plans ?? [];
    const have = new Set(listed.map((p) => p.planId));
    const workOnly: ListedPlan[] = works
      .filter((w) => !have.has(w.planId))
      .map((w) => ({ planId: w.planId, displayName: w.displayName, fictional: w.fictional, versions: [], turn: null, derivedFrom: null }));
    return treeOrder([...listed, ...workOnly]);
  }, [plans, works]);
  const workOf = useMemo(() => new Map(works.filter((w) => w.changed || w.open > 0).map((w) => [w.planId, w])), [works]);
  const discardWork = async (planId: string) => {
    const r = readHuman<{ ok: boolean }>(await client.callHuman("work_discard", ROUTES.workDiscard.path, { planId }));
    if (!r.ok) return setError(r.message);
    setWorks((ws) => ws.filter((w) => w.planId !== planId));
  };
  const anyProblem = rows.some(({ p }) => p.versions.some((v) => v.problem));
  const anyOther = rows.some(({ p }) => p.versions.some((v) => v.by && me && v.by !== me));
  const anyDerived = rows.some(({ depth }) => depth > 0);

  // 派生の線：元の版の印の列から下ろし、派生した施設の最初の印の手前まで横に引く（20 か月の外は、端の列に寄せる）
  const branches = useMemo(() => {
    const at = new Map(rows.map(({ p }, i) => [p.planId, i]));
    const col = (iso: string) => {
      const i = months.indexOf(monthOf(iso));
      return i < 0 ? 0 : i;
    };
    const out: { key: string; x: number; y1: number; y2: number; x2: number }[] = [];
    rows.forEach(({ p, depth }, i) => {
      if (depth === 0 || !p.derivedFrom) return;
      const pi = at.get(p.derivedFrom.planId);
      const parent = pi === undefined ? undefined : rows[pi]?.p;
      const pv = parent?.versions.find((v) => v.version === p.derivedFrom!.version);
      const first = p.versions[0];
      if (pi === undefined || !pv || !first) return;
      const x = MONTHS_LEFT + col(pv.at) * CELL_W + CELL_W / 2;
      const x2 = MONTHS_LEFT + col(first.at) * CELL_W + CELL_W / 2 - 8;
      out.push({ key: p.planId, x, y1: HEAD_H + pi * ROW_H + ROW_H / 2 + 7, y2: HEAD_H + i * ROW_H + ROW_H / 2, x2: Math.max(x, x2) });
    });
    return out;
  }, [rows, months]);

  return (
    <div className="moyai-top" data-testid="moyai-top" ref={box} data-months={monthCount}>
      <h1 className="moyai-top-title">{T.title}</h1>
      {error && (
        <Text size="sm" c="var(--shu-text)">
          {error}
        </Text>
      )}
      {rows.length > 0 && (
        <div className="moyai-top-grid" data-testid="moyai-table">
          {/* 年は、最初の列と 1 月の列にだけ出す */}
          <div className="moyai-top-head">
            <span className="moyai-top-name" />
            <span className="moyai-top-months">
              {months.map((m, i) => (
                <span key={m} className="moyai-top-cell">
                  {i === 0 || m.endsWith("-01") ? m.slice(0, 4) : ""}
                </span>
              ))}
            </span>
          </div>
          <div className="moyai-top-head">
            <span className="moyai-top-name" />
            <span className="moyai-top-months">
              {months.map((m) => (
                <span key={m} className="moyai-top-cell" title={T.yearMonth(m)}>
                  {T.month(m)}
                </span>
              ))}
            </span>
          </div>
          {rows.map(({ p, depth }) => {
            const latest = p.versions.at(-1);
            // 鍵が替わった版（いちばん新しいもの）。未確認は出さない（初めての相手はいつも未確認なので、毎回出すと見なくなる）
            const keyChanged = [...p.versions].reverse().find((v) => v.keyChanged) ?? null;
            const open = openLatest(p);
            return (
              <div key={p.planId} className="moyai-top-row" data-testid="moyai-row" data-plan={p.planId} data-depth={depth}>
                <span className="moyai-top-name" title={p.displayName} style={{ paddingLeft: depth * 16 }}>
                  <span className="moyai-top-facility">{p.displayName}</span>
                  {latest && (
                    <span className="moyai-top-ver" data-testid="moyai-version">
                      {rowVersionLabel(p)}
                    </span>
                  )}
                  {open && p.turn && (
                    <span className="moyai-top-state" data-testid="moyai-state">
                      {T.state[p.turn.state]}
                    </span>
                  )}
                  {workOf.has(p.planId) && (
                    <Menu position="bottom-start" withinPortal>
                      <Menu.Target>
                        <button type="button" className="moyai-top-state moyai-top-work" data-testid="moyai-work" data-open={workOf.get(p.planId)!.open}>
                          {T.work(workOf.get(p.planId)!.open)}
                        </button>
                      </Menu.Target>
                      <Menu.Dropdown data-testid="moyai-work-menu">
                        <Menu.Item component="a" href={workLink(p.planId)} data-testid="work-resume">
                          {T.workMenu.resume}
                        </Menu.Item>
                        <Menu.Item onClick={() => void discardWork(p.planId)} data-testid="work-discard">
                          {T.workMenu.discard}
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  )}
                </span>
                <span className="moyai-top-months">
                  {months.map((m) => {
                    const here = p.versions.filter((v) => monthOf(v.at) === m);
                    const other = here.find((v) => v.by && me && v.by !== me);
                    return (
                      <span key={m} className="moyai-top-cell" data-other={other ? "true" : undefined} data-testid={other ? "moyai-other" : undefined} title={here.map((v) => T.markTitle(v.version, v.by)).join("・")}>
                        {here.map((v) => {
                          const signed = v.roles.includes("confirm") || v.roles.includes("approve");
                          const kind = v.problem ? "problem" : (open && v.version === latest?.version) || !signed ? "open" : "signed";
                          return (
                            <Menu key={v.version} position="bottom-start" offset={4} width={248} withinPortal>
                              <Menu.Target>
                                <button type="button" className="moyai-top-mk" data-kind={kind} data-testid="moyai-mark" data-version={v.version} aria-label={T.markTitle(v.version, v.by)}>
                                  {kind === "problem" ? "×" : kind === "open" ? "○" : "●"}
                                </button>
                              </Menu.Target>
                              <Menu.Dropdown data-testid="moyai-mark-menu">
                                <Menu.Label>{T.menuHead(v.version, monthOf(v.at), v.roles.length)}</Menu.Label>
                                <Menu.Item component="a" href={openLink(p.planId, v)} disabled={!!v.problem} data-testid="mark-open">
                                  {T.menu.open}
                                </Menu.Item>
                                <Menu.Item component="a" href={openLink(p.planId, v, v.version !== latest?.version)} disabled={!!v.problem} data-testid="mark-next">
                                  {T.menu.next}
                                </Menu.Item>
                                <Menu.Item onClick={() => setDerive({ p, v })} disabled={!!v.problem} data-testid="mark-derive">
                                  {T.menu.derive}
                                </Menu.Item>
                              </Menu.Dropdown>
                            </Menu>
                          );
                        })}
                      </span>
                    );
                  })}
                </span>
                {latest && !latest.problem && (
                  <a className="moyai-top-add" href={openLink(p.planId, latest)} data-testid="moyai-next">
                    {T.next}
                  </a>
                )}
                {keyChanged && !keyChanged.problem && (
                  <a className="moyai-top-add" style={{ color: "var(--shu-text)" }} href={openLink(p.planId, keyChanged)} data-testid="moyai-key-changed">
                    {HUMAN_TEXT.keyWarn.topChanged}
                  </a>
                )}
              </div>
            );
          })}
          {branches.map((b) => (
            <span key={b.key} className="moyai-top-branch" data-testid="moyai-branch" aria-hidden="true">
              <span className="moyai-top-br" style={{ left: b.x, top: b.y1, width: 1, height: Math.max(0, b.y2 - b.y1) }} />
              <span className="moyai-top-br" style={{ left: b.x, top: b.y2, width: Math.max(0, b.x2 - b.x), height: 1 }} />
            </span>
          ))}
        </div>
      )}
      <a className="moyai-top-add moyai-top-new" href={STAGE_HASH.merge} data-testid="moyai-new">
        {T.newFacility}
      </a>
      {rows.length > 0 && (
        <div className="moyai-top-legend">
          <span>
            <span className="moyai-top-mk" data-kind="signed" /> {T.legend.signed}
          </span>
          <span className="moyai-top-legend-open">
            <span className="moyai-top-mk" data-kind="open" /> {T.legend.open}
          </span>
          {anyProblem && (
            <span className="moyai-top-legend-open">
              <span className="moyai-top-mk" data-kind="problem">
                ×
              </span>{" "}
              {T.legend.problem}
            </span>
          )}
          {anyOther && <span>{T.legend.other}</span>}
          {anyDerived && <span>{T.legend.derived}</span>}
        </div>
      )}
      {derive && <DeriveDialog client={client} from={derive} onClose={() => setDerive(null)} />}
    </div>
  );
}

/** この版から別の施設をつくる：新しい施設の名前を決め、元の版の中身を作業中の計画に置いて MERGE へ（第 1 版に署名するとき、元を版の記録に書く） */
function DeriveDialog({ client, from, onClose }: { client: BridgeClient; from: { p: ListedPlan; v: ListedVersion }; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fictional = from.p.fictional;
  const ok = name.trim().length > 0;
  const make = async () => {
    if (!ok) return;
    setBusy(true);
    const r = readHuman<{ ok: boolean; reason?: string; plan: Plan; contentHash: string }>(await client.callHuman("plan_version_read", ROUTES.planVersionRead.path, { planId: from.p.planId, version: from.v.version }));
    setBusy(false);
    if (!r.ok) return setError(r.message);
    // 架空の施設から作った施設も架空（名前に【架空】を付ける）
    const mark = `【${TEXT.fictionMark}】`;
    const display = fictional && !name.includes(mark) ? `${mark}${name.trim()}` : name.trim();
    // 計画の ID は英数字とハイフンだけ（保管先のフォルダの名前になる。施設の名前は入れない）
    const id = `plan-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
    const src = r.body.plan;
    const plan: Plan = { ...src, planId: id, displayName: display, version: 0, facility: { ...src.facility, facilityKey: id, name: display, fictional } };
    setPendingDerive({ planId: id, from: { planId: from.p.planId, version: from.v.version, contentHash: r.body.contentHash } });
    setWorkingPlan(plan, "intake");
    onClose();
    location.hash = sheetHash("chart");
  };
  return (
    <Modal opened onClose={onClose} title={T.deriveTitle(from.p.displayName, from.v.version)} centered data-testid="derive-dialog">
      <Stack gap="sm">
        <TextInput label={T.deriveName} placeholder={T.deriveNamePlaceholder} value={name} onChange={(e) => setName(e.currentTarget.value)} maxLength={80} data-testid="derive-name" autoFocus />
        <Text size="xs" c="dimmed">
          {T.deriveResult(from.v.version)}
        </Text>
        {error && (
          <Text size="sm" c="var(--shu-text)">
            {error}
          </Text>
        )}
        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onClose}>
            {T.deriveCancel}
          </Button>
          <Button onClick={() => void make()} disabled={!ok} loading={busy} data-testid="derive-submit">
            {T.deriveSubmit}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
