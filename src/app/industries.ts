// 【業種】の画面が読む設備の地図：packs/*/pack.json を並べて読み、形で確かめ、packs/_kinds/groups.json の群に並べる（docs/plan.md §2.7）。
import groupsJson from "../../packs/_kinds/groups.json";
import { buildIndustryMap, type IndustryMap } from "../shared/pack";

const packJsons = import.meta.glob<unknown>("../../packs/*/pack.json", { eager: true, import: "default" });

let cached: IndustryMap | null = null;
export function industryMap(): IndustryMap {
  if (cached) return cached;
  const packs = Object.entries(packJsons).flatMap(([path, json]) => {
    const m = /packs\/([^/]+)\/pack\.json$/.exec(path);
    return m?.[1] ? [{ folder: m[1], json }] : [];
  });
  return (cached = buildIndustryMap(packs, groupsJson));
}
