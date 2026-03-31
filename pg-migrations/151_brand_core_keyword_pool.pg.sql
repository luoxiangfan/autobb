-- Migration 151: add brand global core keyword pool tables (PostgreSQL)

CREATE TABLE IF NOT EXISTS brand_core_keywords (
  id SERIAL PRIMARY KEY,
  brand_key TEXT NOT NULL,
  brand_display TEXT,
  target_country TEXT NOT NULL,
  target_language TEXT NOT NULL,
  keyword_norm TEXT NOT NULL,
  keyword_display TEXT,
  source_mask TEXT NOT NULL,
  impressions_total INTEGER NOT NULL DEFAULT 0,
  clicks_total INTEGER NOT NULL DEFAULT 0,
  last_seen_at DATE,
  search_volume INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_key, target_country, target_language, keyword_norm)
);

CREATE INDEX IF NOT EXISTS idx_brand_core_lookup
  ON brand_core_keywords (brand_key, target_country, target_language);

CREATE INDEX IF NOT EXISTS idx_brand_core_last_seen
  ON brand_core_keywords (brand_key, last_seen_at);

CREATE TABLE IF NOT EXISTS brand_core_keyword_daily (
  brand_key TEXT NOT NULL,
  target_country TEXT NOT NULL,
  target_language TEXT NOT NULL,
  keyword_norm TEXT NOT NULL,
  date DATE NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  source_mask TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (brand_key, target_country, target_language, keyword_norm, date)
);

CREATE INDEX IF NOT EXISTS idx_brand_core_daily_date
  ON brand_core_keyword_daily (date);
