# 数据库初始化指南 (Database Initialization Guide)

AutoAds 使用 **PostgreSQL** 作为唯一数据库。本地开发与生产环境均通过 `DATABASE_URL` 连接。

---

## 目录

1. [快速开始](#快速开始)
2. [环境配置](#环境配置)
3. [本地开发](#本地开发)
4. [生产环境](#生产环境)
5. [Schema 验证](#schema-验证)
6. [常见问题](#常见问题)
7. [迁移说明](#迁移说明)

---

## 快速开始

### 首次 setup

```bash
# 1. 克隆并安装
git clone <repository-url>
cd autobb
npm install

# 2. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local：JWT_SECRET、ENCRYPTION_KEY、DATABASE_URL 等

# 3. 准备 PostgreSQL（自行安装或使用已有实例，本仓库不内置 Docker PG）
# 示例连接串：postgresql://autoads:password@localhost:5432/autoads

# 4. 初始化 schema + 增量迁移
npm run db:migrate

# 5. 确保管理员账号（可选，应用启动时也会检查）
DEFAULT_ADMIN_PASSWORD=your-password npm run db:init

# 6. 验证
npm run validate-schema

# 7. 启动
npm run dev
```

全新库若 consolidated 初始化脚本已包含全部历史变更，`db:migrate` 会写入 `migration_history` 并跳过已合并的增量。

---

## 环境配置

在 `.env.local`（开发）或 `.env.production`（生产）中配置：

```bash
# 必填
DATABASE_URL=postgresql://用户名:密码@主机:5432/autoads

# 可选
POSTGRES_STATEMENT_TIMEOUT_MS=60000
DEFAULT_ADMIN_PASSWORD=your-strong-password
BACKUP_DIR=./data/backups
```

应用通过 `src/lib/db.ts` 的 `DatabaseAdapter` 访问数据库；SQL 占位符统一使用 `?`，由适配层转换为 PostgreSQL 的 `$1, $2, ...`。

### npm scripts

| 命令 | 说明 |
|------|------|
| `npm run db:migrate` | 应用 `migrations/` 增量迁移 |
| `npm run db:init` | 检查关键表是否存在，并确保默认管理员 |
| `npm run admin:ensure` | 仅确保管理员账号 |
| `npm run validate-schema` | 连接 `DATABASE_URL` 校验关键表 |

应用首次启动且库为空时，`src/lib/db-init.ts` 会尝试从 `migrations/000_init_schema_consolidated.pg.sql` 灌入 consolidated schema。

---

## 本地开发

开发者自行提供 PostgreSQL（本机安装、云托管或 Docker 等均可）。仓库不强制附带 PostgreSQL 容器。

### 方式 A：已有空库 + consolidated 脚本

```bash
psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql
npm run db:migrate
npm run db:init
```

### 方式 B：仅迁移（应用启动时自动灌 schema）

```bash
npm run db:migrate
npm run dev
# 若关键表缺失，启动流程会执行 initializePostgreSQL()
```

### 常用 psql 命令

```bash
psql "$DATABASE_URL"

\dt                                    # 列出表
\d users                               # 表结构
SELECT prompt_id, version, is_active FROM prompt_versions WHERE is_active = true;
\q
```

### 重置开发库（⚠️ 删除所有数据）

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql
npm run db:migrate
npm run db:init
```

---

## 生产环境

### 创建数据库与用户

```bash
sudo -u postgres psql

CREATE USER autoads_user WITH PASSWORD 'your_secure_password';
CREATE DATABASE autoads OWNER autoads_user;
GRANT ALL PRIVILEGES ON DATABASE autoads TO autoads_user;
\q
```

### 初始化

```bash
export DATABASE_URL="postgresql://autoads_user:password@host:5432/autoads"

psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql
npm run db:migrate
npm run validate-schema
```

Docker 部署时在容器环境变量中设置 `DATABASE_URL`；详见根目录 `README.md` 部署章节。

### 备份与恢复

```bash
pg_dump "$DATABASE_URL" > backup_$(date +%Y%m%d).sql
psql "$DATABASE_URL" < backup_20251204.sql
```

---

## Schema 验证

```bash
npm run validate-schema
```

需要有效的 `DATABASE_URL`。未配置时会跳过校验（exit 0）并打印提示。

检查项包括：PostgreSQL 连接、public 表数量、关键表（`users`、`offers`、`campaigns`、`system_settings`）是否存在。

---

## 常见问题

### Q1: 启动报 `DATABASE_URL is required`

在 `.env.local` 中设置 `postgresql://` 或 `postgres://` 连接串，并确认 `npm run dev` 能读取该文件。

### Q2: `npm run db:migrate` 失败

- 确认 PostgreSQL 可连接、用户有 DDL 权限
- 查看报错迁移文件名，对照 `migrations/` 手工在 psql 中执行以定位语句问题
- 检查 `migration_history` 是否记录了冲突名称

### Q3: 管理员无法登录

```bash
DEFAULT_ADMIN_PASSWORD=your-password npm run admin:ensure
```

默认用户名：`autoads`。未设置 `DEFAULT_ADMIN_PASSWORD` 时，初始化会生成随机密码并在日志中输出。

### Q4: PostgreSQL 连接被拒绝

检查服务状态、防火墙、`DATABASE_URL` 主机/端口/凭据，以及是否要求 `sslmode=require`。

### Q5: 外键约束错误

在 psql 中检查引用数据是否完整；勿在生产库随意 `DISABLE TRIGGER` 绕过约束。

### Q6: 如何查看当前迁移版本？

```sql
SELECT migration_name, executed_at FROM migration_history ORDER BY executed_at DESC LIMIT 20;
```

---

## 迁移说明

增量迁移目录：**`migrations/`**。命名与近期增量见 [README.md](./README.md)。

### 新增 schema 变更流程

1. 在 `migrations/` 添加 `{编号}_{描述}.pg.sql`（编号递增）
2. 同步更新 `migrations/000_init_schema_consolidated.pg.sql`（供全新库）
3. 在 `migrations/README.md` 的「近期增量迁移」表中记录
4. 本地执行 `npm run db:migrate` 与 `npm run validate-schema`
5. 补充相关 `npm test` 用例

---

## 数据库性能与安全

### 性能监控（PostgreSQL）

```sql
SELECT query, mean_exec_time, calls
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;

SELECT schemaname, tablename, indexname, idx_scan
FROM pg_stat_user_indexes
ORDER BY idx_scan ASC;
```

### 安全建议

- 使用强密码，限制网络访问（`pg_hba.conf`）
- 生产环境启用 SSL（`?sslmode=require`）
- 定期备份，勿将 `.env` 提交到版本库

---

## 相关文档

- [迁移规范与增量说明](./README.md)
- [Schema 验证脚本](../scripts/validate-db-schema.ts)
- [PostgreSQL 整合 Schema](./000_init_schema_consolidated.pg.sql)

---

**文档版本**: 2.0（PostgreSQL 单栈）
**最后更新**: 2026-06-12
