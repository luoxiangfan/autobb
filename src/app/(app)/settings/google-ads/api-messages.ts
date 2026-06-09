export function formatGoogleAdsAuthSaveError(status: number, message?: string | null): string {
  const trimmed = message?.trim()
  if (status === 409) {
    return trimmed || '请先删除另一种 Google Ads 认证方式后再保存'
  }
  return trimmed || '保存失败'
}
