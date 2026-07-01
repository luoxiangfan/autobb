'use client'

/**
 * 数据导出工具函数
 */

import { showWarning } from './toast-utils'

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

function downloadCsv(filename: string, csv: string): void {
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

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return ''
  }
  const stringValue = String(value)
  if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

/**
 * 导出Offer数据为CSV
 */
export function exportOffers(offers: OfferExportData[]): void {
  if (offers.length === 0) {
    showWarning('无法导出', '没有可导出的数据')
    return
  }

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

  const keys = Object.keys(offers[0]) as (keyof OfferExportData)[]
  const headerRow = keys.map((key) => headers[key] || String(key)).join(',')
  const rows = offers.map((row) => keys.map((key) => escapeCsvCell(row[key])).join(','))
  const csv = [headerRow, ...rows].join('\n')

  downloadCsv('offers', csv)
}
