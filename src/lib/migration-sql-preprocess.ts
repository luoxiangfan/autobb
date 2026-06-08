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

/**
 * Strip top-level transaction wrappers from migration SQL so callers can wrap execution safely.
 */
function stripTopLevelTransactionWrappers(content: string): string {
  return content
    .split('\n')
    .filter((line) => !/^\s*BEGIN\s+TRANSACTION\s*;?\s*$/i.test(line))
    .filter((line) => !/^\s*COMMIT\s*;?\s*$/i.test(line))
    .join('\n')
}
