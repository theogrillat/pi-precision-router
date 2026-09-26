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
import { fixtureConfig } from "./fixtures.ts";

const opus = getModel("anthropic", "claude-opus-5-5")!;
const astra = getModel("openai-codex", "gpt-6-astra")!;
const sol = getModel("openai-codex", "gpt-6-sol")!;

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

async function harness(t: any, available = [opus, astra]) {
  const cwd = mkdtempSync(join(tmpdir(), "precision-runtime-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  mkdirSync(join(cwd, ".pi"));
  writeFileSync(
    join(cwd, ".pi", "pi-precision-router.json"),
    JSON.stringify(fixtureConfig),
  );
  let model: typeof opus | typeof astra = opus;
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
    cwd,
    hasUI: true,
    get model() {
      return model;
    },
    signal: new AbortController().signal,
    modelRegistry: { getAvailable: () => available },
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
    setModel: async (value: typeof model) => {
      model = value;
      return true;
    },
  };
  router(pi as unknown as ExtensionAPI);
  const emit = (event: string) =>
    handlers.get(event)?.({}, ctx as unknown as ExtensionContext);
  await emit("session_start");
  return {
    pi,
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

test("selects the top model even when the benefit verdict is hold", async (t) => {
  const h = await harness(t);
  h.respond((body) => answer(body, undefined, "hold", "medium"));
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["gpt-6-astra", "medium"]);
  h.respond((body) => answer(body, undefined, "hold", "high"));
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

for (const scenario of ["network", "malformed", "unknown-model", "max"]) {
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
      ...fixtureConfig,
      preferences: "global preference",
    }),
  );
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
          effortMap: fixtureConfig.models[0].effortMap,
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

test("low confidence and close model probabilities do not veto the top model", async (t) => {
  const h = await harness(t);
  h.respond((body) => {
    const response = answer(body, undefined, "hold");
    response.answers.model.confidence = 0.2;
    response.answers.model.probabilities = {
      "openai-codex/gpt-6-astra": 0.51,
      "anthropic/claude-opus-5-5": 0.49,
    };
    response.answers.benefit.confidence = 0.2;
    response.answers.effort.confidence = 0.2;
    return response;
  });
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["gpt-6-astra", "medium"]);
});

test("offers four effort choices and applies every native level on Astra, Opus and Sol", async (t) => {
  const h = await harness(t, [opus, astra, sol]);
  for (const model of [
    "openai-codex/gpt-6-astra",
    "anthropic/claude-opus-5-5",
    "openai-codex/gpt-6-sol",
  ]) {
    for (const effort of ["low", "medium", "high", "xhigh"]) {
      h.respond((body) => {
        assert.deepEqual(Object.keys(body.questions.effort.criteria), [
          "low",
          "medium",
          "high",
          "xhigh",
        ]);
        const response = answer(body, model, "hold", effort);
        response.answers.effort.confidence = 0.1;
        response.answers.effort.probabilities = Object.fromEntries(
          ["low", "medium", "high", "xhigh"].map((level) => [
            level,
            level === effort ? 0.28 : 0.24,
          ]),
        );
        return response;
      });
      await h.emit("turn_start");
      assert.deepEqual(h.settings(), [model.split("/")[1], effort]);
    }
  }
});

for (const effort of ["off", "minimal"]) {
  test(`rejects obsolete effort choice ${effort}`, async (t) => {
    const h = await harness(t);
    h.respond((body) => answer(body, undefined, "hold", effort));
    await h.emit("turn_start");
    assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
    assert.match(h.warnings.at(-1)!, /Malformed Jev decision/);
  });
}

for (const interrupt of ["off", "session", "abort"]) {
  test(`does not apply stale effort after model commit interrupted by ${interrupt}`, async (t) => {
    const h = await harness(t);
    const commit = h.pi.setModel;
    let finish!: () => void;
    const controller = new AbortController();
    h.ctx.signal = controller.signal;
    h.pi.setModel = async (model) => {
      await commit(model);
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return true;
    };
    const pending = h.emit("turn_start");
    await new Promise((resolve) => setImmediate(resolve));
    if (interrupt === "off") await h.command("off");
    if (interrupt === "session") await h.emit("session_start");
    if (interrupt === "abort") controller.abort();
    h.pi.setThinkingLevel("low");
    finish();
    await pending;
    assert.equal(h.settings()[1], "low");
  });
}

test("manual effort selection refreshes disabled status", async (t) => {
  const h = await harness(t);
  await h.command("off");
  h.pi.setThinkingLevel("low");
  await h.emit("thinking_level_select");
  assert.match(h.statuses.at(-1)!, /off.*low/);
});

for (const key of ["toString", "constructor", "__proto__"]) {
  test(`rejects inherited configuration key ${key}`, async (t) => {
    const h = await harness(t);
    const root = mkdtempSync(join(tmpdir(), "precision-invalid-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    process.env.PI_CODING_AGENT_DIR = root;
    writeFileSync(join(root, "pi-precision-router.json"), `{ "${key}": 123 }`);
    await h.emit("turn_start");
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
  });
}

test("awaits a host model switch beyond the Jev deadline", async (t) => {
  const h = await harness(t);
  const commit = h.pi.setModel;
  h.pi.setModel = async (model) => {
    await new Promise((resolve) => setTimeout(resolve, 2100));
    return commit(model);
  };
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["gpt-6-astra", "medium"]);
  assert.equal(h.requests.length, 1);
});

test("uses the trimmed environment API key without exposing it in routing state", async (t) => {
  const h = await harness(t);
  process.env.TYPESAFE_API_KEY = "  env-secret  ";
  const authorizations: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (_url: unknown, options: any) => {
    authorizations.push(options.headers.Authorization);
    assert.ok(!options.body.includes("env-secret"));
    return {
      ok: true,
      json: async () => answer(JSON.parse(options.body), undefined, "hold"),
    };
  });
  await h.emit("turn_start");
  assert.deepEqual(authorizations, ["Bearer env-secret"]);
  assert.ok(h.warnings.every((message) => !message.includes("env-secret")));
});

for (const key of [undefined, "", "   "]) {
  test(`skips routing when environment API key is ${JSON.stringify(key)}`, async (t) => {
    const h = await harness(t);
    if (key === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = key;
    await h.emit("turn_start");
    assert.equal(h.requests.length, 0);
    assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
    assert.match(h.warnings.at(-1)!, /set TYPESAFE_API_KEY environment variable/);
  });
}

test("testing feedback reports switched, held and rejected decisions without deduplicating steps", async (t) => {
  const h = await harness(t);
  const root = mkdtempSync(join(tmpdir(), "precision-feedback-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = root;
  const path = join(root, "pi-precision-router.json");
  writeFileSync(path, JSON.stringify({ notifyDecisions: true }));
  await h.emit("turn_start");
  assert.match(h.warnings.at(-1)!, /switched.*gpt-6-astra.*medium/s);
  assert.match(h.warnings.at(-1)!, /proposed:.*gpt-6-astra.*benefit: quality/s);
  h.respond((body) => answer(body, undefined, "hold"));
  await h.emit("turn_start");
  assert.match(h.warnings.at(-1)!, /held.*gpt-6-astra.*medium/s);
  h.respond((body) => answer(body, undefined, "hold", "max"));
  await h.emit("turn_start");
  assert.match(
    h.warnings.at(-1)!,
    /rejected.*gpt-6-astra.*medium.*Malformed Jev decision/s,
  );
  const count = h.warnings.length;
  await h.emit("turn_start");
  assert.equal(h.warnings.length, count + 1);
  writeFileSync(path, JSON.stringify({ notifyDecisions: false }));
  h.respond((body) => answer(body, undefined, "hold"));
  await h.emit("turn_start");
  assert.equal(h.warnings.length, count + 1);
  writeFileSync(path, JSON.stringify({ notifyDecisions: true }));
  h.ctx.hasUI = false;
  await h.emit("turn_start");
  assert.equal(h.warnings.length, count + 1);
});

test("routes a custom provider using arbitrary configured effort labels and mappings", async (t) => {
  const custom = { ...opus, provider: "custom-provider", id: "local-reasoner" };
  const simple = {
    ...opus,
    provider: "custom-provider",
    id: "local-simple",
    reasoning: false,
  };
  const h = await harness(t, [custom, simple]);
  const config = {
    efforts: { quick: "Simple task", deep: "Complex task" },
    models: [
      {
        provider: custom.provider,
        id: custom.id,
        description: "Custom reasoner",
        effortMap: { quick: "low", deep: "high" },
      },
      {
        provider: simple.provider,
        id: simple.id,
        description: "No reasoning",
        effortMap: { quick: "off", deep: "off" },
      },
    ],
  };
  writeFileSync(
    join(h.ctx.cwd, ".pi", "pi-precision-router.json"),
    JSON.stringify(config),
  );
  h.respond((body) =>
    answer(body, "custom-provider/local-reasoner", "hold", "deep"),
  );
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["local-reasoner", "high"]);
  assert.deepEqual(h.requests[0].questions.effort.criteria, config.efforts);
  h.respond((body) =>
    answer(body, "custom-provider/local-simple", "hold", "quick"),
  );
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["local-simple", "off"]);
});

test("unsupported configured native effort cannot switch model or silently remap", async (t) => {
  const h = await harness(t);
  const config = structuredClone(fixtureConfig);
  config.models[1].effortMap.low = "off";
  writeFileSync(
    join(h.ctx.cwd, ".pi", "pi-precision-router.json"),
    JSON.stringify(config),
  );
  h.respond((body) => answer(body, undefined, "hold", "low"));
  await h.emit("turn_start");
  assert.deepEqual(h.settings(), ["claude-opus-5-5", "high"]);
  assert.match(h.warnings.at(-1)!, /mapping low → off is unsupported/);
});
