-- Migration: 260_url_swap_sitelink_targets
-- Description: Sitelink Asset 映射表（Campaign + Sitelink 联动换链 P0）

CREATE TABLE IF NOT EXISTS url_swap_sitelink_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES url_swap_tasks(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  sort_index SMALLINT NOT NULL,
  affiliate_link TEXT NOT NULL,

  google_ads_account_id INTEGER NOT NULL REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  google_customer_id TEXT NOT NULL,
  google_campaign_id TEXT NOT NULL,
  asset_resource_name TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  link_text TEXT NOT NULL,

  current_final_url TEXT,
  current_final_url_suffix TEXT,

  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMP,
  last_error TEXT,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT uq_url_swap_sitelink_task_index UNIQUE (task_id, sort_index),
  CONSTRAINT uq_url_swap_sitelink_task_asset UNIQUE (task_id, asset_resource_name)
);

CREATE INDEX IF NOT EXISTS idx_url_swap_sitelink_targets_task
  ON url_swap_sitelink_targets (task_id, status);

CREATE INDEX IF NOT EXISTS idx_url_swap_sitelink_targets_offer
  ON url_swap_sitelink_targets (offer_id, status);

COMMENT ON TABLE url_swap_sitelink_targets IS '换链接任务 Sitelink Asset 目标（store_product_links 映射）';
