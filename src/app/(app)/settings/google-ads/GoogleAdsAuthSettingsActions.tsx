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
    googleAdsAuthMethod,
    googleAdsAuthActionsBlocked,
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
  return (
    <>
      <Button
        onClick={() => {
          if (googleAdsAuthMethod === 'service_account') {
            void handleSaveServiceAccount()
          } else {
            onSaveOAuth()
          }
        }}
        disabled={saving || savingServiceAccount || googleAdsAuthActionsBlocked}
      >
        {saving || savingServiceAccount ? '保存中...' : '保存配置'}
      </Button>

      <Button
        type="button"
        variant="destructive"
        onClick={requestDeleteCurrentGoogleAdsConfig}
        disabled={
          googleAdsAuthActionsBlocked ||
          deletingOAuthConfig ||
          (googleAdsAuthMethod === 'oauth' && !hasOAuthConfigToDelete) ||
          (googleAdsAuthMethod === 'service_account' &&
            (!!deletingServiceAccountId || !hasServiceAccountConfigToDelete))
        }
      >
        删除当前配置
      </Button>

      {googleAdsAuthMethod === 'oauth' && (
        <Button
          onClick={() => void handleStartGoogleAdsOAuth()}
          disabled={startingOAuth || googleAdsAuthActionsBlocked}
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
            verifyingGoogleAdsCredentials || googleAdsAuthActionsBlocked || oauthHasUnsavedChanges()
          }
        >
          {verifyingGoogleAdsCredentials ? '验证中...' : '验证凭证'}
        </Button>
      )}
    </>
  )
}
