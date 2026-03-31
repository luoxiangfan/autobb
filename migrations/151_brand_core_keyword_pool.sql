-- Migration 151: add brand global core keyword pool tables (SQLite)

CREATE TABLE IF NOT EXISTS brand_core_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_key TEXT NOT NULL,
  brand_display TEXT,
  target_country TEXT NOT NULL,
  target_language TEXT NOT NULL,
  keyword_norm TEXT NOT NULL,
  keyword_display TEXT,
  source_mask TEXT NOT NULL,
  impressions_total INTEGER NOT NULL DEFAULT 0,
  clicks_total INTEGER NOT NULL DEFAULT 0,
  last_seen_at TEXT,
  search_volume INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
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
  date TEXT NOT NULL,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  source_mask TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (brand_key, target_country, target_language, keyword_norm, date)
);

CREATE INDEX IF NOT EXISTS idx_brand_core_daily_date
  ON brand_core_keyword_daily (date);
