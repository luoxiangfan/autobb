# Google Ads API 授权修改 - 文档索引

## 📚 文档导航

本文档集合提供了 Google Ads API 授权修改的完整信息，按使用场景分类：

### 🚀 快速开始

**我是管理员，想立即使用：**
→ 阅读 [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)

**我是开发者，需要部署到生产环境：**
→ 阅读 [`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md)

### 📖 完整文档

#### 1. 设计和计划

**[`GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md`](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md)**
- 需求分析
- 架构设计
- 数据库 Schema
- API 设计
- 实施步骤

**适合人群**: 架构师、技术负责人、需要了解完整设计的开发者

#### 2. 实现详情

**[`GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md`](./GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md)**
- 已完成的功能
- API 端点详解
- 工作流程说明
- 前端修改要点
- 测试步骤

**适合人群**: 开发者、测试人员、维护人员

#### 3. 快速参考

**[`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md)**
- 核心改动速览
- API 端点列表
- 工作流程图
- 测试命令
- 故障排查

**适合人群**: 日常使用者、需要快速查询的开发者

#### 4. 部署和测试

**[`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md)**
- 部署步骤
- 测试场景
- API 测试示例
- 数据库验证
- 回滚步骤

**适合人群**: DevOps、测试人员、部署工程师

#### 5. 完成总结

**[`COMPLETION_SUMMARY.md`](./COMPLETION_SUMMARY.md)**
- 已完成的工作
- 功能特性
- 文件清单
- 注意事项
- 未来扩展

**适合人群**: 项目管理者、审计人员、新加入的开发者

## 🎯 按角色查看文档

### 管理员/运营人员

**你需要做什么：**
1. 创建 OAuth 配置或服务账号
2. 绑定用户
3. 监控配置状态

**推荐阅读:**
1. [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) - 了解基本流程
2. [`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md) - 测试场景部分

### 开发者

**你需要做什么：**
1. 理解架构设计
2. 实现功能
3. 维护和扩展

**推荐阅读:**
1. [`GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md`](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md) - 完整设计
2. [`GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md`](./GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md) - 实现详情
3. [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) - 快速查询

### 测试人员

**你需要做什么：**
1. 测试各种场景
2. 验证功能正确性
3. 报告问题

**推荐阅读:**
1. [`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md) - 完整测试流程
2. [`QUICK_REFERENCE.md`](./QUICK_REFERENCE.md) - API 测试命令

### DevOps 工程师

**你需要做什么：**
1. 部署到生产环境
2. 监控运行状态
3. 处理故障

**推荐阅读:**
1. [`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md) - 部署和回滚
2. [`COMPLETION_SUMMARY.md`](./COMPLETION_SUMMARY.md) - 注意事项

## 📋 快速查询表

### API 端点

| 类型 | 端点 | 说明 | 文档 |
|------|------|------|------|
| 管理员 | `GET /api/admin/google-ads/oauth-config` | 获取 OAuth 配置列表 | [实现详情](./GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md) |
| 管理员 | `POST /api/admin/google-ads/oauth-config` | 创建 OAuth 配置 | [快速参考](./QUICK_REFERENCE.md) |
| 管理员 | `POST /api/admin/google-ads/oauth-config/:id/bind-user` | 绑定用户 | [快速参考](./QUICK_REFERENCE.md) |
| 管理员 | `GET /api/admin/google-ads/service-account` | 获取服务账号列表 | [实现详情](./GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md) |
| 管理员 | `POST /api/admin/google-ads/service-account` | 创建服务账号 | [实现详情](./GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md) |
| 用户 | `GET /api/google-ads/my-config` | 获取我的配置 | [快速参考](./QUICK_REFERENCE.md) |
| 用户 | `GET /api/google-ads/authorize/start` | 启动授权 | [快速参考](./QUICK_REFERENCE.md) |

### 数据库表

| 表名 | 说明 | 文档 |
|------|------|------|
| `google_ads_shared_oauth_configs` | 共享 OAuth 配置 | [设计计划](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md) |
| `google_ads_user_oauth_bindings` | 用户 OAuth 绑定 | [设计计划](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md) |
| `google_ads_user_sa_bindings` | 用户服务账号绑定 | [设计计划](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md) |
| `google_ads_service_accounts` | 服务账号表（修改） | [设计计划](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md) |

### 前端页面

| 页面 | 路径 | 说明 |
|------|------|------|
| 管理员配置管理 | `/admin/google-ads-config` | 管理员创建和管理配置 |
| 用户设置页面 | `/settings?category=google_ads` | 用户查看配置状态和授权 |

## 🔧 常见任务

### 任务 1: 创建 OAuth 配置并绑定用户

**步骤:**
1. 访问 `/admin/google-ads-config`
2. 点击"新建" → "OAuth 配置"
3. 填写配置信息
4. 点击"创建"
5. 在配置卡片上点击"绑定用户"
6. 输入用户 ID
7. 点击"绑定"

**参考文档:** [快速参考](./QUICK_REFERENCE.md)

### 任务 2: 测试授权流程

**步骤:**
1. 使用被绑定的用户账号登录
2. 访问 `/settings?category=google_ads`
3. 看到"点击授权 Google Ads"按钮
4. 点击按钮，跳转到 Google 授权
5. 完成授权后返回

**参考文档:** [部署和测试](./DEPLOYMENT_AND_TESTING.md)

### 任务 3: 排查授权问题

**检查顺序:**
1. 检查数据库表是否存在
2. 检查配置是否创建
3. 检查用户是否绑定
4. 检查 API 日志
5. 检查前端错误

**参考文档:** [部署和测试 - 故障排查](./DEPLOYMENT_AND_TESTING.md)

## 🆘 获取帮助

### 问题分类

**部署问题:**
- 数据库迁移失败
- 页面访问 404
- API 返回错误

→ 查看 [`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md) 的故障排查部分

**功能问题:**
- 用户看不到配置
- 授权后仍显示需要授权
- 配置无法删除

→ 查看 [`DEPLOYMENT_AND_TESTING.md`](./DEPLOYMENT_AND_TESTING.md) 的故障排查部分

**设计问题:**
- 不理解架构设计
- 需要了解实现细节
- 想要扩展功能

→ 查看 [`GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md`](./GOOGLE_ADS_AUTH_MODIFICATION_PLAN.md) 和 [`GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md`](./GOOGLE_ADS_AUTH_IMPLEMENTATION_SUMMARY.md)

### 调试工具

**数据库查询:**
```bash
# SQLite
sqlite3 data/autoads.db

# 检查配置
SELECT * FROM google_ads_shared_oauth_configs WHERE is_active = 1;

# 检查绑定
SELECT * FROM google_ads_user_oauth_bindings WHERE user_id = 1;
```

**API 测试:**
```bash
# 测试用户配置获取
curl http://localhost:3000/api/google-ads/my-config \
  -H "Cookie: auth_token=YOUR_TOKEN"
```

**日志查看:**
```bash
# 查看应用日志
tail -f .next/server/app.log

# 查看数据库日志（PostgreSQL）
tail -f /var/log/postgresql/postgresql.log
```

## 📊 项目状态

### 已完成 ✅
- 数据库迁移
- 管理员 API
- 用户 API
- OAuth 回调修改
- 前端组件
- 管理员页面
- 文档编写

### 待完善 ⏳
- 管理员 UI 的编辑功能
- 管理员 UI 的解绑按钮
- 用户搜索/选择功能
- 管理员权限验证（is_admin 字段）
- 审计日志

### 未来扩展 🚀
- 批量绑定用户
- 配置模板
- 配置测试功能
- 监控告警
- 审计日志系统

## 📝 版本信息

- **当前版本**: 1.0.0
- **完成日期**: 2026-04-02
- **兼容性**: 向后兼容（保留用户自配置模式）
- **数据库版本**: Migration 230

---

**最后更新**: 2026-04-02  
**维护者**: codebot · 严谨专业版
