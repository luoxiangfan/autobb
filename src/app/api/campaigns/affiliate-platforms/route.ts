import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'
import { resolveAffiliatePlatformForLink } from '@/lib/keywords'
import { campaignAffiliateAlignedFilterSql } from '@/lib/campaign/server'

/**
 * GET /api/campaigns/affiliate-platforms
 * 获取联盟平台列表（从 system_settings category=affiliate_sync 中提取）
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await verifyAuth(request)
    if (!authResult.authenticated || !authResult.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.user.userId
    const db = await getDatabase()

    const settingsRows = await db.query(
      `
      SELECT DISTINCT s.key, s.description
      FROM system_settings s
      WHERE s.category = 'affiliate_sync'
        AND s.key NOT LIKE '%\\_token'
        AND s.key NOT LIKE '%\\_secret'
        AND s.key NOT LIKE '%\\_password'
        AND s.key NOT LIKE '%interval%'
        AND s.key NOT LIKE '%mode%'
        AND s.key NOT LIKE '%enabled%'
        AND (s.user_id = ? OR s.user_id IS NULL)
      ORDER BY s.key ASC
    `,
      [userId]
    )

    const platformNames = new Set<string>()
    for (const row of settingsRows as Array<{ key?: string; description?: string }>) {
      const platformName = extractPlatformNameFromKey(row.key || '', row.description || '')
      if (platformName) {
        platformNames.add(platformName)
      }
    }

    const alignedFilter = campaignAffiliateAlignedFilterSql('c', 'o')
    const campaignRows = await db.query(
      `
      SELECT c.id, o.affiliate_link
      FROM campaigns c
      INNER JOIN offers o ON o.id = c.offer_id AND o.user_id = ?
      WHERE c.user_id = ?
        AND ${alignedFilter}
    `,
      [userId, userId]
    )

    const counts = new Map<string, number>()
    for (const platformName of platformNames) {
      counts.set(platformName, 0)
    }

    const sortedPlatforms = Array.from(platformNames).sort((a, b) => a.localeCompare(b))

    for (const row of campaignRows as Array<{ id?: number; affiliate_link?: string | null }>) {
      const platformName = resolveAffiliatePlatformForLink(row.affiliate_link, sortedPlatforms)
      if (!platformName) continue
      counts.set(platformName, (counts.get(platformName) || 0) + 1)
    }

    const result = Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

    return NextResponse.json({
      success: true,
      affiliates: result,
      total: result.length,
    })
  } catch (error: any) {
    console.error('获取联盟平台列表失败:', error)
    return NextResponse.json({ error: error.message || '获取联盟平台列表失败' }, { status: 500 })
  }
}

/**
 * 从 system_settings key 中提取联盟平台名称
 * 示例：
 * - yeahpromos_token -> YeahPromos
 * - partnerboost_base_url -> PartnerBoost
 * - cj_api_key -> CJ
 */
function extractPlatformNameFromKey(key: string, description: string): string {
  const platformMap: Record<string, string> = {
    yeahpromos: 'YeahPromos',
    partnerboost: 'PartnerBoost',
    cj: 'CJ',
    commissionjunction: 'CJ',
    shareasale: 'ShareASale',
    awin: 'Awin',
    impact: 'Impact',
    rakuten: 'Rakuten',
    skimlinks: 'Skimlinks',
    redirectingat: 'Skimlinks',
    linkshare: 'LinkShare',
    linksynergy: 'LinkShare',
    flexoffers: 'FlexOffers',
    flexlinks: 'FlexOffers',
    tradetracker: 'TradeTracker',
    tpmedia: 'TradeTracker',
    clickbank: 'ClickBank',
    digistore24: 'Digistore24',
    warriorplus: 'WarriorPlus',
    jvzoo: 'JVZoo',
    amazon: 'Amazon',
    amzn: 'Amazon',
  }

  const keyLower = key.toLowerCase()
  const descLower = description.toLowerCase()

  for (const [platformKey, platformName] of Object.entries(platformMap)) {
    if (keyLower.includes(platformKey)) {
      return platformName
    }
  }

  for (const [platformKey, platformName] of Object.entries(platformMap)) {
    if (descLower.includes(platformKey)) {
      return platformName
    }
  }

  const cleanedKey = key
    .replace(/_token$/i, '')
    .replace(/_secret$/i, '')
    .replace(/_password$/i, '')
    .replace(/_key$/i, '')
    .replace(/_url$/i, '')
    .replace(/_base_url$/i, '')
    .replace(/_api_key$/i, '')
    .replace(/_site_id$/i, '')
    .replace(/_id$/i, '')

  if (cleanedKey) {
    return cleanedKey
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
  }

  return key
}
