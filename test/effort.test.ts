import { test } from "node:test";
import assert from "node:assert/strict";
import { supportedEffort } from "../src/effort.ts";

for (const [requested, supported, expected] of [
  ["off", ["minimal", "low", "high"], "minimal"],
  ["medium", ["off"], "off"],
  ["medium", ["low", "high"], "high"],
  ["max", ["low", "high", "max"], "high"],
  ["medium", ["low", "medium", "high"], "medium"],
] as const) {
  test(`maps ${requested} onto ${supported.join("/")} as ${expected}`, () => {
    assert.equal(supportedEffort(requested, supported), expected);
  });
}

test("rejects invalid effort domains instead of selecting max", () => {
  assert.throws(() => supportedEffort("high", ["max"]));
  assert.throws(() => supportedEffort("invented", ["low"]));
});
