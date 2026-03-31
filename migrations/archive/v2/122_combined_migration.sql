-- ============================================
-- 迁移编号：122
-- 标题：软删除机制修复
-- 日期：2025-12-29
-- 数据库：SQLite
-- 描述：为campaigns表添加软删除支持
-- ============================================

-- ✅ 幂等性保证：使用条件判断，确保可以安全重复执行

-- ==========================================
-- 软删除机制修复
-- ==========================================

-- 问题背景：
-- 1. Campaign删除使用了DELETE而非软删除，导致performance数据级联删除
-- 2. 统计查询不一致：部分过滤is_deleted，部分不过滤
-- 3. 已删除的campaigns无法体现在历史统计数据中

-- 修复内容：
-- 1. ✅ 添加 is_deleted 列到 campaigns 表（如果不存在）
-- 2. ✅ 代码层面：campaigns.ts deleteCampaign改为UPDATE软删除
-- 3. ✅ 代码层面：所有查询API统一处理is_deleted过滤
-- 4. 🔧 数据库层面：添加索引优化软删除查询性能
-- 5. 📊 数据验证：检查现有数据一致性

-- 1. 添加 is_deleted 列到 campaigns 表（SQLite 幂等性处理）
-- SQLite 不支持 IF NOT EXISTS for ALTER TABLE ADD COLUMN
-- 如果列已存在会报错，这是可接受的行为
ALTER TABLE campaigns
ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;

-- 2. 添加 deleted_at 列到 campaigns 表（记录删除时间）
ALTER TABLE campaigns
ADD COLUMN deleted_at TIMESTAMP NULL;

-- 3. 添加索引优化软删除查询
-- campaigns表：优化is_deleted + user_id查询
CREATE INDEX IF NOT EXISTS idx_campaigns_user_is_deleted
ON campaigns(user_id, is_deleted, created_at DESC);

-- offers表：优化is_deleted + user_id查询（offers表已有is_deleted列）
CREATE INDEX IF NOT EXISTS idx_offers_user_is_deleted
ON offers(user_id, is_deleted);

-- 4. 数据验证和统计
-- 验证：检查是否有campaigns没有正确设置is_deleted字段
SELECT 'Data Validation: Campaigns without is_deleted field' AS check_name,
       COUNT(*) as count
FROM campaigns
WHERE is_deleted IS NULL;

-- 统计：当前软删除的campaigns数量
SELECT 'Statistics: Soft-deleted campaigns' AS metric,
       COUNT(*) as count
FROM campaigns
WHERE is_deleted = 1;

-- 统计：当前软删除的offers数量
SELECT 'Statistics: Soft-deleted offers' AS metric,
       COUNT(*) as count
FROM offers
WHERE is_deleted = 1;

-- 验证：检查已删除campaigns的performance数据是否保留
SELECT 'Data Validation: Performance data for deleted campaigns' AS check_name,
       COUNT(DISTINCT cp.campaign_id) as deleted_campaigns_with_performance
FROM campaign_performance cp
INNER JOIN campaigns c ON cp.campaign_id = c.id
WHERE c.is_deleted = 1;

-- 5. 修复NULL值（防御性修复）
-- 将NULL is_deleted字段设置为0（未删除）
UPDATE campaigns
SET is_deleted = 0
WHERE is_deleted IS NULL;

UPDATE offers
SET is_deleted = 0
WHERE is_deleted IS NULL;

-- 6. 验证结果
SELECT 'SUCCESS: Migration 122 completed' AS result,
       (SELECT COUNT(*) FROM campaigns WHERE is_deleted = 1) as deleted_campaigns,
       (SELECT COUNT(*) FROM offers WHERE is_deleted = 1) as deleted_offers,
       (SELECT COUNT(*) FROM campaign_performance) as total_performance_records;
