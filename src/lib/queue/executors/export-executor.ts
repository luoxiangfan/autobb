/**
 * Export 任务执行器
 *
 * 负责执行数据导出任务，包括：
 * - 导出Offers数据
 * - 导出Campaigns数据
 * - 导出配置数据
 * - 支持多种格式（JSON、CSV）
 * - 异步处理避免API超时
 *
 * 🔄 替换原有的同步导出API
 * 优势：支持大文件导出、后台异步处理、导出进度追踪
 */

import type { Task, TaskExecutor } from '../types'
import { getDatabase } from '@/lib/db'
import { decrypt } from '@/lib/crypto'

/**
 * Export 任务数据接口
 */
export interface ExportTaskData {
  exportType: 'offers' | 'campaigns' | 'settings'
  format: 'json' | 'csv'
  userId: number
  includeSensitive?: boolean  // 仅用于settings导出
  filters?: Record<string, any>
}

/**
 * Export 任务结果接口
 */
export interface ExportTaskResult {
  success: boolean
  exportType: string
  format: string
  recordCount: number
  fileSize?: number
  errorMessage?: string
  duration: number  // 导出耗时（毫秒）
}

/**
 * 导出数据到CSV格式
 */
function exportToCSV(data: any[], headers: string[]): string {
  const escapeCSV = (value: any) => {
    if (value === null || value === undefined) return ''
    const str = String(value)
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`
    }
    return str
  }

  const csvLines = [
    headers.join(','),
    ...data.map(item => headers.map(h => escapeCSV(item[h])).join(','))
  ]

  return csvLines.join('\n')
}

/**
 * 导出Offers数据
 */
async function exportOffers(userId: number, format: 'json' | 'csv'): Promise<{ data: any, count: number }> {
  const db = await getDatabase()

  const offers = await db.query(`
    SELECT
      id,
      product_name,
      product_url,
      affiliate_link,
      brand,
      target_country,
      target_language,
      offer_type,
      payout,
      cpc_estimate,
      product_price,
      commission_payout,
      description,
      keywords,
      is_active,
      scrape_status,
      created_at,
      updated_at
    FROM offers
    WHERE user_id = ?
    ORDER BY created_at DESC
  `, [userId]) as any[]

  return { data: offers, count: offers.length }
}

/**
 * 导出Campaigns数据
 */
async function exportCampaigns(userId: number, format: 'json' | 'csv'): Promise<{ data: any, count: number }> {
  const db = await getDatabase()

  const campaigns = await db.query(`
    SELECT
      c.id,
      c.google_campaign_id,
      c.campaign_name,
      c.campaign_type,
      c.status,
      c.daily_budget,
      c.start_date,
      c.end_date,
      c.target_locations,
      c.target_languages,
      c.bidding_strategy,
      c.created_at,
      c.updated_at,
      o.product_name as offer_name,
      o.product_url as offer_url,
      ga.customer_id as google_ads_account_id
    FROM campaigns c
    LEFT JOIN offers o ON c.offer_id = o.id
    LEFT JOIN google_ads_accounts ga ON c.google_ads_account_id = ga.id
    WHERE c.user_id = ?
    ORDER BY c.created_at DESC
  `, [userId]) as any[]

  return { data: campaigns, count: campaigns.length }
}

/**
 * 导出Settings数据
 */
async function exportSettings(userId: number, format: 'json' | 'csv', includeSensitive: boolean): Promise<{ data: any, count: number }> {
  const db = await getDatabase()

  const settings = await db.query(`
    SELECT
      category,
      config_key,
      config_value,
      encrypted_value,
      data_type,
      is_sensitive,
      is_required,
      description
    FROM system_settings
    WHERE user_id IS NULL OR user_id = ?
    ORDER BY category, config_key
  `, [userId]) as any[]

  // 去重：对于同一个 (category, config_key) 组合，优先使用用户配置
  const settingsMap = new Map<string, any>()
  for (const setting of settings) {
    const key = `${setting.category}:${setting.config_key}`
    settingsMap.set(key, setting)
  }

  // 转换为导出格式
  const exportData: Record<string, Record<string, any>> = {}

  for (const setting of settingsMap.values()) {
    if (!exportData[setting.category]) {
      exportData[setting.category] = {}
    }

    let value = setting.config_value

    // 处理敏感信息
    if (setting.is_sensitive === 1) {
      if (includeSensitive && setting.encrypted_value) {
        // 解密敏感值（仅在明确请求时）
        try {
          value = decrypt(setting.encrypted_value)
        } catch {
          value = null
        }
      } else {
        // 脱敏处理：显示部分字符
        if (setting.encrypted_value) {
          try {
            const decrypted = decrypt(setting.encrypted_value)
            if (decrypted && decrypted.length > 8) {
              value = decrypted.substring(0, 4) + '****' + decrypted.substring(decrypted.length - 4)
            } else {
              value = '****'
            }
          } catch {
            value = '****'
          }
        } else {
          value = null
        }
      }
    }

    exportData[setting.category][setting.config_key] = {
      value,
      dataType: setting.data_type,
      isSensitive: setting.is_sensitive === 1,
      description: setting.description,
    }
  }

  const exportPayload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    userId,
    includeSensitive,
    settings: exportData,
  }

  return { data: exportPayload, count: Object.keys(exportData).length }
}

/**
 * 创建 Export 任务执行器
 */
export function createExportExecutor(): TaskExecutor<ExportTaskData, ExportTaskResult> {
  return async (task: Task<ExportTaskData>) => {
    const { exportType, format, userId, includeSensitive = false } = task.data

    console.log(`📊 [ExportExecutor] 开始导出任务: 类型=${exportType}, 格式=${format}, 用户=${userId}`)

    const startTime = Date.now()

    try {
      let result: { data: any, count: number }
      let headers: string[] = []

      // 根据导出类型执行不同的查询
      switch (exportType) {
        case 'offers':
          result = await exportOffers(userId, format)
          headers = [
            'id', 'product_name', 'product_url', 'affiliate_link',
            'brand', 'target_country', 'target_language', 'offer_type',
            'payout', 'cpc_estimate', 'product_price', 'commission_payout',
            'description', 'keywords', 'is_active', 'scrape_status',
            'created_at', 'updated_at'
          ]
          break

        case 'campaigns':
          result = await exportCampaigns(userId, format)
          headers = [
            'id', 'google_campaign_id', 'campaign_name', 'campaign_type',
            'status', 'daily_budget', 'start_date', 'end_date',
            'target_locations', 'target_languages', 'bidding_strategy',
            'offer_name', 'offer_url', 'google_ads_account_id',
            'created_at', 'updated_at'
          ]
          break

        case 'settings':
          result = await exportSettings(userId, format, includeSensitive)
          // Settings使用JSON格式导出
          break

        default:
          throw new Error(`不支持的导出类型: ${exportType}`)
      }

      let exportContent: string
      let mimeType: string
      let filename: string

      if (format === 'csv' && exportType !== 'settings') {
        exportContent = exportToCSV(Array.isArray(result.data) ? result.data : [], headers)
        mimeType = 'text/csv; charset=utf-8'
        filename = `${exportType}_${new Date().toISOString().split('T')[0]}.csv`
      } else {
        exportContent = JSON.stringify(result.data, null, 2)
        mimeType = 'application/json; charset=utf-8'
        filename = `${exportType}_${new Date().toISOString().split('T')[0]}.json`
      }

      const fileSize = Buffer.byteLength(exportContent, 'utf8')
      const duration = Date.now() - startTime

      console.log(`✅ [ExportExecutor] 导出任务完成: ${filename}, 记录数=${result.count}, 文件大小=${(fileSize / 1024 / 1024).toFixed(2)}MB, 耗时=${duration}ms`)

      return {
        success: true,
        exportType,
        format,
        recordCount: result.count,
        fileSize,
        duration
      }
    } catch (error: any) {
      const duration = Date.now() - startTime
      console.error(`❌ [ExportExecutor] 导出任务失败: ${error.message}, 耗时=${duration}ms`)

      return {
        success: false,
        exportType,
        format,
        recordCount: 0,
        errorMessage: error.message,
        duration
      }
    }
  }
}
