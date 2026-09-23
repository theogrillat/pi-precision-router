import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModel } from "@earendil-works/pi-ai/compat";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import router from "../src/index.ts";

const opus = getModel("anthropic", "claude-opus-5-5")!;
const astra = getModel("openai-codex", "gpt-6-astra")!;

function answer(
  body: any,
  model = "openai-codex/gpt-6-astra",
  benefit = `quality:${model}`,
  effort = "medium",
) {
  return {
    answers: Object.fromEntries(
      Object.entries(body.questions).map(([key, question]: [string, any]) => {
        const choice =
          key === "model" ? model : key === "effort" ? effort : benefit;
        return [
          key,
          {
            type: "choice",
            choice,
            confidence: 0.95,
            probabilities: Object.fromEntries(
              Object.keys(question.criteria).map((option) => [
                option,
                option === choice ? 1 : 0,
              ]),
            ),
          },
        ];
      }),
    ),
  };
}

async function harness(t: any) {
  let model = opus;
  let effort = "high";
  const handlers = new Map<string, Function>();
  const commands = new Map<string, any>();
  const requests: any[] = [];
  const warnings: string[] = [];
  const statuses: string[] = [];
  const messages: any[] = [
    {
      type: "message",
      message: { role: "user", content: "Explain the design" },
    },
  ];
  let respond = (body: any): any => answer(body);
  t.mock.method(globalThis, "fetch", async (_url: any, options: any) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => respond(body) };
  });
  const previousEnv = process.env;
  process.env = {
    ...previousEnv,
    TYPESAFE_API_KEY: "test-key",
    PI_CODING_AGENT_DIR: "/nonexistent/precision-router-test",
  };
  t.after(() => {
    process.env = previousEnv;
  });
  const ctx = {
    cwd: "/nonexistent/precision-router-test",
    hasUI: true,
    get model() {
      return model;
    },
    signal: new AbortController().signal,
    modelRegistry: { getAvailable: () => [opus, astra] },
    sessionManager: { buildContextEntries: () => messages },
    getSystemPrompt: () => "Respect scope; explain concisely.",
    ui: {
      notify: (text: string) => warnings.push(text),
      setStatus: (_key: string, text: string) => statuses.push(text),
    },
  };
  const pi = {
    on: (event: string, fn: Function) => {
      handlers.set(event, fn);
    },
    registerCommand: (name: string, command: any) =>
      commands.set(name, command),
    getThinkingLevel: () => effort,
    setThinkingLevel: (value: string) => {
      effort = value;
    },
    setModel: async (value: typeof opus) => {
      model = value;
      return true;
    },
  };
  router(pi as unknown as ExtensionAPI);
  const emit = (event: string) =>
    handlers.get(event)?.({}, ctx as unknown as ExtensionContext);
  await emit("session_start");
  return {
    emit,
    requests,
    warnings,
    statuses,
    messages,
    ctx,
    settings: () => [model.id, effort],
    respond: (fn: typeof respond) => {
      respond = fn;
    },
    command: (value: string) => commands.get("precision-router").handler(value, ctx),
  };
}

test("routes each model step with one three-question request and recent tool evidence", async (t) => {
  const h = await harness(t);
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["gpt-6-astra", "medium"]);
  h.messages.push({
    type: "message",
    message: {
      role: "toolResult",
      content: [{ type: "text", text: "Found a subtle race" }],
    },
  });
  h.respond((body) => answer(body, "anthropic/claude-opus-5-5"));
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "medium"]);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(Object.keys(h.requests[0].questions), [
    "model",
    "effort",
    "benefit",
  ]);
  assert.match(JSON.stringify(h.requests[1].state), /Found a subtle race/);
  assert.match(JSON.stringify(h.requests[1].state), /Explain the design/);
  assert.match(JSON.stringify(h.requests[1].state), /Respect scope/);
});

test("holds close decisions but updates supported effort; permits quality-preserving speed switches", async (t) => {
  const h = await harness(t);
  h.respond((body) => answer(body, undefined, "hold", "medium"));
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "medium"]);
  h.respond((body) =>
    answer(body, undefined, "speed:openai-codex/gpt-6-astra", "high"),
  );
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["gpt-6-astra", "high"]);
});

test("off prevents requests; on and new sessions resume; manual selection does not disable routing", async (t) => {
  const h = await harness(t);
  await h.command("off");
  await h.emit("turn_start");
  assert.equal(h.requests.length, 0);
  assert.match(h.statuses.at(-1)!, /off.*claude-opus-5-5.*high/);
  await h.command("on");
  await h.emit("model_select");
  await h.emit("turn_start");
  assert.equal(h.requests.length, 1);
  await h.command("off");
  await h.emit("session_start");
  h.respond((body) => answer(body, undefined, "hold"));
  await h.emit("turn_start");
  assert.equal(h.requests.length, 2);
});

for (const scenario of [
  "network",
  "malformed",
  "unknown-model",
  "max",
  "unsupported",
]) {
  test(`${scenario} preserves both settings`, async (t) => {
    const h = await harness(t);
    h.respond((body) => {
      if (scenario === "network") throw new Error("network failed");
      if (scenario === "malformed") return {};
      if (scenario === "unknown-model") return answer(body, "invented/model");
      return answer(
        body,
        undefined,
        "hold",
        scenario === "max" ? "max" : "minimal",
      );
    });
    await h.emit("turn_start");
    assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
    assert.ok(h.warnings.length);
  });
}

test("timeout bounds the whole Jev request and ignores a late response", async (t) => {
  const h = await harness(t);
  let resolve!: (value: unknown) => void;
  h.respond(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const start = Date.now();
  await h.emit("turn_start");
  assert.ok(Date.now() - start < 2400);
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
  assert.equal(h.requests.length, 1);
  resolve(answer(h.requests[0]));
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
});

test("session replacement and operation cancellation ignore late decisions", async (t) => {
  const h = await harness(t);
  let resolve!: (value: unknown) => void;
  h.respond(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const pending = h.emit("turn_start");
  await new Promise((done) => setImmediate(done));
  await h.emit("session_start");
  await pending;
  resolve(answer(h.requests[0]));
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
  const controller = new AbortController();
  h.ctx.signal = controller.signal;
  const cancelled = h.emit("turn_start");
  await new Promise((done) => setImmediate(done));
  controller.abort();
  await cancelled;
  resolve(answer(h.requests[1]));
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
});

test("bounds context while reserving the user request and separates instruction evidence", async (t) => {
  const h = await harness(t);
  h.ctx.hasUI = false;
  h.ctx.getSystemPrompt = () => "s".repeat(50000);
  for (let i = 0; i < 30; i++)
    h.messages.push({
      type: "message",
      message: { role: "toolResult", content: "x".repeat(20000) },
    });
  await h.emit("turn_start");
  const state = h.requests[0].state;
  assert.equal(state.current_request, "Explain the design");
  assert.equal(state.recent_context.length, 8);
  assert.ok(
    state.recent_context.every((entry: any) => entry.text.length <= 2000),
  );
  assert.ok(state.active_instructions.length <= 8000);
  assert.deepEqual(h.settings(), ["gpt-6-astra", "medium"]);
});

test("project replaces the roster and overrides global preferences, invalid config fails closed", async (t) => {
  const h = await harness(t);
  const root = mkdtempSync(join(tmpdir(), "precision-config-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".pi"));
  process.env.PI_CODING_AGENT_DIR = root;
  h.ctx.cwd = root;
  writeFileSync(
    join(root, "pi-precision-router.json"),
    JSON.stringify({
      preferences: "global preference",
      apiKeyEnv: "TEST_JEV_KEY",
    }),
  );
  process.env.TEST_JEV_KEY = "fake";
  const configPath = join(root, ".pi", "pi-precision-router.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      preferences: "project preference",
      models: [
        {
          provider: "openai-codex",
          id: "gpt-6-astra",
          description: "Project-specific Astra",
        },
      ],
    }),
  );
  await h.emit("turn_start");
  assert.equal(h.requests[0].state.preferences, "project preference");
  assert.equal(h.requests[0].state.model_profiles.length, 1);
  assert.equal(
    h.requests[0].state.model_profiles[0].description,
    "Project-specific Astra",
  );
  writeFileSync(configPath, "{broken");
  await h.emit("turn_start");
  assert.equal(h.requests.length, 1);
  assert.deepEqual(h.settings(), ["gpt-6-astra", "medium"]);
});

test("uncertain or contradictory model-specific benefits cannot justify switching", async (t) => {
  const h = await harness(t);
  h.respond((body) => {
    const response = answer(body);
    response.answers.benefit.confidence = 0.2;
    return response;
  });
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "medium"]);
});
