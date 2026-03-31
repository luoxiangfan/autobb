'use client'

import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { User, Mail, Shield, Calendar, Key, AlertTriangle } from 'lucide-react'
import { useRouter } from 'next/navigation'

interface UserProfileModalProps {
  isOpen: boolean
  onClose: () => void
  user?: {
    username: string
    email: string
    role: string
    packageType: string
    packageExpiresAt: string | null
  } | null
}

interface UserProfile {
  username: string
  email: string | null
  role: string
  subscriptionType: string | null
  subscriptionEndDate: string | null
  createdAt: string
}

export function UserProfileModal({ isOpen, onClose, user: propUser }: UserProfileModalProps) {
  const router = useRouter()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (isOpen) {
      // 如果通过props传递了用户数据，使用props数据
      if (propUser) {
        setProfile({
          username: propUser.username,
          email: propUser.email,
          role: propUser.role,
          subscriptionType: propUser.packageType,
          subscriptionEndDate: propUser.packageExpiresAt,
          createdAt: new Date().toISOString(),
        })
        setLoading(false)
      } else {
        // 否则从API获取
        fetchProfile()
      }
    }
  }, [isOpen, propUser])

  const fetchProfile = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取用户信息失败')
      }

      const data = await response.json()
      setProfile(data.user)
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const getSubscriptionBadge = (type: string | null) => {
    const configs: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      trial: { label: '试用版', variant: 'outline' },
      annual: { label: '年度会员', variant: 'default' },
      lifetime: { label: '长期会员', variant: 'secondary' },
      enterprise: { label: '企业版', variant: 'default' },
    }

    if (!type) return <Badge variant="outline">未激活</Badge>

    const config = configs[type] || { label: type, variant: 'outline' }
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const getRoleBadge = (role: string) => {
    return role === 'admin' ? (
      <Badge variant="destructive" className="gap-1">
        <Shield className="w-3 h-3" />
        管理员
      </Badge>
    ) : (
      <Badge variant="secondary">普通用户</Badge>
    )
  }

  const getSubscriptionStatus = (endDate: string | null) => {
    if (!endDate) return { status: 'expired', message: '未激活', variant: 'outline' as const }

    const now = new Date()
    const end = new Date(endDate)
    const daysLeft = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

    if (daysLeft < 0) {
      return { status: 'expired', message: '已过期', variant: 'destructive' as const }
    } else if (daysLeft <= 7) {
      return { status: 'expiring', message: `${daysLeft} 天后到期`, variant: 'destructive' as const }
    } else if (daysLeft <= 30) {
      return { status: 'expiring_soon', message: `${daysLeft} 天后到期`, variant: 'outline' as const }
    } else if (endDate === '2099-12-31') {
      return { status: 'lifetime', message: '长期有效', variant: 'secondary' as const }
    } else {
      return { status: 'active', message: `${daysLeft} 天后到期`, variant: 'default' as const }
    }
  }

  const handleChangePassword = () => {
    onClose()
    router.push('/change-password')
  }

  if (loading) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px]">
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  if (error || !profile) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-[500px]">
          <div className="text-center py-8">
            <p className="text-red-600">{error || '无法加载用户信息'}</p>
            <Button onClick={() => fetchProfile()} className="mt-4">
              重试
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  const subscriptionStatus = getSubscriptionStatus(profile.subscriptionEndDate)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="text-2xl">个人中心</DialogTitle>
          <DialogDescription>
            查看您的账号信息和套餐详情
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* 基本信息 */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">基本信息</h3>

            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600">
                  <User className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-500">用户名</p>
                  <p className="font-medium text-gray-900">{profile.username}</p>
                </div>
                {getRoleBadge(profile.role)}
              </div>

              {profile.email && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-100 text-green-600">
                    <Mail className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-gray-500">邮箱</p>
                    <p className="font-medium text-gray-900">{profile.email}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50">
                <div className="flex items-center justify-center w-10 h-10 rounded-full bg-purple-100 text-purple-600">
                  <Calendar className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-500">注册时间</p>
                  <p className="font-medium text-gray-900">
                    {new Date(profile.createdAt).toLocaleDateString('zh-CN')}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 套餐信息 */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wider">套餐信息</h3>

            <div className="p-4 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50/50">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">套餐类型</p>
                {getSubscriptionBadge(profile.subscriptionType)}
              </div>

              {profile.subscriptionEndDate && (
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-700">有效期</p>
                  <div className="text-right">
                    <p className="text-sm text-gray-900 font-medium">
                      {new Date(profile.subscriptionEndDate).toLocaleDateString('zh-CN')}
                    </p>
                    <Badge variant={subscriptionStatus.variant} className="mt-1 text-xs">
                      {subscriptionStatus.message}
                    </Badge>
                  </div>
                </div>
              )}

              {/* 到期警告 */}
              {subscriptionStatus.status === 'expiring' && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-900">套餐即将到期</p>
                    <p className="text-xs text-red-700 mt-1">
                      请及时联系管理员续费，以免影响使用
                    </p>
                  </div>
                </div>
              )}

              {subscriptionStatus.status === 'expired' && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-red-900">套餐已过期</p>
                    <p className="text-xs text-red-700 mt-1">
                      请联系管理员续费以继续使用
                    </p>
                  </div>
                </div>
              )}

              {subscriptionStatus.status === 'lifetime' && (
                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm text-blue-900">
                    🎉 您拥有长期会员权限，享受所有功能长期使用权
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 操作按钮 */}
          <div className="pt-4 border-t border-gray-200">
            <Button
              onClick={handleChangePassword}
              variant="outline"
              className="w-full gap-2"
            >
              <Key className="w-4 h-4" />
              修改密码
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
