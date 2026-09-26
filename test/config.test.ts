import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.ts";

const config = {
  efforts: { quick: "Simple tasks", deep: "Difficult tasks" },
  models: [
    {
      provider: "custom",
      id: "local-reasoner",
      description: "Local model",
      effortMap: { quick: "low", deep: "high" },
    },
  ],
};

function setup(t: any) {
  const root = mkdtempSync(join(tmpdir(), "precision-roster-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  t.after(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(root, { recursive: true, force: true });
  });
  const save = (value: unknown) =>
    writeFileSync(
      join(root, "pi-precision-router.json"),
      JSON.stringify(value),
    );
  return { root, save };
}

test("requires an explicit roster instead of personal model defaults", (t) => {
  const { root } = setup(t);
  assert.throws(() => loadConfig(root), /Configure/);
});

test("loads arbitrary providers and effort labels, with explicit per-model mappings", (t) => {
  const { root, save } = setup(t);
  save(config);
  assert.deepEqual(loadConfig(root).models, config.models);
  assert.deepEqual(loadConfig(root).efforts, config.efforts);
  mkdirSync(join(root, ".pi"));
  writeFileSync(
    join(root, ".pi", "pi-precision-router.json"),
    JSON.stringify({
      efforts: { simple: "Single level" },
      models: [{ ...config.models[0], effortMap: { simple: "off" } }],
    }),
  );
  assert.deepEqual(loadConfig(root).efforts, { simple: "Single level" });
});

for (const [label, patch] of [
  [
    "missing mapping",
    { models: [{ ...config.models[0], effortMap: { quick: "low" } }] },
  ],
  [
    "extra mapping",
    {
      models: [
        {
          ...config.models[0],
          effortMap: { quick: "low", deep: "high", unused: "high" },
        },
      ],
    },
  ],
  [
    "max mapping",
    {
      models: [
        { ...config.models[0], effortMap: { quick: "low", deep: "max" } },
      ],
    },
  ],
  [
    "invalid native mapping",
    {
      models: [
        { ...config.models[0], effortMap: { quick: "low", deep: "turbo" } },
      ],
    },
  ],
  ["inline API key", { apiKey: "secret" }],
  ["configurable API key variable", { apiKeyEnv: "ANOTHER_KEY" }],
  ["empty effort roster", { efforts: {} }],
  ["invalid description", { efforts: { quick: 2, deep: "Difficult" } }],
  ["prototype effort label", { efforts: JSON.parse('{"__proto__":"Bad"}') }],
  [
    "unknown profile property",
    { models: [{ ...config.models[0], effortMaps: {} }] },
  ],
] as const) {
  test(`rejects ${label}`, (t) => {
    const { root, save } = setup(t);
    save({ ...config, ...patch });
    assert.throws(() => loadConfig(root));
  });
}
