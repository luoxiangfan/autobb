import { getDatabase } from './db'

type RepairCandidateRow = {
  offer_id: number
  affiliate_link: string | null
  offer_url: string | null
  final_url: string | null
  promo_link: string | null
  short_promo_link: string | null
}

function normalizeUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null

  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.toString()
  } catch {
    return null
  }
}

function toPositiveIntegerList(values?: number[]): number[] {
  if (!Array.isArray(values)) return []

  const normalized = values
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0)

  return Array.from(new Set(normalized))
}

function shouldReplaceAffiliateLink(candidate: RepairCandidateRow, normalizedShortLink: string): boolean {
  const normalizedCurrent = normalizeUrl(candidate.affiliate_link)
  if (!normalizedCurrent) return true
  if (normalizedCurrent === normalizedShortLink) return false

  const fallbackCandidates = [
    normalizeUrl(candidate.promo_link),
    normalizeUrl(candidate.offer_url),
    normalizeUrl(candidate.final_url),
  ].filter((value): value is string => Boolean(value))

  return fallbackCandidates.includes(normalizedCurrent)
}

/**
 * 使用 affiliate_products.short_promo_link 回填 offers.affiliate_link。
 * 仅在当前 affiliate_link 为空或仍是回退值（promo/url/final_url）时更新，避免覆盖人工改动。
 */
export async function repairOfferAffiliateLinksFromProducts(params: {
  userId: number
  offerIds?: number[]
  productIds?: number[]
}): Promise<{ scanned: number; updated: number; updatedOfferIds: number[] }> {
  const userId = Number(params.userId)
  if (!Number.isInteger(userId) || userId <= 0) {
    return { scanned: 0, updated: 0, updatedOfferIds: [] }
  }

  const offerIds = toPositiveIntegerList(params.offerIds)
  const productIds = toPositiveIntegerList(params.productIds)

  const db = await getDatabase()
  const isNotDeletedCondition = db.type === 'postgres'
    ? "(o.is_deleted IS NULL OR o.is_deleted::text IN ('0', 'f', 'false'))"
    : '(o.is_deleted = 0 OR o.is_deleted IS NULL)'

  const whereClauses = [
    'l.user_id = ?',
    "p.platform = 'partnerboost'",
    "TRIM(COALESCE(p.short_promo_link, '')) <> ''",
    isNotDeletedCondition,
  ]
  const queryParams: Array<number | string> = [userId]

  if (offerIds.length > 0) {
    const placeholders = offerIds.map(() => '?').join(',')
    whereClauses.push(`l.offer_id IN (${placeholders})`)
    queryParams.push(...offerIds)
  }

  if (productIds.length > 0) {
    const placeholders = productIds.map(() => '?').join(',')
    whereClauses.push(`l.product_id IN (${placeholders})`)
    queryParams.push(...productIds)
  }

  const rows = await db.query<RepairCandidateRow>(
    `
      SELECT DISTINCT
        l.offer_id,
        o.affiliate_link,
        o.url AS offer_url,
        o.final_url,
        p.promo_link,
        p.short_promo_link
      FROM affiliate_product_offer_links l
      INNER JOIN offers o ON o.id = l.offer_id AND o.user_id = l.user_id
      INNER JOIN affiliate_products p ON p.id = l.product_id AND p.user_id = l.user_id
      WHERE ${whereClauses.join(' AND ')}
    `,
    queryParams
  )

  if (rows.length === 0) {
    return { scanned: 0, updated: 0, updatedOfferIds: [] }
  }

  const candidateByOffer = new Map<number, { candidate: RepairCandidateRow; shortLinks: Set<string> }>()
  for (const row of rows) {
    const normalizedShort = normalizeUrl(row.short_promo_link)
    if (!normalizedShort) continue

    const existing = candidateByOffer.get(row.offer_id)
    if (!existing) {
      candidateByOffer.set(row.offer_id, {
        candidate: row,
        shortLinks: new Set([normalizedShort]),
      })
      continue
    }

    existing.shortLinks.add(normalizedShort)
  }

  const now = new Date().toISOString()
  let updatedCount = 0
  const updatedOfferIds: number[] = []

  for (const [offerId, grouped] of candidateByOffer.entries()) {
    if (grouped.shortLinks.size !== 1) {
      // 同一个Offer命中多个不同短链时跳过，避免误覆盖。
      continue
    }

    const normalizedShortLink = Array.from(grouped.shortLinks)[0]
    if (!shouldReplaceAffiliateLink(grouped.candidate, normalizedShortLink)) {
      continue
    }

    await db.exec(
      `
        UPDATE offers
        SET affiliate_link = ?, updated_at = ?
        WHERE id = ? AND user_id = ?
      `,
      [normalizedShortLink, now, offerId, userId]
    )

    updatedCount += 1
    updatedOfferIds.push(offerId)
  }

  return {
    scanned: candidateByOffer.size,
    updated: updatedCount,
    updatedOfferIds,
  }
}
