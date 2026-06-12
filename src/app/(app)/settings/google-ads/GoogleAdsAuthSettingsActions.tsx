'use client'

import { Button } from '@/components/ui/button'
import { Key } from 'lucide-react'
import type { GoogleAdsAuthSettings } from './useGoogleAdsAuthSettings'

type Props = {
  auth: GoogleAdsAuthSettings
  saving: boolean
  onSaveOAuth: () => void
}

export function GoogleAdsAuthSettingsActions({ auth, saving, onSaveOAuth }: Props) {
  const {
    effectiveGoogleAdsAuthMethod,
    googleAdsAuthWriteBlocked,
    googleAdsDualStack,
    googleAdsAuthReadOnly,
    loadingGoogleAdsCredentialStatus,
    credentialStatusLoadError,
    googleAdsCredentialStatus,
    hasOAuthConfigToDelete,
    hasServiceAccountConfigToDelete,
    deletingOAuthConfig,
    deletingServiceAccountId,
    startingOAuth,
    verifyingGoogleAdsCredentials,
    oauthHasUnsavedChanges,
    savingServiceAccount,
    handleSaveServiceAccount,
    requestDeleteCurrentGoogleAdsConfig,
    handleStartGoogleAdsOAuth,
    handleVerifyGoogleAdsCredentials,
  } = auth

  const credentialStatusUnavailable =
    loadingGoogleAdsCredentialStatus ||
    (credentialStatusLoadError != null && !googleAdsCredentialStatus)

  return (
    <>
      <Button
        onClick={() => {
          if (effectiveGoogleAdsAuthMethod === 'service_account') {
            void handleSaveServiceAccount()
          } else {
            onSaveOAuth()
          }
        }}
        disabled={
          saving || savingServiceAccount || googleAdsAuthWriteBlocked || credentialStatusUnavailable
        }
      >
        {saving || savingServiceAccount ? '保存中...' : '保存配置'}
      </Button>

      <Button
        type="button"
        variant="destructive"
        onClick={requestDeleteCurrentGoogleAdsConfig}
        disabled={
          credentialStatusUnavailable ||
          googleAdsAuthReadOnly ||
          deletingOAuthConfig ||
          (effectiveGoogleAdsAuthMethod === 'oauth' && !hasOAuthConfigToDelete) ||
          (effectiveGoogleAdsAuthMethod === 'service_account' &&
            (!!deletingServiceAccountId || !hasServiceAccountConfigToDelete))
        }
      >
        {effectiveGoogleAdsAuthMethod === 'oauth' ? '删除 OAuth 配置' : '删除服务账号配置'}
      </Button>

      {effectiveGoogleAdsAuthMethod === 'oauth' && (
        <Button
          onClick={() => void handleStartGoogleAdsOAuth()}
          disabled={startingOAuth || googleAdsAuthWriteBlocked || credentialStatusUnavailable}
          variant="outline"
        >
          <Key className="w-4 h-4 mr-2" />
          {startingOAuth ? '启动中...' : '启动 OAuth 授权'}
        </Button>
      )}

      {googleAdsCredentialStatus?.hasCredentials && (
        <Button
          type="button"
          variant="outline"
          onClick={() => void handleVerifyGoogleAdsCredentials()}
          disabled={
            verifyingGoogleAdsCredentials ||
            credentialStatusUnavailable ||
            googleAdsDualStack ||
            (effectiveGoogleAdsAuthMethod === 'oauth' && oauthHasUnsavedChanges())
          }
        >
          {verifyingGoogleAdsCredentials ? '验证中...' : '验证凭证'}
        </Button>
      )}
    </>
  )
}
