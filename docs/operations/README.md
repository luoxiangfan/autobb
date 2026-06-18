# 运维手册（Operations）

本目录存放一次性维护、数据修复与发布相关的运维说明。

| 文档 | 说明 |
|------|------|
| [performance-runbooks/](./performance-runbooks/) | 前端性能发布、回滚演练与复盘模板（2026-03-03） |
| [campaign-backups-dedup.md](./campaign-backups-dedup.md) | 清理 `campaign_backups` 历史重复备份 |

相关 SQL 脚本位于 `scripts/cleanup-duplicate-campaign-backups.{pg,sqlite}.sql`。
