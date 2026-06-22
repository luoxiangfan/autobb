export function pickNonEmptyString(...values: Array<unknown>): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (trimmed) return trimmed
  }
  return null
}

export function pickTopUniqueLines(input: unknown, limit: number): string[] {
  if (!Array.isArray(input) || limit <= 0) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of input) {
    if (typeof item !== 'string') continue
    const line = item.replace(/\s+/g, ' ').trim()
    if (!line) continue
    const key = line.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(line)
    if (out.length >= limit) break
  }
  return out
}
