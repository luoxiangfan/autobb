#!/bin/bash

# A/B测试端到端自动化测试脚本
# 用途：验证Phase 1（创意测试）+ Phase 2（策略测试）完整流程

set -e  # 遇到错误立即退出

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 日志函数
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}  $1${NC}"
    echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

# 配置
API_BASE="http://localhost:3000"
DB_PATH="data/autoads.db"
TEST_TIMESTAMP=$(date +%Y%m%d%H%M%S)
OFFER_ID=1

# 检查必要的命令
check_dependencies() {
    log_step "步骤0: 检查依赖"

    for cmd in curl jq sqlite3 node; do
        if ! command -v $cmd &> /dev/null; then
            log_error "$cmd 未安装，请先安装"
            exit 1
        fi
    done

    log_success "所有依赖已安装"
}

# 检查服务是否运行
check_services() {
    log_step "步骤1: 检查服务状态"

    # 检查Next.js服务
    if ! curl -s "${API_BASE}/api/health" &> /dev/null; then
        log_error "Next.js服务未运行，请执行: npm run dev"
        exit 1
    fi
    log_success "Next.js服务运行中"

    # 检查数据库
    if [ ! -f "$DB_PATH" ]; then
        log_error "数据库文件不存在: $DB_PATH"
        exit 1
    fi
    log_success "数据库文件存在"
}

# 清理旧测试数据
cleanup_old_data() {
    log_step "步骤2: 清理旧测试数据"

    sqlite3 "$DB_PATH" <<EOF
DELETE FROM ab_tests WHERE test_name LIKE '%测试-%';
DELETE FROM ab_test_variants WHERE ab_test_id NOT IN (SELECT id FROM ab_tests);
DELETE FROM campaign_performance WHERE date >= date('now', '-1 day');
VACUUM;
EOF

    log_success "旧测试数据已清理"
}

# 创建Phase 1测试
create_phase1_test() {
    log_step "步骤3: 创建Phase 1创意测试"

    # 确保有一个测试用的Google Ads账户
    local google_ads_account=$(sqlite3 "$DB_PATH" "SELECT id FROM google_ads_accounts WHERE user_id=1 LIMIT 1;")
    if [ -z "$google_ads_account" ]; then
        sqlite3 "$DB_PATH" <<EOF
INSERT INTO google_ads_accounts (user_id, customer_id, account_name, currency, timezone, created_at, updated_at)
VALUES (1, 'test-customer-123', 'Test Google Ads Account', 'CNY', 'Asia/Shanghai', datetime('now'), datetime('now'));
EOF
        google_ads_account=$(sqlite3 "$DB_PATH" "SELECT id FROM google_ads_accounts WHERE user_id=1 LIMIT 1;")
        log_info "创建测试Google Ads账户, ID: $google_ads_account"
    fi
    GOOGLE_ADS_ACCOUNT_ID=$google_ads_account

    # 直接在数据库中创建测试（绕过API认证）
    sqlite3 "$DB_PATH" <<EOF
-- 创建ab_test记录
INSERT INTO ab_tests (
    user_id, offer_id, test_name, test_type, test_dimension, is_auto_test,
    status, start_date, min_sample_size, confidence_level, created_at, updated_at
) VALUES (
    1, $OFFER_ID, '测试-创意-$TEST_TIMESTAMP', 'headline', 'creative', 1,
    'running', datetime('now'), 100, 0.95, datetime('now'), datetime('now')
);
EOF

    PHASE1_TEST_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM ab_tests WHERE test_name='测试-创意-$TEST_TIMESTAMP';")

    if [ -z "$PHASE1_TEST_ID" ]; then
        log_error "创建测试失败"
        exit 1
    fi

    log_success "Phase 1测试创建成功, ID: $PHASE1_TEST_ID"

    # 创建3个ad_creatives
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO ad_creatives (user_id, offer_id, headlines, descriptions, final_url, created_at, updated_at)
VALUES
(1, $OFFER_ID, '["专业CRM系统 - 提升销售效率"]', '["全功能CRM解决方案，助力企业数字化转型"]', 'https://example.com', datetime('now'), datetime('now')),
(1, $OFFER_ID, '["CRM系统 - 3个月内ROI提升50%"]', '["已帮助1000+企业实现销售增长，立即免费试用"]', 'https://example.com', datetime('now'), datetime('now')),
(1, $OFFER_ID, '["5分钟上手的CRM - 无需培训"]', '["直观界面，拖拽操作，让销售团队立即投入使用"]', 'https://example.com', datetime('now'), datetime('now'));
EOF

    local creative_ids=$(sqlite3 "$DB_PATH" "SELECT id FROM ad_creatives WHERE offer_id=$OFFER_ID ORDER BY id DESC LIMIT 3;")
    CREATIVE_IDS=($creative_ids)

    # 创建3个campaigns（关联ad_creative_id以便监控任务更新ab_test_variants）
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO campaigns (user_id, offer_id, google_ads_account_id, campaign_name, status, budget_amount, budget_type, creation_status, ab_test_id, is_test_variant, ad_creative_id, google_campaign_id, created_at, updated_at)
VALUES
(1, $OFFER_ID, $GOOGLE_ADS_ACCOUNT_ID, '测试Campaign-Control-$TEST_TIMESTAMP', 'ACTIVE', 100.0, 'DAILY', 'synced', $PHASE1_TEST_ID, 1, ${CREATIVE_IDS[2]}, 'test-campaign-control-$TEST_TIMESTAMP', datetime('now'), datetime('now')),
(1, $OFFER_ID, $GOOGLE_ADS_ACCOUNT_ID, '测试Campaign-VariantA-$TEST_TIMESTAMP', 'ACTIVE', 100.0, 'DAILY', 'synced', $PHASE1_TEST_ID, 1, ${CREATIVE_IDS[1]}, 'test-campaign-variantA-$TEST_TIMESTAMP', datetime('now'), datetime('now')),
(1, $OFFER_ID, $GOOGLE_ADS_ACCOUNT_ID, '测试Campaign-VariantB-$TEST_TIMESTAMP', 'ACTIVE', 100.0, 'DAILY', 'synced', $PHASE1_TEST_ID, 1, ${CREATIVE_IDS[0]}, 'test-campaign-variantB-$TEST_TIMESTAMP', datetime('now'), datetime('now'));
EOF

    local campaigns=$(sqlite3 "$DB_PATH" "SELECT id FROM campaigns WHERE campaign_name LIKE '%$TEST_TIMESTAMP' ORDER BY id DESC LIMIT 3;")
    CAMPAIGN_IDS=($campaigns)

    if [ ${#CAMPAIGN_IDS[@]} -lt 3 ]; then
        log_error "Campaign创建失败"
        exit 1
    fi

    log_info "Campaigns: ${CAMPAIGN_IDS[0]}, ${CAMPAIGN_IDS[1]}, ${CAMPAIGN_IDS[2]}"

    # 创建ab_test_variants
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO ab_test_variants (
    ab_test_id, variant_name, variant_label, ad_creative_id,
    traffic_allocation, is_control, created_at, updated_at
) VALUES
($PHASE1_TEST_ID, 'control', '原始创意', ${CREATIVE_IDS[2]}, 0.34, 1, datetime('now'), datetime('now')),
($PHASE1_TEST_ID, 'variant_a', '强调ROI', ${CREATIVE_IDS[1]}, 0.33, 0, datetime('now'), datetime('now')),
($PHASE1_TEST_ID, 'variant_b', '强调简单易用', ${CREATIVE_IDS[0]}, 0.33, 0, datetime('now'), datetime('now'));
EOF

    log_success "创建了3个test variants"
}

# 插入Phase 1性能数据
insert_phase1_data() {
    log_step "步骤4: 插入Phase 1模拟性能数据"

    log_info "Control组: 5000展示 → 100点击 → CTR 2.0%"
    log_info "Variant A: 5000展示 → 140点击 → CTR 2.8% (领先40%)"
    log_info "Variant B: 5000展示 → 90点击 → CTR 1.8%"

    sqlite3 "$DB_PATH" <<EOF
-- Control组：CTR = 2.0%
INSERT INTO campaign_performance (
    user_id, campaign_id, date,
    impressions, clicks, conversions, cost,
    ctr, cpc, cpa, conversion_rate
) VALUES
(1, ${CAMPAIGN_IDS[0]}, date('now'), 5000, 100, 5, 500.0, 2.0, 5.0, 100.0, 5.0);

-- Variant A（强调ROI）：CTR = 2.8% (更好)
INSERT INTO campaign_performance (
    user_id, campaign_id, date,
    impressions, clicks, conversions, cost,
    ctr, cpc, cpa, conversion_rate
) VALUES
(1, ${CAMPAIGN_IDS[1]}, date('now'), 5000, 140, 7, 490.0, 2.8, 3.5, 70.0, 5.0);

-- Variant B（强调简单易用）：CTR = 1.8%
INSERT INTO campaign_performance (
    user_id, campaign_id, date,
    impressions, clicks, conversions, cost,
    ctr, cpc, cpa, conversion_rate
) VALUES
(1, ${CAMPAIGN_IDS[2]}, date('now'), 5000, 90, 4, 450.0, 1.8, 5.0, 112.5, 4.4);
EOF

    log_success "Phase 1性能数据已插入"
}

# 运行监控任务
run_monitoring() {
    log_step "步骤5: 运行A/B测试监控任务"

    log_info "执行监控任务..."
    # Use tsx to execute monitoring helper script (better TypeScript support)
    npx tsx scripts/run-ab-monitor.ts

    log_success "监控任务执行完成"
}

# 验证Phase 1结果
verify_phase1() {
    log_step "步骤6: 验证Phase 1测试结果"

    # 检查测试状态
    local test_status=$(sqlite3 "$DB_PATH" "SELECT status FROM ab_tests WHERE id=$PHASE1_TEST_ID;")
    log_info "测试状态: $test_status"

    if [ "$test_status" != "completed" ]; then
        log_warning "测试状态不是completed，可能样本量不足或未达到显著性"
    else
        log_success "✅ 测试已完成"
    fi

    # 检查winner
    local winner=$(sqlite3 "$DB_PATH" "SELECT v.variant_label FROM ab_test_variants v JOIN ab_tests t ON t.id = v.ab_test_id WHERE v.ab_test_id=$PHASE1_TEST_ID AND v.id = t.winner_variant_id;")

    if [ -z "$winner" ]; then
        log_error "❌ 未找到winner"
        exit 1
    fi

    log_success "✅ Winner: $winner"

    # 检查性能数据
    local variants_data=$(sqlite3 "$DB_PATH" "SELECT v.variant_label, v.impressions, v.clicks, v.ctr, CASE WHEN v.id = t.winner_variant_id THEN 1 ELSE 0 END as is_winner FROM ab_test_variants v JOIN ab_tests t ON t.id = v.ab_test_id WHERE v.ab_test_id=$PHASE1_TEST_ID ORDER BY v.variant_name;")

    echo ""
    log_info "Variants性能数据:"
    echo "$variants_data" | while IFS='|' read -r label imp clicks ctr winner_flag; do
        local winner_badge=""
        [ "$winner_flag" == "1" ] && winner_badge="🏆"
        printf "  %-15s: %5d展示, %3d点击, CTR %s%% %s\n" "$label" "$imp" "$clicks" "$ctr" "$winner_badge"
    done

    # 保存winner campaign_id用于Phase 2
    WINNER_CAMPAIGN_ID=$(sqlite3 "$DB_PATH" "
      SELECT c.id FROM campaigns c
      JOIN ab_test_variants v ON c.ad_creative_id = v.ad_creative_id
      JOIN ab_tests t ON t.id = v.ab_test_id
      WHERE v.ab_test_id = $PHASE1_TEST_ID
        AND c.ab_test_id = $PHASE1_TEST_ID
        AND v.id = t.winner_variant_id
      LIMIT 1;
    ")
    log_info "Winner Campaign ID: $WINNER_CAMPAIGN_ID"

    echo ""
    log_success "✅ Phase 1验证通过"
}

# 创建Phase 2测试
create_phase2_test() {
    log_step "步骤7: 创建Phase 2策略测试"

    log_info "基于Phase 1 Winner (Campaign $WINNER_CAMPAIGN_ID)"

    # 直接在数据库中创建Phase 2测试
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO ab_tests (
    user_id, offer_id, test_name, test_type, test_dimension, is_auto_test,
    status, start_date, min_sample_size, confidence_level, parent_campaign_id, created_at, updated_at
) VALUES (
    1, $OFFER_ID, '测试-策略-$TEST_TIMESTAMP', 'headline', 'strategy', 1,
    'running', datetime('now'), 50, 0.95, $WINNER_CAMPAIGN_ID, datetime('now'), datetime('now')
);
EOF

    PHASE2_TEST_ID=$(sqlite3 "$DB_PATH" "SELECT id FROM ab_tests WHERE test_name='测试-策略-$TEST_TIMESTAMP';")

    if [ -z "$PHASE2_TEST_ID" ]; then
        log_error "创建Phase 2测试失败"
        exit 1
    fi

    log_success "Phase 2测试创建成功, ID: $PHASE2_TEST_ID"

    # 创建3个新的ad_creatives (复用Phase 1 winner的创意)
    local winner_creative=$(sqlite3 "$DB_PATH" "SELECT ad_creative_id FROM ab_test_variants v WHERE v.ab_test_id=$PHASE1_TEST_ID AND v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = $PHASE1_TEST_ID);")

    sqlite3 "$DB_PATH" <<EOF
INSERT INTO ad_creatives (user_id, offer_id, headlines, descriptions, final_url, created_at, updated_at)
SELECT user_id, offer_id, headlines, descriptions, final_url, datetime('now'), datetime('now')
FROM ad_creatives WHERE id=$winner_creative;

INSERT INTO ad_creatives (user_id, offer_id, headlines, descriptions, final_url, created_at, updated_at)
SELECT user_id, offer_id, headlines, descriptions, final_url, datetime('now'), datetime('now')
FROM ad_creatives WHERE id=$winner_creative;

INSERT INTO ad_creatives (user_id, offer_id, headlines, descriptions, final_url, created_at, updated_at)
SELECT user_id, offer_id, headlines, descriptions, final_url, datetime('now'), datetime('now')
FROM ad_creatives WHERE id=$winner_creative;
EOF

    local phase2_creative_ids=$(sqlite3 "$DB_PATH" "SELECT id FROM ad_creatives WHERE offer_id=$OFFER_ID ORDER BY id DESC LIMIT 3;")
    PHASE2_CREATIVE_IDS=($phase2_creative_ids)

    # 创建3个新的campaigns（关联ad_creative_id以便监控任务更新ab_test_variants）
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO campaigns (user_id, offer_id, google_ads_account_id, campaign_name, status, budget_amount, budget_type, creation_status, ab_test_id, is_test_variant, ad_creative_id, google_campaign_id, created_at, updated_at)
VALUES
(1, $OFFER_ID, $GOOGLE_ADS_ACCOUNT_ID, '测试Phase2-Control-$TEST_TIMESTAMP', 'ACTIVE', 100.0, 'DAILY', 'synced', $PHASE2_TEST_ID, 1, ${PHASE2_CREATIVE_IDS[2]}, 'test-phase2-control-$TEST_TIMESTAMP', datetime('now'), datetime('now')),
(1, $OFFER_ID, $GOOGLE_ADS_ACCOUNT_ID, '测试Phase2-VariantA-$TEST_TIMESTAMP', 'ACTIVE', 100.0, 'DAILY', 'synced', $PHASE2_TEST_ID, 1, ${PHASE2_CREATIVE_IDS[1]}, 'test-phase2-variantA-$TEST_TIMESTAMP', datetime('now'), datetime('now')),
(1, $OFFER_ID, $GOOGLE_ADS_ACCOUNT_ID, '测试Phase2-VariantB-$TEST_TIMESTAMP', 'ACTIVE', 100.0, 'DAILY', 'synced', $PHASE2_TEST_ID, 1, ${PHASE2_CREATIVE_IDS[0]}, 'test-phase2-variantB-$TEST_TIMESTAMP', datetime('now'), datetime('now'));
EOF

    local campaigns=$(sqlite3 "$DB_PATH" "SELECT id FROM campaigns WHERE campaign_name LIKE '%Phase2%$TEST_TIMESTAMP' ORDER BY id DESC LIMIT 3;")
    PHASE2_CAMPAIGN_IDS=($campaigns)

    if [ ${#PHASE2_CAMPAIGN_IDS[@]} -lt 3 ]; then
        log_error "Phase 2 Campaign创建失败"
        exit 1
    fi

    log_info "Phase 2 Campaigns: ${PHASE2_CAMPAIGN_IDS[0]}, ${PHASE2_CAMPAIGN_IDS[1]}, ${PHASE2_CAMPAIGN_IDS[2]}"

    # 创建ab_test_variants
    sqlite3 "$DB_PATH" <<EOF
INSERT INTO ab_test_variants (
    ab_test_id, variant_name, variant_label, ad_creative_id,
    traffic_allocation, is_control, created_at, updated_at
) VALUES
($PHASE2_TEST_ID, 'control', '基础策略', ${PHASE2_CREATIVE_IDS[2]}, 0.34, 1, datetime('now'), datetime('now')),
($PHASE2_TEST_ID, 'variant_a', '激进负关键词', ${PHASE2_CREATIVE_IDS[1]}, 0.33, 0, datetime('now'), datetime('now')),
($PHASE2_TEST_ID, 'variant_b', 'CPC优化', ${PHASE2_CREATIVE_IDS[0]}, 0.33, 0, datetime('now'), datetime('now'));
EOF

    log_success "创建了3个Phase 2 test variants"
}

# 插入Phase 2性能数据
insert_phase2_data() {
    log_step "步骤8: 插入Phase 2模拟性能数据"

    log_info "Control组: 200点击 → 成本¥2000 → CPC ¥10.00"
    log_info "Variant A: 200点击 → 成本¥1500 → CPC ¥7.50 (降低25%)"
    log_info "Variant B: 200点击 → 成本¥1700 → CPC ¥8.50 (降低15%)"

    sqlite3 "$DB_PATH" <<EOF
-- Control（基础策略）：CPC = ¥10.00
INSERT INTO campaign_performance (
    user_id, campaign_id, date,
    impressions, clicks, conversions, cost,
    ctr, cpc, cpa, conversion_rate
) VALUES
(1, ${PHASE2_CAMPAIGN_IDS[0]}, date('now'), 10000, 200, 20, 2000.0, 2.0, 10.0, 100.0, 10.0);

-- Variant A（激进负关键词）：CPC = ¥7.50 (降低25%)
INSERT INTO campaign_performance (
    user_id, campaign_id, date,
    impressions, clicks, conversions, cost,
    ctr, cpc, cpa, conversion_rate
) VALUES
(1, ${PHASE2_CAMPAIGN_IDS[1]}, date('now'), 10000, 200, 24, 1500.0, 2.0, 7.5, 62.5, 12.0);

-- Variant B（CPC优化）：CPC = ¥8.50 (降低15%)
INSERT INTO campaign_performance (
    user_id, campaign_id, date,
    impressions, clicks, conversions, cost,
    ctr, cpc, cpa, conversion_rate
) VALUES
(1, ${PHASE2_CAMPAIGN_IDS[2]}, date('now'), 10000, 200, 20, 1700.0, 2.0, 8.5, 85.0, 10.0);
EOF

    log_success "Phase 2性能数据已插入"
}

# 验证Phase 2结果
verify_phase2() {
    log_step "步骤9: 验证Phase 2测试结果"

    # 检查测试状态
    local test_status=$(sqlite3 "$DB_PATH" "SELECT status FROM ab_tests WHERE id=$PHASE2_TEST_ID;")
    log_info "测试状态: $test_status"

    if [ "$test_status" != "completed" ]; then
        log_warning "测试状态不是completed，可能样本量不足或未达到显著性"
    else
        log_success "✅ 测试已完成"
    fi

    # 检查winner
    local winner=$(sqlite3 "$DB_PATH" "SELECT v.variant_label FROM ab_test_variants v JOIN ab_tests t ON t.id = v.ab_test_id WHERE v.ab_test_id=$PHASE2_TEST_ID AND v.id = t.winner_variant_id;")

    if [ -z "$winner" ]; then
        log_error "❌ 未找到winner"
        exit 1
    fi

    log_success "✅ Winner: $winner"

    # 检查性能数据（计算CPC）
    local variants_data=$(sqlite3 "$DB_PATH" "SELECT v.variant_label, v.clicks, v.cost, (v.cost/v.clicks) as cpc, CASE WHEN v.id = t.winner_variant_id THEN 1 ELSE 0 END as is_winner FROM ab_test_variants v JOIN ab_tests t ON t.id = v.ab_test_id WHERE v.ab_test_id=$PHASE2_TEST_ID ORDER BY v.variant_name;")

    echo ""
    log_info "Variants性能数据:"
    echo "$variants_data" | while IFS='|' read -r label clicks cost cpc winner_flag; do
        local winner_badge=""
        [ "$winner_flag" == "1" ] && winner_badge="🏆"
        printf "  %-15s: %3d点击, 成本¥%-7.2f, CPC ¥%s %s\n" "$label" "$clicks" "$cost" "$cpc" "$winner_badge"
    done

    echo ""
    log_success "✅ Phase 2验证通过"
}

# 生成测试报告
generate_report() {
    log_step "步骤10: 生成测试报告"

    local report_file="test-report-${TEST_TIMESTAMP}.txt"

    cat > "$report_file" <<EOF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  A/B测试端到端测试报告
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

测试时间: $(date '+%Y-%m-%d %H:%M:%S')
测试环境: 本地开发环境
数据库: $DB_PATH

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 1: 创意测试
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

测试ID: $PHASE1_TEST_ID
测试名称: 测试-创意-$TEST_TIMESTAMP
优化指标: CTR（点击率）
样本量要求: 100点击

$(sqlite3 "$DB_PATH" -header -column "SELECT
    variant_label AS '变体',
    impressions AS '展示数',
    clicks AS '点击数',
    ctr AS 'CTR',
    CASE WHEN v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = v.ab_test_id) THEN 'Winner 🏆' ELSE '' END AS '状态'
FROM ab_test_variants v
WHERE v.ab_test_id=$PHASE1_TEST_ID
ORDER BY variant_name;")

测试状态: $(sqlite3 "$DB_PATH" "SELECT status FROM ab_tests WHERE id=$PHASE1_TEST_ID;")
Winner: $(sqlite3 "$DB_PATH" "SELECT variant_label FROM ab_test_variants v WHERE v.ab_test_id=$PHASE1_TEST_ID AND v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = $PHASE1_TEST_ID);")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Phase 2: 策略测试
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

测试ID: $PHASE2_TEST_ID
测试名称: 测试-策略-$TEST_TIMESTAMP
优化指标: CPC（点击成本）
样本量要求: 50点击
基于Phase 1 Winner: Campaign $WINNER_CAMPAIGN_ID

$(sqlite3 "$DB_PATH" -header -column "SELECT
    variant_label AS '变体',
    clicks AS '点击数',
    cost AS '成本',
    ROUND(cost/clicks, 2) AS 'CPC',
    CASE WHEN v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = v.ab_test_id) THEN 'Winner 🏆' ELSE '' END AS '状态'
FROM ab_test_variants v
WHERE v.ab_test_id=$PHASE2_TEST_ID
ORDER BY variant_name;")

测试状态: $(sqlite3 "$DB_PATH" "SELECT status FROM ab_tests WHERE id=$PHASE2_TEST_ID;")
Winner: $(sqlite3 "$DB_PATH" "SELECT variant_label FROM ab_test_variants v WHERE v.ab_test_id=$PHASE2_TEST_ID AND v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = $PHASE2_TEST_ID);")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  测试总结
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Phase 1创意测试:
   - 测试3个创意变体
   - 优化CTR指标
   - Winner: $(sqlite3 "$DB_PATH" "SELECT variant_label FROM ab_test_variants v WHERE v.ab_test_id=$PHASE1_TEST_ID AND v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = $PHASE1_TEST_ID);")
   - CTR提升: $(sqlite3 "$DB_PATH" "SELECT ROUND((MAX(ctr) - MIN(ctr)) / MIN(ctr) * 100, 1) || '%' FROM ab_test_variants WHERE ab_test_id=$PHASE1_TEST_ID;")

✅ Phase 2策略测试:
   - 基于Phase 1 Winner
   - 测试3个优化策略
   - 优化CPC指标
   - Winner: $(sqlite3 "$DB_PATH" "SELECT variant_label FROM ab_test_variants v WHERE v.ab_test_id=$PHASE2_TEST_ID AND v.id = (SELECT winner_variant_id FROM ab_tests WHERE id = $PHASE2_TEST_ID);")
   - CPC降低: $(sqlite3 "$DB_PATH" "SELECT ROUND((MIN(cost/clicks) - MAX(cost/clicks)) / MAX(cost/clicks) * 100, 1) || '%' FROM ab_test_variants WHERE ab_test_id=$PHASE2_TEST_ID;")

✅ 端到端测试: PASS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  前端验证URL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Dashboard: ${API_BASE}/dashboard
Phase 1详情: ${API_BASE}/ab-tests/$PHASE1_TEST_ID
Phase 2详情: ${API_BASE}/ab-tests/$PHASE2_TEST_ID

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EOF

    # 显示报告
    cat "$report_file"

    log_success "测试报告已生成: $report_file"
}

# 主流程
main() {
    echo ""
    echo -e "${GREEN}╔═══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}║       A/B测试端到端自动化测试脚本                              ║${NC}"
    echo -e "${GREEN}║       Phase 1 (创意测试) + Phase 2 (策略测试)                 ║${NC}"
    echo -e "${GREEN}║                                                               ║${NC}"
    echo -e "${GREEN}╚═══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    check_dependencies
    check_services
    cleanup_old_data
    create_phase1_test
    insert_phase1_data
    run_monitoring
    verify_phase1

    echo ""
    log_info "等待2秒后开始Phase 2..."
    sleep 2

    create_phase2_test
    insert_phase2_data
    run_monitoring
    verify_phase2
    generate_report

    echo ""
    log_success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    log_success "  🎉 端到端测试完成！所有测试通过！"
    log_success "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# 执行主流程
main "$@"
