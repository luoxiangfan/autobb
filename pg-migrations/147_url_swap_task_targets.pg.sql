-- Migration: 147_url_swap_task_targets.pg.sql
-- Description: url_swap_tasks多目标支持（任务目标表）
-- Date: 2026-01-29
-- Database: PostgreSQL

CREATE TABLE IF NOT EXISTS url_swap_task_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES url_swap_tasks(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  google_ads_account_id INTEGER NOT NULL REFERENCES google_ads_accounts(id) ON DELETE CASCADE,
  google_customer_id TEXT NOT NULL,
  google_campaign_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_success_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_url_swap_task_targets_task_id
  ON url_swap_task_targets(task_id);

CREATE INDEX IF NOT EXISTS idx_url_swap_task_targets_offer_id
  ON url_swap_task_targets(offer_id);

CREATE INDEX IF NOT EXISTS idx_url_swap_task_targets_account
  ON url_swap_task_targets(google_ads_account_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_url_swap_task_targets_unique
  ON url_swap_task_targets(task_id, google_ads_account_id, google_campaign_id);
