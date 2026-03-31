'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

interface UserInfo {
  id: number
  email: string
  username?: string
  displayName: string | null
  role: string
  packageType: string
  packageExpiresAt: string | null
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<UserInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchUserInfo()
  }, [])

  const fetchUserInfo = async () => {
    try {
      const response = await fetch('/api/auth/me', {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('认证失败')
      }

      const data = await response.json()
      console.log('User data:', data)
      setUser(data.user)
    } catch (err: any) {
      console.error('Auth error:', err)
      setError(err.message || '获取用户信息失败')
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    router.push('/login')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600 font-medium">正在加载仪表盘...</p>
        </div>
      </div>
    )
  }

  if (error || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8 bg-white rounded-2xl shadow-lg max-w-md w-full">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <p className="text-gray-900 font-semibold text-lg mb-2">{error || '加载失败'}</p>
          <button
            onClick={() => router.push('/login')}
            className="mt-6 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium w-full"
          >
            返回登录
          </button>
        </div>
      </div>
    )
  }

  const packageLabels = {
    trial: '试用版',
    annual: '年度会员',
    lifetime: '长期会员',
    enterprise: '私有化部署',
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Top Navigation Bar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">
                A
              </div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">
                AutoAds <span className="text-gray-400 font-normal">仪表盘</span>
              </h1>
            </div>
            <div className="flex items-center space-x-6">
              {user.role === 'admin' && (
                <div className="hidden md:flex items-center space-x-4 mr-4 border-r border-gray-100 pr-4">
                  <a href="/admin/users" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
                    用户管理
                  </a>
                </div>
              )}
              <div className="flex items-center space-x-3 pl-6 border-l border-gray-100">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-medium text-gray-900">{user.username || user.email}</div>
                  <div className="text-xs text-gray-500 capitalize">{user.role}</div>
                </div>
                <div className="h-10 w-10 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg border-2 border-white shadow-sm">
                  {(user.username || user.email || 'U')[0].toUpperCase()}
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-red-600 transition-colors font-medium"
              >
                退出登录
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="space-y-8">
          {/* Welcome Section */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">
                欢迎回来, {user.username || 'User'}! 👋
              </h2>
              <p className="text-gray-500 mt-1">这是您今天的广告投放概况。</p>
            </div>
            <div className="flex gap-3">
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-50 text-blue-700 border border-blue-100">
                {packageLabels[user.packageType as keyof typeof packageLabels]} 套餐
              </span>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <a
              href="/offers"
              className="group relative overflow-hidden p-6 bg-white border border-gray-200 rounded-2xl hover:shadow-lg hover:border-blue-300 transition-all duration-300"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <div className="text-6xl">📦</div>
              </div>
              <h4 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">Offer 管理</h4>
              <p className="text-sm text-gray-500">创建和管理您的联盟 Offer 及产品。</p>
            </a>
            <a
              href="/campaigns"
              className="group relative overflow-hidden p-6 bg-white border border-gray-200 rounded-2xl hover:shadow-lg hover:border-green-300 transition-all duration-300"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <div className="text-6xl">🚀</div>
              </div>
              <h4 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-green-600 transition-colors">广告活动</h4>
              <p className="text-sm text-gray-500">监控和优化您的 Google Ads 广告活动。</p>
            </a>
            <a
              href="/settings"
              className="group relative overflow-hidden p-6 bg-white border border-gray-200 rounded-2xl hover:shadow-lg hover:border-purple-300 transition-all duration-300"
            >
              <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                <div className="text-6xl">⚙️</div>
              </div>
              <h4 className="text-lg font-bold text-gray-900 mb-2 group-hover:text-purple-600 transition-colors">系统设置</h4>
              <p className="text-sm text-gray-500">配置 API 密钥和系统偏好设置。</p>
            </a>
          </div>

          {/* Placeholder for components */}
          <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center">
            <div className="text-6xl mb-4">📊</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Dashboard 组件加载中</h3>
            <p className="text-gray-500">系统正在初始化数据统计功能...</p>
          </div>
        </div>
      </main>
    </div>
  )
}
