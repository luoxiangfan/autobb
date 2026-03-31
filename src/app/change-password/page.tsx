'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { showSuccess } from '@/lib/toast-utils'

export default function ChangePasswordPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [passwordErrors, setPasswordErrors] = useState<string[]>([])

  // 密码复杂度验证
  const validatePasswordStrength = (password: string): string[] => {
    const errors: string[] = []

    if (password.length < 8) {
      errors.push('密码至少需要8个字符')
    }
    if (!/[A-Z]/.test(password)) {
      errors.push('密码至少需要1个大写字母')
    }
    if (!/[a-z]/.test(password)) {
      errors.push('密码至少需要1个小写字母')
    }
    if (!/[0-9]/.test(password)) {
      errors.push('密码至少需要1个数字')
    }
    if (!/[!@#$%^&*]/.test(password)) {
      errors.push('密码至少需要1个特殊字符（!@#$%^&*）')
    }

    return errors
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPassword = e.target.value
    setFormData({ ...formData, newPassword })

    // 实时验证密码强度
    if (newPassword) {
      const errors = validatePasswordStrength(newPassword)
      setPasswordErrors(errors)
    } else {
      setPasswordErrors([])
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    // 验证新密码和确认密码是否一致
    if (formData.newPassword !== formData.confirmPassword) {
      setError('两次输入的密码不一致')
      return
    }

    // 验证密码强度
    const errors = validatePasswordStrength(formData.newPassword)
    if (errors.length > 0) {
      setError('密码不符合复杂度要求')
      return
    }

    setLoading(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 确保发送cookie
        body: JSON.stringify({
          currentPassword: formData.currentPassword,
          newPassword: formData.newPassword,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '修改密码失败')
      }

      // 修改成功，重定向到dashboard
      showSuccess('密码修改成功', '即将跳转到控制台')
      router.push('/dashboard')
    } catch (err: any) {
      setError(err.message || '修改密码失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Left Side - Product Showcase */}
      <div className="hidden lg:flex lg:w-1/2 bg-gray-900 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/40 to-purple-900/40 z-10" />
        <Image
          src="/dashboard-dark.webp"
          alt="AutoAds Dashboard"
          layout="fill"
          objectFit="cover"
          className="opacity-40"
          priority
        />
        <div className="relative z-20 flex flex-col justify-between p-12 w-full h-full text-white">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Logo" width={0} height={0} sizes="100vw" className="h-8 w-auto brightness-0 invert" />
          </div>
          <div className="space-y-6 max-w-lg">
            <h1 className="text-4xl font-bold leading-tight">
              安全第一 <br />
              <span className="text-blue-400">保护您的账户资产</span>
            </h1>
            <p className="text-lg text-gray-300 leading-relaxed">
              "为了确保您的广告账户和数据安全，我们强制要求首次登录时修改默认密码。请设置一个强密码。"
            </p>
          </div>
          <div className="text-sm text-gray-500">
            &copy; 2025 AutoAds Inc.
          </div>
        </div>
      </div>

      {/* Right Side - Change Password Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-12 lg:w-1/2 bg-white">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center lg:text-left">
            <h2 className="text-3xl font-bold text-gray-900">修改初始密码</h2>
            <p className="mt-2 text-gray-600">
              为了您的账号安全，请设置新密码
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-lg text-sm flex items-center gap-2">
              <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" fillRule="evenodd"></path></svg>
              {error}
            </div>
          )}

          <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-5">
              <div>
                <label htmlFor="current-password" className="block text-sm font-medium text-gray-700 mb-1">
                  当前密码
                </label>
                <input
                  id="current-password"
                  name="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
                  placeholder="请输入当前密码"
                  value={formData.currentPassword}
                  onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                />
              </div>

              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-gray-700 mb-1">
                  新密码
                </label>
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
                  placeholder="请输入新密码"
                  value={formData.newPassword}
                  onChange={handlePasswordChange}
                />
                {/* 密码强度提示 */}
                {formData.newPassword && (
                  <div className="mt-2">
                    {passwordErrors.length > 0 ? (
                      <div className="text-xs text-red-600 space-y-1">
                        {passwordErrors.map((err, index) => (
                          <div key={index}>• {err}</div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-green-600 flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                        密码强度符合要求
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-sm font-medium text-gray-700 mb-1">
                  确认新密码
                </label>
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="appearance-none block w-full px-4 py-3 border border-gray-300 rounded-lg shadow-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm transition-all"
                  placeholder="请再次输入新密码"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                />
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-900 mb-2">密码安全要求：</h3>
              <ul className="text-xs text-blue-700 space-y-1 grid grid-cols-2 gap-1">
                <li className="flex items-center gap-1">• 最少8个字符</li>
                <li className="flex items-center gap-1">• 至少1个大写字母</li>
                <li className="flex items-center gap-1">• 至少1个小写字母</li>
                <li className="flex items-center gap-1">• 至少1个数字</li>
                <li className="col-span-2 flex items-center gap-1">• 至少1个特殊字符（!@#$%^&*）</li>
              </ul>
            </div>

            <div>
              <button
                type="submit"
                disabled={loading || passwordErrors.length > 0}
                className="w-full flex justify-center py-3 px-4 border border-transparent rounded-lg shadow-sm text-sm font-semibold text-white bg-gray-900 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {loading ? '提交中...' : '确认修改'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
