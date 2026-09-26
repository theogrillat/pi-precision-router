---
name: precision-router-setup
description: Set up or revise pi-precision-router through a short conversation. Discover available providers and models, choose a model and effort roster, and write the confirmed global or project configuration.
---

# Precision router setup

Help the user get a working config in a short chat, not a long questionnaire.
Discover first, propose concrete defaults, then ask for approval. Use ordinary
chat if no structured question tool is available. Do not install dependencies,
change provider credentials, or run paid inference without permission.

Paths below are relative to this skill directory, not the user's project.
Read `../../src/config.ts` for the current validation rules and
`../../examples/pi-precision-router.json` for the config shape.

## 1. Discover before asking

- Run `pi --version` and `pi --list-models` from the user's project directory.
  Keep their normal extension discovery enabled so custom providers can load.
  Summarize available providers and a small selection of models; do not dump
  a huge catalog into chat. Use exact provider/model IDs from the output.
- If Pi is missing, explain that Pi 0.87.1+ is required and stop. If discovery
  fails or returns no models, report the problem and help the user configure
  provider access in Pi (for example, `/login`), then rerun discovery. Do not
  substitute a generic catalog or invent available models.
- CLI discovery reflects a new process. If session-only custom providers or
  credentials are involved, ask the user to confirm availability in their
  current session rather than claiming the lists are identical.
- Check whether `TYPESAFE_API_KEY` is nonblank without printing its value:

  ```sh
  node -e 'console.log(process.env.TYPESAFE_API_KEY?.trim() ? "TYPESAFE_API_KEY: set" : "TYPESAFE_API_KEY: missing")'
  ```

  Never dump environment variables, shell profiles, or auth files. Never run
  credential-printing commands or ask the user to paste a key into chat.
  A missing key does not prevent drafting the config. Tell the user to export
  it privately and restart Pi from that environment; changing a child shell
  cannot update the running Pi process.
- Inspect existing global and project router configs, if present. The global
  path is `${PI_CODING_AGENT_DIR}/pi-precision-router.json` when set, otherwise
  `~/.pi/agent/pi-precision-router.json`; the project path is
  `<cwd>/.pi/pi-precision-router.json`. Before displaying old configs, redact
  any legacy `apiKey` value. Do not echo secrets in diffs or errors.
  Project fields override global fields; arrays and objects replace rather
  than merge. Flag project overrides that would hide a global change.

## 2. Have a short conversation

In one compact message, summarize what you found and ask:

1. **Where should the config be saved: globally or scoped to this project?**
   Show both resolved paths: the global agent-directory config and
   `<cwd>/.pi/pi-precision-router.json`. Explain that global applies across
   projects, while project config overrides global settings here. Require the
   user's choice before writing; never silently choose a scope.
2. Which discovered models should participate? Propose 2–4 complementary
   candidates if available, explaining the intended role of each. One is fine.
   Ask about exclusions or subscription/provider preferences, not API keys.
3. What matters most: correctness, speed, or a balance? Propose a short
   `preferences` sentence and four effort labels: `low` (straightforward),
   `medium` (several reasoning steps), `high` (difficult), `xhigh` (hardest).
   Offer to retain an existing roster rather than replacing it by default.

Use answers already given; do not repeat questions. Treat model strengths and
speed as proposals to confirm, not facts inferred from a model's name. Keep
existing descriptions unless the user wants them changed. Avoid claims that
preferences enforce a hard budget or quality guarantee.

Mention before approval: routing sends excerpts of requests, tool results, and
system/project instructions to TypeSafe. Ask whether this is acceptable along
with the proposed config, not in a separate lengthy privacy interview.

## 3. Build the proposal

- Include only confirmed, available models, with nonempty descriptions of their
  intended strengths, limitations, and speed. Never save placeholder IDs.
- Verify native thinking levels for each selected model. The CLI's `thinking`
  column is only yes/no; it does **not** prove support for `xhigh` or any other
  specific level. Consult the installed Pi model metadata and
  `getSupportedThinkingLevels(model)` from `@earendil-works/pi-ai`, the same
  check used in `../../src/index.ts`. Use custom-provider metadata when relevant,
  not a different built-in model with a similar name. If you cannot inspect it,
  ask the user to confirm the levels Pi offers for that model; do not guess.
- Map every effort label explicitly for each model. Allowed targets are `off`,
  `minimal`, `low`, `medium`, `high`, `xhigh`, and must be supported by that model.
  Never use `max`. Map all labels to `off` for non-reasoning models. Reusing a
  supported level for multiple labels is fine; explain any collapsed levels.
- Use 1–24 unique provider/model pairs and 1–12 effort labels. Labels must match
  `^[a-z][a-z0-9_-]{0,31}$` and not be Object prototype names. Descriptions must
  be nonblank and at most 2,000 characters; preferences at most 4,000.
- Omit `apiKey` and `apiKeyEnv` entirely. Authentication is environment-only.
  Keep `jevModel` at its default `jev-latest` and `notifyDecisions` false unless
  the user requests otherwise. Preserve valid existing optional settings.

Show the destination, a compact model/effort table, preferences, and any changes
to an existing config. Get explicit approval before writing. If native levels
remain unverified, resolve that first or leave an unsaved draft clearly marked
as incomplete.

## 4. Save and finish

After approval, create the parent directory if needed and write valid JSON only
to the chosen router config. Preserve unrelated existing settings. If legacy
credential fields are present, remove them without copying their secret into
chat or a backup. Do not change Pi's model registry, auth, or settings files.

Parse the saved JSON and check it against `../../src/config.ts`: allowed fields,
roster bounds, unique IDs, complete effort maps, and supported native levels.
Check the effective global-plus-project config as well, not just the saved file.
Do not claim a live routing test passed based on static validation.

Finish with the saved path, chosen models, and any remaining prerequisite.
Configuration is reread on each turn; an installed extension/skill may need
`/reload`, while a newly exported key requires restarting Pi. Suggest
`/precision-router on` if routing is paused. Offer `notifyDecisions: true` for an
optional user-approved live check, noting it makes a TypeSafe request. Do not
start another agent session or send a test prompt automatically.
