// 試験だけの道具：サンプルの工場の正解（samples/truth/.../world.json と資料ごとの正解）から、計画の書類を組む。
// 取り込み（src/import/）の代わりではない。星取表の画面と試験に、厚みのある架空の計画を渡すためだけに使う。
// 出どころ（資料・シート・セル・頁）は crossdoc.truth.json の行をそのまま写す。
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../", import.meta.url);
const read = (rel) => JSON.parse(readFileSync(new URL(rel, ROOT), "utf8"));

/** 施設ごとの、試験の道具としての決めごと（正解には無いもの） */
export const FIXTURES = {
  "fictional-1": {
    levelNames: ["設備", "機器", "部位"],
    // AI が当てはめの案を置いたが、人がまだ受けていない機器（未当てはめの行を見せるため）
    pending: ["E24", "E25"],
  },
  "fictional-2": {
    levelNames: ["設備", "系統", "機器群", "機器"],
    pending: ["E16"],
  },
};

const STATUS = { actual: "actual", planned: "plan", planned_unrecorded: "plan" };

function sourceOf(ref) {
  const doc = ref.doc;
  if (doc.endsWith(".xlsx")) return { file: doc, sheet: ref.sheet ?? null, page: null, cell: ref.cell ?? null, box: null };
  if (doc.endsWith(".pdf")) return { file: doc, sheet: null, page: ref.page ?? null, cell: null, box: null };
  if (doc.endsWith(".csv")) return { file: doc, sheet: null, page: null, cell: ref.line !== undefined ? `A${ref.line}` : null, box: null };
  return { file: doc, sheet: null, page: ref.page ?? null, cell: null, box: null };
}

/**
 * @param {"fictional-1"|"fictional-2"} id
 * @param {{ scale?: number }} [opts] scale は機器を n 倍に増やす（重さの試しだけに使う）
 */
export function truthToPlan(id, opts = {}) {
  const scale = Math.max(1, Math.floor(opts.scale ?? 1));
  const fx = FIXTURES[id];
  if (!fx) throw new Error(`知らない施設：${id}`);
  const base = `samples/truth/waste-incineration/${id}/`;
  const world = read(`${base}world.json`);
  const ledger = read(`${base}equipment-ledger.truth.json`);
  const crossdoc = read(`${base}crossdoc.truth.json`);
  const equipment = new Map(world.equipment.map((e) => [e.id, e]));
  const refsOf = new Map(crossdoc.works.map((w) => [w.work_id, w.refs]));
  const contractors = new Map((world.rules.contractors ?? []).map((c) => [c.id, c.name]));
  const ledgerSource = (row) => ({ file: ledger.file, sheet: ledger.sheet, page: null, cell: `A${row}`, box: null });

  const assets = [];
  const works = [];
  const details = [];
  const stack = []; // 段ごとの直近の節の鍵
  const partCount = new Map(); // 機器の鍵 → 部位の数

  const pushEquipment = (row, e, parentKey, copy) => {
    const sfx = copy === 1 ? "" : `-${copy}`;
    const name = copy === 1 ? e.name : `${e.name}（${copy}）`;
    const key = `${e.id}${sfx}`;
    const pending = fx.pending.includes(e.id);
    assets.push({
      nodeKey: key,
      tag: e.tag,
      name,
      level: row.level,
      parentKey,
      classCode: null,
      commonItem: world.equipment_to_code[e.id] ?? null,
      commonItemAuthor: "ai",
      commonItemBasis: "工場の正解から（試験の道具）",
      commonItemAccepted: !pending,
      specs: e.spec.map((v, i) => ({ key: `spec${i + 1}`, value: v })),
      installedOn: e.install_year ? `${e.install_year}-04-01` : null,
      removedOn: null,
      replacedOn: null,
      series: e.furnace_label ?? null,
      sources: [ledgerSource(row.row)],
    });
    for (const w of world.works.filter((x) => x.equipment_id === e.id)) {
      const workKey = `${w.id}${sfx}`;
      works.push({
        workKey,
        kind: w.label,
        attribute: w.attr ?? null,
        attributeAuthor: w.attr ? "ai" : null,
        attributeBasis: w.attr ? "工場の正解から（試験の道具）" : null,
        attributeAccepted: !!w.attr,
        strategy: null,
        targets: [key],
        trigger: null,
        checkIds: [],
        contractor: w.contractor ? (contractors.get(w.contractor) ?? null) : null,
        parentWorkKey: null,
        tagRange: null,
        tagList: [],
      });
      const refs = refsOf.get(w.id) ?? [];
      const sources = refs.length > 0 ? refs.map(sourceOf) : [ledgerSource(row.row)];
      details.push({
        detailKey: `${workKey}.1`,
        workKey,
        planOrActual: STATUS[w.status],
        step: null,
        startDate: w.start ?? null,
        endDate: w.end ?? null,
        fiscalYear: w.fiscal_year,
        cost: null,
        manDays: w.man_days ?? null,
        days: w.duration_days ?? null,
        resultScale: null,
        resultValue: null,
        measuredValue: null,
        previousValue: null,
        performer: null,
        sources,
        basis: "工場の正解から（試験の道具）",
        author: "ai_reading",
        needsReview: false,
      });
    }
    return key;
  };

  for (const row of ledger.rows) {
    const parentKey = row.level > 1 ? (stack[row.level - 2] ?? null) : null;
    if (row.kind === "group") {
      const key = `G${row.row}`;
      assets.push({
        nodeKey: key,
        tag: null,
        name: row.name_text,
        level: row.level,
        parentKey,
        classCode: null,
        commonItem: null,
        commonItemAuthor: null,
        commonItemBasis: null,
        commonItemAccepted: false,
        specs: [],
        installedOn: null,
        removedOn: null,
        replacedOn: null,
        series: null,
        sources: [ledgerSource(row.row)],
      });
      stack[row.level - 1] = key;
      stack.length = row.level;
    } else if (row.kind === "equipment") {
      const e = equipment.get(row.equipment_id);
      if (!e) throw new Error(`台帳の機器が正解に無い：${row.equipment_id}`);
      for (let copy = 1; copy <= scale; copy++) {
        const key = pushEquipment(row, e, parentKey, copy);
        if (copy === 1) {
          stack[row.level - 1] = key;
          stack.length = row.level;
        }
      }
    } else if (row.kind === "part") {
      const owner = stack[row.level - 2];
      const n = (partCount.get(owner) ?? 0) + 1;
      partCount.set(owner, n);
      for (let copy = 1; copy <= scale; copy++) {
        const ownerKey = copy === 1 ? owner : `${owner}-${copy}`;
        assets.push({
          nodeKey: `${ownerKey}.P${n}`,
          tag: null,
          name: row.name_text,
          level: row.level,
          parentKey: ownerKey,
          classCode: null,
          commonItem: null,
          commonItemAuthor: null,
          commonItemBasis: null,
          commonItemAccepted: false,
          specs: (row.spec_text ?? "").split("\n").filter(Boolean).map((v, i) => ({ key: `spec${i + 1}`, value: v })),
          installedOn: null,
          removedOn: null,
          replacedOn: null,
          series: null,
          sources: [ledgerSource(row.row)],
        });
      }
    }
  }

  const levels = Math.max(...assets.map((a) => a.level));
  return {
    schema: "moyai.plan/0",
    planId: scale === 1 ? `fixture-${id}` : `fixture-${id}-x${scale}`,
    displayName: scale === 1 ? world.facility.name : `${world.facility.name}（厚さの試し ×${scale}）`,
    packId: world.facility.pack,
    version: 0,
    levelNames: fx.levelNames.slice(0, levels),
    facility: {
      facilityKey: world.facility.id,
      name: world.facility.name,
      fiscalYearStartMonth: 4,
      scale: null,
      scaleUnit: null,
      legalFlags: [],
      fictional: world.fictional === true,
      inNationalTable: null,
    },
    assets,
    works,
    details,
  };
}

/** 画面が読む試しの計画の名前と作り方 */
export const DEV_PLANS = {
  "fictional-1": () => truthToPlan("fictional-1"),
  "fictional-2": () => truthToPlan("fictional-2"),
  // 厚い計画の重さを測る見本：機器 1,000 余り（fictional-1 を計画 §2.5 の厚さ〔機器 217〕にしたので 5 倍。前は 25 の 40 倍）
  "fictional-1-x5": () => truthToPlan("fictional-1", { scale: 5 }),
};

export const DEV_PLAN_DIR = join("dist", "app", "assets", "dev-plans");
