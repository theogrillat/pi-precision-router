import { test } from "node:test";
import assert from "node:assert/strict";
import { mappedEffort } from "../src/effort.ts";

test("uses explicit mappings rather than nearest-level inference", () => {
  assert.equal(mappedEffort("deep", { deep: "high" }, ["low", "high"]), "high");
  assert.equal(
    mappedEffort("xhigh", { xhigh: "medium" }, ["medium", "high", "xhigh"]),
    "medium",
  );
  assert.equal(mappedEffort("deep", { deep: "off" }, ["off"]), "off");
});

test("rejects missing, unsupported, inherited and max mappings", () => {
  assert.throws(() => mappedEffort("high", {}, ["high"]));
  assert.throws(() => mappedEffort("deep", { deep: "high" }, ["low"]));
  assert.throws(() => mappedEffort("deep", { deep: "max" }, ["max"]));
  assert.throws(() =>
    mappedEffort("deep", Object.create({ deep: "high" }), ["high"]),
  );
});
