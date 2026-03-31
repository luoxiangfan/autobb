#!/bin/bash

# Scheduler Fix Verification Test
# This script tests the scheduler fix to ensure users are processed correctly

set -e

echo "=========================================="
echo "Scheduler修复验证测试"
echo "=========================================="

DATABASE_FILE="${DATABASE_FILE:-.env.local}"

# Check if database file exists
if [ ! -f "$DATABASE_FILE" ]; then
    echo "❌ 错误: 未找到数据库配置文件 $DATABASE_FILE"
    exit 1
fi

# Extract DATABASE_URL from .env.local
if command -v grep &> /dev/null; then
    # Local SQLite path (for development)
    DB_PATH=$(grep -E '^DATABASE_URL.*sqlite' "$DATABASE_FILE" | cut -d: -f2- | tr -d '"' || echo "data/autoads.db")

    if [ -f "$DB_PATH" ]; then
        echo "✅ 使用本地SQLite数据库: $DB_PATH"

        # Test 1: Check for users with multiple system_settings
        echo ""
        echo "测试1: 检查是否有配置了data_sync设置的用户"
        echo "-----------------------------------------------"

        sqlite3 "$DB_PATH" << 'EOF'
.mode column
.headers on
SELECT
    u.id as user_id,
    u.email,
    COUNT(DISTINCT CASE WHEN ss.key = 'data_sync_enabled' THEN 1 END) as has_enabled,
    COUNT(DISTINCT CASE WHEN ss.key = 'data_sync_interval_hours' THEN 1 END) as has_interval
FROM users u
LEFT JOIN system_settings ss ON ss.user_id = u.id AND ss.category = 'system'
WHERE ss.key IN ('data_sync_enabled', 'data_sync_interval_hours')
GROUP BY u.id
ORDER BY u.id;
EOF

        echo ""
        echo "测试2: 验证新查询不会返回重复user_id"
        echo "-----------------------------------------------"

        sqlite3 "$DB_PATH" << 'EOF'
.mode column
.headers on
-- This mimics the new scheduler query
WITH user_configs AS (
    SELECT
        u.id AS user_id,
        u.email,
        COALESCE(
            (SELECT value FROM system_settings
             WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_enabled' LIMIT 1),
            'true'
        ) AS data_sync_enabled,
        COALESCE(
            (SELECT value FROM system_settings
             WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_interval_hours' LIMIT 1),
            '6'
        ) AS data_sync_interval_hours
    FROM users u
    WHERE COALESCE(
        (SELECT value FROM system_settings
         WHERE user_id = u.id AND category = 'system' AND key = 'data_sync_enabled' LIMIT 1),
        'true'
    ) = 'true'
)
SELECT
    COUNT(*) as total_configs,
    COUNT(DISTINCT user_id) as unique_users,
    CASE WHEN COUNT(*) = COUNT(DISTINCT user_id) THEN '✅ OK' ELSE '❌ DUPLICATES' END as status
FROM user_configs;
EOF

        echo ""
        echo "测试3: 显示最近的sync_logs条目（验证修复后的同步记录）"
        echo "-----------------------------------------------"

        sqlite3 "$DB_PATH" << 'EOF'
.mode column
.headers on
SELECT
    id,
    user_id,
    sync_type,
    status,
    record_count,
    error_message,
    started_at
FROM sync_logs
ORDER BY started_at DESC
LIMIT 10;
EOF

    else
        echo "⚠️  警告: 未找到SQLite数据库文件 $DB_PATH"
        echo "请确保已运行迁移: npm run migrate"
    fi
else
    echo "❌ 错误: 需要 grep 命令来解析配置文件"
    exit 1
fi

echo ""
echo "=========================================="
echo "验证完成!"
echo "=========================================="
