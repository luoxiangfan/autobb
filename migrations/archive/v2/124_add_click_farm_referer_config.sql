-- Migration: 123_add_click_farm_referer_config.sql
-- Description: 为click_farm_tasks表添加referer_config字段，支持防爬优化
-- Author: AutoBB
-- Date: 2025-12-30
-- Database: SQLite
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
PRAGMA table_info(click_farm_tasks);

-- 添加referer_config字段（JSON格式存储配置）
-- 类型: TEXT (存储JSON字符串)
-- 默认值: NULL (向后兼容)
ALTER TABLE click_farm_tasks ADD COLUMN referer_config TEXT DEFAULT NULL;

-- ==========================================
-- Step 2: 创建索引优化查询
-- ==========================================

-- 为referer_config创建索引（可选，用于按配置筛选任务）
CREATE INDEX IF NOT EXISTS idx_click_farm_tasks_referer_config
ON click_farm_tasks(referer_config);

-- ==========================================
-- Step 3: 数据验证
-- ==========================================

-- 统计现有任务数量
SELECT '总任务数' as metric, COUNT(*) as count FROM click_farm_tasks;

-- 统计有referer_config的任务数
SELECT '已配置Referer的任务数' as metric, COUNT(*) as count
FROM click_farm_tasks
WHERE referer_config IS NOT NULL;

-- ==========================================
-- Step 4: 验证迁移结果
-- ==========================================

SELECT 'SUCCESS: Migration 123 completed' as result,
       (SELECT COUNT(*) FROM click_farm_tasks) as total_tasks,
       (SELECT COUNT(*) FROM click_farm_tasks WHERE referer_config IS NOT NULL) as tasks_with_referer_config;
