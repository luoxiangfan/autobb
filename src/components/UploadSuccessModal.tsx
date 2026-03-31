/**
 * UploadSuccessModal - 批量上传成功提示弹窗
 *
 * 功能：
 * - 上传成功后立即显示
 * - 说明后续处理流程
 * - 引导用户查看上传记录
 */

'use client'

import { useEffect } from 'react'
import { CheckCircleIcon, ClockIcon, XMarkIcon } from '@heroicons/react/24/outline'

interface UploadSuccessModalProps {
  isOpen: boolean
  onClose: () => void
  fileName: string
  validCount: number
  skippedCount: number
}

export default function UploadSuccessModal({
  isOpen,
  onClose,
  fileName,
  validCount,
  skippedCount
}: UploadSuccessModalProps) {
  // 锁定背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'unset'
    }
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* 遮罩层 */}
      <div
        className="fixed inset-0 bg-black bg-opacity-25 transition-opacity"
        onClick={onClose}
      />

      {/* 弹窗内容 */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative w-full max-w-md transform rounded-2xl bg-white p-6 text-left shadow-xl transition-all">
          {/* 关闭按钮 */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-500"
          >
            <XMarkIcon className="h-6 w-6" />
          </button>

          <div className="flex items-start">
            <div className="flex-shrink-0">
              <CheckCircleIcon className="h-12 w-12 text-green-600" />
            </div>

            <div className="ml-4 flex-1">
              <h3 className="text-lg font-medium leading-6 text-gray-900">
                文件上传成功
              </h3>

              <div className="mt-4 space-y-3">
                <div className="text-sm text-gray-600">
                  <p className="font-medium text-gray-900">文件：{fileName}</p>
                  <p className="mt-1">
                    有效数据：<span className="font-semibold text-blue-600">{validCount}</span> 行
                  </p>
                  {skippedCount > 0 && (
                    <p className="text-yellow-600">
                      跳过：{skippedCount} 行（缺少必填参数）
                    </p>
                  )}
                </div>

                <div className="flex items-start space-x-2 rounded-lg bg-blue-50 p-3">
                  <ClockIcon className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">正在后台处理</p>
                    <p className="mt-1">
                      系统正在批量创建 {validCount} 个Offer，这可能需要几分钟时间。
                      您可以在"上传文件记录"中查看处理进度和结果。
                    </p>
                  </div>
                </div>

                <div className="text-xs text-gray-500 border-l-2 border-gray-300 pl-3">
                  <p className="font-medium mb-1">处理流程：</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>解析Amazon链接，提取产品信息</li>
                    <li>生成AI推广创意</li>
                    <li>创建Offer记录</li>
                  </ol>
                </div>
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  className="inline-flex justify-center rounded-md border border-transparent bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  onClick={onClose}
                >
                  知道了
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
