'use client'

import { useState, useEffect } from 'react'
import { showSuccess } from '@/lib/toast-utils'

interface UserEditModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  user: {
    id: number
    username: string
    email: string | null
    displayName: string
    role: string
    packageType: string
    validFrom: string
    validUntil: string
    isActive: number
  }
}

export default function UserEditModal({ isOpen, onClose, onSuccess, user }: UserEditModalProps) {
  const [formData, setFormData] = useState({
    packageType: user.packageType,
    validFrom: user.validFrom?.split('T')[0] || '',
    validUntil: user.validUntil?.split('T')[0] || '',
    isActive: user.isActive === 1,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 当user变化时更新表单数据
  useEffect(() => {
    setFormData({
      packageType: user.packageType,
      validFrom: user.validFrom?.split('T')[0] || '',
      validUntil: user.validUntil?.split('T')[0] || '',
      isActive: user.isActive === 1,
    })
  }, [user])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 验证日期
      if (formData.validFrom && formData.validUntil) {
        const fromDate = new Date(formData.validFrom)
        const toDate = new Date(formData.validUntil)
        if (fromDate >= toDate) {
          throw new Error('有效期起始日期必须早于结束日期')
        }
      }

      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          packageType: formData.packageType,
          validFrom: formData.validFrom ? new Date(formData.validFrom).toISOString() : null,
          validUntil: formData.validUntil ? new Date(formData.validUntil).toISOString() : null,
          isActive: formData.isActive,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '更新用户失败')
      }

      showSuccess('更新成功', '用户信息已更新')
      onSuccess()
    } catch (err: any) {
      setError(err.message || '更新用户失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setError('')
    onClose()
  }

  // 套餐类型选项
  const packageOptions = [
    { value: 'trial', label: '试用版', color: 'text-gray-700' },
    { value: 'annual', label: '年卡版 (¥5,999/年)', color: 'text-blue-700' },
    { value: 'lifetime', label: '长期会员 (¥10,999)', color: 'text-green-700' },
    { value: 'enterprise', label: '私有化部署 (¥29,999)', color: 'text-purple-700' },
  ]

  // 套餐类型变更时自动更新有效期
  const handlePackageTypeChange = (newPackageType: string) => {
    setFormData({ ...formData, packageType: newPackageType })

    // 根据套餐类型自动设置有效期
    const today = new Date()
    let validFrom = today.toISOString().split('T')[0]
    let validUntil: string | null = null

    switch (newPackageType) {
      case 'trial': {     // 试用版 → 7天
        const untilDate = new Date()
        untilDate.setDate(untilDate.getDate() + 7)
        validUntil = untilDate.toISOString().split('T')[0]
        break
      }
      case 'annual': {    // 年卡版 → 12个月
        const untilDate = new Date()
        untilDate.setMonth(untilDate.getMonth() + 12)
        validUntil = untilDate.toISOString().split('T')[0]
        break
      }
      case 'lifetime': {  // 长期会员 → 120个月（10年）
        const untilDate = new Date()
        untilDate.setMonth(untilDate.getMonth() + 120)
        validUntil = untilDate.toISOString().split('T')[0]
        break
      }
      case 'enterprise': { // 私有化 → 120个月（10年）
        const untilDate = new Date()
        untilDate.setMonth(untilDate.getMonth() + 120)
        validUntil = untilDate.toISOString().split('T')[0]
        break
      }
      default:
        return // 其他类型不自动修改
    }

    setFormData(prev => ({ ...prev, validFrom, validUntil }))
  }

  // 快速设置有效期（手动调整）
  const setQuickValidity = (months: number) => {
    const today = new Date()
    const validFrom = today.toISOString().split('T')[0]
    const validUntil = new Date(today.setMonth(today.getMonth() + months)).toISOString().split('T')[0]
    setFormData({
      ...formData,
      validFrom,
      validUntil,
    })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">编辑用户</h2>
            <p className="text-sm text-gray-500 mt-1">
              用户名: {user.username} | 邮箱: {user.email || 'N/A'}
            </p>
          </div>
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
        <form onSubmit={handleSubmit} className="px-6 py-6 space-y-6">
          {error && (
            <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
              {error}
            </div>
          )}

          {/* 套餐类型 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              套餐类型 <span className="text-red-500">*</span>
            </label>
            <select
              value={formData.packageType}
              onChange={(e) => handlePackageTypeChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {packageOptions.map((option) => (
                <option key={option.value} value={option.value} className={option.color}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* 有效期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              有效期设置
            </label>

            {/* 快速设置按钮 */}
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setQuickValidity(1)}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                1个月
              </button>
              <button
                type="button"
                onClick={() => setQuickValidity(3)}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                3个月
              </button>
              <button
                type="button"
                onClick={() => setQuickValidity(6)}
                className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                6个月
              </button>
              <button
                type="button"
                onClick={() => setQuickValidity(12)}
                className="px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                1年
              </button>
              <button
                type="button"
                onClick={() => setQuickValidity(24)}
                className="px-3 py-1 text-sm bg-green-100 text-green-700 rounded hover:bg-green-200"
              >
                2年
              </button>
              <button
                type="button"
                onClick={() => setQuickValidity(120)}
                className="px-3 py-1 text-sm bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
              >
                10年（长期）
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-600 mb-1">生效日期</label>
                <input
                  type="date"
                  value={formData.validFrom}
                  onChange={(e) => setFormData({ ...formData, validFrom: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">到期日期</label>
                <input
                  type="date"
                  value={formData.validUntil}
                  onChange={(e) => setFormData({ ...formData, validUntil: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </div>
            {formData.validFrom && formData.validUntil && (
              <p className="mt-2 text-sm text-gray-500">
                有效期: {formData.validFrom} 至 {formData.validUntil}
              </p>
            )}
          </div>

          {/* 账号状态 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              账号状态
            </label>
            <div className="flex items-center space-x-4">
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  checked={formData.isActive}
                  onChange={() => setFormData({ ...formData, isActive: true })}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">启用</span>
              </label>
              <label className="flex items-center cursor-pointer">
                <input
                  type="radio"
                  checked={!formData.isActive}
                  onChange={() => setFormData({ ...formData, isActive: false })}
                  className="mr-2"
                />
                <span className="text-sm text-gray-700">禁用</span>
              </label>
            </div>
            {!formData.isActive && (
              <p className="mt-2 text-sm text-yellow-600">
                ⚠️ 禁用后用户将无法登录系统
              </p>
            )}
          </div>

          {/* 用户信息预览 */}
          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-3">当前用户信息</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">显示名称:</span>
                <span className="ml-2 text-gray-900">{user.displayName}</span>
              </div>
              <div>
                <span className="text-gray-500">角色:</span>
                <span className="ml-2 text-gray-900">
                  {user.role === 'admin' ? '管理员' : '普通用户'}
                </span>
              </div>
            </div>
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
              disabled={loading}
              className="px-6 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              {loading ? '保存中...' : '保存修改'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
