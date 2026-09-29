export function matchScreenshotSources<T extends { display_id: string }>(
  displays: readonly { id: number }[],
  sources: readonly T[],
): T[] | null {
  if (displays.length === 0) return null
  if (displays.length === 1 && sources.length === 1) return [sources[0]]
  const matched = displays.map((display) =>
    sources.find((source) => source.display_id === String(display.id)),
  )
  if (matched.some((source) => !source) || new Set(matched).size !== displays.length) return null
  return matched as T[]
}
