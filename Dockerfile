# syntax=docker/dockerfile:1
# 单容器部署 - AutoAds with Nginx + Next.js + Scheduler
# 使用supervisord管理所有进程，对外只暴露80端口

# ============================================
# Stage 1: 生产依赖（原生模块编译）
# ============================================
FROM node:20-bookworm-slim AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev

# ============================================
# Stage 2: 构建阶段（与 deps 同基础镜像，避免 alpine 原生模块差异）
# ============================================
FROM node:20-bookworm-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# 先复制构建配置与源码，依赖层在仅改业务代码时可复用
COPY next.config.js tsconfig.json tailwind.config.ts postcss.config.js build-scheduler.js ./
COPY public ./public
COPY src ./src
COPY openclaw/package.json openclaw/.source-commit ./openclaw/
COPY openclaw-prebuilt/.build-meta.json ./openclaw-prebuilt/

ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build
RUN node build-scheduler.js

# ============================================
# Stage 2.5: Node 22 二进制（供 OpenClaw Gateway 使用）
# ============================================
FROM node:22-bookworm-slim AS node22

# ============================================
# Stage 2.6: OpenClaw 运行时瘦身（仅保留 Linux 需要的预编译依赖）
# ============================================
FROM node:20-bookworm-slim AS openclaw-runtime

WORKDIR /opt/openclaw
ARG TARGETARCH

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
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Playwright 系统依赖（与下方 install chromium 配合，勿使用 --with-deps 避免重复安装）
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    curl \
    wget \
    python3 \
    python3-pip \
    python3-venv \
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

ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NODE_MAX_OLD_SPACE_SIZE_WEB=6144
ENV NODE_MAX_OLD_SPACE_SIZE_SCHEDULER=2048
ENV NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER=2048
ENV NODE_MAX_OLD_SPACE_SIZE_OPENCLAW=1536

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --chown=root:root nginx.conf /etc/nginx/nginx.conf
COPY --chown=root:root supervisord.conf /etc/supervisord.conf

COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/dist ./dist

COPY --from=openclaw-runtime --chown=nextjs:nodejs /opt/openclaw/openclaw-prebuilt /app/openclaw
COPY --from=node22 /usr/local/bin/node /usr/local/bin/node22

RUN test -f /app/openclaw/dist/entry.js && \
    (test -f /app/openclaw/docs/reference/templates/AGENTS.md \
      || test -f /app/openclaw/workspace-templates/AGENTS.md)

# 迁移文件直接从构建上下文复制，避免无关源码变更使 builder 层失效
COPY --chown=nextjs:nodejs migrations ./migrations
COPY --chown=nextjs:nodejs pg-migrations ./pg-migrations

COPY --chown=root:root scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright

# 系统库已由 apt 安装；省略 --with-deps 可显著减小层体积并缩短构建时间
RUN node ./node_modules/playwright/cli.js install chromium && \
    chown -R nextjs:nodejs /app/.playwright

COPY python-service/requirements.txt /app/python-service/
RUN --mount=type=cache,target=/root/.cache/pip \
    python3 -m pip install --no-cache-dir --break-system-packages -r /app/python-service/requirements.txt

COPY --chown=nextjs:nodejs python-service /app/python-service

RUN mkdir -p /var/log/nginx /var/lib/nginx/tmp /var/run /app/data /app/.openclaw/workspace && \
    chown -R www-data:www-data /var/log/nginx /var/lib/nginx /var/run && \
    chown -R nextjs:nodejs /app/data /app/.openclaw

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=40s \
    CMD curl -fsS http://localhost/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
