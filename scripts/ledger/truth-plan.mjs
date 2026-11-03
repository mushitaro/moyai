// 台帳のデモの道具：サンプルの工場の正解の世界（world.json）から、計画の書類を直接書く（docs/plan.md §2.5）。
// 取り込み（src/import/）を通さない。取り込みを通すのは fictional-1・fictional-2 の 2 施設だけで、
// 公開の台帳の架空の施設は、この道具が正解の世界から直接書いた計画を使う。
// 書き方は資料と同じ粒度にする：まとめ工事の型（world の bundle が true）は、同じ型・同じ号炉・同じ日の作業を 1 つの作業にまとめ
// （対象は複数の機器、工数は足し合わせ）、写し取りがまとめ工事として工数と日数を使わないようにする（分けない、推測で割らない）。
// 当てはめと作業の属性は、正解の世界の分類と属性をそのまま置き、作者は「決まり（コード）」にする（架空の施設に人はいない）。

const AUTHOR = "rule_code";
const BASIS = "工場の正解の世界から直接書いた計画（架空の施設。試験の道具）";

/**
 * @param {any} world  samples/truth/<pack>/<施設>/world.json の中身
 * @param {{ scale?: number | null, scaleUnit?: string | null }} [o]  施設の規模（world.facility に無ければ null）
 */
export function planFromWorld(world, o = {}) {
  if (world?.schema !== "moyai.factory.world/0" || world.fictional !== true) throw new Error("工場の正解の世界の形でない（架空の印が無い）");
  // 出どころは正解の世界（資料ではない）。名前に英数の語を入れない（束のファイル名の json と、固有名詞の網で当たるため）
  const source = { file: "【架空】工場の正解の世界", sheet: null, page: null, cell: null, box: null };
  const contractors = new Map((world.rules?.contractors ?? []).map((c) => [c.id, c.name]));
  const systems = new Map();
  const assets = [];
  for (const e of world.equipment) {
    if (!systems.has(e.system_key)) {
      const key = `S-${e.system_key}`;
      systems.set(e.system_key, key);
      assets.push({
        nodeKey: key,
        tag: null,
        name: e.system,
        level: 1,
        parentKey: null,
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
        sources: [source],
      });
    }
    assets.push({
      nodeKey: e.id,
      tag: e.tag ?? null,
      name: e.name,
      level: 2,
      parentKey: systems.get(e.system_key),
      classCode: null,
      commonItem: world.equipment_to_code[e.id] ?? null,
      commonItemAuthor: AUTHOR,
      commonItemBasis: BASIS,
      commonItemAccepted: world.equipment_to_code[e.id] != null,
      specs: (e.spec ?? []).map((v, i) => ({ key: `spec${i + 1}`, value: v })),
      // 正解の世界の設置は年だけ（台帳の資料と同じ）。月を足さない
      installedOn: e.install_year != null ? String(e.install_year) : null,
      removedOn: null,
      replacedOn: null,
      series: e.furnace === null ? null : e.furnace_label,
      sources: [source],
    });
  }

  const eq = new Map(world.equipment.map((e) => [e.id, e]));
  /** @type {Map<string, any[]>} */
  const groups = new Map();
  for (const w of world.works) {
    const e = eq.get(w.equipment_id);
    if (!e) throw new Error(`作業の機器が正解の世界に無い：${w.id}`);
    // 実績の無い予定（欠け）は、資料の実績のまとめ工事に入らないので、状態でも分ける
    const key = w.bundle ? `${w.pattern}|${e.furnace ?? "c"}|${w.start}|${w.status}` : w.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  const works = [];
  const details = [];
  for (const [key, ws] of groups) {
    const head = ws[0];
    const workKey = `W-${key.replace(/\|/g, "-")}`;
    const status = new Set(ws.map((w) => w.status));
    if (status.size !== 1) throw new Error(`まとめた作業の状態がそろわない：${key}`);
    works.push({
      workKey,
      kind: head.label,
      attribute: head.attr ?? null,
      attributeAuthor: head.attr ? AUTHOR : null,
      attributeBasis: head.attr ? BASIS : null,
      attributeAccepted: Boolean(head.attr),
      strategy: null,
      targets: ws.map((w) => w.equipment_id),
      trigger: null,
      checkIds: [],
      contractor: head.contractor ? (contractors.get(head.contractor) ?? null) : null,
      parentWorkKey: null,
      tagRange: null,
      tagList: [],
    });
    details.push({
      detailKey: `${workKey}.1`,
      workKey,
      planOrActual: head.status === "actual" ? "actual" : "plan",
      step: null,
      startDate: head.start ?? null,
      endDate: head.end ?? null,
      fiscalYear: head.fiscal_year,
      cost: null,
      manDays: ws.every((w) => typeof w.man_days === "number") ? ws.reduce((s, w) => s + w.man_days, 0) : null,
      days: typeof head.duration_days === "number" ? head.duration_days : null,
      resultScale: null,
      resultValue: null,
      measuredValue: null,
      previousValue: null,
      performer: null,
      sources: [source],
      basis: BASIS,
      author: AUTHOR,
      needsReview: false,
    });
  }

  return {
    schema: "moyai.plan/0",
    planId: `world-${world.facility.id}`,
    displayName: world.facility.name,
    packId: world.facility.pack,
    version: 0,
    levelNames: ["設備", "機器"],
    facility: {
      facilityKey: world.facility.id,
      name: world.facility.name,
      fiscalYearStartMonth: 4,
      scale: o.scale ?? null,
      scaleUnit: o.scaleUnit ?? null,
      legalFlags: [],
      fictional: true,
      inNationalTable: true,
    },
    assets,
    works,
    details,
  };
}
