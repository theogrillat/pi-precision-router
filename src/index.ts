import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { loadConfig, modelKey } from "./config.ts";
import {
  buildRequest,
  clearChoice,
  evaluate,
  excerpt,
  parseDecision,
} from "./jev.ts";

export default function precisionRouter(pi: ExtensionAPI): void {
  let enabled = true;
  let generation = 0;
  let active: AbortController | undefined;
  let activeRequest = "";
  const warned = new Set<string>();
  const warn = (ctx: ExtensionContext, text: string) => {
    if (ctx.hasUI && !warned.has(text)) {
      warned.add(text);
      ctx.ui.notify(`precision-router: ${text}`, "warning");
    }
  };
  const status = (ctx: ExtensionContext) => {
    if (ctx.hasUI)
      ctx.ui.setStatus(
        "precision-router",
        `precision-router:${enabled ? "on" : "off"} · ${ctx.model?.id ?? "none"} · ${pi.getThinkingLevel()}`,
      );
  };
  const invalidate = () => {
    generation++;
    active?.abort();
    active = undefined;
  };
  pi.on("session_start", (_event, ctx) => {
    invalidate();
    enabled = true;
    activeRequest = "";
    warned.clear();
    status(ctx);
  });
  pi.on("before_agent_start", (event) => {
    activeRequest = excerpt(event.prompt, 2000);
  });
  pi.on("session_shutdown", () => {
    invalidate();
  });
  pi.on("model_select", (_event, ctx) => {
    status(ctx);
  });
  pi.on("thinking_level_select", (_event, ctx) => {
    status(ctx);
  });
  pi.registerCommand("precision-router", {
    description: "Precision routing on|off",
    handler: async (args, ctx) => {
      const value = args.trim();
      if (value !== "on" && value !== "off") {
        warn(ctx, "usage: /precision-router on|off");
        return;
      }
      invalidate();
      enabled = value === "on";
      status(ctx);
    },
  });
  pi.on("turn_start", async (_event, ctx) => {
    if (!enabled || !ctx.model) return;
    invalidate();
    const epoch = generation;
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(
      () => controller.abort(new Error("routing timed out (2s)")),
      2000,
    );
    const signal = ctx.signal
      ? AbortSignal.any([controller.signal, ctx.signal])
      : controller.signal;
    const previousModel = ctx.model;
    const previousEffort = pi.getThinkingLevel();
    let abortHandler: (() => void) | undefined;
    try {
      signal.throwIfAborted();
      const config = loadConfig(ctx.cwd);
      const available = ctx.modelRegistry.getAvailable();
      const profiles = config.models.filter((profile) =>
        available.some((model) => modelKey(model) === modelKey(profile)),
      );
      const missing = config.models.filter(
        (profile) => !profiles.includes(profile),
      );
      if (missing.length)
        warn(ctx, `unavailable: ${missing.map(modelKey).join(", ")}`);
      if (!profiles.length) throw new Error("no configured models available");
      const apiKey = process.env[config.apiKeyEnv];
      if (!apiKey) throw new Error(`missing ${config.apiKeyEnv}`);
      const request = buildRequest(
        ctx,
        config,
        profiles,
        previousEffort,
        activeRequest,
      );
      const aborted = new Promise<never>((_resolve, reject) => {
        abortHandler = () =>
          reject(signal.reason ?? new Error("routing aborted"));
        signal.addEventListener("abort", abortHandler, { once: true });
      });
      const raw = await Promise.race([
        evaluate(request, apiKey, signal),
        aborted,
      ]);
      signal.throwIfAborted();
      if (
        epoch !== generation ||
        !enabled ||
        ctx.model !== previousModel ||
        pi.getThinkingLevel() !== previousEffort
      )
        return;
      const decision = parseDecision(raw, request);
      const proposed = decision.model.choice;
      const switchModel =
        clearChoice(decision.model) &&
        clearChoice(decision.benefit) &&
        (decision.benefit.choice === `quality:${proposed}` ||
          decision.benefit.choice === `speed:${proposed}`);
      const effective = switchModel
        ? available.find((model) => modelKey(model) === proposed)
        : previousModel;
      if (!effective) throw new Error("selected model unavailable");
      const effort = decision.effort.choice;
      const supported = getSupportedThinkingLevels(effective);
      if (!supported.some((level) => level === effort))
        throw new Error("unsupported effort for effective model");
      if (!clearChoice(decision.effort))
        throw new Error("uncertain reasoning effort");
      signal.throwIfAborted();
      if (effective !== previousModel && !(await pi.setModel(effective)))
        throw new Error("model switch rejected");
      if (
        signal.aborted ||
        epoch !== generation ||
        !enabled ||
        !ctx.model ||
        modelKey(ctx.model) !== modelKey(effective)
      )
        return;
      pi.setThinkingLevel(
        effort as Parameters<ExtensionAPI["setThinkingLevel"]>[0],
      );
    } catch (error) {
      if (epoch === generation && !ctx.signal?.aborted)
        warn(ctx, error instanceof Error ? error.message : "routing failed");
    } finally {
      clearTimeout(timer);
      if (abortHandler) signal.removeEventListener("abort", abortHandler);
      if (epoch === generation) {
        active = undefined;
        status(ctx);
      }
    }
  });
}
