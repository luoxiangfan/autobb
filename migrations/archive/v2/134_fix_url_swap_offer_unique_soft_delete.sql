-- Migration: 134_fix_url_swap_offer_unique_soft_delete
-- Description: 修复url_swap_tasks的offer_id唯一约束与软删除/完成态冲突
-- SQLite版本
--
-- 背景：
-- - 现有表内 CONSTRAINT uq_url_swap_offer UNIQUE(offer_id) 会导致：
--   1) 任务软删除后仍无法为同一Offer重新创建任务（offer_id仍占用）
--   2) 任务完成后（status=completed），逻辑允许创建但数据库仍会因唯一约束失败
--
-- 目标：
-- - 将唯一性约束调整为“仅对未删除且未完成任务生效”的部分唯一索引
-- - 保留历史记录（已删除/已完成任务可保留）

PRAGMA foreign_keys = OFF;

-- ⚠️ SQLite 在执行部分 DDL（如 DROP TABLE/ALTER TABLE RENAME）时会触发 schema reload，
-- 如果数据库中存在“已损坏的视图”（视图定义引用了不存在的列），可能导致本迁移失败。
-- 这些 v_*_boolean_integrity 视图仅用于诊断，不影响核心业务；这里先删除以确保迁移可执行。
DROP VIEW IF EXISTS v_offers_boolean_integrity;
DROP VIEW IF EXISTS v_campaigns_boolean_integrity;
DROP VIEW IF EXISTS v_google_ads_accounts_boolean_integrity;
DROP VIEW IF EXISTS v_prompt_versions_boolean_integrity;
DROP VIEW IF EXISTS v_system_settings_boolean_integrity;

-- 防御：清理残留临时表（避免手工重复执行时失败）
DROP TABLE IF EXISTS url_swap_tasks_new;

-- 1) 重建表结构：移除表级 UNIQUE(offer_id) 约束
CREATE TABLE url_swap_tasks_new (
  -- === 基础信息 ===
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id INTEGER NOT NULL,
  offer_id INTEGER NOT NULL,

  -- === 任务配置 ===
  swap_interval_minutes INTEGER NOT NULL DEFAULT 5,
  enabled BOOLEAN DEFAULT TRUE,
  duration_days INTEGER NOT NULL DEFAULT 7,

  -- === Google Ads关联 ===
  google_customer_id TEXT,
  google_campaign_id TEXT,

  -- === 当前生效的URL ===
  current_final_url TEXT,
  current_final_url_suffix TEXT,

  -- === 实时统计 ===
  progress INTEGER DEFAULT 0,
  total_swaps INTEGER DEFAULT 0,
  success_swaps INTEGER DEFAULT 0,
  failed_swaps INTEGER DEFAULT 0,
  url_changed_count INTEGER DEFAULT 0,

  -- === 历史数据 ===
  swap_history TEXT DEFAULT '[]',

  -- === 状态管理 ===
  status TEXT NOT NULL DEFAULT 'enabled',
  error_message TEXT,
  error_at TEXT,

  -- === 调度时间 ===
  started_at TEXT,
  completed_at TEXT,
  next_swap_at TEXT,

  -- === 软删除 ===
  is_deleted INTEGER DEFAULT 0,
  deleted_at TEXT,

  -- === 时间戳 ===
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),

  -- === 连续失败 ===
  consecutive_failures INTEGER DEFAULT 0,

  -- === 外键约束 ===
  FOREIGN KEY (offer_id) REFERENCES offers(id) ON DELETE CASCADE
);

-- 2) 迁移数据
INSERT INTO url_swap_tasks_new (
  id, user_id, offer_id,
  swap_interval_minutes, enabled, duration_days,
  google_customer_id, google_campaign_id,
  current_final_url, current_final_url_suffix,
  progress, total_swaps, success_swaps, failed_swaps, url_changed_count,
  swap_history,
  status, error_message, error_at,
  started_at, completed_at, next_swap_at,
  is_deleted, deleted_at,
  created_at, updated_at,
  consecutive_failures
)
SELECT
  id, user_id, offer_id,
  swap_interval_minutes, enabled, duration_days,
  google_customer_id, google_campaign_id,
  current_final_url, current_final_url_suffix,
  progress, total_swaps, success_swaps, failed_swaps, url_changed_count,
  swap_history,
  status, error_message, error_at,
  started_at, completed_at, next_swap_at,
  is_deleted, deleted_at,
  created_at, updated_at,
  consecutive_failures
FROM url_swap_tasks;

-- 3) 替换旧表
DROP TABLE url_swap_tasks;
ALTER TABLE url_swap_tasks_new RENAME TO url_swap_tasks;

-- 4) 重建索引
CREATE INDEX IF NOT EXISTS idx_url_swap_user_status
  ON url_swap_tasks(user_id, status);

CREATE INDEX IF NOT EXISTS idx_url_swap_scheduled
  ON url_swap_tasks(next_swap_at, started_at)
  WHERE status = 'enabled';

CREATE INDEX IF NOT EXISTS idx_url_swap_created
  ON url_swap_tasks(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_url_swap_offer
  ON url_swap_tasks(offer_id);

CREATE INDEX IF NOT EXISTS idx_url_swap_status
  ON url_swap_tasks(status);

-- 5) 创建部分唯一索引：仅约束未删除且未完成的记录
CREATE UNIQUE INDEX IF NOT EXISTS uq_url_swap_offer_active
  ON url_swap_tasks(offer_id)
  WHERE is_deleted = 0 AND status != 'completed';

PRAGMA foreign_keys = ON;
