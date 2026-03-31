'use client'

import { useState } from 'react'

interface UserCreateModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function UserCreateModal({ isOpen, onClose, onSuccess }: UserCreateModalProps) {
  const [formData, setFormData] = useState({
    displayName: '',
    email: '',
    packageType: 'trial' as 'trial' | 'annual' | 'lifetime' | 'enterprise',
    role: 'user' as 'user' | 'admin',
    validityMonths: 12,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [createdUser, setCreatedUser] = useState<{
    username: string
    defaultPassword: string
  } | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // Calculate validity period
      const validFrom = new Date()
      const validUntil = new Date()
      validUntil.setMonth(validUntil.getMonth() + formData.validityMonths)

      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          displayName: formData.displayName,
          email: formData.email,
          packageType: formData.packageType,
          role: formData.role,
          validFrom: validFrom.toISOString(),
          validUntil: validUntil.toISOString(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '创建用户失败')
      }

      setCreatedUser({
        username: data.data.user.username,
        defaultPassword: data.data.defaultPassword,
      })
    } catch (err: any) {
      setError(err.message || '创建用户失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setFormData({
      displayName: '',
      email: '',
      packageType: 'trial',
      role: 'user',
      validityMonths: 12,
    })
    setCreatedUser(null)
    setError('')
    onClose()
  }

  const handleSuccessClose = () => {
    handleClose()
    onSuccess()
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-gray-900">创建新用户</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {createdUser ? (
            <div className="space-y-6">
              <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                <div className="flex items-center mb-4">
                  <svg className="w-6 h-6 text-green-600 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <h3 className="text-lg font-semibold text-green-900">用户创建成功！</h3>
                </div>
                <div className="space-y-3">
                  <div className="bg-white rounded p-4 border border-green-300">
                    <p className="text-sm text-gray-600 mb-1">用户名（登录账号）</p>
                    <p className="text-lg font-mono font-semibold text-gray-900">{createdUser.username}</p>
                  </div>
                  <div className="bg-white rounded p-4 border border-green-300">
                    <p className="text-sm text-gray-600 mb-1">初始密码</p>
                    <p className="text-lg font-mono font-semibold text-gray-900">{createdUser.defaultPassword}</p>
                  </div>
                </div>
                <div className="mt-4 bg-yellow-50 border border-yellow-300 rounded p-3">
                  <p className="text-sm text-yellow-800">
                    ⚠️ 请将用户名和初始密码发送给用户。用户首次登录后需要修改密码。
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleSuccessClose}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  完成
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              {error && (
                <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
                  {error}
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  显示名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.displayName}
                  onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="例如: 张三"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  邮箱地址（可选）
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="user@example.com（可选）"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  套餐类型 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.packageType}
                  onChange={(e) => setFormData({ ...formData, packageType: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="trial">试用版 (免费)</option>
                  <option value="annual">年卡版 (¥5,999/年)</option>
                  <option value="lifetime">长期会员 (¥10,999)</option>
                  <option value="enterprise">私有化部署 (¥29,999)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  用户角色 <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value as any })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  有效期（月） <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  max="120"
                  value={formData.validityMonths}
                  onChange={(e) => setFormData({ ...formData, validityMonths: parseInt(e.target.value) })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="mt-1 text-sm text-gray-500">
                  账号将在 {formData.validityMonths} 个月后过期
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">创建说明</h4>
                <ul className="text-sm text-blue-700 space-y-1">
                  <li>• 系统将自动生成随机用户名（动物名称格式）</li>
                  <li>• 初始密码为: auto11@20ads</li>
                  <li>• 用户首次登录后必须修改密码</li>
                </ul>
              </div>

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
                  disabled={loading}
                  className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loading ? '创建中...' : '创建用户'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
