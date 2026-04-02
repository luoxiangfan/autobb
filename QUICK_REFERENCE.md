# Google Ads API 授权修改 - 快速参考

## 核心改动

### 问题
❌ 当前：用户需要自己登录并填写所有 Google Ads API 配置

### 解决方案
✅ 修改后：
- **OAuth 模式**：管理员配置 → 绑定用户 → 用户点击授权（一次完成）
- **服务账号模式**：管理员配置 → 绑定用户 → 用户直接使用（无需授权）

## 数据库变更

### 新增表
```sql
-- 1. 共享 OAuth 配置（管理员创建）
google_ads_shared_oauth_configs
  - id, name, client_id, client_secret, developer_token, login_customer_id
  - created_by (管理员 ID), version, is_active

-- 2. 用户 OAuth 绑定
google_ads_user_oauth_bindings  
  - user_id, oauth_config_id, refresh_token, authorized_at, needs_reauth

-- 3. 用户服务账号绑定
google_ads_user_sa_bindings
  - user_id, service_account_id, bound_by (管理员 ID), bound_at
```

### 修改表
```sql
-- 服务账号表增加字段
google_ads_service_accounts
  - is_shared (是否共享配置)
  - description (描述)
```

## API 端点

### 管理员端
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/google-ads/oauth-config` | 获取 OAuth 配置列表 |
| POST | `/api/admin/google-ads/oauth-config` | 创建 OAuth 配置 |
| PUT | `/api/admin/google-ads/oauth-config/:id` | 更新配置（自动标记重新授权） |
| DELETE | `/api/admin/google-ads/oauth-config/:id` | 删除配置 |
| POST | `/api/admin/google-ads/oauth-config/:id/bind-user` | 绑定用户 |
| DELETE | `/api/admin/google-ads/oauth-config/:id/unbind-user/:userId` | 解绑用户 |
| GET | `/api/admin/google-ads/service-account` | 获取服务账号列表 |
| POST | `/api/admin/google-ads/service-account` | 创建服务账号 |
| DELETE | `/api/admin/google-ads/service-account/:id` | 删除服务账号 |
| POST | `/api/admin/google-ads/service-account/:id/bind-user` | 绑定用户 |

### 用户端
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/google-ads/my-config` | 获取我的配置状态 |
| GET | `/api/google-ads/authorize/start` | 启动 OAuth 授权 |

## 工作流程

### OAuth 授权流程
```
管理员：创建配置 → 绑定用户
           ↓
用户：查看状态 → 点击授权 → Google 登录 → 完成
           ↓
系统：保存 refresh_token → 标记已授权
```

### 服务账号流程
```
管理员：创建服务账号 → 绑定用户
           ↓
用户：查看状态 → 直接使用（无需操作）
```

## 前端修改要点

### 用户设置页面 (`settings/page.tsx`)

**替换原有的手动输入表单为状态显示**:

```tsx
// 原来（需要删除）:
<Input value={formData.google_ads?.client_id} />
<Input value={formData.google_ads?.client_secret} />
<Input value={formData.google_ads?.developer_token} />
<Input value={formData.google_ads?.login_customer_id} />
<Button onClick={handleStartOAuth}>开始授权</Button>

// 现在（需要添加）:
{authStatus === 'no_config' && <Alert>请联系管理员分配配置</Alert>}
{authStatus === 'oauth_needs_auth' && (
  <Button onClick={handleAuthorize}>点击授权 Google Ads</Button>
)}
{authStatus === 'oauth_authorized' && <Card>✓ 已授权</Card>}
{authStatus === 'service_account_bound' && <Card>✓ 服务账号已绑定</Card>}
```

### 管理员页面（新建）

**路径**: `src/app/(app)/admin/google-ads-config/page.tsx`

**功能**:
- 列表显示所有 OAuth 配置和服务账号
- 创建/编辑/删除按钮
- 绑定用户界面（下拉选择用户）
- 查看绑定状态（已授权用户数）

## 关键代码片段

### 1. 管理员创建 OAuth 配置
```typescript
POST /api/admin/google-ads/oauth-config
{
  "name": "主账户配置",
  "client_id": "xxx.apps.googleusercontent.com",
  "client_secret": "xxx",
  "developer_token": "xxx",
  "login_customer_id": "1234567890"
}
```

### 2. 管理员绑定用户
```typescript
POST /api/admin/google-ads/oauth-config/{config_id}/bind-user
{
  "user_id": 1
}
```

### 3. 用户获取配置状态
```typescript
GET /api/google-ads/my-config

Response:
{
  "has_config": true,
  "auth_type": "oauth",
  "oauth": {
    "name": "主账户配置",
    "needs_reauth": false,
    "authorized_at": "2026-04-02T10:00:00Z"
  }
}
```

### 4. 用户启动授权
```typescript
GET /api/google-ads/authorize/start

Response:
{
  "auth_url": "https://accounts.google.com/...",
  "binding_id": "..."
}
```

## 配置变更处理

**管理员修改 OAuth 配置时**:
1. 自动增加 `version` 字段
2. 所有绑定用户的 `needs_reauth` 标记为 1
3. 用户下次看到"需要重新授权"提示

**管理员删除配置时**:
1. 检查是否有活跃绑定
2. 有绑定时禁止删除
3. 必须先解绑所有用户

## 安全特性

- ✅ 所有敏感字段加密存储（client_secret, developer_token, refresh_token, private_key）
- ✅ 管理员权限验证（TODO: 添加 `is_admin` 检查）
- ✅ 用户数据隔离（每个用户独立绑定）
- ✅ 配置版本追踪（自动标记重新授权）

## 测试命令

```bash
# 1. 运行数据库迁移
npm run db:migrate

# 2. 测试管理员 API（创建配置）
curl -X POST http://localhost:3000/api/admin/google-ads/oauth-config \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=ADMIN_TOKEN" \
  -d '{"name":"测试","client_id":"xxx","client_secret":"xxx","developer_token":"xxx","login_customer_id":"1234567890"}'

# 3. 测试绑定用户
curl -X POST http://localhost:3000/api/admin/google-ads/oauth-config/CONFIG_ID/bind-user \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=ADMIN_TOKEN" \
  -d '{"user_id":1}'

# 4. 测试用户获取配置
curl http://localhost:3000/api/google-ads/my-config \
  -H "Cookie: auth_token=USER_TOKEN"

# 5. 测试用户授权
curl http://localhost:3000/api/google-ads/authorize/start \
  -H "Cookie: auth_token=USER_TOKEN"
```

## 部署步骤

1. **备份数据库**
   ```bash
   sqlite3 data/autoads.db ".backup 'backup.db'"
   ```

2. **运行迁移**
   ```bash
   npm run db:migrate
   ```

3. **验证迁移**
   ```bash
   sqlite3 data/autoads.db ".tables"
   # 应看到新增的 3 个表
   ```

4. **重启应用**
   ```bash
   npm run build
   npm start
   ```

5. **测试功能**
   - 管理员创建配置
   - 绑定用户
   - 用户授权
   - API 调用

## 故障排查

### 问题：用户看不到配置
**检查**:
1. 管理员是否创建了配置
2. 是否绑定了该用户
3. 配置是否激活（is_active = 1）

```sql
SELECT * FROM google_ads_user_oauth_bindings WHERE user_id = 1;
SELECT * FROM google_ads_shared_oauth_configs WHERE is_active = 1;
```

### 问题：授权后仍然显示需要授权
**检查**:
1. OAuth 回调是否正确保存 refresh_token
2. `needs_reauth` 字段是否设置为 0

```sql
SELECT refresh_token, needs_reauth, authorized_at 
FROM google_ads_user_oauth_bindings 
WHERE user_id = 1;
```

### 问题：管理员修改配置后用户未标记重新授权
**检查**:
1. PUT API 是否正确更新 version
2. 是否执行了 UPDATE google_ads_user_oauth_bindings SET needs_reauth = 1

## 回滚方案

如果出现问题需要回滚：

1. **删除新增的表**
   ```sql
   DROP TABLE IF EXISTS google_ads_user_sa_bindings;
   DROP TABLE IF EXISTS google_ads_user_oauth_bindings;
   DROP TABLE IF EXISTS google_ads_shared_oauth_configs;
   ```

2. **恢复服务账号表**
   ```sql
   ALTER TABLE google_ads_service_accounts DROP COLUMN is_shared;
   ALTER TABLE google_ads_service_accounts DROP COLUMN description;
   ```

3. **恢复原有代码**
   ```bash
   git checkout HEAD -- src/app/(app)/settings/page.tsx
   git checkout HEAD -- src/app/api/auth/google-ads/callback/route.ts
   ```

## 联系支持

- 项目文档：`/docs`
- 实现详情：`GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md`
- 完整计划：`GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md`
