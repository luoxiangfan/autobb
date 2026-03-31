/**
 * 功能开关和灰度发布控制
 *
 * 用于安全地部署新功能优化。
 *
 * 注意：
 * - 历史AI能力开关仍保留“按用户分桶”能力
 * - 新增的性能改造开关默认用于“紧急回滚”，非灰度分流
 */

/**
 * 竞品压缩优化灰度发布
 *
 * 策略：基于用户ID哈希值进行确定性分流
 * - 同一用户始终分配到同一组（一致性）
 * - 灰度比例可动态调整
 * - 零破坏性：压缩已通过A/B测试验证（96.3%质量相关性）
 *
 * @param userId 用户ID
 * @param rolloutPercentage 灰度比例（0-100）
 * @returns true=启用压缩，false=使用原始格式
 */
export function isCompetitorCompressionEnabled(
  userId: number,
  rolloutPercentage: number = 10  // 默认10%灰度
): boolean {
  // 简单哈希函数：用户ID对100取模
  const bucket = userId % 100

  // 灰度逻辑：bucket < rolloutPercentage 的用户启用压缩
  return bucket < rolloutPercentage
}

/**
 * 竞品分析缓存灰度发布
 *
 * 策略：3天TTL缓存，基于用户ID分流
 * - 竞品数据变化慢，缓存安全
 * - 节省约30% API调用
 *
 * @param userId 用户ID
 * @param rolloutPercentage 灰度比例（0-100）
 * @returns true=启用缓存，false=实时分析
 */
export function isCompetitorCacheEnabled(
  userId: number,
  rolloutPercentage: number = 50  // 默认50%灰度
): boolean {
  const bucket = userId % 100
  return bucket < rolloutPercentage
}

/**
 * 获取当前功能开关配置
 *
 * 中心化管理所有灰度发布参数，便于监控和调整
 */
export const FEATURE_FLAGS = {
  // 竞品压缩优化
  competitorCompression: {
    enabled: true,          // 全局开关
    rolloutPercentage: 100, // 🟢 100%全量部署（A/B测试已验证96.3%质量）
    description: 'Token优化：竞品数据压缩（45% token减少，96.3%质量验证）',
    deployedAt: '2025-11-30',
  },

  // 竞品分析缓存
  competitorCache: {
    enabled: true,
    rolloutPercentage: 50,
    cacheTTL: 3 * 24 * 60 * 60 * 1000,  // 3天（毫秒）
    description: 'Token优化：竞品分析结果缓存（30%调用减少）',
  },

  // 模型降级（待实施）
  flashModelForSimpleTasks: {
    enabled: false,  // 未启用，需先A/B测试
    rolloutPercentage: 0,
    description: 'Token优化：简单任务使用Flash模型（5x成本降低）',
    tasks: ['detectLanguage', 'parseMultiLangDigit'],
  },

  // 结构化JSON输出（待实施）
  structuredJsonOutput: {
    enabled: false,
    rolloutPercentage: 0,
    description: 'Token优化：强制JSON schema约束（减少后处理开销）',
  },
} as const

/**
 * 性能改造发布开关（支持默认开启 + 环境变量紧急回滚）
 *
 * 设计目标：
 * - 已完成且可直接上线的改造默认开启
 * - 支持通过环境变量临时打开/关闭
 * - 支持依赖校验，防止不完整启用
 */
export const PERFORMANCE_RELEASE_FLAGS = {
  navLink: {
    enabled: true,
    envKey: 'FF_NAV_LINK',
    description: '侧边栏导航改为 next/link',
    owner: 'frontend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  dashboardDefer: {
    enabled: true,
    envKey: 'FF_DASHBOARD_DEFER',
    description: 'Dashboard 非关键模块延迟加载',
    owner: 'frontend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  campaignsParallel: {
    enabled: true,
    envKey: 'FF_CAMPAIGNS_PARALLEL',
    description: 'Campaigns performance 接口并行查询',
    owner: 'backend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  offersIncrementalPoll: {
    enabled: true,
    envKey: 'FF_OFFERS_INCREMENTAL_POLL',
    description: 'Offers 增量轮询',
    owner: 'frontend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  offersServerPaging: {
    enabled: true,
    envKey: 'FF_OFFERS_SERVER_PAGING',
    description: 'Offers 服务端分页/筛选/排序',
    owner: 'fullstack',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: ['offersIncrementalPoll'] as const,
  },
  campaignsReqDedup: {
    enabled: true,
    envKey: 'FF_CAMPAIGNS_REQ_DEDUP',
    description: 'Campaigns 前端请求去重',
    owner: 'frontend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  campaignsServerPaging: {
    enabled: true,
    envKey: 'FF_CAMPAIGNS_SERVER_PAGING',
    description: 'Campaigns 服务端分页',
    owner: 'fullstack',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: ['campaignsReqDedup'] as const,
  },
  kpiShortTtl: {
    enabled: true,
    envKey: 'FF_KPI_SHORT_TTL',
    description: 'Dashboard KPI 短TTL策略',
    owner: 'backend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  webVitalsMonitoring: {
    enabled: false,
    envKey: 'FF_WEB_VITALS_MONITORING',
    description: '前端 Web Vitals 采集与上报',
    owner: 'frontend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
  frontendErrorMonitoring: {
    enabled: false,
    envKey: 'FF_FRONTEND_ERROR_MONITORING',
    description: '前端错误事件采集与上报',
    owner: 'frontend',
    createdAt: '2026-03-03',
    removeAfter: '2026-06-30',
    emergencyRollbackOnly: true,
    dependsOn: [] as const,
  },
} as const

export type PerformanceReleaseFlagName = keyof typeof PERFORMANCE_RELEASE_FLAGS

type PerformanceReleaseSnapshot = {
  enabled: boolean
  envKey: string
  source: 'default' | 'env'
  dependsOn: ReadonlyArray<PerformanceReleaseFlagName>
}

function parseEnvBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim().toLowerCase()

  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') {
    return true
  }
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') {
    return false
  }

  return undefined
}

/**
 * 判断性能改造开关是否开启。
 *
 * 优先级：
 * 1) 环境变量（FF_*）
 * 2) 代码默认值
 */
export function isPerformanceReleaseEnabled(flag: PerformanceReleaseFlagName): boolean {
  const config = PERFORMANCE_RELEASE_FLAGS[flag]
  const envEnabled = parseEnvBoolean(process.env[config.envKey])
  return envEnabled ?? config.enabled
}

/**
 * 输出开关快照，便于发布排障与审计。
 */
export function getPerformanceReleaseSnapshot(): Record<PerformanceReleaseFlagName, PerformanceReleaseSnapshot> {
  const snapshot: Partial<Record<PerformanceReleaseFlagName, PerformanceReleaseSnapshot>> = {}

  for (const flag of Object.keys(PERFORMANCE_RELEASE_FLAGS) as PerformanceReleaseFlagName[]) {
    const config = PERFORMANCE_RELEASE_FLAGS[flag]
    const envEnabled = parseEnvBoolean(process.env[config.envKey])

    snapshot[flag] = {
      enabled: envEnabled ?? config.enabled,
      envKey: config.envKey,
      source: envEnabled === undefined ? 'default' : 'env',
      dependsOn: [...config.dependsOn],
    }
  }

  return snapshot as Record<PerformanceReleaseFlagName, PerformanceReleaseSnapshot>
}

/**
 * 检查开关依赖关系是否满足。
 */
export function validatePerformanceReleaseDependencies(
  snapshot: Record<PerformanceReleaseFlagName, PerformanceReleaseSnapshot> = getPerformanceReleaseSnapshot()
): { valid: boolean; issues: string[] } {
  const issues: string[] = []

  for (const flag of Object.keys(snapshot) as PerformanceReleaseFlagName[]) {
    const config = snapshot[flag]
    if (!config.enabled) continue

    for (const dep of config.dependsOn) {
      if (!snapshot[dep]?.enabled) {
        issues.push(`${flag} requires ${dep} to be enabled`)
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  }
}

/**
 * 记录功能开关决策日志（用于监控和调试）
 *
 * @param feature 功能名称
 * @param userId 用户ID
 * @param enabled 是否启用
 */
export function logFeatureFlag(
  feature: string,
  userId: number,
  enabled: boolean
): void {
  if (process.env.NODE_ENV === 'development') {
    console.log(`🚦 Feature Flag: ${feature} | User ${userId} | ${enabled ? '✅ Enabled' : '❌ Disabled'}`)
  }
}
