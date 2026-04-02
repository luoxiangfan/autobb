# Google Ads API 授权修改 - 实现总结

## 需求回顾

**原始需求**：
- 目前用户需要自己登录并填写 Google Ads API 配置
- 需要修改为：
  1. **OAuth 用户授权方式**：管理员填写配置并选择用户 → 用户只需点击授权（一次授权）
  2. **服务账号认证方式**：管理员填写配置并绑定用户 → 用户无需额外操作

## 已完成的修改

### 1. 数据库迁移

#### SQLite 迁移文件
- **文件**: `migrations/230_add_shared_oauth_configs.sql`
- **新增表**:
  - `google_ads_shared_oauth_configs` - 共享 OAuth 配置表（管理员创建）
  - `google_ads_user_oauth_bindings` - 用户 OAuth 绑定表
  - `google_ads_user_sa_bindings` - 用户服务账号绑定表
- **修改表**:
  - `google_ads_service_accounts` - 增加 `is_shared` 和 `description` 字段

#### PostgreSQL 迁移文件
- **文件**: `pg-migrations/230_add_shared_oauth_configs.pg.sql`
- 内容与 SQLite 版本相同，使用 PostgreSQL 语法

### 2. 管理员端 API

#### OAuth 配置管理
- **路由**: `/api/admin/google-ads/oauth-config`
- **方法**:
  - `GET` - 获取所有共享 OAuth 配置列表
  - `POST` - 创建新的 OAuth 配置
  - `PUT /:id` - 更新 OAuth 配置（自动标记用户需要重新授权）
  - `DELETE /:id` - 删除 OAuth 配置（软删除）

#### OAuth 用户绑定管理
- **路由**: `/api/admin/google-ads/oauth-config/[id]`
- **方法**:
  - `GET` - 获取 OAuth 配置的所有用户绑定
  - `POST /bind-user` - 将 OAuth 配置绑定到用户
  - `DELETE /unbind-user/:userId` - 解除用户绑定

#### 服务账号管理
- **路由**: `/api/admin/google-ads/service-account`
- **方法**:
  - `GET` - 获取所有共享服务账号列表
  - `POST` - 创建共享服务账号
  - `DELETE /:id` - 删除服务账号

#### 服务账号用户绑定管理
- **路由**: `/api/admin/google-ads/service-account/[id]`
- **方法**:
  - `GET` - 获取服务账号的所有用户绑定
  - `POST /bind-user` - 将服务账号绑定到用户
  - `DELETE /unbind-user/:userId` - 解除用户绑定

### 3. 用户端 API

#### 获取我的配置
- **路由**: `/api/google-ads/my-config`
- **方法**: `GET`
- **返回**:
  ```json
  {
    "has_config": true,
    "auth_type": "oauth",
    "oauth": {
      "config_id": "...",
      "name": "主账户配置",
      "client_id": "...",
      "login_customer_id": "1234567890",
      "authorized_at": "2026-04-02T10:00:00Z",
      "needs_reauth": false,
      "has_refresh_token": true
    },
    "service_account": null,
    "needs_action": false,
    "action_type": null
  }
  ```

#### 启动 OAuth 授权
- **路由**: `/api/google-ads/authorize/start`
- **方法**: `GET`
- **返回**:
  ```json
  {
    "success": true,
    "data": {
      "auth_url": "https://accounts.google.com/...",
      "redirect_uri": "http://localhost:3000/api/google-ads/oauth/callback",
      "binding_id": "..."
    }
  }
  ```

### 4. OAuth 回调修改

- **路由**: `/api/auth/google-ads/callback`
- **修改内容**:
  - 支持共享配置模式（通过 state 参数中的 `binding_id` 识别）
  - 共享配置模式下，将 refresh_token 保存到 `google_ads_user_oauth_bindings` 表
  - 用户自配置模式下，保持原有逻辑

## 工作流程

### OAuth 用户授权流程

```
管理员操作:
1. 创建 OAuth 配置 (POST /api/admin/google-ads/oauth-config)
   - 填写：name, client_id, client_secret, developer_token, login_customer_id
   
2. 绑定用户 (POST /api/admin/google-ads/oauth-config/:id/bind-user)
   - 指定：user_id

用户操作:
3. 查看配置 (GET /api/google-ads/my-config)
   - 返回：需要授权 (needs_action: true, action_type: 'authorize')
   
4. 点击授权按钮 → 调用 (GET /api/google-ads/authorize/start)
   - 返回：auth_url
   
5. 跳转到 Google 授权页面
   - 用户登录并授权
   
6. 回调处理 (/api/auth/google-ads/callback)
   - 保存 refresh_token 到数据库
   - 重定向到设置页面（显示成功）

后续:
- 用户正常使用 Google Ads API（系统自动使用保存的 refresh_token）
- 管理员修改配置 → 用户 need_reauth 标记为 1
- 用户下次看到"需要重新授权"提示
```

### 服务账号认证流程

```
管理员操作:
1. 创建服务账号 (POST /api/admin/google-ads/service-account)
   - 填写：name, mcc_customer_id, developer_token, service_account_json
   
2. 绑定用户 (POST /api/admin/google-ads/service-account/:id/bind-user)
   - 指定：user_id

用户操作:
3. 查看配置 (GET /api/google-ads/my-config)
   - 返回：auth_type: 'service_account'
   - 无需任何操作，直接使用

后续:
- 用户正常使用 Google Ads API（系统使用服务账号认证）
- 管理员可以解除绑定或修改配置
```

## 待完成的前端修改

### 1. 管理员设置页面（新建）

**路径**: `src/app/(app)/admin/google-ads-config/page.tsx`

**功能**:
- 显示所有共享 OAuth 配置列表
- 创建/编辑/删除 OAuth 配置
- 显示所有共享服务账号列表
- 创建/删除服务账号
- 用户管理界面（绑定/解绑用户）

**UI 组件**:
```tsx
// OAuth 配置卡片
<Card>
  <CardHeader>
    <div className="flex justify-between items-center">
      <div>
        <h3>配置名称</h3>
        <p className="text-sm text-gray-500">Client ID: xxx</p>
        <p className="text-sm text-gray-500">MCC ID: 1234567890</p>
      </div>
      <div>
        <Badge>{bound_users_count} 个用户已绑定</Badge>
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <Button onClick={() => handleEdit(config)}>编辑</Button>
    <Button onClick={() => handleBindUser(config)}>绑定用户</Button>
    <Button variant="destructive" onClick={() => handleDelete(config)}>删除</Button>
  </CardContent>
</Card>
```

### 2. 用户设置页面修改

**路径**: `src/app/(app)/settings/page.tsx`

**Google Ads 部分修改**:

#### 当前状态（需要修改）:
```tsx
// 用户手动填写所有配置
<Input value={formData.google_ads?.client_id} onChange={...} />
<Input value={formData.google_ads?.client_secret} onChange={...} />
<Input value={formData.google_ads?.developer_token} onChange={...} />
<Input value={formData.google_ads?.login_customer_id} onChange={...} />
<Button onClick={handleStartGoogleAdsOAuth}>开始 OAuth 授权</Button>
```

#### 修改后状态:
```tsx
// 从 API 获取配置状态
useEffect(() => {
  fetch('/api/google-ads/my-config')
    .then(res => res.json())
    .then(data => {
      if (data.data.auth_type === 'service_account') {
        // 服务账号模式：显示已绑定
        setAuthStatus('service_account_bound')
      } else if (data.data.auth_type === 'oauth') {
        if (data.data.needs_action) {
          // OAuth 需要授权
          setAuthStatus('oauth_needs_auth')
        } else {
          // OAuth 已授权
          setAuthStatus('oauth_authorized')
        }
      } else {
        // 没有配置
        setAuthStatus('no_config')
      }
    })
}, [])

// 根据状态显示不同 UI
{authStatus === 'no_config' && (
  <Alert>
    <AlertTitle>暂无 Google Ads 配置</AlertTitle>
    <AlertDescription>
      请联系管理员为您分配 Google Ads API 配置
    </AlertDescription>
  </Alert>
)}

{authStatus === 'oauth_needs_auth' && (
  <Card>
    <CardHeader>
      <h3>Google Ads OAuth 授权</h3>
      <p>配置：{oauthConfig?.name}</p>
    </CardHeader>
    <CardContent>
      {oauthConfig?.needs_reauth && (
        <Alert variant="warning">
          配置已更新，需要重新授权
        </Alert>
      )}
      <Button onClick={handleAuthorize} className="w-full">
        点击授权 Google Ads
      </Button>
    </CardContent>
  </Card>
)}

{authStatus === 'oauth_authorized' && (
  <Card>
    <CardHeader>
      <h3>Google Ads 已连接</h3>
      <p>配置：{oauthConfig?.name}</p>
      <p className="text-sm text-green-600">
        ✓ 已授权于 {oauthConfig?.authorized_at}
      </p>
    </CardHeader>
    <CardContent>
      <Button variant="outline" onClick={handleReauthorize}>
        重新授权
      </Button>
    </CardContent>
  </Card>
)}

{authStatus === 'service_account_bound' && (
  <Card>
    <CardHeader>
      <h3>Google Ads 已连接（服务账号）</h3>
      <p>服务账号：{serviceAccount?.name}</p>
      <p className="text-sm text-green-600">
        ✓ 已绑定，无需授权
      </p>
    </CardHeader>
  </Card>
)}
```

### 3. 用户选择配置（可选功能）

如果管理员创建了多个配置，可以让用户选择：

**API**: `POST /api/google-ads/select-config`
```json
{
  "config_id": "...",
  "config_type": "oauth" // 或 "service_account"
}
```

## 测试步骤

### 1. 数据库迁移测试
```bash
# SQLite（开发环境）
cd /home/admin/openclaw/workspace/autobb
npm run db:migrate

# PostgreSQL（生产环境）
DATABASE_URL="postgresql://..." npm run db:migrate
```

### 2. 管理员 API 测试
```bash
# 创建 OAuth 配置
curl -X POST http://localhost:3000/api/admin/google-ads/oauth-config \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=..." \
  -d '{
    "name": "测试配置",
    "client_id": "xxx.apps.googleusercontent.com",
    "client_secret": "xxx",
    "developer_token": "xxx",
    "login_customer_id": "1234567890"
  }'

# 绑定用户
curl -X POST http://localhost:3000/api/admin/google-ads/oauth-config/{config_id}/bind-user \
  -H "Content-Type: application/json" \
  -H "Cookie: auth_token=..." \
  -d '{"user_id": 1}'

# 查看绑定列表
curl http://localhost:3000/api/admin/google-ads/oauth-config/{config_id}/bindings \
  -H "Cookie: auth_token=..."
```

### 3. 用户 API 测试
```bash
# 获取我的配置
curl http://localhost:3000/api/google-ads/my-config \
  -H "Cookie: auth_token=..."

# 启动授权
curl http://localhost:3000/api/google-ads/authorize/start \
  -H "Cookie: auth_token=..."
```

## 安全考虑

1. **敏感信息加密**:
   - client_secret, developer_token, refresh_token, service_account private_key 都使用 `encrypt()` 加密存储
   - 使用现有的 `@/lib/crypto` 模块

2. **权限控制**:
   - 管理员 API 需要验证管理员权限（TODO: 添加 `is_admin` 检查）
   - 用户只能访问自己的配置

3. **配置变更通知**:
   - 管理员修改 OAuth 配置后，自动标记所有绑定用户需要重新授权
   - 通过 `version` 字段追踪配置版本

## 回退机制

如果共享配置出现问题，用户仍然可以：
1. 使用自己的独立配置（现有的 settings 表）
2. 在设置页面切换到"自行配置"模式

## 下一步工作

1. **前端实现**:
   - [ ] 管理员配置管理页面
   - [ ] 用户设置页面修改
   - [ ] 授权状态显示组件

2. **权限完善**:
   - [ ] 添加管理员角色检查
   - [ ] 添加用户列表 API（用于绑定用户时选择）

3. **测试**:
   - [ ] 单元测试
   - [ ] 端到端测试
   - [ ] 性能测试（多用户场景）

4. **文档**:
   - [ ] 管理员操作指南
   - [ ] 用户操作指南
   - [ ] API 文档更新

## 文件清单

### 新增文件
```
migrations/230_add_shared_oauth_configs.sql
pg-migrations/230_add_shared_oauth_configs.pg.sql
src/app/api/admin/google-ads/oauth-config/route.ts
src/app/api/admin/google-ads/oauth-config/[id]/route.ts
src/app/api/admin/google-ads/service-account/route.ts
src/app/api/admin/google-ads/service-account/[id]/route.ts
src/app/api/google-ads/my-config/route.ts
src/app/api/google-ads/authorize/start/route.ts
GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md
GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md (本文件)
```

### 修改文件
```
src/app/api/auth/google-ads/callback/route.ts
src/app/(app)/settings/page.tsx (待修改)
```

## 联系与支持

如有问题或需要进一步的帮助，请参考：
- 项目文档：`/docs`
- API 文档：`/docs/API.md`
- 数据库文档：`/migrations/DATABASE_INITIALIZATION_GUIDE.md`
