export interface SitelinkItem {
  text: string
  url: string
  finalUrlSuffix?: string
  sourceAffiliateLink?: string
  description1?: string
  description2?: string
}

export type PublishSitelinkInput = {
  text: string
  url: string
  finalUrlSuffix?: string
  description1?: string
  description2?: string
}

/** 将完整 URL 拆为 Google Ads final_urls 基址与 final_url_suffix */
export function splitUrlBaseAndSuffix(fullUrl: string): { base: string; suffix: string } {
  try {
    const urlObj = new URL(fullUrl)
    return {
      base: `${urlObj.origin}${urlObj.pathname}`,
      suffix: urlObj.search ? urlObj.search.substring(1) : '',
    }
  } catch {
    return { base: fullUrl, suffix: '' }
  }
}

const SITELINK_TEXT_MAX = 25
const SITELINK_DESC_MAX = 35

const firstNonEmptyString = (candidates: unknown[]): string | undefined => {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

const truncate = (value: string, maxLen: number): string => value.substring(0, maxLen)

export function readSitelinkText(sitelink: unknown): string {
  if (typeof sitelink === 'string') return sitelink
  if (!sitelink || typeof sitelink !== 'object') return ''
  const sl = sitelink as Record<string, unknown>
  return typeof sl.text === 'string' ? sl.text : String(sl.text ?? '')
}

export function readSitelinkUrl(sitelink: unknown): string {
  if (!sitelink || typeof sitelink !== 'object') return ''
  const sl = sitelink as Record<string, unknown>
  return typeof sl.url === 'string' ? sl.url : String(sl.url ?? '')
}

export function readSitelinkDescription1(sitelink: unknown): string {
  if (!sitelink || typeof sitelink !== 'object') return ''
  const sl = sitelink as Record<string, unknown>
  return (
    firstNonEmptyString([
      sl.description1,
      sl.description_1,
      sl.description,
      sl.desc,
      Array.isArray(sl.descriptions) ? sl.descriptions[0] : undefined,
    ]) ?? ''
  )
}

export function readSitelinkDescription2(sitelink: unknown): string {
  if (!sitelink || typeof sitelink !== 'object') return ''
  const sl = sitelink as Record<string, unknown>
  return (
    firstNonEmptyString([
      sl.description2,
      sl.description_2,
      Array.isArray(sl.descriptions) ? sl.descriptions[1] : undefined,
    ]) ?? ''
  )
}

export function emptySitelinkItem(url = ''): SitelinkItem {
  return { text: '', url, description1: '', description2: '' }
}

export function normalizeSitelinkItem(raw: unknown, fallbackUrl?: string): SitelinkItem | null {
  if (!raw) return null

  if (typeof raw === 'string') {
    const text = truncate(raw.trim(), SITELINK_TEXT_MAX)
    if (!text) return null
    return { text, url: (fallbackUrl || '/').trim() }
  }

  if (typeof raw !== 'object') return null

  const link = raw as Record<string, unknown>
  const textRaw =
    (typeof link.text === 'string' && link.text) ||
    (typeof link.title === 'string' && link.title) ||
    (typeof link.name === 'string' && link.name) ||
    ''
  const text = truncate(String(textRaw).trim(), SITELINK_TEXT_MAX)
  if (!text) return null

  const urlRaw =
    (typeof link.url === 'string' && link.url) ||
    (typeof link.href === 'string' && link.href) ||
    (typeof link.link === 'string' && link.link) ||
    fallbackUrl ||
    '/'
  const url = String(urlRaw).trim()
  if (!url) return null

  const description1 = firstNonEmptyString([
    link.description1,
    link.description_1,
    link.description,
    link.desc,
    Array.isArray(link.descriptions) ? link.descriptions[0] : undefined,
  ])
  const description2 = firstNonEmptyString([
    link.description2,
    link.description_2,
    Array.isArray(link.descriptions) ? link.descriptions[1] : undefined,
  ])

  const finalUrlSuffixRaw = firstNonEmptyString([link.finalUrlSuffix, link.final_url_suffix])
  const sourceAffiliateLink = firstNonEmptyString([
    link.sourceAffiliateLink,
    link.source_affiliate_link,
  ])

  const item: SitelinkItem = { text, url }
  if (finalUrlSuffixRaw) item.finalUrlSuffix = finalUrlSuffixRaw
  if (sourceAffiliateLink) item.sourceAffiliateLink = sourceAffiliateLink
  if (description1) item.description1 = truncate(description1, SITELINK_DESC_MAX)
  if (description2) item.description2 = truncate(description2, SITELINK_DESC_MAX)
  return item
}

export function normalizeSitelinkList(raw: unknown, fallbackUrl?: string): SitelinkItem[] {
  const arr = Array.isArray(raw) ? raw : []
  return arr
    .map((item) => normalizeSitelinkItem(item, fallbackUrl))
    .filter((item): item is SitelinkItem => item !== null)
}

export function formatSitelinkForPublish(item: SitelinkItem): PublishSitelinkInput {
  const desc1 = item.description1?.trim()
  const desc2 = item.description2?.trim()
  const suffix = item.finalUrlSuffix?.trim()

  return {
    text: item.text,
    url: item.url,
    ...(suffix ? { finalUrlSuffix: suffix } : {}),
    ...(desc1 ? { description1: desc1, description2: desc2 || desc1 } : {}),
  }
}

export function formatSitelinkDescriptionsDisplay(sitelink: unknown): string {
  const desc1 = readSitelinkDescription1(sitelink)
  const desc2 = readSitelinkDescription2(sitelink)
  if (desc1 && desc2) return `${desc1} · ${desc2}`
  return desc1 || desc2
}

export function isSitelinkDescriptionTooLong(sitelink: unknown): boolean {
  const desc1 = readSitelinkDescription1(sitelink)
  const desc2 = readSitelinkDescription2(sitelink)
  return desc1.length > SITELINK_DESC_MAX || desc2.length > SITELINK_DESC_MAX
}
