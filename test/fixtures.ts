export const fixtureConfig = {
  efforts: {
    low: "Straightforward work",
    medium: "Several reasoning steps",
    high: "Difficult reasoning",
    xhigh: "Hardest problems",
  },
  models: [
    ["anthropic", "claude-opus-5-5"],
    ["openai-codex", "gpt-6-astra"],
    ["openai-codex", "gpt-6-sol"],
  ].map(([provider, id]) => ({
    provider,
    id,
    description: "Test model",
    effortMap: { low: "low", medium: "medium", high: "high", xhigh: "xhigh" },
  })),
};
