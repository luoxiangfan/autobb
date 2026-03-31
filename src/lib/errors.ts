/**
 * 统一错误码系统
 *
 * 功能：
 * - 标准化的错误码和错误消息
 * - 分类管理（认证、授权、业务逻辑、外部API等）
 * - 国际化支持（中英文错误消息）
 * - 结构化错误对象
 */

/**
 * 错误码分类前缀
 * - AUTH_xxx: 认证相关 (1xxx)
 * - PERM_xxx: 权限相关 (2xxx)
 * - OFFER_xxx: Offer业务逻辑 (3xxx)
 * - GADS_xxx: Google Ads API (4xxx)
 * - CREA_xxx: 广告创意 (5xxx)
 * - CAMP_xxx: 广告系列 (6xxx)
 * - SYNC_xxx: 数据同步 (7xxx)
 * - SYS_xxx: 系统错误 (8xxx)
 * - VAL_xxx: 数据验证 (9xxx)
 */

export enum ErrorCode {
  // ===== 认证错误 (1xxx) =====
  AUTH_UNAUTHORIZED = 'AUTH_1001',
  AUTH_TOKEN_EXPIRED = 'AUTH_1002',
  AUTH_TOKEN_INVALID = 'AUTH_1003',
  AUTH_SESSION_EXPIRED = 'AUTH_1004',
  AUTH_CREDENTIALS_INVALID = 'AUTH_1005',

  // ===== 权限错误 (2xxx) =====
  PERM_ACCESS_DENIED = 'PERM_2001',
  PERM_RESOURCE_NOT_OWNED = 'PERM_2002',
  PERM_INSUFFICIENT_PRIVILEGES = 'PERM_2003',
  PERM_ACCOUNT_SUSPENDED = 'PERM_2004',

  // ===== Offer业务逻辑错误 (3xxx) =====
  OFFER_NOT_FOUND = 'OFFER_3001',
  OFFER_INVALID_ID = 'OFFER_3002',
  OFFER_SCRAPE_FAILED = 'OFFER_3003',
  OFFER_SCRAPE_INCOMPLETE = 'OFFER_3004',
  OFFER_URL_INVALID = 'OFFER_3005',
  OFFER_DUPLICATE = 'OFFER_3006',

  // ===== Google Ads API错误 (4xxx) =====
  GADS_API_ERROR = 'GADS_4001',
  GADS_RATE_LIMITED = 'GADS_4002',
  GADS_ACCOUNT_NOT_FOUND = 'GADS_4003',
  GADS_ACCOUNT_SUSPENDED = 'GADS_4004',
  GADS_CREDENTIALS_EXPIRED = 'GADS_4005',
  GADS_CREDENTIALS_INVALID = 'GADS_4006',
  GADS_QUOTA_EXCEEDED = 'GADS_4007',
  GADS_CAMPAIGN_NOT_FOUND = 'GADS_4008',
  GADS_CAMPAIGN_CREATE_FAILED = 'GADS_4009',
  GADS_BUDGET_EXCEEDED = 'GADS_4010',

  // ===== 广告创意错误 (5xxx) =====
  CREA_NOT_FOUND = 'CREA_5001',
  CREA_GENERATION_FAILED = 'CREA_5002',
  CREA_AI_UNAVAILABLE = 'CREA_5003',
  CREA_INVALID_THEME = 'CREA_5004',
  CREA_SCORE_TOO_LOW = 'CREA_5005',
  CREA_MAX_ATTEMPTS_REACHED = 'CREA_5006',

  // ===== 广告系列错误 (6xxx) =====
  CAMP_NOT_FOUND = 'CAMP_6001',
  CAMP_CREATE_FAILED = 'CAMP_6002',
  CAMP_UPDATE_FAILED = 'CAMP_6003',
  CAMP_PAUSE_FAILED = 'CAMP_6004',
  CAMP_DELETE_FAILED = 'CAMP_6005',
  CAMP_INVALID_STATUS = 'CAMP_6006',
  CAMP_BUDGET_INVALID = 'CAMP_6007',
  TEST_NOT_FOUND = 'CAMP_6008',
  TEST_CREATE_FAILED = 'CAMP_6009',
  TEST_INVALID_STATUS = 'CAMP_6010',
  CAMP_ADS_ACCOUNT_ALREADY_LINKED = 'CAMP_6011',

  // ===== 数据同步错误 (7xxx) =====
  SYNC_FAILED = 'SYNC_7001',
  SYNC_TIMEOUT = 'SYNC_7002',
  SYNC_PARTIAL_FAILURE = 'SYNC_7003',
  SYNC_NO_ACCOUNTS = 'SYNC_7004',
  SYNC_ALREADY_RUNNING = 'SYNC_7005',

  // ===== 系统错误 (8xxx) =====
  SYS_INTERNAL_ERROR = 'SYS_8001',
  SYS_DATABASE_ERROR = 'SYS_8002',
  SYS_NETWORK_ERROR = 'SYS_8003',
  SYS_SERVICE_UNAVAILABLE = 'SYS_8004',
  SYS_TIMEOUT = 'SYS_8005',
  SYS_CONFIG_MISSING = 'SYS_8006',

  // ===== 数据验证错误 (9xxx) =====
  VAL_REQUIRED_FIELD = 'VAL_9001',
  VAL_INVALID_FORMAT = 'VAL_9002',
  VAL_OUT_OF_RANGE = 'VAL_9003',
  VAL_TOO_SHORT = 'VAL_9004',
  VAL_TOO_LONG = 'VAL_9005',
  VAL_INVALID_TYPE = 'VAL_9006',
}

/**
 * 错误消息映射（中英文）
 */
export const ErrorMessages: Record<ErrorCode, { zh: string; en: string; httpStatus: number }> = {
  // 认证错误
  [ErrorCode.AUTH_UNAUTHORIZED]: {
    zh: '未授权，请先登录',
    en: 'Unauthorized, please login first',
    httpStatus: 401
  },
  [ErrorCode.AUTH_TOKEN_EXPIRED]: {
    zh: '登录已过期，请重新登录',
    en: 'Token expired, please login again',
    httpStatus: 401
  },
  [ErrorCode.AUTH_TOKEN_INVALID]: {
    zh: '登录令牌无效',
    en: 'Invalid token',
    httpStatus: 401
  },
  [ErrorCode.AUTH_SESSION_EXPIRED]: {
    zh: '会话已过期',
    en: 'Session expired',
    httpStatus: 401
  },
  [ErrorCode.AUTH_CREDENTIALS_INVALID]: {
    zh: '用户名或密码错误',
    en: 'Invalid credentials',
    httpStatus: 401
  },

  // 权限错误
  [ErrorCode.PERM_ACCESS_DENIED]: {
    zh: '访问被拒绝',
    en: 'Access denied',
    httpStatus: 403
  },
  [ErrorCode.PERM_RESOURCE_NOT_OWNED]: {
    zh: '无权访问该资源',
    en: 'Resource not owned',
    httpStatus: 403
  },
  [ErrorCode.PERM_INSUFFICIENT_PRIVILEGES]: {
    zh: '权限不足',
    en: 'Insufficient privileges',
    httpStatus: 403
  },
  [ErrorCode.PERM_ACCOUNT_SUSPENDED]: {
    zh: '账号已被暂停',
    en: 'Account suspended',
    httpStatus: 403
  },

  // Offer错误
  [ErrorCode.OFFER_NOT_FOUND]: {
    zh: 'Offer不存在',
    en: 'Offer not found',
    httpStatus: 404
  },
  [ErrorCode.OFFER_INVALID_ID]: {
    zh: '无效的Offer ID',
    en: 'Invalid Offer ID',
    httpStatus: 400
  },
  [ErrorCode.OFFER_SCRAPE_FAILED]: {
    zh: '数据抓取失败',
    en: 'Data scraping failed',
    httpStatus: 500
  },
  [ErrorCode.OFFER_SCRAPE_INCOMPLETE]: {
    zh: '数据抓取未完成，请稍后再试',
    en: 'Data scraping incomplete, please try later',
    httpStatus: 400
  },
  [ErrorCode.OFFER_URL_INVALID]: {
    zh: '无效的URL',
    en: 'Invalid URL',
    httpStatus: 400
  },
  [ErrorCode.OFFER_DUPLICATE]: {
    zh: 'Offer已存在',
    en: 'Offer already exists',
    httpStatus: 409
  },

  // Google Ads错误
  [ErrorCode.GADS_API_ERROR]: {
    zh: 'Google Ads API错误',
    en: 'Google Ads API error',
    httpStatus: 500
  },
  [ErrorCode.GADS_RATE_LIMITED]: {
    zh: 'API请求频率超限，请稍后再试',
    en: 'Rate limit exceeded, please try later',
    httpStatus: 429
  },
  [ErrorCode.GADS_ACCOUNT_NOT_FOUND]: {
    zh: 'Google Ads账号不存在',
    en: 'Google Ads account not found',
    httpStatus: 404
  },
  [ErrorCode.GADS_ACCOUNT_SUSPENDED]: {
    zh: 'Google Ads账号已被暂停',
    en: 'Google Ads account suspended',
    httpStatus: 403
  },
  [ErrorCode.GADS_CREDENTIALS_EXPIRED]: {
    zh: 'Google Ads授权已过期，请重新连接',
    en: 'Google Ads credentials expired, please reconnect',
    httpStatus: 401
  },
  [ErrorCode.GADS_CREDENTIALS_INVALID]: {
    zh: 'Google Ads凭证无效',
    en: 'Invalid Google Ads credentials',
    httpStatus: 401
  },
  [ErrorCode.GADS_QUOTA_EXCEEDED]: {
    zh: 'Google Ads API配额已用尽',
    en: 'Google Ads API quota exceeded',
    httpStatus: 429
  },
  [ErrorCode.GADS_CAMPAIGN_NOT_FOUND]: {
    zh: '广告系列不存在',
    en: 'Campaign not found',
    httpStatus: 404
  },
  [ErrorCode.GADS_CAMPAIGN_CREATE_FAILED]: {
    zh: '创建广告系列失败',
    en: 'Failed to create campaign',
    httpStatus: 500
  },
  [ErrorCode.GADS_BUDGET_EXCEEDED]: {
    zh: '预算超出限制',
    en: 'Budget exceeded',
    httpStatus: 400
  },

  // 广告创意错误
  [ErrorCode.CREA_NOT_FOUND]: {
    zh: '广告创意不存在',
    en: 'Ad creative not found',
    httpStatus: 404
  },
  [ErrorCode.CREA_GENERATION_FAILED]: {
    zh: '广告创意生成失败',
    en: 'Ad creative generation failed',
    httpStatus: 500
  },
  [ErrorCode.CREA_AI_UNAVAILABLE]: {
    zh: 'AI服务暂时不可用',
    en: 'AI service unavailable',
    httpStatus: 503
  },
  [ErrorCode.CREA_INVALID_THEME]: {
    zh: '无效的广告主题',
    en: 'Invalid ad theme',
    httpStatus: 400
  },
  [ErrorCode.CREA_SCORE_TOO_LOW]: {
    zh: '广告创意评分过低，请重新生成',
    en: 'Creative score too low, please regenerate',
    httpStatus: 400
  },
  [ErrorCode.CREA_MAX_ATTEMPTS_REACHED]: {
    zh: '已达到最大生成次数（5次）',
    en: 'Maximum generation attempts reached (5)',
    httpStatus: 400
  },

  // 广告系列错误
  [ErrorCode.CAMP_NOT_FOUND]: {
    zh: '广告系列不存在',
    en: 'Campaign not found',
    httpStatus: 404
  },
  [ErrorCode.CAMP_CREATE_FAILED]: {
    zh: '创建广告系列失败',
    en: 'Failed to create campaign',
    httpStatus: 500
  },
  [ErrorCode.CAMP_UPDATE_FAILED]: {
    zh: '更新广告系列失败',
    en: 'Failed to update campaign',
    httpStatus: 500
  },
  [ErrorCode.CAMP_PAUSE_FAILED]: {
    zh: '暂停广告系列失败',
    en: 'Failed to pause campaign',
    httpStatus: 500
  },
  [ErrorCode.CAMP_DELETE_FAILED]: {
    zh: '删除广告系列失败',
    en: 'Failed to delete campaign',
    httpStatus: 500
  },
  [ErrorCode.CAMP_INVALID_STATUS]: {
    zh: '无效的广告系列状态',
    en: 'Invalid campaign status',
    httpStatus: 400
  },
  [ErrorCode.CAMP_BUDGET_INVALID]: {
    zh: '预算金额无效',
    en: 'Invalid budget amount',
    httpStatus: 400
  },
  [ErrorCode.TEST_NOT_FOUND]: {
    zh: 'A/B测试不存在',
    en: 'AB test not found',
    httpStatus: 404
  },
  [ErrorCode.TEST_CREATE_FAILED]: {
    zh: '创建A/B测试失败',
    en: 'Failed to create AB test',
    httpStatus: 500
  },
  [ErrorCode.TEST_INVALID_STATUS]: {
    zh: '无效的测试状态',
    en: 'Invalid test status',
    httpStatus: 400
  },
  [ErrorCode.CAMP_ADS_ACCOUNT_ALREADY_LINKED]: {
    zh: 'Google Ads账号已被其他Offer占用',
    en: 'Google Ads account is already linked to another offer',
    httpStatus: 409
  },

  // 数据同步错误
  [ErrorCode.SYNC_FAILED]: {
    zh: '数据同步失败',
    en: 'Data synchronization failed',
    httpStatus: 500
  },
  [ErrorCode.SYNC_TIMEOUT]: {
    zh: '数据同步超时',
    en: 'Synchronization timeout',
    httpStatus: 504
  },
  [ErrorCode.SYNC_PARTIAL_FAILURE]: {
    zh: '部分数据同步失败',
    en: 'Partial synchronization failure',
    httpStatus: 207
  },
  [ErrorCode.SYNC_NO_ACCOUNTS]: {
    zh: '没有可同步的账号',
    en: 'No accounts to synchronize',
    httpStatus: 400
  },
  [ErrorCode.SYNC_ALREADY_RUNNING]: {
    zh: '同步任务正在进行中',
    en: 'Synchronization already running',
    httpStatus: 409
  },

  // 系统错误
  [ErrorCode.SYS_INTERNAL_ERROR]: {
    zh: '系统内部错误',
    en: 'Internal server error',
    httpStatus: 500
  },
  [ErrorCode.SYS_DATABASE_ERROR]: {
    zh: '数据库错误',
    en: 'Database error',
    httpStatus: 500
  },
  [ErrorCode.SYS_NETWORK_ERROR]: {
    zh: '网络错误',
    en: 'Network error',
    httpStatus: 500
  },
  [ErrorCode.SYS_SERVICE_UNAVAILABLE]: {
    zh: '服务暂时不可用',
    en: 'Service unavailable',
    httpStatus: 503
  },
  [ErrorCode.SYS_TIMEOUT]: {
    zh: '请求超时',
    en: 'Request timeout',
    httpStatus: 504
  },
  [ErrorCode.SYS_CONFIG_MISSING]: {
    zh: '系统配置缺失',
    en: 'Missing system configuration',
    httpStatus: 500
  },

  // 数据验证错误
  [ErrorCode.VAL_REQUIRED_FIELD]: {
    zh: '必填字段缺失',
    en: 'Required field missing',
    httpStatus: 400
  },
  [ErrorCode.VAL_INVALID_FORMAT]: {
    zh: '数据格式无效',
    en: 'Invalid data format',
    httpStatus: 400
  },
  [ErrorCode.VAL_OUT_OF_RANGE]: {
    zh: '数值超出范围',
    en: 'Value out of range',
    httpStatus: 400
  },
  [ErrorCode.VAL_TOO_SHORT]: {
    zh: '内容过短',
    en: 'Content too short',
    httpStatus: 400
  },
  [ErrorCode.VAL_TOO_LONG]: {
    zh: '内容过长',
    en: 'Content too long',
    httpStatus: 400
  },
  [ErrorCode.VAL_INVALID_TYPE]: {
    zh: '数据类型无效',
    en: 'Invalid data type',
    httpStatus: 400
  },
}

/**
 * 应用错误类
 */
export class AppError extends Error {
  public readonly code: ErrorCode
  public readonly httpStatus: number
  public readonly details?: any
  public readonly timestamp: Date

  constructor(
    code: ErrorCode,
    details?: any,
    message?: string
  ) {
    const errorInfo = ErrorMessages[code]
    super(message || errorInfo.zh)

    this.name = 'AppError'
    this.code = code
    this.httpStatus = errorInfo.httpStatus
    this.details = details
    this.timestamp = new Date()

    // 保持正确的原型链
    Object.setPrototypeOf(this, AppError.prototype)
  }

  /**
   * 获取错误的中文消息
   */
  getChineseMessage(): string {
    return ErrorMessages[this.code].zh
  }

  /**
   * 获取错误的英文消息
   */
  getEnglishMessage(): string {
    return ErrorMessages[this.code].en
  }

  /**
   * 转换为API响应格式
   */
  toJSON(lang: 'zh' | 'en' = 'zh') {
    return {
      error: {
        code: this.code,
        message: lang === 'zh' ? this.getChineseMessage() : this.getEnglishMessage(),
        details: this.details,
        timestamp: this.timestamp.toISOString()
      }
    }
  }

  /**
   * 判断是否为可重试错误
   */
  isRetryable(): boolean {
    const retryableCodes = [
      ErrorCode.GADS_RATE_LIMITED,
      ErrorCode.GADS_API_ERROR,
      ErrorCode.SYS_NETWORK_ERROR,
      ErrorCode.SYS_TIMEOUT,
      ErrorCode.SYNC_TIMEOUT
    ]

    return retryableCodes.includes(this.code)
  }

  /**
   * 判断是否为客户端错误（4xx）
   */
  isClientError(): boolean {
    return this.httpStatus >= 400 && this.httpStatus < 500
  }

  /**
   * 判断是否为服务器错误（5xx）
   */
  isServerError(): boolean {
    return this.httpStatus >= 500 && this.httpStatus < 600
  }
}

/**
 * 错误工厂函数
 */
export const createError = {
  // 认证错误
  unauthorized: (details?: any) => new AppError(ErrorCode.AUTH_UNAUTHORIZED, details),
  tokenExpired: (details?: any) => new AppError(ErrorCode.AUTH_TOKEN_EXPIRED, details),
  invalidCredentials: (details?: any) => new AppError(ErrorCode.AUTH_CREDENTIALS_INVALID, details),

  // 权限错误
  accessDenied: (details?: any) => new AppError(ErrorCode.PERM_ACCESS_DENIED, details),
  resourceNotOwned: (details?: any) => new AppError(ErrorCode.PERM_RESOURCE_NOT_OWNED, details),

  // Offer错误
  offerNotFound: (details?: any) => new AppError(ErrorCode.OFFER_NOT_FOUND, details),
  offerInvalidId: (details?: any) => new AppError(ErrorCode.OFFER_INVALID_ID, details),
  scrapeFailed: (details?: any) => new AppError(ErrorCode.OFFER_SCRAPE_FAILED, details),
  offerNotReady: (details?: any) => new AppError(ErrorCode.OFFER_SCRAPE_INCOMPLETE, details),
  urlResolveFailed: (details?: any) => new AppError(ErrorCode.OFFER_SCRAPE_FAILED, details),

  // Google Ads错误
  gadsApiError: (details?: any) => new AppError(ErrorCode.GADS_API_ERROR, details),
  gadsRateLimited: (details?: any) => new AppError(ErrorCode.GADS_RATE_LIMITED, details),
  gadsAccountNotFound: (details?: any) => new AppError(ErrorCode.GADS_ACCOUNT_NOT_FOUND, details),
  gadsAccountNotActive: (details?: any) => new AppError(ErrorCode.GADS_ACCOUNT_NOT_FOUND, details),
  gadsCredentialsExpired: (details?: any) => new AppError(ErrorCode.GADS_CREDENTIALS_EXPIRED, details),

  // 广告创意错误
  creativeNotFound: (details?: any) => new AppError(ErrorCode.CREA_NOT_FOUND, details),
  creationFailed: (details?: any) => new AppError(ErrorCode.CREA_GENERATION_FAILED, details),
  aiUnavailable: (details?: any) => new AppError(ErrorCode.CREA_AI_UNAVAILABLE, details),
  aiConfigNotSet: (details?: any) => new AppError(ErrorCode.CREA_AI_UNAVAILABLE, details),
  creativeQuotaExceeded: (details?: any) => new AppError(ErrorCode.CREA_MAX_ATTEMPTS_REACHED, details),
  creativeGenerationFailed: (details?: any) => new AppError(ErrorCode.CREA_GENERATION_FAILED, details),

  // 广告系列错误
  campaignNotFound: (details?: any) => new AppError(ErrorCode.CAMP_NOT_FOUND, details),
  campaignCreateFailed: (details?: any) => new AppError(ErrorCode.CAMP_CREATE_FAILED, details),
  campaignUpdateFailed: (details?: any) => new AppError(ErrorCode.CAMP_UPDATE_FAILED, details),
  campaignPauseFailed: (details?: any) => new AppError(ErrorCode.CAMP_PAUSE_FAILED, details),
  campaignDeleteFailed: (details?: any) => new AppError(ErrorCode.CAMP_DELETE_FAILED, details),
  invalidCampaignStatus: (details?: any) => new AppError(ErrorCode.CAMP_INVALID_STATUS, details),
  adsAccountAlreadyLinked: (details?: any) => new AppError(ErrorCode.CAMP_ADS_ACCOUNT_ALREADY_LINKED, details),
  testNotFound: (details?: any) => new AppError(ErrorCode.TEST_NOT_FOUND, details),
  testCreateFailed: (details?: any) => new AppError(ErrorCode.TEST_CREATE_FAILED, details),
  invalidTestStatus: (details?: any) => new AppError(ErrorCode.TEST_INVALID_STATUS, details),

  // 数据同步错误
  syncFailed: (details?: any) => new AppError(ErrorCode.SYNC_FAILED, details),
  syncTimeout: (details?: any) => new AppError(ErrorCode.SYNC_TIMEOUT, details),

  // 系统错误
  internalError: (details?: any) => new AppError(ErrorCode.SYS_INTERNAL_ERROR, details),
  databaseError: (details?: any) => new AppError(ErrorCode.SYS_DATABASE_ERROR, details),
  networkError: (details?: any) => new AppError(ErrorCode.SYS_NETWORK_ERROR, details),
  proxyNotConfigured: (details?: any) => new AppError(ErrorCode.SYS_CONFIG_MISSING, details),

  // 数据验证错误
  requiredField: (fieldName: string) =>
    new AppError(ErrorCode.VAL_REQUIRED_FIELD, { field: fieldName }),
  invalidFormat: (fieldName: string, expected?: string) =>
    new AppError(ErrorCode.VAL_INVALID_FORMAT, { field: fieldName, expected }),
  invalidParameter: (details?: any) =>
    new AppError(ErrorCode.VAL_INVALID_FORMAT, details),
  outOfRange: (fieldName: string, min?: number, max?: number) =>
    new AppError(ErrorCode.VAL_OUT_OF_RANGE, { field: fieldName, min, max }),
}
