# 归档的迁移文件 (Archived Migrations)

此目录包含项目整合前的历史迁移文件（001-057）。

## ⚠️ 重要说明

这些文件已被整合到：
- `../000_init_schema_consolidated.sqlite.sql`

**请勿使用这些旧迁移文件**，它们仅作为历史参考保留。

## 如何使用新系统

新项目请使用整合Schema：

```bash
# 本地开发（SQLite）
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql

# 生产环境（PostgreSQL）
psql autoads < pg-migrations/000_init_schema_consolidated.pg.sql
```

详细说明请查看：
- [数据库初始化指南](../DATABASE_INITIALIZATION_GUIDE.md)
- [迁移整合报告](../MIGRATION_CONSOLIDATION_REPORT.md)

---

**归档日期**: 2025-12-04
**原因**: 迁移整合 - 57个迁移合并为2个整合Schema
