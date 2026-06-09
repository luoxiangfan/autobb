export interface GoogleAdsAccount {
  customerId: string
  descriptiveName: string
  currencyCode: string
  timeZone: string
  manager: boolean
  testAccount: boolean
  status?: string
}

export interface GoogleAdsCredentialStatus {
  hasCredentials: boolean
  hasRefreshToken?: boolean
  hasServiceAccount?: boolean
  serviceAccountId?: string | null
  serviceAccountName?: string | null
  authType?: 'oauth' | 'service_account'
  clientId?: string | null
  clientIdConfigured?: boolean
  developerToken?: string | null
  developerTokenConfigured?: boolean
  clientSecretConfigured?: boolean
  loginCustomerId?: string
  apiAccessLevel?: 'test' | 'explorer' | 'basic' | 'standard'
  lastVerifiedAt?: string
  isActive?: boolean
  assignmentMode?: 'own' | 'shared_admin'
  canModify?: boolean
  isShared?: boolean
  sharedAdminEmail?: string | null
  sharedAdminUsername?: string | null
  authConfigWarning?: string | null
  dualStack?: boolean
}

export type GoogleAdsDeleteConfirmState =
  | { kind: 'oauth' }
  | { kind: 'service_account'; serviceAccountId: string }
  | null

export interface GoogleAdsSettingField {
  key: string
  dataType: string
  isSensitive: boolean
  isRequired: boolean
}
