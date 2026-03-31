/**
 * Progress tracking types for offer extraction process
 */

export type ProgressStage =
  | 'proxy_warmup'       // 推广链接预热
  | 'resolving_link'     // 解析推广链接
  | 'fetching_proxy'     // 获取代理IP
  | 'accessing_page'     // 访问目标页面
  | 'extracting_brand'   // 提取品牌信息
  | 'scraping_products'  // 抓取产品数据
  | 'processing_data'    // 处理数据
  | 'ai_analysis'        // AI智能分析
  | 'completed'          // 完成
  | 'error';             // 错误

export type ProgressStatus = 'pending' | 'in_progress' | 'completed' | 'error';

export interface ProgressEvent {
  stage: ProgressStage;
  status: ProgressStatus;
  message: string;
  timestamp: number;
  duration?: number; // 执行耗时（毫秒）
  details?: {
    currentUrl?: string;
    redirectCount?: number;
    proxyUsed?: string;
    brandName?: string;
    productCount?: number;
    errorMessage?: string;
    retryCount?: number;
    elapsedTime?: number; // 已用时间（毫秒）
    // 代理国家不匹配警告信息
    proxyCountryMismatch?: boolean; // 是否存在国家不匹配
    targetCountry?: string; // 目标国家
    usedProxyCountry?: string; // 实际使用的代理国家
  };
}

export interface ProgressUpdate {
  type: 'progress';
  data: ProgressEvent;
}

export interface ErrorUpdate {
  type: 'error';
  data: {
    message: string;
    stage: ProgressStage;
    details?: Record<string, unknown>;
  };
}

export interface CompleteUpdate {
  type: 'complete';
  data: {
    success: boolean;
    finalUrl: string;
    brand: string;
    productCount?: number;
  };
}

export type SSEMessage = ProgressUpdate | ErrorUpdate | CompleteUpdate;

/**
 * Stage configuration with display metadata
 */
export const STAGE_CONFIG: Record<ProgressStage, { label: string; icon: string; estimatedTime: number }> = {
  proxy_warmup: {
    label: '推广链接预热',
    icon: '🔥',
    estimatedTime: 5000, // 5 seconds
  },
  resolving_link: {
    label: '解析推广链接',
    icon: '🔗',
    estimatedTime: 3000, // 3 seconds
  },
  fetching_proxy: {
    label: '获取代理IP',
    icon: '🌐',
    estimatedTime: 2000, // 2 seconds
  },
  accessing_page: {
    label: '访问目标页面',
    icon: '🚀',
    estimatedTime: 10000, // 10 seconds
  },
  extracting_brand: {
    label: '提取品牌信息',
    icon: '🏷️',
    estimatedTime: 5000, // 5 seconds
  },
  scraping_products: {
    label: '抓取产品数据',
    icon: '📦',
    estimatedTime: 20000, // 20 seconds
  },
  processing_data: {
    label: '处理数据',
    icon: '⚙️',
    estimatedTime: 3000, // 3 seconds
  },
  ai_analysis: {
    label: 'AI智能分析',
    icon: '🤖',
    estimatedTime: 60000, // 60 seconds (AI分析通常较慢)
  },
  completed: {
    label: '完成',
    icon: '✅',
    estimatedTime: 0,
  },
  error: {
    label: '错误',
    icon: '❌',
    estimatedTime: 0,
  },
};

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
  ];

  const currentIndex = stageOrder.indexOf(stage);
  if (currentIndex === -1) return 0;

  const baseProgress = (currentIndex / (stageOrder.length - 1)) * 100;

  if (status === 'completed' && stage !== 'completed') {
    // Add partial progress for completed stage
    return Math.min(baseProgress + (100 / stageOrder.length), 100);
  }

  if (status === 'in_progress') {
    // Add half progress for in-progress stage
    return Math.min(baseProgress + (100 / stageOrder.length / 2), 100);
  }

  return baseProgress;
}
