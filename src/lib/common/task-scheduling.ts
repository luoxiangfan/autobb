/**
 * Shared scheduling filters for domain tasks (click-farm, url-swap, etc.).
 */
export function filterRowsByUserPackageExpiry<
  T extends { user_package_expires_at?: string | null | undefined },
>(rows: T[], nowMs: number = Date.now()): T[] {
  return rows.filter((row) => {
    const expiresAt = row.user_package_expires_at
    if (!expiresAt) return true
    const expiry = new Date(expiresAt)
    if (!Number.isFinite(expiry.getTime())) return false
    return expiry.getTime() >= nowMs
  })
}
