// EXPORT の主ボタンを押したときの道（docs/screens.md 3.5）。押したときだけ、人だけの経路（callHuman）で順に呼ぶ。
// 署名のダイアログは置かない（運営者 2026-11-10「引き算」）：「署名して出力」を押すと、その 1 回で書き出しに署名して Excel を落とす。
// 呼び方を外から渡すので、試験で呼ぶ順を確かめられる（tests/unit/export-run.test.ts）。
import type { HumanAction } from "../../shared/routes";
import { ROUTES } from "../../shared/routes";
import type { TemplateColumns } from "../../plan/template";

/** 人だけの経路の 1 回（readHuman を通した結果） */
export type HumanCall = <T extends { ok: boolean }>(action: HumanAction, path: string, payload: unknown) => Promise<{ ok: true; body: T } | { ok: false; message: string }>;

export type ExportJob =
  | { action: "plan" | "report"; planId: string; version: number; fileName: string }
  /** 署名済みの書き出しを読む（sign は先に書き出しに署名する） */
  | { action: "read" | "sign"; planId: string; version: number; template: { name: string; version: string }; fileName: string }
  /** Claude の列対応と様式を保存先に置き（下書き）、その版で署名して書き出してから読む */
  | { action: "layout"; planId: string; version: number; name: string; base64: string; columns: TemplateColumns; fileName: string };

export type ExportRun =
  | { ok: true; base64: string; fileName: string; saved: { name: string; version: string } | null }
  | { ok: false; message: string; saved: { name: string; version: string } | null };

async function readExport(call: HumanCall, planId: string, version: number, template: { name: string; version: string }): Promise<{ ok: true; base64: string } | { ok: false; message: string }> {
  const r = await call<{ ok: boolean; base64: string }>("export_file_read", ROUTES.exportFileRead.path, { planId, version, name: template.name, templateVersion: template.version });
  return r.ok ? { ok: true, base64: r.body.base64 } : r;
}

async function signThenRead(call: HumanCall, planId: string, version: number, template: { name: string; version: string }) {
  const s = await call<{ ok: boolean }>("export_sign", ROUTES.exportSign.path, { planId, version, name: template.name, templateVersion: template.version });
  if (!s.ok) return s;
  return readExport(call, planId, version, template);
}

/** 主ボタンの 1 回。落とすファイルの中身（base64）と名前を返す（ブラウザに渡すのは画面） */
export async function runExport(job: ExportJob, call: HumanCall): Promise<ExportRun> {
  switch (job.action) {
    case "plan":
    case "report": {
      const r = await call<{ ok: boolean; base64: string }>("plan_file_read", ROUTES.planFileRead.path, { planId: job.planId, version: job.version, kind: job.action === "plan" ? "export" : "report" });
      return r.ok ? { ok: true, base64: r.body.base64, fileName: job.fileName, saved: null } : { ...r, saved: null };
    }
    case "read": {
      const r = await readExport(call, job.planId, job.version, job.template);
      return r.ok ? { ...r, fileName: job.fileName, saved: null } : { ...r, saved: null };
    }
    case "sign": {
      const r = await signThenRead(call, job.planId, job.version, job.template);
      return r.ok ? { ...r, fileName: job.fileName, saved: null } : { ...r, saved: null };
    }
    case "layout": {
      // 同じ中身なら保存先は書き直さない（橋渡しの template_save）。置いた版で署名するので、承認されるのは画面で見た列対応
      const s = await call<{ ok: boolean; name: string; version: string }>("template_save", ROUTES.templateSave.path, { name: job.name, base64: job.base64, columns: job.columns, from: null });
      if (!s.ok) return { ...s, saved: null };
      const saved = { name: s.body.name, version: s.body.version };
      const r = await signThenRead(call, job.planId, job.version, saved);
      return r.ok ? { ...r, fileName: job.fileName, saved } : { ...r, saved };
    }
  }
}
