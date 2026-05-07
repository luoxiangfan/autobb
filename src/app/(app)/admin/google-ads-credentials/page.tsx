'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { Info, RefreshCw } from 'lucide-react'

type UserRow = {
  id: number
  username: string | null
  email: string | null
  credentialSource: string
  hasRefreshToken: boolean
}

export default function GoogleAdsCredentialsAdminPage() {
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<UserRow[]>([])
  const [orgPreview, setOrgPreview] = useState<{
    clientIdPreview: string
    developerTokenPreview: string
    hasClientSecret: boolean
  } | null>(null)

  const [orgClientId, setOrgClientId] = useState('')
  const [orgClientSecret, setOrgClientSecret] = useState('')
  const [orgDeveloperToken, setOrgDeveloperToken] = useState('')
  const [savingOrg, setSavingOrg] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/google-ads/credentials', { credentials: 'include' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '加载失败')
      setUsers(data.users || [])
      setOrgPreview(data.orgShared || null)
    } catch (e: any) {
      toast.error(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveOrg = async () => {
    if (!orgClientId.trim() || !orgDeveloperToken.trim()) {
      toast.error('请填写 Client ID 与 Developer Token')
      return
    }
    if (!orgClientSecret.trim() && !orgPreview?.hasClientSecret) {
      toast.error('首次保存组织配置时必须填写 Client Secret')
      return
    }
    setSavingOrg(true)
    try {
      const res = await fetch('/api/admin/google-ads/credentials', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'org_shared',
          client_id: orgClientId.trim(),
          client_secret: orgClientSecret.trim(),
          developer_token: orgDeveloperToken.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      toast.success(data.message || '已保存')
      setOrgClientSecret('')
      await load()
    } catch (e: any) {
      toast.error(e.message || '保存失败')
    } finally {
      setSavingOrg(false)
    }
  }

  const saveUserPolicy = async (userId: number, credential_source: 'inherit_org' | 'dedicated_user') => {
    try {
      const res = await fetch('/api/admin/google-ads/credentials', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'user_policy', userId, credential_source }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '保存失败')
      toast.success(data.message || '已更新')
      await load()
    } catch (e: any) {
      toast.error(e.message || '保存失败')
    }
  }

  const clearUser = async (userId: number) => {
    if (!confirm(`确定清空用户 #${userId} 的 Google Ads 用户级配置与 OAuth 凭证？`)) return
    try {
      const res = await fetch('/api/admin/google-ads/credentials', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_user_google_ads', userId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '操作失败')
      toast.success(data.message || '已清空')
      await load()
    } catch (e: any) {
      toast.error(e.message || '操作失败')
    }
  }

  return (
    <div className="container max-w-6xl py-8 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Google Ads 凭证</h1>
          <p className="text-muted-foreground mt-1">
            维护组织级 OAuth 应用（Client ID / Secret / Developer Token），并为每个用户选择使用组织配置或独立配置。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">组织级 OAuth 应用（inherit_org 用户共用）</h2>
        {orgPreview && (
          <p className="text-sm text-muted-foreground">
            当前已配置：Client ID 预览 {orgPreview.clientIdPreview || '—'}；Developer Token 预览{' '}
            {orgPreview.developerTokenPreview || '—'}；Client Secret：{orgPreview.hasClientSecret ? '已填写' : '未填写'}
          </p>
        )}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Client ID</Label>
            <Input value={orgClientId} onChange={(e) => setOrgClientId(e.target.value)} placeholder="xxx.apps.googleusercontent.com" />
          </div>
          <div className="space-y-2">
            <Label>Client Secret</Label>
            <Input
              type="password"
              value={orgClientSecret}
              onChange={(e) => setOrgClientSecret(e.target.value)}
              placeholder={orgPreview?.hasClientSecret ? '留空则不修改；填写则覆盖' : '必填'}
            />
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label>Developer Token</Label>
            <Input
              type="password"
              value={orgDeveloperToken}
              onChange={(e) => setOrgDeveloperToken(e.target.value)}
              placeholder="从 Google Ads API Center 获取"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground flex gap-2 items-start">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          保存后，所有策略为「使用组织配置」的用户在发起 OAuth 与 API 调用时将使用上述三项；每用户仍使用自己的 Login Customer ID 与 Refresh Token。
        </p>
        <Button onClick={() => void saveOrg()} disabled={savingOrg}>
          {savingOrg ? '保存中…' : '保存组织配置'}
        </Button>
      </Card>

      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4">用户策略</h2>
        {loading ? (
          <p className="text-sm text-muted-foreground">加载中…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-4">ID</th>
                  <th className="py-2 pr-4">用户</th>
                  <th className="py-2 pr-4">邮箱</th>
                  <th className="py-2 pr-4">策略</th>
                  <th className="py-2 pr-4">OAuth</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border/60">
                    <td className="py-2 pr-4 font-mono">{u.id}</td>
                    <td className="py-2 pr-4">{u.username || '—'}</td>
                    <td className="py-2 pr-4">{u.email || '—'}</td>
                    <td className="py-2 pr-4">
                      <Select
                        value={u.credentialSource}
                        onValueChange={(v) =>
                          void saveUserPolicy(u.id, v as 'inherit_org' | 'dedicated_user')
                        }
                      >
                        <SelectTrigger className="w-[220px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="dedicated_user">独立配置（用户自填应用凭证）</SelectItem>
                          <SelectItem value="inherit_org">使用组织配置</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="py-2 pr-4">{u.hasRefreshToken ? '已授权' : '未授权'}</td>
                    <td className="py-2">
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => void clearUser(u.id)}>
                        清空配置
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
