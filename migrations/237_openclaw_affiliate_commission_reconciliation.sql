-- Migration: 237_openclaw_affiliate_commission_reconciliation.sql
-- Date: 2026-05-09
-- Description: 联盟佣金日维度对账快照（API 汇总 vs 入库条目 vs 归因/失败）

CREATE TABLE IF NOT EXISTS openclaw_affiliate_commission_reconciliation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  report_date TEXT NOT NULL,
  platform TEXT NOT NULL,
  api_total REAL NOT NULL DEFAULT 0,
  entries_sum REAL NOT NULL DEFAULT 0,
  attributed_sum REAL NOT NULL DEFAULT 0,
  failure_sum REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  delta_entries_vs_api REAL NOT NULL DEFAULT 0,
  delta_pipeline REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (user_id, report_date, platform)
);

CREATE INDEX IF NOT EXISTS idx_oc_acr_user_date
  ON openclaw_affiliate_commission_reconciliation(user_id, report_date DESC);

CREATE INDEX IF NOT EXISTS idx_oc_acr_user_platform_date
  ON openclaw_affiliate_commission_reconciliation(user_id, platform, report_date DESC);
