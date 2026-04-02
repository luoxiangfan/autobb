# Google Ads API 授权修改计划

## 需求概述

当前问题：用户需要自己登录并填写 Google Ads API 配置（OAuth 或服务账号）

目标修改：
1. **OAuth 用户授权方式**：管理员填写配置并选择用户 → 用户只需点击授权（一次授权）→ 管理员修改/删除配置需重新授权
2. **服务账号认证方式**：管理员填写配置并绑定用户 → 用户无需额外操作

## 当前架构分析

### 数据库表结构

#### google_ads_service_accounts 表
```sql
CREATE TABLE google_ads_service_accounts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  mcc_customer_id TEXT NOT NULL,
  developer_token TEXT NOT NULL,
  service_account_email TEXT NOT NULL,
  private_key TEXT NOT NULL,  -- 加密存储
  project_id TEXT,
  is_active INTEGER DEFAULT 1,
  api_access_level TEXT DEFAULT 'basic',
  created_at TEXT,
  updated_at TEXT
)
```

#### settings 表（用户配置）
- `google_ads.login_customer_id` - MCC 账户 ID
- `google_ads.client_id` - OAuth Client ID
- `google_ads.client_secret` - OAuth Client Secret
- `google_ads.developer_token` - Developer Token
- `google_ads.refresh_token` - OAuth Refresh Token（加密）

### 当前 API 路由

1. **OAuth 流程**
   - `POST /api/google-ads/oauth/start` - 启动 OAuth 授权
   - `GET /api/google-ads/oauth/callback` - OAuth 回调
   - 用户必须自己配置 client_id, client_secret, developer_token, login_customer_id

2. **服务账号流程**
   - `POST /api/google-ads/service-account` - 保存服务账号配置
   - `GET /api/google-ads/service-account` - 获取服务账号列表
   - `DELETE /api/google-ads/service-account?id=` - 删除服务账号
   - 每个用户独立配置自己的服务账号

## 修改方案

### 方案 A：管理员代配置 + 用户确认授权

#### 1. 新增数据库表

**google_ads_oauth_configs** - OAuth 配置表（管理员创建）
```sql
CREATE TABLE google_ads_oauth_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                    -- 配置名称
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,           -- 加密
  developer_token TEXT NOT NULL,         -- 加密
  login_customer_id TEXT NOT NULL,       -- MCC 账户 ID
  created_by INTEGER NOT NULL,           -- 管理员 ID
  created_at TEXT,
  updated_at TEXT,
  is_active INTEGER DEFAULT 1
)
```

**google_ads_user_oauth_bindings** - 用户 OAuth 绑定表
```sql
CREATE TABLE google_ads_user_oauth_bindings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  oauth_config_id TEXT NOT NULL REFERENCES google_ads_oauth_configs(id),
  refresh_token TEXT,                    -- 加密，用户授权后填入
  authorized_at TEXT,                    -- 用户授权时间
  needs_reauth INTEGER DEFAULT 0,        -- 是否需要重新授权
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(user_id, oauth_config_id)
)
```

**google_ads_user_service_account_bindings** - 用户服务账号绑定表
```sql
CREATE TABLE google_ads_user_service_account_bindings (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  service_account_id TEXT NOT NULL REFERENCES google_ads_service_accounts(id),
  bound_by INTEGER NOT NULL,             -- 管理员 ID
  bound_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT,
  updated_at TEXT,
  UNIQUE(user_id, service_account_id)
)
```

#### 2. 新增 API 路由

**管理员端：**
- `POST /api/admin/google-ads/oauth-config` - 创建 OAuth 配置
- `GET /api/admin/google-ads/oauth-config` - 获取 OAuth 配置列表
- `PUT /api/admin/google-ads/oauth-config/:id` - 更新 OAuth 配置
- `DELETE /api/admin/google-ads/oauth-config/:id` - 删除 OAuth 配置
- `POST /api/admin/google-ads/oauth-config/:id/bind-user` - 绑定用户
- `DELETE /api/admin/google-ads/oauth-config/:id/unbind-user/:userId` - 解绑用户

- `POST /api/admin/google-ads/service-account` - 创建服务账号配置
- `POST /api/admin/google-ads/service-account/:id/bind-user` - 绑定用户到服务账号
- `DELETE /api/admin/google-ads/service-account/:id/unbind-user/:userId` - 解绑用户

**用户端：**
- `GET /api/google-ads/my-config` - 获取我的 Google Ads 配置（自动判断 OAuth 或服务账号）
- `GET /api/google-ads/authorize` - 获取授权 URL（OAuth 模式）
- `POST /api/google-ads/authorize/callback` - OAuth 回调处理

#### 3. 修改设置页面 (`src/app/(app)/settings/page.tsx`)

**OAuth 模式：**
- 如果管理员已配置 OAuth → 显示"点击授权"按钮
- 授权成功后显示"已授权"状态
- 如果管理员修改配置 → 显示"需要重新授权"

**服务账号模式：**
- 如果管理员已绑定服务账号 → 显示"已绑定"状态
- 无需用户填写任何配置

### 方案 B：简化版（推荐）

不创建复杂的绑定表，而是：

1. **管理员创建共享配置**
   - OAuth 配置：保存在 `google_ads_shared_oauth_configs` 表
   - 服务账号：保存在现有的 `google_ads_service_accounts` 表，增加 `is_shared` 字段

2. **用户关联配置**
   - 用户设置页面的 Google Ads 配置改为"选择配置"下拉框
   - OAuth 模式：用户选择配置后点击授权 → 保存 refresh_token 到用户自己的 settings 表
   - 服务账号模式：用户选择配置 → 直接可用

3. **配置变更处理**
   - 管理员修改 OAuth 配置 → 所有关联用户的 `needs_reauth` 标记为 1
   - 用户下次登录时提示重新授权

## 实施步骤（选择方案 B - 简化版）

### Phase 1: 数据库迁移
- [ ] 创建 `google_ads_shared_oauth_configs` 表
- [ ] 修改 `google_ads_service_accounts` 表，增加 `is_shared` 字段
- [ ] 创建 `google_ads_user_config_selections` 表（用户选择的配置）

### Phase 2: 管理员端 API
- [ ] `POST /api/admin/google-ads/oauth-config` - 创建 OAuth 配置
- [ ] `GET /api/admin/google-ads/oauth-config` - 获取配置列表
- [ ] `PUT /api/admin/google-ads/oauth-config/:id` - 更新配置
- [ ] `DELETE /api/admin/google-ads/oauth-config/:id` - 删除配置
- [ ] `POST /api/admin/google-ads/service-account/:id/bind-user` - 绑定用户

### Phase 3: 用户端 API
- [ ] `GET /api/google-ads/available-configs` - 获取可用配置列表
- [ ] `POST /api/google-ads/select-config` - 选择配置
- [ ] `GET /api/google-ads/authorize/start` - 启动授权（使用共享配置）
- [ ] 修改现有的 OAuth 回调以支持共享配置

### Phase 4: 前端修改
- [ ] 管理员设置页面（新增）
- [ ] 用户设置页面修改（选择配置 + 授权按钮）
- [ ] 授权状态显示

### Phase 5: 测试与部署
- [ ] 单元测试
- [ ] 端到端测试
- [ ] 数据库迁移脚本
- [ ] 部署文档

## 关键决策点

1. **配置可见性**：管理员创建的配置是否对所有用户可见，还是需要显式分配？
   - 建议：显式分配，更安全

2. **配置数量**：一个用户可以绑定多少个配置？
   - 建议：OAuth 模式 1 个，服务账号模式可多个（但只有一个激活）

3. **配置更新**：管理员修改配置后，是否强制用户重新授权？
   - 建议：OAuth 配置变更（client_id/secret/developer_token）→ 强制重新授权
   - 仅修改名称/描述 → 不需要重新授权

4. **回退机制**：是否允许用户继续使用独立配置模式？
   - 建议：支持，用户可以选择"自行配置"模式

## 下一步

1. 确认需求细节（与管理员讨论）
2. 设计数据库 Schema
3. 编写迁移脚本
4. 实现 API
5. 实现前端
6. 测试
