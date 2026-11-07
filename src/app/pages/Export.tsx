// EXPORT（docs/screens.md 3.5）：確定した版から、人が見る様式の Excel（MOYAI の標準）を落とす。差分レポートも副のボタンで落とす。
// Excel は確定のときに橋渡しが保管先に書いたもの（plans/<計画ID>/exports・reports）で、人だけの経路 plan_file_read で読んでブラウザに落とす。
// 署名と鎖が合わない版の Excel は渡さない。保存先の様式で書き出すときは、書き出した Excel に人が署名する（3C。components/TemplateExport.tsx）：
// 主ボタンは 1 つで、まだ書き出していない様式なら「署名して書き出す」、書き出し済みなら「Excel を落とす」（Wire、Export.dc.html V48・V50）。
// 写し方の案（template-layout-v1）：Claude が入れた様式と置いた案は画面の中だけにあり（state/template-draft.ts）、見本を確かめた人が
// 「この写し方で出力」を押したときだけ、写し方と様式を保存先に置き（template_save）、確定した版（無ければ作業中の版）を案のとおりに書いて落とす。
import { Alert, Button, Group, Modal, Stack, Table, Text } from "@mantine/core";
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
import { writeTemplate } from "../../plan/template-layout";
import type { TemplateLayout } from "../../shared/template-layout";
import { patchedExcelJS } from "../../import/exceljs-setup";
import { discardLayout, markSaved, offerTemplate, pendingTemplates, takeSelectRequest, useTemplateDrafts } from "../state/template-draft";
import { getReferenceDate } from "../state/review";
import { readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { sheetHash } from "../stages";
import { TEXT } from "../text";
import { dueBaseDate } from "../../plan/due-view";

const T = TEXT.export;
const C = TEXT.chart;
const L = TEXT.export.template.layout;
const SAMPLE_ROWS = 12;
const SAMPLE_YEARS = 6;

const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (c) => String.fromCharCode(c)).join(""));

/** 写し方の案を、保存先に置く写し方（columns.json）にする。見出しの字は案の最初の計画の表の見出しの下の行（列の役目は使わないので未定） */
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

export function Export() {
  const { client, state } = useConnection();
  const working = useWorkingPlan();
  const planId = working?.plan.planId ?? "";
  const [load, reload] = usePlanStatus(client, planId, !!working && state.kind === "open");
  const [busy, setBusy] = useState<"export" | "report" | "sign" | "layout" | null>(null);
  // Claude が入れて、まだ保存していない様式を選んでいるとき（その名前）。選んでいれば selected は null
  const [pendingSel, setPendingSel] = useState<string | null>(null);
  const drafts = useTemplateDrafts();
  // 保存先の様式（null は標準）
  const [templates, setTemplates] = useState<SharedTemplate[]>([]);
  const [selected, setSelected] = useState<SharedTemplate | null>(null);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const status = load.kind === "ready" ? load.status : null;
  const latest = status?.latest ?? null;
  const info = status?.versions?.find((v) => v.version === latest?.version) ?? null;
  const broken = !!info && info.problem !== null;
  const returned = !!info && info.signatures.some((x) => x.role === "return");
  const approved = !!info && info.signatures.some((x) => x.role === "approve");
  const blocked = state.kind !== "open" ? T.notConnected : !working ? T.noPlan : status && !latest ? T.notConfirmed : broken ? T.broken : null;

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

  // Claude が様式を入れた・案を置いたら、その様式を選ぶ（画面は AI の作業を追う）
  useEffect(() => {
    const want = takeSelectRequest();
    if (!want) return;
    if (pendingTemplates(drafts).some((k) => k.name === want)) {
      setPendingSel(want);
      setSelected(null);
      return;
    }
    const t = templates.find((x) => x.name === want && x.current);
    if (t) {
      setSelected(t);
      setPendingSel(null);
    }
  }, [drafts, templates]);

  // 保存先の様式を選んだら、様式のファイルを読む（案の見本を様式の見た目のまま描くため。Claude が保存先の様式に案を置くときにも使う）
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
        // 読めない様式は見本を出さない（列の役目の表は出る）
      }
    })();
    return () => {
      alive = false;
    };
  }, [selected, client, state.kind, drafts.known]);

  // 様式と写し方を保存先に置く（下書き）。base64 が空なら、from の版の様式のファイルを使い、写し方だけを直す
  const save = async (name: string, base64: string, columns: TemplateColumns, from: string | null): Promise<string | null> => {
    const r = readHuman<{ ok: boolean; name: string; version: string }>(await client.callHuman("template_save", ROUTES.templateSave.path, { name, base64, columns, from }));
    if (!r.ok) return r.message;
    await loadTemplates({ name: r.body.name, version: r.body.version });
    return null;
  };
  const onDrop = async (f: File) => {
    const t = await readTemplate(f);
    if (!t.ok) return t.message;
    return save(t.name, btoa(Array.from(new Uint8Array(t.bytes), (c) => String.fromCharCode(c)).join("")), t.columns, null);
  };
  // 列の役目を直すと、同じ名前の下書きになる（承認済みのほうは消えない。Wire）
  const onRoles = (t: SharedTemplate, columns: TemplateColumns) => {
    void save(t.name, "", columns, t.version).then((m) => m && setError(m));
  };

  const get = async (kind: "export" | "report") => {
    if (!latest || blocked) return;
    setBusy(kind);
    setError(null);
    if (kind === "export" && selected) {
      const r = readHuman<{ ok: boolean; base64: string }>(await client.callHuman("export_file_read", ROUTES.exportFileRead.path, { planId, version: latest.version, name: selected.name, templateVersion: selected.version }));
      setBusy(null);
      if (!r.ok) return setError(r.message);
      // 承認待ちのあいだに落としたファイルは、名前の末尾で分かるようにする（セルには何も足さない。Wire）
      return download(r.body.base64, T.template.fileName(selected.name, latest.plan.displayName, latest.version, pendingWho ? T.template.pendingSuffix : ""));
    }
    const r = readHuman<{ ok: boolean; reason?: string; base64: string }>(await client.callHuman("plan_file_read", ROUTES.planFileRead.path, { planId, version: latest.version, kind }));
    setBusy(null);
    if (!r.ok) return setError(r.message);
    download(r.body.base64, kind === "export" ? T.fileName(latest.plan.displayName, latest.version) : T.reportName(latest.plan.displayName, latest.version));
  };
  const sign = async () => {
    if (!latest || !selected) return;
    setBusy("sign");
    setError(null);
    const r = readHuman<{ ok: boolean }>(await client.callHuman("export_sign", ROUTES.exportSign.path, { planId, version: latest.version, name: selected.name, templateVersion: selected.version }));
    setBusy(null);
    setSigning(false);
    if (!r.ok) return setError(r.message);
    setDone(T.template.signed(latest.version, selected.name));
    reload();
    await loadTemplates();
  };

  // 写し方の案：選んだ様式（Claude が入れたものを先に）・案（下書きか保存した写し方）・書く版
  const pendingT = pendingSel ? (drafts.known.find((k) => k.saved === null && k.name === pendingSel) ?? null) : null;
  const savedT = selected ? (drafts.known.find((k) => k.name === selected.name && k.saved?.version === selected.version) ?? null) : null;
  const selName = pendingSel ?? selected?.name ?? null;
  const draftOf = selName ? (drafts.drafts.get(selName) ?? null) : null;
  // 案は、同じ名前の未保存の様式があればそちらのもの
  const draft = draftOf && (pendingSel !== null || !pendingTemplates(drafts).some((k) => k.name === selName)) ? draftOf : null;
  const layout: TemplateLayout | null = draft?.layout ?? selected?.columns.layout ?? null;
  const layoutBytes = pendingT?.bytes ?? savedT?.bytes ?? null;
  const target = latest?.plan ?? working?.plan ?? null;
  const targetAsOf = latest && info ? dueBaseDate(info.at) : getReferenceDate();
  const catalog = useMemo(() => (target ? (catalogFor(target.packId) ?? emptyCatalog()) : emptyCatalog()), [target]);
  // 「この写し方で出力」：案（下書き）か未保存の様式を選んでいるとき、確定した版の無い保存した写し方のとき
  const layoutButton = pendingSel !== null || (!!layout && (!!draft || !latest));
  const layoutBlocked = state.kind !== "open" ? T.notConnected : !target ? T.noPlan : !layout ? L.noLayoutReason : latest && broken ? T.broken : null;
  const outputLayout = async () => {
    if (!selName || !layout || !layoutBytes || !target || layoutBlocked) return;
    const probe = (pendingT ?? savedT)?.probe;
    if (!probe) return;
    setBusy("layout");
    setError(null);
    setDone(null);
    try {
      const columns = layoutColumns(probe, layout);
      const out = await writeTemplate(new (patchedExcelJS().Workbook)(), layoutBytes, columns, { plan: target, catalog, asOf: targetAsOf });
      // 写し方と様式を保存先に置く（同じ中身なら書き直さない。下書きで、署名して書き出したときに承認される）
      const r = readHuman<{ ok: boolean; name: string; version: string }>(await client.callHuman("template_save", ROUTES.templateSave.path, { name: selName, base64: toBase64(layoutBytes), columns, from: null }));
      download(toBase64(out.bytes), latest ? T.template.fileName(selName, target.displayName, latest.version) : L.workingFileName(selName, target.displayName));
      if (r.ok) {
        markSaved(selName, r.body.version);
        setPendingSel(null);
        await loadTemplates({ name: r.body.name, version: r.body.version });
        setDone(L.done(selName));
      } else {
        setError(r.message);
        setDone(L.doneUnsaved(selName));
      }
    } catch (e) {
      setError(L.invalid(e instanceof Error ? e.message.split("\n")[0]! : String(e)));
    } finally {
      setBusy(null);
    }
  };
  const layoutView =
    pendingSel !== null || (selected && (layout || draft)) ? (
      layout && layoutBytes && target ? (
        <TemplateLayoutPreview bytes={layoutBytes} layout={layout} plan={target} catalog={catalog} asOf={targetAsOf} draft={!!draft} basis={latest ? L.basisConfirmed(latest.version) : L.basisWorking} />
      ) : (
        <Text size="sm" c="dimmed" data-testid="layout-empty">
          {!layout ? L.noLayout : !target ? T.noPlan : L.reading}
        </Text>
      )
    ) : null;

  const toSign = !!selected && !selected.exported;
  const signBlocked = toSign && returned ? T.template.returned : null;
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

  return (
    <div className="moyai-share-page" data-testid="export-page">
      <div className="moyai-share-body">
        {/* 段の名前はヘッダが大きく出すので、見出しは施設の名前と版の 1 行だけ（MERGE と同じ形） */}
        <div className="moyai-page-head" data-testid="export-plan">
          {latest && (
            <>
              <h1 className="moyai-merge-name">{latest.plan.displayName}</h1>
              <span className="moyai-merge-ver">{T.version(latest.version)}</span>
            </>
          )}
          {latest?.plan.facility.fictional && <FictionMark />}
        </div>
        <Stack gap="md">
          {target && (
            <TemplateExport
              plan={target}
              asOf={targetAsOf}
              templates={templates}
              selected={selected}
              onSelect={(t) => {
                setSelected(t);
                setPendingSel(null);
              }}
              onDrop={onDrop}
              onRoles={onRoles}
              standardExported={!!latest && !broken}
              pending={pendingTemplates(drafts).map((k) => ({ name: k.name, hasDraft: drafts.drafts.has(k.name) }))}
              pendingSel={pendingSel}
              onSelectPending={(name) => {
                setPendingSel(name);
                setSelected(null);
              }}
              draftNames={new Set([...drafts.drafts.keys()].filter((n) => !pendingTemplates(drafts).some((k) => k.name === n)))}
              layoutView={layoutView}
            />
          )}
          {error && (
            <Alert color="gray" data-testid="export-error">
              {error}
            </Alert>
          )}
          {done && (
            <Text size="sm" data-testid="export-signed">
              {done}
            </Text>
          )}
          {!working && (
            <Text size="sm">
              {T.noPlan} <a href={sheetHash("files")}>{T.toMerge}</a>
            </Text>
          )}
          {latest && !selected && pendingSel === null && <Sample plan={latest.plan} />}
        </Stack>
      </div>
      {/* 下の帯：右端に主ボタン 1 つ（標準と書き出し済みの様式は「Excel を落とす」、まだ書き出していない様式は「署名して書き出す」）、その左に差分レポート。
          さらに左に、押せない理由・承認待ちの 1 行・鍵の警告（2 行のときは承認待ちが上） */}
      <Group justify="flex-end" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar">
        <Stack gap={2} align="flex-end">
          {layoutButton && layoutBlocked && (
            <Text size="xs" c="dimmed" data-testid="export-blocked">
              {layoutBlocked}
            </Text>
          )}
          {!layoutButton && (blocked || signBlocked) && (
            <Text size="xs" c="dimmed" data-testid="export-blocked">
              {blocked ?? signBlocked}
            </Text>
          )}
          {!blocked && selected && !toSign && pendingWho && (
            <Text size="xs" c="var(--text)" data-testid="export-pending">
              {T.template.pending(pendingWho)}
            </Text>
          )}
          {!blocked && exportSigners.length > 0 && <KeyWarnLine signers={exportSigners} onConfirmed={() => reload()} />}
        </Stack>
        <Group gap="sm" wrap="nowrap">
          <Button variant="default" onClick={() => void get("report")} disabled={!!blocked || !latest} loading={busy === "report"} data-testid="export-report">
            {T.report}
          </Button>
          {draft && selName && (
            <Button variant="default" onClick={() => discardLayout(selName)} data-testid="layout-discard">
              {L.discard}
            </Button>
          )}
          {layoutButton ? (
            <Button onClick={() => void outputLayout()} disabled={!!layoutBlocked || !layoutBytes} loading={busy === "layout"} data-testid="layout-output">
              {L.output}
            </Button>
          ) : toSign ? (
            <Button onClick={() => setSigning(true)} disabled={!!blocked || !!signBlocked || !latest} loading={busy === "sign"} data-testid="export-sign">
              {T.template.sign}
            </Button>
          ) : (
            <Button onClick={() => void get("export")} disabled={!!blocked || !latest} loading={busy === "export"} data-testid="export-excel">
              {T.excel}
            </Button>
          )}
        </Group>
      </Group>
      {latest && selected && (
        <Modal opened={signing} onClose={() => setSigning(false)} title={T.template.dialogTitle(selected.name)} centered size={560} data-testid="export-sign-dialog">
          <Stack gap="sm">
            {!selected.approval && (
              <div>
                <Text size="sm">{T.template.approveLine(1)}</Text>
                <Group justify="space-between" wrap="nowrap" mt={6} pt={6} style={{ borderTop: "1px solid var(--line)" }} data-testid="export-sign-approve-row">
                  <Text size="sm">{T.template.approveRow(selected.name)}</Text>
                  <Text size="xs" c="var(--text-3)">
                    - {T.template.draft}
                  </Text>
                </Group>
              </div>
            )}
            <Group justify="flex-end" gap="sm">
              <Button variant="default" onClick={() => setSigning(false)}>
                {T.template.cancel}
              </Button>
              <Button onClick={() => void sign()} loading={busy === "sign"} data-testid="export-sign-submit">
                {T.template.sign}
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </div>
  );
}
