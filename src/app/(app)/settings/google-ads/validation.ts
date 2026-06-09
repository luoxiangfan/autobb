const PLACEHOLDER = '············'

export function validateGoogleAdsOAuthForm(
  formData: Record<string, string> | undefined
): string | null {
  const loginCustomerId = formData?.login_customer_id
  const clientId = formData?.client_id
  const clientSecret = formData?.client_secret
  const developerToken = formData?.developer_token

  const isValidValue = (v: string | undefined) => v && v.trim() !== '' && v !== PLACEHOLDER

  if (!isValidValue(loginCustomerId)) {
    return 'Login Customer ID (MCC账户ID) 是必填项'
  }
  if (!isValidValue(clientId)) {
    return 'OAuth Client ID 是必填项'
  }
  if (!isValidValue(clientSecret)) {
    return 'OAuth Client Secret 是必填项'
  }
  if (!isValidValue(developerToken)) {
    return 'Developer Token 是必填项'
  }
  return null
}

export function normalizeGoogleAdsFormForCompare(
  record: Record<string, string> | undefined
): Record<string, string> {
  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(record || {})) {
    normalized[key] = String(rawValue || '')
  }
  return normalized
}

export function hasGoogleAdsUnsavedChanges(
  formData: Record<string, string> | undefined,
  savedFormData: Record<string, string> | undefined
): boolean {
  return (
    JSON.stringify(normalizeGoogleAdsFormForCompare(formData)) !==
    JSON.stringify(normalizeGoogleAdsFormForCompare(savedFormData))
  )
}
