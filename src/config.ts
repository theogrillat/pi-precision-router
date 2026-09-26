import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Profile {
  provider: string;
  id: string;
  description: string;
  effortMap: Record<string, string>;
}
export interface Config {
  models: Profile[];
  efforts: Record<string, string>;
  preferences: string;
  notifyDecisions: boolean;
  jevModel: string;
}
export const defaults: Config = {
  notifyDecisions: false,
  jevModel: "jev-latest",
  preferences:
    "Prioritize correctness and scope adherence, then speed and clarity.",
  models: [],
  efforts: {},
};
export const modelKey = (model: { provider: string; id: string }) =>
  `${model.provider}/${model.id}`;
export function loadConfig(cwd: string): Config {
  const globalDir =
    process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  let config: unknown = defaults;
  for (const path of [
    join(globalDir, "pi-precision-router.json"),
    join(cwd, ".pi", "pi-precision-router.json"),
  ]) {
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    let patch;
    try {
      patch = JSON.parse(raw);
    } catch {
      throw new Error("Invalid router configuration JSON");
    }
    if (
      !patch ||
      typeof patch !== "object" ||
      Array.isArray(patch) ||
      Object.keys(patch).some((key) => !Object.hasOwn(defaults, key))
    )
      throw new Error("Invalid router configuration");
    config = { ...(config as Config), ...patch };
  }
  const c = config as Config;
  if (typeof c.notifyDecisions !== "boolean")
    throw new Error("Invalid feedback configuration");
  if (
    ![c.jevModel, c.preferences].every(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 4000,
    )
  )
    throw new Error("Invalid router configuration");
  if (!Array.isArray(c.models) || !c.models.length || c.models.length > 24)
    throw new Error("Configure 1–24 models");
  if (
    !isRecord(c.efforts) ||
    !Object.keys(c.efforts).length ||
    Object.keys(c.efforts).length > 12
  )
    throw new Error("Configure 1–12 effort choices");
  for (const [label, description] of Object.entries(c.efforts)) {
    if (
      !/^[a-z][a-z0-9_-]{0,31}$/.test(label) ||
      label in Object.prototype ||
      !validText(description)
    )
      throw new Error("Invalid effort choice");
  }
  for (const m of c.models) {
    if (
      !isRecord(m) ||
      Object.keys(m).some(
        (key) => !["provider", "id", "description", "effortMap"].includes(key),
      ) ||
      ![m.provider, m.id, m.description].every(validText)
    )
      throw new Error("Invalid model profile");
    if (
      !isRecord(m.effortMap) ||
      Object.keys(m.effortMap).length !== Object.keys(c.efforts).length ||
      Object.keys(c.efforts).some(
        (label) =>
          !Object.hasOwn(m.effortMap, label) ||
          !["off", "minimal", "low", "medium", "high", "xhigh"].includes(
            m.effortMap[label],
          ),
      )
    )
      throw new Error(
        "Each model needs an explicit non-max native mapping for every effort choice",
      );
  }
  if (new Set(c.models.map(modelKey)).size !== c.models.length)
    throw new Error("Duplicate model profile");
  return c;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validText(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 2000
  );
}
