const levels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

export function supportedEffort(
  requested: string,
  supported: readonly string[],
): string {
  const candidates = levels.filter(
    (level) => level !== "max" && supported.includes(level),
  );
  if (!candidates.length)
    throw new Error("No supported non-max reasoning effort");
  const target = levels.indexOf(requested);
  if (target < 0) throw new Error("Unknown reasoning effort");
  return candidates.reduce((nearest, level) =>
    Math.abs(levels.indexOf(level) - target) <=
    Math.abs(levels.indexOf(nearest) - target)
      ? level
      : nearest,
  );
}
