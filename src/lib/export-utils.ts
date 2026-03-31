'use client'

/**
 * 数据导出工具函数
 * P2-2优化新增
 */

import { showWarning } from './toast-utils'

/**
 * 将数据导出为CSV格式
 * @param data 要导出的数据数组
 * @param filename 文件名（不含扩展名）
 * @param headers 自定义列头（可选）
 */
export function exportToCSV<T extends Record<string, any>>(
  data: T[],
  filename: string,
  headers?: Record<keyof T, string>
): void {
  if (data.length === 0) {
    showWarning('无法导出', '没有可导出的数据')
    return
  }

  // 获取列键
  const keys = Object.keys(data[0]) as (keyof T)[]

  // 生成CSV头部
  const headerRow = headers
    ? keys.map((key) => headers[key] || String(key)).join(',')
    : keys.join(',')

  // 生成CSV数据行
  const rows = data.map((row) =>
    keys
      .map((key) => {
        const value = row[key]
        // 处理包含逗号、换行符或引号的值
        if (value === null || value === undefined) {
          return ''
        }
        const stringValue = String(value)
        if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
          return `"${stringValue.replace(/"/g, '""')}"`
        }
        return stringValue
      })
      .join(',')
  )

  // 组合CSV内容
  const csv = [headerRow, ...rows].join('\n')

  // 创建Blob并下载
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * 将数据导出为JSON格式
 * @param data 要导出的数据
 * @param filename 文件名（不含扩展名）
 */
export function exportToJSON<T>(data: T, filename: string): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  link.setAttribute('href', url)
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.json`)
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

/**
 * Campaign数据导出类型定义
 */
export interface CampaignExportData {
  campaignId: number
  campaignName: string
  status: string
  offerBrand: string
  impressions: number
  clicks: number
  cost: number
  conversions: number
  ctr: number
  cpc: number
  conversionRate: number
}

/**
 * Offer数据导出类型定义
 */
export interface OfferExportData {
  id: number
  offerName: string
  brand: string
  targetCountry: string
  targetLanguage: string
  url: string
  affiliateLink: string | null
  scrapeStatus: string
  isActive: boolean
  createdAt: string
}

/**
 * 导出Campaign数据为CSV
 */
export function exportCampaigns(campaigns: CampaignExportData[]): void {
  const headers: Record<keyof CampaignExportData, string> = {
    campaignId: 'Campaign ID',
    campaignName: 'Campaign名称',
    status: '状态',
    offerBrand: '品牌',
    impressions: '展示量',
    clicks: '点击量',
    cost: '花费(¥)',
    conversions: '转化量',
    ctr: 'CTR(%)',
    cpc: 'CPC(¥)',
    conversionRate: '转化率(%)',
  }

  exportToCSV(campaigns, 'campaigns', headers)
}

/**
 * 导出Offer数据为CSV
 */
export function exportOffers(offers: OfferExportData[]): void {
  const headers: Record<keyof OfferExportData, string> = {
    id: 'ID',
    offerName: 'Offer标识',
    brand: '品牌名称',
    targetCountry: '推广国家',
    targetLanguage: '推广语言',
    url: '推广链接',
    affiliateLink: 'Affiliate链接',
    scrapeStatus: '抓取状态',
    isActive: '是否激活',
    createdAt: '创建时间',
  }

  exportToCSV(offers, 'offers', headers)
}
