# 异步抓取 vs 手动抓取测试指南

## 背景

异步抓取和手动抓取现在使用**完全相同**的逻辑（通过复用 `performScrapeAndAnalysis` 函数）。

## 测试准备

### 1. 检查代理配置状态

```bash
sqlite3 data/autoads.db "SELECT config_value FROM system_settings WHERE user_id = 1 AND config_key = 'urls' AND category = 'proxy';"
```

✅ autoads 用户已配置代理：
- US: iprocket.io (ROW)
- UK: iprocket.io (UK)
- CA: iprocket.io (CA)

### 2. 确保开发服务器运行

```bash
npm run dev
```

访问 http://localhost:3000 确认可正常登录。

## 测试步骤

### 方案1：通过浏览器UI测试（推荐）

#### 异步抓取测试

1. **打开浏览器**访问 http://localhost:3000
2. **登录**autoads账户
3. **创建新Offer**：
   - URL: `https://pboost.me/ILK1tG3`
   - Brand: `PBoost Test Product`
   - Target Country: `US`
   - 点击"创建Offer"
4. **立即查看创建的Offer详情页**
   - ✅ 应显示：**"产品信息后台异步抓取中..."**
   - ❌ 不应显示："产品信息等待抓取"
   - ❌ 不应有"开始抓取"按钮（只有failed状态才显示）
5. **观察服务器日志**（终端）
   - 应看到：`[OfferScraping] 触发异步抓取 Offer #XX`
   - 应看到：抓取进度日志
6. **等待1-2分钟**
   - 刷新页面，检查scrape_status是否变为 `completed` 或 `failed`
   - 检查产品信息是否已填充

#### 手动抓取测试（对比）

1. **创建另一个Offer**（相同URL或不同URL）
2. **在详情页点击"开始抓取"按钮**（如果有）
3. **观察抓取行为和结果**
4. **对比数据**：
   - 异步抓取的Offer和手动抓取的Offer
   - 检查品牌描述、产品亮点、目标受众、USP等字段
   - ✅ 应该完全一致（相同URL时）

### 方案2：数据库监控脚本

在创建Offer后，运行此脚本监控状态变化：

```bash
#!/bin/bash
OFFER_ID=$1

if [ -z "$OFFER_ID" ]; then
  echo "用法: $0 <offer_id>"
  exit 1
fi

echo "监控 Offer #$OFFER_ID 抓取状态..."
echo "按 Ctrl+C 停止监控"
echo ""

while true; do
  sqlite3 data/autoads.db "SELECT
    id,
    scrape_status,
    CASE WHEN brand_description IS NOT NULL THEN '✅' ELSE '❌' END as 品牌描述,
    CASE WHEN product_highlights IS NOT NULL THEN '✅' ELSE '❌' END as 产品亮点,
    CASE WHEN target_audience IS NOT NULL THEN '✅' ELSE '❌' END as 目标受众,
    scrape_error
  FROM offers WHERE id = $OFFER_ID;"

  echo ""
  sleep 3
done
```

保存为 `scripts/monitor-offer.sh` 并运行：
```bash
chmod +x scripts/monitor-offer.sh
./scripts/monitor-offer.sh <offer_id>
```

## 预期行为

### 异步抓取（创建Offer后）

1. **立即**（setImmediate触发）
   - 后台调用 `triggerOfferScraping()`
   - 状态保持 `pending`（UI显示"产品信息后台异步抓取中..."）

2. **1-3秒内**
   - `performScrapeAndAnalysis()` 开始执行
   - 状态变为 `in_progress`
   - 服务器日志显示抓取进度

3. **1-2分钟后**
   - 抓取完成，状态变为 `completed` 或 `failed`
   - 产品信息字段已填充（成功时）

### 手动抓取（点击"开始抓取"）

1. **点击按钮后**
   - HTTP POST `/api/offers/[id]/scrape`
   - 调用 `performScrapeAndAnalysis()`（与异步相同）
   - UI显示"抓取中..."

2. **抓取过程**
   - 完全相同的逻辑
   - 完全相同的数据处理

3. **结果对比**
   - ✅ 相同URL应产生相同数据
   - ✅ 相同错误处理
   - ✅ 相同数据库更新

## 故障排查

### 问题1: 状态一直是pending，没有变化

**原因**：异步抓取没有被触发

**检查**：
```bash
# 查看服务器日志是否有：
# [OfferScraping] 触发异步抓取 Offer #XX
```

**解决**：
- 确认创建Offer时通过API路由（不是直接插入数据库）
- 检查 `/src/app/api/offers/route.ts` 的 POST handler

### 问题2: 抓取失败，错误信息："代理服务不可用"

**原因**：代理URL验证失败

**检查**：
```bash
# 测试代理URL是否可访问
curl -v "https://api.iprocket.io/api?username=com49692430&password=Qxi9V59e3kNOW6pnRi3i&cc=ROW&ips=1&type=-res-&proxyType=http&responseType=txt"
```

**解决**：
- 检查代理服务是否正常
- 检查网络连接
- 临时禁用代理测试（修改 `isProxyEnabled` 返回false）

### 问题3: 异步和手动结果不一致

**原因**：这不应该发生（现在使用相同函数）

**检查**：
```typescript
// /src/lib/offer-scraping.ts 应该导入并调用：
import { performScrapeAndAnalysis } from '../app/api/offers/[id]/scrape/route'

export function triggerOfferScraping(...) {
  performScrapeAndAnalysis(offerId, userId, url, brand)
}
```

## 成功标准

- ✅ 创建Offer后，立即看到"产品信息后台异步抓取中..."
- ✅ 服务器日志显示 `[OfferScraping] 触发异步抓取`
- ✅ 1-2分钟内状态变为 `completed`
- ✅ 产品信息字段完整填充
- ✅ 异步抓取和手动抓取结果一致（相同URL时）
- ✅ 只有 `failed` 状态才显示"开始抓取"按钮

## 测试记录

| Offer ID | 抓取方式 | 状态 | 耗时 | 结果 | 备注 |
|---------|---------|------|------|------|------|
| 48      | 异步    | pending | 120s+ | ❌ 未触发 | 直接插入DB，未通过API |
|         |         |      |      |      |      |

请在实际测试时填写此表格。
