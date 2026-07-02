import { logger } from '@/lib/common/server'
import type { PoolKeywordData } from '@/lib/keywords/offer-pool'
import type { Offer } from '@/lib/offers/server'
import { getKeywordPlannerUrlSeedForOffer } from '@/lib/keywords/planner/keyword-planner-site-filter'
import { DEFAULTS } from '@/lib/keywords/keyword-constants'
import {
  type PlannerDecision,
  type PlannerNonBrandPolicy,
} from '@/lib/keywords/planner/planner-non-brand-policy'
import type { KeywordPlannerPreparedSession } from '@/lib/google-ads/accounts/auth/index'
import { expandForOAuth } from './expansion-oauth'
import { expandForServiceAccount } from './expansion-service-account'

async function expandAllKeywords(
  initialKeywords: PoolKeywordData[],
  brandName: string,
  category: string,
  targetCountry: string,
  targetLanguage: string,
  authType: 'oauth' | 'service_account',
  offer?: Offer,
  userId?: number,
  customerId?: string,
  refreshToken?: string,
  accountId?: number,
  clientId?: string,
  clientSecret?: string,
  developerToken?: string,
  progress?: (info: {
    phase?:
      | 'seed-volume'
      | 'expand-round'
      | 'volume-batch'
      | 'service-step'
      | 'filter'
      | 'cluster'
      | 'save'
    message: string
    current?: number
    total?: number
  }) => Promise<void> | void,
  plannerMinSearchVolume?: number,
  allowNonBrandFromPlanner?: boolean | PlannerNonBrandPolicy,
  plannerDecision?: PlannerDecision,
  linkedServiceAccountId?: string | null,
  plannerSession?: KeywordPlannerPreparedSession
): Promise<PoolKeywordData[]> {
  logger.debug(`\n📋 关键词扩展策略 (v2.0 - 认证类型: ${authType}):`)
  logger.debug(`   初始关键词数量: ${initialKeywords.length}`)
  logger.debug(`   品牌: ${brandName}`)

  if (authType === 'oauth') {
    return expandForOAuth({
      initialKeywords,
      brandName,
      category,
      targetCountry,
      targetLanguage,
      pageUrl: offer
        ? getKeywordPlannerUrlSeedForOffer(offer, { allowMarketplaceProductUrl: true })
        : undefined,
      offer,
      userId,
      customerId,
      refreshToken,
      accountId,
      clientId,
      clientSecret,
      developerToken,
      minSearchVolume: plannerMinSearchVolume ?? DEFAULTS.minSearchVolume,
      allowNonBrandFromPlanner,
      plannerDecision,
      progress,
      linkedServiceAccountId,
      plannerSession,
    })
  } else {
    if (!offer || !userId) {
      throw new Error('服务账号模式需要提供 offer 和 userId 参数')
    }
    return expandForServiceAccount({
      initialKeywords,
      brandName,
      category,
      targetCountry,
      targetLanguage,
      offer,
      userId,
      progress,
    })
  }
}

export { expandAllKeywords }
