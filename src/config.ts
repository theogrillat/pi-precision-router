import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Profile {
  provider: string;
  id: string;
  description: string;
}
export interface Config {
  models: Profile[];
  preferences: string;
  apiKeyEnv: string;
  jevModel: string;
}
export const defaults: Config = {
  apiKeyEnv: "TYPESAFE_API_KEY",
  jevModel: "jev-latest",
  preferences:
    "User observations, not benchmarks: Anthropic adheres more closely to boundaries and scope and produces preferred code. OpenAI is generally faster, less verbose and easier to read. These are contextual preferences, not rigid task mappings.",
  models: [
    {
      provider: "openai-codex",
      id: "gpt-6-luna",
      description:
        "Extremely fast and cheap but weak intelligence and reasoning. Genuinely trivial or mechanical work.",
    },
    {
      provider: "openai-codex",
      id: "gpt-6-sol",
      description:
        "Opus-like general capability in user experience, lower verbosity and clearer explanations, less-preferred code than Opus. Routine explanation and discussion relative to Astra.",
    },
    {
      provider: "openai-codex",
      id: "gpt-6-astra",
      description:
        "Top general-purpose choice: frontier intelligence, concise and easy to read. Demanding discussion, nuanced reasoning and explanation. Less strong than Fable on really hard coding.",
    },
    {
      provider: "anthropic",
      id: "claude-opus-5-5",
      description:
        "Default for substantive coding; preferred code output. Newly released: reports of lower verbosity and better speed than previous Opus are provisional, not established user observations.",
    },
    {
      provider: "anthropic",
      id: "claude-fable-5-1",
      description:
        "Hardest coding and engineering problems; strong code output with verbosity and speed disadvantages relative to the OpenAI choices.",
    },
    {
      provider: "anthropic",
      id: "claude-sonnet-5",
      description:
        "Fast and reasonably intelligent for straightforward problems; middle ground between Luna and Opus. Limited personal usage so far.",
    },
  ],
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
    const patch = JSON.parse(raw);
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
  if (
    ![c.apiKeyEnv, c.jevModel, c.preferences].every(
      (value) =>
        typeof value === "string" &&
        value.trim().length > 0 &&
        value.length <= 4000,
    )
  )
    throw new Error("Invalid router configuration");
  if (!Array.isArray(c.models) || !c.models.length || c.models.length > 24)
    throw new Error("Configure 1–24 models");
  for (const m of c.models) {
    if (
      !m ||
      ![m.provider, m.id, m.description].every(
        (value) =>
          typeof value === "string" &&
          value.trim().length > 0 &&
          value.length <= 2000,
      )
    )
      throw new Error("Invalid model profile");
  }
  if (new Set(c.models.map(modelKey)).size !== c.models.length)
    throw new Error("Duplicate model profile");
  return c;
}
