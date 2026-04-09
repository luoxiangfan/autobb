# GitHub autobb 仓库 Google Ads API 集成代码变更检查报告

**检查时间**: 2026-04-07 18:24 (Asia/Shanghai)  
**仓库**: autobb  
**当前分支**: feature/google-ads-campaign-sync  
**HEAD 提交**: 620a691 feat: 实现基于任务队列的 Google Ads 广告系列自动同步

---

## 📋 执行摘要

**检查结论**: ✅ 需要代码补丁

最近 6 次提交全部与 Google Ads API 集成相关，累计新增 **1,435+ 行代码**，涉及 **8 个文件** 的修改/新增。

---

## 📝 最近提交记录 (6 commits)

| 提交哈希 | 提交信息 | 时间 | 文件变更 |
|----------|----------|------|----------|
| 620a691 | feat: 实现基于任务队列的 Google Ads 广告系列自动同步 | 17:14 | +1332 行 |
| b90fab0 | feat: 优化同步逻辑 - 已有关联 Offer 时不创建或更新 | 16:04 | +103/-50 |
| 4b8f83b | feat: 实现 Google Ads 广告系列定时同步功能 | 15:27 | +714 行 |
| b298358 | feat: Google Ads 共享授权配置 - 管理员权限检查和用户绑定 API | 14:xx | 权限检查 |
| 577c06d | feat: Google Ads 共享授权配置系统 | 14:xx | 配置系统 |
| 6c4f593 | sync latest code | - | 同步 |

---

## 🔧 核心功能模块

### 1. 任务队列集成 (最新 - 620a691)

**新增文件**:
- `src/lib/queue/schedulers/google-ads-campaign-sync-scheduler.ts` (361 行)
- `src/lib/queue/executors/google-ads-campaign-sync-executor.ts` (161 行)
- `scripts/docker-deploy-sync.sh` (363 行)
- `scripts/integrate-queue-sync.sh` (277 行)
- `scripts/setup-auto-sync.sh` (162 行)
- `vercel.cron-example.json` (8 行)

**功能特性**:
- 每小时自动检查用户同步配置
- 验证 OAuth/服务账号凭证
- 自动创建任务入队
- 支持自动重试、优先级、并发控制
- 已关联 Offer 自动跳过，避免覆盖用户数据

**配置选项**:
```bash
QUEUE_GOOGLE_ADS_SYNC_RUN_ON_START=true
QUEUE_GOOGLE_ADS_SYNC_STARTUP_DELAY_MS=5000
QUEUE_GOOGLE_ADS_SYNC_INTERVAL_HOURS=6
```

---

### 2. 同步逻辑优化 (b90fab0)

**修改文件**:
- `src/lib/google-ads-campaign-sync.ts` (+149/-50)
- `src/app/api/cron/sync-google-ads-campaigns/route.ts` (+4/-1)

**优化内容**:
- 检查广告系列的 offer_id 字段，如果已有关联 Offer 则跳过创建/更新
- 新增 `skippedOffersCount` 统计跳过的 Offer 数量
- 保留用户手动设置的 `needs_completion` 状态，不被同步覆盖
- 完善日志输出，区分 created/skipped/linked 状态

**业务逻辑**:
1. 如果 `campaign.offer_id` 存在 → 跳过 Offer 创建/更新
2. 如果 offer 已存在但未关联 → 建立关联，不修改 needs_completion
3. 如果 offer 不存在 → 创建新 Offer 并标记 needs_completion=TRUE

---

### 3. 定时同步功能 (4b8f83b)

**新增文件**:
- `src/lib/google-ads-campaign-sync.ts` (449 行)
- `src/app/api/cron/sync-google-ads-campaigns/route.ts` (138 行)

**数据库迁移**:
- `migrations/231_add_google_ads_campaign_sync_fields.sql`
- `pg-migrations/231_add_google_ads_campaign_sync_fields.pg.sql`

**数据库变更**:
```sql
-- offers 表
ALTER TABLE offers ADD COLUMN google_ads_campaign_id TEXT;
ALTER TABLE offers ADD COLUMN sync_source TEXT DEFAULT 'manual';
ALTER TABLE offers ADD COLUMN needs_completion BOOLEAN NOT NULL DEFAULT false;

-- campaigns 表
ALTER TABLE campaigns ADD COLUMN synced_from_google_ads BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE campaigns ADD COLUMN needs_offer_completion BOOLEAN NOT NULL DEFAULT false;
```

**UI 更新**:
- `src/app/(app)/offers/OffersClientPage.tsx` - 新增'需要完善'列和筛选器
- `src/app/(app)/campaigns/CampaignsClientPage.tsx` - 新增'需要完善 Offer'列和筛选器
- `src/app/(app)/offers/types.ts` - 类型定义更新

---

### 4. 共享授权配置系统 (577c06d, b298358)

**新增文件**:
- `src/app/(app)/admin/google-ads-config/page.tsx` (738 行)
- `src/components/google-ads/GoogleAdsSharedConfig.tsx`
- `src/app/api/admin/google-ads/oauth-config/route.ts`
- `src/app/api/admin/google-ads/oauth-config/[id]/route.ts`
- `src/app/api/admin/google-ads/service-account/route.ts`
- `src/app/api/admin/google-ads/service-account/[id]/route.ts`
- `src/app/api/admin/google-ads/users-for-binding/route.ts`
- `src/app/api/auth/google-ads/callback/route.ts`
- `src/app/api/google-ads/authorize/start/route.ts`
- `src/app/api/google-ads/my-config/route.ts`

**数据库迁移**:
- `migrations/230_add_shared_oauth_configs.sql`
- `pg-migrations/230_add_shared_oauth_configs.pg.sql`

**核心功能**:
- 管理员创建 OAuth 配置和服务账号配置
- 用户绑定到共享配置
- 管理员权限检查（`user.role !== 'admin'`）
- 用户绑定列表 API

---

## 📦 生成的代码补丁

**补丁文件**: `patches/google-ads-latest-integration-patch-2026-04-07-1824.patch`
- **大小**: 120,522 行
- **范围**: 从 577c06d 到 HEAD (620a691)
- **包含内容**: 所有 Google Ads API 集成相关的代码变更

---

## 🚀 部署方式

### 方案 1: 队列集成 (推荐)
```bash
cd /home/admin/openclaw/workspace/autobb
./scripts/integrate-queue-sync.sh
```

### 方案 2: Docker 部署
```bash
./scripts/docker-deploy-sync.sh
```

### 方案 3: 通用配置
```bash
./scripts/setup-auto-sync.sh
```

### 方案 4: Host Crontab
```bash
# 每 6 小时执行一次
0 */6 * * * curl -s -X POST \
  -H "Authorization: Bearer $CRON_SECRET" \
  http://localhost:3000/api/cron/sync-google-ads-campaigns \
  >> /var/log/google-ads-sync.log 2>&1
```

---

## ✅ 验证清单

- [x] 数据库迁移文件已创建 (SQLite + PostgreSQL)
- [x] 同步服务实现完成
- [x] 队列调度器和执行器已集成
- [x] API 端点已创建并受 CRON_SECRET 保护
- [x] UI 页面已更新支持筛选
- [x] 共享授权配置系统完成
- [x] 管理员权限检查已实现
- [x] 部署脚本已创建 (3 种方案)
- [x] 代码补丁已生成

---

## 📌 后续建议

1. **立即应用补丁**: 将 `google-ads-latest-integration-patch-2026-04-07-1824.patch` 应用到目标环境
2. **运行数据库迁移**: 执行 migration 230 和 231
3. **配置环境变量**: 设置 `CRON_SECRET` 和队列相关配置
4. **测试同步功能**: 手动触发 API 端点验证同步逻辑
5. **监控日志**: 检查 scheduler 和 executor 日志确保正常运行

---

**报告生成**: 2026-04-07 18:24 (Asia/Shanghai)  
**检查工具**: GitHub autobb 仓库代码变更分析
