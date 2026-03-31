export function extractCustomerIdFromResourceName(resourceName: unknown): string | null {
  if (typeof resourceName !== 'string') return null
  const match = resourceName.match(/customers\/(\d+)\//i)
  return match?.[1] || null
}

