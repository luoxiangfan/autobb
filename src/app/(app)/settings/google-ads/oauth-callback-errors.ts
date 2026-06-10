export const GOOGLE_ADS_OAUTH_CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  missing_code: 'OAuth 授权失败：缺少授权码',
  missing_state: 'OAuth 授权失败：缺少状态参数',
  invalid_state: 'OAuth 授权失败：无效的状态参数',
  state_expired: 'OAuth 授权失败：状态参数已过期',
  missing_google_ads_config: 'OAuth 授权失败：请先保存 Client ID、Client Secret 和 Developer Token',
  missing_login_customer_id: 'OAuth 授权失败：请先配置并保存 Login Customer ID (MCC)',
  developer_token_invalid:
    'OAuth 授权失败：Developer Token 配置无效，请检查是否误填为 Client Secret',
  shared_auth_readonly: '当前使用管理员共享认证，无法自行完成 OAuth 授权',
  auth_conflict:
    'OAuth 授权失败：当前已配置服务账号认证，请先在设置页删除服务账号后再完成 OAuth 授权',
  callback_failed: 'OAuth 授权失败：回调处理异常，请重试',
  unauthorized: 'OAuth 授权失败：请先登录后再完成授权回调',
  session_mismatch: 'OAuth 授权失败：登录用户与发起授权的用户不一致，请重新发起授权',
  legacy_oauth_callback_uri:
    'OAuth 回调地址已变更：请在 Google Cloud Console 中将 Redirect URI 更新为 /api/google-ads/oauth/callback，并使用「启动 OAuth 授权」重新授权',
}

export function resolveGoogleAdsOAuthCallbackErrorMessage(code: string): string {
  return GOOGLE_ADS_OAUTH_CALLBACK_ERROR_MESSAGES[code] ?? `OAuth 授权失败：${code}`
}
