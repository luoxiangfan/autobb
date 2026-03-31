# AutoAds - AI-Powered Google Ads Automation Platform

智能化的Google Ads广告投放和优化平台，通过AI技术自动生成高质量广告创意、优化投放策略。

---

## 📋 目录

- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [数据库初始化](#数据库初始化)
- [开发指南](#开发指南)
- [项目结构](#项目结构)
- [环境变量](#环境变量)
- [部署](#部署)

---

## ✨ 功能特性

### 核心功能
- 🤖 **AI创意生成** - 自动生成15条标题和4条描述，支持多语言
- 🎯 **Launch Score评分** - 5维度投放评分系统（关键词、市场契合、着陆页、预算、内容）
- 📊 **性能追踪** - 实时监控广告系列、广告组、关键词性能
- 🔍 **智能优化** - 基于AI的优化建议和自动化任务
- 🛡️ **风险预警** - 预算、CPC、CTR异常自动告警
- 📈 **数据分析** - 完整的性能报表和趋势分析

### 数据采集
- 🕷️ **智能爬虫** - Amazon Store页面深度抓取
- 🏷️ **产品分类** - 自动提取产品分类元数据（+100%关键词多样性）
- ⭐ **评论分析** - AI提取评论洞察和购买理由
- 🎨 **视觉分析** - 产品图片特征提取
- 💰 **促销识别** - 自动识别促销信息和折扣

### Google Ads集成
- 🔗 **API集成** - 完整的Google Ads API集成
- 📤 **批量上传** - 批量创建广告系列、广告组、关键词
- 🔄 **自动同步** - 定时同步性能数据
- 💰 **预算管理** - 智能预算分配和CPC调整

---

## 🛠️ 技术栈

### 前端
- **框架**: Next.js 14+ (App Router)
- **语言**: TypeScript
- **UI**: React, Tailwind CSS
- **状态管理**: React Context
- **认证**: Supabase Auth (Google OAuth)

### 后端
- **运行时**: Node.js
- **数据库（开发）**: SQLite 3.x
- **数据库（生产）**: PostgreSQL 14+
- **ORM**: 原生SQL（better-sqlite3, pg）
- **API**: Next.js API Routes

### AI集成
- **模型**: Claude 3.5 Sonnet (Anthropic)
- **Prompt管理**: 数据库驱动的版本化Prompt系统
- **用途**: 创意生成、数据分析、优化建议

### 基础设施
- **抓取**: Puppeteer (隐身模式)
- **缓存**: SQLite WAL模式
- **日志**: 结构化日志系统
- **监控**: 性能指标和错误追踪

---

## 🚀 快速开始

### 先决条件

```bash
# 需要 Node.js 18+ 和 npm
node --version  # 应 >= 18.0.0
npm --version
```

### 安装和运行

```bash
# 1. 克隆项目
git clone <repository-url>
cd autobb

# 2. 安装依赖
npm install

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入必要的配置

# 4. 初始化数据库（详见下一节）
npm run db:init

# 5. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

---

## 💾 数据库初始化

AutoAds使用**双数据库架构**：
- **本地开发**: SQLite（轻量级，零配置）
- **生产环境**: PostgreSQL（高性能，可扩展）

### 本地开发（SQLite）

#### 首次初始化

```bash
# 方式1：使用npm script（推荐）
npm run db:init

# 方式2：手动初始化
mkdir -p data
sqlite3 data/autoads.db < migrations/000_init_schema_consolidated.sqlite.sql

# 可选：验证增量迁移应为空（初始化脚本已包含并写入 migration_history）
npm run db:migrate
```

#### 验证初始化

```bash
# 运行验证脚本
npm run validate-schema

# 或手动检查
sqlite3 data/autoads.db ".tables"  # 应显示40个表
sqlite3 data/autoads.db "SELECT COUNT(*) FROM prompt_versions;"  # 应显示70
```

#### 重置数据库（⚠️ 删除所有数据）

```bash
npm run db:reset
```

### 生产环境（PostgreSQL）

#### 创建数据库

```bash
# 使用psql
createdb autoads

# 或使用SQL
psql postgres -c "CREATE DATABASE autoads;"
```

#### 初始化Schema

```bash
# 使用整合Schema初始化
psql autoads < pg-migrations/000_init_schema_consolidated.pg.sql

# 可选：验证增量迁移应为空（初始化脚本已包含并写入 migration_history）
DATABASE_URL="postgresql://username:password@host:5432/autoads" npm run db:migrate
```

#### 配置连接

在 `.env.production` 中设置：

```bash
DATABASE_URL="postgresql://username:password@host:5432/autoads"
```

### Schema结构

初始化完成后，数据库包含：

- ✅ **40个业务表** - 用户、Offer、广告、性能追踪等
- ✅ **89+个索引** - 性能优化
- ✅ **12组AI Prompt** - 创意生成模板（70个版本历史）
- ✅ **外键约束** - 数据完整性保护

### 数据库管理工具

```bash
# SQLite管理
sqlite3 data/autoads.db

# PostgreSQL管理
psql autoads

# GUI工具（推荐）
# - DBeaver (跨平台)
# - TablePlus (macOS)
# - pgAdmin (PostgreSQL专用)
```

### 详细文档

完整的数据库初始化和管理指南：
- 📖 [数据库初始化指南](./migrations/DATABASE_INITIALIZATION_GUIDE.md)
- 📊 [迁移整合报告](./migrations/MIGRATION_CONSOLIDATION_REPORT.md)

---

## 👨‍💻 开发指南

### 开发工作流

```bash
# 启动开发服务器（热重载）
npm run dev

# 类型检查
npm run type-check

# 构建生产版本
npm run build

# 运行生产版本（需先构建）
npm start

# 数据库验证
npm run validate-schema
```

### 代码规范

```bash
# 运行ESLint
npm run lint

# 自动修复
npm run lint:fix

# 格式化代码（如果配置了Prettier）
npm run format
```

### 调试技巧

#### 调试SQLite数据库

```bash
# 连接数据库
sqlite3 data/autoads.db

# 查看表结构
.schema offers

# 查看数据
SELECT * FROM offers LIMIT 5;

# 查看活跃Prompt
SELECT prompt_id, version, is_active
FROM prompt_versions
WHERE is_active = 1;

# 退出
.quit
```

#### 调试API请求

在浏览器开发者工具中：
1. 打开Network标签
2. 筛选XHR/Fetch请求
3. 查看请求/响应payload

---

## 📁 项目结构

```
autobb/
├── src/
│   ├── app/                    # Next.js App Router页面
│   │   ├── (app)/             # 主应用路由组
│   │   ├── api/               # API路由
│   │   └── auth/              # 认证页面
│   ├── components/            # React组件
│   ├── lib/                   # 核心业务逻辑
│   │   ├── ad-elements-extractor.ts    # AI创意生成
│   │   ├── offers.ts                   # Offer管理
│   │   ├── scraper-stealth.ts          # 智能爬虫
│   │   └── launch-score.ts             # Launch Score评分
│   └── types/                 # TypeScript类型定义
├── migrations/                # SQLite数据库迁移
│   ├── 000_init_schema_consolidated.sqlite.sql  # 整合Schema
│   ├── DATABASE_INITIALIZATION_GUIDE.md         # 初始化指南
│   ├── MIGRATION_CONSOLIDATION_REPORT.md        # 迁移报告
│   └── archive/              # 历史迁移文件（已归档）
├── pg-migrations/            # PostgreSQL数据库迁移
│   ├── 000_init_schema_consolidated.pg.sql      # 整合Schema
│   └── archive/             # 历史迁移文件（已归档）
├── scripts/                 # 实用脚本
│   └── validate-db-schema.ts               # Schema验证脚本
├── data/                    # SQLite数据库文件（.gitignore）
│   └── autoads.db
├── public/                  # 静态资源
└── package.json
```

---

## ⚙️ 环境变量

创建 `.env.local` 文件（开发环境）：

```bash
# 数据库
DATABASE_URL="file:./data/autoads.db"

# Supabase认证
NEXT_PUBLIC_SUPABASE_URL="your-supabase-url"
NEXT_PUBLIC_SUPABASE_ANON_KEY="your-supabase-anon-key"

# Google Ads API（可选）
GOOGLE_ADS_DEVELOPER_TOKEN="your-developer-token"
GOOGLE_ADS_CLIENT_ID="your-client-id"
GOOGLE_ADS_CLIENT_SECRET="your-client-secret"

# Anthropic API（AI功能）
ANTHROPIC_API_KEY="your-anthropic-api-key"

# 应用配置
NODE_ENV="development"
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

创建 `.env.production` 文件（生产环境）：

```bash
# 数据库（PostgreSQL）
DATABASE_URL="postgresql://user:password@host:5432/autoads"

# 其他配置同上，但使用生产环境的值
NODE_ENV="production"
NEXT_PUBLIC_APP_URL="https://your-domain.com"
```

---

## 🚢 部署

### Vercel部署（推荐）

1. **连接GitHub仓库**
   - 在Vercel中导入项目
   - 选择GitHub仓库

2. **配置环境变量**
   - 在Vercel项目设置中添加所有 `.env.production` 变量

3. **配置数据库**
   - 使用Vercel Postgres或外部PostgreSQL
   - 运行初始化脚本：
     ```bash
     psql $DATABASE_URL < pg-migrations/000_init_schema_consolidated.pg.sql
     ```

4. **部署**
   - Vercel会自动构建和部署
   - 每次push到main分支自动部署

### Docker部署

```bash
# 构建镜像
docker build -t autoads .

# 运行容器
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://..." \
  -e ANTHROPIC_API_KEY="..." \
  autoads
```

### 手动部署

```bash
# 1. 构建
npm run build

# 2. 启动
npm start
```

---

## 📖 文档

- [数据库初始化指南](./migrations/DATABASE_INITIALIZATION_GUIDE.md) - 完整的数据库设置和管理
- [迁移整合报告](./migrations/MIGRATION_CONSOLIDATION_REPORT.md) - 数据库Schema历史和变更
- [API文档](./docs/API.md) - API接口文档（如果有）
- [部署指南](./docs/DEPLOYMENT.md) - 详细部署说明（如果有）

---

## 🧪 测试

```bash
# 运行所有测试（如果配置了测试）
npm test

# 运行Schema验证
npm run validate-schema

# 端到端测试（如果配置了）
npm run test:e2e
```

---

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork本仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

---

## 📄 许可证

[MIT License](./LICENSE) - 详见LICENSE文件

---

## 📞 联系方式

如有问题或建议，请创建GitHub Issue。

---

## 🙏 致谢

- [Next.js](https://nextjs.org/) - React框架
- [Anthropic](https://www.anthropic.com/) - Claude AI
- [Google Ads API](https://developers.google.com/google-ads/api) - 广告投放
- [Supabase](https://supabase.com/) - 认证服务

---

**版本**: 2.0.0
**最后更新**: 2025-12-04
