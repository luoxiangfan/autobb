'use client'

import { useState, useEffect } from 'react'
import { History, Save, Undo2, Clock, CheckCircle, AlertCircle } from 'lucide-react'

interface Creative {
  id: number
  headlines: string[]
  descriptions: string[]
  finalUrl: string
  path1: string | null
  path2: string | null
  qualityScore: number | null
}

interface CreativeVersion {
  id: number
  creativeId: number
  versionNumber: number
  headlines: string[]
  descriptions: string[]
  finalUrl: string
  path1: string | null
  path2: string | null
  qualityScore: number | null
  qualityDetails: any
  createdBy: string
  creationMethod: string
  changeSummary: string | null
  createdAt: string
}

interface CreativeEditorProps {
  creative: Creative
  onSave?: (updated: Creative) => void
}

export function CreativeEditor({ creative, onSave }: CreativeEditorProps) {
  // 编辑状态
  const [headlines, setHeadlines] = useState<string[]>([
    creative.headlines[0] || '',
    creative.headlines[1] || '',
    creative.headlines[2] || '',
  ])
  const [descriptions, setDescriptions] = useState<string[]>([
    creative.descriptions[0] || '',
    creative.descriptions[1] || '',
  ])
  const [finalUrl, setFinalUrl] = useState(creative.finalUrl || '')
  const [path1, setPath1] = useState(creative.path1 || '')
  const [path2, setPath2] = useState(creative.path2 || '')

  // UI状态
  const [saving, setSaving] = useState(false)
  const [showVersions, setShowVersions] = useState(false)
  const [versions, setVersions] = useState<CreativeVersion[]>([])
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [saveMessage, setSaveMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  // 加载版本历史
  const loadVersions = async () => {
    setLoadingVersions(true)
    try {
      const response = await fetch(`/api/creatives/${creative.id}/versions`, {
        credentials: 'include'
      })
      if (!response.ok) throw new Error('获取版本历史失败')
      const result = await response.json()
      setVersions(result.data.versions)
    } catch (error) {
      console.error('加载版本历史失败:', error)
    } finally {
      setLoadingVersions(false)
    }
  }

  useEffect(() => {
    if (showVersions && versions.length === 0) {
      loadVersions()
    }
  }, [showVersions])

  // 保存编辑
  const handleSave = async () => {
    setSaving(true)
    setSaveMessage(null)

    try {
      // 过滤掉空字符串
      const validHeadlines = headlines.filter((h) => h.trim().length > 0)
      const validDescriptions = descriptions.filter((d) => d.trim().length > 0)

      // 验证
      if (validHeadlines.length < 3) {
        throw new Error('至少需要3个Headlines')
      }
      if (validDescriptions.length < 2) {
        throw new Error('至少需要2个Descriptions')
      }

      const response = await fetch(`/api/creatives/${creative.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headlines: validHeadlines,
          descriptions: validDescriptions,
          finalUrl,
          path1,
          path2,
          changeSummary: '手动编辑内容',
          creationMethod: 'inline_edit',
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '保存失败')
      }

      const result = await response.json()
      setSaveMessage({ type: 'success', text: result.message })

      // 重新加载版本列表
      await loadVersions()

      // 通知父组件
      if (onSave) {
        onSave({
          ...creative,
          headlines: validHeadlines,
          descriptions: validDescriptions,
        })
      }
    } catch (error) {
      console.error('保存失败:', error)
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '保存失败',
      })
    } finally {
      setSaving(false)
    }
  }

  // 回滚到指定版本
  const handleRollback = async (versionNumber: number) => {
    if (!confirm(`确定回滚到版本 ${versionNumber}？`)) return

    try {
      const response = await fetch(
        `/api/creatives/${creative.id}/versions/${versionNumber}/rollback`,
        {
          method: 'POST',
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || '回滚失败')
      }

      const result = await response.json()
      const version = result.data.version

      // 更新编辑器内容
      setHeadlines(version.headlines)
      setDescriptions(version.descriptions)
      setFinalUrl(version.finalUrl)
      setPath1(version.path1 || '')
      setPath2(version.path2 || '')

      setSaveMessage({ type: 'success', text: result.message })

      // 重新加载版本列表
      await loadVersions()
    } catch (error) {
      console.error('回滚失败:', error)
      setSaveMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '回滚失败',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* 保存消息 */}
      {saveMessage && (
        <div
          className={`flex items-center gap-2 p-4 rounded-lg ${
            saveMessage.type === 'success'
              ? 'bg-green-50 text-green-800'
              : 'bg-red-50 text-red-800'
          }`}
        >
          {saveMessage.type === 'success' ? (
            <CheckCircle className="h-5 w-5" />
          ) : (
            <AlertCircle className="h-5 w-5" />
          )}
          <span>{saveMessage.text}</span>
        </div>
      )}

      {/* Headlines编辑 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Headlines (3-15个)</h3>
        <div className="space-y-3">
          {headlines.map((headline, index) => (
            <div key={index}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-600">Headline {index + 1}</label>
                <span
                  className={`text-sm ${
                    headline.length > 30 ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  {headline.length}/30
                </span>
              </div>
              <input
                type="text"
                value={headline}
                onChange={(e) => {
                  const newHeadlines = [...headlines]
                  newHeadlines[index] = e.target.value
                  setHeadlines(newHeadlines)
                }}
                maxLength={30}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  headline.length > 30 ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder={`输入Headline ${index + 1}...`}
              />
            </div>
          ))}
          {headlines.length < 15 && (
            <button
              onClick={() => setHeadlines([...headlines, ''])}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              + 添加Headline
            </button>
          )}
        </div>
      </div>

      {/* Descriptions编辑 */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Descriptions (2-4个)</h3>
        <div className="space-y-3">
          {descriptions.map((description, index) => (
            <div key={index}>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm text-gray-600">Description {index + 1}</label>
                <span
                  className={`text-sm ${
                    description.length > 90 ? 'text-red-600' : 'text-gray-500'
                  }`}
                >
                  {description.length}/90
                </span>
              </div>
              <textarea
                value={description}
                onChange={(e) => {
                  const newDescriptions = [...descriptions]
                  newDescriptions[index] = e.target.value
                  setDescriptions(newDescriptions)
                }}
                maxLength={90}
                rows={2}
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  description.length > 90 ? 'border-red-500' : 'border-gray-300'
                }`}
                placeholder={`输入Description ${index + 1}...`}
              />
            </div>
          ))}
          {descriptions.length < 4 && (
            <button
              onClick={() => setDescriptions([...descriptions, ''])}
              className="text-sm text-blue-600 hover:text-blue-700"
            >
              + 添加Description
            </button>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setShowVersions(!showVersions)}
          className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          <History className="h-4 w-4" />
          版本历史 ({versions.length})
        </button>

        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中...' : '保存版本'}
        </button>
      </div>

      {/* 版本历史列表 */}
      {showVersions && (
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold mb-4">版本历史</h3>
          {loadingVersions ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-600">加载中...</p>
            </div>
          ) : versions.length === 0 ? (
            <p className="text-center text-gray-500 py-8">暂无版本历史</p>
          ) : (
            <div className="space-y-3">
              {versions.map((version) => (
                <div
                  key={version.id}
                  className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-gray-900">
                          版本 {version.versionNumber}
                        </span>
                        <span
                          className={`px-2 py-1 text-xs rounded-full ${
                            version.creationMethod === 'ai_generation'
                              ? 'bg-purple-100 text-purple-800'
                              : version.creationMethod === 'rollback'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {version.creationMethod === 'ai_generation'
                            ? 'AI生成'
                            : version.creationMethod === 'rollback'
                            ? '回滚'
                            : '手动编辑'}
                        </span>
                        {version.qualityScore && (
                          <span className="text-sm text-gray-600">
                            评分: {version.qualityScore.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-2">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {new Date(version.createdAt).toLocaleString('zh-CN')}
                      </p>
                      {version.changeSummary && (
                        <p className="text-sm text-gray-700">{version.changeSummary}</p>
                      )}
                      <div className="mt-2 text-sm">
                        <p className="text-gray-600">
                          Headlines: {version.headlines.join(' / ')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRollback(version.versionNumber)}
                      className="ml-4 flex items-center gap-1 px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <Undo2 className="h-4 w-4" />
                      回滚
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
