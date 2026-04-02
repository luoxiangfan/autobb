# Google Ads API 授权修改 - 部署和测试指南

## 部署步骤

### 1. 备份数据库

在运行迁移之前，务必备份现有数据库：

```bash
# SQLite（开发环境）
cd /home/admin/openclaw/workspace/autobb
cp data/autoads.db data/autoads.db.backup.$(date +%Y%m%d)

# PostgreSQL（生产环境）
pg_dump autoads > autoads.backup.$(date +%Y%m%d).sql
```

### 2. 运行数据库迁移

```bash
# SQLite（开发环境）
npm run db:migrate

# PostgreSQL（生产环境）
DATABASE_URL="postgresql://user:password@host:5432/autoads" npm run db:migrate
```

### 3. 验证迁移

检查新增的表是否创建成功：

```bash
# SQLite
sqlite3 data/autoads.db ".tables"
# 应看到：
# google_ads_shared_oauth_configs
# google_ads_user_oauth_bindings
# google_ads_user_sa_bindings

# 检查表结构
sqlite3 data/autoads.db ".schema google_ads_shared_oauth_configs"
sqlite3 data/autoads.db ".schema google_ads_user_oauth_bindings"
sqlite3 data/autoads.db ".schema google_ads_user_sa_bindings"

# PostgreSQL
psql autoads -c "\dt"
psql autoads -c "\d google_ads_shared_oauth_configs"
```

### 4. 重启应用

```bash
# 开发环境
npm run dev

# 生产环境
npm run build
npm start

# 或使用 PM2
pm2 restart autobb
```

### 5. 验证部署

访问设置页面，确认没有错误：
```
http://localhost:3000/settings?category=google_ads
```

## 测试流程

### 测试场景 1: 管理员创建 OAuth 配置并绑定用户

#### 步骤 1: 管理员创建 OAuth 配置

访问管理员页面：
```
http://localhost:3000/admin/google-ads-config
```

点击"新建" → "OAuth 配置"，填写：
- 配置名称：测试 OAuth 配置
- Client ID: `xxx.apps.googleusercontent.com`
- Client Secret: `xxx`
- Developer Token: `xxx`
- Login Customer ID: `1234567890`

#### 步骤 2: 绑定用户

在 OAuth 配置卡片上点击"绑定用户"，输入用户 ID（例如：1），点击"绑定"。

看到成功提示："用户绑定成功"

#### 步骤 3: 用户登录后查看配置

使用被绑定的用户账号登录，访问设置页面：
```
http://localhost:3000/settings?category=google_ads
```

应该看到：
- "Google Ads OAuth 授权"卡片
- 显示配置名称和 MCC ID
- "点击授权 Google Ads"按钮

#### 步骤 4: 用户点击授权

点击"点击授权 Google Ads"按钮

系统跳转到 Google 授权页面 → 用户登录并授权 → 回调到设置页面

看到成功提示："✅ OAuth 授权成功！Refresh Token 已保存"

#### 步骤 5: 验证授权状态

刷新设置页面，应该看到：
- "Google Ads 已连接"卡片（绿色）
- 显示授权时间
- "重新授权"按钮

### 测试场景 2: 管理员修改配置后用户需要重新授权

#### 步骤 1: 管理员修改 OAuth 配置

访问管理员页面，找到测试配置，点击"编辑"（需要实现编辑功能，或先删除再创建）

修改 Client ID 或 Developer Token

#### 步骤 2: 用户查看状态

用户刷新设置页面，应该看到：
- "管理员已更新配置，需要重新授权"警告
- "重新授权 Google Ads"按钮

### 测试场景 3: 管理员创建服务账号并绑定用户

#### 步骤 1: 管理员创建服务账号

访问管理员页面，点击"新建" → "服务账号"，填写：
- 配置名称：测试服务账号
- MCC Customer ID: `1234567890`
- Developer Token: `xxx`
- 服务账号 JSON: `{"type":"service_account",...}`

#### 步骤 2: 绑定用户

在服务账号卡片上点击"绑定用户"，输入用户 ID，点击"绑定"。

#### 步骤 3: 用户登录后查看配置

用户访问设置页面，应该看到：
- "Google Ads 已连接（服务账号）"卡片（紫色）
- 显示服务账号名称、MCC ID、服务账号邮箱
- "已绑定服务账号，无需额外授权，可直接使用"提示

### 测试场景 4: 管理员删除配置

#### 步骤 1: 尝试删除有绑定的配置

管理员点击"删除"按钮

应该看到错误提示："无法删除，仍有 X 个用户绑定"

#### 步骤 2: 先解绑用户再删除

需要先实现解绑功能，或直接在数据库操作：

```sql
-- SQLite
UPDATE google_ads_user_oauth_bindings 
SET is_active = 0 
WHERE oauth_config_id = '配置 ID';

-- 然后再删除配置
DELETE FROM google_ads_shared_oauth_configs 
WHERE id = '配置 ID';
```

## API 测试

### 使用 curl 测试 API

#### 1. 获取 OAuth 配置列表

```bash
curl -X GET http://localhost:3000/api/admin/google-ads/oauth-config \
  -H "Cookie: auth_token=ADMIN_TOKEN"
```

#### 2. 创建 OAuth 配置

```bash
curl -X POST http://localhost:3000/api/admin/google-ads/oauth-config \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=ADMIN_TOKEN" \
  -d '{
    "name": "测试配置",
    "client_id": "xxx.apps.googleusercontent.com",
    "client_secret": "xxx",
    "developer_token": "xxx",
    "login_customer_id": "1234567890"
  }'
```

#### 3. 绑定用户

```bash
curl -X POST http://localhost:3000/api/admin/google-ads/oauth-config/CONFIG_ID/bind-user \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=ADMIN_TOKEN" \
  -d '{"user_id": 1}'
```

#### 4. 用户获取配置状态

```bash
curl -X GET http://localhost:3000/api/google-ads/my-config \
  -H "Cookie: auth_token=USER_TOKEN"
```

#### 5. 用户启动授权

```bash
curl -X GET http://localhost:3000/api/google-ads/authorize/start \
  -H "Cookie: auth_token=USER_TOKEN"
```

## 数据库验证

### 检查 OAuth 配置

```sql
SELECT id, name, client_id, login_customer_id, is_active, version
FROM google_ads_shared_oauth_configs;
```

### 检查用户绑定状态

```sql
SELECT 
  b.id,
  b.user_id,
  u.email,
  b.oauth_config_id,
  b.refresh_token,
  b.authorized_at,
  b.needs_reauth,
  b.is_active
FROM google_ads_user_oauth_bindings b
LEFT JOIN users u ON b.user_id = u.id;
```

### 检查服务账号绑定

```sql
SELECT 
  b.id,
  b.user_id,
  u.email,
  b.service_account_id,
  sa.name,
  sa.mcc_customer_id,
  b.is_active
FROM google_ads_user_sa_bindings b
LEFT JOIN users u ON b.user_id = u.id
LEFT JOIN google_ads_service_accounts sa ON b.service_account_id = sa.id;
```

## 故障排查

### 问题 1: 用户看不到配置

**检查点**:
1. 管理员是否创建了配置
2. 是否绑定了该用户
3. 配置是否激活

```sql
-- 检查绑定
SELECT * FROM google_ads_user_oauth_bindings WHERE user_id = 1;

-- 检查配置
SELECT * FROM google_ads_shared_oauth_configs WHERE is_active = 1;
```

### 问题 2: 授权后仍然显示需要授权

**检查点**:
1. OAuth 回调是否正确保存 refresh_token
2. `needs_reauth` 字段是否设置为 0

```sql
SELECT refresh_token, needs_reauth, authorized_at 
FROM google_ads_user_oauth_bindings 
WHERE user_id = 1;
```

如果 `needs_reauth` 仍然是 1，手动更新：

```sql
UPDATE google_ads_user_oauth_bindings 
SET needs_reauth = 0 
WHERE user_id = 1;
```

### 问题 3: 管理员页面 404

**原因**: 页面路径不正确

**解决**: 确认页面文件位置：
```
src/app/(app)/admin/google-ads-config/page.tsx
```

访问 URL 应该是：
```
http://localhost:3000/admin/google-ads-config
```

### 问题 4: API 返回 401

**原因**: 权限验证失败

**解决**: 
1. 检查用户是否是管理员（需要添加 `is_admin` 字段检查）
2. 确认 cookie 中包含有效的 `auth_token`

## 回滚步骤

如果部署后出现问题需要回滚：

### 1. 停止应用

```bash
pm2 stop autobb
# 或
npm run dev (然后 Ctrl+C)
```

### 2. 恢复数据库

```bash
# SQLite
cp data/autoads.db.backup.YYYYMMDD data/autoads.db

# PostgreSQL
psql autoads < autoads.backup.YYYYMMDD.sql
```

### 3. 恢复代码

```bash
git checkout HEAD -- src/
```

### 4. 重启应用

```bash
pm2 start autobb
# 或
npm run dev
```

## 性能优化建议

### 1. 添加索引

确保以下索引已创建：

```sql
CREATE INDEX IF NOT EXISTS idx_user_oauth_bindings_user ON google_ads_user_oauth_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_oauth_bindings_config ON google_ads_user_oauth_bindings(oauth_config_id);
CREATE INDEX IF NOT EXISTS idx_user_sa_bindings_user ON google_ads_user_sa_bindings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sa_bindings_sa ON google_ads_user_sa_bindings(service_account_id);
```

### 2. 缓存配置状态

可以在 Redis 或内存中缓存用户的配置状态，减少数据库查询：

```typescript
// 伪代码
const config = await cache.get(`user_config:${userId}`)
if (!config) {
  config = await db.query(...)
  await cache.set(`user_config:${userId}`, config, 300) // 5 分钟 TTL
}
```

### 3. 批量操作

如果需要批量绑定用户，可以添加批量 API：

```typescript
POST /api/admin/google-ads/oauth-config/:id/bind-users
{
  "user_ids": [1, 2, 3, 4, 5]
}
```

## 安全建议

### 1. 管理员权限验证

在所有管理员 API 中添加权限检查：

```typescript
async function getAdminUser(request: NextRequest) {
  const userId = getUserIdFromRequest(request)
  if (!userId) return null
  
  const user = await findUserById(userId)
  if (!user?.is_admin) return null  // 添加 is_admin 检查
  
  return user
}
```

### 2. 审计日志

记录所有管理员操作：

```typescript
await db.exec(`
  INSERT INTO admin_audit_logs (
    user_id, action, target_type, target_id, details, created_at
  ) VALUES (?, ?, ?, ?, ?, NOW())
`, [admin.id, 'CREATE_OAUTH_CONFIG', 'oauth_config', id, JSON.stringify({ name }), nowFunc])
```

### 3. 敏感信息加密

确保所有敏感字段都已加密：

```typescript
import { encrypt, decrypt } from '@/lib/crypto'

// 保存时加密
const encryptedClientSecret = encrypt(client_secret)

// 读取时解密
const clientSecret = decrypt(encryptedClientSecret)
```

## 下一步工作

### 功能完善

- [ ] 添加 OAuth 配置编辑功能
- [ ] 添加用户解绑功能（UI 按钮）
- [ ] 添加配置测试功能（验证凭证是否有效）
- [ ] 添加批量绑定用户功能
- [ ] 添加用户搜索功能（绑定用户时选择）

### 文档完善

- [ ] 管理员操作手册
- [ ] 用户操作手册
- [ ] API 文档更新
- [ ] 故障排查手册

### 监控和告警

- [ ] 添加配置变更通知（邮件/短信）
- [ ] 添加授权失败监控
- [ ] 添加 API 调用量监控

## 联系支持

如有问题，请查看：
- 实现详情：`GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md`
- 快速参考：`QUICK_REFERENCE.md`
- 完整计划：`GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md`
