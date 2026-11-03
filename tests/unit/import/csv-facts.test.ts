// CSV の ① の物差し（measureCsvFacts）が、違う文字・無い欄・余分な欄を数えること（物差しが空回りしていないこと）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readSource } from "../../../src/import";
import type { SourceFile } from "../../../src/import/grid";
import { measureCsvFacts } from "./truth";

const DIR = "samples/out/waste-incineration/fictional-1/";
const FACTS = "samples/facts/waste-incineration/fictional-1/daily-report.facts.json";

describe("CSV の ①（別の読み手との比べ）", () => {
  it("工場の日報は 0。1 欄を変える・消す・足すと数える", async () => {
    const r = await readSource({ name: "daily-report.csv", bytes: new Uint8Array(readFileSync(DIR + "daily-report.csv")) });
    const src = r.source as SourceFile;
    const facts = JSON.parse(readFileSync(FACTS, "utf8"));
    expect(facts.records.length).toBeGreaterThan(400);
    expect(measureCsvFacts(src, facts).diffs).toBe(0);

    const changed = structuredClone(facts);
    const rec = changed.records.find((x: { fields: string[] }) => x.fields.length > 3);
    rec.fields[1] = `${rec.fields[1]}x`;
    expect(measureCsvFacts(src, changed).detail).toEqual([`${rec.line} 行 2 欄の文字が違う`]);

    const extra = structuredClone(facts);
    extra.records.push({ line: 9999, fields: ["余分"] });
    expect(measureCsvFacts(src, extra).detail).toEqual(["9999 行 1 欄が無い"]);

    const fewer = structuredClone(facts);
    const last = fewer.records.findLast((x: { fields: string[] }) => x.fields.some((f: string) => f !== ""));
    const i = last.fields.findIndex((f: string) => f !== "");
    last.fields[i] = "";
    expect(measureCsvFacts(src, fewer).detail).toEqual([`${last.line} 行 ${i + 1} 欄が余分`]);
  });
});
