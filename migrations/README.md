# 数据库迁移脚本（SQLite）

本目录为 **SQLite** 的初始化脚本与增量迁移脚本；**PostgreSQL** 对应脚本在 `pg-migrations/`。

## 初始化脚本（单文件）

- SQLite：`migrations/000_init_schema_consolidated.sqlite.sql`
- PostgreSQL：`pg-migrations/000_init_schema_consolidated.pg.sql`

初始化脚本已包含历史迁移变更，并会写入 `migration_history`，因此在新库上执行后，`npm run db:migrate` 应显示“无需迁移”。

## 历史迁移归档

- SQLite 历史迁移（以及旧初始化脚本）已归档至：`migrations/archive/v2/`
- PostgreSQL 历史迁移（以及旧初始化脚本）已归档至：`pg-migrations/archive/v2/`

后续新增迁移请继续放在根目录 `migrations/` 与 `pg-migrations/`（例如从 `141_...` 开始）。

## 增量迁移命名规范

格式：`{编号}_{描述}.sql`

- **编号**：3位数字（000-999），按时间顺序递增
- **描述**：snake_case 格式，简洁描述功能
- **000**：保留给初始化 schema

## 使用方法

### SQLite（本地开发）

```bash
# 初始化（推荐）
npm run db:init

# 执行增量迁移
npm run db:migrate
```

### PostgreSQL（生产/容器）

```bash
# 先执行初始化脚本
psql $DATABASE_URL < pg-migrations/000_init_schema_consolidated.pg.sql

# 可选：再运行增量迁移（通常应为空）
DATABASE_URL="$DATABASE_URL" npm run db:migrate
```

## 迁移状态追踪

迁移执行记录存储在 `migration_history` 表中（两种数据库均有该表）。
