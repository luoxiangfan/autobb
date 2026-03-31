-- Migration: 206_create_intent_analysis.sql
-- Description: Create search_term_intent_analysis table for dashboard insights (Phase 3)
-- Date: 2026-03-11
-- Database: PostgreSQL

-- This table tracks intent analysis of search terms for dashboard insights
-- Optional/future enhancement - not required for core functionality

CREATE TABLE IF NOT EXISTS search_term_intent_analysis (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  offer_id INTEGER,
  search_term TEXT NOT NULL,
  extracted_intent TEXT,                    -- The underlying user question
  intent_category TEXT,                     -- comparison/problem_solving/feature_seeking/price_sensitive
  matched_scenario TEXT,                    -- Which offer scenario this maps to
  scenario_match_score REAL,                -- 0-1 confidence
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  analyzed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_search_term_intent_offer ON search_term_intent_analysis(offer_id);
CREATE INDEX IF NOT EXISTS idx_search_term_intent_category ON search_term_intent_analysis(intent_category);
CREATE INDEX IF NOT EXISTS idx_search_term_intent_user ON search_term_intent_analysis(user_id);
