export function normalizeSqliteSql(sql: string): string {
  let result = sql

  // Handle IS_DELETED_TRUE/FALSE placeholders for SQLite (INTEGER 0/1).
  // Mirrors the placeholder patterns supported in PostgresAdapter.convertSqliteSyntax().
  //
  // Supported patterns:
  // 1) t.is_deleted = IS_DELETED_TRUE/FALSE  -> t.is_deleted = 1/0
  // 2) is_deleted = IS_DELETED_TRUE/FALSE    -> is_deleted = 1/0
  // 3) t.IS_DELETED_TRUE/FALSE               -> t.is_deleted = 1/0
  // 4) IS_DELETED_TRUE/FALSE                 -> is_deleted = 1/0

  result = result.replace(/(\w+\.is_deleted)\s*=\s*IS_DELETED_TRUE\b/g, '$1 = 1')
  result = result.replace(/(\w+\.is_deleted)\s*=\s*IS_DELETED_FALSE\b/g, '$1 = 0')

  result = result.replace(/\bis_deleted\s*=\s*IS_DELETED_TRUE\b/g, 'is_deleted = 1')
  result = result.replace(/\bis_deleted\s*=\s*IS_DELETED_FALSE\b/g, 'is_deleted = 0')

  result = result.replace(/\b(\w+)\.IS_DELETED_TRUE\b/g, '$1.is_deleted = 1')
  result = result.replace(/\b(\w+)\.IS_DELETED_FALSE\b/g, '$1.is_deleted = 0')

  result = result.replace(/\bIS_DELETED_TRUE\b/g, 'is_deleted = 1')
  result = result.replace(/\bIS_DELETED_FALSE\b/g, 'is_deleted = 0')

  return result
}

