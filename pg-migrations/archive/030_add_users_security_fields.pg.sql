-- Migration: Add security fields to users table
-- Created: 2024-12-03
-- Description: 添加登录失败计数、账户锁定和最后失败登录时间字段

-- PostgreSQL version
-- =====================================================

-- 1. 添加 failed_login_count 列（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'failed_login_count') THEN
        
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'failed_login_count') THEN
    
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'failed_login_count') THEN
    ALTER TABLE users ADD COLUMN failed_login_count BOOLEAN NOT NULL DEFAULT FALSE;
    RAISE NOTICE '✅ 添加 failed_login_count 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  failed_login_count 字段已存在于 users';
  END IF;
END $$;
    RAISE NOTICE '✅ 添加 failed_login_count 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  failed_login_count 字段已存在于 users';
  END IF;
END $$;
    END IF;
END $$;

-- 2. 添加 locked_until 列（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locked_until') THEN
        
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locked_until') THEN
    ALTER TABLE users ADD COLUMN locked_until TIMESTAMP DEFAULT NULL;
    RAISE NOTICE '✅ 添加 locked_until 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  locked_until 字段已存在于 users';
  END IF;
END $$;
    END IF;
END $$;

-- 3. 添加 last_failed_login 列（如果不存在）
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_failed_login') THEN
        
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_failed_login') THEN
    ALTER TABLE users ADD COLUMN last_failed_login TIMESTAMP DEFAULT NULL;
    RAISE NOTICE '✅ 添加 last_failed_login 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  last_failed_login 字段已存在于 users';
  END IF;
END $$;
    END IF;
END $$;

-- 4. 创建索引以优化锁定状态查询
CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until);
CREATE INDEX IF NOT EXISTS idx_users_failed_login_count ON users(failed_login_count);


-- SQLite version
-- =====================================================
-- Note: SQLite handles ALTER TABLE differently

-- 1. 添加 failed_login_count 列
-- ALTER TABLE users ADD COLUMN failed_login_count BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. 添加 locked_until 列
-- 
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'locked_until') THEN
    ALTER TABLE users ADD COLUMN locked_until TEXT DEFAULT NULL;
    RAISE NOTICE '✅ 添加 locked_until 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  locked_until 字段已存在于 users';
  END IF;
END $$;

-- 3. 添加 last_failed_login 列
-- 
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'last_failed_login') THEN
    ALTER TABLE users ADD COLUMN last_failed_login TEXT DEFAULT NULL;
    RAISE NOTICE '✅ 添加 last_failed_login 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  last_failed_login 字段已存在于 users';
  END IF;
END $$;

-- 4. 创建索引
-- CREATE INDEX IF NOT EXISTS idx_users_locked_until ON users(locked_until);
-- CREATE INDEX IF NOT EXISTS idx_users_failed_login_count ON users(failed_login_count);


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('030_add_users_security_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
