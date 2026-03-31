import { NextRequest, NextResponse } from 'next/server'
import { verifyAuth } from '@/lib/auth'
import { queryActiveCampaigns } from '@/lib/active-campaigns-query'
import { parseCampaignName } from '@/lib/campaign-association'

export const dynamic = 'force-dynamic'

function parsePositiveInteger(value: string | null | undefined): number | null {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) return null
  return parsed
}

type SnapshotRow = {
  campaignId: string
  campaignName: string
  status: 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN'
  bucket: 'own' | 'manual' | 'other'
  brand: string | null
  brandConfidence: 'high' | 'low' | 'none'
  source: 'naming' | 'manual'
}

function normalizeBrand(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function buildSnapshotRows(params: {
  campaigns: Array<{ id: string; name: string; status: 'ENABLED' | 'PAUSED' | 'REMOVED' | 'UNKNOWN' }>
  bucket: SnapshotRow['bucket']
  source: SnapshotRow['source']
}): SnapshotRow[] {
  return params.campaigns.map((campaign) => {
    const parsed = parseCampaignName(campaign.name)
    const brand = normalizeBrand(parsed.brandName)

    return {
      campaignId: String(campaign.id),
      campaignName: campaign.name,
      status: campaign.status,
      bucket: params.bucket,
      brand,
      brandConfidence: brand ? 'high' : (parsed.isValidNaming ? 'low' : 'none'),
      source: params.source,
    }
  })
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyAuth(request)
    if (!auth.authenticated || !auth.user) {
      return NextResponse.json({ error: '未授权' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const accountId = parsePositiveInteger(searchParams.get('accountId'))

    if (!accountId) {
      return NextResponse.json({ error: '缺少有效的 accountId' }, { status: 400 })
    }

    const userId = auth.user.userId
    const snapshot = await queryActiveCampaigns(0, accountId, userId)

    const rows: SnapshotRow[] = [
      ...buildSnapshotRows({ campaigns: snapshot.ownCampaigns, bucket: 'own', source: 'naming' }),
      ...buildSnapshotRows({ campaigns: snapshot.manualCampaigns, bucket: 'manual', source: 'manual' }),
      ...buildSnapshotRows({ campaigns: snapshot.otherCampaigns, bucket: 'other', source: 'naming' }),
    ]

    const brandSet = new Set(
      rows
        .map((row) => normalizeBrand(row.brand)?.toLowerCase() || null)
        .filter((brand): brand is string => Boolean(brand))
    )
    const hasUnknownBrand = rows.some((row) => row.brandConfidence === 'none')

    return NextResponse.json({
      success: true,
      data: {
        accountId,
        totalEnabledCampaigns: rows.length,
        ownCampaigns: snapshot.ownCampaigns.length,
        manualCampaigns: snapshot.manualCampaigns.length,
        otherCampaigns: snapshot.otherCampaigns.length,
        knownBrandCount: brandSet.size,
        knownBrands: Array.from(brandSet),
        hasUnknownBrand,
        isSingleBrandSafe: brandSet.size <= 1 && !hasUnknownBrand,
        rows,
      },
    })
  } catch (error: any) {
    console.error('获取活动Campaign品牌快照失败:', error)
    return NextResponse.json(
      { error: error?.message || '获取活动Campaign品牌快照失败' },
      { status: 500 }
    )
  }
}
