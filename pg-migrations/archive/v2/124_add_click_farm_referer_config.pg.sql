-- Migration: 123_add_click_farm_referer_config.pg.sql
-- Description: 为click_farm_tasks表添加referer_config字段，支持防爬优化
-- Author: AutoBB
-- Date: 2025-12-30
-- Database: PostgreSQL
-- Priority: P1 - 功能必需

-- ==========================================
-- 背景
-- ==========================================
-- 新增补点击任务的Referer配置功能，用于：
-- 1. 防止反爬机制识别
-- 2. 模拟真实用户来源
-- 3. 支持多种Referer策略（留空/随机/固定）

-- ==========================================
-- Step 1: 添加referer_config字段
-- ==========================================

-- 检查字段是否已存在
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'click_farm_tasks'
    AND column_name = 'referer_config'
  ) THEN
    ALTER TABLE click_farm_tasks ADD COLUMN referer_config TEXT DEFAULT NULL;
    RAISE NOTICE '添加referer_config字段成功';
  ELSE
    RAISE NOTICE 'referer_config字段已存在，跳过添加';
  END IF;
END $$;

-- ==========================================
-- Step 2: 创建索引优化查询
-- ==========================================

-- 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_click_farm_tasks_referer_config
ON click_farm_tasks(referer_config);

-- ==========================================
-- Step 3: 数据验证
-- ==========================================

DO $$
DECLARE
  total_tasks INTEGER;
  tasks_with_config INTEGER;
BEGIN
  -- 统计现有任务数量
  SELECT COUNT(*) INTO total_tasks FROM click_farm_tasks;
  RAISE NOTICE '总任务数: %', total_tasks;

  -- 统计有referer_config的任务数
  SELECT COUNT(*) INTO tasks_with_config
  FROM click_farm_tasks
  WHERE referer_config IS NOT NULL;
  RAISE NOTICE '已配置Referer的任务数: %', tasks_with_config;
END $$;

-- ==========================================
-- Step 4: 验证迁移结果
-- ==========================================

DO $$
DECLARE
  total_tasks INTEGER;
  tasks_with_config INTEGER;
BEGIN
  SELECT COUNT(*) INTO total_tasks FROM click_farm_tasks;
  SELECT COUNT(*) INTO tasks_with_config
  FROM click_farm_tasks
  WHERE referer_config IS NOT NULL;

  RAISE NOTICE '========================================';
  RAISE NOTICE 'SUCCESS: Migration 123 completed';
  RAISE NOTICE '总任务数: %', total_tasks;
  RAISE NOTICE '已配置Referer的任务数: %', tasks_with_config;
  RAISE NOTICE '========================================';
END $$;
