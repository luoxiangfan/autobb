# 佣金归因维护脚本

本目录包含用于维护和监控佣金归因系统的脚本。

## 🎉 最新更新（2026-03-07）

**广告发布自动链接增强**：现在广告发布时会自动通过品牌匹配建立 Product-Offer 链接，减少手动维护需求。

详见：`docs/OFFER_PRODUCT_BRAND_MATCHING.md`

## 脚本列表

### 1. 监控和告警

#### `monitor-attribution-health.ts`
**用途**：每日健康检查，监控归因系统的关键指标

**检查项**：
- 未归因佣金总额
- 产品-Offer 链接覆盖率
- 归因成功率
- 超期的 pending 失败记录

**运行频率**：每日
```bash
npm run tsx scripts/monitor-attribution-health.ts
```

**告警阈值**：
- 未归因佣金 > $10: 警告
- 未归因佣金 > $50: 严重
- 产品链接覆盖率 < 90%: 警告
- 产品链接覆盖率 < 80%: 严重
- 归因成功率 < 95%: 警告
- 归因成功率 < 90%: 严重

### 2. 自动化维护

#### `auto-link-products-to-offers.ts`
**用途**：自动为产品建立 Offer 链接

**匹配规则**：
1. 品牌完全匹配
2. ASIN 出现在 Offer URL 中

**运行频率**：每日或产品同步后
```bash
npm run tsx scripts/auto-link-products-to-offers.ts
```

#### `discover-new-products.ts`
**用途**：从未归因佣金中发现新产品

**功能**：
- 识别不在 `affiliate_products` 表中的 ASIN
- 创建产品占位记录
- 提示后续操作

**运行频率**：每日或检测到未归因佣金时
```bash
npm run tsx scripts/discover-new-products.ts
```

#### `reattribute-pending-commissions.ts`
**用途**：重新归因 pending 状态的佣金

**注意**：当前版本存在数据丢失风险，使用前请备份

**运行频率**：手动触发
```bash
npm run tsx scripts/reattribute-pending-commissions.ts
```

### 3. 调试工具

#### `debug-attribution-mapping.ts`
**用途**：调试归因映射关系

**检查项**：
- 产品品牌信息
- Offer 品牌信息
- 广告系列信息
- Performance 数据

```bash
npm run tsx scripts/debug-attribution-mapping.ts
```

#### `test-single-attribution.ts`
**用途**：测试单个 ASIN 的归因逻辑

```bash
npm run tsx scripts/test-single-attribution.ts
```

## 推荐的维护流程

### 每日自动任务（通过 cron 或 scheduler）

```bash
# 1. 监控健康状态
npm run tsx scripts/monitor-attribution-health.ts

# 2. 发现新产品
npm run tsx scripts/discover-new-products.ts

# 3. 自动建立产品链接
npm run tsx scripts/auto-link-products-to-offers.ts

# 4. 如果有告警，发送通知
# (在脚本中实现 sendAlert 函数)
```

### 每周手动检查

1. 查看未归因佣金详情
```sql
SELECT
  report_date,
  source_asin,
  reason_code,
  commission_amount
FROM openclaw_affiliate_attribution_failures
WHERE report_date >= DATE('now', '-7 days')
ORDER BY commission_amount DESC;
```

2. 检查产品链接覆盖率
```sql
SELECT
  COUNT(*) as total_products,
  COUNT(DISTINCT apol.product_id) as linked_products,
  ROUND(COUNT(DISTINCT apol.product_id) * 100.0 / COUNT(*), 2) as coverage_rate
FROM affiliate_products ap
LEFT JOIN affiliate_product_offer_links apol ON apol.product_id = ap.id;
```

3. 审查 pending 状态的失败记录
```sql
SELECT
  report_date,
  source_asin,
  commission_amount,
  reason_code,
  JULIANDAY('now') - JULIANDAY(report_date) as days_old
FROM openclaw_affiliate_attribution_failures
WHERE reason_code IN ('pending_offer_mapping_miss', 'pending_product_mapping_miss')
ORDER BY days_old DESC;
```

### 告警响应流程

#### 告警：未归因佣金过高

1. 运行 `discover-new-products.ts` 发现新产品
2. 运行 `auto-link-products-to-offers.ts` 建立链接
3. 手动检查无法自动链接的产品
4. 运行 `reattribute-pending-commissions.ts` 重新归因

#### 告警：产品链接覆盖率低

1. 运行 `auto-link-products-to-offers.ts`
2. 查看未链接的产品列表
3. 手动为无法自动匹配的产品建立链接

#### 告警：归因成功率低

1. 检查归因失败原因分布
2. 分析是否有系统性问题
3. 考虑优化归因逻辑

## 配置

### 环境变量

```bash
# 数据库连接
DATABASE_URL=postgresql://user:pass@host:port/dbname

# 告警配置（可选）
ALERT_WEBHOOK_URL=https://hooks.slack.com/services/xxx
ALERT_EMAIL=admin@example.com

# 归因配置
OPENCLAW_AFFILIATE_ATTRIBUTION_PENDING_DAYS=7
```

### Cron 配置示例

```cron
# 每天早上 8 点运行健康检查
0 8 * * * cd /path/to/autobb && npm run tsx scripts/monitor-attribution-health.ts

# 每天早上 9 点运行自动维护
0 9 * * * cd /path/to/autobb && npm run tsx scripts/discover-new-products.ts
0 9 * * * cd /path/to/autobb && npm run tsx scripts/auto-link-products-to-offers.ts
```

## 故障排查

### 问题：脚本运行失败

1. 检查数据库连接
2. 检查环境变量配置
3. 查看错误日志

### 问题：自动链接没有创建链接

1. 检查产品和 Offer 的品牌字段是否填写
2. 检查品牌名称是否一致（大小写、空格）
3. 运行 `debug-attribution-mapping.ts` 查看详细信息

### 问题：重新归因后数据丢失

**当前已知问题**：`reattribute-pending-commissions.ts` 存在数据丢失风险

**临时解决方案**：
1. 使用前备份数据库
2. 只处理确定可以归因的记录
3. 等待归因逻辑优化后再使用

## 相关文档

- [归因预防方案](../docs/COMMISSION_ATTRIBUTION_PREVENTION.md)
- [归因逻辑说明](../docs/COMMISSION_ATTRIBUTION_LOGIC.md)

## 贡献

如果发现问题或有改进建议，请提交 Issue 或 Pull Request。
