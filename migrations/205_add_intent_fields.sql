-- Migration: 205_add_intent_fields.sql
-- Description: Add intent-driven optimization fields to offers table
-- Date: 2026-03-11
-- Database: SQLite

-- Add intent-driven optimization fields
-- These fields store auto-extracted scenarios, pain points, and user questions from review_analysis
-- Graceful degradation: If review_analysis is null, these fields remain null and system falls back to keyword-only mode

ALTER TABLE offers ADD COLUMN user_scenarios TEXT;           -- JSON: [{scenario, frequency, keywords, source}]
ALTER TABLE offers ADD COLUMN pain_points TEXT;              -- JSON: [string]
ALTER TABLE offers ADD COLUMN user_questions TEXT;           -- JSON: [{question, priority, category}]
ALTER TABLE offers ADD COLUMN scenario_analyzed_at TEXT;     -- Timestamp of last scenario extraction
