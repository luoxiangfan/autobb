#!/bin/bash

# D桶整合迁移验证脚本
# 用于快速检查和执行所有必要的迁移

set -e

echo "========================================"
echo "  D桶整合迁移验证脚本"
echo "  日期: $(date)"
echo "========================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查函数
check_file() {
    if [ -f "$1" ]; then
        echo -e "${GREEN}✅ $1${NC}"
        return 0
    else
        echo -e "${RED}❌ $1 不存在${NC}"
        return 1
    fi
}

# 检查迁移文件
echo "📋 检查迁移文件..."
echo ""

echo "--- SQLite迁移文件 ---"
check_file "migrations/088_add_bucket_d_to_keyword_pools.sql"
check_file "migrations/089_add_bucket_d_to_ad_creatives.sql"
check_file "migrations/090_update_keyword_intent_clustering_v4.15.sql"

echo ""
echo "--- PostgreSQL迁移文件 ---"
check_file "pg-migrations/088_add_bucket_d_to_keyword_pools.pg.sql"
check_file "pg-migrations/089_add_bucket_d_to_ad_creatives.pg.sql"
check_file "pg-migrations/090_update_keyword_intent_clustering_v4.15.pg.sql"

echo ""
echo "--- 文档文件 ---"
check_file "D_BUCKET_INTEGRATION_TEST_PLAN.md"
check_file "SQLITE_POSTGRESQL_MIGRATION_DIFFERENCES.md"
check_file "KEYWORD_CLUSTERING_BATCH_OPTIMIZATION.md"
check_file "BATCH_CLUSTERING_TEST_GUIDE.md"
check_file "D_BUCKET_INTEGRATION_MIGRATION_SUMMARY.md"

echo ""
echo "========================================"
echo "📊 检查代码文件..."
echo "========================================"
echo ""

check_file "src/lib/offer-keyword-pool.ts"

echo ""
echo "========================================"
echo "🔍 验证关键差异..."
echo "========================================"
echo ""

# 验证布尔值差异
echo "--- 检查SQLite布尔值 ---"
grep -n "is_active = 0" migrations/090_update_keyword_intent_clustering_v4.15.sql > /dev/null && \
    echo -e "${GREEN}✅ SQLite使用0/1布尔值${NC}" || \
    echo -e "${RED}❌ SQLite布尔值格式错误${NC}"

echo ""
echo "--- 检查PostgreSQL布尔值 ---"
grep -n "is_active = FALSE" pg-migrations/090_update_keyword_intent_clustering_v4.15.pg.sql > /dev/null && \
    echo -e "${GREEN}✅ PostgreSQL使用TRUE/FALSE布尔值${NC}" || \
    echo -e "${RED}❌ PostgreSQL布尔值格式错误${NC}"

echo ""
echo "========================================"
echo "🚀 执行迁移（可选）"
echo "========================================"
echo ""

read -p "是否执行SQLite迁移? (y/N): " execute_sqlite
if [[ $execute_sqlite =~ ^[Yy]$ ]]; then
    echo ""
    echo "执行SQLite迁移..."
    echo ""

    echo "1. 执行088迁移..."
    sqlite3 data/autoads.db < migrations/088_add_bucket_d_to_keyword_pools.sql && \
        echo -e "${GREEN}✅ 088迁移成功${NC}" || \
        echo -e "${RED}❌ 088迁移失败${NC}"

    echo ""
    echo "2. 执行089迁移..."
    sqlite3 data/autoads.db < migrations/089_add_bucket_d_to_ad_creatives.sql && \
        echo -e "${GREEN}✅ 089迁移成功${NC}" || \
        echo -e "${RED}❌ 089迁移失败${NC}"

    echo ""
    echo "3. 执行090迁移..."
    sqlite3 data/autoads.db < migrations/090_update_keyword_intent_clustering_v4.15.sql && \
        echo -e "${GREEN}✅ 090迁移成功${NC}" || \
        echo -e "${RED}❌ 090迁移失败${NC}"

    echo ""
    echo "4. 验证Prompt版本..."
    sqlite3 data/autoads.db "SELECT prompt_id, version, is_active FROM prompt_versions WHERE prompt_id = 'keyword_intent_clustering';"
fi

echo ""
read -p "是否执行PostgreSQL迁移? (y/N): " execute_pg
if [[ $execute_pg =~ ^[Yy]$ ]]; then
    echo ""
    echo "⚠️  注意: PostgreSQL迁移需要以下信息:"
    echo "   - 数据库用户名"
    echo "   - 数据库名称"
    echo ""
    read -p "请输入PostgreSQL连接字符串 (或按回车跳过): " pg_conn

    if [ ! -z "$pg_conn" ]; then
        echo ""
        echo "执行PostgreSQL迁移..."
        echo ""

        echo "1. 执行088迁移..."
        psql "$pg_conn" -f pg-migrations/088_add_bucket_d_to_keyword_pools.pg.sql && \
            echo -e "${GREEN}✅ 088迁移成功${NC}" || \
            echo -e "${RED}❌ 088迁移失败${NC}"

        echo ""
        echo "2. 执行089迁移..."
        psql "$pg_conn" -f pg-migrations/089_add_bucket_d_to_ad_creatives.pg.sql && \
            echo -e "${GREEN}✅ 089迁移成功${NC}" || \
            echo -e "${RED}❌ 089迁移失败${NC}"

        echo ""
        echo "3. 执行090迁移..."
        psql "$pg_conn" -f pg-migrations/090_update_keyword_intent_clustering_v4.15.pg.sql && \
            echo -e "${GREEN}✅ 090迁移成功${NC}" || \
            echo -e "${RED}❌ 090迁移失败${NC}"
    fi
fi

echo ""
echo "========================================"
echo "📝 下一步操作"
echo "========================================"
echo ""
echo "1. 启动开发服务器:"
echo "   npm run dev"
echo ""
echo "2. 测试API:"
echo "   curl -X POST http://localhost:3000/api/creative-tasks \\"
echo "     -H 'Content-Type: application/json' \\"
echo "     -d '{\"offerId\": 184, \"userId\": 1, \"count\": 3}'"
echo ""
echo "3. 查看详细测试计划:"
echo "   cat D_BUCKET_INTEGRATION_TEST_PLAN.md"
echo ""
echo "4. 阅读迁移总结:"
echo "   cat D_BUCKET_INTEGRATION_MIGRATION_SUMMARY.md"
echo ""
echo "========================================"
echo "✅ 验证完成!"
echo "========================================"
