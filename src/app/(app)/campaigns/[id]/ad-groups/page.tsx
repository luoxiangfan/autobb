'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { showSuccess, showError } from '@/lib/toast-utils'

interface AdGroup {
  id: number
  campaignId: number
  adGroupId: string | null
  adGroupName: string
  status: string
  cpcBidMicros: number | null
  creationStatus: string
  creationError: string | null
  createdAt: string
}

interface Keyword {
  id: number
  keywordText: string
  matchType: string
  status: string
  isNegative: boolean
  aiGenerated: boolean
}

export default function AdGroupsPage() {
  const router = useRouter()
  const params = useParams()
  const campaignId = params?.id as string

  const [adGroups, setAdGroups] = useState<AdGroup[]>([])
  const [keywords, setKeywords] = useState<Record<number, Keyword[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [syncing, setSyncing] = useState<number | null>(null)
  const [generating, setGenerating] = useState<number | null>(null)

  const [newAdGroupName, setNewAdGroupName] = useState('')
  const [creatingAdGroup, setCreatingAdGroup] = useState(false)

  useEffect(() => {
    fetchAdGroups()
  }, [campaignId])

  const fetchAdGroups = async () => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/ad-groups?campaignId=${campaignId}`, {
        credentials: 'include',
      })

      if (!response.ok) {
        throw new Error('获取Ad Group列表失败')
      }

      const data = await response.json()
      setAdGroups(data.adGroups)

      // 获取每个Ad Group的Keywords
      for (const adGroup of data.adGroups) {
        fetchKeywords(adGroup.id)
      }
    } catch (err: any) {
      setError(err.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  const fetchKeywords = async (adGroupId: number) => {
    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/keywords?adGroupId=${adGroupId}`, {
        credentials: 'include', // 确保发送cookie
      })

      if (response.ok) {
        const data = await response.json()
        setKeywords(prev => ({
          ...prev,
          [adGroupId]: data.keywords,
        }))
      }
    } catch (err) {
      console.error('获取Keywords失败:', err)
    }
  }

  const handleCreateAdGroup = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreatingAdGroup(true)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch('/api/ad-groups', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          campaignId: parseInt(campaignId, 10),
          adGroupName: newAdGroupName,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || '创建Ad Group失败')
      }

      setNewAdGroupName('')
      fetchAdGroups()
    } catch (err: any) {
      showError('创建失败', err.message)
    } finally {
      setCreatingAdGroup(false)
    }
  }

  const handleGenerateKeywords = async (adGroupId: number) => {
    setGenerating(adGroupId)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/ad-groups/${adGroupId}/generate-keywords`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          includeNegativeKeywords: true,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'AI生成关键词失败')
      }

      showSuccess(
        '关键词生成成功',
        `已生成 ${data.positiveCount} 个关键词和 ${data.negativeCount} 个否定关键词`
      )
      fetchKeywords(adGroupId)
    } catch (err: any) {
      showError('生成失败', err.message)
    } finally {
      setGenerating(null)
    }
  }

  const handleSync = async (adGroupId: number) => {
    setSyncing(adGroupId)

    try {
      // HttpOnly Cookie自动携带，无需手动操作

      const response = await fetch(`/api/ad-groups/${adGroupId}/sync`, {
        method: 'POST',
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || '同步失败')
      }

      showSuccess('同步成功', `Ad Group和 ${data.syncedKeywordsCount} 个关键词已成功同步到Google Ads`)
      fetchAdGroups()
    } catch (err: any) {
      showError('同步失败', err.message)
    } finally {
      setSyncing(null)
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
              <a href="/campaigns" className="text-indigo-600 hover:text-indigo-500 mr-4">
                ← 返回Campaigns
              </a>
              <h1 className="text-xl font-bold text-gray-900">Ad Groups管理</h1>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <div className="px-4 py-6 sm:px-0">
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-50 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          {/* 创建Ad Group表单 */}
          <div className="mb-6 bg-white shadow rounded-lg p-4">
            <h3 className="text-lg font-medium mb-4">创建新Ad Group</h3>
            <form onSubmit={handleCreateAdGroup} className="flex space-x-3">
              <input
                type="text"
                value={newAdGroupName}
                onChange={e => setNewAdGroupName(e.target.value)}
                placeholder="Ad Group名称"
                required
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
              />
              <button
                type="submit"
                disabled={creatingAdGroup}
                className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {creatingAdGroup ? '创建中...' : '创建Ad Group'}
              </button>
            </form>
          </div>

          {/* Ad Groups列表 */}
          {adGroups.length === 0 ? (
            <div className="text-center py-12 bg-white rounded-lg shadow">
              <p className="text-gray-600">该Campaign还没有Ad Groups</p>
            </div>
          ) : (
            <div className="space-y-6">
              {adGroups.map(adGroup => (
                <div key={adGroup.id} className="bg-white shadow rounded-lg p-6">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {adGroup.adGroupName}
                      </h3>
                      <div className="mt-1 flex space-x-4 text-sm">
                        <span className="text-gray-600">状态: {adGroup.status}</span>
                        <span className="text-gray-600">
                          同步状态: {adGroup.creationStatus}
                        </span>
                        {adGroup.cpcBidMicros && (
                          <span className="text-gray-600">
                            CPC出价: ${(adGroup.cpcBidMicros / 1000000).toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      {adGroup.creationStatus === 'draft' && (
                        <>
                          <button
                            onClick={() => handleGenerateKeywords(adGroup.id)}
                            disabled={generating === adGroup.id}
                            className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                          >
                            {generating === adGroup.id ? 'AI生成中...' : 'AI生成关键词'}
                          </button>
                          <button
                            onClick={() => handleSync(adGroup.id)}
                            disabled={syncing === adGroup.id}
                            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                          >
                            {syncing === adGroup.id ? '同步中...' : '同步到Google Ads'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Keywords列表 */}
                  {keywords[adGroup.id] && keywords[adGroup.id].length > 0 && (
                    <div className="mt-4 border-t pt-4">
                      <h4 className="text-sm font-medium text-gray-700 mb-2">
                        关键词 ({keywords[adGroup.id].length})
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {keywords[adGroup.id].map(kw => (
                          <div
                            key={kw.id}
                            className={`text-xs px-2 py-1 rounded ${
                              kw.isNegative ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                            }`}
                          >
                            {kw.isNegative && '- '}
                            {kw.keywordText} ({kw.matchType})
                            {kw.aiGenerated && ' 🤖'}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
