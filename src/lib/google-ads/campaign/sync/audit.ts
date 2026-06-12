import { getDatabase } from '../../../db'
import type { CampaignSyncAuditInsert } from './types'

import { googleAdsSyncLogger } from '../../common/logger'

export async function saveCampaignSyncAuditRows(rows: CampaignSyncAuditInsert[]): Promise<void> {
  try {
    const db = await getDatabase()

    for (const row of rows) {
      try {
        await db.exec(
          `INSERT INTO google_ads_campaign_sync_audits (
            user_id,
            google_ads_account_id,
            customer_id,
            campaign_id,
            campaign_name,
            query1_rows,
            query2_rows,
            query3_rows,
            query4_rows,
            aggregated_ad_groups,
            aggregated_ads,
            aggregated_keywords,
            aggregated_callouts,
            aggregated_sitelinks,
            aggregated_locations,
            audit_payload,
            synced_at,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(user_id, customer_id, campaign_id) DO UPDATE SET
            google_ads_account_id = excluded.google_ads_account_id,
            campaign_name = excluded.campaign_name,
            query1_rows = excluded.query1_rows,
            query2_rows = excluded.query2_rows,
            query3_rows = excluded.query3_rows,
            query4_rows = excluded.query4_rows,
            aggregated_ad_groups = excluded.aggregated_ad_groups,
            aggregated_ads = excluded.aggregated_ads,
            aggregated_keywords = excluded.aggregated_keywords,
            aggregated_callouts = excluded.aggregated_callouts,
            aggregated_sitelinks = excluded.aggregated_sitelinks,
            aggregated_locations = excluded.aggregated_locations,
            audit_payload = excluded.audit_payload,
            synced_at = excluded.synced_at`,
          [
            row.userId,
            row.googleAdsAccountId,
            row.customerId,
            row.campaignId,
            row.campaignName,
            row.query1Rows,
            row.query2Rows,
            row.query3Rows,
            row.query4Rows,
            row.aggregatedAdGroups,
            row.aggregatedAds,
            row.aggregatedKeywords,
            row.aggregatedCallouts,
            row.aggregatedSitelinks,
            row.aggregatedLocations,
            row.auditPayload,
            new Date(),
            new Date(),
          ]
        )
      } catch (error) {
        googleAdsSyncLogger.error('audit_row_persist_failed', { campaignId: row.campaignId }, error)
      }
    }
  } catch (error) {
    googleAdsSyncLogger.error('audit_persist_init_failed', {}, error)
  }
}
