// EXPORT（docs/screens.md 3.5）：確定した版から、人が見る様式の Excel（MOYAI の標準）を落とす。差分レポートも副のボタンで落とす。
// Excel は確定のときに橋渡しが保管先に書いたもの（plans/<計画ID>/exports・reports）で、人だけの経路 plan_file_read で読んでブラウザに落とす。
// 署名と鎖が合わない版の Excel は渡さない。「別の様式を落とす」で、利用者の様式に写した Excel も落とせる（components/TemplateExport.tsx）。
import { Alert, Button, Group, Stack, Table, Text } from "@mantine/core";
import { useMemo, useState } from "react";
import { buildChart } from "../../plan/chart";
import type { Plan } from "../../shared/plan";
import { ROUTES } from "../../shared/routes";
import { catalogFor, emptyCatalog } from "../chart/catalog";
import { formatCell } from "../chart/grid";
import { FictionMark } from "../components/FictionMark";
import { TemplateExport, downloadTemplate, type LoadedTemplate } from "../components/TemplateExport";
import { readHuman, usePlanStatus } from "../components/ConfirmDialog";
import { useConnection } from "../state/bridge";
import { useWorkingPlan } from "../state/plan-store";
import { sheetHash } from "../stages";
import { TEXT } from "../text";

const T = TEXT.export;
const C = TEXT.chart;
const SAMPLE_ROWS = 12;
const SAMPLE_YEARS = 6;

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
  const [load] = usePlanStatus(client, planId, !!working && state.kind === "open");
  const [busy, setBusy] = useState<"export" | "report" | null>(null);
  // 利用者が落とした様式（選んでいれば、「Excel を落とす」はこの様式に写す）
  const [template, setTemplate] = useState<LoadedTemplate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const status = load.kind === "ready" ? load.status : null;
  const latest = status?.latest ?? null;
  const info = status?.versions?.find((v) => v.version === latest?.version) ?? null;
  const broken = !!info && info.problem !== null;
  const blocked = state.kind !== "open" ? T.notConnected : !working ? T.noPlan : status && !latest ? T.notConfirmed : broken ? T.broken : null;

  const get = async (kind: "export" | "report") => {
    if (!latest || blocked) return;
    if (kind === "export" && template) {
      setBusy(kind);
      await downloadTemplate(template, latest.plan, latest.version);
      setBusy(null);
      return;
    }
    setBusy(kind);
    setError(null);
    const r = readHuman<{ ok: boolean; reason?: string; base64: string }>(await client.callHuman("plan_file_read", ROUTES.planFileRead.path, { planId, version: latest.version, kind }));
    setBusy(null);
    if (!r.ok) return setError(r.message);
    download(r.body.base64, kind === "export" ? T.fileName(latest.plan.displayName, latest.version) : T.reportName(latest.plan.displayName, latest.version));
  };

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
          {/* 様式の行（MOYAI の標準か、利用者が落とした様式）。様式を選んでいるときは、その様式に写した見本 */}
          {latest && <TemplateExport plan={latest.plan} template={template} onTemplate={setTemplate} />}
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
          {latest && !template && <Sample plan={latest.plan} />}
        </Stack>
      </div>
      {/* 下の帯：左に何から作るか、右端に主ボタン 1 つ（いま選んでいる様式で落とす）と、その左に差分レポート */}
      <Group justify="space-between" px={32} py="xs" wrap="nowrap" gap="md" className="moyai-merge-bar">
        <Text size="xs" c="dimmed">
          {latest ? T.fromVersion(latest.version) : ""}
        </Text>
        <Group gap="sm" wrap="nowrap">
          {blocked && (
            <Text size="xs" c="dimmed" data-testid="export-blocked">
              {blocked}
            </Text>
          )}
          <Button variant="default" onClick={() => void get("report")} disabled={!!blocked || !latest} loading={busy === "report"} data-testid="export-report">
            {T.report}
          </Button>
          <Button onClick={() => void get("export")} disabled={!!blocked || !latest} loading={busy === "export"} data-testid="export-excel">
            {T.excel}
          </Button>
        </Group>
      </Group>
    </div>
  );
}
