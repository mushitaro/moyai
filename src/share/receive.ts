// 受け手の側（docs/plan.md §2.8「受け取りと 3 つの立場」）。純粋な関数。
// 立場で変わるのは、並べる場の組と、見え方の出どころ（自分の施設か、人が入れた入札の対象か）だけ。画面は 1 つ。
//   市町村：自分の施設の見え方 ↔ 公開の台帳
//   保全子会社：自分の施設の見え方 ↔ 自社の輪、公開の台帳
//   O&M：入札の対象の見え方 ↔ 公開の台帳、自社の輪
// 集計はサイトと同じ aggregate。場をまたいで混ぜない（場ごとに 1 回数え、札も場ごと）。
// 公開の台帳は全国の表に載る施設だけを受けるので、全国の表に載らない見え方では台帳の場を数えない。
// 似た施設が受ける側の見せる下限（3）に届かない場は、行を出さず、数と理由だけを返す。
import { aggregate, type Aggregate, type PeerBundle } from "./aggregate";
import type { StatField } from "./bands";
import { RECEIVE_MIN_K, type Group, type NationalTable, type Profile, type ProfileSpec } from "./k";

export const POSITIONS = ["municipal", "subsidiary", "om"] as const;
export type Position = (typeof POSITIONS)[number];

export const PLACE_KINDS = ["ledger", "ring"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

/** 立場ごとの、並べる場の順 */
export const POSITION_PLACES: Record<Position, readonly PlaceKind[]> = {
  municipal: ["ledger"],
  subsidiary: ["ring", "ledger"],
  om: ["ledger", "ring"],
};

/** 立場ごとの、見え方の出どころ（self：自分の施設、target：人が入れた入札の対象） */
export const PROFILE_FROM: Record<Position, "self" | "target"> = {
  municipal: "self",
  subsidiary: "self",
  om: "target",
};

/** 1 つの場の、確かめて ✓ になった束（鍵ごとに最新の 1 つ） */
export interface Place {
  kind: PlaceKind;
  /** 台帳 ID か輪 ID */
  id: string;
  peers: readonly PeerBundle[];
  /** その場での自分の鍵（保管先の計画がその場へ出す施設の鍵。docs/plan.md §2.19）。数えない */
  self: readonly string[];
  /** 場の決まりの帯の境目 */
  bands?: Partial<Record<StatField, readonly number[]>>;
}

/** 見え方の答え（検問所と同じ形。人が画面で選ぶ） */
export interface ProfileAnswers {
  facility: Record<string, string | null>;
  inNationalTable: boolean | null;
}

export type ProfileOf = { ok: true; profile: Profile } | { ok: false; reason: "groupUnknown" | "axisUnknown" | "axisUnanswered" };

/**
 * 受け手の見え方：人が選んだ軸（パックの見え方の軸のうち、全国の表に列があるもの）と、その答えのコード。
 * 軸を減らすほど似た施設は増え、足すほど減る。軸が 0 なら業種だけ（段 3）。段は残した軸の層から決める（ladder と同じ考え方）。
 */
export function receiverProfile(spec: ProfileSpec, table: NationalTable, a: ProfileAnswers, axes: readonly string[]): ProfileOf {
  if (a.inNationalTable === null) return { ok: false, reason: "groupUnknown" };
  const group: Group = a.inNationalTable ? "NATIONAL" : "OUTSIDE";
  const out: Record<string, string> = {};
  const tiers = new Set<string>();
  for (const key of axes) {
    const s = spec.axes.find((x) => x.key === key);
    if (!s || !table.axes.some((x) => x.key === key)) return { ok: false, reason: "axisUnknown" };
    const v = a.facility[key];
    if (v === null || v === undefined) return { ok: false, reason: "axisUnanswered" };
    out[key] = v;
    tiers.add(s.tier);
  }
  const stage = tiers.has("refine") ? 0 : tiers.has("secondary") ? 1 : tiers.size > 0 ? 2 : 3;
  return { ok: true, profile: { group, stage, axes: out } };
}

/** 画面が最初に選ぶ軸：主要の軸のうち、全国の表に列があり、答えのあるもの */
export function defaultAxes(spec: ProfileSpec, table: NationalTable, a: ProfileAnswers): string[] {
  return spec.axes
    .filter((x) => x.tier === "primary" && table.axes.some((t) => t.key === x.key) && a.facility[x.key] != null)
    .map((x) => x.key);
}

export type PlaceView =
  | { kind: PlaceKind; id: string; status: "shown"; agg: Aggregate }
  /** 似た施設が見せる下限（3）に届かない：行を出さない */
  | { kind: PlaceKind; id: string; status: "belowShow"; similar: number }
  /** 公開の台帳は全国の表に載る施設だけを受ける：全国の表に載らない見え方とは比べない */
  | { kind: PlaceKind; id: string; status: "outsideGroup" }
  /** その場がまだ無い（台帳の場所を選んでいない、輪に入っていない） */
  | { kind: PlaceKind; id: null; status: "missing" };

export interface Comparison {
  position: Position;
  profile: Profile;
  places: PlaceView[];
}

export interface CompareInput {
  table: NationalTable;
  position: Position;
  profile: Profile;
  /** 読めた場（立場に要らない場は無視する） */
  places: readonly Place[];
}

/** 立場の場の順に、場ごとの似た施設の集計を作る */
export function compare(i: CompareInput): Comparison {
  const out: PlaceView[] = [];
  for (const kind of POSITION_PLACES[i.position]) {
    const list = i.places.filter((p) => p.kind === kind).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    if (list.length === 0) {
      out.push({ kind, id: null, status: "missing" });
      continue;
    }
    for (const p of list) {
      if (kind === "ledger" && i.profile.group !== "NATIONAL") {
        out.push({ kind, id: p.id, status: "outsideGroup" });
        continue;
      }
      const agg = aggregate({ table: i.table, profile: i.profile, self: p.self, peers: p.peers, ...(p.bands ? { bands: p.bands } : {}) });
      if (agg.similar.length < RECEIVE_MIN_K) out.push({ kind, id: p.id, status: "belowShow", similar: agg.similar.length });
      else out.push({ kind, id: p.id, status: "shown", agg });
    }
  }
  return { position: i.position, profile: i.profile, places: out };
}
