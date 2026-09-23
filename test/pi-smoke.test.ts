import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type, type AssistantMessage } from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { getModel } from "@earendil-works/pi-ai/compat";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import router from "../src/index.ts";

test("real Pi requests switch at the upcoming boundary across tool rounds, then hold", async (t) => {
  const cwd = mkdtempSync(join(tmpdir(), "precision-smoke-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = process.env;
  process.env = {
    ...env,
    PI_CODING_AGENT_DIR: cwd,
    TYPESAFE_API_KEY: "smoke-fake",
  };
  t.after(() => {
    process.env = env;
  });
  const opus = getModel("anthropic", "claude-opus-5-5")!;
  const astra = getModel("openai-codex", "gpt-6-astra")!;
  const runtime = await ModelRuntime.create({
    authPath: join(cwd, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  t.mock.method(runtime, "checkAuth", async () => ({ type: "apiKey" }));
  t.mock.method(runtime, "hasConfiguredAuth", () => true);
  t.mock.method(runtime, "getAvailableSnapshot", () => [opus, astra]);
  const sent: Array<{ model: string; effort: unknown }> = [];
  t.mock.method(
    runtime,
    "streamSimple",
    (
      ...[model, _context, options]: Parameters<ModelRuntime["streamSimple"]>
    ) => {
      sent.push({ model: model.id, effort: options?.reasoning });
      const stream = new AssistantMessageEventStream();
      const round = sent.length;
      const message: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content:
          round < 3
            ? [
                {
                  type: "toolCall",
                  id: `call-${round}`,
                  name: "probe",
                  arguments: {},
                },
              ]
            : [{ type: "text", text: "done" }],
        stopReason: round < 3 ? "toolUse" : "stop",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      queueMicrotask(() => {
        stream.push({
          type: "done",
          reason: message.stopReason as "stop" | "toolUse",
          message,
        });
        stream.end();
      });
      return stream;
    },
  );
  let calls = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (...[_url, init]: Parameters<typeof fetch>) => {
      const body = JSON.parse(String(init?.body));
      calls++;
      const chosen =
        calls === 1 ? "openai-codex/gpt-6-astra" : "anthropic/claude-opus-5-5";
      const selections: Record<string, string> = {
        model: chosen,
        effort: calls === 1 ? "medium" : "high",
        benefit: calls === 3 ? "hold" : `quality:${chosen}`,
      };
      return new Response(
        JSON.stringify({
          answers: Object.fromEntries(
            Object.entries(body.questions).map(
              ([id, question]: [string, any]) => [
                id,
                {
                  type: "choice",
                  choice: selections[id],
                  confidence: 1,
                  probabilities: Object.fromEntries(
                    Object.keys(question.criteria).map((key) => [
                      key,
                      key === selections[id] ? 1 : 0,
                    ]),
                  ),
                },
              ],
            ),
          ),
        }),
      );
    },
  );
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false },
  });
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [router],
  });
  await loader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    modelRuntime: runtime,
    model: opus,
    thinkingLevel: "high",
    resourceLoader: loader,
    settingsManager,
    sessionManager: SessionManager.inMemory(cwd),
    tools: [],
    customTools: [
      {
        name: "probe",
        label: "probe",
        description: "Return evidence",
        parameters: Type.Object({}),
        execute: async () => ({
          content: [{ type: "text", text: "Evidence from tool round" }],
          details: undefined,
        }),
      },
    ],
  });
  t.after(() => session.dispose());
  await session.bindExtensions({});
  await session.prompt("Investigate, then implement, then explain.");
  assert.equal(calls, 3);
  assert.deepEqual(sent, [
    { model: "gpt-6-astra", effort: "medium" },
    { model: "claude-opus-5-5", effort: "high" },
    { model: "claude-opus-5-5", effort: "high" },
  ]);
});
