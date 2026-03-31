#!/bin/bash

# P0端到端测试脚本
# 用途：创建测试offer，抓取数据，生成创意，验证真实数据使用

set -e

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

DB_PATH="data/autoads.db"
API_BASE="http://localhost:3000/api"

echo "========================================="
echo "🧪 P0端到端测试（E2E）"
echo "========================================="
echo ""

# 检查服务器是否运行
echo "1️⃣  检查dev server..."
if ! curl -s http://localhost:3000 > /dev/null 2>&1; then
    echo -e "${RED}❌ Dev server未运行${NC}"
    echo "请先运行: npm run dev"
    exit 1
fi
echo -e "${GREEN}✅ Dev server正在运行${NC}"
echo ""

# 准备测试数据
TEST_AMAZON_URL="https://www.amazon.com/dp/B08N5WRWNW"
TEST_BRAND="Amazon Echo Dot"

echo "2️⃣  创建测试Offer..."
echo "   URL: $TEST_AMAZON_URL"
echo "   Brand: $TEST_BRAND"

# 创建Offer
CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/offers" \
  -H "Content-Type: application/json" \
  -d "{
    \"url\": \"$TEST_AMAZON_URL\",
    \"brand\": \"$TEST_BRAND\",
    \"target_country\": \"US\",
    \"target_language\": \"English\"
  }")

# 提取Offer ID
OFFER_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":[0-9]*' | grep -o '[0-9]*' | head -1)

if [ -z "$OFFER_ID" ]; then
    echo -e "${RED}❌ 创建Offer失败${NC}"
    echo "响应: $CREATE_RESPONSE"
    exit 1
fi

echo -e "${GREEN}✅ Offer创建成功，ID: $OFFER_ID${NC}"
echo ""

# 触发抓取
echo "3️⃣  触发抓取（预计30-60秒）..."
SCRAPE_RESPONSE=$(curl -s -X POST "$API_BASE/offers/$OFFER_ID/scrape")

# 等待抓取完成（轮询检查）
MAX_WAIT=120  # 最多等待2分钟
WAIT_COUNT=0
SCRAPE_STATUS="pending"

echo -n "   等待抓取完成..."
while [ "$SCRAPE_STATUS" != "completed" ] && [ $WAIT_COUNT -lt $MAX_WAIT ]; do
    sleep 2
    WAIT_COUNT=$((WAIT_COUNT + 2))

    SCRAPE_STATUS=$(sqlite3 "$DB_PATH" "SELECT scrape_status FROM offers WHERE id = $OFFER_ID;" 2>/dev/null || echo "error")

    if [ "$SCRAPE_STATUS" == "failed" ]; then
        echo -e "\n${RED}❌ 抓取失败${NC}"
        SCRAPE_ERROR=$(sqlite3 "$DB_PATH" "SELECT scrape_error FROM offers WHERE id = $OFFER_ID;")
        echo "错误信息: $SCRAPE_ERROR"
        exit 1
    fi

    echo -n "."
done

if [ "$SCRAPE_STATUS" == "completed" ]; then
    echo -e "\n${GREEN}✅ 抓取完成（用时${WAIT_COUNT}秒）${NC}"
else
    echo -e "\n${YELLOW}⚠️  抓取超时，状态: $SCRAPE_STATUS${NC}"
    exit 1
fi
echo ""

# 验证scraped_data保存
echo "4️⃣  验证scraped_data保存..."

HAS_SCRAPED_DATA=$(sqlite3 "$DB_PATH" "SELECT CASE WHEN scraped_data IS NOT NULL THEN 1 ELSE 0 END FROM offers WHERE id = $OFFER_ID;")

if [ "$HAS_SCRAPED_DATA" -eq 1 ]; then
    echo -e "${GREEN}✅ scraped_data已保存${NC}"

    # 提取关键字段
    DISCOUNT=$(sqlite3 "$DB_PATH" "SELECT json_extract(scraped_data, '$.discount') FROM offers WHERE id = $OFFER_ID;" 2>/dev/null || echo "null")
    SALES_RANK=$(sqlite3 "$DB_PATH" "SELECT json_extract(scraped_data, '$.salesRank') FROM offers WHERE id = $OFFER_ID;" 2>/dev/null || echo "null")
    BADGE=$(sqlite3 "$DB_PATH" "SELECT json_extract(scraped_data, '$.badge') FROM offers WHERE id = $OFFER_ID;" 2>/dev/null || echo "null")
    PRIME=$(sqlite3 "$DB_PATH" "SELECT json_extract(scraped_data, '$.primeEligible') FROM offers WHERE id = $OFFER_ID;" 2>/dev/null || echo "null")
    AVAILABILITY=$(sqlite3 "$DB_PATH" "SELECT json_extract(scraped_data, '$.availability') FROM offers WHERE id = $OFFER_ID;" 2>/dev/null || echo "null")

    echo ""
    echo "   📊 抓取到的数据:"
    echo "   - Discount: ${DISCOUNT:-null}"
    echo "   - Sales Rank: ${SALES_RANK:-null}"
    echo "   - Badge: ${BADGE:-null}"
    echo "   - Prime Eligible: ${PRIME:-null}"
    echo "   - Availability: ${AVAILABILITY:-null}"

    # 统计有多少字段有数据
    DATA_COUNT=0
    [ "$DISCOUNT" != "null" ] && [ -n "$DISCOUNT" ] && DATA_COUNT=$((DATA_COUNT + 1))
    [ "$SALES_RANK" != "null" ] && [ -n "$SALES_RANK" ] && DATA_COUNT=$((DATA_COUNT + 1))
    [ "$BADGE" != "null" ] && [ -n "$BADGE" ] && DATA_COUNT=$((DATA_COUNT + 1))
    [ "$PRIME" != "null" ] && [ -n "$PRIME" ] && DATA_COUNT=$((DATA_COUNT + 1))
    [ "$AVAILABILITY" != "null" ] && [ -n "$AVAILABILITY" ] && DATA_COUNT=$((DATA_COUNT + 1))

    echo "   有效数据字段: $DATA_COUNT/5"

    if [ $DATA_COUNT -ge 3 ]; then
        echo -e "${GREEN}   ✅ 数据质量良好${NC}"
    elif [ $DATA_COUNT -ge 1 ]; then
        echo -e "${YELLOW}   ⚠️  部分数据缺失${NC}"
    else
        echo -e "${RED}   ❌ 数据几乎为空${NC}"
    fi
else
    echo -e "${RED}❌ scraped_data为空${NC}"
    echo "这是一个严重问题，请检查scrape route的实现"
    exit 1
fi
echo ""

# 生成广告创意
echo "5️⃣  生成广告创意..."
GENERATE_RESPONSE=$(curl -s -X POST "$API_BASE/offers/$OFFER_ID/generate")

# 检查是否成功生成
sleep 3  # 等待生成完成

HAS_HEADLINES=$(sqlite3 "$DB_PATH" "SELECT CASE WHEN extracted_headlines IS NOT NULL THEN 1 ELSE 0 END FROM offers WHERE id = $OFFER_ID;")

if [ "$HAS_HEADLINES" -eq 1 ]; then
    echo -e "${GREEN}✅ 广告创意已生成${NC}"
else
    echo -e "${RED}❌ 广告创意生成失败${NC}"
    exit 1
fi
echo ""

# 验证真实数据使用
echo "6️⃣  验证真实数据使用..."

HEADLINES=$(sqlite3 "$DB_PATH" "SELECT extracted_headlines FROM offers WHERE id = $OFFER_ID;")

echo "   📝 生成的Headlines（前5个）:"
echo "$HEADLINES" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for i, h in enumerate(data[:5], 1):
        print(f'   {i}. {h}')
except:
    print('   解析失败')
"

echo ""
echo "   🔍 真实数据使用检查:"

# 检查是否使用了真实折扣
if [ "$DISCOUNT" != "null" ] && [ -n "$DISCOUNT" ]; then
    # 移除JSON字符串的引号
    DISCOUNT_CLEAN=$(echo "$DISCOUNT" | tr -d '"')
    if echo "$HEADLINES" | grep -q "$DISCOUNT_CLEAN" || echo "$HEADLINES" | grep -qi "save\|off"; then
        echo -e "   ${GREEN}✅ 使用了促销信息${NC}"
    else
        echo -e "   ${YELLOW}⚠️  未明确使用折扣: $DISCOUNT_CLEAN${NC}"
    fi
else
    echo "   ℹ️  产品无折扣数据（跳过检查）"
fi

# 检查是否提及Prime
if [ "$PRIME" == "true" ] || [ "$PRIME" == "1" ]; then
    if echo "$HEADLINES" | grep -qi "prime"; then
        echo -e "   ${GREEN}✅ 提及了Prime${NC}"
    else
        echo -e "   ${YELLOW}⚠️  未提及Prime（产品是Prime Eligible）${NC}"
    fi
fi

# 检查是否使用了Best Seller或badge
if [ "$SALES_RANK" != "null" ] && [ -n "$SALES_RANK" ] || [ "$BADGE" != "null" ] && [ -n "$BADGE" ]; then
    if echo "$HEADLINES" | grep -qi "best seller\|#1\|amazon's choice"; then
        echo -e "   ${GREEN}✅ 使用了社会证明（排名/徽章）${NC}"
    else
        echo -e "   ${YELLOW}⚠️  未使用社会证明${NC}"
    fi
fi

echo ""
echo "========================================="
echo "📊 测试总结"
echo "========================================="
echo ""

echo "测试Offer ID: $OFFER_ID"
echo "测试URL: $TEST_AMAZON_URL"
echo ""

PASS_TESTS=0
TOTAL_TESTS=5

echo "核心测试项:"
echo -e "  ✅ Offer创建成功"
PASS_TESTS=$((PASS_TESTS + 1))

echo -e "  ✅ 抓取完成"
PASS_TESTS=$((PASS_TESTS + 1))

if [ "$HAS_SCRAPED_DATA" -eq 1 ]; then
    echo -e "  ✅ scraped_data已保存"
    PASS_TESTS=$((PASS_TESTS + 1))
else
    echo -e "  ❌ scraped_data未保存"
fi

if [ $DATA_COUNT -ge 1 ]; then
    echo -e "  ✅ 数据字段有效 ($DATA_COUNT/5)"
    PASS_TESTS=$((PASS_TESTS + 1))
else
    echo -e "  ❌ 数据字段无效"
fi

if [ "$HAS_HEADLINES" -eq 1 ]; then
    echo -e "  ✅ 广告创意已生成"
    PASS_TESTS=$((PASS_TESTS + 1))
else
    echo -e "  ❌ 广告创意未生成"
fi

echo ""
echo -e "通过测试: ${GREEN}$PASS_TESTS${NC}/$TOTAL_TESTS"

if [ $PASS_TESTS -eq $TOTAL_TESTS ]; then
    echo -e "${GREEN}🎉 所有测试通过！P0优化验证成功${NC}"
    echo ""
    echo "后续建议:"
    echo "  1. 在数据库中查看完整的scraped_data:"
    echo "     sqlite3 $DB_PATH \"SELECT scraped_data FROM offers WHERE id = $OFFER_ID;\""
    echo ""
    echo "  2. 生成Launch Score并对比:"
    echo "     curl -X POST $API_BASE/offers/$OFFER_ID/launch-score"
    echo ""
    echo "  3. 监控未来几天的Launch Score趋势"
    exit 0
elif [ $PASS_TESTS -ge 3 ]; then
    echo -e "${YELLOW}⚠️  部分测试通过，核心功能可用${NC}"
    exit 0
else
    echo -e "${RED}❌ 多项测试失败${NC}"
    exit 1
fi
