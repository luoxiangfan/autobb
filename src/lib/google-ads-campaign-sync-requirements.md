# 需求：指定每个用户获取广告系列的 customerId

## 当前状态
- `google_ads_accounts` 表存储了每个用户的多个 Google Ads 账户（每个账户有一个 `customer_id`）
- 同步时会同步用户的所有活跃账户

## 需求
允许每个用户指定只同步特定的 `customer_id`，而不是所有账户。

## 实现方案

### 方案 1：系统设置（推荐）
在 `system_settings` 表中添加配置项：
- `category`: 'google_ads'
- `key`: 'sync_customer_ids'
- `value`: JSON 数组，如 `["1234567890", "0987654321"]`

### 方案 2：google_ads_accounts 表添加字段
在 `google_ads_accounts` 表添加 `sync_enabled` 字段：
```sql
ALTER TABLE google_ads_accounts ADD COLUMN sync_enabled BOOLEAN DEFAULT TRUE;
```

### 方案 3：手动触发时指定 customerId
通过 API 手动触发同步时，传递 `customerId` 参数。

## 推荐实现

采用**方案 1 + 方案 3**：
1. 系统设置允许用户配置要同步的 customerId 列表
2. 手动触发时也可以指定特定的 customerId

## 修改内容

### 1. 修改同步查询逻辑
在 `google-ads-campaign-sync.ts` 中：
```typescript
// 查询用户的 google_ads_accounts 时，过滤指定的 customer_id
const accounts = await db.query(
  `SELECT ... FROM google_ads_accounts
   WHERE user_id = ? 
     AND customer_id IN (${customerIds.join(',')})  -- 添加过滤
   ...`,
  [userId, ...customerIds]
)
```

### 2. 添加配置读取函数
```typescript
// 获取用户配置的同步 customerId 列表
async function getUserSyncCustomerIds(userId: number): Promise<string[]> {
  const setting = await db.queryOne(
    `SELECT value FROM system_settings
     WHERE user_id = ? AND category = 'google_ads' AND key = 'sync_customer_ids'`,
    [userId]
  )
  
  if (!setting?.value) return []  // 空表示同步所有账户
  
  try {
    const customerIds = JSON.parse(setting.value) as string[]
    return Array.isArray(customerIds) ? customerIds : []
  } catch {
    return []
  }
}
```

### 3. 修改调度器
在 `google-ads-campaign-sync-scheduler.ts` 中，入队时读取用户配置：
```typescript
const customerIds = await getUserSyncCustomerIds(userId)
await queue.enqueue('google-ads-campaign-sync', {
  userId,
  syncType: 'auto',
  customerIds: customerIds.length > 0 ? customerIds : undefined,  // 空则同步所有
}, userId)
```
