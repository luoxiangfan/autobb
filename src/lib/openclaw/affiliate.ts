import { getOpenclawSettingsWithAffiliateSyncMap, parseBoolean, parseNumber } from '@/lib/openclaw/settings'
import { resolvePartnerboostCountryCode } from '@/lib/affiliate-products'

type PartnerboostAssociateItem = {
  asin: string
  brand_name?: string
  commission?: number | string
  region?: string
}

type PartnerboostLinkResult = {
  asin: string
  link?: string
  partnerboost_link?: string
}

type YeahPromosMerchant = {
  merchant_name?: string
  url?: string
  tracking_url?: string
  country?: string
}

function normalizeUrl(value?: string | null): string | null {
  if (!value) return null
  const trimmed = String(value).trim()
  return trimmed || null
}

export async function fetchPartnerboostAssociates(userId: number): Promise<PartnerboostAssociateItem[]> {
  const settings = await getOpenclawSettingsWithAffiliateSyncMap(userId)
  const token = (settings.partnerboost_token || '').trim()
  if (!token) return []

  const baseUrl = (settings.partnerboost_base_url || 'https://app.partnerboost.com').trim().replace(/\/+$/, '')
  const pageSize = parseNumber(settings.partnerboost_associates_page_size, 200) || 200
  const page = parseNumber(settings.partnerboost_associates_page, 1) || 1
  const filterSexual = parseNumber(settings.partnerboost_associates_filter_sexual_wellness, 0) || 0
  const region = (settings.partnerboost_associates_region || 'us').trim()

  const response = await fetch(`${baseUrl}/api/datafeed/get_latest_associates_products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      page_size: pageSize,
      page,
      filter_sexual_wellness: filterSexual,
      region,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PartnerBoost associates fetch failed (${response.status}): ${text}`)
  }

  const payload = await response.json() as { status?: { code?: number; msg?: string }; data?: { list?: PartnerboostAssociateItem[] } }
  if (payload.status?.code !== 0) {
    throw new Error(`PartnerBoost associates error: ${payload.status?.msg || payload.status?.code}`)
  }

  return payload.data?.list || []
}

export async function fetchPartnerboostLinkByAsin(params: {
  userId: number
  asin: string
  countryCode?: string | null
}): Promise<PartnerboostLinkResult | null> {
  const settings = await getOpenclawSettingsWithAffiliateSyncMap(params.userId)
  const token = (settings.partnerboost_token || '').trim()
  if (!token) return null

  const baseUrl = (settings.partnerboost_base_url || 'https://app.partnerboost.com').trim().replace(/\/+$/, '')
  const countryCode = resolvePartnerboostCountryCode(params.countryCode, settings.partnerboost_link_country_code)
  const uid = (settings.partnerboost_link_uid || '').trim()
  const returnPartnerboostLink = parseNumber(settings.partnerboost_link_return_partnerboost_link, 0) || 0

  const response = await fetch(`${baseUrl}/api/datafeed/get_amazon_link_by_asin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      asins: params.asin,
      country_code: countryCode,
      uid,
      return_partnerboost_link: returnPartnerboostLink,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`PartnerBoost link fetch failed (${response.status}): ${text}`)
  }

  const payload = await response.json() as { status?: { code?: number; msg?: string }; data?: PartnerboostLinkResult[] }
  if (payload.status?.code !== 0) {
    throw new Error(`PartnerBoost link error: ${payload.status?.msg || payload.status?.code}`)
  }

  const item = payload.data?.[0]
  if (!item) return null
  const link = normalizeUrl(item.partnerboost_link) || normalizeUrl(item.link) || undefined
  return { asin: item.asin, link }
}

export async function fetchYeahPromosMerchants(userId: number): Promise<YeahPromosMerchant[]> {
  const settings = await getOpenclawSettingsWithAffiliateSyncMap(userId)
  const token = (settings.yeahpromos_token || '').trim()
  if (!token) return []

  const siteId = (settings.yeahpromos_site_id || '').trim()
  if (!siteId) return []

  const page = parseNumber(settings.yeahpromos_page, 1) || 1
  const limit = parseNumber(settings.yeahpromos_limit, 1000) || 1000

  const url = new URL('https://yeahpromos.com/index/getadvert/getadvert')
  url.searchParams.set('site_id', siteId)
  url.searchParams.set('page', String(page))
  url.searchParams.set('limit', String(limit))

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      token,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`YeahPromos merchants fetch failed (${response.status}): ${text}`)
  }

  const payload = await response.json() as { Code?: number; code?: number; Data?: any[]; data?: any[] }
  const code = payload.Code ?? payload.code
  if (code && code !== 100000) {
    throw new Error(`YeahPromos merchants error: ${code}`)
  }

  const list = payload.Data || payload.data || []
  return list.map((item: any) => ({
    merchant_name: item.merchant_name,
    url: item.url,
    tracking_url: item.tracking_url,
    country: item.country,
  }))
}
