# AutoAds - AI-Powered Google Ads Automation Platform

智能化的 Google Ads 广告投放与优化平台，通过 AI 自动生成高质量广告创意、管理投放策略，并集成 OpenClaw 智能体实现自动化运营。

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

- 🤖 **AI 创意生成** — 自动生成标题与描述，支持 `fast` / `balanced` / `original` 多种生成模式
- 🎯 **Launch Score 评分** — 5 维度投放评分（关键词、市场契合、着陆页、预算、内容）
- 📊 **性能追踪** — 实时监控广告系列、广告组、关键词表现
- 🔍 **智能优化** — 基于 AI 的优化建议与自动化任务
- 🛡️ **风险预警** — 预算、CPC、CTR 异常自动告警
- 📈 **数据分析** — 性能报表、ROI 与趋势分析

### 数据采集

- 🕷️ **智能爬虫** — Amazon Store 页面深度抓取
- 🏷️ **产品分类** — 自动提取产品分类元数据
- ⭐ **评论分析** — AI 提取评论洞察与购买理由
- 🎨 **视觉分析** — 产品图片特征提取
- 💰 **促销识别** — 自动识别促销信息与折扣

### Google Ads 集成

- 🔗 **API 集成** — 完整 Google Ads API 支持
- 🔐 **双认证模式** — OAuth 2.0 或服务账号（二选一，见 [AGENTS.md](./AGENTS.md)）
- 📤 **批量上传** — 批量创建广告系列、广告组、关键词
- 🔄 **自动同步** — 定时同步性能数据
- 💰 **预算管理** — 智能预算分配与 CPC 调整
- 📋 **Campaign 备份** — 备份与批量恢复广告系列

### 自动化运营

- 🤖 **OpenClaw 智能体** — 指令执行、策略推荐、每日报表、飞书集成
- 💼 **联盟营销** — YP/PB 联盟商品同步与佣金归因
- 🖱️ **补点击（Click Farm）** — 带代理池的点击任务调度
- 🔗 **换链接（URL Swap）** — 自动监测并更新广告落地页链接
- ⚙️ **统一队列** — Redis 优先 + 内存回退，支持 Web / Background Worker 分离

---

## 🛠️ 技术栈

### 前端

- **语言**: TypeScript 6
- **框架**: Next.js 16 (App Router), React 19
- **样式**: Tailwind CSS 4, Radix UI, shadcn/ui 组件
- **数据获取**: SWR
- **图表 / 反馈**: Recharts, Sonner, Lucide React
- **校验**: Zod

### 后端

- **运行时**: Node.js 24+
- **API**: Next.js API Routes
- **数据库**: PostgreSQL（`DATABASE_URL`），`DatabaseAdapter` 抽象层
- **数据访问**: 原生 SQL — postgres.js
- **队列 / 缓存**: Redis (ioredis)，统一任务调度器（Web / Background Worker 可分离）
- **定时任务**: node-cron + Scheduler 进程
- **认证**: Google OAuth 2.0 + JWT (jose / jsonwebtoken)，bcrypt 密码哈希
- **校验**: Zod

### Google Ads

- **SDK**: google-ads-api
- **认证**: OAuth 2.0 或服务账号（二选一，见 [AGENTS.md](./AGENTS.md)）
- **服务账号模式**: 可选 Python Ads Service（`PYTHON_ADS_SERVICE_URL`）

### AI

- **主引擎**: Google Gemini（直接 API / Vertex AI / Relay，自动降级）
- **Prompt**: 数据库版本化 Prompt（`prompt_versions` 表）
- **用途**: 创意生成、Offer 分析、Launch Score、OpenClaw 指令解析

### 数据采集

- **浏览器自动化**: Playwright（Amazon / Google 抓取，连接池复用）
- **HTML 解析**: Cheerio
- **代理**: https-proxy-agent

### 智能体与集成

- **OpenClaw**: 网关 WebSocket、指令执行、策略推荐、飞书集成
- **联盟平台**: YP / PB 商品与佣金 API

### 工程化

- **测试**: Vitest, Testing Library, jsdom
- **代码质量**: ESLint 9, Prettier, lint-staged
- **脚本运行时**: tsx, esbuild
- **部署**: Docker 单容器 — Nginx + Supervisord 管理 Next.js / Scheduler / OpenClaw
- **CI/CD**: GitHub Actions → GHCR，可选 Cloud Run

---

## 🚀 快速开始

### 先决条件

```bash
node --version   # 应 >= 24.0.0
npm --version
# 必需：PostgreSQL（本地开发与生产均通过 DATABASE_URL）
# 可选：Redis（队列与补点击功能）
```

### 安装和运行

```bash
# 1. 克隆项目
git clone <repository-url>
cd autobb

# 2. 安装依赖（含 native 模块编译）
npm install
# 或首次环境一键引导
npm run bootstrap

# 3. 配置环境变量
cp .env.example .env.local
# 编辑 .env.local：DATABASE_URL、JWT_SECRET、ENCRYPTION_KEY、GEMINI_API_KEY 等

# 4. 初始化数据库（需已可用的 PostgreSQL）
npm run db:migrate
npm run db:init

# 5. 启动开发服务器
npm run dev
```

访问 http://localhost:3000

---

## 💾 数据库初始化

AutoAds 使用 **PostgreSQL**（本地开发与生产环境相同）。在 `.env.local` 或 `.env.production` 中配置：

```bash
DATABASE_URL=postgresql://用户名:密码@主机:5432/autoads
```

本仓库**不内置** Docker PostgreSQL；开发者自行安装或使用已有实例（本机、云托管或自建 Docker 均可）。

**与 OpenClaw 的边界：** AutoAds 业务数据（用户、Offer、广告、OpenClaw 绑定与指令记录等）全部在 PostgreSQL。OpenClaw Agent 的**会话记忆索引**由 OpenClaw 网关自行管理（通常为 `~/.openclaw/memory/` 下的本地 SQLite），与 `DATABASE_URL` 无关；升级 OpenClaw 时不要求改动 AutoAds 数据库配置。

### 首次初始化

```bash
# 推荐流程
npm run db:migrate          # 应用 migrations/ 增量迁移
npm run db:init             # 检查关键表 + 确保管理员账号

# 或手动灌入 consolidated schema 后再迁移
psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql
npm run db:migrate
```

### 验证

```bash
npm run validate-schema
psql "$DATABASE_URL" -c "\dt"
```

### 重置开发库（⚠️ 删除所有数据）

```bash
psql "$DATABASE_URL" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
psql "$DATABASE_URL" -f migrations/000_init_schema_consolidated.pg.sql
npm run db:migrate
npm run db:init
```

### Schema 结构

初始化完成后，数据库包含：

- ✅ **40 个业务表** — 用户、Offer、广告、性能追踪、OpenClaw 等
- ✅ **89+ 个索引** — 性能优化
- ✅ **版本化 AI Prompt** — 创意生成等模板（存储于 `prompt_versions`）
- ✅ **外键约束** — 数据完整性保护

> 历史迁移（141–253）已合并进 consolidated 初始化脚本。详见 [migrations/README.md](./migrations/README.md)。

### 数据库管理工具

```bash
psql "$DATABASE_URL"             # PostgreSQL CLI
npm run db:backup                # 自动备份（若已配置）
```

### 详细文档

- 📖 [数据库初始化指南](./migrations/DATABASE_INITIALIZATION_GUIDE.md)
- 📊 [迁移规范与增量说明](./migrations/README.md)

---

## 👨‍💻 开发指南

### 开发工作流

```bash
npm run dev              # 开发服务器（热重载）
npm run build            # 生产构建
npm start                # 运行生产构建
npm run type-check       # TypeScript 类型检查
npm run validate-schema  # Schema 验证
```

### 代码质量

提交前请依次通过：

```bash
npm run format:changed   # Prettier 格式化（仅修改/新增文件）
npm run lint:changed     # ESLint 检查（仅修改/新增可 lint 文件）
npm run type-check       # TypeScript 检查
```

### 测试

```bash
npm test                 # 运行全部 Vitest 测试
npm run test:watch       # 监听模式
npm run test:openclaw    # OpenClaw 相关测试
```

### 常用脚本

| 命令                               | 说明                     |
| ---------------------------------- | ------------------------ |
| `npm run db:migrate`               | 应用增量迁移             |
| `npm run admin:ensure`             | 确保管理员账号存在       |
| `npm run attribution:health`       | 联盟归因健康检查         |
| `npm run openclaw:prebuilt:verify` | 验证 OpenClaw 预构建产物 |

### 调试 PostgreSQL

```bash
psql "$DATABASE_URL"
\d offers
SELECT * FROM offers LIMIT 5;
SELECT prompt_id, version, is_active FROM prompt_versions WHERE is_active = true;
\q
```

### Agent / 贡献者约定

AI Agent 与贡献者请参阅 [AGENTS.md](./AGENTS.md) 与 [CLAUDE.md](./CLAUDE.md)，其中包含 Google Ads 认证约定、PostgreSQL/SQL 规范与质量门禁要求。

---

## 📁 项目结构

```
autobb/
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── (app)/             # 主应用页面
│   │   ├── api/               # API 路由
│   │   └── auth/              # 认证页面
│   ├── components/            # React 组件
│   ├── lib/                   # 核心业务逻辑
│   │   ├── openclaw/          # OpenClaw 智能体集成
│   │   ├── queue/             # 统一队列与任务执行器
│   │   ├── google-ads-*.ts    # Google Ads API
│   │   ├── ad-elements-extractor.ts
│   │   ├── launch-score.ts
│   │   └── scraper-stealth.ts
│   └── types/                 # TypeScript 类型
├── migrations/                # PostgreSQL schema 与增量迁移
│   ├── 000_init_schema_consolidated.pg.sql
│   └── README.md
├── scripts/                   # 运维与验证脚本
├── openclaw/                  # OpenClaw 网关源码
├── data/                      # 备份等本地数据（.gitignore）
├── Dockerfile                 # 单容器生产镜像
└── package.json
```

---

## ⚙️ 环境变量

完整配置见 [`.env.example`](./.env.example)。以下为关键项摘要：

```bash
# 应用
NEXT_PUBLIC_APP_URL=http://localhost:3000
INTERNAL_APP_URL=http://127.0.0.1:3000
NODE_ENV=development

# 认证
JWT_SECRET=your_random_64_char_hex_secret
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# 数据库（必填）
DATABASE_URL=postgresql://user:pass@localhost:5432/autoads

# AI
GEMINI_API_KEY=...
# 或使用 Vertex AI（设置页或环境变量）

# Google Ads API
GOOGLE_ADS_DEVELOPER_TOKEN=...
GOOGLE_ADS_CLIENT_ID=...
GOOGLE_ADS_CLIENT_SECRET=...

# 加密
ENCRYPTION_KEY=your_32_byte_hex_key

# Redis（队列、补点击）
REDIS_URL=redis://localhost:6379

# OpenClaw
OPENCLAW_GATEWAY_TOKEN=...
OPENCLAW_GATEWAY_PORT=18789

# Python Google Ads 服务（服务账号模式）
PYTHON_ADS_SERVICE_URL=http://localhost:8001
```

更多选项（代理、汇率、速率限制、队列并发等）见 `.env.example` 内注释。

---

## 🚢 部署

### Docker 单容器（推荐）

项目 Dockerfile 构建包含 Nginx、Next.js、Scheduler 与 OpenClaw 的单容器镜像，对外暴露 80 端口：

```bash
docker build -t autoads .
docker run -p 80:80 \
  -e DATABASE_URL="postgresql://..." \
  -e JWT_SECRET="..." \
  -e ENCRYPTION_KEY="..." \
  -e GEMINI_API_KEY="..." \
  -e REDIS_URL="redis://..." \
  autoads
```

### CI/CD

- **GitHub Actions** — push 到 `main` 或打 `v*.*.*` 标签时自动构建并推送镜像至 GHCR
- **Cloud Run** — 通过仓库变量 `ENABLE_CLOUD_RUN_DEPLOY=true` 启用（见 `.env.example` 注释）

### 手动部署

```bash
npm run build
npm start
```

生产环境建议使用 PostgreSQL + Redis，并在初始化后运行 `npm run db:migrate`。

---

## 📖 文档

| 文档                                                                                         | 说明                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [migrations/DATABASE_INITIALIZATION_GUIDE.md](./migrations/DATABASE_INITIALIZATION_GUIDE.md) | 数据库设置与管理                            |
| [migrations/README.md](./migrations/README.md)                                               | 迁移命名规范与近期增量                      |
| [AGENTS.md](./AGENTS.md)                                                                     | Agent 工作流、质量门禁、Google Ads 认证约定 |
| [CLAUDE.md](./CLAUDE.md)                                                                     | 项目概览与开发命令速查                      |

---

## 🤝 贡献

1. Fork 本仓库
2. 创建功能分支 (`git checkout -b feature/your-feature`)
3. 提交前运行 `npm run format:changed`、`npm run lint:changed`、`npm run type-check`
4. 提交更改并创建 Pull Request

---

## 📄 许可证

[MIT License](./LICENSE)

---

## 🙏 致谢

- [Next.js](https://nextjs.org/)
- [Google Gemini](https://ai.google.dev/)
- [Google Ads API](https://developers.google.com/google-ads/api)
- [OpenClaw](https://github.com/openclaw/openclaw)

---

**版本**: 2.0.0
**最后更新**: 2026-06-12
