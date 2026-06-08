/**
 * Progress tracking types for offer extraction process
 */

export type ProgressStage =
  | 'proxy_warmup' // 推广链接预热
  | 'resolving_link' // 解析推广链接
  | 'fetching_proxy' // 获取代理IP
  | 'accessing_page' // 访问目标页面
  | 'extracting_brand' // 提取品牌信息
  | 'scraping_products' // 抓取产品数据
  | 'processing_data' // 处理数据
  | 'ai_analysis' // AI智能分析
  | 'completed' // 完成
  | 'error' // 错误

export type ProgressStatus = 'pending' | 'in_progress' | 'completed' | 'error'

export interface ProgressEvent {
  stage: ProgressStage
  status: ProgressStatus
  message: string
  timestamp: number
  duration?: number // 执行耗时（毫秒）
  details?: {
    currentUrl?: string
    redirectCount?: number
    proxyUsed?: string
    brandName?: string
    productCount?: number
    errorMessage?: string
    retryCount?: number
    elapsedTime?: number // 已用时间（毫秒）
    // 代理国家不匹配警告信息
    proxyCountryMismatch?: boolean // 是否存在国家不匹配
    targetCountry?: string // 目标国家
    usedProxyCountry?: string // 实际使用的代理国家
  }
}

/**
 * Calculate overall progress percentage based on current stage
 */
export function calculateProgress(stage: ProgressStage, status: ProgressStatus): number {
  const stageOrder: ProgressStage[] = [
    'proxy_warmup',
    'fetching_proxy',
    'resolving_link',
    'accessing_page',
    'extracting_brand',
    'scraping_products',
    'processing_data',
    'ai_analysis',
    'completed',
  ]

  const currentIndex = stageOrder.indexOf(stage)
  if (currentIndex === -1) return 0

  const baseProgress = (currentIndex / (stageOrder.length - 1)) * 100

  if (status === 'completed' && stage !== 'completed') {
    // Add partial progress for completed stage
    return Math.min(baseProgress + 100 / stageOrder.length, 100)
  }

  if (status === 'in_progress') {
    // Add half progress for in-progress stage
    return Math.min(baseProgress + 100 / stageOrder.length / 2, 100)
  }

  return baseProgress
}
