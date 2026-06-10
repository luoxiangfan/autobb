'use client'

import { useState, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Download,
  Upload,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Settings,
  FileText,
} from 'lucide-react'

type ExportType = 'offers' | 'campaigns' | 'settings'
type ExportFormat = 'json' | 'csv'

interface ImportResult {
  imported: number
  skipped: number
  errors: number
  warnings: number
  errorMessages?: string[]
  warningMessages?: string[]
}

type StatusMessage = { type: 'success' | 'warning' | 'error'; text: string }

export function DataExportImport() {
  const [exportFormat, setExportFormat] = useState<ExportFormat>('json')
  const [exportType, setExportType] = useState<ExportType>('offers')
  const [includeSensitive, setIncludeSensitive] = useState(false)
  const [includeServiceAccountSensitive, setIncludeServiceAccountSensitive] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [serviceAccountImportFile, setServiceAccountImportFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [serviceAccountLoading, setServiceAccountLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)
  const [serviceAccountExportLoading, setServiceAccountExportLoading] = useState(false)
  const [message, setMessage] = useState<StatusMessage | null>(null)
  const [importResults, setImportResults] = useState<ImportResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const serviceAccountFileInputRef = useRef<HTMLInputElement>(null)

  const handleExportServiceAccount = async () => {
    setServiceAccountExportLoading(true)
    setMessage(null)

    try {
      const url = `/api/export/google-ads-service-account${
        includeServiceAccountSensitive ? '?include_sensitive=true' : ''
      }`
      const response = await fetch(url, { credentials: 'include' })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || '导出失败')
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = `google_ads_service_account_${new Date().toISOString().split('T')[0]}.json`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)

      setMessage({
        type: includeServiceAccountSensitive ? 'success' : 'warning',
        text: includeServiceAccountSensitive
          ? '已导出 Google Ads 服务账号备份（含敏感信息，可用于恢复）'
          : '已导出服务账号元数据（不含 private_key，无法用于恢复）',
      })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导出失败',
      })
    } finally {
      setServiceAccountExportLoading(false)
    }
  }

  const handleImportServiceAccount = async () => {
    if (!serviceAccountImportFile) {
      setMessage({ type: 'error', text: '请先选择服务账号备份文件' })
      return
    }

    setServiceAccountLoading(true)
    setMessage(null)

    try {
      const fileContent = await serviceAccountImportFile.text()
      const backupData = JSON.parse(fileContent)

      const response = await fetch('/api/import/google-ads-service-account', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backupData),
      })

      const result = await response.json()
      if (!response.ok) {
        throw new Error(result.error || '导入失败')
      }

      setMessage({ type: 'success', text: result.message || '服务账号配置已导入' })
      setServiceAccountImportFile(null)
      if (serviceAccountFileInputRef.current) {
        serviceAccountFileInputRef.current.value = ''
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导入失败',
      })
    } finally {
      setServiceAccountLoading(false)
    }
  }

  // 导出数据
  const handleExport = async () => {
    setExportLoading(true)
    setMessage(null)

    try {
      let url = `/api/export/${exportType}?format=${exportFormat}`

      // settings只支持JSON格式
      if (exportType === 'settings') {
        url = `/api/export/settings${includeSensitive ? '?include_sensitive=true' : ''}`
      }

      const response = await fetch(url, {
        credentials: 'include',
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || '导出失败')
      }

      // 下载文件
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl

      const typeLabels: Record<ExportType, string> = {
        offers: 'offers',
        campaigns: 'campaigns',
        settings: 'settings',
      }
      const ext = exportType === 'settings' ? 'json' : exportFormat
      a.download = `${typeLabels[exportType]}_${new Date().toISOString().split('T')[0]}.${ext}`

      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      document.body.removeChild(a)

      const typeNames: Record<ExportType, string> = {
        offers: 'Offers',
        campaigns: 'Campaigns',
        settings: '用户配置',
      }
      setMessage({ type: 'success', text: `成功导出 ${typeNames[exportType]} 数据` })
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导出失败',
      })
    } finally {
      setExportLoading(false)
    }
  }

  // 导入配置
  const handleImportSettings = async () => {
    if (!importFile) {
      setMessage({ type: 'error', text: '请先选择文件' })
      return
    }

    setLoading(true)
    setMessage(null)
    setImportResults(null)

    try {
      const fileContent = await importFile.text()
      let settingsData: any

      try {
        settingsData = JSON.parse(fileContent)
      } catch {
        throw new Error('无效的JSON文件格式')
      }

      const response = await fetch('/api/import/settings', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settingsData),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || '导入失败')
      }

      setImportResults({
        imported: result.summary?.imported || 0,
        skipped: result.summary?.skipped || 0,
        errors: result.summary?.errors || 0,
        warnings: result.summary?.warnings || 0,
        errorMessages: result.errors,
        warningMessages: result.warnings,
      })

      if (result.success) {
        setMessage({
          type: result.warnings?.length ? 'warning' : 'success',
          text: result.message,
        })
      } else if (result.partial) {
        setMessage({ type: 'warning', text: result.message })
      } else {
        setMessage({ type: 'error', text: result.message })
      }

      // 清空文件选择
      setImportFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : '导入失败',
      })
    } finally {
      setLoading(false)
    }
  }

  // 清空消息
  const clearMessage = () => {
    setMessage(null)
    setImportResults(null)
  }

  // 判断是否显示格式选择（settings只支持JSON）
  const showFormatSelect = exportType !== 'settings'
  // 判断是否显示敏感信息选项
  const showSensitiveOption = exportType === 'settings'

  return (
    <div className="space-y-6">
      {/* 数据导出 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="h-5 w-5" />
            数据导出
          </CardTitle>
          <CardDescription>导出您的数据，支持Offers、Campaigns和用户配置</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium mb-2 block">数据类型</label>
              <Select
                value={exportType}
                onValueChange={(value) => setExportType(value as ExportType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="offers">Offers (推广产品)</SelectItem>
                  <SelectItem value="campaigns">Campaigns (广告活动)</SelectItem>
                  <SelectItem value="settings">Settings (用户配置)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {showFormatSelect && (
              <div>
                <label className="text-sm font-medium mb-2 block">导出格式</label>
                <Select
                  value={exportFormat}
                  onValueChange={(value) => setExportFormat(value as ExportFormat)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="json">JSON (结构化数据)</SelectItem>
                    <SelectItem value="csv">CSV (Excel兼容)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {showSensitiveOption && (
              <div className="space-y-2 sm:col-span-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="includeSensitive"
                    checked={includeSensitive}
                    onChange={(e) => setIncludeSensitive(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="includeSensitive" className="text-sm text-gray-600">
                    包含敏感信息（API密钥等，不勾选则脱敏显示）
                  </label>
                </div>
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-2">
                  Google Ads OAuth 的 refresh_token 不会导出，导入后须重新授权。服务账号请使用下方
                  「Google Ads 服务账号备份」单独导出/导入。
                </p>
              </div>
            )}
          </div>

          <Button onClick={handleExport} disabled={exportLoading} className="w-full">
            {exportLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                导出数据
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 配置导入 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            配置导入
          </CardTitle>
          <CardDescription>导入用户配置数据（JSON格式）</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 说明 */}
          <div className="flex items-center justify-between p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-600" />
              <span className="text-sm text-amber-700">
                请使用从本系统导出的配置文件，格式为JSON
              </span>
            </div>
          </div>

          {/* 文件选择 */}
          <div>
            <label className="text-sm font-medium mb-2 block">选择配置文件</label>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={(e) => {
                setImportFile(e.target.files?.[0] || null)
                clearMessage()
              }}
              className="w-full border border-gray-300 rounded-md p-2 text-sm file:mr-4 file:py-1 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
            {importFile && (
              <p className="text-xs text-gray-500 mt-1">
                已选择: {importFile.name} ({(importFile.size / 1024).toFixed(2)} KB)
              </p>
            )}
          </div>

          <Button
            onClick={handleImportSettings}
            disabled={loading || !importFile}
            className="w-full"
          >
            {loading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                导入配置
              </>
            )}
          </Button>

          {/* 导入结果 */}
          {importResults && (
            <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-sm">导入结果</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                <div className="p-2 bg-white rounded">
                  <div className="text-2xl font-bold text-green-600">{importResults.imported}</div>
                  <div className="text-xs text-gray-500">已导入</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-2xl font-bold text-gray-400">{importResults.skipped}</div>
                  <div className="text-xs text-gray-500">已跳过</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-2xl font-bold text-amber-600">{importResults.warnings}</div>
                  <div className="text-xs text-gray-500">提示</div>
                </div>
                <div className="p-2 bg-white rounded">
                  <div className="text-2xl font-bold text-red-600">{importResults.errors}</div>
                  <div className="text-xs text-gray-500">错误</div>
                </div>
              </div>

              {importResults.warningMessages && importResults.warningMessages.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium mb-2">提示:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {importResults.warningMessages.slice(0, 5).map((line, idx) => (
                      <p key={idx} className="text-xs text-amber-800 bg-amber-50 p-2 rounded">
                        {line}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {importResults.errorMessages && importResults.errorMessages.length > 0 && (
                <div className="mt-3">
                  <p className="text-sm font-medium mb-2">错误:</p>
                  <div className="max-h-32 overflow-y-auto space-y-1">
                    {importResults.errorMessages.slice(0, 5).map((err, idx) => (
                      <p key={idx} className="text-xs text-red-700 bg-red-50 p-2 rounded">
                        {err}
                      </p>
                    ))}
                    {importResults.errorMessages.length > 5 && (
                      <p className="text-xs text-gray-500 text-center py-1">
                        ...还有 {importResults.errorMessages.length - 5} 条错误
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Google Ads 服务账号备份 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Google Ads 服务账号备份
          </CardTitle>
          <CardDescription>
            专用 JSON 格式（type: google_ads_service_account），与 settings 导出分离
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="includeServiceAccountSensitive"
              checked={includeServiceAccountSensitive}
              onChange={(e) => setIncludeServiceAccountSensitive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="includeServiceAccountSensitive" className="text-sm text-gray-600">
              包含敏感信息（Developer Token 与 serviceAccountJson / private_key，恢复所必需）
            </label>
          </div>

          <Button
            onClick={handleExportServiceAccount}
            disabled={serviceAccountExportLoading}
            className="w-full"
            variant="outline"
          >
            {serviceAccountExportLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                导出中...
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                导出服务账号备份
              </>
            )}
          </Button>

          <div>
            <label className="text-sm font-medium mb-2 block">导入服务账号备份</label>
            <input
              ref={serviceAccountFileInputRef}
              type="file"
              accept=".json"
              onChange={(e) => {
                setServiceAccountImportFile(e.target.files?.[0] || null)
                clearMessage()
              }}
              className="w-full border border-gray-300 rounded-md p-2 text-sm file:mr-4 file:py-1 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </div>

          <Button
            onClick={handleImportServiceAccount}
            disabled={serviceAccountLoading || !serviceAccountImportFile}
            className="w-full"
          >
            {serviceAccountLoading ? (
              <>
                <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                导入中...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                导入服务账号备份
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* 消息提示 */}
      {message && (
        <Alert
          variant={message.type === 'error' ? 'destructive' : 'default'}
          className={
            message.type === 'warning'
              ? 'border-amber-400 bg-amber-50 text-amber-900 [&>svg]:text-amber-600'
              : undefined
          }
        >
          {message.type === 'success' ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
