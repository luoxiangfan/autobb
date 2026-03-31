export type DbType = 'postgres' | 'sqlite'

export function buildAdminUsersOrderBy(params: {
  sortBy: string
  sortOrder: 'ASC' | 'DESC'
  dbType: DbType
}): string {
  const { sortBy, sortOrder, dbType } = params
  const orderByWithNullsLast = (column: string) => `(${column} IS NULL) ASC, ${column} ${sortOrder}`

  // users.locked_until 在 PostgreSQL schema 中是 TEXT（历史兼容），需要显式 cast 才能与 NOW() 比较
  const lockedAfterNowExpr =
    dbType === 'postgres'
      ? `(locked_until IS NOT NULL AND NULLIF(locked_until, '')::timestamptz > NOW())`
      : `(locked_until IS NOT NULL AND locked_until > datetime('now'))`

  switch (sortBy) {
    case 'id':
      return `id ${sortOrder}`
    case 'username':
      return `username ${sortOrder}`
    case 'role':
      return `role ${sortOrder}`
    case 'packageType':
      return `package_type ${sortOrder}`
    case 'packageExpiresAt':
      return orderByWithNullsLast('package_expires_at')
    case 'createdAt':
      return `created_at ${sortOrder}`
    case 'lastLoginAt':
      return orderByWithNullsLast('last_login_at')
    case 'status': {
      // 0: disabled, 1: locked, 2: normal
      const isActiveFalse = dbType === 'postgres' ? 'FALSE' : '0'
      const statusRank = `
        CASE
          WHEN is_active = ${isActiveFalse} THEN 0
          WHEN ${lockedAfterNowExpr} THEN 1
          ELSE 2
        END
      `
      return `${statusRank} ${sortOrder}, created_at DESC`
    }
    default:
      return `created_at DESC`
  }
}

