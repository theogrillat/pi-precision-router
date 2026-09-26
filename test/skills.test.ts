import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  loadSkillsFromDir,
  type LoadSkillsResult,
} from "@earendil-works/pi-coding-agent";

const root = fileURLToPath(new URL("../", import.meta.url));

test("package exposes a valid setup skill with bundled references", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(root, "package.json"), "utf8"),
  );
  assert.ok(manifest.files.includes("skills"));
  const results: LoadSkillsResult[] = manifest.pi.skills.map((dir: string) =>
    loadSkillsFromDir({ dir: resolve(root, dir), source: "package" }),
  );
  assert.deepEqual(
    results.flatMap((result) => result.diagnostics),
    [],
  );
  const skills = results.flatMap((result) => result.skills);
  assert.deepEqual(
    skills.map((skill) => skill.name),
    ["precision-router-setup"],
  );
  for (const reference of [
    "../../src/config.ts",
    "../../src/index.ts",
    "../../examples/pi-precision-router.json",
  ]) {
    assert.ok(existsSync(resolve(skills[0].baseDir, reference)), reference);
  }
});
