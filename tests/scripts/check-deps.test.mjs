import { test } from "node:test";
import assert from "node:assert/strict";
import { findForbidden } from "../../scripts/check-deps.mjs";

test("Enterprise が入っていれば当たる（入れ子の依存も）", () => {
  const lock = { packages: { "": {}, "node_modules/ag-grid-community": {}, "node_modules/x/node_modules/ag-grid-enterprise": {}, "node_modules/@ag-grid-enterprise/core": {} } };
  assert.deepEqual(findForbidden(lock), ["ag-grid-enterprise", "@ag-grid-enterprise/core"]);
});

test("別名で入れた Enterprise も当たる", () => {
  const lock = { packages: { "": {}, "node_modules/grid": { name: "ag-grid-enterprise", version: "36.2.0" } } };
  assert.deepEqual(findForbidden(lock), ["ag-grid-enterprise"]);
});

test("Community だけなら当たらない", () => {
  assert.deepEqual(findForbidden({ packages: { "": {}, "node_modules/ag-grid-community": {}, "node_modules/ag-grid-react": {} } }), []);
});
