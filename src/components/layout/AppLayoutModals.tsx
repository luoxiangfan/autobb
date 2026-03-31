/**
 * AppLayout模态框组件
 * 从AppLayout中提取模态框内容，实现代码分割和懒加载
 */
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { User as UserIcon, Shield, Key, LogOut, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

// 用户信息类型定义
export interface UserInfo {
  id: number
  email: string
  username?: string
  displayName: string | null
  role: string
  packageType: string
  openclawEnabled?: boolean
}

// 套餐类型中文映射
const PACKAGE_TYPE_MAP: Record<string, string> = {
  trial: '试用版',
  annual: '年卡',
  lifetime: '长期会员',
  enterprise: '私有化部署',
}

// 角色中文映射
const ROLE_MAP: Record<string, string> = {
  admin: '管理员',
  user: '普通用户',
}

interface UserProfileModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  user: UserInfo
  onOpenPasswordModal: () => void
  onLogout: () => void
}

export function UserProfileModal({ open, onOpenChange, user, onOpenPasswordModal, onLogout }: UserProfileModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>个人中心</DialogTitle>
          <DialogDescription>
            查看和管理您的账号信息
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {/* User Avatar */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <UserIcon className="w-8 h-8" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900">
                {user.displayName || user.username || user.email}
              </h3>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-sm text-slate-500">{user.email}</span>
                {user.role === 'admin' && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-700">
                    <Shield className="w-3 h-3" />
                    管理员
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Account Info */}
          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">套餐类型</span>
              <span className="text-sm font-medium text-slate-900">
                {PACKAGE_TYPE_MAP[user.packageType] || user.packageType}
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">用户ID</span>
              <span className="text-sm font-mono text-slate-900">{user.id}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-slate-600">角色</span>
              <span className="text-sm font-medium text-slate-900">
                {ROLE_MAP[user.role] || user.role}
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-slate-200 pt-4 space-y-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              onClick={onOpenPasswordModal}
            >
              <Key className="w-4 h-4" />
              修改密码
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2 text-red-600 hover:text-red-700 hover:bg-red-50"
              onClick={onLogout}
            >
              <LogOut className="w-4 h-4" />
              退出登录
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface ChangePasswordModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangePasswordModal({ open, onOpenChange }: ChangePasswordModalProps) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [form, setForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })

  const handleSubmit = async () => {
    if (!form.currentPassword || !form.newPassword || !form.confirmPassword) {
      toast.error('请填写所有密码字段')
      return
    }

    if (form.newPassword !== form.confirmPassword) {
      toast.error('新密码和确认密码不匹配')
      return
    }

    if (form.newPassword.length < 8) {
      toast.error('新密码长度至少8位')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/user/password', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败')
      }

      toast.success('密码修改成功，请重新登录')
      onOpenChange(false)
      router.push('/login')
    } catch (err: any) {
      toast.error(err.message || '修改密码失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>修改密码</DialogTitle>
          <DialogDescription>
            请输入当前密码和新密码
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">当前密码</Label>
            <div className="relative">
              <Input
                id="currentPassword"
                type={showCurrent ? 'text' : 'password'}
                value={form.currentPassword}
                onChange={(e) => setForm(prev => ({ ...prev, currentPassword: e.target.value }))}
                placeholder="输入当前密码"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setShowCurrent(!showCurrent)}
              >
                {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword">新密码</Label>
            <div className="relative">
              <Input
                id="newPassword"
                type={showNew ? 'text' : 'password'}
                value={form.newPassword}
                onChange={(e) => setForm(prev => ({ ...prev, newPassword: e.target.value }))}
                placeholder="输入新密码（至少8位）"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setShowNew(!showNew)}
              >
                {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">确认新密码</Label>
            <div className="relative">
              <Input
                id="confirmPassword"
                type={showConfirm ? 'text' : 'password'}
                value={form.confirmPassword}
                onChange={(e) => setForm(prev => ({ ...prev, confirmPassword: e.target.value }))}
                placeholder="再次输入新密码"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                onClick={() => setShowConfirm(!showConfirm)}
              >
                {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button
              className="flex-1"
              onClick={handleSubmit}
              disabled={loading}
            >
              {loading ? '修改中...' : '确认修改'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
