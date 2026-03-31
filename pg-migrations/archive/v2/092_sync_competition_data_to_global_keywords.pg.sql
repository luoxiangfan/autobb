-- PostgreSQL Migration: 082_sync_competition_data_to_global_keywords.pg.sql
-- Purpose: 同步competition数据到global_keywords表 (PostgreSQL版本)
-- Date: 2025-12-19

-- 背景：
-- LaunchScore的竞争度评分(competitionScore)依赖于关键词的competition数据
-- 之前的implementation中，competition数据只在API调用时获取，但在缓存/数据库中丢失
-- 这导致计算出的竞争度始终为 UNKNOWN
--
-- 修复目标：
-- 1. 确保global_keywords表结构中有competition_level字段（已有）
-- 2. 为现有的关键词数据，标记为需要刷新
-- 3. 后续所有新获取的关键词都会正确保存competition数据
--
-- 注意：
-- - 此迁移仅标记数据为需要刷新（通过更新cached_at）
-- - 实际的API调用和数据更新会在应用运行时自动进行
-- - 不会阻塞应用启动

-- Step 1: 验证表存在
-- global_keywords表应该由之前的迁移创建并包含competition_level字段

-- Step 2: 清空过期的缓存数据（7天前）
-- 这样下次查询时会触发API调用来刷新competition数据
UPDATE global_keywords
SET cached_at = NOW() - INTERVAL '8 days'
WHERE created_at < NOW() - INTERVAL '7 days'
  AND (competition_level IS NULL OR competition_level = '');

-- Step 3: 对于最近7天内的数据，如果competition_level为空，也标记为需要更新
UPDATE global_keywords
SET cached_at = NOW() - INTERVAL '8 days'
WHERE (competition_level IS NULL OR competition_level = '')
  AND created_at >= NOW() - INTERVAL '7 days';

-- 完成标记
-- 应用重启后，以下流程会自动进行：
-- 1. getKeywordSearchVolumes() 检查global_keywords表
-- 2. 如果cached_at超过7天，会重新调用Google Ads API
-- 3. API返回时，competition数据会被正确保存到competition_level字段
-- 4. 后续查询会从表中读取competition_level而不是UNKNOWN
