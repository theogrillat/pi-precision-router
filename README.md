# pi-precision-router

Quality-first concrete-model routing before each main-agent step in Pi.

## Try it locally

Requires Pi 0.87.1+ and Node 22.19+ (development tested on Node 24).

First create your routing configuration as described below. There are no built-in
model or effort rosters. Missing configuration leaves your current settings unchanged
and emits a setup warning.

```sh
npm ci --ignore-scripts
export TYPESAFE_API_KEY=...
pi --no-extensions --extension "$PWD/src/index.ts"
```

The explicit extension is loaded while auto-discovered extensions are disabled.
Load only one model router at a time to avoid competing model selections.
This repository is private-marked to prevent accidental npm publication. No install,
user-settings change or publication is performed by tests.

New sessions start enabled. `/precision-router off` stops requests; `/precision-router on`
resumes. Manual model selection does not disable routing. The status shows
on/off, effective model and effort. By default, decisions do not add chat entries
and warnings are deduplicated per session. Headless use needs no terminal UI.

For testing, set `"notifyDecisions": true` in router configuration. Every routing
attempt then emits a notification showing switched/held/rejected, effective settings,
validated proposed settings, Jev confidence, model-specific benefit, guard reason
and elapsed time. Repeated rejections remain visible. No prompt text or credentials
are included. These are notifications, not messages sent to the model. Set the flag
back to `false` for quiet operation. A hidden custom footer does not hide notifications.

## The routing contract

The awaited `turn_start` event runs before each main-agent model request, including
the follow-up after tool calls. It does not route tools, nested Jev evaluation or
idle cache warming. One HTTP evaluation contains three independent Choice questions:

1. **Model**: actual configured, available model IDs and curated descriptions.
2. **Effort**: the labels and descriptions in your configured `efforts` roster.
3. **Benefit**: hold, or a specific model with meaningful quality gain, or a
   specific model with substantial speed gain while quality is preserved.

The top valid model choice is applied directly each step, with no confidence,
winning-probability or margin threshold. The independent benefit verdict is
advisory only: even `hold` does not veto a different model choice. There is no
current-model or prompt-cache preference. Quality improvements are not capped
by dollars or estimated cache cost.

The top valid effort choice is also applied every step, without confidence,
probability or margin thresholds. The selected model's `effortMap` translates the
choice into a Pi thinking level. There is no implicit nearest-level mapping.
The mapped level must be supported by that model according to Pi's live registry;
an unsupported mapping rejects the decision before any settings change. `max`
is never a valid mapping target. For models without reasoning, map every label
to `off`. Notifications show both the configured choice and effective native level.

All Jev work shares one two-second deadline with no retries. Timeout, cancellation,
HTTP failure, malformed answers and invalid decisions retain existing settings.
Late Jev responses cannot apply after timeout, cancellation, off or session replacement.
After validation, the Jev deadline is cleared and the router awaits Pi's
`setModel` host operation. This exception to the
original total-routing deadline was explicitly approved for TECH-2386.
Pi's authentication and model-selection event handlers are not cancellable through
the extension API: an already-started host switch can finish after cancellation or
exceed two seconds. Ownership/cancellation guards prevent a subsequent stale effort
change; they cannot undo that host switch.

## Configuration

Defaults → global `~/.pi/agent/pi-precision-router.json` → project
`<cwd>/.pi/pi-precision-router.json`. `PI_CODING_AGENT_DIR` overrides the global
directory. Fields replace earlier values: `models` replaces the whole array, and
`efforts` replaces the whole object. Update both together when renaming effort
labels. Configuration is read on each turn. Unknown top-level/model fields,
invalid values, empty/duplicate rosters and malformed JSON fail closed for routing.

Define 1–24 models and 1–12 effort choices. Labels are lowercase identifiers
(letters, digits, `_`, `-`; start with a letter; at most 32 characters; no prototype
names). Descriptions are nonempty strings, at most 2,000 characters each. Every
model must map exactly those labels to Pi native levels: `off`, `minimal`, `low`,
`medium`, `high` or `xhigh`. Multiple labels may map to the same native level.

Start from [the neutral example](examples/pi-precision-router.json). Replace its
placeholder provider/model IDs with models registered and authenticated in Pi
(`pi --list-models`), then describe their capabilities and supported effort mappings.
The example is not an installed or automatically selected roster.

```json
{
  "apiKeyEnv": "TYPESAFE_API_KEY",
  "jevModel": "jev-latest",
  "preferences": "Prefer concise explanations and tightly scoped code changes.",
  "efforts": {
    "low": "Straightforward work",
    "medium": "Several reasoning steps",
    "high": "Difficult reasoning",
    "xhigh": "Hardest engineering problems"
  },
  "models": [
    {
      "provider": "your-provider",
      "id": "your-model",
      "description": "Describe this model's strengths, limitations and speed.",
      "effortMap": { "low": "low", "medium": "medium", "high": "high", "xhigh": "high" }
    }
  ]
}
```

The endpoint is fixed to `https://api.typesafe.ai/v1/systemone`. A nonblank `apiKey` in configuration takes precedence over the environment variable
named by `apiKeyEnv` (default `TYPESAFE_API_KEY`). Both values are trimmed; a blank
configured key falls back to the environment. Add `"apiKey": "your-key"` to your
complete `~/.pi/agent/pi-precision-router.json` configuration. Keep this file
private (permissions `0600`) and never commit it. Credentials are never put in
routing state or reports. Malformed configuration errors omit file contents.
Missing models are warned about and excluded, never silently substituted.
Only exact configured, available provider/model pairs can be selected.

The router contains no provider-specific model IDs, capability descriptions or
effort equivalences. Pi owns provider authentication and native API translation;
custom providers work when registered in Pi with accurate capability metadata.
Jev evaluation still uses TypeSafe, independently of your inference providers.

### Migrating an existing installation

Older versions shipped a personal six-model roster. Before upgrading, copy your
effective model list and preferences into the global or project config, add the
`efforts` descriptions, and add an explicit `effortMap` to every model. To preserve
the previous four-level behavior on models supporting all four levels, use
`{"low":"low","medium":"medium","high":"high","xhigh":"xhigh"}`.
There is no silent fallback to the old roster. API key configuration is unchanged.

## Context and privacy

Every evaluation sends bounded task evidence to TypeSafe:

- Current user request: reserved 2,000 characters, retained across tool rounds;
  `before_agent_start` supplies a fallback if compaction removes the user message.
- Recent context: last eight messages, at most 2,000 characters each, including
  assistant text, tool-call names and tool results.
- Active system/project instructions: at most 8,000 characters.
- Profiles: at most 24; descriptions at most 2,000 characters each.
- Preferences: at most 4,000 characters; current model and effort.

Truncation keeps both ends and marks omissions. Instructions, profiles and
conversation are structurally distinct; conversation/tool text is evidence, not
permission to rewrite routing policy. Images and reasoning blocks are not sent.
There is no full-history input or separately generated AI summary. Bounded excerpts
may still contain confidential code or instructions: use only where sending this
evidence to TypeSafe is acceptable.

## Development and verification

```sh
npm run typecheck
npm test
npx prettier --check src test package.json tsconfig.json
```

`test/runtime.test.ts` exercises the extension through a fake Pi host and controlled
Jev HTTP responses. `test/pi-smoke.test.ts` boots the real Pi 0.87.1 SDK, extension
runner, agent loop and tools, recording consecutive requests at the provider transport
boundary. It proves Astra/medium → Opus/high → held Opus/high without a one-request
lag. Authentication, Jev and provider transports are controlled: no paid live inference
or probabilistic routing-quality benchmark is claimed.

Source boundaries: `src/config.ts` owns profiles/configuration, `src/jev.ts` owns
bounded evidence, the three-question contract and validation, and `src/index.ts`
owns lifecycle, cancellation, selection and status.