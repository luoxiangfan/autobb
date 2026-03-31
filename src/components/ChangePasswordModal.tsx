'use client'

import { useState } from 'react'
import { showSuccess } from '@/lib/toast-utils'

interface ChangePasswordModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function ChangePasswordModal({ isOpen, onClose, onSuccess }: ChangePasswordModalProps) {
  const [formData, setFormData] = useState({
    oldPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [passwordStrength, setPasswordStrength] = useState<string[]>([])

  if (!isOpen) return null

  // 验证密码强度
  const validatePasswordStrength = (password: string): string[] => {
    const errors: string[] = []
    if (password.length < 8) errors.push('密码至少需要8个字符')
    if (!/[A-Z]/.test(password)) errors.push('密码至少需要1个大写字母')
    if (!/[a-z]/.test(password)) errors.push('密码至少需要1个小写字母')
    if (!/[0-9]/.test(password)) errors.push('密码至少需要1个数字')
    if (!/[!@#$%^&*]/.test(password)) errors.push('密码至少需要1个特殊字符（!@#$%^&*）')
    return errors
  }

  const handleNewPasswordChange = (value: string) => {
    setFormData({ ...formData, newPassword: value })
    setPasswordStrength(validatePasswordStrength(value))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 前端验证
    if (!formData.oldPassword) {
      setError('请输入旧密码')
      return
    }

    if (!formData.newPassword) {
      setError('请输入新密码')
      return
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    if (passwordStrength.length > 0) {
      setError('新密码不符合复杂度要求')
      return
    }

    setLoading(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/user/password', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          oldPassword: formData.oldPassword,
          newPassword: formData.newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败')
      }

      showSuccess('密码修改成功', '请重新登录')

      // 清除HttpOnly Cookie，强制重新登录
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      })

      onSuccess()
    } catch (err: any) {
      setError(err.message || '修改密码失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setFormData({
      oldPassword: '',
      newPassword: '',
      confirmPassword: '',
    })
    setPasswordStrength([])
    setError('')
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={handleClose}>
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">修改密码</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600 transition"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* 旧密码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              旧密码 <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              value={formData.oldPassword}
              onChange={(e) => setFormData({ ...formData, oldPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="请输入当前密码"
            />
          </div>

          {/* 新密码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              新密码 <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              value={formData.newPassword}
              onChange={(e) => handleNewPasswordChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="请输入新密码"
            />
            {/* 密码强度提示 */}
            {formData.newPassword && (
              <div className="mt-2">
                {passwordStrength.length === 0 ? (
                  <p className="text-sm text-green-600 flex items-center">
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    密码强度符合要求
                  </p>
                ) : (
                  <div className="text-sm text-red-600">
                    {passwordStrength.map((err, idx) => (
                      <p key={idx}>• {err}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 确认新密码 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              确认新密码 <span className="text-red-500">*</span>
            </label>
            <input
              type="password"
              required
              value={formData.confirmPassword}
              onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="请再次输入新密码"
            />
            {formData.confirmPassword && formData.newPassword !== formData.confirmPassword && (
              <p className="mt-1 text-sm text-red-600">两次输入的密码不一致</p>
            )}
          </div>

          {/* 密码要求说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded p-4">
            <h4 className="text-sm font-medium text-blue-900 mb-2">密码复杂度要求</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• 至少8个字符</li>
              <li>• 至少1个大写字母（A-Z）</li>
              <li>• 至少1个小写字母（a-z）</li>
              <li>• 至少1个数字（0-9）</li>
              <li>• 至少1个特殊字符（!@#$%^&*）</li>
            </ul>
          </div>

          {/* Footer */}
          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={handleClose}
              className="px-6 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
              disabled={loading}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || passwordStrength.length > 0}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? '修改中...' : '确认修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
