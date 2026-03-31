-- ==========================================
-- 迁移脚本：添加用户管理关键字段
-- 日期：2025-11-18
-- 描述：添加username、valid_from/until、must_change_password等字段以支持用户管理需求
-- ==========================================

-- 1. 添加username字段（用于动物名登录）
-- 注意:SQLite不允许直接添加带UNIQUE约束的列,我们使用唯一索引代替

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username') THEN
    ALTER TABLE users ADD COLUMN username TEXT;
    RAISE NOTICE '✅ 添加 username 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  username 字段已存在于 users';
  END IF;
END $$;

-- 2. 添加套餐有效期字段

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'valid_from') THEN
    ALTER TABLE users ADD COLUMN valid_from TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP);
    RAISE NOTICE '✅ 添加 valid_from 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  valid_from 字段已存在于 users';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'valid_until') THEN
    ALTER TABLE users ADD COLUMN valid_until TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP);
    RAISE NOTICE '✅ 添加 valid_until 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  valid_until 字段已存在于 users';
  END IF;
END $$;

-- 3. 添加首次修改密码标志

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'must_change_password') THEN
    ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1;
    RAISE NOTICE '✅ 添加 must_change_password 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  must_change_password 字段已存在于 users';
  END IF;
END $$;

-- 4. 添加用户创建者追踪

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'created_by') THEN
    ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id);
    RAISE NOTICE '✅ 添加 created_by 字段到 users';
  ELSE
    RAISE NOTICE '⏭️  created_by 字段已存在于 users';
  END IF;
END $$;

-- 5. 创建username唯一索引(实现UNIQUE约束 + 提升查询性能)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;

-- 6. 为管理员设置must_change_password为0（如果已有管理员）
UPDATE users SET must_change_password = 0 WHERE role = 'admin';

-- 迁移说明：
-- - username可为NULL，因为现有用户暂时还没有username
-- - valid_from默认为当前时间
-- - valid_until默认为1年后（试用用户）
-- - must_change_password默认为1（需要修改密码），管理员除外
-- - created_by用于记录用户是由哪个管理员创建的


-- 记录迁移历史
INSERT INTO migration_history (migration_name)
VALUES ('001_add_user_management_fields.pg')
ON CONFLICT (migration_name) DO NOTHING;
