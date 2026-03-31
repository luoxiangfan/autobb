export function normalizeSqliteParams(params: any[]): any[] {
  return params.map((value, index) => {
    if (value === undefined) return null
    if (typeof value === 'boolean') return value ? 1 : 0
    if (value instanceof Date) return value.toISOString()
    if (
      value === null ||
      typeof value === 'number' ||
      typeof value === 'string' ||
      typeof value === 'bigint' ||
      Buffer.isBuffer(value)
    ) {
      return value
    }

    const valueType = value?.constructor?.name || typeof value
    throw new TypeError(
      `SQLite parameter at index ${index} has unsupported type (${valueType}). ` +
        `Only numbers, strings, bigints, buffers, booleans, dates, null, and undefined are supported.`
    )
  })
}

