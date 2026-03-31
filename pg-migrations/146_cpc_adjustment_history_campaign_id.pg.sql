-- Add campaign_id to cpc_adjustment_history for faster per-campaign lookups
ALTER TABLE cpc_adjustment_history ADD COLUMN campaign_id INTEGER;

-- Index to speed up per-campaign history queries
CREATE INDEX IF NOT EXISTS idx_cpc_history_user_campaign_created
ON cpc_adjustment_history(user_id, campaign_id, created_at DESC);
