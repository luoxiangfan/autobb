/**
 * KISS关键词策略统一配置
 *
 * 目标：
 * 1. 把分散在各模块的关键阈值收敛到单一配置源
 * 2. 在不增加复杂度的前提下，平衡关键词精准度与覆盖度
 */

export const KEYWORD_POLICY = {
  creative: {
    promptKeywordLimit: 50,
    titleAboutSeedRatioCap: 0.2,
    minIntentScore: 20,
    nonBrandVolumeDynamic: {
      defaultMinSearchVolume: 500,
      rules: [
        { maxBrandKeywordCount: 5, minSearchVolume: 100 },
        { maxBrandKeywordCount: 12, minSearchVolume: 200 },
        { maxBrandKeywordCount: 20, minSearchVolume: 300 },
      ],
    },
    explore: {
      // 覆盖度兜底：允许少量低意图探索词进入最终关键词池
      minIntentScore: 10,
      maxIntentScoreExclusive: 20,
      maxRatio: 0.2,
      maxCount: 3,
    },
  },
  autoActions: {
    negative: {
      lookbackDays: 30,
      minClicks: 2,
      minCost: 1,
      maxPerAdGroup: 2,
      maxPerUser: 20,
    },
    positive: {
      lookbackDays: 30,
      minClicks: 3,
      minConversions: 1,
      maxPerAdGroup: 1,
      maxPerUser: 3,
    },
  },
} as const

export function getRatioCappedCount(total: number, ratio: number, hardCap: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const ratioCap = Math.floor(total * ratio)
  return Math.max(0, Math.min(ratioCap, hardCap))
}

export function resolveNonBrandMinSearchVolumeByBrandKeywordCount(brandKeywordCount: number): number {
  const count = Number.isFinite(brandKeywordCount) ? Math.max(0, Math.floor(brandKeywordCount)) : 0
  const { rules, defaultMinSearchVolume } = KEYWORD_POLICY.creative.nonBrandVolumeDynamic

  for (const rule of rules) {
    if (count <= rule.maxBrandKeywordCount) {
      return rule.minSearchVolume
    }
  }

  return defaultMinSearchVolume
}
