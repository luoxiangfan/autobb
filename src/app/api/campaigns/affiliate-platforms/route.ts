import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { getDatabase } from '@/lib/db'

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

    // 从 system_settings 表中查询 affiliate_sync 分类的配置
    const rows = await db.query(`
      SELECT DISTINCT
        s.key,
        s.description,
        COUNT(DISTINCT c.id) as campaign_count
      FROM system_settings s
      LEFT JOIN offers o ON o.user_id = s.user_id
      LEFT JOIN campaigns c ON o.id = c.offer_id AND c.is_deleted = 0
      WHERE s.category = 'affiliate_sync'
        AND s.key NOT LIKE '%\_token'
        AND s.key NOT LIKE '%\_secret'
        AND s.key NOT LIKE '%\_password'
        AND s.key NOT LIKE '%interval%'
        AND s.key NOT LIKE '%mode%'
        AND s.key NOT LIKE '%enabled%'
        AND (s.user_id = ? OR s.user_id IS NULL)
      GROUP BY s.key, s.description
      ORDER BY campaign_count DESC, s.key ASC
    `, [userId])

    // 从配置 key 中提取联盟平台名称
    const affiliates = new Map<string, number>()
    
    for (const row of rows as any[]) {
      const key = row.key || ''
      const description = row.description || ''
      const campaignCount = Number(row.campaign_count) || 0
      
      // 从 key 中提取平台名称
      const platformName = extractPlatformNameFromKey(key, description)
      
      if (!platformName) continue
      
      const currentCount = affiliates.get(platformName) || 0
      affiliates.set(platformName, currentCount + campaignCount)
    }

    // 转换为数组并排序
    const result = Array.from(affiliates.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json({
      success: true,
      affiliates: result,
      total: result.length,
    })
  } catch (error: any) {
    console.error('获取联盟平台列表失败:', error)
    return NextResponse.json(
      { error: error.message || '获取联盟平台列表失败' },
      { status: 500 }
    )
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
  // 常见联盟平台映射
  const platformMap: Record<string, string> = {
    'yeahpromos': 'YeahPromos',
    'partnerboost': 'PartnerBoost',
    'cj': 'CJ',
    'commissionjunction': 'CJ',
    'shareasale': 'ShareASale',
    'awin': 'Awin',
    'impact': 'Impact',
    'rakuten': 'Rakuten',
    'skimlinks': 'Skimlinks',
    'redirectingat': 'Skimlinks',
    'linkshare': 'LinkShare',
    'linksynergy': 'LinkShare',
    'flexoffers': 'FlexOffers',
    'flexlinks': 'FlexOffers',
    'tradetracker': 'TradeTracker',
    'tpmedia': 'TradeTracker',
    'clickbank': 'ClickBank',
    'digistore24': 'Digistore24',
    'warriorplus': 'WarriorPlus',
    'jvzoo': 'JVZoo',
    'amazon': 'Amazon',
    'amzn': 'Amazon',
  }

  const keyLower = key.toLowerCase()
  const descLower = description.toLowerCase()

  // 从 key 中查找匹配的平台
  for (const [platformKey, platformName] of Object.entries(platformMap)) {
    if (keyLower.includes(platformKey)) {
      return platformName
    }
  }

  // 从 description 中查找匹配的平台
  for (const [platformKey, platformName] of Object.entries(platformMap)) {
    if (descLower.includes(platformKey)) {
      return platformName
    }
  }

  // 如果都没有匹配，从 key 中提取（去除 _token, _url 等后缀）
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
    // 将 snake_case 转换为 Title Case
    return cleanedKey
      .split('_')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join('')
  }

  return key
}
