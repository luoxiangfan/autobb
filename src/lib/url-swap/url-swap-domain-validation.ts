import { detectDomainChangeAffiliateFailure } from '@/lib/affiliate'
import type { UrlSwapErrorType } from './url-swap-types'

export type UrlSwapDomainValidationContext = 'campaign' | 'sitelink'

export function validateUrlSwapDomainChange(
  oldUrl: string,
  newUrl: string,
  context: UrlSwapDomainValidationContext = 'campaign'
): {
  valid: boolean
  error?: string
  errorType?: UrlSwapErrorType
} {
  const affiliateFailure = detectDomainChangeAffiliateFailure(oldUrl, newUrl)
  if (affiliateFailure) {
    return {
      valid: false,
      error: affiliateFailure.message,
      errorType: 'link_resolution',
    }
  }

  try {
    const oldDomain = new URL(oldUrl).hostname
    const newDomain = new URL(newUrl).hostname

    if (oldDomain !== newDomain) {
      const error =
        context === 'sitelink'
          ? `Sitelink 落地页域名发生变化（${oldDomain} → ${newDomain}）`
          : `落地页域名发生变化（${oldDomain} → ${newDomain}），与当前记录的 Final URL 不一致。` +
            '若推广链接已更换或失效，请在联盟平台确认并更新 Offer 推广链接。'

      return {
        valid: false,
        error,
        errorType: 'link_resolution',
      }
    }

    return { valid: true }
  } catch {
    return { valid: true }
  }
}
