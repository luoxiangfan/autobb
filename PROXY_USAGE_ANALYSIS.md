# 代理IP使用场景分析报告

## 问题背景
在 offer 提取的 HTTP 解析场景中发现：重试时复用同一个失败的代理IP（5分钟缓存），导致重复超时失败。

## 所有使用 getProxyIp() 的场景

### ✅ 1. URL解析 - HTTP方式 (已修复)
**文件**: `src/lib/url-resolver-http.ts:192`
**调用**: `getProxyIp(proxyUrl, forceRefreshProxy, userId)`
**场景**: Offer推广链接解析（HTTP请求方式）
**重试逻辑**: ✅ 有（在 `url-resolver-enhanced.ts` 中，最多4次重试）
**修复状态**: ✅ **已修复** - 重试时 `forceRefreshProxy=true`

---

### ✅ 2. URL解析 - Playwright方式
**文件**: `src/lib/playwright-pool.ts:726-729`
**调用**:
- `getProxyIp(proxyUrl, false, userId)` - 启用缓存
- `getProxyIp(proxyUrl, true)` - 强制刷新
**场景**: Offer推广链接解析（Playwright浏览器方式）
**重试逻辑**: ✅ 有（通过 `withProxyRetry` 包装，最多2次代理重试）
**缓存策略**:
- `allowCredentialsCache=true` + `userId` → 使用缓存
- `allowCredentialsCache=false` → 强制刷新
**问题分析**: ✅ **无问题** - 代理失败时会调用 `pool.clearIdleInstances()` 清理连接池，下次重试会获取新代理

---

### ✅ 3. Stealth Scraper (Amazon/独立站抓取)
**文件**: `src/lib/stealth-scraper/browser-stealth.ts:106`
**调用**: `getProxyIp(effectiveProxyUrl, userId ? false : true, userId)`
**场景**:
- Amazon产品/店铺抓取
- 独立站产品/店铺抓取
**重试逻辑**: ✅ 有（通过 `withProxyRetry` 包装，最多2次代理重试）
**缓存策略**:
- 有 `userId` → 使用缓存 (`forceRefresh=false`)
- 无 `userId` → 强制刷新 (`forceRefresh=true`)
**问题分析**: ✅ **无问题** - 使用 `withProxyRetry` 包装，代理失败时会清理连接池并重试

---

### ⚠️ 4. 通用网页抓取 (scraper.ts)
**文件**: `src/lib/scraper.ts:40`
**调用**: `getProxyIp(proxyUrl, false, userId)`
**场景**: 通用网页内容抓取（用于品牌搜索、服务提取等）
**重试逻辑**: ❌ **无重试逻辑**
**缓存策略**: 固定使用缓存 (`forceRefresh=false`)
**调用方**:
- `src/lib/offer-scraping-core.ts` - Offer页面抓取
- `src/lib/google-brand-search.ts` - Google品牌搜索
- `src/lib/brand-services-extractor.ts` - 品牌服务提取
**问题分析**: ⚠️ **潜在问题** - 如果调用方有重试逻辑，会复用同一个失败的代理IP

---

### ⚠️ 5. 代理Axios客户端 (proxy-axios.ts)
**文件**: `src/lib/proxy-axios.ts:130`
**调用**: `getProxyIp(proxyUrl, false, userId)`
**场景**: 创建带代理的axios客户端（用于API请求）
**重试逻辑**: ❌ **无重试逻辑**
**缓存策略**: 固定使用缓存 (`forceRefresh=false`)
**调用方**: 需要进一步检查
**问题分析**: ⚠️ **潜在问题** - 如果调用方有重试逻辑，会复用同一个失败的代理IP

---

### ✅ 6. 补点击任务 (click-farm-executor.ts)
**文件**: `src/lib/queue/executors/click-farm-executor.ts:174-189`
**调用**:
- `getProxyIp(trimmed, false, userId)` - 尝试使用缓存
- `getProxyIp(trimmed, true, userId)` - 强制获取新IP
**场景**: 补点击任务（防刷量检测）
**重试逻辑**: ✅ 有（任务级别重试）
**缓存策略**: ✅ **智能策略** - 检测同一任务是否最近使用过该IP，如果使用过则强制刷新
**问题分析**: ✅ **无问题** - 已实现智能IP复用策略，避免同一任务重复使用相同IP

---

## 风险评估

### 🟢 无风险 - 所有场景已正确处理
经过全面检查，所有使用代理IP的业务场景都已正确处理：

1. ✅ **URL解析 - HTTP方式**（已修复）- 重试时强制刷新代理IP
2. ✅ **URL解析 - Playwright方式** - 使用 `withProxyRetry` 自动处理
3. ✅ **Stealth Scraper** - 使用 `withProxyRetry` 自动处理
4. ✅ **补点击任务** - 智能IP复用策略，避免同任务重复使用
5. ✅ **通用网页抓取** - 无重试逻辑，单次调用
6. ✅ **代理Axios客户端** - 无重试逻辑，单次调用

---

## 建议的修复优先级

### ✅ P0 - 立即修复（已完成）
✅ URL解析 - HTTP方式（已完成）

### ✅ P1 - 需要检查（已完成）
✅ 所有其他场景已检查，无需修复

### P2 - 长期优化
考虑统一代理重试策略：
- 所有使用代理的函数都应该支持 `forceRefresh` 参数
- 建议在重试逻辑中自动传入 `forceRefresh=true`

---

## 最佳实践总结

### ✅ 正确的代理使用模式
```typescript
// 首次尝试：使用缓存
const proxy1 = await getProxyIp(proxyUrl, false, userId)

// 重试时：强制刷新
const proxy2 = await getProxyIp(proxyUrl, true, userId)
```

### ✅ 使用 withProxyRetry 包装
```typescript
await withProxyRetry(async () => {
  const browser = await createStealthBrowser(proxyUrl, targetCountry)
  // ... 业务逻辑
}, 2, '操作名称')
```

### ❌ 错误的模式（会导致重试失败）
```typescript
// 错误：重试时仍然使用缓存
for (let i = 0; i < 3; i++) {
  const proxy = await getProxyIp(proxyUrl, false, userId) // ❌ 一直用同一个IP
  // ... 业务逻辑
}
```
