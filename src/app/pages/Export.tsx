// EXPORT（docs/screens.md 3.5、Wire の ExportOne.dc.html）：確定した版から、人が Excel を落とす。
// 運営者 2026-11-10「引き算」：画面で人がするのは、様式の行を選んで、主ボタンを 1 つ押すことだけ。列対応は Claude との会話で決める（screen_set の templateLayout）。
// 様式の行：標準・差分（前の確定版があるとき）・保存先の様式・Claude が入れた様式・＋ 様式を追加。下の帯のボタンは主ボタンの 1 つだけで、
// 字は「Excel を出力」（標準・差分・承認済みの様式）か「署名して出力」（列対応が下書きか Claude の入力）。署名のダイアログは置かない。
// どの出力も、押したときだけ人だけの経路（callHuman）で読む・署名する（state/export-run.ts）。署名と鎖が合わない版の Excel は渡さない。
// Claude の列対応（template-layout-v1）は画面の中だけにあり（state/template-draft.ts）、「署名して出力」を押したときだけ、列対応と様式を保存先に置き（template_save）、
// その版で署名して書き出し（export_sign）、照らして落とす（export_file_read）。
import { Alert, Button, Group, Stack, Table, Text } from "@mantine/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { buildChart } from "../../plan/chart";
import type { Plan } from "../../shared/plan";
import { ROUTES } from "../../shared/routes";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { formatCell } from "../chart/grid";
import { FictionMark } from "../components/FictionMark";
import { TemplateExport, readTemplate, templateKey, type SharedTemplate } from "../components/TemplateExport";
import { TemplateLayoutPreview } from "../components/TemplateLayoutPreview";
import { KeyWarnLine } from "../components/KeyWarn";
import { COLUMNS_SCHEMA, type TemplateColumns } from "../../plan/template";
import type { TemplateLayout } from "../../shared/template-layout";
import { patchedExcelJS } from "../../import/exceljs-setup";
import { markSaved, offerTemplate, pendingTemplates, takeSelectRequest, useTemplateDrafts } from "../state/template-draft";
import { getReferenceDate } from "../state/review";
import { readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { sheetHash } from "../stages";
import { exportBlockOf, exportPrimaryOf, nothingMapped, withReasonHead, type ExportChoice, type ExportStop } from "../state/export-reason";
import { runExport, type ExportJob, type HumanCall } from "../state/export-run";
import { TEXT } from "../text";
import { dueBaseDate } from "../../plan/due-view";

const T = TEXT.export;
const C = TEXT.chart;
const L = TEXT.export.template.layout;
const SAMPLE_ROWS = 12;
const SAMPLE_YEARS = 6;

const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));

/** Claude の列対応（案）を、保存先に置く列対応（columns.json）にする。見出しの字は案の最初の計画の表の見出しの下の行（列の役目は使わないので未定） */
export function layoutColumns(probe: { worksheets: { name: string; columnCount: number; getRow(r: number): { getCell(c: number): { text?: string } } }[] }, layout: TemplateLayout): TemplateColumns {
  const s = layout.sheets[0]!;
  const headerRow = Math.max(...s.headerRows);
  const ws = probe.worksheets.find((w) => w.name === s.sheet);
  const headers: string[] = [];
  if (ws) for (let c = 1; c <= Math.min(ws.columnCount, 200); c++) headers.push(String(ws.getRow(headerRow).getCell(c).text ?? "").trim().slice(0, 200));
  while (headers.length > 1 && headers.at(-1) === "") headers.pop();
  if (headers.length === 0) headers.push("");
  return { schema: COLUMNS_SCHEMA, headerRow, headers, roles: headers.map(() => ({ kind: "none" as const })), layout };
}

function download(base64: string, name: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** 中身の見本：確定した版の台帳の段の行の先頭と、終わりの年度 */
function Sample({ plan }: { plan: Plan }) {
  const model = useMemo(() => {
    const catalog = catalogFor(plan.packId) ?? emptyCatalog();
    return buildChart(plan, catalog, { levelFallback: C.levelFallback, commonLevels: C.commonLevels, unmapped: C.unmapped, series: C.series }, { mode: "ledger", period: "year", layer: "original", foldLevel: null });
  }, [plan]);
  const periods = model.periods.slice(-SAMPLE_YEARS);
  return (
    <Table withTableBorder className="moyai-num" data-testid="export-sample">
      <Table.Thead>
        <Table.Tr>
          {model.levelNames.map((n) => (
            <Table.Th key={n}>{n}</Table.Th>
          ))}
          {periods.map((p) => (
            <Table.Th key={p.key}>{T.fiscal(p.fiscalYear)}</Table.Th>
          ))}
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {model.rows.slice(0, SAMPLE_ROWS).map((r) => (
          <Table.Tr key={r.id}>
            {r.levelCells.map((c, i) => (
              <Table.Td key={i}>{c}</Table.Td>
            ))}
            {periods.map((p) => (
              <Table.Td key={p.key}>{formatCell(r.cells[p.key])}</Table.Td>
            ))}
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

/** 押せない理由の 1 行（SHARE の send-reason と同じ形）。確定版なし・計画なしは、右に HOSHITORI への道 */
function Reason({ text }: { text: string }) {
  const to = text === T.notConfirmed ? sheetHash("decisions") : text === T.noPlanReason ? sheetHash("files") : null;
  return (
    <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }} data-testid="export-blocked">
      {text}
      {to && (
        <a className="moyai-inline-act" href={to} data-testid="export-blocked-to">
          {T.toMerge}
        </a>
      )}
    </Text>
  );
}

/** 主ボタンを止める理由の字 */
function stopText(s: ExportStop): string {
  switch (s.kind) {
    case "notConnected":
      return T.notConnected;
    case "noPlan":
      return T.noPlanReason;
    case "loading":
    case "reading":
      return T.loading;
    case "loadError":
      return withReasonHead(s.message);
    case "notConfirmed":
      return T.notConfirmed;
    case "broken":
      return withReasonHead(T.broken);
    case "returned":
      return withReasonHead(T.template.returned);
    case "undecided":
      return T.template.undecidedReason(s.n);
  }
}

/** embedded：HOSHITORI の出力のシートの中（施設の名前と版は HOSHITORI の見出しが出す。mushitaro/moyai#30） */
export function Export({ embedded = false }: { embedded?: boolean } = {}) {
  const { client, state } = useConnection();
  const working = useWorkingPlan();
  const planId = working?.plan.planId ?? "";
  const [load, reload] = usePlanStatus(client, planId, !!working && state.kind === "open");
  const [busy, setBusy] = useState(false);
  // 選んだ行：保存先の様式（selected）・Claude が入れてまだ保存していない様式（pendingSel、その名前）・差分（diffSel）。どれでもなければ標準
  const [pendingSel, setPendingSel] = useState<string | null>(null);
  const [diffSel, setDiffSel] = useState(false);
  const drafts = useTemplateDrafts();
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [selected, setSelected] = useState<SharedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 出力したあとの、下の帯の左の 1 行（ファイル名）。差分はこの画面で出力したら行に「✓ 出力済み」
  const [saved, setSaved] = useState<string | null>(null);
  const [diffOut, setDiffOut] = useState(false);
  const status = load.kind === "ready" ? load.status : null;
  const latest = status?.latest ?? null;
  const previous = status?.previous ?? null;
  const info = status?.versions?.find((v) => v.version === latest?.version) ?? null;
  const broken = !!info && info.problem !== null;
  const returned = !!info && info.signatures.some((x) => x.role === "return");
  const approved = !!info && info.signatures.some((x) => x.role === "approve");
  // どの出力も止める理由（押せないボタンには、いつも「理由：」の 1 行。版の読込の誤りも出す）
  const block = exportBlockOf({
    connected: state.kind === "open",
    hasPlan: !!working,
    load: load.kind === "ready" ? { kind: "ready" } : load,
    hasLatest: !!latest,
    broken,
  });

  const loadTemplates = useCallback(
    async (keep?: { name: string; version: string }) => {
      if (state.kind !== "open") return;
      const r = readHuman<{ ok: boolean; templates: SharedTemplate[] }>(await client.callHuman("templates_read", ROUTES.templatesRead.path, { planId: planId || null }));
      if (!r.ok) return setError(r.message);
      setTemplates(r.body.templates);
      setSelected((cur) => {
        const want = keep ?? cur;
        return want ? (r.body.templates.find((t) => templateKey(t) === templateKey(want)) ?? null) : null;
      });
    },
    [client, state.kind, planId],
  );
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates, latest?.version]);

  const choose = (next: { selected?: SharedTemplate | null; pending?: string | null; diff?: boolean }) => {
    setSelected(next.selected ?? null);
    setPendingSel(next.pending ?? null);
    setDiffSel(next.diff ?? false);
    setSaved(null);
    setError(null);
  };

  // Claude が様式を入れた・列対応を置いたら、その様式を選ぶ（画面は AI の作業を追う）
  useEffect(() => {
    const want = takeSelectRequest();
    if (!want) return;
    if (pendingTemplates(drafts).some((k) => k.name === want)) return choose({ pending: want });
    const t = templates.find((x) => x.name === want && x.current);
    if (t) choose({ selected: t });
  }, [drafts, templates]);

  // 保存先の様式を選んだら、様式のファイルを読む（列対応の見本を様式の見た目のまま描くため。Claude が保存先の様式に列対応を置くときにも使う）
  useEffect(() => {
    if (!selected || state.kind !== "open") return;
    if (drafts.known.some((k) => k.name === selected.name && k.saved?.version === selected.version)) return;
    let alive = true;
    void (async () => {
      const r = readHuman<{ ok: boolean; base64: string }>(await client.callHuman("template_file_read", ROUTES.templateFileRead.path, { name: selected.name, version: selected.version }));
      if (!alive || !r.ok) return;
      const bytes = Uint8Array.from(atob(r.body.base64), (c) => c.charCodeAt(0));
      try {
        const probe = new (patchedExcelJS().Workbook)();
        await probe.xlsx.load(bytes.slice().buffer as ArrayBuffer);
        offerTemplate({ name: selected.name, bytes, probe, saved: { version: selected.version } });
      } catch {
        // 読めない様式は見本を出さない（列対応の表は出る）
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected, client, state.kind, drafts.known]);

  // ＋ 様式を追加：追加した様式を、見出しの言葉から読んだ列対応で保存先に置く（下書き）
  const onDrop = async (f: File) => {
    const t = await readTemplate(f);
    if (!t.ok) return t.message;
    const r = readHuman<{ ok: boolean; name: string; version: string }>(
      await client.callHuman("template_save", ROUTES.templateSave.path, { name: t.name, base64: toBase64(new Uint8Array(t.bytes)), columns: t.columns, from: null }),
    );
    if (!r.ok) return r.message;
    setPendingSel(null);
    setDiffSel(false);
    setSaved(null);
    await loadTemplates({ name: r.body.name, version: r.body.version });
    return null;
  };

  // Claude の列対応：選んだ様式（Claude が入れたものを先に）・列対応（Claude の案か保存した列対応）・見本に書く版
  const pendingT = pendingSel ? (drafts.known.find((k) => k.saved === null && k.name === pendingSel) ?? null) : null;
  const savedT = selected ? (drafts.known.find((k) => k.name === selected.name && k.saved?.version === selected.version) ?? null) : null;
  const selName = pendingSel ?? selected?.name ?? null;
  const draftOf = selName ? (drafts.drafts.get(selName) ?? null) : null;
  // Claude の案は、Claude が入れた様式か、保存先の様式のいちばん上の版のもの（同じ名前の Claude が入れた様式があれば、そちらのもの）
  const draft = draftOf && (pendingSel !== null || (!!selected?.current && !pendingTemplates(drafts).some((k) => k.name === selName))) ? draftOf : null;
  const layout: TemplateLayout | null = draft?.layout ?? selected?.columns.layout ?? null;
  const layoutBytes = pendingT?.bytes ?? savedT?.bytes ?? null;
  const layoutProbe = (pendingT ?? savedT)?.probe ?? null;
  const target = latest?.plan ?? working?.plan ?? null;
  const targetAsOf = latest && info ? dueBaseDate(info.at) : getReferenceDate();
  const catalog = useMemo(() => (target ? (catalogFor(target.packId) ?? emptyCatalog()) : emptyCatalog()), [target]);
  const layoutView =
    (pendingSel !== null || selected) && layout ? (
      layoutBytes && target ? (
        <TemplateLayoutPreview bytes={layoutBytes} layout={layout} plan={target} catalog={catalog} asOf={targetAsOf} draft={!!draft} />
      ) : (
        <Text size="sm" c="dimmed" data-testid="layout-empty">
          {L.reading}
        </Text>
      )
    ) : null;

  // 差分の行は、前の確定版があるときだけ（確かめで合うときだけ橋渡しが返す）
  const diffRow = latest && previous ? { from: previous.version, active: diffSel, exported: diffOut } : null;
  const choice: ExportChoice =
    pendingSel !== null
      ? { kind: "claude", hasLayout: !!draft, ready: !!layoutBytes && !!layoutProbe }
      : selected && draft
        ? { kind: "claude", hasLayout: true, ready: !!layoutBytes && !!layoutProbe }
        : selected
          ? { kind: "template", exported: selected.exported, approved: !!selected.approval, empty: nothingMapped(selected.columns) }
          : diffRow?.active
            ? { kind: "diff" }
            : { kind: "standard" };
  const primary = exportPrimaryOf(choice, block, returned);
  const reason = primary.stop ? stopText(primary.stop) : null;

  // 承認待ち：承認を頼まれた人（受け取った人か宛先）。承認されたら出さない
  const req = status?.request ?? null;
  const pendingWho = latest && !approved && req && req.kind === "approve" && !req.done ? (req.received?.by ?? req.to) : null;
  // 選んだ様式の、この版の書き出しの署名の鍵が未確認なら警告する（止めない。Architect の縛り 7）
  // 落とすのは、ブリッジと同じ選び方の 1 つ（信じる鍵の書き出しを先に、その中で時刻の新しいもの）。その署名者の鍵が未確認なら、その 1 つについて警告する
  const served = (() => {
    if (!selected || !info?.exports) return null;
    const xs = info.exports.filter((x) => x.template.name === selected.name && x.template.version === selected.version);
    const newest = (ys: typeof xs) => [...ys].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    return newest(xs.filter((x) => x.trust === "own" || x.trust === "confirmed")) ?? newest(xs) ?? null;
  })();
  const exportSigners = served && (served.trust === "unconfirmed" || served.trust === "changed") ? [{ ...served, role: "export" }] : [];

  const call: HumanCall = async (action, path, payload) => readHuman(await client.callHuman(action, path, payload));
  // 主ボタンの 1 回（人が押したときだけ）。署名する道（sign・layout）も、この 1 回で署名して落とす
  const output = async () => {
    if (primary.stop || !latest || busy) return;
    const fileOf = (name: string) => T.template.fileName(name, latest.plan.displayName, latest.version, pendingWho ? T.template.pendingSuffix : "");
    let job: ExportJob;
    switch (primary.action) {
      case "plan":
        job = { action: "plan", planId, version: latest.version, fileName: T.fileName(latest.plan.displayName, latest.version) };
        break;
      case "report":
        job = { action: "report", planId, version: latest.version, fileName: T.reportName(latest.plan.displayName, latest.version) };
        break;
      case "read":
      case "sign":
        if (!selected) return;
        job = { action: primary.action, planId, version: latest.version, template: { name: selected.name, version: selected.version }, fileName: fileOf(selected.name) };
        break;
      case "layout":
        if (!selName || !layout || !layoutBytes || !layoutProbe) return;
        job = { action: "layout", planId, version: latest.version, name: selName, base64: toBase64(layoutBytes), columns: layoutColumns(layoutProbe, layout), fileName: fileOf(selName) };
        break;
    }
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await runExport(job, call);
      if (r.saved) {
        // 列対応と様式を保存先に置いた：Claude の案を捨て、その版を選ぶ
        markSaved(r.saved.name, r.saved.version);
        setPendingSel(null);
      }
      if (r.ok) {
        download(r.base64, r.fileName);
        setSaved(r.fileName);
        if (job.action === "report") setDiffOut(true);
      } else setError(r.message);
      // 署名したら（拒まれても）、版の一覧と様式の行を読み直す（承認済み・出力済み）
      if (job.action === "sign" || job.action === "layout") {
        reload();
        await loadTemplates(r.saved ?? undefined);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="moyai-share-page" data-testid="export-page">
      <div className="moyai-share-body">
        {/* 段の名前はヘッダが大きく出すので、見出しは施設の名前と版の 1 行だけ（MERGE と同じ形） */}
        {!embedded && (
        <div className="moyai-page-head" data-testid="export-plan">
          {latest && (
            <>
              <h1 className="moyai-merge-name">{latest.plan.displayName}</h1>
              <span className="moyai-merge-ver">{T.version(latest.version)}</span>
            </>
          )}
          {latest?.plan.facility.fictional && <FictionMark />}
        </div>
        )}
        <Stack gap="md">
          {target && (
            <TemplateExport
              plan={target}
              asOf={targetAsOf}
              templates={templates}
              selected={selected}
              onSelect={(t) => choose({ selected: t })}
              onDrop={onDrop}
              standardExported={!!latest && !broken}
              diff={diffRow}
              onSelectDiff={() => choose({ diff: true })}
              pending={pendingTemplates(drafts).map((k) => ({ name: k.name, hasDraft: drafts.drafts.has(k.name) }))}
              pendingSel={pendingSel}
              onSelectPending={(name) => choose({ pending: name })}
              draftNames={new Set([...drafts.drafts.keys()].filter((n) => !pendingTemplates(drafts).some((k) => k.name === n)))}
              layoutView={layoutView}
            />
          )}
          {error && (
            <Alert color="gray" data-testid="export-error">
              {error}
            </Alert>
          )}
          {!working && (
            <Text size="sm">
              {T.noPlan} <a href={sheetHash("files")}>{T.toMerge}</a>
            </Text>
          )}
          {latest && choice.kind === "standard" && <Sample plan={latest.plan} />}
        </Stack>
      </div>
      {/* 下の帯：左に出力のあとの 1 行。右端に主ボタン 1 つ、そのすぐ左に押せない理由。その左に承認待ちの 1 行・鍵の警告（2 行のときは承認待ちが上） */}
      <Group justify="flex-end" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar">
        {saved && (
          <Text size="xs" c="var(--text)" className="moyai-num" mr="auto" data-testid="export-saved">
            {T.saved(saved)}
          </Text>
        )}
        <Stack gap={2} align="flex-end">
          {!block && selected && selected.exported && !draft && pendingWho && (
            <Text size="xs" c="var(--text)" data-testid="export-pending">
              {T.template.pending(pendingWho)}
            </Text>
          )}
          {!block && exportSigners.length > 0 && <KeyWarnLine signers={exportSigners} onConfirmed={() => reload()} />}
        </Stack>
        <Group gap="sm" wrap="nowrap" align="center">
          {reason && <Reason text={reason} />}
          <Button onClick={() => void output()} disabled={!!primary.stop} loading={busy} data-testid={primary.testid}>
            {primary.label === "sign" ? T.template.sign : T.excel}
          </Button>
        </Group>
      </Group>
    </div>
  );
}
