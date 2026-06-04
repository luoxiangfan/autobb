/**
 * Normalize migration SQL before execution in wrapped transactions.
 */
export function normalizeMigrationSql(content: string, dbType: 'sqlite' | 'postgres'): string {
  let normalized = stripTopLevelTransactionWrappers(content)
  if (dbType === 'sqlite') {
    normalized = normalized.replace(/\bADD COLUMN IF NOT EXISTS\b/gi, 'ADD COLUMN')
  }
  return normalized
}

export function isIgnorableSqliteMigrationApplyError(stderr: string): boolean {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return true
  return lines.every((line) => {
    const lower = line.toLowerCase()
    return (
      lower.includes('duplicate column name') ||
      lower.includes('already exists') ||
      lower.includes('unique constraint failed: prompt_versions.prompt_id, prompt_versions.version')
    )
  })
}

/**
 * Strip top-level transaction wrappers from migration SQL so callers can wrap execution safely.
 */
export function stripTopLevelTransactionWrappers(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*BEGIN\s+TRANSACTION\s*;?\s*$/i.test(line))
    .filter((line) => !/^\s*COMMIT\s*;?\s*$/i.test(line))
    .join('\n')
}
