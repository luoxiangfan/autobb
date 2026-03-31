# syntax=docker/dockerfile:1
# 单容器部署 - AutoAds with Nginx + Next.js + Scheduler
# 使用supervisord管理所有进程，对外只暴露80端口

# ============================================
# Stage 1: 依赖阶段
# ============================================
FROM node:20-bookworm-slim AS deps

RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    bash \
    git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --only=production && \
    npm cache clean --force

# ============================================
# Stage 2: 构建阶段
# ============================================
FROM node:20-alpine AS builder

WORKDIR /app

# 安装所有依赖（包括devDependencies）
COPY package.json package-lock.json ./
RUN npm ci

# 复制源代码
COPY . .

# Next.js环境变量
ENV NEXT_TELEMETRY_DISABLED=1

# 构建Next.js应用
RUN npm run build

# 构建调度器
RUN node build-scheduler.js

# ============================================
# Stage 2.5: Node 22 二进制（供 OpenClaw Gateway 使用）
# ============================================
FROM node:22-bookworm-slim AS node22

# ============================================
# Stage 3: 生产运行阶段（单容器）
# ============================================
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# 安装Nginx、Supervisor、Python和Playwright依赖
RUN apt-get update && apt-get install -y \
    nginx \
    supervisor \
    curl \
    wget \
    python3 \
    python3-pip \
    python3-venv \
    # Playwright浏览器依赖
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    libatspi2.0-0 \
    libxshmfence1 \
    && rm -rf /var/lib/apt/lists/*

# 设置时区为上海
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 设置生产环境
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_MAX_OLD_SPACE_SIZE_WEB=6144
ENV NODE_MAX_OLD_SPACE_SIZE_SCHEDULER=2048
ENV NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER=2048
ENV NODE_MAX_OLD_SPACE_SIZE_OPENCLAW=1536

# 创建非root用户
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# 复制Nginx配置
COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf

# 复制Supervisord配置
COPY --chown=root:root supervisord.conf /etc/supervisord.conf

# 复制Next.js standalone输出
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# 复制打包后的调度器
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

# 复制 OpenClaw 预编译产物（dist + openclaw.mjs）
COPY --chown=nextjs:nodejs openclaw-prebuilt /app/openclaw

# 复制 Node 22 二进制（用于 OpenClaw Gateway）
COPY --from=node22 /usr/local/bin/node /usr/local/bin/node22

# 校验 OpenClaw 预编译产物存在
RUN test -f /app/openclaw/dist/entry.js

# 复制数据库迁移文件（初始化需要）
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations
COPY --from=builder --chown=nextjs:nodejs /app/pg-migrations ./pg-migrations

# 复制启动脚本
COPY --from=builder --chown=root:root /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 复制生产依赖（调度器需要better-sqlite3等原生模块）
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# 设置Playwright缓存目录到应用目录
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

# 安装Playwright浏览器（使用node_modules中的playwright）
RUN node ./node_modules/playwright/cli.js install chromium --with-deps && \
    chown -R nextjs:nodejs /app/.playwright

# 安装Python依赖（Google Ads API服务）
COPY python-service/requirements.txt /app/python-service/
RUN python3 -m pip install --no-cache-dir --break-system-packages -r /app/python-service/requirements.txt

# 复制Python服务代码
COPY --chown=nextjs:nodejs python-service /app/python-service

# 创建必要的目录（避免对 /app 整体递归 chown 产生超大 layer）
RUN mkdir -p /var/log/nginx /var/lib/nginx/tmp /var/run /app/data /app/.openclaw/workspace && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx /var/run && \
    chown -R nextjs:nodejs /app/data /app/.openclaw

# 暴露80端口（Nginx）
EXPOSE 80

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD wget --no-verbose --tries=1 --spider http://localhost/api/health || exit 1

# 使用入口脚本启动（先初始化数据库，再启动supervisord）
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
