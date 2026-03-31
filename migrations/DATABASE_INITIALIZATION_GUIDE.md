# 数据库初始化指南 (Database Initialization Guide)

AutoAds项目的完整数据库初始化和管理指南。

---

## 📚 目录

1. [快速开始](#快速开始)
2. [环境配置](#环境配置)
3. [本地开发（SQLite）](#本地开发sqlite)
4. [生产环境（PostgreSQL）](#生产环境postgresql)
5. [Schema验证](#schema验证)
6. [常见问题](#常见问题)
7. [迁移说明](#迁移说明)

---

## 🚀 快速开始

### 首次setup（本地开发）

```bash
# 1. 克隆项目
git clone <repository-url>
cd autobb

# 2. 安装依赖
npm install

# 3. 创建数据库目录
mkdir -p data

# 4. 初始化SQLite数据库
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql

# 4.1 可选：验证增量迁移应为空（初始化脚本已包含并写入 migration_history）
npm run db:migrate

# 5. 验证初始化
npm run validate-schema

# 6. 启动开发服务器
npm run dev
```

完成！数据库已就绪，包含：
- ✅ 40个业务表
- ✅ 89+个性能优化索引
- ✅ 12组AI Prompt模板（70个版本历史）

---

## ⚙️ 环境配置

### 环境变量设置

创建 `.env.local` 文件：

```bash
# 本地开发（SQLite）
DATABASE_URL="file:./data/autoads.db"

# 可选：其他配置
NODE_ENV="development"
```

创建 `.env.production` 文件（生产环境）：

```bash
# 生产环境（PostgreSQL）
DATABASE_URL="postgresql://username:password@host:5432/autoads"

NODE_ENV="production"
```

### package.json scripts

确保以下script存在：

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "db:init": "sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql",
    "db:reset": "rm -f data/autoads.db && npm run db:init",
    "validate-schema": "tsx scripts/validate-db-schema.ts"
  }
}
```

---

## 💻 本地开发（SQLite）

### 初始化新数据库

```bash
# 方式1：使用npm script
npm run db:init

# 方式2：直接使用sqlite3
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql

# 方式3：交互式初始化
sqlite3 data/autoads.db
> .read migrations/000_init_schema_consolidated.sqlite.sql
> .quit
```

### 重置数据库（⚠️ 会删除所有数据）

```bash
# 使用npm script（推荐）
npm run db:reset

# 手动方式
rm -f data/autoads.db
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql
```

### 常用SQLite命令

```bash
# 连接数据库
sqlite3 data/autoads.db

# 查看所有表
.tables

# 查看表结构
.schema users
.schema offers

# 查看prompt版本
SELECT prompt_id, version, is_active FROM prompt_versions WHERE is_active = 1;

# 查看数据库大小
.dbinfo

# 导出数据
.output backup.sql
.dump
.output stdout

# 退出
.quit
```

### SQLite优化配置

在应用启动时执行以下PRAGMA设置（已在初始化脚本中设置）：

```sql
PRAGMA foreign_keys = ON;        -- 启用外键约束
PRAGMA journal_mode = WAL;       -- 使用WAL模式提升并发性能
PRAGMA synchronous = NORMAL;     -- 平衡性能和安全性
PRAGMA cache_size = -64000;      -- 64MB缓存
PRAGMA temp_store = MEMORY;      -- 临时表使用内存
```

---

## 🌐 生产环境（PostgreSQL）

### 先决条件

```bash
# 安装PostgreSQL 14+
# macOS
brew install postgresql@14

# Ubuntu/Debian
sudo apt-get install postgresql-14

# 启动PostgreSQL服务
# macOS
brew services start postgresql@14

# Ubuntu/Debian
sudo systemctl start postgresql
```

### 创建数据库和用户

```bash
# 切换到postgres用户
sudo -u postgres psql

-- 创建数据库用户
CREATE USER autoads_user WITH PASSWORD 'your_secure_password';

-- 创建数据库
CREATE DATABASE autoads OWNER autoads_user;

-- 赋予权限
GRANT ALL PRIVILEGES ON DATABASE autoads TO autoads_user;

-- 退出
\q
```

### 初始化PostgreSQL数据库

```bash
# 使用psql初始化
psql postgresql://autoads_user:password@localhost:5432/autoads \
  < pg-migrations/000_init_schema_consolidated.pg.sql

# 可选：验证增量迁移应为空（初始化脚本已包含并写入 migration_history）
DATABASE_URL="postgresql://autoads_user:password@localhost:5432/autoads" npm run db:migrate

# 或者使用管道
cat pg-migrations/000_init_schema_consolidated.pg.sql | \
  psql postgresql://autoads_user:password@localhost:5432/autoads
```

### 验证PostgreSQL初始化

```bash
# 连接数据库
psql postgresql://autoads_user:password@localhost:5432/autoads

-- 查看所有表
\dt

-- 查看表结构
\d users
\d offers

-- 查看扩展
\dx

-- 查看prompt版本
SELECT prompt_id, version, is_active FROM prompt_versions WHERE is_active = true;

-- 退出
\q
```

### 常用PostgreSQL命令

```bash
# 备份数据库
pg_dump autoads > backup_$(date +%Y%m%d).sql

# 恢复数据库
psql autoads < backup_20251204.sql

# 查看数据库大小
psql autoads -c "SELECT pg_size_pretty(pg_database_size('autoads'));"

# 查看连接信息
psql autoads -c "SELECT * FROM pg_stat_activity;"
```

---

## ✅ Schema验证

### 运行验证脚本

```bash
# 验证SQLite schema
npm run validate-schema

# 或直接使用tsx
tsx scripts/validate-db-schema.ts --sqlite-only
```

### 验证检查项

验证脚本会检查：

1. ✅ **数据库连接** - 可以成功连接
2. ✅ **表数量** - 正好40个表
3. ✅ **核心表存在** - 15个关键表必须存在
4. ✅ **索引数量** - 约89个性能索引
5. ✅ **外键启用** - 数据完整性保护
6. ✅ **Prompt种子数据** - 12个活跃prompt，70个版本历史
7. ✅ **关键字段** - 重要字段如product_categories, user_id等
8. ✅ **AB测试表移除** - 已下线功能清理

### 期望输出

```
🔍 AutoAds Database Schema Validator
=====================================

📊 Validating SQLite Schema...

✅ Database connection successful
✅ Table count correct: 40 tables
✅ All 15 core tables exist
✅ Index count acceptable: 89-95 indexes
✅ Foreign keys enabled
✅ Prompt versions seed data correct
   └─ Total versions: 70
   └─ Active versions: 12
   └─ Prompt types: 12
✅ All critical columns exist
✅ AB test tables removed (as expected)

=====================================
✅ Passed: 8/8
=====================================

🎉 All validations passed! Database schema is correct.
```

---

## ❓ 常见问题

### Q1: 初始化时报错 "Error: UNIQUE constraint failed"

**原因**: 数据库已存在且包含数据

**解决方案**:
```bash
# 备份现有数据（如有需要）
cp data/autoads.db data/autoads_backup.db

# 删除并重新初始化
rm data/autoads.db
npm run db:init
```

### Q2: "database is locked" 错误

**原因**: SQLite数据库被其他进程占用

**解决方案**:
```bash
# 1. 停止所有Node.js进程
pkill -f node

# 2. 删除WAL文件
rm data/autoads.db-wal
rm data/autoads.db-shm

# 3. 重启开发服务器
npm run dev
```

### Q3: Prompt版本不完整

**原因**: 初始化脚本中的INSERT语句可能被截断

**解决方案**:
```bash
# 使用完整的初始化脚本重新初始化
npm run db:reset

# 验证prompt数据
sqlite3 data/autoads.db "SELECT COUNT(*) FROM prompt_versions WHERE is_active = 1;"
# 应该返回: 12
```

### Q4: PostgreSQL连接被拒绝

**原因**: PostgreSQL服务未运行或连接配置错误

**解决方案**:
```bash
# 检查PostgreSQL状态
# macOS
brew services list | grep postgresql

# Linux
sudo systemctl status postgresql

# 启动服务
# macOS
brew services start postgresql@14

# Linux
sudo systemctl start postgresql

# 测试连接
psql -U autoads_user -d autoads -h localhost
```

### Q5: 外键约束错误

**原因**: 插入数据时违反了外键约束

**解决方案**:
```sql
-- 检查外键约束
PRAGMA foreign_key_list(table_name);

-- 临时禁用外键（仅用于调试）
PRAGMA foreign_keys = OFF;
-- 执行操作
PRAGMA foreign_keys = ON;
```

### Q6: 如何查看数据库当前版本？

```sql
-- SQLite
SELECT * FROM migration_history ORDER BY id DESC LIMIT 1;

-- 或者查看schema注释
SELECT sql FROM sqlite_master WHERE name = 'users' LIMIT 1;
-- 应该看到注释：Version: 2.0.0 (Consolidated)
```

---

## 📦 迁移说明

### 从旧迁移系统切换到整合Schema

如果你的项目是从旧的增量迁移系统（001-057）切换过来的：

#### 步骤1: 备份现有数据

```bash
# SQLite备份
sqlite3 data/autoads.db ".backup data/autoads_before_consolidation.db"

# PostgreSQL备份
pg_dump autoads > autoads_before_consolidation.sql
```

#### 步骤2: 导出关键业务数据（如有用户）

```bash
# 导出users表
sqlite3 data/autoads.db << 'EOF' > /tmp/users_export.sql
.mode insert users
SELECT * FROM users;
EOF

# 导出offers表
sqlite3 data/autoads.db << 'EOF' > /tmp/offers_export.sql
.mode insert offers
SELECT * FROM offers;
EOF
```

#### 步骤3: 使用新Schema重新初始化

```bash
# 删除旧数据库
rm data/autoads.db

# 使用整合Schema初始化
npm run db:init
```

#### 步骤4: 恢复业务数据

```bash
# 恢复users
sqlite3 data/autoads.db < /tmp/users_export.sql

# 恢复offers
sqlite3 data/autoads.db < /tmp/offers_export.sql

# 验证数据
sqlite3 data/autoads.db "SELECT COUNT(*) FROM users; SELECT COUNT(*) FROM offers;"
```

### 项目上线后的Schema变更

⚠️ **重要**: 项目上线后，**不要直接修改整合Schema文件**

正确的流程：

1. **创建增量迁移**（从058开始编号）

```sql
-- migrations/058_add_new_feature.sql
-- Description: Add new feature XYZ
-- Date: 2025-12-10

ALTER TABLE offers ADD COLUMN new_field TEXT;

-- Corresponding index
CREATE INDEX idx_offers_new_field ON offers(new_field);
```

2. **同步更新整合Schema**

编辑 `migrations/000_init_schema_consolidated.sqlite.sql`，在对应位置添加新字段

3. **创建PostgreSQL版本**

创建 `pg-migrations/058_add_new_feature.pg.sql`

4. **在生产环境执行**

```bash
# 生产环境只执行增量迁移
psql autoads < pg-migrations/058_add_new_feature.pg.sql
```

5. **更新迁移报告**

在 `MIGRATION_CONSOLIDATION_REPORT.md` 中记录新迁移

---

## 📊 数据库性能监控

### SQLite性能

```bash
# 查看WAL文件大小
ls -lh data/autoads.db*

# 手动checkpoint（合并WAL到主文件）
sqlite3 data/autoads.db "PRAGMA wal_checkpoint(FULL);"

# 查看慢查询
# 在应用中启用query logging
```

### PostgreSQL性能

```sql
-- 查看最慢的查询
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

-- 查看索引使用情况
SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;

-- 查看表大小
SELECT
  table_name,
  pg_size_pretty(pg_total_relation_size(table_name::regclass)) as size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(table_name::regclass) DESC;
```

---

## 🔐 数据库安全

### SQLite

- ✅ 文件权限设置为600（仅所有者可读写）
  ```bash
  chmod 600 data/autoads.db
  ```
- ✅ 不要将数据库文件提交到Git（已在.gitignore）
- ✅ 定期备份到安全位置

### PostgreSQL

- ✅ 使用强密码
- ✅ 限制网络访问（pg_hba.conf）
- ✅ 使用SSL连接（生产环境必须）
- ✅ 定期更新PostgreSQL版本
- ✅ 定期备份（自动化备份脚本）

---

## 📚 相关文档

- [迁移整合报告](./MIGRATION_CONSOLIDATION_REPORT.md) - 完整的迁移历史和映射
- [Schema验证脚本](../scripts/validate-db-schema.ts) - 自动化验证工具
- [SQLite整合Schema](./000_init_schema_consolidated.sqlite.sql) - 本地开发schema
- [PostgreSQL整合Schema](../pg-migrations/000_init_schema_consolidated.pg.sql) - 生产环境schema

---

## 🆘 获取帮助

遇到问题？

1. **查看日志**: 检查应用和数据库日志
2. **运行验证**: `npm run validate-schema`
3. **查看文档**: 参考本指南和迁移报告
4. **重置数据库**: 最后手段，`npm run db:reset`

---

**文档版本**: 1.0
**最后更新**: 2025-12-04
**维护者**: AutoAds开发团队
