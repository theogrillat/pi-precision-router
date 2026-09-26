# pi-precision-router

A Pi extension that uses TypeSafe Jev to choose a model and thinking level before
each agent step, including follow-ups after tool calls.

## Setup

Requires Pi 0.87.1+ and Node 22.19+.

```sh
pi install git:github.com/theogrillat/pi-precision-router
```

Export `TYPESAFE_API_KEY` in your shell, start Pi, then run:

```text
/skill:precision-router-setup
```

The agent discovers available providers and models, helps choose your model/effort
roster, and asks before saving a global or project config. If Pi is already running,
use `/reload` to discover the installed skill.

Prefer manual setup? Copy [the example config](examples/pi-precision-router.json)
to `~/.pi/agent/pi-precision-router.json` and replace the placeholders.
Run only one model router at a time.

## Configuration

There are no built-in model choices. Your config defines:

| Field | Purpose |
| --- | --- |
| `models` | Provider, model ID, description, and `effortMap` for each candidate. |
| `efforts` | Effort labels and descriptions Jev chooses between. |
| `preferences` | Your routing priorities. |
| `jevModel` | TypeSafe evaluator model; defaults to `jev-latest`. |
| `notifyDecisions` | Show a notification for every routing attempt; defaults to `false`. |

Each model's `effortMap` must cover every effort label and use thinking levels that
model supports: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. For models
without reasoning, map every label to `off`.

Project settings in `.pi/pi-precision-router.json` override global settings.
Arrays and objects are replaced, not merged. Config is reread each turn.
`PI_CODING_AGENT_DIR` overrides the global config directory.

Authentication uses **only `TYPESAFE_API_KEY`**. Remove `apiKey` and `apiKeyEnv`
from older configs; neither is accepted.

## Usage

Routing starts enabled. Use `/precision-router off` to pause and
`/precision-router on` to resume. Manual model selection does not pause routing.

The router applies Jev's chosen model and effort without confidence thresholds.
Only configured, available models can be selected. Missing configuration, invalid
responses, or a Jev timeout leave your current settings unchanged.

Jev requests have a two-second timeout and no retries. An already-started Pi model
switch can take longer and cannot be cancelled by the extension.

## Privacy

Each routing request sends TypeSafe excerpts of your current request, recent
messages (including tool results), system/project instructions, model descriptions,
and preferences. Images and reasoning blocks are excluded.

**These excerpts may contain private code or instructions.** Use this extension
only where sending that content to TypeSafe is acceptable.

## Development

```sh
npm run typecheck
npm test
```

Tests use controlled Jev and provider responses, not paid live inference.
