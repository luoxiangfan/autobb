-- Migration: 173_affiliate_commission_attributions.sql
-- Date: 2026-02-09
-- Description: 新增联盟佣金归因表（按用户/日期关联到 Offer 和 Campaign）

CREATE TABLE IF NOT EXISTS affiliate_commission_attributions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  platform TEXT NOT NULL,
  source_order_id TEXT,
  source_mid TEXT,
  source_asin TEXT,
  offer_id INTEGER,
  campaign_id INTEGER,
  commission_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE SET NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_aca_user_date
  ON affiliate_commission_attributions(user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_aca_offer_date
  ON affiliate_commission_attributions(user_id, offer_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_aca_campaign_date
  ON affiliate_commission_attributions(user_id, campaign_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_aca_source
  ON affiliate_commission_attributions(user_id, platform, source_mid, source_asin, report_date DESC);
