#!/bin/sh
# Docker容器启动入口脚本
# 在supervisord启动前执行数据库初始化

set -e

echo "========================================"
echo "🚀 AutoAds 服务启动初始化"
echo "========================================"

# 🔥 强制运行时环境变量验证（防止构建时的 NEXT_PHASE 泄漏导致跳过验证）
export SKIP_ENV_VALIDATION=false

# 检查数据库连接
if [ -z "$DATABASE_URL" ]; then
    echo "❌ 错误: DATABASE_URL 环境变量未设置"
    exit 1
fi

# 执行数据库初始化脚本
cd /app
node dist/db-init.js

# 入口脚本已完成数据库初始化，通知 Next.js 运行时跳过重复初始化
export SKIP_RUNTIME_DB_INIT=true

# 初始化 OpenClaw 目录并授权
mkdir -p /app/.openclaw /app/.openclaw/workspace /app/.openclaw/canvas /app/data/backups
chown -R nextjs:nodejs /app/.openclaw /app/data/backups

# OpenClaw 配置同步（失败不影响主服务启动）
if [ -f /app/dist/openclaw-sync.js ]; then
    node dist/openclaw-sync.js || echo "⚠️  OpenClaw 配置同步失败，已跳过"
fi

# 将 gateway token 注入为进程环境变量，供 OpenClaw skill 内部调用 /api/openclaw/* 使用。
# 仅在环境中未显式提供时，从运行时配置文件读取。
if [ -z "${OPENCLAW_GATEWAY_TOKEN:-}" ] && [ -f /app/.openclaw/openclaw.json ]; then
    OPENCLAW_GATEWAY_TOKEN="$(node -e "const fs=require('fs');try{const raw=fs.readFileSync('/app/.openclaw/openclaw.json','utf8');const cfg=JSON.parse(raw||'{}');const token=((cfg.gateway||{}).auth||{}).token||'';if(token&&String(token).trim()){process.stdout.write(String(token).trim())}}catch(e){}")"
    if [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
        export OPENCLAW_GATEWAY_TOKEN
    fi
fi

# 兼容旧模板别名。
if [ -z "${OPENCLAW_TOKEN:-}" ] && [ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]; then
    export OPENCLAW_TOKEN="$OPENCLAW_GATEWAY_TOKEN"
fi

chown -R nextjs:nodejs /app/.openclaw

echo ""
echo "========================================"
echo "✅ 初始化完成，启动服务..."
echo "========================================"
echo ""

# 为 supervisord 变量插值提供默认值（避免未注入时启动失败）
: "${NODE_MAX_OLD_SPACE_SIZE_WEB:=6144}"
: "${NODE_MAX_OLD_SPACE_SIZE_SCHEDULER:=1024}"
: "${NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER:=2048}"
: "${NODE_MAX_OLD_SPACE_SIZE_OPENCLAW:=1536}"
export NODE_MAX_OLD_SPACE_SIZE_WEB
export NODE_MAX_OLD_SPACE_SIZE_SCHEDULER
export NODE_MAX_OLD_SPACE_SIZE_BACKGROUND_WORKER
export NODE_MAX_OLD_SPACE_SIZE_OPENCLAW

# 启动supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf
