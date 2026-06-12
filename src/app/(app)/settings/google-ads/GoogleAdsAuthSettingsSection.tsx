'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Info,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Trash2,
} from 'lucide-react'
import { GoogleAdsServiceAccountPermissionAlert } from '@/components/GoogleAdsServiceAccountPermissionAlert'
import { Skeleton } from '@/components/ui/skeleton'
import { hasServiceAccountPermissionDetails } from '@/lib/google-ads/accounts/fetch'
import { GOOGLE_ADS_SETTING_METADATA } from './config'
import type { GoogleAdsAuthSettings } from './useGoogleAdsAuthSettings'

interface Setting {
  key: string
  value: string | null
  dataType: string
  isSensitive: boolean
  isRequired: boolean
  description?: string | null
}

type Props = {
  auth: GoogleAdsAuthSettings
  categorySettings: Setting[]
  renderOAuthField: (setting: Setting) => ReactNode
}

export function GoogleAdsAuthSettingsSection({ auth, categorySettings, renderOAuthField }: Props) {
  const {
    googleAdsCredentialStatus,
    loadingGoogleAdsCredentialStatus,
    credentialStatusLoadError,
    retryLoadGoogleAdsCredentialStatus,
    googleAdsAccounts,
    loadingGoogleAdsAccounts,
    showGoogleAdsAccounts,
    setShowGoogleAdsAccounts,
    setGoogleAdsAuthMethod,
    effectiveGoogleAdsAuthMethod,
    googleAdsAuthMethodLocked,
    serviceAccountForm,
    setServiceAccountForm,
    serviceAccounts,
    deletingServiceAccountId,
    deletingOAuthConfig,
    permissionError,
    dismissGoogleAdsAccountsPermissionError,
    googleAdsAuthReadOnly,
    googleAdsAuthWriteBlocked,
    googleAdsDualStack,
    hasOAuthConfigToDelete,
    fetchServiceAccounts,
    handleFetchGoogleAdsAccounts,
    requestDeleteOAuthConfig,
    requestDeleteServiceAccount,
    hasServiceAccountConfigToDelete,
    savingServiceAccount,
  } = auth

  const [showServiceAccountReplaceForm, setShowServiceAccountReplaceForm] = useState(false)
  const prevSavingServiceAccountRef = useRef(false)

  useEffect(() => {
    if (!hasServiceAccountConfigToDelete) {
      setShowServiceAccountReplaceForm(false)
    }
  }, [hasServiceAccountConfigToDelete])

  useEffect(() => {
    const wasSaving = prevSavingServiceAccountRef.current
    prevSavingServiceAccountRef.current = savingServiceAccount
    if (!wasSaving || savingServiceAccount || !hasServiceAccountConfigToDelete) {
      return
    }
    const formEmpty =
      !serviceAccountForm.name &&
      !serviceAccountForm.mccCustomerId &&
      !serviceAccountForm.developerToken &&
      !serviceAccountForm.serviceAccountJson
    if (formEmpty) {
      setShowServiceAccountReplaceForm(false)
    }
  }, [savingServiceAccount, hasServiceAccountConfigToDelete, serviceAccountForm])

  if (loadingGoogleAdsCredentialStatus) {
    return (
      <div className="space-y-6" aria-busy="true" aria-label="正在加载 Google Ads 认证配置">
        <Skeleton className="h-20 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (credentialStatusLoadError && !googleAdsCredentialStatus) {
    return (
      <div
        className="p-4 bg-red-50 border border-red-200 rounded-lg space-y-3"
        role="alert"
        aria-live="polite"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-800">无法加载 Google Ads 认证状态</p>
            <p className="text-sm text-red-700 mt-1">{credentialStatusLoadError}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void retryLoadGoogleAdsCredentialStatus()}
        >
          重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {credentialStatusLoadError && googleAdsCredentialStatus && (
        <div
          className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex flex-wrap items-center justify-between gap-3"
          role="status"
        >
          <div className="flex items-start gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              认证状态刷新失败，当前显示的可能不是最新数据：{credentialStatusLoadError}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void retryLoadGoogleAdsCredentialStatus()}
          >
            重试
          </Button>
        </div>
      )}

      {googleAdsAuthReadOnly && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-800 font-medium">
            当前使用管理员共享的 Google Ads 认证配置
          </p>
          <p className="text-sm text-blue-700 mt-1">
            {googleAdsCredentialStatus?.sharedAdminUsername ||
            googleAdsCredentialStatus?.sharedAdminEmail
              ? `共享自：${googleAdsCredentialStatus?.sharedAdminUsername ?? ''}${googleAdsCredentialStatus?.sharedAdminEmail ? ` (${googleAdsCredentialStatus.sharedAdminEmail})` : ''}`
              : '您无法自行修改或删除此配置，如需变更请联系管理员。'}
          </p>
        </div>
      )}

      {googleAdsCredentialStatus?.authConfigWarning && (
        <div className="p-4 bg-amber-50 border border-amber-400 rounded-lg">
          <p className="text-sm font-semibold text-amber-900">认证配置提醒</p>
          <p className="text-sm text-amber-800 mt-1 whitespace-pre-line">
            {googleAdsCredentialStatus.authConfigWarning}
          </p>
          <p className="text-sm text-amber-900 mt-2">
            请使用上方按钮删除其中一种认证方式后再继续使用。
          </p>
          {!googleAdsAuthReadOnly && (
            <div className="mt-3 flex flex-wrap gap-2">
              {hasOAuthConfigToDelete && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deletingOAuthConfig}
                  onClick={requestDeleteOAuthConfig}
                >
                  {deletingOAuthConfig ? '删除中...' : '删除 OAuth 配置'}
                </Button>
              )}
              {googleAdsCredentialStatus?.serviceAccountId && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  disabled={deletingServiceAccountId === googleAdsCredentialStatus.serviceAccountId}
                  onClick={() =>
                    requestDeleteServiceAccount(googleAdsCredentialStatus.serviceAccountId!)
                  }
                >
                  {deletingServiceAccountId === googleAdsCredentialStatus.serviceAccountId
                    ? '删除中...'
                    : '删除服务账号配置'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {googleAdsCredentialStatus?.hasCredentials ? (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <span className="font-semibold text-green-700">已完成配置和授权</span>
            </div>
            {googleAdsCredentialStatus.loginCustomerId && (
              <p className="text-sm text-green-700">
                MCC ID:{' '}
                <span className="font-mono">{googleAdsCredentialStatus.loginCustomerId}</span>
              </p>
            )}
            {googleAdsCredentialStatus.lastVerifiedAt && (
              <p className="text-sm text-green-700">
                验证时间:{' '}
                {new Date(googleAdsCredentialStatus.lastVerifiedAt).toLocaleString('zh-CN', {
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
            {googleAdsCredentialStatus.hasCredentials &&
              effectiveGoogleAdsAuthMethod === 'oauth' &&
              googleAdsCredentialStatus.hasRefreshToken && (
                <p className="text-sm text-green-700">
                  Refresh Token 已授权（长期有效，除非在 Google 账号中撤销）
                </p>
              )}
          </div>
        ) : (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-amber-600" />
              <span className="font-semibold text-amber-700">待完成配置</span>
            </div>
            <p className="text-sm text-amber-700">
              {googleAdsCredentialStatus?.authConfigWarning
                ? '检测到 OAuth 与服务账号同时存在，请使用上方按钮分别删除其中一种后再配置。'
                : effectiveGoogleAdsAuthMethod === 'service_account'
                  ? '请填写服务账号配置并保存后即可使用 Google Ads 功能'
                  : '请填写所有必填参数并完成 OAuth 授权后才能使用 Google Ads 功能'}
            </p>
          </div>
        )}
      </div>

      {googleAdsCredentialStatus?.hasCredentials && (
        <div className="border-t pt-6">
          <div className="mb-4">
            <Label className="label-text mb-2 block">Google Ads API 访问级别</Label>
            <p className="text-sm text-gray-600 mb-3">
              系统会自动检测您的 Developer Token 权限级别，并据此显示每日API调用次数上限
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {(
              [
                {
                  level: 'test' as const,
                  label: 'Test Access',
                  limit: '0 次',
                  hint: '仅限测试账号，需升级权限',
                  activeClass: 'border-red-500 bg-red-50',
                  iconClass: 'text-red-600',
                },
                {
                  level: 'explorer' as const,
                  label: 'Explorer Access',
                  limit: '2,880 次',
                  hint: '默认权限级别',
                  activeClass: 'border-blue-500 bg-blue-50',
                  iconClass: 'text-blue-600',
                },
                {
                  level: 'basic' as const,
                  label: 'Basic Access',
                  limit: '15,000 次',
                  hint: '生产环境推荐',
                  activeClass: 'border-green-500 bg-green-50',
                  iconClass: 'text-green-600',
                },
                {
                  level: 'standard' as const,
                  label: 'Standard Access',
                  limit: '无限次',
                  hint: '大规模生产环境',
                  activeClass: 'border-purple-500 bg-purple-50',
                  iconClass: 'text-purple-600',
                },
              ] as const
            ).map(({ level, label, limit, hint, activeClass, iconClass }) => (
              <div
                key={level}
                className={`p-4 border-2 rounded-lg ${
                  googleAdsCredentialStatus.apiAccessLevel === level
                    ? activeClass
                    : 'border-gray-200 bg-gray-50'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-gray-900">{label}</div>
                  {googleAdsCredentialStatus.apiAccessLevel === level && (
                    <CheckCircle2 className={`w-5 h-5 ${iconClass}`} />
                  )}
                </div>
                <div className="text-sm text-gray-600 mb-2">
                  每日调用上限：
                  <span className="font-semibold text-gray-900">{limit}</span>
                </div>
                <div className="text-xs text-gray-500">{hint}</div>
              </div>
            ))}
          </div>

          {googleAdsCredentialStatus.apiAccessLevel === 'test' && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-300 rounded-lg">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
                <div className="text-xs text-blue-700">
                  <p className="font-medium mb-1">💡 当前为测试权限 - 可以立即开始测试</p>
                  <p>
                    您的 Developer Token 目前仅限测试账号使用。
                    <strong>建议立即开始测试产品功能</strong>，同时访问{' '}
                    <a
                      href="https://ads.google.com/aw/apicenter"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-800 font-semibold"
                    >
                      Google Ads API Center
                    </a>{' '}
                    申请升级到 Basic 或 Standard 权限（审核 1-3 个工作日）。真实的 API
                    调用记录有助于提高审批通过率，权限升级后自动生效，无需重新配置。
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="text-xs text-blue-700">
                <p className="font-medium mb-1">🔍 自动检测说明</p>
                <p>
                  系统会在验证凭证或API调用时自动检测您的访问级别。如果权限发生变化（如从 Test
                  升级到 Basic/Standard），系统会自动更新。
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="border-t pt-6">
        <Label className="label-text mb-3 block">认证方式</Label>
        {googleAdsAuthReadOnly ? (
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-50">
            <Badge variant="secondary" className="mb-2">
              {effectiveGoogleAdsAuthMethod === 'service_account'
                ? '服务账号（管理员共享）'
                : 'OAuth（管理员共享）'}
            </Badge>
            <p className="text-sm text-slate-600">认证方式由管理员配置，此处仅展示当前生效方式。</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => {
                setGoogleAdsAuthMethod('service_account')
                void fetchServiceAccounts()
              }}
              disabled={googleAdsAuthMethodLocked}
              className={`p-4 border-2 rounded-lg text-left transition-all ${
                effectiveGoogleAdsAuthMethod === 'service_account'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${googleAdsAuthMethodLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className="font-semibold mb-1">服务账号认证</div>
              <div className="text-sm text-gray-600">适合 MCC 账号管理多个子账号</div>
            </button>
            <button
              type="button"
              onClick={() => setGoogleAdsAuthMethod('oauth')}
              disabled={googleAdsAuthMethodLocked}
              className={`p-4 border-2 rounded-lg text-left transition-all ${
                effectiveGoogleAdsAuthMethod === 'oauth'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              } ${googleAdsAuthMethodLocked ? 'opacity-60 cursor-not-allowed' : ''}`}
            >
              <div className="font-semibold mb-1">OAuth 用户授权</div>
              <div className="text-sm text-gray-600">适合管理自己的 Google Ads 账号</div>
            </button>
          </div>
        )}
        {googleAdsDualStack && (
          <p className="text-xs text-amber-700 mt-2">
            双栈冲突时可切换 Tab 查看 OAuth / 服务账号配置，请使用上方按钮删除其中一种。
          </p>
        )}
        {googleAdsAuthMethodLocked && (
          <p className="text-xs text-slate-500 mt-2">
            已完成配置后认证方式不可切换；如需更换请先删除当前配置。
          </p>
        )}
      </div>

      {effectiveGoogleAdsAuthMethod === 'oauth' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
          {categorySettings.map((setting) => {
            const metaKey = `google_ads.${setting.key}`
            const metadata = GOOGLE_ADS_SETTING_METADATA[metaKey]

            return (
              <div key={setting.key}>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="label-text flex items-center gap-2">
                      {metadata?.label || setting.key}
                      {setting.isRequired && (
                        <span className="text-caption text-red-500">*必填</span>
                      )}
                    </Label>
                    {metadata?.helpLink && (
                      <a
                        href={metadata.helpLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                      >
                        获取方式
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                  <p className="helper-text flex items-start gap-1">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    {metadata?.description || setting.description || '无描述'}
                  </p>
                  {renderOAuthField(setting)}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {effectiveGoogleAdsAuthMethod === 'service_account' && googleAdsAuthReadOnly && (
        <div className="p-4 border border-slate-200 rounded-lg bg-slate-50">
          <p className="text-sm text-slate-600">
            服务账号配置由管理员维护，此处仅展示当前生效方式。
          </p>
        </div>
      )}

      {effectiveGoogleAdsAuthMethod === 'service_account' &&
        !googleAdsAuthReadOnly &&
        (hasServiceAccountConfigToDelete && !showServiceAccountReplaceForm ? (
          <div className="p-4 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
            <p className="text-sm text-slate-700">
              服务账号已配置。如需更换 MCC、Developer Token 或 JSON
              密钥，请展开下方表单；保存后将替换现有配置。
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={googleAdsAuthWriteBlocked}
              onClick={() => setShowServiceAccountReplaceForm(true)}
            >
              替换服务账号配置
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-5">
            <div>
              <Label className="label-text flex items-center gap-2">
                配置名称
                <span className="text-caption text-red-500">*必填</span>
              </Label>
              <p className="helper-text flex items-start gap-1 mt-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                用于标识此服务账号配置，方便管理多个配置
              </p>
              <Input
                value={serviceAccountForm.name}
                onChange={(e) =>
                  setServiceAccountForm((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder="例如: 生产环境MCC"
                className="mt-2"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="label-text flex items-center gap-2">
                  MCC Customer ID
                  <span className="text-caption text-red-500">*必填</span>
                </Label>
                <a
                  href="/help/google-ads-setup?tab=service-account#mcc-customer-id"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  获取方式
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="helper-text flex items-start gap-1 mt-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                MCC管理账户ID，格式：10位数字（不含连字符）
              </p>
              <Input
                value={serviceAccountForm.mccCustomerId}
                onChange={(e) =>
                  setServiceAccountForm((prev) => ({ ...prev, mccCustomerId: e.target.value }))
                }
                placeholder="例如: 1234567890"
                className="mt-2"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <Label className="label-text flex items-center gap-2">
                  Developer Token
                  <span className="text-caption text-red-500">*必填</span>
                </Label>
                <a
                  href="/help/google-ads-setup?tab=service-account#developer-token"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  获取方式
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="helper-text flex items-start gap-1 mt-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                需要Explorer级别或更高，在MCC账户的API中心获取
              </p>
              <Input
                value={serviceAccountForm.developerToken}
                onChange={(e) =>
                  setServiceAccountForm((prev) => ({ ...prev, developerToken: e.target.value }))
                }
                placeholder="输入 Developer Token"
                type="password"
                className="mt-2"
              />
            </div>

            <div className="lg:col-span-2">
              <div className="flex items-center justify-between">
                <Label className="label-text flex items-center gap-2">
                  服务账号 JSON
                  <span className="text-caption text-red-500">*必填</span>
                </Label>
                <a
                  href="/help/google-ads-setup?tab=service-account#service-account-json"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-caption text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                >
                  获取方式
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <p className="helper-text flex items-start gap-1 mt-1">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                从Google Cloud Console下载的服务账号密钥文件内容
              </p>
              <Textarea
                value={serviceAccountForm.serviceAccountJson}
                onChange={(e) =>
                  setServiceAccountForm((prev) => ({ ...prev, serviceAccountJson: e.target.value }))
                }
                placeholder='粘贴JSON内容，例如: {"type":"service_account","project_id":"...","private_key":"..."}'
                rows={6}
                className="mt-2 font-mono text-xs"
              />
            </div>
          </div>
        ))}

      {effectiveGoogleAdsAuthMethod === 'service_account' && serviceAccounts.length > 0 && (
        <div className="border-t pt-6">
          <h3 className="font-semibold mb-4">已配置的服务账号</h3>
          <div className="space-y-3">
            {serviceAccounts.map((account) => (
              <div key={account.id} className="p-4 border rounded-lg hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="font-semibold text-gray-900">{account.name}</div>
                    <div className="text-sm text-gray-600 mt-1 space-y-1">
                      <div>
                        MCC ID: <span className="font-mono">{account.mcc_customer_id}</span>
                      </div>
                      <div>
                        服务账号:{' '}
                        <span className="font-mono text-xs">{account.service_account_email}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        创建时间: {new Date(account.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => requestDeleteServiceAccount(account.id)}
                    disabled={googleAdsAuthReadOnly || deletingServiceAccountId === account.id}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {googleAdsCredentialStatus?.hasCredentials && (
        <div className="border-t pt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Google Ads 账户</h3>
            <Button
              onClick={() => {
                if (!showGoogleAdsAccounts && googleAdsAccounts.length === 0) {
                  void handleFetchGoogleAdsAccounts()
                } else {
                  setShowGoogleAdsAccounts(!showGoogleAdsAccounts)
                }
              }}
              disabled={loadingGoogleAdsAccounts}
              variant="outline"
              size="sm"
            >
              {loadingGoogleAdsAccounts ? (
                '加载中...'
              ) : showGoogleAdsAccounts ? (
                <>
                  <ChevronUp className="w-4 h-4 mr-1" />
                  收起账户列表
                </>
              ) : (
                <>
                  <ChevronDown className="w-4 h-4 mr-1" />
                  查看可访问账户
                </>
              )}
            </Button>
          </div>

          {showGoogleAdsAccounts && (
            <div className="space-y-3">
              <GoogleAdsServiceAccountPermissionAlert
                details={permissionError}
                onDismiss={dismissGoogleAdsAccountsPermissionError}
              />

              {loadingGoogleAdsAccounts ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                  <p className="mt-2 text-sm text-gray-600">加载账户列表...</p>
                </div>
              ) : hasServiceAccountPermissionDetails(
                  permissionError
                ) ? null : googleAdsAccounts.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                  <AlertCircle className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                  <p className="text-gray-600">未找到可访问的账户</p>
                </div>
              ) : (
                <>
                  <div className="text-sm text-gray-600 mb-2">
                    共 {googleAdsAccounts.length} 个账户
                  </div>
                  {googleAdsAccounts.map((account) => (
                    <div
                      key={account.customerId}
                      className="p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-gray-900">
                          {account.descriptiveName}
                        </span>
                        <div className="flex gap-2">
                          {account.manager && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded">
                              Manager
                            </span>
                          )}
                          {account.testAccount && (
                            <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded">
                              测试账户
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-sm text-gray-600">
                        <div>
                          <span className="font-medium">ID:</span>{' '}
                          <span className="font-mono">{account.customerId}</span>
                        </div>
                        <div>
                          <span className="font-medium">货币:</span> {account.currencyCode}
                        </div>
                        <div>
                          <span className="font-medium">时区:</span> {account.timeZone}
                        </div>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
