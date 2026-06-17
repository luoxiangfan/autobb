export function buildAdminUsersOrderBy(params: {
  sortBy: string
  sortOrder: 'ASC' | 'DESC'
}): string {
  const { sortBy, sortOrder } = params
  const orderByWithNullsLast = (column: string) => `(${column} IS NULL) ASC, ${column} ${sortOrder}`

  const lockedAfterNowExpr =
    "(locked_until IS NOT NULL AND NULLIF(locked_until, '')::timestamptz > NOW())"

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
      const statusRank = `
        CASE
          WHEN is_active = FALSE THEN 0
          WHEN ${lockedAfterNowExpr} THEN 1
          ELSE 2
        END
      `
      return `${statusRank} ${sortOrder}, username ASC`
    }
    default:
      return `created_at DESC`
  }
}
