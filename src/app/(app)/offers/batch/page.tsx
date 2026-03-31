/**
 * 批量创建Offer页面
 *
 * 功能：
 * 1. 下载CSV模板
 * 2. 上传CSV文件进行批量创建
 * 3. 显示上传文件记录列表（替代实时进度）
 *
 * 特性：
 * - 非阻塞上传：文件上传后立即返回，后台处理
 * - 弹窗提示：上传成功后显示处理流程说明
 * - 记录追踪：显示历史上传记录及处理结果
 * - 无SSE timeout：不再使用SSE实时进度，避免超时
 */

'use client'

import { useState, useEffect } from 'react'
import { ArrowDownTrayIcon, ArrowUpTrayIcon, ClockIcon, CheckCircleIcon, XCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import UploadSuccessModal from '@/components/UploadSuccessModal'

interface UploadRecord {
  id: string
  batchId: string
  fileName: string
  uploadedAt: string
  validCount: number
  processedCount: number
  skippedCount: number
  failedCount: number
  successRate: number
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'partial'
  completedAt: string | null
}

export default function BatchOfferPage() {
  const [isUploading, setIsUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const [uploadResult, setUploadResult] = useState<{
    fileName: string
    validCount: number
    skippedCount: number
  } | null>(null)

  const [records, setRecords] = useState<UploadRecord[]>([])
  const [isLoadingRecords, setIsLoadingRecords] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)

  // 取消任务状态
  const [cancellingBatchId, setCancellingBatchId] = useState<string | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [batchToCancel, setBatchToCancel] = useState<{ id: string; fileName: string } | null>(null)

  // 下载CSV模板
  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/offers/batch-template')
      if (!response.ok) throw new Error('下载模板失败')

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'offer_batch_template.csv'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch (error: any) {
      console.error('Download template error:', error)
      alert(`下载失败: ${error.message}`)
    }
  }

  // 上传CSV文件
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // 重置状态
    setUploadError(null)
    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/offers/batch/create', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }

      const data = await response.json()

      // 计算跳过的行数
      const skippedCount = data.skippedCount || 0

      // 显示成功弹窗
      setUploadResult({
        fileName: file.name,
        validCount: data.totalCount,
        skippedCount
      })
      setShowSuccessModal(true)

      // 刷新上传记录列表
      await loadUploadRecords()

      // 重置文件输入
      event.target.value = ''

    } catch (error: any) {
      console.error('Upload error:', error)
      setUploadError(error.message || '上传失败')
    } finally {
      setIsUploading(false)
    }
  }

  // 加载上传记录列表
  const loadUploadRecords = async () => {
    try {
      setIsLoadingRecords(true)
      setRecordsError(null)

      const response = await fetch('/api/offers/batch/upload-records?limit=20')
      if (!response.ok) {
        throw new Error('获取上传记录失败')
      }

      const result = await response.json()
      setRecords(result.data || [])
    } catch (error: any) {
      console.error('Load records error:', error)
      setRecordsError(error.message)
    } finally {
      setIsLoadingRecords(false)
    }
  }

  // 初始加载
  useEffect(() => {
    loadUploadRecords()
  }, [])

  // 打开取消确认对话框
  const handleCancelClick = (batch: { id: string; fileName: string }) => {
    setBatchToCancel(batch)
    setShowCancelConfirm(true)
  }

  // 确认取消批量任务
  const confirmCancel = async () => {
    if (!batchToCancel) return

    setCancellingBatchId(batchToCancel.id)
    setShowCancelConfirm(false)

    try {
      const response = await fetch(`/api/offers/batch/${batchToCancel.id}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: '用户主动取消'
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.message || `HTTP ${response.status}`)
      }

      const result = await response.json()
      console.log('✅ 批量任务已取消:', result)

      // 刷新记录列表
      await loadUploadRecords()

      // 显示成功提示
      alert(`已成功取消批量任务\n已取消: ${result.stats.cancelled} 个任务`)

    } catch (error: any) {
      console.error('取消批量任务失败:', error)
      alert(`取消失败: ${error.message}`)
    } finally {
      setCancellingBatchId(null)
      setBatchToCancel(null)
    }
  }

  // 状态标签样式
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
          <ClockIcon className="w-4 h-4 mr-1" />
          待处理
        </span>
      case 'processing':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
          <ClockIcon className="w-4 h-4 mr-1 animate-spin" />
          处理中
        </span>
      case 'completed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
          <CheckCircleIcon className="w-4 h-4 mr-1" />
          已完成
        </span>
      case 'failed':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
          <XCircleIcon className="w-4 h-4 mr-1" />
          失败
        </span>
      case 'partial':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
          <ExclamationCircleIcon className="w-4 h-4 mr-1" />
          部分成功
        </span>
      case 'cancelled':
        return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          <XCircleIcon className="w-4 h-4 mr-1" />
          已取消
        </span>
      default:
        return null
    }
  }

  // 格式化时间
  const formatTime = (isoString: string) => {
    const date = new Date(isoString)
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">批量创建Offer</h1>
        <p className="mt-2 text-sm text-gray-600">
          上传CSV文件批量创建Offer，支持自动提取产品信息和生成推广创意
        </p>
      </div>

      {/* 上传区域 */}
      <div className="bg-white shadow rounded-lg p-6 mb-8">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-medium text-gray-900">上传CSV文件</h2>
            <p className="mt-1 text-sm text-gray-600">
              请先下载模板，填写后上传。必填列："推广链接"、"推广国家"；选填列："链接类型"、"品牌名"、"产品价格/平均产品价格"、"佣金比例/平均佣金比例"、"单品推广链接1~3"。
            </p>
          </div>
          <button
            onClick={handleDownloadTemplate}
            className="inline-flex w-fit shrink-0 items-center whitespace-nowrap rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <ArrowDownTrayIcon className="h-5 w-5 mr-2 text-gray-500" />
            下载模板
          </button>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-8">
          <div className="flex justify-center">
            <label className="relative cursor-pointer">
              <div className="flex flex-col items-center">
                <ArrowUpTrayIcon className="h-12 w-12 text-gray-400" />
                <span className="mt-2 block text-sm font-medium text-gray-900">
                  {isUploading ? '上传中...' : '点击选择CSV文件'}
                </span>
                <span className="mt-1 block text-xs text-gray-500">
                  支持UTF-8编码，最大500行
                </span>
              </div>
              <input
                type="file"
                className="sr-only"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                disabled={isUploading}
              />
            </label>
          </div>
        </div>

        {uploadError && (
          <div className="mt-4 rounded-md bg-red-50 p-4">
            <div className="flex">
              <XCircleIcon className="h-5 w-5 text-red-400" />
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">上传失败</h3>
                <div className="mt-2 text-sm text-red-700">{uploadError}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 上传文件记录 */}
      <div className="bg-white shadow rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium text-gray-900">上传文件记录</h2>
          <button
            onClick={loadUploadRecords}
            disabled={isLoadingRecords}
            className="text-sm text-blue-600 hover:text-blue-700 disabled:opacity-50"
          >
            {isLoadingRecords ? '刷新中...' : '刷新'}
          </button>
        </div>

        {recordsError && (
          <div className="rounded-md bg-red-50 p-4 mb-4">
            <div className="flex">
              <XCircleIcon className="h-5 w-5 text-red-400" />
              <div className="ml-3">
                <p className="text-sm text-red-700">{recordsError}</p>
              </div>
            </div>
          </div>
        )}

        {isLoadingRecords && records.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-blue-600 border-r-transparent"></div>
            <p className="mt-4 text-sm text-gray-500">加载中...</p>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm text-gray-500">暂无上传记录</p>
          </div>
        ) : (
          <div className="w-full">
            <table className="w-full table-fixed divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="w-28 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    上传记录ID
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    文件名
                  </th>
                  <th className="w-36 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    上传时间
                  </th>
                  <th className="hidden w-20 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap sm:table-cell">
                    有效数量
                  </th>
                  <th className="hidden w-20 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap sm:table-cell">
                    处理数量
                  </th>
                  <th className="hidden w-20 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap lg:table-cell">
                    成功率
                  </th>
                  <th className="w-24 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    状态
                  </th>
                  <th className="hidden w-16 px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap md:table-cell">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-gray-50">
                    <td className="px-3 py-4 text-xs text-gray-500">
                      <span className="block break-all font-mono">{record.id}</span>
                    </td>
                    <td className="px-3 py-4 text-sm font-medium text-gray-900">
                      <span className="block break-words">{record.fileName}</span>
                      {record.skippedCount > 0 && (
                        <span className="ml-2 text-xs text-yellow-600">
                          (跳过{record.skippedCount}行)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm text-gray-500">
                      {formatTime(record.uploadedAt)}
                    </td>
                    <td className="hidden px-3 py-4 whitespace-nowrap text-sm text-gray-900 sm:table-cell">
                      {record.validCount}
                    </td>
                    <td className="hidden px-3 py-4 whitespace-nowrap text-sm text-gray-900 sm:table-cell">
                      {record.processedCount}
                      {record.failedCount > 0 && (
                        <span className="ml-1 text-red-600">
                          ({record.failedCount} 失败)
                        </span>
                      )}
                    </td>
                    <td className="hidden px-3 py-4 whitespace-nowrap text-sm lg:table-cell">
                      <span className={`font-semibold ${
                        Number(record.successRate) >= 90 ? 'text-green-600' :
                        Number(record.successRate) >= 70 ? 'text-yellow-600' :
                        'text-red-600'
                      }`}>
                        {Number(record.successRate).toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-3 py-4 whitespace-nowrap text-sm">
                      {getStatusBadge(record.status)}
                    </td>
                    <td className="hidden px-3 py-4 whitespace-nowrap text-sm md:table-cell">
                      {(record.status === 'pending' || record.status === 'processing') && (
                        <button
                          onClick={() => handleCancelClick({ id: record.batchId, fileName: record.fileName })}
                          disabled={cancellingBatchId === record.batchId}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cancellingBatchId === record.batchId ? '取消中...' : '取消'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 取消确认对话框 */}
      {showCancelConfirm && batchToCancel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-medium text-gray-900 mb-4">
              确认取消批量任务
            </h3>
            <p className="text-sm text-gray-600 mb-6">
              确定要取消 <span className="font-semibold">{batchToCancel.fileName}</span> 的批量创建任务吗？
              <br />
              <span className="text-red-600">未处理的Offer将被移除，正在处理的任务将继续完成。</span>
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setShowCancelConfirm(false)
                  setBatchToCancel(null)
                }}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
              >
                取消操作
              </button>
              <button
                onClick={confirmCancel}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md"
              >
                确认取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 上传成功弹窗 */}
      {uploadResult && (
        <UploadSuccessModal
          isOpen={showSuccessModal}
          onClose={() => setShowSuccessModal(false)}
          fileName={uploadResult.fileName}
          validCount={uploadResult.validCount}
          skippedCount={uploadResult.skippedCount}
        />
      )}
    </div>
  )
}
