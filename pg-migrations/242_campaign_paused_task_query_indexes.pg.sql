-- Migration: 242_campaign_paused_task_query_indexes.pg.sql
-- Purpose: speed up paused campaign task check query
-- Created: 2026-05-14

CREATE INDEX IF NOT EXISTS idx_campaigns_status_deleted_user_offer
  ON campaigns(status, is_deleted, user_id, offer_id);
