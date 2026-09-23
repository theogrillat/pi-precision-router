export function mappedEffort(
  choice: string,
  mapping: Record<string, string>,
  supported: readonly string[],
): string {
  if (!Object.hasOwn(mapping, choice))
    throw new Error("Missing effort mapping");
  const native = mapping[choice];
  if (native === "max" || !supported.includes(native))
    throw new Error(
      `Configured effort mapping ${choice} → ${native} is unsupported by the selected model`,
    );
  return native;
}
