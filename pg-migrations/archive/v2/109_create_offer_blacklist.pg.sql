-- Migration: 109_create_offer_blacklist
-- Description: 创建Offer拉黑投放黑名单库（品牌+国家）
-- Date: 2025-12-25

CREATE TABLE IF NOT EXISTS offer_blacklist (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  brand TEXT NOT NULL,
  target_country TEXT NOT NULL,
  offer_id INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE,
  UNIQUE(user_id, brand, target_country)
);

CREATE INDEX IF NOT EXISTS idx_offer_blacklist_user ON offer_blacklist(user_id);
CREATE INDEX IF NOT EXISTS idx_offer_blacklist_brand_country ON offer_blacklist(brand, target_country);
