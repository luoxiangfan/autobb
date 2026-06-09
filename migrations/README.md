# 数据库迁移脚本（SQLite）

本目录为 **SQLite** 的初始化脚本与增量迁移脚本；**PostgreSQL** 对应脚本在 `pg-migrations/`。

## 初始化脚本（单文件）

- SQLite：`migrations/000_init_schema_consolidated.sqlite.sql`
- PostgreSQL：`pg-migrations/000_init_schema_consolidated.pg.sql`

初始化脚本已包含历史迁移变更（**064–253**），并会写入 `migration_history`，因此在新库上执行后，`npm run db:migrate` 应显示“无需迁移”。

## 历史迁移归档

自 **2026-06** 起，历史迁移与 `prompts/*.txt` 已从仓库移除以减小体积。活跃 prompt 内容在 `prompt_versions` 表（见迁移 `246_llm_prompt_externalization_v1`）；新库请使用 consolidated 初始化即可。

**141–253** 号增量迁移已合并进上述 consolidated 初始化脚本，不再单独保留于仓库。

`npm run db:migrate` 仍会扫描 `archived_*` 子目录（若存在）；`migration_history` 记录文件名（不含目录前缀），与已有库兼容。

如需查阅更早归档，使用 Git 标签：

```bash
git show archive/pre-cleanup-2026-06:migrations/archive/v2/141_example.sql
git checkout archive/pre-cleanup-2026-06 -- prompts/ad_creative_generation_v5.7.txt
```

后续新增迁移请继续放在根目录 `migrations/` 与 `pg-migrations/`。

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

## 近期增量迁移

| 编号    | 说明                                                                                                                  | 部署注意                                                                                                                                                          |
| ------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **247** | `ad_creatives.generation_mode`、`creative_tasks.generation_mode`（`fast` / `balanced` / `original`，默认 `original`） | 已有库须执行 `npm run db:migrate`（SQLite）或应用 `pg-migrations/247_add_ad_creative_generation_mode.pg.sql`；全新库若已用含 247 字段的 consolidated 初始化可跳过 |
| **254** | Google Ads OAuth 配置从 `system_settings` 合并至 `google_ads_credentials` / `google_ads_test_credentials` | 须 `npm run db:migrate`；回填依赖 `.env.local` 中 `JWT_SECRET`（解密遗留敏感字段） |

创意生成模式 API 与 UI 依赖上述列；未迁移时入队/列表可能报错或缺少模式展示。
