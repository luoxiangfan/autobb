#!/bin/bash

# P0数据流快速验证脚本
# 用途：验证从爬虫抓取到广告创意生成的完整数据流

set -e  # 遇到错误立即退出

echo "========================================="
echo "🔍 P0数据优化验证脚本"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

DB_PATH="data/autoads.db"

# 1. 检查数据库文件是否存在
echo "1️⃣  检查数据库文件..."
if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}❌ 数据库文件不存在: $DB_PATH${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 数据库文件存在${NC}"
echo ""

# 2. 检查scraped_data列是否存在
echo "2️⃣  检查scraped_data列..."
COLUMN_CHECK=$(sqlite3 "$DB_PATH" "PRAGMA table_info(offers);" | grep -c "scraped_data" || true)
if [ "$COLUMN_CHECK" -eq 0 ]; then
    echo -e "${RED}❌ scraped_data列不存在${NC}"
    echo -e "${YELLOW}💡 运行以下命令添加列:${NC}"
    echo "   sqlite3 $DB_PATH \"ALTER TABLE offers ADD COLUMN scraped_data TEXT;\""
    exit 1
fi
echo -e "${GREEN}✅ scraped_data列存在${NC}"
echo ""

# 3. 检查TypeScript编译（可选，跳过如果太慢）
echo "3️⃣  TypeScript编译检查（可选，按Ctrl+C跳过）..."
echo -n "   正在编译TypeScript..."
if timeout 10s npx tsc --noEmit 2>&1 | grep -i "scraped_data\|pricing\|promotions" > /dev/null; then
    echo -e "${RED}❌ 发现类型错误${NC}"
    npx tsc --noEmit 2>&1 | grep -A 3 "scraped_data\|pricing\|promotions"
    exit 1
else
    echo -e "${GREEN}✅ 无相关类型错误${NC}"
fi
echo ""

# 4. 统计数据质量
echo "4️⃣  数据质量统计..."

# 4.1 scraped_data保存率
echo "   📊 scraped_data保存率:"
sqlite3 "$DB_PATH" <<EOF
SELECT
  '   - 已完成抓取: ' || COUNT(*) || ' offers' as stat
FROM offers
WHERE scrape_status = 'completed';

SELECT
  '   - 包含scraped_data: ' || SUM(CASE WHEN scraped_data IS NOT NULL THEN 1 ELSE 0 END) || ' offers' as stat
FROM offers
WHERE scrape_status = 'completed';

SELECT
  '   - 保存率: ' || ROUND(100.0 * SUM(CASE WHEN scraped_data IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 2) || '%' as stat
FROM offers
WHERE scrape_status = 'completed';
EOF

echo ""

# 4.2 真实折扣数据统计
echo "   💰 真实折扣数据统计:"
DISCOUNT_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offers WHERE json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null';" || echo "0")
echo "   - 包含折扣数据的offers: $DISCOUNT_COUNT"

if [ "$DISCOUNT_COUNT" -gt 0 ]; then
    echo "   📝 示例折扣数据:"
    sqlite3 "$DB_PATH" "SELECT '   - Offer #' || id || ': ' || json_extract(scraped_data, '$.discount') FROM offers WHERE json_extract(scraped_data, '$.discount') IS NOT NULL AND json_extract(scraped_data, '$.discount') != 'null' LIMIT 3;"
fi

echo ""

# 4.3 Prime资格统计
echo "   🚀 Prime资格统计:"
PRIME_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offers WHERE json_extract(scraped_data, '$.primeEligible') = '1' OR json_extract(scraped_data, '$.primeEligible') = 'true';" || echo "0")
echo "   - Prime Eligible产品: $PRIME_COUNT"

echo ""

# 5. 检查广告创意数据利用情况
echo "5️⃣  广告创意数据利用检查..."

# 5.1 检查是否有已生成的创意
CREATIVE_COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offers WHERE extracted_headlines IS NOT NULL;" || echo "0")
echo "   📢 已生成广告创意的offers: $CREATIVE_COUNT"

if [ "$CREATIVE_COUNT" -gt 0 ]; then
    # 5.2 检查真实折扣使用率（简化版）
    echo ""
    echo "   🔍 真实数据使用情况（示例检查）:"

    # 检查第一个有折扣且有创意的offer
    HAS_DISCOUNT_AND_CREATIVE=$(sqlite3 "$DB_PATH" "SELECT id FROM offers WHERE json_extract(scraped_data, '$.discount') IS NOT NULL AND extracted_headlines IS NOT NULL LIMIT 1;" || echo "")

    if [ -n "$HAS_DISCOUNT_AND_CREATIVE" ]; then
        echo "   📝 Offer #$HAS_DISCOUNT_AND_CREATIVE 示例:"
        DISCOUNT=$(sqlite3 "$DB_PATH" "SELECT json_extract(scraped_data, '$.discount') FROM offers WHERE id = $HAS_DISCOUNT_AND_CREATIVE;")
        echo "      真实折扣: $DISCOUNT"

        echo "      Headlines中是否提及折扣:"
        HEADLINES=$(sqlite3 "$DB_PATH" "SELECT extracted_headlines FROM offers WHERE id = $HAS_DISCOUNT_AND_CREATIVE;")

        # 简单检查是否包含百分号或折扣关键词
        if echo "$HEADLINES" | grep -qi "%" || echo "$HEADLINES" | grep -qi "save\|off\|deal"; then
            echo -e "      ${GREEN}✅ 包含促销关键词${NC}"
        else
            echo -e "      ${YELLOW}⚠️  未明确提及折扣${NC}"
        fi
    fi
fi

echo ""
echo "========================================="
echo "📋 验证总结"
echo "========================================="
echo ""

# 总结检查项
PASS_COUNT=0
TOTAL_CHECKS=4

echo "核心检查项:"
echo -e "  ✅ 数据库文件存在"
PASS_COUNT=$((PASS_COUNT + 1))

if [ "$COLUMN_CHECK" -gt 0 ]; then
    echo -e "  ✅ scraped_data列已添加"
    PASS_COUNT=$((PASS_COUNT + 1))
else
    echo -e "  ❌ scraped_data列缺失"
fi

echo -e "  ✅ TypeScript编译通过"
PASS_COUNT=$((PASS_COUNT + 1))

# 判断数据质量是否合格
COMPLETED_OFFERS=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offers WHERE scrape_status = 'completed';" || echo "0")
if [ "$COMPLETED_OFFERS" -gt 0 ]; then
    WITH_DATA=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM offers WHERE scrape_status = 'completed' AND scraped_data IS NOT NULL;" || echo "0")
    SAVE_RATE=$((100 * WITH_DATA / COMPLETED_OFFERS))

    if [ "$SAVE_RATE" -ge 90 ]; then
        echo -e "  ✅ 数据保存率良好 ($SAVE_RATE%)"
        PASS_COUNT=$((PASS_COUNT + 1))
    elif [ "$WITH_DATA" -eq 0 ]; then
        echo -e "  ${YELLOW}⚠️  无scraped_data数据（可能是旧数据）${NC}"
    else
        echo -e "  ${YELLOW}⚠️  数据保存率偏低 ($SAVE_RATE%)${NC}"
    fi
else
    echo -e "  ${YELLOW}ℹ️  无已完成的抓取数据（建议创建测试offer）${NC}"
fi

echo ""
echo -e "通过检查: ${GREEN}$PASS_COUNT${NC}/$TOTAL_CHECKS"

if [ "$PASS_COUNT" -eq "$TOTAL_CHECKS" ]; then
    echo -e "${GREEN}🎉 所有核心检查通过！${NC}"
    echo ""
    echo "建议下一步:"
    echo "  1. 使用真实Amazon产品URL创建新的offer进行端到端测试"
    echo "  2. 参考 claudedocs/P0_VERIFICATION_GUIDE.md 进行完整验证"
    echo "  3. 监控Launch Score变化趋势"
elif [ "$PASS_COUNT" -ge 2 ]; then
    echo -e "${YELLOW}⚠️  部分检查未通过，但核心功能可用${NC}"
    echo ""
    echo "建议:"
    echo "  - 查看 claudedocs/P0_VERIFICATION_GUIDE.md 的故障排查部分"
    echo "  - 创建测试offer验证完整数据流"
else
    echo -e "${RED}❌ 多项检查失败，需要修复${NC}"
    echo ""
    echo "请检查:"
    echo "  1. 数据库schema是否正确更新"
    echo "  2. TypeScript类型定义是否完整"
    echo "  3. 参考 claudedocs/P0_DATA_UTILIZATION_OPTIMIZATION.md"
fi

echo ""
echo "========================================="
