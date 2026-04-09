-- 修复 google_ads_accounts 服务账号外键约束
-- 添加 ON DELETE CASCADE，删除服务账号时自动清理关联账户

-- PostgreSQL
DO $$
BEGIN
  -- 先删除原有约束
  ALTER TABLE google_ads_accounts 
    DROP CONSTRAINT IF EXISTS google_ads_accounts_service_account_id_fkey;
  
  -- 重新添加带 CASCADE 的约束
  ALTER TABLE google_ads_accounts
    ADD CONSTRAINT google_ads_accounts_service_account_id_fkey
    FOREIGN KEY (service_account_id)
    REFERENCES google_ads_service_accounts(id)
    ON DELETE CASCADE
    ON UPDATE CASCADE;
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'Table google_ads_accounts does not exist, skipping';
  WHEN undefined_object THEN
    RAISE NOTICE 'Constraint does not exist, continuing';
END $$;

-- SQLite (SQLite 不支持修改外键约束，需要重建表)
-- 注意：SQLite 的外键约束在表创建时定义，无法动态修改
-- 如果需要支持 SQLite，需要手动处理删除逻辑
