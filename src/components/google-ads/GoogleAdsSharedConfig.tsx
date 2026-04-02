'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { CheckCircle2, AlertCircle, ExternalLink, Loader2, Shield, Key, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Google Ads 配置状态显示组件（共享配置模式）
 * 
 * 支持两种模式：
 * 1. OAuth 用户授权 - 管理员配置，用户点击授权
 * 2. 服务账号认证 - 管理员配置并绑定，用户直接使用
 */

interface OAuthConfig {
  binding_id: string
  config_id: string
  name: string
  client_id: string
  login_customer_id: string
  authorized_at?: string
  needs_reauth: boolean
  has_refresh_token: boolean
}

interface ServiceAccountConfig {
  binding_id: string
  service_account_id: string
  name: string
  mcc_customer_id: string
  service_account_email: string
}

interface GoogleAdsSharedConfigProps {
  onAuthorized?: () => void
}

export function GoogleAdsSharedConfig({ onAuthorized }: GoogleAdsSharedConfigProps) {
  const [loading, setLoading] = useState(true)
  const [authorizing, setAuthorizing] = useState(false)
  
  const [hasConfig, setHasConfig] = useState(false)
  const [authType, setAuthType] = useState<'oauth' | 'service_account' | null>(null)
  const [oauthConfig, setOauthConfig] = useState<OAuthConfig | null>(null)
  const [serviceAccountConfig, setServiceAccountConfig] = useState<ServiceAccountConfig | null>(null)
  const [needsAction, setNeedsAction] = useState(false)
  const [actionType, setActionType] = useState<'authorize' | 'reauthorize' | null>(null)

  // 获取配置状态
  const fetchConfigStatus = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/google-ads/my-config', { credentials: 'include' })
      
      if (!response.ok) {
        throw new Error('获取配置状态失败')
      }

      const data = await response.json()
      const config = data.data

      setHasConfig(config.has_config)
      setAuthType(config.auth_type)
      
      if (config.oauth) {
        setOauthConfig(config.oauth)
      }
      
      if (config.service_account) {
        setServiceAccountConfig(config.service_account)
      }
      
      setNeedsAction(config.needs_action)
      setActionType(config.action_type)
    } catch (err: any) {
      console.error('获取配置状态失败:', err)
      toast.error(err.message || '获取配置状态失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigStatus()
  }, [])

  // 启动 OAuth 授权
  const handleAuthorize = async () => {
    try {
      setAuthorizing(true)
      const response = await fetch('/api/google-ads/authorize/start', { credentials: 'include' })
      
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '启动授权失败')
      }

      const data = await response.json()
      
      // 跳转到 Google 授权页面
      window.location.href = data.data.auth_url
    } catch (err: any) {
      console.error('启动授权失败:', err)
      toast.error(err.message || '启动授权失败')
    } finally {
      setAuthorizing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        <span className="ml-2 text-sm text-gray-600">加载配置状态...</span>
      </div>
    )
  }

  // 情况 1: 没有配置
  if (!hasConfig && !authType) {
    return (
      <Alert className="bg-amber-50 border-amber-200">
        <AlertCircle className="w-5 h-5 text-amber-600" />
        <AlertDescription className="text-amber-700">
          <p className="font-semibold mb-1">暂无 Google Ads 配置</p>
          <p className="text-sm">
            请联系管理员为您分配 Google Ads API 配置。
          </p>
        </AlertDescription>
      </Alert>
    )
  }

  // 情况 2: OAuth 模式 - 需要授权
  if (authType === 'oauth' && needsAction) {
    return (
      <Card className="p-6 border-blue-200 bg-blue-50">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-blue-100 rounded-lg">
            <Key className="w-6 h-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg text-blue-900 mb-2">
              Google Ads OAuth 授权
            </h3>
            
            {oauthConfig && (
              <div className="space-y-2 mb-4">
                <p className="text-sm text-blue-800">
                  <span className="font-medium">配置名称：</span>{oauthConfig.name}
                </p>
                <p className="text-sm text-blue-800">
                  <span className="font-medium">MCC ID：</span>
                  <span className="font-mono">{oauthConfig.login_customer_id}</span>
                </p>
              </div>
            )}

            {actionType === 'reauthorize' && (
              <Alert className="bg-orange-50 border-orange-200 mb-4">
                <AlertCircle className="w-4 h-4 text-orange-600" />
                <AlertDescription className="text-orange-700 text-sm">
                  管理员已更新配置，需要重新授权
                </AlertDescription>
              </Alert>
            )}

            <Button 
              onClick={handleAuthorize}
              disabled={authorizing}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {authorizing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  启动授权中...
                </>
              ) : (
                <>
                  <Shield className="w-4 h-4 mr-2" />
                  {actionType === 'reauthorize' ? '重新授权 Google Ads' : '点击授权 Google Ads'}
                </>
              )}
            </Button>

            <p className="text-xs text-blue-600 mt-3">
              点击后将跳转到 Google 登录页面，完成授权后自动返回
            </p>
          </div>
        </div>
      </Card>
    )
  }

  // 情况 3: OAuth 模式 - 已授权
  if (authType === 'oauth' && !needsAction && oauthConfig) {
    return (
      <Card className="p-6 border-green-200 bg-green-50">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <CheckCircle2 className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg text-green-900 mb-2">
              Google Ads 已连接
            </h3>
            
            <div className="space-y-2 mb-4">
              <p className="text-sm text-green-800">
                <span className="font-medium">配置名称：</span>{oauthConfig.name}
              </p>
              <p className="text-sm text-green-800">
                <span className="font-medium">MCC ID：</span>
                <span className="font-mono">{oauthConfig.login_customer_id}</span>
              </p>
              {oauthConfig.authorized_at && (
                <p className="text-sm text-green-700">
                  <span className="font-medium">授权时间：</span>
                  {new Date(oauthConfig.authorized_at).toLocaleString('zh-CN')}
                </p>
              )}
            </div>

            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={handleAuthorize}
                className="text-green-700 border-green-300 hover:bg-green-100"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                重新授权
              </Button>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // 情况 4: 服务账号模式
  if (authType === 'service_account' && serviceAccountConfig) {
    return (
      <Card className="p-6 border-purple-200 bg-purple-50">
        <div className="flex items-start gap-4">
          <div className="p-2 bg-purple-100 rounded-lg">
            <Shield className="w-6 h-6 text-purple-600" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-lg text-purple-900 mb-2">
              Google Ads 已连接（服务账号）
            </h3>
            
            <div className="space-y-2 mb-4">
              <p className="text-sm text-purple-800">
                <span className="font-medium">服务账号名称：</span>{serviceAccountConfig.name}
              </p>
              <p className="text-sm text-purple-800">
                <span className="font-medium">MCC ID：</span>
                <span className="font-mono">{serviceAccountConfig.mcc_customer_id}</span>
              </p>
              <p className="text-sm text-purple-800">
                <span className="font-medium">服务账号：</span>
                <span className="font-mono text-xs">{serviceAccountConfig.service_account_email}</span>
              </p>
            </div>

            <Alert className="bg-green-50 border-green-200">
              <CheckCircle2 className="w-4 h-4 text-green-600" />
              <AlertDescription className="text-green-700 text-sm">
                已绑定服务账号，无需额外授权，可直接使用
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </Card>
    )
  }

  // 默认情况（不应该到达这里）
  return (
    <Alert className="bg-gray-50 border-gray-200">
      <AlertCircle className="w-5 h-5 text-gray-600" />
      <AlertDescription className="text-gray-700">
        配置状态未知，请刷新页面重试
      </AlertDescription>
    </Alert>
  )
}
