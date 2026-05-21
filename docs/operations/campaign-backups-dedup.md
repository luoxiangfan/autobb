# Campaign Backups 重复数据清理

## 背景

在发布流程修复之前，同一 `(user_id, offer_id)` 可能同时存在：

- `autoBackupCampaign` 写入的 `backup_source = 'autoads'`
- 发布 API 额外 `INSERT` 的 `backup_source = 'publish'`

应用代码已改为 `upsertCampaignBackupAfterPublish`（每个 Offer 仅保留一条）。**已有环境需一次性清理历史重复行。**

## 保留规则

每个 `user_id + offer_id` 仅保留 1 条，优先级：

1. `backup_version` 更高
2. 有有效 `campaign_config`（非空 JSON）
3. `updated_at` 更新
4. `id` 更大（兜底）

保留行若 `backup_source = 'publish'`，会归一为 `autoads`。

## 推荐方式：npm script（跨平台）

脚本使用项目统一的 `getDatabase()`（自动识别 SQLite / PostgreSQL）。

### 1. 备份数据库

**PostgreSQL（生产）**

```bash
pg_dump "$DATABASE_URL" -Fc -f "campaign_backups_backup_$(date +%Y%m%d).dump"
```

**SQLite（本地）**

```bash
cp data/autoads.db "data/autoads.db.bak.$(date +%Y%m%d)"
```

### 2. 预览（不写入）

```bash
npm run campaign-backups:dedup:preview
```

输出包含：清理前统计、重复组合样例、将要删除的 `id` 列表。

### 3. 执行清理

```bash
npm run campaign-backups:dedup
```

执行后再次输出统计；若仍有 `user_id + offer_id` 重复组合，脚本会以非 0 退出码结束。

### 环境变量

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | PostgreSQL 连接串；设置后走 Postgres |
| `DATABASE_PATH` | SQLite 文件路径，默认 `data/autoads.db` |

与日常开发一致，可从 `.env` / `.env.local` 加载（脚本已 `import 'dotenv/config'`）。

## 备选方式：直接执行 SQL

适合 DBA 在 psql / sqlite3 中手工执行。

| 环境 | 文件 |
|------|------|
| PostgreSQL | `scripts/cleanup-duplicate-campaign-backups.pg.sql` |
| SQLite | `scripts/cleanup-duplicate-campaign-backups.sqlite.sql` |

```bash
# PostgreSQL
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/cleanup-duplicate-campaign-backups.pg.sql

# SQLite
sqlite3 data/autoads.db < scripts/cleanup-duplicate-campaign-backups.sqlite.sql
```

仅预览时：PostgreSQL 在 STEP 2 后把末尾 `COMMIT` 改为 `ROLLBACK`；SQLite 在 STEP 4 前停止或改为 `ROLLBACK`。

## 验证清单

- [ ] `npm run campaign-backups:dedup:preview` 中 `duplicate_rows_to_remove` 符合预期
- [ ] 执行后 `distinct_pairs_after` 等于 `total_rows_after`（每 Offer 一条）
- [ ] `backup_source = 'publish'` 行数为 0（或仅剩未覆盖的边角数据）
- [ ] 在 `/campaign-backups` 页面抽查：同一 Offer 不再出现多条备份
- [ ] 任选一条备份执行「批量创建」 smoke，确认可正常入队发布

## 回滚

本操作为**破坏性删除**（仅删重复行，保留最优一条）。回滚方式：

- 从步骤 1 的数据库备份恢复；或
- 依赖后续发布触发的 `upsertCampaignBackupAfterPublish` 重建单条备份（无法恢复已删行的完整历史）

## 发布后备份写入规则（代码行为）

- 优先更新同 Offer 的 `autoads` / 历史 `publish` 备份，并仅删除 autoads 类重复行
- 若仅有 `google_ads` 且 `backup_version >= 2`：不再覆盖（最终版）
- 若仅有 `google_ads` v1 或无备份：新建 `autoads` 备份，保留 Google 行

## 相关代码

- `src/lib/campaign-backups.ts` — `upsertCampaignBackupAfterPublish`、`getBackupRankOrderSql`
- `src/app/api/campaigns/publish/route.ts` — 发布时 upsert
- `scripts/cleanup-duplicate-campaign-backups.ts` — npm 脚本实现

## 变更记录

| 日期 | 说明 |
|------|------|
| 2026-05-21 | 初版：修复发布重复 INSERT 后的历史数据清理说明 |
