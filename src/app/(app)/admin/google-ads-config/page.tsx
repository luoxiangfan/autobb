'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import {
  Shield,
  Key,
  Plus,
  Trash2,
  Edit,
  Users,
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

interface OAuthConfig {
  id: string
  name: string
  description?: string
  client_id: string
  login_customer_id: string
  is_active: boolean
  version: number
  created_by: number
  created_at: string
  updated_at: string
  bound_users_count: number
}

interface ServiceAccount {
  id: string
  name: string
  description?: string
  mcc_customer_id: string
  service_account_email: string
  is_shared: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  bound_users_count: number
}

interface UserBinding {
  id: string
  user_id: number
  user_email: string
  authorized_at?: string
  needs_reauth: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export default function GoogleAdsConfigPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [oauthConfigs, setOauthConfigs] = useState<OAuthConfig[]>([])
  const [serviceAccounts, setServiceAccounts] = useState<ServiceAccount[]>([])
  
  // 对话框状态
  const [createOAuthDialogOpen, setCreateOAuthDialogOpen] = useState(false)
  const [createServiceAccountDialogOpen, setCreateServiceAccountDialogOpen] = useState(false)
  const [bindUserDialogOpen, setBindUserDialogOpen] = useState(false)
  const [viewBindingsDialogOpen, setViewBindingsDialogOpen] = useState(false)
  
  // 当前选中的配置
  const [selectedConfig, setSelectedConfig] = useState<OAuthConfig | ServiceAccount | null>(null)
  const [bindings, setBindings] = useState<UserBinding[]>([])
  
  // 表单状态
  const [oAuthForm, setOAuthForm] = useState({
    name: '',
    description: '',
    client_id: '',
    client_secret: '',
    developer_token: '',
    login_customer_id: ''
  })
  
  const [serviceAccountForm, setServiceAccountForm] = useState({
    name: '',
    description: '',
    mcc_customer_id: '',
    developer_token: '',
    service_account_json: ''
  })
  
  const [bindUserId, setBindUserId] = useState('')
  
  // 创建中/删除中状态
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  // 获取配置列表
  const fetchConfigs = async () => {
    try {
      setLoading(true)
      
      // 获取 OAuth 配置
      const oauthResponse = await fetch('/api/admin/google-ads/oauth-config', { credentials: 'include' })
      if (oauthResponse.ok) {
        const oauthData = await oauthResponse.json()
        setOauthConfigs(oauthData.data.configs || [])
      }
      
      // 获取服务账号
      const saResponse = await fetch('/api/admin/google-ads/service-account', { credentials: 'include' })
      if (saResponse.ok) {
        const saData = await saResponse.json()
        setServiceAccounts(saData.data.accounts || [])
      }
    } catch (err: any) {
      console.error('获取配置列表失败:', err)
      toast.error(err.message || '获取配置列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchConfigs()
  }, [])

  // 创建 OAuth 配置
  const handleCreateOAuthConfig = async () => {
    if (!oAuthForm.name || !oAuthForm.client_id || !oAuthForm.client_secret || 
        !oAuthForm.developer_token || !oAuthForm.login_customer_id) {
      toast.error('请填写所有必填字段')
      return
    }

    try {
      setCreating(true)
      const response = await fetch('/api/admin/google-ads/oauth-config', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(oAuthForm)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '创建失败')
      }

      toast.success('OAuth 配置创建成功')
      setCreateOAuthDialogOpen(false)
      setOAuthForm({
        name: '',
        description: '',
        client_id: '',
        client_secret: '',
        developer_token: '',
        login_customer_id: ''
      })
      fetchConfigs()
    } catch (err: any) {
      console.error('创建 OAuth 配置失败:', err)
      toast.error(err.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  // 创建服务账号
  const handleCreateServiceAccount = async () => {
    if (!serviceAccountForm.name || !serviceAccountForm.mcc_customer_id || 
        !serviceAccountForm.developer_token || !serviceAccountForm.service_account_json) {
      toast.error('请填写所有必填字段')
      return
    }

    try {
      setCreating(true)
      const response = await fetch('/api/admin/google-ads/service-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(serviceAccountForm)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '创建失败')
      }

      toast.success('服务账号创建成功')
      setCreateServiceAccountDialogOpen(false)
      setServiceAccountForm({
        name: '',
        description: '',
        mcc_customer_id: '',
        developer_token: '',
        service_account_json: ''
      })
      fetchConfigs()
    } catch (err: any) {
      console.error('创建服务账号失败:', err)
      toast.error(err.message || '创建失败')
    } finally {
      setCreating(false)
    }
  }

  // 删除 OAuth 配置
  const handleDeleteOAuthConfig = async (configId: string) => {
    try {
      setDeleting(configId)
      const response = await fetch(`/api/admin/google-ads/oauth-config/${configId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        const data = await response.json()
        if (data.code === 'HAS_ACTIVE_BINDINGS') {
          toast.error(`无法删除，仍有 ${data.message}`)
          return
        }
        throw new Error(data.error || '删除失败')
      }

      toast.success('OAuth 配置已删除')
      fetchConfigs()
    } catch (err: any) {
      console.error('删除 OAuth 配置失败:', err)
      toast.error(err.message || '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  // 删除服务账号
  const handleDeleteServiceAccount = async (accountId: string) => {
    try {
      setDeleting(accountId)
      const response = await fetch(`/api/admin/google-ads/service-account/${accountId}`, {
        method: 'DELETE',
        credentials: 'include'
      })

      if (!response.ok) {
        const data = await response.json()
        if (data.code === 'HAS_ACTIVE_BINDINGS') {
          toast.error(`无法删除，仍有 ${data.message}`)
          return
        }
        throw new Error(data.error || '删除失败')
      }

      toast.success('服务账号已删除')
      fetchConfigs()
    } catch (err: any) {
      console.error('删除服务账号失败:', err)
      toast.error(err.message || '删除失败')
    } finally {
      setDeleting(null)
    }
  }

  // 绑定用户
  const handleBindUser = async (configId: string, configType: 'oauth' | 'service_account') => {
    if (!bindUserId) {
      toast.error('请输入用户 ID')
      return
    }

    try {
      const endpoint = configType === 'oauth' 
        ? `/api/admin/google-ads/oauth-config/${configId}/bind-user`
        : `/api/admin/google-ads/service-account/${configId}/bind-user`

      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: parseInt(bindUserId) })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '绑定失败')
      }

      toast.success('用户绑定成功')
      setBindUserDialogOpen(false)
      setBindUserId('')
      fetchConfigs()
    } catch (err: any) {
      console.error('绑定用户失败:', err)
      toast.error(err.message || '绑定失败')
    }
  }

  // 查看绑定用户列表
  const handleViewBindings = async (configId: string, configType: 'oauth' | 'service_account') => {
    try {
      const endpoint = configType === 'oauth'
        ? `/api/admin/google-ads/oauth-config/${configId}/bindings`
        : `/api/admin/google-ads/service-account/${configId}/bindings`

      const response = await fetch(endpoint, { credentials: 'include' })
      if (!response.ok) {
        throw new Error('获取绑定列表失败')
      }

      const data = await response.json()
      setBindings(data.data.bindings || [])
      setSelectedConfig(configType === 'oauth' 
        ? oauthConfigs.find(c => c.id === configId) || null
        : serviceAccounts.find(a => a.id === configId) || null
      )
      setViewBindingsDialogOpen(true)
    } catch (err: any) {
      console.error('获取绑定列表失败:', err)
      toast.error(err.message || '获取绑定列表失败')
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin mx-auto text-blue-600" />
          <p className="mt-4 text-body text-muted-foreground">加载配置...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="page-title">Google Ads 配置管理</h1>
          <p className="page-subtitle">管理共享 OAuth 配置和服务账号</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* OAuth 配置列表 */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-blue-600" />
                <h2 className="font-semibold text-lg">OAuth 配置</h2>
              </div>
              <Button size="sm" onClick={() => setCreateOAuthDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                新建
              </Button>
            </div>

            <div className="space-y-3">
              {oauthConfigs.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">暂无 OAuth 配置</p>
              ) : (
                oauthConfigs.map((config) => (
                  <Card key={config.id} className="p-4 border hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{config.name}</span>
                          {config.is_active ? (
                            <Badge className="bg-green-500">激活</Badge>
                          ) : (
                            <Badge variant="outline">禁用</Badge>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>Client ID: <span className="font-mono text-xs">{config.client_id.substring(0, 30)}...</span></div>
                          <div>MCC ID: <span className="font-mono">{config.login_customer_id}</span></div>
                          <div className="text-xs text-gray-500">
                            版本：v{config.version} · {config.bound_users_count} 个用户绑定
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewBindings(config.id, 'oauth')}
                          className="text-blue-600"
                        >
                          <Users className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedConfig(config)
                            setBindUserDialogOpen(true)
                          }}
                        >
                          绑定用户
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteOAuthConfig(config.id)}
                          disabled={deleting === config.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </Card>

          {/* 服务账号列表 */}
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Shield className="w-5 h-5 text-purple-600" />
                <h2 className="font-semibold text-lg">服务账号</h2>
              </div>
              <Button size="sm" onClick={() => setCreateServiceAccountDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                新建
              </Button>
            </div>

            <div className="space-y-3">
              {serviceAccounts.length === 0 ? (
                <p className="text-sm text-gray-500 text-center py-4">暂无服务账号</p>
              ) : (
                serviceAccounts.map((account) => (
                  <Card key={account.id} className="p-4 border hover:bg-gray-50">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">{account.name}</span>
                          {account.is_active ? (
                            <Badge className="bg-green-500">激活</Badge>
                          ) : (
                            <Badge variant="outline">禁用</Badge>
                          )}
                        </div>
                        <div className="text-sm text-gray-600 space-y-1">
                          <div>MCC ID: <span className="font-mono">{account.mcc_customer_id}</span></div>
                          <div className="text-xs">
                            服务账号：<span className="font-mono text-xs">{account.service_account_email}</span>
                          </div>
                          <div className="text-xs text-gray-500">
                            {account.bound_users_count} 个用户绑定
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewBindings(account.id, 'service_account')}
                          className="text-purple-600"
                        >
                          <Users className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setSelectedConfig(account)
                            setBindUserDialogOpen(true)
                          }}
                        >
                          绑定用户
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => handleDeleteServiceAccount(account.id)}
                          disabled={deleting === account.id}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* 创建 OAuth 配置对话框 */}
      <AlertDialog open={createOAuthDialogOpen} onOpenChange={setCreateOAuthDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>创建 OAuth 配置</AlertDialogTitle>
            <AlertDialogDescription>
              填写 Google Ads OAuth 配置信息，创建后可以绑定用户
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2">
              <Label>配置名称 *</Label>
              <Input
                value={oAuthForm.name}
                onChange={(e) => setOAuthForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如：主账户 OAuth 配置"
              />
            </div>
            <div className="col-span-2">
              <Label>描述</Label>
              <Input
                value={oAuthForm.description}
                onChange={(e) => setOAuthForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="可选"
              />
            </div>
            <div className="col-span-2">
              <Label>Client ID *</Label>
              <Input
                value={oAuthForm.client_id}
                onChange={(e) => setOAuthForm(prev => ({ ...prev, client_id: e.target.value }))}
                placeholder="xxx.apps.googleusercontent.com"
              />
            </div>
            <div className="col-span-2">
              <Label>Client Secret *</Label>
              <Input
                type="password"
                value={oAuthForm.client_secret}
                onChange={(e) => setOAuthForm(prev => ({ ...prev, client_secret: e.target.value }))}
                placeholder="输入 Client Secret"
              />
            </div>
            <div className="col-span-2">
              <Label>Developer Token *</Label>
              <Input
                type="password"
                value={oAuthForm.developer_token}
                onChange={(e) => setOAuthForm(prev => ({ ...prev, developer_token: e.target.value }))}
                placeholder="输入 Developer Token"
              />
            </div>
            <div className="col-span-2">
              <Label>Login Customer ID (MCC 账户 ID) *</Label>
              <Input
                value={oAuthForm.login_customer_id}
                onChange={(e) => setOAuthForm(prev => ({ ...prev, login_customer_id: e.target.value }))}
                placeholder="10 位数字，例如：1234567890"
              />
              <p className="text-xs text-gray-500 mt-1">格式：10 位数字（不含连字符）</p>
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreateOAuthConfig} disabled={creating}>
              {creating ? '创建中...' : '创建'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 创建服务账号对话框 */}
      <AlertDialog open={createServiceAccountDialogOpen} onOpenChange={setCreateServiceAccountDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>创建服务账号</AlertDialogTitle>
            <AlertDialogDescription>
              填写 Google Ads 服务账号配置信息
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid grid-cols-2 gap-4 py-4">
            <div className="col-span-2">
              <Label>配置名称 *</Label>
              <Input
                value={serviceAccountForm.name}
                onChange={(e) => setServiceAccountForm(prev => ({ ...prev, name: e.target.value }))}
                placeholder="例如：生产环境 MCC"
              />
            </div>
            <div className="col-span-2">
              <Label>描述</Label>
              <Input
                value={serviceAccountForm.description}
                onChange={(e) => setServiceAccountForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="可选"
              />
            </div>
            <div className="col-span-2">
              <Label>MCC Customer ID *</Label>
              <Input
                value={serviceAccountForm.mcc_customer_id}
                onChange={(e) => setServiceAccountForm(prev => ({ ...prev, mcc_customer_id: e.target.value }))}
                placeholder="10 位数字，例如：1234567890"
              />
            </div>
            <div className="col-span-2">
              <Label>Developer Token *</Label>
              <Input
                type="password"
                value={serviceAccountForm.developer_token}
                onChange={(e) => setServiceAccountForm(prev => ({ ...prev, developer_token: e.target.value }))}
                placeholder="输入 Developer Token"
              />
            </div>
            <div className="col-span-2">
              <Label>服务账号 JSON *</Label>
              <Textarea
                value={serviceAccountForm.service_account_json}
                onChange={(e) => setServiceAccountForm(prev => ({ ...prev, service_account_json: e.target.value }))}
                placeholder='粘贴 JSON 内容，例如：{"type":"service_account","project_id":"...","private_key":"..."}'
                rows={6}
                className="font-mono text-xs"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleCreateServiceAccount} disabled={creating}>
              {creating ? '创建中...' : '创建'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 绑定用户对话框 */}
      <AlertDialog open={bindUserDialogOpen} onOpenChange={setBindUserDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>绑定用户</AlertDialogTitle>
            <AlertDialogDescription>
              输入用户 ID，将
              {selectedConfig && 'name' in selectedConfig ? 'OAuth 配置' : '服务账号'} 
              绑定到该用户
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4">
            <Label>用户 ID</Label>
            <Input
              type="number"
              value={bindUserId}
              onChange={(e) => setBindUserId(e.target.value)}
              placeholder="例如：1"
            />
            <p className="text-xs text-gray-500 mt-2">
              用户 ID 可以在用户管理页面查看
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setBindUserId('')}>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (selectedConfig) {
                  handleBindUser(
                    selectedConfig.id,
                    'client_id' in selectedConfig ? 'oauth' : 'service_account'
                  )
                }
              }}
            >
              绑定
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 查看绑定用户列表对话框 */}
      <AlertDialog open={viewBindingsDialogOpen} onOpenChange={setViewBindingsDialogOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>
              绑定用户列表
              {selectedConfig && ` - ${selectedConfig.name}`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              已绑定 {bindings.length} 个用户
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-4 max-h-96 overflow-y-auto">
            {bindings.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">暂无绑定用户</p>
            ) : (
              <div className="space-y-2">
                {bindings.map((binding) => (
                  <Card key={binding.id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium">用户 ID: {binding.user_id}</div>
                        <div className="text-sm text-gray-600">{binding.user_email}</div>
                        {binding.authorized_at && (
                          <div className="text-xs text-gray-500">
                            授权时间：{new Date(binding.authorized_at).toLocaleString('zh-CN')}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {binding.needs_reauth && !binding.authorized_at && (
                          <Badge variant="outline" className="text-orange-600 border-orange-300">
                            需要授权
                          </Badge>
                        )}
                        {binding.is_active ? (
                          <Badge className="bg-green-500">活跃</Badge>
                        ) : (
                          <Badge variant="outline">已解绑</Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
