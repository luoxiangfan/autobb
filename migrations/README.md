# 数据库迁移脚本（PostgreSQL）

本目录包含 **PostgreSQL** consolidated 初始化脚本与增量迁移。应用与 `npm run db:migrate` 均读取此目录。

## 初始化脚本（单文件）

- `migrations/000_init_schema_consolidated.pg.sql`

初始化脚本已包含历史迁移变更（**064–253** 等），并会写入 `migration_history`，因此在新库上执行后，`npm run db:migrate` 通常显示「无需迁移」。

## 历史迁移归档

自 **2026-06** 起，历史迁移与 `prompts/*.txt` 已从仓库移除以减小体积。活跃 prompt 内容在 `prompt_versions` 表；新库请使用 consolidated 初始化即可。

`npm run db:migrate` 会扫描 `archived_*` 子目录（若存在）。`migration_history` 记录文件名（不含目录前缀）。

如需查阅更早归档：

```bash
git show archive/pre-cleanup-2026-06:migrations/archive/v2/141_example.sql
```

## 增量迁移命名规范

格式：`{编号}_{描述}.pg.sql`

- **编号**：3 位数字（000–999），按时间顺序递增
- **描述**：snake_case，简洁描述功能
- **000**：保留给 consolidated 初始化 schema

## 使用方法

```bash
# 在 .env.local 中配置 DATABASE_URL 后：

# 全新库：先灌 consolidated（或由应用首次启动自动灌入）
psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql

# 增量迁移
npm run db:migrate

# 确保管理员 + 检查关键表
npm run db:init

# Schema 校验
npm run validate-schema
```

## 迁移状态追踪

执行记录存储在 `migration_history` 表（含 `file_hash`，支持内容变更后重跑）。

## 近期增量迁移

| 编号 | 说明 | 部署注意 |
|------|------|----------|
| **247** | `ad_creatives.generation_mode`、`creative_tasks.generation_mode` | 已有库须 `npm run db:migrate`；全新 consolidated 库可跳过 |
| **254** | Google Ads OAuth 配置合并至 `google_ads_credentials` | 须 `npm run db:migrate`；回填由 **257** SQL 完成 |
| **255** | 移除 `google_ads_test_credentials` 表 | 须 `npm run db:migrate` |
| **256** | 将 `system.sync_interval_hours` 用户覆盖迁移至 `data_sync_interval_hours` | 须 `npm run db:migrate` |
| **257** | 清理 `system_settings` 遗留 OAuth 用户实例并回填凭证表 | 须 `npm run db:migrate` |
| **258** | `ad_creatives.keyword_bucket` 约束收紧为 A/B/D | 须 `npm run db:migrate` |
| **259** | 移除冗余列 `campaign_backups.campaign_data` | 须 `npm run db:migrate` |
| **263** | 移除 `launch_scores` v3 维度列（已由 v4 字段替代） | 须 `npm run db:migrate` |

创意生成模式 API 与 UI 依赖上述列；未迁移时入队/列表可能报错。

## 本地 PostgreSQL

开发者自行提供 PostgreSQL 实例，在 `.env.local` 设置 `DATABASE_URL`。详见 [DATABASE_INITIALIZATION_GUIDE.md](./DATABASE_INITIALIZATION_GUIDE.md)。
