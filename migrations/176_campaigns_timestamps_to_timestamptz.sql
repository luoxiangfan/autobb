-- Migration: 176_campaigns_timestamps_to_timestamptz.sql
-- Date: 2026-02-12
-- Description: SQLite 占位迁移（时间字段在 SQLite 中保持现有存储策略）

-- SQLite 动态类型与现有兼容层无需执行结构变更。
-- 保留同编号迁移以维持跨数据库迁移序列一致性。
SELECT 1;
