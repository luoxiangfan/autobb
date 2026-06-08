# 归档脚本

本目录存放**已完成使命、按需手动重跑**的一次性运维脚本。它们不是应用运行时依赖，但保留在仓库中供事故修复或历史环境补数使用。

## 使用方式

优先通过 `package.json` 中的 npm script 调用（路径已指向 `scripts/archive/one-off/`）：

```bash
npm run db:backfill-jsonb -- --dry-run
npm run campaign-backups:dedup:preview
npm run campaigns:backfill-names -- --apply
```

也可直接：

```bash
tsx scripts/archive/one-off/backfill-offer-asin.ts
```

## `one-off/` 脚本索引

| 脚本                                         | npm script                              | 用途                             |
| -------------------------------------------- | --------------------------------------- | -------------------------------- |
| `backfill-jsonb-double-encoded.ts`           | `db:backfill-jsonb`                     | 修复 JSONB 双重编码字段          |
| `backfill-offer-asin.ts`                     | `db:backfill-offer-asin`                | 回填 Offer ASIN                  |
| `backfill-campaign-names-from-google.ts`     | `campaigns:backfill-names`              | 从 Google Ads 回填 campaign 名称 |
| `cleanup-duplicate-campaign-backups.ts`      | `campaign-backups:dedup`                | Campaign 备份去重                |
| `clean-database-settings.ts`                 | `db:clean-settings`                     | 清理数据库 settings 脏数据       |
| `rebuild-affiliate-commission-line-facts.ts` | `db:rebuild-affiliate-commission-facts` | 重建佣金 line facts              |
| `validate-search-term-activation.ts`         | `validate:search-term`                  | 搜索词激活逻辑验证（调试）       |
| `run-competitor-ab-test.ts`                  | `test:competitor-compression`           | 竞品压缩 A/B 测试                |
| `click-farm-audit-no-campaign.ts`            | `click-farm:audit-no-campaign`          | 点击农场无 campaign 审计         |

## 仍在 `scripts/` 根目录的运维脚本

日常/周期性维护（监控、归因、队列修复等）见 [`README_ATTRIBUTION_MAINTENANCE.md`](../README_ATTRIBUTION_MAINTENANCE.md) 及 `package.json` 中 `attribution:*`、`queue:repair-pending-index` 等命令。

## 归档原则

- **移入 archive**：针对特定迁移/回填/一次性审计，生产环境通常已执行完毕。
- **保留根目录**：数据库迁移、schema 校验、备份、构建/部署、OpenClaw、归因日常维护。
