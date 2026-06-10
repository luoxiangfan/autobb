'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface UserSummary {
  id: number
  username: string
  email: string
}

interface AuthStatus {
  assignment: {
    assignmentMode: 'own' | 'shared_admin'
    authType: 'oauth' | 'service_account'
    sharedAdminUsername: string | null
    sharedAdminEmail: string | null
    updatedAt: string | null
    configuredBy?: number | null
  }
  authType: 'oauth' | 'service_account' | null
  hasOAuth: boolean
  hasServiceAccount: boolean
  hasConfigured?: boolean
  canModify: boolean
  dualStack?: boolean
  authConfigWarning?: string | null
}

function isAuthConfigured(status: AuthStatus | null): boolean {
  if (!status) return false
  if (status.hasConfigured) return true
  if (status.dualStack) return true
  if (status.hasOAuth || status.hasServiceAccount) return true
  return Boolean(status.assignment.updatedAt)
}

interface Props {
  user: UserSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function GoogleAdsAuthManageDialog({ user, open, onOpenChange }: Props) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [assignmentMode, setAssignmentMode] = useState<'own' | 'shared_admin'>('shared_admin')
  const [authType, setAuthType] = useState<'oauth' | 'service_account'>('service_account')
  const [oauthForm, setOauthForm] = useState({
    client_id: '',
    client_secret: '',
    developer_token: '',
    login_customer_id: '',
    refresh_token: '',
  })
  const [serviceAccountForm, setServiceAccountForm] = useState({
    name: '',
    mccCustomerId: '',
    developerToken: '',
    serviceAccountJson: '',
  })

  const fetchStatus = useCallback(async (userId: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/google-ads-auth`)
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok) throw new Error(data?.error || '加载失败')
      const nextStatus = data.data as AuthStatus
      setStatus(nextStatus)
      if (isAuthConfigured(nextStatus)) {
        setAssignmentMode(nextStatus.assignment.assignmentMode)
        setAuthType(nextStatus.assignment.authType)
      } else {
        setAssignmentMode('shared_admin')
        setAuthType('service_account')
      }
    } catch (error: any) {
      toast.error(error.message || '加载 Google Ads 认证配置失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && user) {
      fetchStatus(user.id)
    }
  }, [open, user, fetchStatus])

  const handleSave = async () => {
    if (!user) return
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        assignmentMode,
        authType,
      }

      if (assignmentMode === 'own') {
        if (authType === 'oauth') {
          body.oauth = oauthForm
        } else {
          body.serviceAccount = serviceAccountForm
        }
      }

      const res = await fetch(`/api/admin/users/${user.id}/google-ads-auth`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok) throw new Error(data?.error || '保存失败')

      toast.success(data.message || '保存成功')
      setStatus(data.data)
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!user) return
    const clearLabel = status?.assignment.updatedAt ? 'Google Ads 认证分配' : 'Google Ads 认证配置'
    if (!confirm(`确定清除用户 "${user.username}" 的 ${clearLabel} 吗？`)) return

    setSaving(true)
    try {
      const res = await fetch(`/api/admin/users/${user.id}/google-ads-auth`, {
        method: 'DELETE',
      })
      const text = await res.text()
      const data = text ? JSON.parse(text) : null
      if (!res.ok) throw new Error(data?.error || '清除失败')
      toast.success(data.message || '已清除')
      onOpenChange(false)
    } catch (error: any) {
      toast.error(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Google Ads 认证配置</DialogTitle>
          <DialogDescription>为用户 {user?.username} 配置 OAuth 或服务账号认证</DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-6">加载中...</p>
        ) : (
          <div className="space-y-5">
            {status?.authConfigWarning && (
              <div className="p-4 bg-amber-50 border border-amber-400 rounded-lg space-y-2">
                <p className="text-sm font-semibold text-amber-900">认证配置冲突</p>
                <p className="text-sm text-amber-800 whitespace-pre-line">
                  {status.authConfigWarning}
                </p>
                <p className="text-sm text-amber-900">
                  凭证所有者须删除 OAuth 或服务账号其中一种后，该用户的 Google Ads API
                  才能正常使用。
                  {status.dualStack && isAuthConfigured(status) && (
                    <>
                      {' '}
                      下方「分配记录」为
                      {status.assignment.authType === 'oauth' ? ' OAuth ' : ' 服务账号 '}
                      ，与当前有效认证方式不一致，请勿仅依据分配记录判断。
                    </>
                  )}
                </p>
              </div>
            )}

            {status && (
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">当前状态</span>
                  {status.dualStack ? (
                    <Badge variant="destructive">双栈冲突</Badge>
                  ) : status.hasConfigured === false &&
                    (status.hasOAuth || status.hasServiceAccount) ? (
                    <Badge variant="outline" className="text-muted-foreground">
                      未就绪
                    </Badge>
                  ) : isAuthConfigured(status) ? (
                    <>
                      <Badge
                        variant={
                          status.assignment.assignmentMode === 'shared_admin'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {status.assignment.assignmentMode === 'shared_admin'
                          ? '共享管理员'
                          : '独立配置'}
                      </Badge>
                      <Badge variant="outline">
                        {status.authType === 'oauth'
                          ? 'OAuth'
                          : status.authType === 'service_account'
                            ? '服务账号'
                            : status.assignment.authType === 'oauth'
                              ? 'OAuth（分配）'
                              : '服务账号（分配）'}
                      </Badge>
                    </>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      未配置
                    </Badge>
                  )}
                </div>
                {isAuthConfigured(status) &&
                  status.assignment.assignmentMode === 'shared_admin' &&
                  status.assignment.sharedAdminEmail && (
                    <p className="text-muted-foreground">
                      共享自：{status.assignment.sharedAdminUsername}
                      {status.assignment.sharedAdminEmail
                        ? ` (${status.assignment.sharedAdminEmail})`
                        : ''}
                    </p>
                  )}
                {(status.hasOAuth || status.hasServiceAccount) && (
                  <p className="text-muted-foreground">
                    OAuth：{status.hasOAuth ? '已配置' : '未配置'} · 服务账号：
                    {status.hasServiceAccount ? '已配置' : '未配置'}
                    {status.hasConfigured === false &&
                      !status.dualStack &&
                      ' · 尚未满足「二选一」可用条件'}
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label>配置方式</Label>
                <Select
                  value={assignmentMode}
                  onValueChange={(v) => setAssignmentMode(v as 'own' | 'shared_admin')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared_admin">共享管理员配置</SelectItem>
                    <SelectItem value="own">单独配置</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>认证方式</Label>
                <Select
                  value={authType}
                  onValueChange={(v) => setAuthType(v as 'oauth' | 'service_account')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="oauth">OAuth 用户授权</SelectItem>
                    <SelectItem value="service_account">服务账号</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {assignmentMode === 'shared_admin' ? (
              <p className="text-sm text-muted-foreground rounded-md bg-muted p-3">
                将使用当前登录管理员的 {authType === 'oauth' ? 'OAuth' : '服务账号'}{' '}
                配置。请确保管理员自身已完成对应认证配置。
              </p>
            ) : authType === 'oauth' ? (
              <div className="space-y-3">
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                  单独配置的凭证必须与管理员的配置不同，且需包含有效的 refresh_token。
                </p>
                {(
                  [
                    'client_id',
                    'client_secret',
                    'developer_token',
                    'login_customer_id',
                    'refresh_token',
                  ] as const
                ).map((key) => (
                  <div key={key}>
                    <Label>{key}</Label>
                    <Input
                      type={key.includes('secret') || key.includes('token') ? 'password' : 'text'}
                      value={oauthForm[key]}
                      onChange={(e) => setOauthForm((prev) => ({ ...prev, [key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                  单独配置的服务账号必须与管理员的配置不同。
                </p>
                <div>
                  <Label>配置名称</Label>
                  <Input
                    value={serviceAccountForm.name}
                    onChange={(e) => setServiceAccountForm((p) => ({ ...p, name: e.target.value }))}
                  />
                </div>
                <div>
                  <Label>MCC Customer ID</Label>
                  <Input
                    value={serviceAccountForm.mccCustomerId}
                    onChange={(e) =>
                      setServiceAccountForm((p) => ({ ...p, mccCustomerId: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Developer Token</Label>
                  <Input
                    type="password"
                    value={serviceAccountForm.developerToken}
                    onChange={(e) =>
                      setServiceAccountForm((p) => ({ ...p, developerToken: e.target.value }))
                    }
                  />
                </div>
                <div>
                  <Label>Service Account JSON</Label>
                  <Textarea
                    rows={6}
                    value={serviceAccountForm.serviceAccountJson}
                    onChange={(e) =>
                      setServiceAccountForm((p) => ({ ...p, serviceAccountJson: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {status && isAuthConfigured(status) && (
            <Button type="button" variant="destructive" onClick={handleClear} disabled={saving}>
              清除配置
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={saving || loading || Boolean(status?.dualStack)}
            title={status?.dualStack ? '请先清理凭证所有者的双栈认证配置' : undefined}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
