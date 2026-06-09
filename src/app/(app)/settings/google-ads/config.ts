import type { GoogleAdsSettingField } from './types'

export const GOOGLE_ADS_SETTING_METADATA: Record<
  string,
  {
    label: string
    description: string
    placeholder?: string
    helpLink?: string
  }
> = {
  'google_ads.login_customer_id': {
    label: 'Login Customer ID (MCC账户ID)',
    description: '您的MCC管理账户ID，用于访问您管理的广告账户。格式：10位数字（不含连字符）',
    placeholder: '例如: 1234567890',
    helpLink: '/help/google-ads-setup?tab=oauth',
  },
  'google_ads.client_id': {
    label: 'OAuth Client ID',
    description: 'Google Cloud Console 中创建的 OAuth 2.0 客户端 ID',
    placeholder: '例如: 123456789-xxx.apps.googleusercontent.com',
    helpLink: '/help/google-ads-setup?tab=oauth#oauth-client-id',
  },
  'google_ads.client_secret': {
    label: 'OAuth Client Secret',
    description: 'OAuth 2.0 客户端密钥，与 Client ID 配对使用',
    placeholder: '输入 Client Secret',
  },
  'google_ads.developer_token': {
    label: 'Developer Token',
    description:
      'Google Ads API 开发者令牌。必须与 Client ID 在同一个 GCP Project 中申请，否则会报错',
    placeholder: '输入 Developer Token',
    helpLink: '/help/google-ads-setup?tab=oauth#oauth-developer-token',
  },
}

export const GOOGLE_ADS_CATEGORY_FIELDS: GoogleAdsSettingField[] = [
  { key: 'login_customer_id', dataType: 'string', isSensitive: false, isRequired: true },
  { key: 'client_id', dataType: 'string', isSensitive: true, isRequired: true },
  { key: 'client_secret', dataType: 'string', isSensitive: true, isRequired: true },
  { key: 'developer_token', dataType: 'string', isSensitive: true, isRequired: true },
]
