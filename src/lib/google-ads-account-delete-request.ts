import type { NextRequest } from 'next/server'
import { parseTruthyFlag } from './parse-truthy-flag'

export interface DeleteGoogleAdsAccountRequestOptions {
  removeGoogleAdsCampaigns: boolean
}

/**
 * 解析 DELETE 请求参数：优先 query，其次 JSON body（兼容无 Content-Type 的 body）
 */
export async function parseDeleteGoogleAdsAccountRequest(
  request: NextRequest
): Promise<DeleteGoogleAdsAccountRequestOptions> {
  if (parseTruthyFlag(request.nextUrl.searchParams.get('removeGoogleAdsCampaigns'))) {
    return { removeGoogleAdsCampaigns: true }
  }

  try {
    const rawBody = await request.text()
    if (!rawBody.trim()) {
      return { removeGoogleAdsCampaigns: false }
    }
    const body = JSON.parse(rawBody) as { removeGoogleAdsCampaigns?: unknown }
    return { removeGoogleAdsCampaigns: parseTruthyFlag(body?.removeGoogleAdsCampaigns) }
  } catch {
    return { removeGoogleAdsCampaigns: false }
  }
}
