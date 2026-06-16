# syntax=docker/dockerfile:1
# 单容器部署 - AutoAds with Nginx + Next.js + Scheduler
# 使用supervisord管理所有进程，对外只暴露80端口

# ============================================
# Stage 1: 依赖阶段
# ============================================
FROM node:24-bookworm-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
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
FROM node:24-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 安装所有依赖（包括devDependencies）
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# 复制源代码（CI 预构建时含 .next/standalone 与 dist/*.js）
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_OPTIONS=--max-old-space-size=8192

# CI 预构建时可跳过（见 deploy.yml）；本地 docker build 仍在此阶段完整编译
ARG SKIP_NEXT_BUILD=0
RUN --mount=type=cache,target=/app/.next/cache \
    set -eux; \
    if [ "$SKIP_NEXT_BUILD" = "1" ] && [ -f .next/standalone/server.js ]; then \
      echo "Using CI pre-built Next.js standalone output"; \
    else \
      npm run build:next; \
    fi

ARG SKIP_SCHEDULER_BUILD=0
RUN set -eux; \
    if [ "$SKIP_SCHEDULER_BUILD" = "1" ] && [ -f dist/scheduler.js ]; then \
      echo "Using CI pre-built scheduler bundles"; \
    else \
      node build-scheduler.js; \
    fi

# ============================================
# Stage 2.5: OpenClaw 运行时瘦身（仅保留 Linux 需要的预编译依赖）
# ============================================
FROM node:24-bookworm-slim AS openclaw-runtime

WORKDIR /opt/openclaw
ARG TARGETARCH

# 先在中间层清理非 Linux 平台依赖，再拷贝到最终镜像。
# 这样被删除文件不会进入最终镜像层，能直接减少拉取体积。
COPY openclaw-prebuilt ./openclaw-prebuilt

RUN set -eux; \
    PNPM_STORE_DIR="/opt/openclaw/openclaw-prebuilt/node_modules/.pnpm"; \
    if [ -d "$PNPM_STORE_DIR" ]; then \
      find "$PNPM_STORE_DIR" -mindepth 1 -maxdepth 1 -type d \
        \( -name '*darwin*' -o -name '*win32*' -o -name '*freebsd*' -o -name '*android*' \) \
        -exec rm -rf '{}' +; \
      case "${TARGETARCH:-amd64}" in \
        amd64) \
          find "$PNPM_STORE_DIR" -mindepth 1 -maxdepth 1 -type d \
            \( -name '*linux-arm*' -o -name '*arm64*' \) -exec rm -rf '{}' + ;; \
        arm64) \
          find "$PNPM_STORE_DIR" -mindepth 1 -maxdepth 1 -type d \
            \( -name '*linux-x64*' -o -name '*amd64*' \) -exec rm -rf '{}' + ;; \
      esac; \
    fi; \
    rm -f /opt/openclaw/openclaw-prebuilt/.DS_Store; \
    if [ -d /opt/openclaw/openclaw-prebuilt/docs ]; then \
      mkdir -p /tmp/openclaw-workspace-templates; \
      if [ -d /opt/openclaw/openclaw-prebuilt/docs/reference/templates ]; then \
        cp -a /opt/openclaw/openclaw-prebuilt/docs/reference/templates /tmp/openclaw-workspace-templates/; \
      fi; \
      rm -rf /opt/openclaw/openclaw-prebuilt/docs; \
      if [ -d /tmp/openclaw-workspace-templates/templates ]; then \
        mkdir -p /opt/openclaw/openclaw-prebuilt/docs/reference; \
        cp -a /tmp/openclaw-workspace-templates/templates /opt/openclaw/openclaw-prebuilt/docs/reference/templates; \
      fi; \
      rm -rf /tmp/openclaw-workspace-templates; \
    fi; \
    test -f /opt/openclaw/openclaw-prebuilt/docs/reference/templates/AGENTS.md \
      || test -f /opt/openclaw/openclaw-prebuilt/workspace-templates/AGENTS.md; \
    NODE_MODULES_DIR="/opt/openclaw/openclaw-prebuilt/node_modules"; \
    if [ -d "$NODE_MODULES_DIR" ]; then \
      find "$NODE_MODULES_DIR" -type d \
        \( -name docs -o -name test -o -name tests -o -name '__tests__' -o -name example -o -name examples -o -name bench -o -name benchmark \) \
        -prune -exec rm -rf '{}' +; \
      find "$NODE_MODULES_DIR" -type f \
        \( -name '*.map' -o -name '*.d.ts' -o -iname '*.md' -o -iname '*.markdown' \) \
        -delete; \
    fi

# ============================================
# Stage 3: 生产运行阶段（单容器）
# ============================================
FROM node:24-bookworm-slim AS runner

WORKDIR /app

# 安装Nginx、Supervisor、Python和Playwright依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    wget \
    unzip \
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
# 使用瘦身阶段产物，避免把非 Linux 依赖带入生产镜像。
COPY --from=openclaw-runtime --chown=nextjs:nodejs /opt/openclaw/openclaw-prebuilt /app/openclaw

# 校验 OpenClaw 预编译产物存在
RUN test -f /app/openclaw/dist/entry.js && \
    (test -f /app/openclaw/docs/reference/templates/AGENTS.md \
      || test -f /app/openclaw/workspace-templates/AGENTS.md)

# 复制数据库迁移文件（初始化需要）
COPY --from=builder --chown=nextjs:nodejs /app/migrations ./migrations

# 复制启动脚本
COPY --from=builder --chown=root:root /app/scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# 复制生产依赖（调度器与 Playwright 等原生模块）
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# 设置Playwright缓存目录到应用目录
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

# 安装Playwright浏览器（系统依赖已在上方 apt 安装；勿用 --with-deps 避免 CI 二次 apt 卡住）
RUN node ./node_modules/playwright/cli.js install chromium && \
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
    CMD curl -fsS http://localhost/api/health >/dev/null || exit 1

# 使用入口脚本启动（先初始化数据库，再启动supervisord）
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
