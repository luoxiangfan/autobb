/**
 * Normalize migration SQL before execution in wrapped transactions.
 */
export function normalizeMigrationSql(content: string): string {
  return stripTopLevelTransactionWrappers(content)
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
