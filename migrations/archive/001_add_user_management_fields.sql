-- ==========================================
-- 迁移脚本：添加用户管理关键字段
-- 日期：2025-11-18
-- 描述：添加username、valid_from/until、must_change_password等字段以支持用户管理需求
-- ==========================================

-- 1. 添加username字段（用于动物名登录）
-- 注意:SQLite不允许直接添加带UNIQUE约束的列,我们使用唯一索引代替
ALTER TABLE users ADD COLUMN username TEXT;

-- 2. 添加套餐有效期字段
ALTER TABLE users ADD COLUMN valid_from TEXT NOT NULL DEFAULT (datetime('now'));
ALTER TABLE users ADD COLUMN valid_until TEXT NOT NULL DEFAULT (datetime('now', '+365 days'));

-- 3. 添加首次修改密码标志
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 1;

-- 4. 添加用户创建者追踪
ALTER TABLE users ADD COLUMN created_by INTEGER REFERENCES users(id);

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
