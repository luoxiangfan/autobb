'use client'

import { useState, useEffect } from 'react'
import { DataExportImport } from '@/components/DataExportImport'
import { Database, FileSpreadsheet, HardDrive, TrendingUp, Settings } from 'lucide-react'

interface DataStats {
  offers: number
  campaigns: number
}

export default function DataManagementPage() {
  const [stats, setStats] = useState<DataStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 获取数据统计
    const fetchStats = async () => {
      try {
        // 并行获取统计数据
        const [offersRes, campaignsRes] = await Promise.all([
          fetch('/api/offers?limit=1', { credentials: 'include' }),
          fetch('/api/campaigns?limit=1', { credentials: 'include' }),
        ])

        const offersData = await offersRes.json()
        const campaignsData = await campaignsRes.json()

        setStats({
          offers: offersData.total || offersData.data?.length || 0,
          campaigns: campaignsData.total || campaignsData.data?.length || 0,
        })
      } catch (error) {
        console.error('获取统计数据失败:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* 页面标题 */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Database className="h-8 w-8 text-indigo-600" />
            数据管理
          </h1>
          <p className="mt-2 text-gray-600">
            导出和管理您的广告数据与系统配置
          </p>
        </div>

        {/* 数据统计卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Offers</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '-' : stats?.offers || 0}
                </p>
              </div>
              <FileSpreadsheet className="h-8 w-8 text-indigo-500 opacity-50" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Campaigns</p>
                <p className="text-2xl font-bold text-gray-900">
                  {loading ? '-' : stats?.campaigns || 0}
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-green-500 opacity-50" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">可导出</p>
                <p className="text-2xl font-bold text-indigo-600">3</p>
              </div>
              <HardDrive className="h-8 w-8 text-blue-500 opacity-50" />
            </div>
            <p className="text-xs text-gray-400 mt-1">Offers, Campaigns, Settings</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">可导入</p>
                <p className="text-2xl font-bold text-orange-600">1</p>
              </div>
              <Settings className="h-8 w-8 text-orange-500 opacity-50" />
            </div>
            <p className="text-xs text-gray-400 mt-1">Settings (JSON)</p>
          </div>
        </div>

        {/* 导入导出组件 */}
        <DataExportImport />

        {/* 使用说明 */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* 导出说明 */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-sm font-medium text-blue-900 mb-3 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              数据导出说明
            </h3>
            <ul className="text-sm text-blue-700 space-y-2">
              <li>• <strong>Offers/Campaigns</strong>: 支持JSON和CSV格式</li>
              <li>• <strong>Settings</strong>: 仅支持JSON格式</li>
              <li>• 敏感信息默认脱敏（如API密钥）</li>
              <li>• 勾选"包含敏感信息"可导出完整配置</li>
            </ul>
          </div>

          {/* 导入说明 */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-6">
            <h3 className="text-sm font-medium text-green-900 mb-3 flex items-center gap-2">
              <Settings className="h-4 w-4" />
              配置导入说明
            </h3>
            <ul className="text-sm text-green-700 space-y-2">
              <li>• 仅支持导入用户配置（Settings）</li>
              <li>• 请使用从本系统导出的JSON文件</li>
              <li>• 脱敏的配置项（含****）会被跳过</li>
              <li>• OAuth Token等敏感配置受保护，无法导入</li>
            </ul>
          </div>
        </div>

        {/* 配置分类说明 */}
        <div className="mt-6 bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium text-gray-900 mb-4">配置分类说明</h3>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left font-medium text-gray-700">分类</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">说明</th>
                  <th className="px-4 py-2 text-left font-medium text-gray-700">可导入</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                <tr>
                  <td className="px-4 py-2 font-mono text-indigo-600">google_ads</td>
                  <td className="px-4 py-2 text-gray-500">Google Ads API配置（客户ID、开发者令牌等）</td>
                  <td className="px-4 py-2"><span className="text-amber-600">部分</span></td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-indigo-600">ai</td>
                  <td className="px-4 py-2 text-gray-500">AI服务配置（API密钥、模型选择等）</td>
                  <td className="px-4 py-2"><span className="text-green-600">是</span></td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-indigo-600">proxy</td>
                  <td className="px-4 py-2 text-gray-500">代理服务器配置</td>
                  <td className="px-4 py-2"><span className="text-green-600">是</span></td>
                </tr>
                <tr>
                  <td className="px-4 py-2 font-mono text-indigo-600">system</td>
                  <td className="px-4 py-2 text-gray-500">系统通用配置</td>
                  <td className="px-4 py-2"><span className="text-green-600">是</span></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs text-gray-500">
            注意：OAuth认证相关的Token（refresh_token、access_token）为受保护配置，无法通过导入方式修改，需要重新进行OAuth授权。
          </p>
        </div>
      </div>
    </div>
  )
}
