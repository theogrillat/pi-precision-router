<a id="top"></a>

<div align="center">

# 🎯 Pi Precision Router

**Per-step model and thinking-level routing for [Pi](https://pi.dev/docs/extensions), powered by TypeSafe Jev.**

[![CI](https://github.com/theogrillat/pi-precision-router/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/theogrillat/pi-precision-router/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/pi-precision-router)](https://www.npmjs.com/package/pi-precision-router)
[![npm downloads](https://img.shields.io/npm/dm/pi-precision-router)](https://www.npmjs.com/package/pi-precision-router)
[![Node](https://img.shields.io/node/v/pi-precision-router)](package.json)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-3178c6)](tsconfig.json)
[![License](https://img.shields.io/npm/l/pi-precision-router)](LICENSE)

[**Why**](#-why) · [**Install**](#-install) · [**Use**](#-use) · [**How it works**](#-how-it-works)

</div>

---

## 🤔 Why

> **One model and one thinking level rarely fit every step of a session.**
> Hard reasoning deserves your strongest model; routine follow-ups after tool calls do not.

This extension asks TypeSafe Jev to choose a model and thinking level before each agent step, including follow-ups after tool calls. You define the candidates and your priorities; Jev picks among them.

---

## 📦 Install

Install the published [npm package](https://www.npmjs.com/package/pi-precision-router). Requires Pi 0.87.1+ and Node 22.19+.

```sh
pi install npm:pi-precision-router
```

🔑 Export your TypeSafe API key, start Pi, then run the setup skill:

```sh
export TYPESAFE_API_KEY="your-api-key"
```

```text
/skill:precision-router-setup
```

The agent discovers available providers and models, helps choose your model/effort roster, and asks before saving a global or project config. If Pi is already running, use `/reload` to discover the installed skill.

Prefer manual setup? Copy [the example config](examples/pi-precision-router.json) to `~/.pi/agent/pi-precision-router.json` and replace the placeholders.

---

## 🧭 Use

Routing starts enabled. Manual model selection does not pause routing.

| Command                          | Action                           |
| -------------------------------- | -------------------------------- |
| `/precision-router off`          | Pause routing.                   |
| `/precision-router on`           | Resume routing.                  |
| `/precision-router feedback on`  | Show per-turn routing decisions. |
| `/precision-router feedback off` | Hide per-turn routing decisions. |

Feedback commands override `notifyDecisions` for the current session without changing your config or pausing routing. A new session or extension reload restores the config default.

There are no built-in model choices. Your config defines:

| Field             | Purpose                                                              |
| ----------------- | -------------------------------------------------------------------- |
| `models`          | Provider, model ID, description, and `effortMap` for each candidate. |
| `efforts`         | Effort labels and descriptions Jev chooses between.                  |
| `preferences`     | Your routing priorities.                                             |
| `jevModel`        | TypeSafe evaluator model; defaults to `jev-latest`.                  |
| `notifyDecisions` | Show a notification for every routing attempt; defaults to `false`.  |

Each model's `effortMap` must cover every effort label and use thinking levels that model supports: `off`, `minimal`, `low`, `medium`, `high`, or `xhigh`. For models without reasoning, map every label to `off`.

> [!TIP]
> Project settings in `.pi/pi-precision-router.json` override global settings. Arrays and objects are replaced, not merged. Config is reread each turn. `PI_CODING_AGENT_DIR` overrides the global config directory.

---

## 🔍 How it works

Before each agent step, the router sends Jev a routing request and applies the chosen model and effort without confidence thresholds. Only configured, available models can be selected. Missing configuration, invalid responses, or a Jev timeout leave your current settings unchanged.

Jev requests have a two-second timeout and no retries. An already-started Pi model switch can take longer and cannot be cancelled by the extension.

Each routing request sends TypeSafe excerpts of your current request, recent messages (including tool results), system/project instructions, model descriptions, and preferences. Images and reasoning blocks are excluded.

> [!WARNING]
> **These excerpts may contain private code or instructions.** Use this extension only where sending that content to TypeSafe is acceptable.

<div align="center">

<sub>Released under the [MIT License](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)</sub>

<a href="#top">⬆ Back to top</a>

</div>
