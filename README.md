# pi-precision-router

Quality-first concrete-model routing before each main-agent step in Pi.

## Try it locally

Requires Pi 0.87.1+ and Node 22.19+ (development tested on Node 24).

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
2. **Effort**: exactly low, medium, high or xhigh; never off, minimal or max.
3. **Benefit**: hold, or a specific model with meaningful quality gain, or a
   specific model with substantial speed gain while quality is preserved.

The top valid model choice is applied directly each step, with no confidence,
winning-probability or margin threshold. The independent benefit verdict is
advisory only: even `hold` does not veto a different model choice. There is no
current-model or prompt-cache preference. Quality improvements are not capped
by dollars or estimated cache cost.

The top valid effort choice is also applied every step, without confidence,
probability or margin thresholds. Use the named native level when supported;
otherwise map to the nearest supported non-max level, choosing higher on ties.
Models without reasoning map to `off`. Notifications explain adaptations.

In the current Pi registry, all six default models (Luna, Sol, Astra, Opus 5.5,
Fable 5.1 and Sonnet 5) support all four named levels, so their mappings are
identity mappings: low → low, medium → medium, high → high, xhigh → xhigh.
Sol is reasoning-capable; its additional support for `off` does not cause the
router to select `off`. Mapping uses each model's live Pi capability metadata.

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
directory. Fields replace earlier values; `models` replaces the whole array, not
individual entries. Configuration is read on each turn. Unknown top-level fields,
invalid values, empty/duplicate rosters and malformed JSON fail closed for routing.

```json
{
  "apiKeyEnv": "TYPESAFE_API_KEY",
  "jevModel": "jev-latest",
  "preferences": "Prefer concise explanations and tightly scoped code changes.",
  "models": [
    {
      "provider": "anthropic",
      "id": "claude-opus-5-5",
      "description": "My default for substantive coding."
    }
  ]
}
```

The endpoint is fixed to `https://api.typesafe.ai/v1/systemone`. A nonblank `apiKey` in configuration takes precedence over the environment variable
named by `apiKeyEnv` (default `TYPESAFE_API_KEY`). Both values are trimmed; a blank
configured key falls back to the environment. For example, put
`{"apiKey": "your-key"}` in `~/.pi/agent/pi-precision-router.json`. Keep this file
private (permissions `0600`) and never commit it. Credentials are never put in
routing state or reports. Malformed configuration errors omit file contents.
Missing models are warned about and excluded, never silently substituted.
Only exact configured, available provider/model pairs can be selected.

Initial IDs were verified with the installed `pi --list-models` registry:

| Provider | Model | User preference |
| --- | --- | --- |
| openai-codex | gpt-6-luna | Extremely fast/cheap, weak reasoning; genuinely trivial work |
| openai-codex | gpt-6-sol | Opus-like general capability; routine discussion, clear concise explanations; less-preferred code |
| openai-codex | gpt-6-astra | Top general-purpose choice; demanding discussion and nuanced reasoning; less strong than Fable at hardest coding |
| anthropic | claude-opus-5-5 | Default substantive coding; improved speed/verbosity reports are provisional |
| anthropic | claude-fable-5-1 | Hardest engineering; strong code, slower and more verbose |
| anthropic | claude-sonnet-5 | Fast straightforward work, between Luna and Opus; limited personal experience |

Profiles are user observations, not verified benchmarks or hidden ordered tiers.
Anthropic is generally preferred for code and scope adherence; OpenAI for speed,
low verbosity and readability. Edit the descriptions to reflect your experience.

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