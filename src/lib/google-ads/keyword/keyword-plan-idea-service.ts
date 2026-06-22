import type { AuthType } from '@/lib/google-ads/service-account/service-account'

/**
 * OAuth 模式使用 customer.keywordPlanIdeas；
 * 服务账号模式使用 customer.loadService('KeywordPlanIdeaServiceClient')。
 */
export function getKeywordPlanIdeaService(customer: any, authType: AuthType | undefined) {
  if (authType === 'service_account') {
    return customer.loadService('KeywordPlanIdeaServiceClient')
  }
  return customer.keywordPlanIdeas
}
