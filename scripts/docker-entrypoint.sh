#!/bin/sh
# Docker容器启动入口脚本
# 在supervisord启动前执行数据库初始化

set -e

CURRENT_CHILD_PID=""
TERMINATION_REQUESTED=0

handle_termination() {
    SIGNAL_NAME="$1"
    echo "⚠️  [startup] 收到 ${SIGNAL_NAME}，终止初始化流程..."
    TERMINATION_REQUESTED=1
    if [ -n "${CURRENT_CHILD_PID:-}" ]; then
        kill -TERM "${CURRENT_CHILD_PID}" 2>/dev/null || true
        wait "${CURRENT_CHILD_PID}" 2>/dev/null || true
        CURRENT_CHILD_PID=""
    fi
    exit 143
}

run_with_signal_forward() {
    if [ "${TERMINATION_REQUESTED}" = "1" ]; then
        return 143
    fi

    "$@" &
    CURRENT_CHILD_PID=$!
    wait "${CURRENT_CHILD_PID}"
    EXIT_CODE=$?
    CURRENT_CHILD_PID=""
    return "${EXIT_CODE}"
}

trap 'handle_termination SIGTERM' TERM
trap 'handle_termination SIGINT' INT

now_ts() {
    date +%s
}

log_step_start() {
    STEP_NAME="$1"
    STEP_START_TS="$(now_ts)"
    echo "🕒 [startup] ${STEP_NAME} 开始..."
}

log_step_end() {
    STEP_NAME="$1"
    STEP_END_TS="$(now_ts)"
    STEP_COST_SEC=$((STEP_END_TS - STEP_START_TS))
    TOTAL_COST_SEC=$((STEP_END_TS - STARTUP_BEGIN_TS))
    echo "✅ [startup] ${STEP_NAME} 完成 (step=${STEP_COST_SEC}s, total=${TOTAL_COST_SEC}s)"
}

STARTUP_BEGIN_TS="$(now_ts)"

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
log_step_start "数据库初始化"
run_with_signal_forward node dist/db-init.js
log_step_end "数据库初始化"

# 入口脚本已完成数据库初始化，通知 Next.js 运行时跳过重复初始化
export SKIP_RUNTIME_DB_INIT=true

# 初始化 OpenClaw 目录并授权
log_step_start "准备 OpenClaw 目录与权限"
mkdir -p /app/.openclaw /app/.openclaw/workspace /app/.openclaw/canvas /app/data/backups
chown nextjs:nodejs /app/.openclaw /app/.openclaw/workspace /app/.openclaw/canvas /app/data/backups

# 默认不递归 chown，避免大体量持久化目录拖慢启动。
# 如需修复历史遗留权限，可显式设置 STARTUP_RECURSIVE_CHOWN=true。
if [ "${STARTUP_RECURSIVE_CHOWN:-false}" = "true" ]; then
    echo "⚙️  STARTUP_RECURSIVE_CHOWN=true，执行递归权限修复..."
    chown -R nextjs:nodejs /app/.openclaw /app/data/backups
else
    echo "⏭️  跳过递归权限修复（STARTUP_RECURSIVE_CHOWN=false）"
fi
log_step_end "准备 OpenClaw 目录与权限"

# OpenClaw 配置同步（失败不影响主服务启动）
if [ "${OPENCLAW_SYNC_ENABLED:-true}" = "true" ] && [ -f /app/dist/openclaw-sync.js ]; then
    OPENCLAW_SYNC_TIMEOUT_SECONDS="${OPENCLAW_SYNC_TIMEOUT_SECONDS:-20}"
    log_step_start "OpenClaw 配置同步"
    if command -v timeout >/dev/null 2>&1; then
        if run_with_signal_forward timeout "${OPENCLAW_SYNC_TIMEOUT_SECONDS}" node dist/openclaw-sync.js; then
            :
        else
            OPENCLAW_SYNC_EXIT_CODE=$?
            if [ "${OPENCLAW_SYNC_EXIT_CODE}" -eq 124 ]; then
                echo "⚠️  OpenClaw 配置同步超时（${OPENCLAW_SYNC_TIMEOUT_SECONDS}s），已跳过"
            else
                echo "⚠️  OpenClaw 配置同步失败（exit=${OPENCLAW_SYNC_EXIT_CODE}），已跳过"
            fi
        fi
    else
        if ! run_with_signal_forward node dist/openclaw-sync.js; then
            echo "⚠️  OpenClaw 配置同步失败，已跳过"
        fi
    fi
    log_step_end "OpenClaw 配置同步"
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

PRE_SUPERVISOR_COST_SEC=$(( $(now_ts) - STARTUP_BEGIN_TS ))
echo "📊 [startup] 进入 supervisord 前总耗时: ${PRE_SUPERVISOR_COST_SEC}s"

# 启动supervisord
exec /usr/bin/supervisord -c /etc/supervisord.conf
