'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { showSuccess } from '@/lib/toast-utils'

interface GoogleAdsAccount {
  id: number
  customerId: string
  accountName: string | null
  currency: string
}

interface Offer {
  id: number
  brand: string
  targetCountry: string
}

export default function NewCampaignPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const offerIdParam = searchParams?.get('offerId')

  const [offer, setOffer] = useState<Offer | null>(null)
  const [googleAdsAccounts, setGoogleAdsAccounts] = useState<GoogleAdsAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  // 表单字段
  const [googleAdsAccountId, setGoogleAdsAccountId] = useState('')
  const [campaignName, setCampaignName] = useState('')
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetType, setBudgetType] = useState('DAILY')
  const [maxCpc, setMaxCpc] = useState('')
  const [status, setStatus] = useState('PAUSED')
  const [startDate, setStartDate] = useState('')

  useEffect(() => {
    if (offerIdParam) {
      fetchData()
    } else {
      setError('缺少offerId参数')
      setLoading(false)
    }
  }, [offerIdParam])

  const fetchData = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 获取Offer信息
      const offerRes = await fetch(`/api/offers/${offerIdParam}`, {
        credentials: 'include',
      })

      if (!offerRes.ok) {
        throw new Error('获取Offer失败')
      }

      const offerData = await offerRes.json()
      setOffer(offerData.offer)

      // 自动填充campaign名称
      setCampaignName(`${offerData.offer.brand} - ${offerData.offer.targetCountry} Campaign`)

      // 获取Google Ads账号列表
      const accountsRes = await fetch('/api/google-ads-accounts', {
        credentials: 'include',
      })

      if (accountsRes.ok) {
        const accountsData = await accountsRes.json()
        setGoogleAdsAccounts(accountsData.accounts)

        // 如果只有一个账号，自动选中
        if (accountsData.accounts.length === 1) {
          setGoogleAdsAccountId(accountsData.accounts[0].id.toString())
        }
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      // 验证必填字段
      if (!googleAdsAccountId || !campaignName || !budgetAmount) {
        throw new Error('请填写所有必填字段')
      }

      const response = await fetch('/api/campaigns', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          offerId: parseInt(offerIdParam!, 10),
          googleAdsAccountId: parseInt(googleAdsAccountId, 10),
          campaignName,
          budgetAmount: parseFloat(budgetAmount),
          budgetType,
          maxCpc: maxCpc ? parseFloat(maxCpc) : undefined,
          status,
          startDate: startDate || undefined,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '创建广告系列失败')
      }

      showSuccess('创建成功', '广告系列已创建')
      router.push(`/offers/${offerIdParam}`)
    } catch (err: any) {
      setError(err.message || '创建失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">加载中...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <a
                href={`/offers/${offerIdParam}`}
                className="text-indigo-600 hover:text-indigo-500 mr-4"
              >
                ← 返回Offer
              </a>
              <h1 className="text-xl font-bold text-gray-900">创建广告系列</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {offer && (
            <div className="mb-6 bg-white shadow rounded-lg p-4">
              <h3 className="text-sm font-medium text-gray-500">关联Offer</h3>
              <p className="mt-1 text-sm text-gray-900">
                {offer.brand} - {offer.targetCountry}
              </p>
            </div>
          )}

          {googleAdsAccounts.length === 0 && (
            <div className="mb-6 px-4 py-3 bg-yellow-50 border border-yellow-400 text-yellow-700 rounded">
              您还没有绑定Google Ads账号，请先{' '}
              <a href="/settings" className="underline">
                前往设置
              </a>{' '}
              添加账号
            </div>
          )}

          <div className="bg-white shadow rounded-lg">
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Google Ads账号选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Google Ads账号 *
                </label>
                <select
                  value={googleAdsAccountId}
                  onChange={e => setGoogleAdsAccountId(e.target.value)}
                  required
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                >
                  <option value="">请选择账号</option>
                  {googleAdsAccounts.map(account => (
                    <option key={account.id} value={account.id}>
                      {account.accountName || account.customerId} ({account.currency})
                    </option>
                  ))}
                </select>
              </div>

              {/* 广告系列名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  广告系列名称 *
                </label>
                <input
                  type="text"
                  value={campaignName}
                  onChange={e => setCampaignName(e.target.value)}
                  required
                  placeholder="例如：Reolink - US Campaign"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* 预算设置 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">预算金额 *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={budgetAmount}
                    onChange={e => setBudgetAmount(e.target.value)}
                    required
                    placeholder="例如：100.00"
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">预算类型</label>
                  <select
                    value={budgetType}
                    onChange={e => setBudgetType(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="DAILY">每日预算</option>
                    <option value="TOTAL">总预算</option>
                  </select>
                </div>
              </div>

              {/* 出价设置 */}
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  最高CPC（可选）
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={maxCpc}
                  onChange={e => setMaxCpc(e.target.value)}
                  placeholder="例如：1.50"
                  className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                />
                <p className="mt-1 text-xs text-gray-500">不填写则使用自动出价</p>
              </div>

              {/* 状态和日期 */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">初始状态</label>
                  <select
                    value={status}
                    onChange={e => setStatus(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="PAUSED">暂停</option>
                    <option value="ENABLED">启用</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    开始日期（可选）
                  </label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStartDate(e.target.value)}
                    className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* 提交按钮 */}
              <div className="flex space-x-3">
                <button
                  type="submit"
                  disabled={submitting || googleAdsAccounts.length === 0}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? '创建中...' : '创建广告系列'}
                </button>
                <button
                  type="button"
                  onClick={() => router.push(`/offers/${offerIdParam}`)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </form>
          </div>

          {/* 提示信息 */}
          <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-2">注意事项</h3>
            <ul className="text-sm text-blue-700 space-y-1 list-disc list-inside">
              <li>广告系列创建后默认为草稿状态，不会立即投放</li>
              <li>请确保预算金额符合Google Ads的最低要求</li>
              <li>建议先设置为暂停状态，完成所有配置后再启用</li>
              <li>完整的Google Ads同步功能将在后续版本中提供</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  )
}
