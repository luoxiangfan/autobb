import { trackOAuthApiCall } from '@/lib/google-ads/api/shared'
import type { OAuthApiCredentialsFields } from '@/lib/google-ads/accounts/auth/index'
import type { GoogleAdsAuthContext } from '@/lib/google-ads/auth/context'
import { runOAuthGaqlWithLoginCustomerFallback } from '@/lib/google-ads/oauth/gaql'
import { executeGAQLQueryPython } from '../../../campaign/server'
import { resolveCountryCodeFromGoogleAdsGeoTargetId } from '../../../common/server'
import { ApiOperationType } from '@/lib/google-ads/api/tracker'
import type { CampaignSyncAuditInsert, GoogleAdsCampaign } from './types'
import { getLanguageName } from './types'
import { saveCampaignSyncAuditRows } from './audit'

import { googleAdsSyncLogger } from '../../common/logger'

type CampaignExtensionAssetType = 'CALLOUT' | 'SITELINK'

/* * Resolve extension type from campaign_asset.field_type, asset.type, or nested asset fields. */
function resolveCampaignExtensionAssetType(row: any): CampaignExtensionAssetType | null {
  const fieldType = String(row.campaign_asset?.field_type || '').toUpperCase()
  if (fieldType === 'CALLOUT' || fieldType === 'SITELINK') {
    return fieldType
  }

  const assetType = String(row.asset?.type || '').toUpperCase()
  if (assetType === 'CALLOUT' || assetType === 'SITELINK') {
    return assetType
  }

  // Python MessageToDict may omit asset.type even WHEN sitelink/callout sub-assets are present.
  if (row.asset?.sitelink_asset?.link_text) {
    return 'SITELINK'
  }
  if (row.asset?.callout_asset?.callout_text) {
    return 'CALLOUT'
  }

  return null
}

async function fetchAllDataFromGoogleAds(params: {
  userId: number
  customerId: string
  googleAdsAccountId: number
  authType: string
  serviceAccountId?: string
  refreshToken: string | null
  parentMccId?: string | null
  oauthCredentials?: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
  authContext?: GoogleAdsAuthContext
  enableAudit?: boolean
}): Promise<any[]> {
  const {
    userId,
    customerId,
    googleAdsAccountId,
    authType,
    serviceAccountId,
    refreshToken,
    parentMccId,
    oauthCredentials,
    oauthLoginCustomerId,
    authContext,
    enableAudit = true,
  } = params

  try {
    // 查询 1：获取广告、广告组、广告系列及预算数据
    const query1 = `
      SELECT
        campaign.id,
        ad_group.id,
        ad_group.name,
        ad_group.final_url_suffix,
        ad_group_ad.ad.id,
        ad_group_ad.ad.type,
        ad_group_ad.ad.responsive_search_ad.headlines,
        ad_group_ad.ad.responsive_search_ad.descriptions,
        ad_group_ad.ad.name,
        ad_group_ad.ad.final_urls,
        ad_group_ad.ad.final_url_suffix
      FROM ad_group_ad
      WHERE campaign.status != 'REMOVED'
        AND ad_group.status != 'REMOVED'
        AND ad_group_ad.status != 'REMOVED'
    `

    // 查询 2：获取关键词数据
    const query2 = `
      SELECT
        campaign.id,
        ad_group.id,
        ad_group_criterion.negative,
        ad_group_criterion.criterion_id,
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type
      FROM ad_group_criterion
      WHERE ad_group_criterion.type = 'KEYWORD'
        AND campaign.status != 'REMOVED'
        AND ad_group.status != 'REMOVED'
        AND ad_group_criterion.status != 'REMOVED'
    `

    // 查询 3：获取素材资源（Assets）数据
    const query3 = `
      SELECT
        campaign.id,
        campaign.status,
        campaign_asset.field_type,
        asset.type,
        asset.final_urls,
        asset.callout_asset.callout_text,
        asset.sitelink_asset.link_text,
        asset.sitelink_asset.description1,
        asset.sitelink_asset.description2
      FROM campaign_asset
      WHERE campaign.status != 'REMOVED'
        AND campaign_asset.status != 'REMOVED'
        AND campaign_asset.field_type IN ('CALLOUT', 'SITELINK')
    `

    // 查询 4：获取广告系列层级的定位（国家/语言）
    const query4 = `
      SELECT
        campaign.id,
        campaign_criterion.criterion_id,
        campaign_criterion.type,
        campaign_criterion.display_name,
        campaign_criterion.language.language_constant,
        campaign_criterion.location.geo_target_constant,
        campaign_criterion.negative
      FROM campaign_criterion
      WHERE campaign.status != 'REMOVED'
        AND campaign_criterion.type IN ('LANGUAGE', 'LOCATION')
        AND campaign_criterion.status != 'REMOVED'
    `

    const query5 = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.final_url_suffix,
        campaign_budget.amount_micros,
        campaign_budget.type,
        campaign.target_spend.cpc_bid_ceiling_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `

    googleAdsSyncLogger.info('sync_log', {
      message: String(`[GoogleAds Sync] Executing GAQL queries for customer ${customerId}...`),
    })

    // 执行五个查询（串行，间隔 1 秒，避免 API 限流）
    let results1: any[] = []
    let results2: any[] = []
    let results3: any[] = []
    let results4: any[] = []
    let results5: any[] = []

    if (authType === 'service_account') {
      // 查询 1
      const r1 = await executeGAQLQueryPython({
        userId,
        serviceAccountId,
        customerId,
        query: query1,
      })
      results1 = r1?.results || []

      // 等待 1 秒
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // 查询 2
      const r2 = await executeGAQLQueryPython({
        userId,
        serviceAccountId,
        customerId,
        query: query2,
      })
      results2 = r2?.results || []

      // 等待 1 秒
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // 查询 3
      const r3 = await executeGAQLQueryPython({
        userId,
        serviceAccountId,
        customerId,
        query: query3,
      })
      results3 = r3?.results || []

      // 等待 1 秒
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // 查询 4
      const r4 = await executeGAQLQueryPython({
        userId,
        serviceAccountId,
        customerId,
        query: query4,
      })
      results4 = r4?.results || []

      // 等待 1 秒
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // 查询 5
      const r5 = await executeGAQLQueryPython({
        userId,
        serviceAccountId,
        customerId,
        query: query5,
      })
      results5 = r5?.results || []
    } else {
      if (!oauthCredentials || !refreshToken) {
        throw new Error('OAuth 凭证不完整，无法同步广告系列')
      }

      const oauthQueryResults = await runOAuthGaqlWithLoginCustomerFallback({
        adsAccount: {
          customer_id: customerId,
          parent_mcc_id: parentMccId,
          id: googleAdsAccountId,
        },
        userId,
        refreshToken,
        oauthCredentials,
        oauthLoginCustomerId,
        authContext,
        actionName: `fetchCampaignsFromGoogleAds(${customerId})`,
        query: async (customer) => {
          const r1 = await trackOAuthApiCall(
            userId,
            customerId,
            ApiOperationType.SEARCH,
            '/api/google-ads/query',
            () => customer.query(query1)
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const r2 = await trackOAuthApiCall(
            userId,
            customerId,
            ApiOperationType.SEARCH,
            '/api/google-ads/query',
            () => customer.query(query2)
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const r3 = await trackOAuthApiCall(
            userId,
            customerId,
            ApiOperationType.SEARCH,
            '/api/google-ads/query',
            () => customer.query(query3)
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const r4 = await trackOAuthApiCall(
            userId,
            customerId,
            ApiOperationType.SEARCH,
            '/api/google-ads/query',
            () => customer.query(query4)
          )
          await new Promise((resolve) => setTimeout(resolve, 1000))
          const r5 = await trackOAuthApiCall(
            userId,
            customerId,
            ApiOperationType.SEARCH,
            '/api/google-ads/query',
            () => customer.query(query5)
          )
          return {
            results1: r1 || [],
            results2: r2 || [],
            results3: r3 || [],
            results4: r4 || [],
            results5: r5 || [],
          }
        },
      })

      results1 = oauthQueryResults.results1
      results2 = oauthQueryResults.results2
      results3 = oauthQueryResults.results3
      results4 = oauthQueryResults.results4
      results5 = oauthQueryResults.results5
    }

    googleAdsSyncLogger.info('sync_log', {
      message: String(
        `[GoogleAds Sync] Fetched ${results3.length} asset rows (CALLOUT/SITELINK) for customer ${customerId}`
      ),
      customerId,
      assetRowCount: results3.length,
    })

    // 在内存中处理数据，按 ID 分组
    const campaignMap = new Map<string, GoogleAdsCampaign>()
    const query1ByCampaign = new Map<string, any[]>()
    const query2ByCampaign = new Map<string, any[]>()
    const query3ByCampaign = new Map<string, any[]>()
    const query4ByCampaign = new Map<string, any[]>()
    const query5ByCampaign = new Map<string, any[]>()
    const adGroupsMap = new Map<string, any[]>() // key: ad_group_id
    const adsMap = new Map<string, any[]>() // key: ad_group_id
    const keywordsMap = new Map<string, any[]>() // key: ad_group_id
    const calloutsMap = new Map<string, any[]>() // key: campaign_id
    const sitelinksMap = new Map<string, any[]>() // key: campaign_id
    const locationsMap = new Map<string, any[]>() // key: campaign_id

    // 处理查询 5 结果（广告系列）
    for (const row of results5) {
      const campaignId = String(row.campaign?.id || '')
      if (campaignId) {
        const rows = query5ByCampaign.get(campaignId) || []
        rows.push(row)
        query5ByCampaign.set(campaignId, rows)
      }

      // 添加广告系列
      if (!campaignMap.has(campaignId)) {
        campaignMap.set(campaignId, {
          campaign_id: campaignId,
          campaign_name: row.campaign?.name || `Campaign_${campaignId}`,
          budget_amount: Number(row.campaign_budget?.amount_micros || 0) / 1000000,
          cpc_bid_ceiling_micros:
            Number(row.campaign?.target_spend?.cpc_bid_ceiling_micros || 0) / 1000000,
          budget_type: (row.campaign_budget?.type || 'DAILY') as 'DAILY' | 'TOTAL',
          status: (row.campaign?.status || 'PAUSED') as 'ENABLED' | 'PAUSED' | 'REMOVED',
          customer_id: customerId,
          final_url_suffix: row.campaign?.final_url_suffix || '',
        })
      }
    }

    // 处理查询 1 结果（广告组、广告）
    for (const row of results1) {
      const campaignId = String(row.campaign?.id || '')
      if (campaignId) {
        const rows = query1ByCampaign.get(campaignId) || []
        rows.push(row)
        query1ByCampaign.set(campaignId, rows)
      }

      // 添加广告组
      const adGroupId = String(row.ad_group?.id || '')
      if (adGroupId) {
        if (!adGroupsMap.has(adGroupId)) {
          adGroupsMap.set(adGroupId, [
            {
              ad_group_id: adGroupId,
              ad_group_name: row.ad_group?.name,
              final_url_suffix: row.ad_group?.final_url_suffix,
              campaign_id: campaignId,
            },
          ])
        }

        // 添加广告
        const adId = String(row.ad_group_ad?.ad?.id || '')
        if (adId) {
          const ads = adsMap.get(adGroupId) || []
          ads.push({
            ad_id: adId,
            ad_type: row.ad_group_ad?.ad?.type,
            headlines: row.ad_group_ad?.ad?.responsive_search_ad?.headlines,
            descriptions: row.ad_group_ad?.ad?.responsive_search_ad?.descriptions,
            final_urls: row.ad_group_ad?.ad?.final_urls,
            final_url_suffix: row.ad_group_ad?.ad?.final_url_suffix,
            name: row.ad_group_ad?.ad?.name,
          })
          adsMap.set(adGroupId, ads)
        }
      }
    }

    // 处理查询 2 结果（关键词）
    for (const row of results2) {
      const campaignId = String(row.campaign?.id || '')
      if (campaignId) {
        const rows = query2ByCampaign.get(campaignId) || []
        rows.push(row)
        query2ByCampaign.set(campaignId, rows)
      }

      const adGroupId = String(row.ad_group?.id || '')
      const keywordId = String(row.ad_group_criterion?.criterion_id || '')

      if (keywordId && row.ad_group_criterion?.keyword?.text) {
        const keywords = keywordsMap.get(adGroupId) || []
        keywords.push({
          keyword_id: keywordId,
          negative: row.ad_group_criterion?.negative || false,
          keyword_text: row.ad_group_criterion?.keyword?.text,
          keyword_match_type: row.ad_group_criterion?.keyword?.match_type,
        })
        keywordsMap.set(adGroupId, keywords)
      }
    }

    // 处理查询 3 结果（素材资源）
    for (const row of results3) {
      const campaignId = String(row.campaign?.id || '')
      const assetType = resolveCampaignExtensionAssetType(row)

      if (campaignId) {
        const rows = query3ByCampaign.get(campaignId) || []
        rows.push(row)
        query3ByCampaign.set(campaignId, rows)
      }

      if (assetType === 'CALLOUT' && row.asset?.callout_asset?.callout_text) {
        const callouts = calloutsMap.get(campaignId) || []
        callouts.push({ text: row.asset.callout_asset.callout_text })
        calloutsMap.set(campaignId, callouts)
      } else if (assetType === 'SITELINK' && row.asset?.sitelink_asset?.link_text) {
        const sitelinks = sitelinksMap.get(campaignId) || []
        sitelinks.push({
          text: row.asset?.sitelink_asset?.link_text || '',
          url: (row.asset?.final_urls ?? [])?.[0] || '',
          description1: row.asset?.sitelink_asset?.description1 || '',
          description2: row.asset?.sitelink_asset?.description2 || '',
        })
        sitelinksMap.set(campaignId, sitelinks)
      }
    }

    googleAdsSyncLogger.info('sync_log', {
      message: String(
        `[GoogleAds Sync] Aggregated assets for customer ${customerId}: callouts=${calloutsMap.size} campaigns, sitelinks=${sitelinksMap.size} campaigns`
      ),
      customerId,
    })

    // 处理查询 4 结果（定位）
    for (const row of results4) {
      googleAdsSyncLogger.info('sync_log', {
        message: String(
          `[GoogleAds Sync] Processing targeting criterion for campaign ${row.campaign?.id}: type=${row.campaign_criterion?.type}, display_name=${row.campaign_criterion?.display_name}`
        ),
      })
      googleAdsSyncLogger.info('sync_log', {
        message: String(
          `[GoogleAds Sync] Criterion details: language=${row.campaign_criterion?.language?.language_constant}, location=${row.campaign_criterion?.location?.geo_target_constant}, negative=${row.campaign_criterion?.negative}`
        ),
      })
      const campaignId = String(row.campaign?.id || '')
      if (campaignId) {
        const queryRows = query4ByCampaign.get(campaignId) || []
        queryRows.push(row)
        query4ByCampaign.set(campaignId, queryRows)

        const locations = locationsMap.get(campaignId) || []
        locations.push({
          criterion_id: row.campaign_criterion?.criterion_id,
          type: row.campaign_criterion?.type,
          display_name: row.campaign_criterion?.display_name,
          language: row.campaign_criterion?.language?.language_constant,
          location: row.campaign_criterion?.location?.geo_target_constant,
          negative: row.campaign_criterion?.negative,
        })
        locationsMap.set(campaignId, locations)
      }
    }

    // 聚合成完整的广告系列数据并返回
    const campaigns: any[] = []
    const auditRows: CampaignSyncAuditInsert[] = []

    for (const [campaignId, campaign] of campaignMap.entries()) {
      const adGroupId = Array.from(adGroupsMap.keys()).find(
        (key) => adGroupsMap.get(key)?.[0]?.campaign_id === campaignId
      )

      const adGroup = adGroupId ? adGroupsMap.get(adGroupId)?.[0] : null
      const ads = adGroupId ? adsMap.get(adGroupId) || [] : []
      const keywords = adGroupId ? keywordsMap.get(adGroupId) || [] : []
      const callouts = calloutsMap.get(campaignId) || []
      const sitelinks = sitelinksMap.get(campaignId) || []
      const locations = locationsMap.get(campaignId) || []

      // 提取否定关键词
      const negativeKeywords: string[] = []
      const negativeKeywordMatchType: any = {}
      for (const kw of keywords) {
        if (kw.negative) {
          negativeKeywords.push(kw.keyword_text)
          negativeKeywordMatchType[kw.keyword_text] = kw.keyword_match_type
        }
      }

      // 过滤正关键词
      const positiveKeywords = keywords
        .filter((kw) => !kw.negative)
        .map((kw) => ({
          text: kw.keyword_text,
          matchType: kw.keyword_match_type,
        }))

      // 构建广告系列对象
      const campaignPayload = {
        campaign,
        adGroupId: adGroup?.ad_group_id || null,
        adId: ads[0]?.ad_id || null,
        campaign_config: {
          campaignName: campaign.campaign_name,
          budgetAmount: campaign.budget_amount,
          budgetType: campaign.budget_type,
          targetCountry:
            resolveCountryCodeFromGoogleAdsGeoTargetId(
              locations
                .find((loc: any) => loc.type === 'LOCATION')
                ?.geo_target_constant?.split('/')
                ?.pop() ?? ''
            ) || 'US',
          targetLanguage:
            getLanguageName(locations.find((loc: any) => loc.type === 'LANGUAGE')?.display_name) ||
            'English',
          biddingStrategy: (campaign as any).bidding_strategy || 'MAXIMIZE_CLICKS',
          marketingObjective: 'WEB_TRAFFIC',
          finalUrlSuffix:
            ads[0]?.final_url_suffix ||
            adGroup?.final_url_suffix ||
            campaign?.final_url_suffix ||
            '',
          adGroupName: adGroup?.ad_group_name || '',
          maxCpcBid: campaign.cpc_bid_ceiling_micros,
          keywords: positiveKeywords,
          negativeKeywords: negativeKeywords,
          negativeKeywordMatchType: negativeKeywordMatchType,
          adName: ads[0]?.name || `RSA_${campaign.campaign_name}`,
          headlines: ads[0]?.headlines?.map((h: any) => h.text) || [],
          descriptions: ads[0]?.descriptions?.map((d: any) => d.text) || [],
          finalUrls: ads[0]?.final_urls || [],
          callouts: callouts.map((c: any) => c.text),
          sitelinks: sitelinks.map((s: any) => ({
            text: s.text,
            url: s.url,
            description1: s.description1,
            description2: s.description2,
          })),
        },
      }

      campaigns.push({
        ...campaignPayload,
      })

      const query1Rows = query1ByCampaign.get(campaignId) || []
      const query2Rows = query2ByCampaign.get(campaignId) || []
      const query3Rows = query3ByCampaign.get(campaignId) || []
      const query4Rows = query4ByCampaign.get(campaignId) || []
      const query5Rows = query5ByCampaign.get(campaignId) || []
      const adGroupIds = new Set(
        query1Rows.map((row: any) => String(row.ad_group?.id || '')).filter(Boolean)
      )
      const adIds = new Set(
        query1Rows.map((row: any) => String(row.ad_group_ad?.ad?.id || '')).filter(Boolean)
      )

      auditRows.push({
        userId,
        googleAdsAccountId,
        customerId,
        campaignId,
        campaignName: campaign.campaign_name,
        query1Rows: query1Rows.length,
        query2Rows: query2Rows.length,
        query3Rows: query3Rows.length,
        query4Rows: query4Rows.length,
        aggregatedAdGroups: adGroupIds.size,
        aggregatedAds: adIds.size,
        aggregatedKeywords: keywords.length,
        aggregatedCallouts: callouts.length,
        aggregatedSitelinks: sitelinks.length,
        aggregatedLocations: locations.length,
        auditPayload: {
          campaign_id: campaignId,
          customer_id: customerId,
          raw_data: {
            query1: query1Rows,
            query2: query2Rows,
            query3: query3Rows,
            query4: query4Rows,
            query5: query5Rows,
          },
        },
      })
    }

    if (enableAudit && auditRows.length > 0) {
      try {
        await saveCampaignSyncAuditRows(auditRows)
      } catch (error) {
        googleAdsSyncLogger.error('audit_persist_unexpected', {}, error)
      }
    }

    googleAdsSyncLogger.info('sync_log', {
      message: String(`[GoogleAds Sync] Aggregated ${campaigns.length} complete campaigns`),
    })

    return campaigns
  } catch (error: any) {
    googleAdsSyncLogger.error('fetch_failed', { customerId }, error)
    throw new Error(`获取广告数据失败：${error.message}`)
  }
}

export async function fetchCampaignsFromGoogleAds(params: {
  userId: number
  customerId: string
  googleAdsAccountId: number
  authType: string
  serviceAccountId?: string
  refreshToken: string | null
  parentMccId?: string | null
  oauthCredentials?: OAuthApiCredentialsFields
  oauthLoginCustomerId?: string
  authContext?: GoogleAdsAuthContext
  enableAudit?: boolean
}): Promise<any[]> {
  return await fetchAllDataFromGoogleAds(params)
}
